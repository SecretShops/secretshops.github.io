#!/usr/bin/env node

import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { destinationAllowedForCountry } from "../assets/js/redirect.js";
import { validateAmazonAffiliateUrl } from "./lib/amazon-associates-core.mjs";
import { parseImpactAffiliateUrl } from "./lib/impact-affiliate-core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogDir = resolve(root, "data/catalog");
const outputPath = resolve(catalogDir, "affiliate-audit.json");

function localPath(publicPath) {
  const value = String(publicPath || "");
  if (!value.startsWith("/") || value.includes("..")) {
    throw new Error(`Ruta pública insegura: ${value}`);
  }
  const output = resolve(root, `.${value}`);
  if (output !== root && !output.startsWith(`${root}${sep}`)) {
    throw new Error(`Ruta fuera del repositorio: ${value}`);
  }
  return output;
}

async function readRootJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

async function readPublicJson(path) {
  return JSON.parse(await readFile(localPath(path), "utf8"));
}

function offerIds(payload) {
  return new Set(
    (payload.families || []).flatMap((family) =>
      (family.variants || []).flatMap((variant) =>
        (variant.offers || []).map((offer) => offer.id)
      )
    )
  );
}

function validateAwin(value, expectedAdvertiserId = null) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      /(^|\.)awin1\.com$/i.test(url.hostname) &&
      ["/pclick.php", "/cread.php"].includes(url.pathname) &&
      Boolean(url.searchParams.get("a")) &&
      Boolean(url.searchParams.get("p")) &&
      (!expectedAdvertiserId || url.searchParams.get("m") === String(expectedAdvertiserId))
    );
  } catch {
    return false;
  }
}

function validateAliExpress(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /^s\.click\.aliexpress\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

const [
  offersPayload,
  merchantsPayload,
  canonicalLinksPayload,
  families,
  spainAliExpress,
  mexico,
  colombia,
  regionsPayload
] = await Promise.all([
  readRootJson("data/catalog/offers.json"),
  readRootJson("data/catalog/merchants.json"),
  readRootJson("data/catalog/affiliate-links.json"),
  readRootJson("data/catalog/families.json"),
  readRootJson("data/catalog/aliexpress-es.json"),
  readRootJson("data/catalog/aliexpress-mx.json"),
  readRootJson("data/catalog/aliexpress-co.json"),
  readRootJson("data/config/regions.json")
]);

const merchants = new Map(
  merchantsPayload.merchants.map((merchant) => [merchant.id, merchant])
);
const canonicalOffers = new Map(
  offersPayload.offers.map((offer) => [offer.id, offer])
);
const findings = [];
const canonicalCounts = { awin: 0, amazon: 0, impact: 0 };
const validCanonicalCounts = { awin: 0, amazon: 0, impact: 0 };

for (const offer of offersPayload.offers) {
  const merchant = merchants.get(offer.merchantId);
  const network = merchant?.network ||
    (offer.source?.awinMerchantId || merchant?.awinAdvertiserId ? "awin" : null);
  if (network === "awin") {
    canonicalCounts.awin += 1;
    const expectedAdvertiserId = offer.source?.awinMerchantId || merchant?.awinAdvertiserId;
    if (validateAwin(offer.affiliateUrl, expectedAdvertiserId)) validCanonicalCounts.awin += 1;
    else findings.push({ offerId: offer.id, reason: "invalid_canonical_awin_link" });
  } else if (network === "amazon-associates") {
    canonicalCounts.amazon += 1;
    if (validateAmazonAffiliateUrl(offer.affiliateUrl, merchant?.associateTag)) {
      validCanonicalCounts.amazon += 1;
    } else {
      findings.push({ offerId: offer.id, reason: "invalid_canonical_amazon_link" });
    }
  } else if (network === "impact") {
    canonicalCounts.impact += 1;
    const valid = parseImpactAffiliateUrl(offer.affiliateUrl, {
      trackingHost: merchant.impactTrackingHost,
      publisherId: merchant.impactPublisherId,
      campaignId: merchant.impactCampaignId,
      creativeId: merchant.impactCreativeId,
      catalogSource: merchant.impactCatalogSource,
      productSku: offer.merchantProductId,
      landingDomains: merchant.landingDomains
    });
    if (valid) validCanonicalCounts.impact += 1;
    else findings.push({ offerId: offer.id, reason: "invalid_canonical_impact_link" });
  } else {
    findings.push({ offerId: offer.id, reason: "unknown_canonical_network" });
  }
}

const canonicalPublishedIds = new Set([
  ...offerIds(families),
  ...offerIds(spainAliExpress),
  ...offerIds(mexico),
  ...offerIds(colombia)
]);
const canonicalLinkEntries = Object.entries(canonicalLinksPayload.links || {});

for (const id of canonicalPublishedIds) {
  if (!canonicalLinksPayload.links?.[id]) {
    findings.push({ offerId: id, reason: "canonical_offer_without_link" });
  }
}
for (const [id, entry] of canonicalLinkEntries) {
  if (!canonicalPublishedIds.has(id)) {
    findings.push({ offerId: id, reason: "orphan_canonical_link" });
    continue;
  }
  const merchant = merchants.get(entry.merchantId);
  const canonicalOffer = canonicalOffers.get(id);
  let valid = false;
  if (merchant?.network === "amazon-associates") {
    valid = Boolean(validateAmazonAffiliateUrl(entry.url, merchant.associateTag));
  } else if (merchant?.network === "impact") {
    valid = Boolean(parseImpactAffiliateUrl(entry.url, {
      trackingHost: merchant.impactTrackingHost,
      publisherId: merchant.impactPublisherId,
      campaignId: merchant.impactCampaignId,
      creativeId: merchant.impactCreativeId,
      catalogSource: merchant.impactCatalogSource,
      productSku: canonicalOffer?.merchantProductId,
      landingDomains: merchant.landingDomains
    }));
  } else {
    valid = validateAwin(entry.url, merchant?.awinAdvertiserId) || validateAliExpress(entry.url);
  }
  if (!valid) findings.push({ offerId: id, reason: "invalid_canonical_destination" });
}

const regionalSummary = {};
let regionalOfferAssignments = 0;
let regionalLinkAssignments = 0;

for (const region of regionsPayload.regions) {
  if (!region.catalogManifest || !region.affiliateLinks) continue;
  const manifest = await readPublicJson(region.catalogManifest);
  const referenced = new Set();
  for (const source of manifest.sources || []) {
    const payload = await readPublicJson(source.path);
    for (const id of offerIds(payload)) referenced.add(id);
  }
  const linksPayload = await readPublicJson(region.affiliateLinks);
  const linked = new Set(Object.keys(linksPayload.links || {}));
  regionalOfferAssignments += referenced.size;
  regionalLinkAssignments += linked.size;

  let invalid = 0;
  for (const id of referenced) {
    const entry = linksPayload.links?.[id];
    if (!entry) {
      invalid += 1;
      findings.push({ region: region.id, offerId: id, reason: "regional_offer_without_link" });
      continue;
    }
    if (String(entry.country || "").toUpperCase() !== region.countryCode) {
      invalid += 1;
      findings.push({ region: region.id, offerId: id, reason: "regional_link_wrong_country" });
      continue;
    }
    if (!destinationAllowedForCountry(entry.url, region.countryCode)) {
      invalid += 1;
      findings.push({ region: region.id, offerId: id, reason: "regional_destination_rejected" });
    }
  }
  for (const id of linked) {
    if (!referenced.has(id)) {
      invalid += 1;
      findings.push({ region: region.id, offerId: id, reason: "orphan_regional_link" });
    }
  }

  regionalSummary[region.id] = {
    status: region.status,
    country: region.countryCode,
    offers: referenced.size,
    links: linked.size,
    invalid
  };
}

const hostCount = (entries, pattern) => entries.filter(([, entry]) => {
  try {
    return pattern.test(new URL(entry.url).hostname);
  } catch {
    return false;
  }
}).length;

const report = {
  schemaVersion: 4,
  generatedAt: new Date().toISOString(),
  summary: {
    canonicalOffers: offersPayload.offers.length,
    canonicalByNetwork: canonicalCounts,
    validCanonicalByNetwork: validCanonicalCounts,
    canonicalPublishedOffers: canonicalPublishedIds.size,
    canonicalPublishedLinks: canonicalLinkEntries.length,
    regionalOfferAssignments,
    regionalLinkAssignments,
    awinCanonicalLinks: hostCount(canonicalLinkEntries, /(^|\.)awin1\.com$/i),
    aliexpressCanonicalLinks: hostCount(canonicalLinkEntries, /^s\.click\.aliexpress\.com$/i),
    amazonCanonicalLinks: hostCount(canonicalLinkEntries, /(^|\.)amazon\.es$/i),
    impactCanonicalLinks: hostCount(canonicalLinkEntries, /\.(?:pxf|sjv)\.io$/i),
    findings: findings.length,
    allOffersTracked: findings.length === 0
  },
  regions: regionalSummary,
  findings
};

const temporary = `${outputPath}.tmp`;
await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await rename(temporary, outputPath);

console.log(
  `Auditoría de afiliación: ${report.summary.canonicalPublishedLinks}/${report.summary.canonicalPublishedOffers} enlaces canónicos y ${regionalLinkAssignments}/${regionalOfferAssignments} asignaciones regionales; ${findings.length} incidencias.`
);

if (findings.length > 0) process.exitCode = 1;
