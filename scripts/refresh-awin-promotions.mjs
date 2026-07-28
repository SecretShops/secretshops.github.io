#!/usr/bin/env node

import { appendFile, readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { atomicWriteJson } from "./lib/awin-feed-utils.mjs";
import {
  normalizeAwinPromotion,
  promotionItems,
  samePromotionContent
} from "./lib/awin-promotions-core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "data/promotions/awin.json");
const PAGE_SIZE = 200;
const MAX_PAGES = 100;
const ADVERTISER_BATCH_SIZE = 5;
const MAX_ATTEMPTS = 3;

export class AwinOffersError extends Error {
  constructor(message, { status = null, retryable = false, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AwinOffersError";
    this.status = status;
    this.retryable = retryable;
  }
}

function safeRepositoryPath(publicPath) {
  const value = String(publicPath || "");
  if (!value.startsWith("/") || value.includes("..")) {
    throw new Error(`Ruta pública insegura: ${value}`);
  }
  const local = resolve(root, `.${value}`);
  if (local !== root && !local.startsWith(`${root}${sep}`)) {
    throw new Error(`Ruta fuera del repositorio: ${value}`);
  }
  return local;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

function offerMerchantIds(payload) {
  return new Set(
    (payload?.families || []).flatMap((family) =>
      (family.variants || []).flatMap((variant) =>
        (variant.offers || []).map((offer) => offer.merchantId).filter(Boolean)
      )
    )
  );
}

async function repositoryContext() {
  const [merchantsPayload, regionsPayload] = await Promise.all([
    readJson(resolve(root, "data/catalog/merchants.json")),
    readJson(resolve(root, "data/config/regions.json"))
  ]);
  const approved = (merchantsPayload.merchants || []).filter((merchant) =>
    merchant.network === "awin" &&
    merchant.status === "approved" &&
    merchant.awinAdvertiserId
  );
  const merchantsByAdvertiser = new Map(
    approved.map((merchant) => [String(merchant.awinAdvertiserId), merchant])
  );
  const merchantRegions = new Map(approved.map((merchant) => [merchant.id, new Set()]));
  const published = (regionsPayload.regions || []).filter((region) => region.status === "published");

  for (const region of published) {
    const manifest = await readJson(safeRepositoryPath(region.catalogManifest));
    const ids = new Set();
    for (const source of manifest.sources || []) {
      const payload = await readJson(safeRepositoryPath(source.path));
      for (const merchantId of offerMerchantIds(payload)) ids.add(merchantId);
    }
    for (const merchantId of ids) merchantRegions.get(merchantId)?.add(region.id);
  }

  return {
    merchantsByAdvertiser,
    merchantRegions,
    regionsById: new Map(published.map((region) => [region.id, region]))
  };
}

function retryableStatus(status) {
  return status === 429 || status >= 500;
}

function retryDelay(response, attempt) {
  const retryAfter = response?.headers?.get?.("retry-after");
  if (retryAfter !== null && String(retryAfter).trim() !== "") {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, 15_000);
    }
    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) {
      return Math.min(Math.max(timestamp - Date.now(), 0), 15_000);
    }
  }
  return attempt === 1 ? 1_000 : 3_000;
}

async function defaultSleep(milliseconds) {
  await wait(milliseconds);
}

export async function requestPage({
  token,
  publisherId,
  advertiserIds,
  page,
  fetchImpl = globalThis.fetch,
  sleepImpl = defaultSleep,
  maxAttempts = MAX_ATTEMPTS
}) {
  const cleanToken = token.replace(/^Bearer\s+/i, "");
  const url = new URL(`https://api.awin.com/publisher/${publisherId}/promotions`);
  url.searchParams.set("accessToken", cleanToken);
  const body = JSON.stringify({
    filters: {
      advertiserIds,
      membership: "joined",
      status: "active",
      type: "all"
    },
    pagination: { page, pageSize: PAGE_SIZE }
  });
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(90_000),
        headers: {
          Authorization: `Bearer ${cleanToken}`,
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body
      });
    } catch (error) {
      lastError = new AwinOffersError("Offers API: error de red o tiempo de espera", {
        retryable: true,
        cause: error
      });
      if (attempt < maxAttempts) {
        await sleepImpl(attempt === 1 ? 1_000 : 3_000);
        continue;
      }
      throw lastError;
    }

    if (response.ok) {
      try {
        return await response.json();
      } catch (error) {
        lastError = new AwinOffersError("Offers API: respuesta JSON no válida", {
          status: response.status,
          retryable: true,
          cause: error
        });
        if (attempt < maxAttempts) {
          await sleepImpl(attempt === 1 ? 1_000 : 3_000);
          continue;
        }
        throw lastError;
      }
    }

    const retryable = retryableStatus(response.status);
    lastError = new AwinOffersError(
      `Offers API: respuesta HTTP ${response.status}`,
      { status: response.status, retryable }
    );
    await response.text().catch(() => "");
    if (!retryable || attempt >= maxAttempts) throw lastError;
    await sleepImpl(retryDelay(response, attempt));
  }

  throw lastError;
}

function hasNextPage(payload, page, itemCount) {
  const pagination = payload?.pagination || payload?.page || {};
  const totalPages = Number(pagination.totalPages || pagination.pageCount);
  if (Number.isFinite(totalPages)) return page < totalPages;
  const total = Number(pagination.total || pagination.totalCount);
  if (Number.isFinite(total)) return page * PAGE_SIZE < total;
  return itemCount === PAGE_SIZE;
}

function advertiserBatches(advertiserIds, batchSize = ADVERTISER_BATCH_SIZE) {
  const batches = [];
  for (let index = 0; index < advertiserIds.length; index += batchSize) {
    batches.push(advertiserIds.slice(index, index + batchSize));
  }
  return batches;
}

async function downloadBatch({
  token,
  publisherId,
  advertiserIds,
  requestPageImpl
}) {
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = await requestPageImpl({
      token,
      publisherId,
      advertiserIds,
      page
    });
    const pageItems = promotionItems(payload);
    items.push(...pageItems);
    if (!hasNextPage(payload, page, pageItems.length)) return items;
  }
  throw new AwinOffersError("Offers API: paginación incompleta", {
    retryable: true
  });
}

export async function downloadOfferBatches({
  token,
  publisherId,
  advertiserIds,
  batchSize = ADVERTISER_BATCH_SIZE,
  requestPageImpl = requestPage,
  onWarning = (message) => console.warn(message)
}) {
  const items = [];
  const heldAdvertiserIds = [];
  let completedBatches = 0;
  const batches = advertiserBatches(advertiserIds, batchSize);

  for (const batch of batches) {
    try {
      const batchItems = await downloadBatch({
        token,
        publisherId,
        advertiserIds: batch,
        requestPageImpl
      });
      items.push(...batchItems);
      completedBatches += 1;
    } catch (error) {
      if (!error?.retryable) throw error;
      heldAdvertiserIds.push(...batch.map(String));
      const status = error.status ? `HTTP ${error.status}` : error.message;
      onWarning(
        `::warning title=Awin Offers API::Se conservan las promociones anteriores ` +
        `de ${batch.length} anunciantes tras ${status}.`
      );
    }
  }

  return {
    items,
    heldAdvertiserIds,
    totalBatches: batches.length,
    completedBatches
  };
}

export function mergePromotionsWithHeld(fresh, previous, heldAdvertiserIds) {
  const held = new Set(heldAdvertiserIds.map(String));
  const merged = new Map(fresh.map((promotion) => [promotion.id, promotion]));
  for (const promotion of previous || []) {
    if (held.has(String(promotion.advertiserId)) && !merged.has(promotion.id)) {
      merged.set(promotion.id, promotion);
    }
  }
  return [...merged.values()];
}

function sortPromotions(promotions) {
  return promotions.sort((left, right) =>
    Number(Boolean(right.code)) - Number(Boolean(left.code)) ||
    left.merchantName.localeCompare(right.merchantName) ||
    left.id.localeCompare(right.id)
  );
}

function parseArgs(argv) {
  const options = { reportPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--report") {
      options.reportPath = argv[index + 1] || null;
      index += 1;
      continue;
    }
    throw new Error(`Argumento no reconocido: ${argv[index]}`);
  }
  return options;
}

async function writeGithubOutputs(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(
    process.env.GITHUB_OUTPUT,
    Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n",
    "utf8"
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const publisherId = String(process.env.AWIN_PUBLISHER_ID || "").trim();
  const token = String(process.env.AWIN_API_TOKEN || "").trim();
  if (!/^\d+$/.test(publisherId)) throw new Error("AWIN_PUBLISHER_ID no es válido");
  if (!token) throw new Error("Falta AWIN_API_TOKEN");

  const generatedAt = new Date().toISOString();
  const context = await repositoryContext();
  const advertiserIds = [...context.merchantsByAdvertiser.keys()].map(Number);
  const previous = await readJson(outputPath, { schemaVersion: 1, promotions: [] });
  const download = await downloadOfferBatches({
    token,
    publisherId,
    advertiserIds
  });
  const freshById = new Map(download.items
    .map((item) => normalizeAwinPromotion(item, {
      ...context,
      publisherId,
      generatedAt
    }))
    .filter(Boolean)
    .map((promotion) => [promotion.id, promotion]));
  const promotions = sortPromotions(mergePromotionsWithHeld(
    [...freshById.values()],
    previous.promotions,
    download.heldAdvertiserIds
  ));
  const next = {
    schemaVersion: 1,
    generatedAt,
    source: "Awin Offers API",
    promotions
  };
  const changed = !samePromotionContent(previous, next);
  if (changed) await atomicWriteJson(outputPath, next);
  const status = download.heldAdvertiserIds.length === 0
    ? "ok"
    : download.completedBatches === 0
      ? "stale"
      : "partial";
  const report = {
    schemaVersion: 1,
    generatedAt,
    publisherId,
    status,
    advertiserCount: advertiserIds.length,
    totalBatches: download.totalBatches,
    completedBatches: download.completedBatches,
    heldAdvertiserIds: download.heldAdvertiserIds,
    downloadedItems: download.items.length,
    promotionsCount: promotions.length,
    retainedPromotions: promotions.filter((promotion) =>
      download.heldAdvertiserIds.includes(String(promotion.advertiserId))
    ).length,
    changed
  };
  if (options.reportPath) {
    await atomicWriteJson(resolve(options.reportPath), report);
  }
  await writeGithubOutputs({
    promotions_changed: String(changed),
    promotions_count: String(promotions.length),
    promotions_status: status,
    promotions_held_advertisers: String(download.heldAdvertiserIds.length)
  });
  console.log(
    `Promociones Awin: ${promotions.length} vigentes y verificadas; ` +
    `${promotions.filter((promotion) => promotion.code).length} con código real; ` +
    `${changed ? "archivo actualizado" : "sin cambios"}; estado ${status}.`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[SecretShop/Awin Promos] ${error.message}`);
    process.exitCode = 1;
  });
}
