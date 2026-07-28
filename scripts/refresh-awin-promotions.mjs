#!/usr/bin/env node

import { appendFile, readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteJson } from "./lib/awin-feed-utils.mjs";
import {
  normalizeAwinPromotion,
  promotionItems,
  samePromotionContent
} from "./lib/awin-promotions-core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "data/promotions/awin.json");

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
    regionsById: new Map(published.map((region) => [region.id, region])),
    regionCodes: [...new Set(published.map((region) => region.countryCode))].sort()
  };
}

async function requestPage({ token, publisherId, advertiserIds, regionCodes, page }) {
  const url = new URL(`https://api.awin.com/publisher/${publisherId}/promotions`);
  url.searchParams.set("accessToken", token.replace(/^Bearer\s+/i, ""));
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(90_000),
    headers: {
      Authorization: `Bearer ${token.replace(/^Bearer\s+/i, "")}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      filters: {
        advertiserIds,
        membership: "joined",
        regionCodes,
        status: "active",
        type: "all"
      },
      pagination: { page, pageSize: 200 }
    })
  });
  if (!response.ok) throw new Error(`Offers API: respuesta HTTP ${response.status}`);
  return response.json();
}

function hasNextPage(payload, page, itemCount) {
  const pagination = payload?.pagination || payload?.page || {};
  const totalPages = Number(pagination.totalPages || pagination.pageCount);
  if (Number.isFinite(totalPages)) return page < totalPages;
  const total = Number(pagination.total || pagination.totalCount);
  if (Number.isFinite(total)) return page * 200 < total;
  return itemCount === 200;
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
  const publisherId = String(process.env.AWIN_PUBLISHER_ID || "").trim();
  const token = String(process.env.AWIN_API_TOKEN || "").trim();
  if (!/^\d+$/.test(publisherId)) throw new Error("AWIN_PUBLISHER_ID no es válido");
  if (!token) throw new Error("Falta AWIN_API_TOKEN");

  const generatedAt = new Date().toISOString();
  const context = await repositoryContext();
  const advertiserIds = [...context.merchantsByAdvertiser.keys()].map(Number);
  const raw = [];
  for (let page = 1; page <= 100; page += 1) {
    const payload = await requestPage({
      token,
      publisherId,
      advertiserIds,
      regionCodes: context.regionCodes,
      page
    });
    const items = promotionItems(payload);
    raw.push(...items);
    if (!hasNextPage(payload, page, items.length)) break;
  }

  const promotions = raw
    .map((item) => normalizeAwinPromotion(item, {
      ...context,
      publisherId,
      generatedAt
    }))
    .filter(Boolean)
    .sort((left, right) =>
      Number(Boolean(right.code)) - Number(Boolean(left.code)) ||
      left.merchantName.localeCompare(right.merchantName) ||
      left.id.localeCompare(right.id)
    );
  const next = {
    schemaVersion: 1,
    generatedAt,
    source: "Awin Offers API",
    promotions
  };
  const previous = await readJson(outputPath, { schemaVersion: 1, promotions: [] });
  const changed = !samePromotionContent(previous, next);
  if (changed) await atomicWriteJson(outputPath, next);
  await writeGithubOutputs({
    promotions_changed: String(changed),
    promotions_count: String(promotions.length)
  });
  console.log(
    `Promociones Awin: ${promotions.length} vigentes y verificadas; ` +
    `${promotions.filter((promotion) => promotion.code).length} con código real; ` +
    `${changed ? "archivo actualizado" : "sin cambios"}.`
  );
}

main().catch((error) => {
  console.error(`[SecretShop/Awin Promos] ${error.message}`);
  process.exitCode = 1;
});
