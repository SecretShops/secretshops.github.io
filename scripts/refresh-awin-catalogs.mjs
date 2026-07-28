#!/usr/bin/env node

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  candidatesFromFeed,
  chooseCandidate,
  decodeMaybeGzip,
  parseFeedList,
  selectExistingCandidates,
  secureFeedUrl,
  sha256,
  updateAffiliateLinks,
  updateCanonicalOffers,
  updatePublicCatalog
} from "./lib/awin-api-refresh-core.mjs";
import { atomicWriteJson } from "./lib/awin-feed-utils.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const statePath = resolve(root, "data/catalog/import-reports/awin-api-state.json");

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function flag(name) {
  return process.argv.includes(name);
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

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function fetchResponse(url, options, label) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        redirect: "follow",
        signal: AbortSignal.timeout(180_000)
      });
      if (response.ok) return response;
      if (![429, 500, 502, 503, 504].includes(response.status)) {
        throw new Error(`${label}: respuesta HTTP ${response.status}`);
      }
      lastError = new Error(`${label}: respuesta temporal HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) await wait(attempt * 5_000);
  }
  throw new Error(`${label}: ${lastError?.message || "fallo de red"}`);
}

async function verifyPublisherToken(token, publisherId) {
  const response = await fetchResponse(
    "https://api.awin.com/accounts?type=publisher",
    {
      headers: {
        Authorization: `Bearer ${token.replace(/^Bearer\s+/i, "")}`,
        Accept: "application/json"
      }
    },
    "Verificación OAuth2"
  );
  const payload = await response.json();
  const accounts = Array.isArray(payload) ? payload : payload.accounts || [];
  if (!accounts.some((account) => String(account.accountId) === String(publisherId))) {
    throw new Error(`El OAuth2 no permite acceder al Publisher ID ${publisherId}`);
  }
}

async function downloadText(url, label) {
  const response = await fetchResponse(url, { headers: { Accept: "*/*" } }, label);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, text: decodeMaybeGzip(buffer) };
}

function feedIdsForMerchant(merchant) {
  return [
    ...(Array.isArray(merchant.feedIds) ? merchant.feedIds : []),
    ...(merchant.feedId ? [merchant.feedId] : [])
  ].map(String);
}

function isApprovedAwinMerchant(merchant) {
  const network = merchant.network || (merchant.awinAdvertiserId ? "awin" : "");
  return (
    network === "awin" &&
    merchant.status === "approved" &&
    merchant.awinAdvertiserId &&
    feedIdsForMerchant(merchant).length > 0 &&
    !String(merchant.publicationStatus || "").startsWith("held_")
  );
}

function collectOfferMerchantIds(payload, output = new Map()) {
  for (const family of payload.families || []) {
    for (const variant of family.variants || []) {
      for (const offer of variant.offers || []) {
        if (!offer.merchantId) continue;
        if (!output.has(offer.merchantId)) output.set(offer.merchantId, new Set());
        const prefix = `${offer.merchantId}:`;
        const productId = String(offer.id || "").startsWith(prefix)
          ? String(offer.id).slice(prefix.length)
          : "";
        if (productId) output.get(offer.merchantId).add(productId);
      }
    }
  }
  return output;
}

async function loadRepositoryCatalogs() {
  const [merchantsPayload, regionsPayload, offersPayload, state] = await Promise.all([
    readJson(resolve(root, "data/catalog/merchants.json")),
    readJson(resolve(root, "data/config/regions.json")),
    readJson(resolve(root, "data/catalog/offers.json")),
    readJson(statePath, { schemaVersion: 1, publisherId: null, updatedAt: null, feeds: {} })
  ]);

  const sourceFiles = new Map();
  const affiliateFiles = new Map();
  for (const region of regionsPayload.regions || []) {
    if (region.catalogManifest) {
      const manifest = await readJson(safeRepositoryPath(region.catalogManifest));
      for (const source of manifest.sources || []) {
        if (source.path === "/data/catalog/families.json" || sourceFiles.has(source.path)) continue;
        const path = safeRepositoryPath(source.path);
        const payload = await readJson(path);
        if (payload?.schemaVersion === 3 && Array.isArray(payload.families)) {
          sourceFiles.set(source.path, { path, payload });
        }
      }
    }
    if (region.affiliateLinks && !affiliateFiles.has(region.affiliateLinks)) {
      const path = safeRepositoryPath(region.affiliateLinks);
      affiliateFiles.set(region.affiliateLinks, { path, payload: await readJson(path) });
    }
  }

  const existingProducts = new Map();
  for (const offer of offersPayload.offers || []) {
    if (!offer.merchantId || !offer.merchantProductId) continue;
    if (!existingProducts.has(offer.merchantId)) {
      existingProducts.set(offer.merchantId, new Set());
    }
    existingProducts.get(offer.merchantId).add(String(offer.merchantProductId));
  }
  for (const { payload } of sourceFiles.values()) {
    collectOfferMerchantIds(payload, existingProducts);
  }

  const merchants = new Map(
    (merchantsPayload.merchants || []).map((merchant) => [merchant.id, merchant])
  );
  const targets = [...existingProducts.entries()]
    .map(([merchantId, productIds]) => {
      const merchant = merchants.get(merchantId);
      if (!merchant || !isApprovedAwinMerchant(merchant)) return null;
      const currencies = new Set(
        (offersPayload.offers || [])
          .filter((offer) => offer.merchantId === merchantId && offer.currency)
          .map((offer) => String(offer.currency).toUpperCase())
      );
      for (const { payload } of sourceFiles.values()) {
        for (const family of payload.families || []) {
          for (const variant of family.variants || []) {
            for (const offer of variant.offers || []) {
              if (offer.merchantId === merchantId && offer.currency) {
                currencies.add(String(offer.currency).toUpperCase());
              }
            }
          }
        }
      }
      if (merchant.currency) currencies.add(String(merchant.currency).toUpperCase());
      return {
        ...merchant,
        expectedCurrencies: currencies,
        existingProductIds: productIds,
        feedIds: feedIdsForMerchant(merchant)
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));

  if (!targets.length) throw new Error("No hay anunciantes Awin integrados para actualizar");
  return {
    offersPayload,
    sourceFiles,
    affiliateFiles,
    state,
    targets
  };
}

function mergeMatchedCounts(target, source) {
  for (const [merchantId, count] of source) {
    target.set(merchantId, (target.get(merchantId) || 0) + count);
  }
}

async function writeGithubOutputs(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  await appendFile(
    outputPath,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
    "utf8"
  );
}

async function main() {
  const generatedAt = new Date().toISOString();
  const reportPath = resolve(option("--report", resolve(root, "awin-api-last.json")));
  const force = flag("--force");
  const publisherId = String(process.env.AWIN_PUBLISHER_ID || "").trim();
  const token = String(process.env.AWIN_API_TOKEN || "").trim();
  const datafeedKey = String(process.env.AWIN_DATAFEED_API_KEY || "").trim();

  if (!/^\d+$/.test(publisherId)) throw new Error("AWIN_PUBLISHER_ID no es válido");
  if (!token) throw new Error("Falta AWIN_API_TOKEN");
  if (!datafeedKey) throw new Error("Falta AWIN_DATAFEED_API_KEY");

  await verifyPublisherToken(token, publisherId);
  const feedListUrl =
    `https://productdata.awin.com/datafeed/list/apikey/${encodeURIComponent(datafeedKey)}`;
  const feedListResponse = await downloadText(feedListUrl, "Listado de feeds Awin");
  const feedList = parseFeedList(feedListResponse.text);
  if (!feedList.length) throw new Error("El listado de feeds Awin está vacío o no es válido");

  const repository = await loadRepositoryCatalogs();
  const feedEntries = new Map(
    feedList.map((entry) => [`${entry.advertiserId}:${entry.feedId}`, entry])
  );
  const candidatesByMerchant = new Map();
  const nextState = structuredClone(repository.state);
  nextState.schemaVersion = 1;
  nextState.publisherId = publisherId;
  nextState.feeds ||= {};
  const feedReports = [];
  let stateChanged = false;

  for (const merchant of repository.targets) {
    const merchantCandidates = new Map();
    for (const feedId of merchant.feedIds) {
      const stateKey = `${merchant.awinAdvertiserId}:${feedId}`;
      const entry = feedEntries.get(stateKey);
      if (!entry) {
        feedReports.push({
          merchantId: merchant.id,
          advertiserId: String(merchant.awinAdvertiserId),
          feedId,
          status: "held_missing",
          reason: "El feed no aparece en el listado autorizado de la cuenta Awin.",
          existingProductsPreserved: true
        });
        continue;
      }

      const previousState = nextState.feeds[stateKey];
      if (
        !force &&
        entry.lastImported &&
        previousState?.lastImported === entry.lastImported
      ) {
        feedReports.push({
          merchantId: merchant.id,
          advertiserId: String(merchant.awinAdvertiserId),
          feedId,
          status: "unchanged",
          lastImported: entry.lastImported
        });
        continue;
      }

      try {
        const response = await downloadText(
          secureFeedUrl(entry.url),
          `${merchant.id}/feed-${feedId}`
        );
        const digest = sha256(response.buffer);
        if (!force && previousState?.sha256 === digest) {
          const nextFeedState = {
            ...previousState,
            lastImported: entry.lastImported,
            sha256: digest
          };
          if (JSON.stringify(nextFeedState) !== JSON.stringify(previousState)) {
            nextState.feeds[stateKey] = nextFeedState;
            stateChanged = true;
          }
          feedReports.push({
            merchantId: merchant.id,
            advertiserId: String(merchant.awinAdvertiserId),
            feedId,
            status: "same_content",
            lastImported: entry.lastImported
          });
          continue;
        }

        const parsed = candidatesFromFeed(
          response.text,
          merchant,
          publisherId,
          generatedAt
        );
        if (parsed.feedRows === 0 || parsed.acceptedRows === 0) {
          feedReports.push({
            merchantId: merchant.id,
            advertiserId: String(merchant.awinAdvertiserId),
            feedId,
            status: "held_invalid",
            reason: "El feed está vacío o no contiene filas válidas para este anunciante.",
            lastImported: entry.lastImported,
            feedRows: parsed.feedRows,
            acceptedRows: parsed.acceptedRows,
            existingProductsPreserved: true
          });
          continue;
        }

        const matchedCandidates = selectExistingCandidates(
          parsed.candidates,
          merchant.existingProductIds
        );
        const matchedProducts = matchedCandidates.size;
        if (matchedProducts === 0) {
          feedReports.push({
            merchantId: merchant.id,
            advertiserId: String(merchant.awinAdvertiserId),
            feedId,
            status: "held_unmatched",
            reason: "El feed no coincide con ningún producto publicado del anunciante.",
            lastImported: entry.lastImported,
            feedRows: parsed.feedRows,
            acceptedRows: parsed.acceptedRows,
            newProductsHeld: parsed.candidates.size,
            existingProductsPreserved: true
          });
          continue;
        }

        for (const [productId, candidate] of matchedCandidates) {
          merchantCandidates.set(
            productId,
            chooseCandidate(merchantCandidates.get(productId), candidate)
          );
        }
        nextState.feeds[stateKey] = {
          merchantId: merchant.id,
          advertiserId: String(merchant.awinAdvertiserId),
          feedId,
          lastImported: entry.lastImported,
          sha256: digest,
          feedRows: parsed.feedRows,
          acceptedRows: parsed.acceptedRows,
          matchedExistingProducts: matchedProducts,
          updatedAt: generatedAt
        };
        stateChanged = true;
        feedReports.push({
          merchantId: merchant.id,
          advertiserId: String(merchant.awinAdvertiserId),
          feedId,
          status: "downloaded",
          lastImported: entry.lastImported,
          feedRows: parsed.feedRows,
          acceptedRows: parsed.acceptedRows,
          matchedExistingProducts: matchedProducts,
          newProductsHeld: Math.max(0, parsed.candidates.size - matchedProducts)
        });
        await wait(750);
      } catch (error) {
        feedReports.push({
          merchantId: merchant.id,
          advertiserId: String(merchant.awinAdvertiserId),
          feedId,
          status: "held_error",
          reason: String(error?.message || "No se pudo procesar el feed.").slice(0, 300),
          lastImported: entry.lastImported,
          existingProductsPreserved: true
        });
      }
    }
    if (merchantCandidates.size > 0) {
      candidatesByMerchant.set(merchant.id, merchantCandidates);
    }
  }

  const matchedByMerchant = new Map();
  const canonicalResult = updateCanonicalOffers(
    repository.offersPayload,
    candidatesByMerchant,
    generatedAt
  );
  mergeMatchedCounts(matchedByMerchant, canonicalResult.matchedByMerchant);
  let catalogChanged = canonicalResult.changedOffers > 0;
  const sourceResults = [];
  for (const [publicPath, source] of repository.sourceFiles) {
    const result = updatePublicCatalog(source.payload, candidatesByMerchant, generatedAt);
    mergeMatchedCounts(matchedByMerchant, result.matchedByMerchant);
    if (result.changedOffers > 0) {
      source.payload = result.payload;
      catalogChanged = true;
    }
    sourceResults.push({ path: publicPath, changedOffers: result.changedOffers });
  }

  let changedLinks = 0;
  for (const source of repository.affiliateFiles.values()) {
    const result = updateAffiliateLinks(source.payload, candidatesByMerchant, generatedAt);
    if (result.changedLinks > 0) {
      source.payload = result.payload;
      changedLinks += result.changedLinks;
      catalogChanged = true;
    }
  }

  if (canonicalResult.changedOffers > 0) {
    await atomicWriteJson(
      resolve(root, "data/catalog/offers.json"),
      canonicalResult.payload
    );
  }
  for (const source of repository.sourceFiles.values()) {
    if (source.payload.generatedAt === generatedAt) {
      await atomicWriteJson(source.path, source.payload);
    }
  }
  for (const source of repository.affiliateFiles.values()) {
    if (source.payload.generatedAt === generatedAt) {
      await atomicWriteJson(source.path, source.payload);
    }
  }
  if (stateChanged) {
    nextState.updatedAt = generatedAt;
    await atomicWriteJson(statePath, nextState);
  }

  const report = {
    schemaVersion: 1,
    generatedAt,
    publisherId,
    mode: "existing_products_only",
    directMain: true,
    targetMerchants: repository.targets.map((merchant) => merchant.id),
    totals: {
      targetMerchants: repository.targets.length,
      downloadedFeeds: feedReports.filter((feed) => feed.status === "downloaded").length,
      unchangedFeeds: feedReports.filter((feed) =>
        ["unchanged", "same_content"].includes(feed.status)
      ).length,
      heldFeeds: feedReports.filter((feed) => feed.status.startsWith("held_")).length,
      canonicalOffersChanged: canonicalResult.changedOffers,
      publicOffersChanged: sourceResults.reduce(
        (sum, source) => sum + source.changedOffers,
        0
      ),
      affiliateLinksChanged: changedLinks,
      newProductsHeld: feedReports.reduce(
        (sum, feed) => sum + (feed.newProductsHeld || 0),
        0
      )
    },
    catalogChanged,
    stateChanged,
    feeds: feedReports,
    sources: sourceResults,
    safety: {
      newAdvertisersAdded: 0,
      newCountriesAdded: 0,
      productsDeleted: 0,
      unmatchedExistingProductsPreserved: true,
      invalidFeedDoesNotBlockOtherFeeds: true
    }
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await atomicWriteJson(reportPath, report);
  await writeGithubOutputs({
    catalog_changed: String(catalogChanged),
    state_changed: String(stateChanged),
    any_changed: String(catalogChanged || stateChanged)
  });
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`[SecretShop/Awin] ${error.message}`);
  process.exitCode = 1;
});
