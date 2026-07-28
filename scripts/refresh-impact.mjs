#!/usr/bin/env node

import { appendFile, readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  candidatesFromImpactItems,
  catalogItemQuery,
  impactCatalogs,
  impactItems,
  impactPromoCodes,
  impactPrograms,
  impactPromotions,
  mergeImpactPromotions,
  normalizeImpactProgram,
  normalizeImpactPromoCode,
  normalizeImpactPromotion,
  offerLookupKeys,
  parseConfiguredImpactUrl,
  sameImpactPromotionContent,
  targetForLink,
  updateImpactAffiliateLinks,
  updateImpactCanonicalOffers,
  updateImpactPublicCatalog,
  validateImpactSyncConfig
} from "./lib/impact-api-core.mjs";
import { atomicWriteJson, parseCsv } from "./lib/awin-feed-utils.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(root, "data/catalog/impact-sync-config.json");
const regionsPath = resolve(root, "data/config/regions.json");
const offersPath = resolve(root, "data/catalog/offers.json");
const statePath = resolve(root, "data/catalog/import-reports/impact-api-state.json");
const promotionsPath = resolve(root, "data/promotions/impact.json");
const PAGE_SIZE = 1_000;
const MAX_API_ITEMS = 20_000;
const MAX_ATTEMPTS = 3;

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function flag(name) {
  return process.argv.includes(name);
}

function clean(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return clean(value).toUpperCase();
}

function countValue(value) {
  const number = Number.parseInt(String(value ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(number) ? number : 0;
}

function safeRepositoryPath(publicOrRelativePath) {
  const value = clean(publicOrRelativePath);
  if (!value || value.includes("..")) {
    throw new Error(`Ruta de repositorio insegura: ${value}`);
  }
  const local = value.startsWith("/")
    ? resolve(root, `.${value}`)
    : resolve(root, value);
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

function retryableStatus(status) {
  return status === 429 || status >= 500;
}

function retryDelay(response, attempt) {
  const header = response?.headers?.get?.("retry-after");
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, 20_000);
  }
  return attempt * 2_000;
}

async function requestJson({
  accountSid,
  token,
  path,
  query = {},
  label
}) {
  const url = new URL(path, "https://api.impact.com");
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(180_000),
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${token}`).toString("base64")}`,
          Accept: "application/json",
          "IR-Version": "16"
        }
      });
    } catch (error) {
      lastError = new Error(`${label}: error de red o tiempo de espera`, {
        cause: error
      });
      if (attempt < MAX_ATTEMPTS) {
        await wait(attempt * 2_000);
        continue;
      }
      throw lastError;
    }
    if (response.ok) {
      try {
        return await response.json();
      } catch (error) {
        lastError = new Error(`${label}: respuesta JSON no válida`, {
          cause: error
        });
      }
    } else {
      await response.text().catch(() => "");
      lastError = new Error(`${label}: respuesta HTTP ${response.status}`);
      if (!retryableStatus(response.status)) throw lastError;
    }
    if (attempt < MAX_ATTEMPTS) {
      await wait(retryDelay(response, attempt));
    }
  }
  throw lastError;
}

async function downloadPages({
  accountSid,
  token,
  path,
  label,
  collection,
  query = {},
  expectedCount = null,
  maximumPages = 20
}) {
  const rows = [];
  for (let page = 1; page <= maximumPages; page += 1) {
    const payload = await requestJson({
      accountSid,
      token,
      path,
      query: {
        ...query,
        PageSize: PAGE_SIZE,
        Page: page
      },
      label: `${label}/página-${page}`
    });
    const pageRows = collection(payload);
    rows.push(...pageRows);
    if (
      pageRows.length < PAGE_SIZE ||
      (Number.isFinite(expectedCount) && rows.length >= expectedCount)
    ) {
      return rows;
    }
  }
  throw new Error(`${label}: la paginación superó el límite seguro`);
}

function batches(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

async function lookupIdsForLargeCatalog(target, existingProductIds) {
  if (!target.lookupFile) return [...existingProductIds];
  const text = await readFile(safeRepositoryPath(target.lookupFile), "utf8");
  const { records } = parseCsv(text);
  const ids = new Set();
  for (const row of records) {
    const id = clean(row[target.lookupIdColumn]);
    const parent = clean(row[target.lookupParentColumn]);
    if (!id || (parent && !existingProductIds.has(parent))) continue;
    ids.add(id);
  }
  return [...ids];
}

async function downloadCatalogItems({
  accountSid,
  token,
  target,
  catalog,
  existingProductIds,
  queryBatchSize
}) {
  const declaredCount = countValue(catalog.NumberOfItems);
  const path =
    `/Mediapartners/${encodeURIComponent(accountSid)}` +
    `/Catalogs/${encodeURIComponent(target.catalogId)}/Items`;

  if (Number.isFinite(declaredCount) && declaredCount > MAX_API_ITEMS) {
    const lookupIds = await lookupIdsForLargeCatalog(target, existingProductIds);
    if (!lookupIds.length) {
      throw new Error(
        "El catálogo supera 20.000 filas y no hay identificadores publicados para consultarlo"
      );
    }
    const rows = [];
    for (const [index, batch] of batches(lookupIds, queryBatchSize).entries()) {
      const pageRows = await downloadPages({
        accountSid,
        token,
        path,
        label: `${target.id}/lote-${index + 1}`,
        collection: impactItems,
        query: { Query: catalogItemQuery(batch) },
        maximumPages: 2
      });
      rows.push(...pageRows);
      if ((index + 1) % 10 === 0) await wait(250);
    }
    return {
      items: rows,
      mode: "targeted_existing_variants",
      requestedIds: lookupIds.length,
      declaredCount
    };
  }

  const rows = await downloadPages({
    accountSid,
    token,
    path,
    label: target.id,
    collection: impactItems,
    expectedCount: Number.isFinite(declaredCount) ? declaredCount : null,
    maximumPages: 20
  });
  return {
    items: rows,
    mode: "complete_api_catalog",
    requestedIds: null,
    declaredCount
  };
}

function addToMapSet(map, key, value) {
  if (!key || !value) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

function targetCandidatesForMerchant(config, merchantId, regionId = null) {
  return config.catalogs.filter((target) =>
    target.merchantId === merchantId &&
    (!regionId || target.regions.includes(regionId))
  );
}

function sourceTargetIds(source, config) {
  const sourceCatalog = clean(source?.catalogSource).replace(/^CATF_/, "");
  const sourceCampaign = clean(source?.campaignId);
  return config.catalogs
    .filter((target) =>
      (sourceCatalog && target.catalogId === sourceCatalog) ||
      (sourceCampaign && target.campaignId === sourceCampaign)
    )
    .map((target) => target.id);
}

async function repositoryContext(config, regionsPayload) {
  const [offersPayload, state, previousPromotions] = await Promise.all([
    readJson(offersPath),
    readJson(statePath, {
      schemaVersion: 1,
      publisherId: config.publisherId,
      updatedAt: null,
      catalogs: {}
    }),
    readJson(promotionsPath, {
      schemaVersion: 1,
      generatedAt: null,
      source: "Impact Partner API",
      promotions: []
    })
  ]);
  const regionsById = new Map(
    (regionsPayload.regions || []).map((region) => [region.id, region])
  );
  const targetsById = new Map(config.catalogs.map((target) => [target.id, target]));
  const sourceFiles = new Map();
  const affiliateFiles = new Map();
  for (const region of regionsPayload.regions || []) {
    if (region.catalogManifest) {
      const manifest = await readJson(safeRepositoryPath(region.catalogManifest));
      for (const source of manifest.sources || []) {
        if (sourceFiles.has(source.path)) continue;
        const path = safeRepositoryPath(source.path);
        const payload = await readJson(path);
        if (payload?.schemaVersion === 3 && Array.isArray(payload.families)) {
          sourceFiles.set(source.path, { path, payload });
        }
      }
    }
    if (region.affiliateLinks) {
      const path = safeRepositoryPath(region.affiliateLinks);
      affiliateFiles.set(region.id, {
        region,
        path,
        payload: await readJson(path)
      });
    }
  }

  const offerTargets = new Map();
  const linkByOffer = new Map();
  const existingProductIds = new Map(
    config.catalogs.map((target) => [target.id, new Set()])
  );
  const publishedOfferIds = new Map(
    config.catalogs.map((target) => [target.id, new Set()])
  );

  function identifyTargets(offerId, entry, regionId = null) {
    const ids = new Set(offerTargets.get(offerId) || []);
    const catalogId = clean(entry?.impactCatalogId);
    const campaignId = clean(entry?.impactCampaignId);
    for (const target of config.catalogs) {
      if (
        (catalogId && target.catalogId === catalogId) ||
        (campaignId && target.campaignId === campaignId)
      ) {
        ids.add(target.id);
      }
    }
    const parsed = targetForLink(entry?.url, config.catalogs, config.publisherId);
    if (parsed) ids.add(parsed.target.id);
    for (const targetId of sourceTargetIds(entry?.source, config)) ids.add(targetId);

    const merchantId = clean(entry?.merchantId);
    if (merchantId) {
      const choices = targetCandidatesForMerchant(config, merchantId, regionId);
      if (choices.length === 1) ids.add(choices[0].id);
    }
    return [...ids];
  }

  for (const [regionId, file] of affiliateFiles) {
    for (const [offerId, entry] of Object.entries(file.payload.links || {})) {
      if (!linkByOffer.has(offerId)) linkByOffer.set(offerId, entry.url);
      const targetIds = identifyTargets(offerId, entry, regionId);
      for (const targetId of targetIds) {
        addToMapSet(offerTargets, offerId, targetId);
        publishedOfferIds.get(targetId)?.add(offerId);
        for (const key of offerLookupKeys({ id: offerId }, entry.url)) {
          existingProductIds.get(targetId)?.add(key);
        }
      }
    }
  }

  for (const offer of offersPayload.offers || []) {
    const targetIds = new Set(identifyTargets(offer.id, offer));
    for (const targetId of sourceTargetIds(offer.source, config)) targetIds.add(targetId);
    const merchantChoices = targetCandidatesForMerchant(config, offer.merchantId);
    if (merchantChoices.length === 1) targetIds.add(merchantChoices[0].id);
    for (const targetId of targetIds) {
      addToMapSet(offerTargets, offer.id, targetId);
      publishedOfferIds.get(targetId)?.add(offer.id);
      for (const key of offerLookupKeys(offer, offer.affiliateUrl)) {
        existingProductIds.get(targetId)?.add(key);
      }
    }
  }

  for (const { payload } of sourceFiles.values()) {
    for (const family of payload.families || []) {
      for (const variant of family.variants || []) {
        for (const offer of variant.offers || []) {
          const targetIds = identifyTargets(offer.id, offer);
          for (const targetId of targetIds) {
            addToMapSet(offerTargets, offer.id, targetId);
            for (const key of offerLookupKeys(offer, linkByOffer.get(offer.id))) {
              existingProductIds.get(targetId)?.add(key);
            }
          }
        }
      }
    }
  }

  const targetsForOffer = (offerId, entry, regionId = null) => {
    const ids = new Set(offerTargets.get(offerId) || []);
    for (const id of identifyTargets(offerId, entry, regionId)) ids.add(id);
    return [...ids];
  };

  return {
    offersPayload,
    state,
    previousPromotions,
    regionsById,
    targetsById,
    sourceFiles,
    affiliateFiles,
    existingProductIds,
    publishedOfferIds,
    targetsForOffer,
    linkForOffer: (offerId) => linkByOffer.get(offerId) || null
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function writeGithubOutputs(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(
    process.env.GITHUB_OUTPUT,
    Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n",
    "utf8"
  );
}

async function refreshPromotions({
  accountSid,
  token,
  config,
  repository,
  programsByCampaign,
  generatedAt
}) {
  let promotionsPayload;
  let promoCodesPayload;
  const errors = [];
  try {
    promotionsPayload = await downloadPages({
      accountSid,
      token,
      path: `/Mediapartners/${encodeURIComponent(accountSid)}/Promotions`,
      label: "Promociones Impact",
      collection: impactPromotions,
      maximumPages: 20
    });
  } catch (error) {
    errors.push(clean(error.message).slice(0, 300));
  }
  try {
    promoCodesPayload = await downloadPages({
      accountSid,
      token,
      path: `/Mediapartners/${encodeURIComponent(accountSid)}/PromoCodes`,
      label: "Códigos Impact",
      collection: impactPromoCodes,
      maximumPages: 20
    });
  } catch (error) {
    errors.push(clean(error.message).slice(0, 300));
  }

  if (errors.length) {
    return {
      changed: false,
      status: "stale",
      promotions: repository.previousPromotions.promotions || [],
      downloadedPromotions: promotionsPayload?.length || 0,
      downloadedPromoCodes: promoCodesPayload?.length || 0,
      errors,
      previousPreserved: true
    };
  }

  const targetsByCampaign = new Map(
    config.catalogs.map((target) => [target.campaignId, target])
  );
  const targetsByAdvertiser = new Map();
  for (const target of config.catalogs) {
    const program = programsByCampaign.get(target.campaignId);
    if (!program?.advertiserId) continue;
    if (!targetsByAdvertiser.has(program.advertiserId)) {
      targetsByAdvertiser.set(program.advertiserId, []);
    }
    targetsByAdvertiser.get(program.advertiserId).push(target);
  }
  const context = {
    generatedAt,
    publisherId: config.publisherId,
    regionsById: repository.regionsById,
    programsByCampaign,
    targetsByCampaign,
    targetsByAdvertiser
  };
  const promotions = promotionsPayload.flatMap((raw) =>
    normalizeImpactPromotion(raw, context)
  );
  const promoCodes = promoCodesPayload
    .map((raw) => normalizeImpactPromoCode(raw, context))
    .filter(Boolean);
  const merged = mergeImpactPromotions(promotions, promoCodes);
  const next = {
    schemaVersion: 1,
    generatedAt,
    source: "Impact Partner API",
    promotions: merged
  };
  const changed = !sameImpactPromotionContent(repository.previousPromotions, next);
  if (changed) await atomicWriteJson(promotionsPath, next);
  return {
    changed,
    status: "ok",
    promotions: merged,
    downloadedPromotions: promotionsPayload.length,
    downloadedPromoCodes: promoCodesPayload.length,
    errors: [],
    previousPreserved: false
  };
}

async function main() {
  const accountSid = clean(process.env.IMPACT_ACCOUNT_SID);
  const token = clean(process.env.IMPACT_API_TOKEN);
  if (!accountSid) throw new Error("Falta IMPACT_ACCOUNT_SID");
  if (!token) throw new Error("Falta IMPACT_API_TOKEN");

  const generatedAt = new Date().toISOString();
  const reportPath = resolve(
    option("--report", resolve(root, "impact-api-last.json"))
  );
  const force = flag("--force");
  const [rawConfig, regionsPayload] = await Promise.all([
    readJson(configPath),
    readJson(regionsPath)
  ]);
  const config = validateImpactSyncConfig(rawConfig, regionsPayload);
  const repository = await repositoryContext(config, regionsPayload);

  const [programRows, catalogRows] = await Promise.all([
    downloadPages({
      accountSid,
      token,
      path: `/Mediapartners/${encodeURIComponent(accountSid)}/Campaigns`,
      label: "Programas Impact",
      collection: impactPrograms,
      maximumPages: 20
    }),
    downloadPages({
      accountSid,
      token,
      path: `/Mediapartners/${encodeURIComponent(accountSid)}/Catalogs`,
      label: "Catálogos Impact",
      collection: impactCatalogs,
      maximumPages: 20
    })
  ]);
  const programsByCampaign = new Map(
    programRows
      .map(normalizeImpactProgram)
      .filter((program) => program.campaignId)
      .map((program) => [program.campaignId, program])
  );
  const catalogsById = new Map(
    catalogRows
      .filter((catalog) => clean(catalog?.Id))
      .map((catalog) => [clean(catalog.Id), catalog])
  );
  const configuredCampaigns = new Set(
    config.catalogs.map((target) => target.campaignId)
  );
  const configuredCatalogs = new Set(
    config.catalogs.map((target) => target.catalogId)
  );

  const candidatesByTarget = new Map();
  const nextState = structuredClone(repository.state);
  nextState.schemaVersion = 1;
  nextState.publisherId = config.publisherId;
  nextState.catalogs ||= {};
  const catalogReports = [];
  let stateChanged = false;

  for (const target of config.catalogs) {
    const program = programsByCampaign.get(target.campaignId);
    const catalog = catalogsById.get(target.catalogId);
    const existingIds = repository.existingProductIds.get(target.id) || new Set();
    const publishedProducts =
      repository.publishedOfferIds.get(target.id)?.size || 0;
    const baseReport = {
      targetId: target.id,
      merchantId: target.merchantId,
      campaignId: target.campaignId,
      catalogId: target.catalogId,
      publishedProducts
    };
    if (!program) {
      catalogReports.push({
        ...baseReport,
        status: "held_missing_program",
        existingProductsPreserved: true
      });
      continue;
    }
    if (upper(program.contractStatus) !== "ACTIVE") {
      catalogReports.push({
        ...baseReport,
        status: "held_inactive_contract",
        contractStatus: program.contractStatus,
        existingProductsPreserved: true
      });
      continue;
    }
    if (!catalog || clean(catalog.CampaignId) !== target.campaignId) {
      catalogReports.push({
        ...baseReport,
        status: "held_missing_catalog",
        existingProductsPreserved: true
      });
      continue;
    }
    if (
      clean(catalog.Currency) &&
      !target.currencies.includes(upper(catalog.Currency))
    ) {
      catalogReports.push({
        ...baseReport,
        status: "held_wrong_currency",
        currency: clean(catalog.Currency),
        existingProductsPreserved: true
      });
      continue;
    }
    if (!publishedProducts || !existingIds.size) {
      catalogReports.push({
        ...baseReport,
        status: "held_no_published_products",
        dateLastUpdated: clean(catalog.DateLastUpdated) || null,
        numberOfItems: countValue(catalog.NumberOfItems),
        existingProductsPreserved: true
      });
      continue;
    }

    const previous = nextState.catalogs[target.id];
    const dateLastUpdated = clean(catalog.DateLastUpdated);
    if (
      !force &&
      dateLastUpdated &&
      previous?.catalogId === target.catalogId &&
      previous?.dateLastUpdated === dateLastUpdated &&
      previous?.allowsDeeplinking === program.allowsDeeplinking
    ) {
      catalogReports.push({
        ...baseReport,
        status: "unchanged",
        dateLastUpdated,
        numberOfItems: countValue(catalog.NumberOfItems),
        allowsDeeplinking: program.allowsDeeplinking
      });
      continue;
    }

    const directFallback =
      program.allowsDeeplinking === false &&
      target.directFallbackWhenDeeplinkingDisabled === true;
    if (
      program.allowsDeeplinking === false &&
      !target.directFallbackWhenDeeplinkingDisabled
    ) {
      catalogReports.push({
        ...baseReport,
        status: "held_deeplinking_disabled",
        existingProductsPreserved: true
      });
      continue;
    }

    try {
      const downloaded = await downloadCatalogItems({
        accountSid,
        token,
        target,
        catalog,
        existingProductIds: existingIds,
        queryBatchSize: config.queryBatchSize
      });
      const parsed = candidatesFromImpactItems({
        items: downloaded.items,
        target,
        publisherId: config.publisherId,
        existingProductIds: existingIds,
        generatedAt,
        directFallback,
        program
      });
      if (!parsed.candidates.size) {
        catalogReports.push({
          ...baseReport,
          status: "held_unmatched",
          downloadMode: downloaded.mode,
          apiRows: downloaded.items.length,
          acceptedRows: parsed.acceptedRows,
          existingProductsPreserved: true
        });
        continue;
      }
      candidatesByTarget.set(target.id, parsed.candidates);
      const nextCatalogState = {
        targetId: target.id,
        merchantId: target.merchantId,
        catalogId: target.catalogId,
        campaignId: target.campaignId,
        dateLastUpdated: dateLastUpdated || null,
        numberOfItems: downloaded.declaredCount,
        allowsDeeplinking: program.allowsDeeplinking,
        downloadMode: downloaded.mode,
        matchedExistingProducts: parsed.candidates.size,
        syncedAt: generatedAt
      };
      if (!sameJson(previous, nextCatalogState)) {
        nextState.catalogs[target.id] = nextCatalogState;
        stateChanged = true;
      }
      catalogReports.push({
        ...baseReport,
        status: directFallback ? "downloaded_direct_fallback" : "downloaded",
        dateLastUpdated: dateLastUpdated || null,
        numberOfItems: downloaded.declaredCount,
        allowsDeeplinking: program.allowsDeeplinking,
        downloadMode: downloaded.mode,
        requestedIds: downloaded.requestedIds,
        apiRows: downloaded.items.length,
        acceptedRows: parsed.acceptedRows,
        matchedRows: parsed.matchedRows,
        matchedExistingProducts: parsed.candidates.size,
        newProductsHeld:
          downloaded.mode === "complete_api_catalog"
            ? parsed.unmatchedRows
            : "not_enumerated",
        directProductFallback: directFallback
      });
    } catch (error) {
      catalogReports.push({
        ...baseReport,
        status: "held_error",
        reason: clean(error?.message || "No se pudo procesar el catálogo").slice(0, 300),
        existingProductsPreserved: true
      });
    }
  }

  const canonicalResult = updateImpactCanonicalOffers({
    payload: repository.offersPayload,
    targetsForOffer: repository.targetsForOffer,
    candidatesByTarget,
    generatedAt
  });
  let catalogChanged = canonicalResult.changedOffers > 0;
  if (canonicalResult.changedOffers) {
    await atomicWriteJson(offersPath, canonicalResult.payload);
  }

  const sourceReports = [];
  for (const [publicPath, source] of repository.sourceFiles) {
    const result = updateImpactPublicCatalog({
      payload: source.payload,
      targetsForOffer: repository.targetsForOffer,
      candidatesByTarget,
      linkForOffer: repository.linkForOffer,
      generatedAt
    });
    sourceReports.push({ path: publicPath, changedOffers: result.changedOffers });
    if (!result.changedOffers) continue;
    catalogChanged = true;
    source.payload = result.payload;
    await atomicWriteJson(source.path, result.payload);
  }

  let changedLinks = 0;
  for (const [regionId, source] of repository.affiliateFiles) {
    const result = updateImpactAffiliateLinks({
      payload: source.payload,
      regionId,
      targetsForOffer: repository.targetsForOffer,
      candidatesByTarget,
      targetsById: repository.targetsById,
      generatedAt
    });
    if (!result.changedLinks) continue;
    changedLinks += result.changedLinks;
    catalogChanged = true;
    source.payload = result.payload;
    await atomicWriteJson(source.path, result.payload);
  }

  if (stateChanged) {
    nextState.updatedAt = generatedAt;
    await atomicWriteJson(statePath, nextState);
  }

  const promotionsReport = await refreshPromotions({
    accountSid,
    token,
    config,
    repository,
    programsByCampaign,
    generatedAt
  });
  const unconfiguredPrograms = [...programsByCampaign.values()]
    .filter((program) => !configuredCampaigns.has(program.campaignId))
    .map((program) => ({
      campaignId: program.campaignId,
      advertiserName: program.advertiserName,
      campaignName: program.campaignName,
      contractStatus: program.contractStatus
    }));
  const unconfiguredCatalogs = catalogRows
    .filter((catalog) => !configuredCatalogs.has(clean(catalog.Id)))
    .map((catalog) => ({
      catalogId: clean(catalog.Id),
      campaignId: clean(catalog.CampaignId),
      advertiserName: clean(catalog.AdvertiserName),
      name: clean(catalog.Name),
      currency: clean(catalog.Currency),
      numberOfItems: countValue(catalog.NumberOfItems),
      dateLastUpdated: clean(catalog.DateLastUpdated) || null
    }));
  const report = {
    schemaVersion: 1,
    generatedAt,
    publisherId: config.publisherId,
    mode: config.mode,
    force,
    totals: {
      configuredCatalogs: config.catalogs.length,
      downloadedCatalogs: catalogReports.filter((entry) =>
        entry.status.startsWith("downloaded")
      ).length,
      unchangedCatalogs: catalogReports.filter((entry) =>
        entry.status === "unchanged"
      ).length,
      heldCatalogs: catalogReports.filter((entry) =>
        entry.status.startsWith("held_")
      ).length,
      canonicalOffersChanged: canonicalResult.changedOffers,
      publicOffersChanged: sourceReports.reduce(
        (sum, source) => sum + source.changedOffers,
        0
      ),
      affiliateLinksChanged: changedLinks,
      directFallbackCatalogs: catalogReports.filter(
        (entry) => entry.directProductFallback
      ).length,
      promotions: promotionsReport.promotions.length,
      promotionCodes: promotionsReport.promotions.filter(
        (promotion) => promotion.code
      ).length,
      unconfiguredPrograms: unconfiguredPrograms.length,
      unconfiguredCatalogs: unconfiguredCatalogs.length
    },
    catalogChanged,
    stateChanged,
    promotionsChanged: promotionsReport.changed,
    catalogs: catalogReports,
    sources: sourceReports,
    promotions: promotionsReport,
    discovery: {
      unconfiguredPrograms,
      unconfiguredCatalogs
    },
    safety: {
      productsAdded: 0,
      productsDeleted: 0,
      filesDeleted: 0,
      regionsAdded: 0,
      regionsPublishedByApiStep: 0,
      unmatchedExistingProductsPreserved: true,
      newProductsHeldForReview: true,
      unconfiguredProgramsHeldForReview: true,
      ftpCredentialsPersisted: false
    }
  };
  await atomicWriteJson(reportPath, report);
  await writeGithubOutputs({
    catalog_changed: String(catalogChanged),
    state_changed: String(stateChanged),
    promotions_changed: String(promotionsReport.changed),
    promotions_status: promotionsReport.status,
    any_changed: String(
      catalogChanged || stateChanged || promotionsReport.changed
    )
  });
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`[SecretShop/Impact] ${clean(error?.message || error)}`);
  process.exitCode = 1;
});
