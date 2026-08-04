#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedAt = "2026-08-04T14:00:00.000Z";
const sourcePrefix = "awin-v5-";
const merchantIds = ["voghion-global-es", "al-jazeera-perfumes-eu", "foot-store-es", "gigasport-es"];
const regionalLimit = 120;

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
}

async function writeJson(relativePath, value) {
  const target = resolve(root, relativePath);
  const temporary = `${target}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value)}\n`, "utf8");
  await rename(temporary, target);
}

function familyOffers(family) {
  return (family.variants || []).flatMap((variant) => variant.offers || []);
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function balancedSelection(families, limit, seed) {
  const queues = new Map();
  for (const family of families) {
    const category = family.category || family.categories?.[0] || "Otros";
    if (!queues.has(category)) queues.set(category, []);
    queues.get(category).push({ family, rank: hash(`${seed}|${family.id}`) });
  }
  for (const queue of queues.values()) queue.sort((left, right) => left.rank.localeCompare(right.rank));
  const categories = [...queues.keys()].sort((left, right) => left.localeCompare(right, "es"));
  const selected = [];
  while (selected.length < limit) {
    let added = false;
    for (const category of categories) {
      const item = queues.get(category).shift();
      if (!item) continue;
      selected.push(item.family);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
  }
  return selected;
}

function cloneFamily(family, merchantId, country) {
  const variants = (family.variants || []).map((variant) => {
    const offers = (variant.offers || [])
      .filter((offer) => offer.merchantId === merchantId)
      .map((offer) => ({ ...offer, country, currency: "EUR" }));
    return offers.length ? { ...variant, offers } : null;
  }).filter(Boolean);
  const offers = variants.flatMap((variant) => variant.offers);
  const prices = offers.map((offer) => Number(offer.price)).filter((price) => Number.isFinite(price) && price >= 0);
  return {
    ...family,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    variantCount: variants.length,
    variants
  };
}

const [familiesPayload, offersPayload, merchantsPayload, regionsPayload] = await Promise.all([
  readJson("data/catalog/families.json"),
  readJson("data/catalog/offers.json"),
  readJson("data/catalog/merchants.json"),
  readJson("data/config/regions.json")
]);
const offersById = new Map(offersPayload.offers.map((offer) => [offer.id, offer]));
const merchants = new Map(merchantsPayload.merchants.map((merchant) => [merchant.id, merchant]));
const familiesByMerchant = new Map();

for (const merchantId of merchantIds) {
  const merchant = merchants.get(merchantId);
  if (!merchant || merchant.status !== "approved") throw new Error(`${merchantId}: merchant no aprobado`);
  const families = familiesPayload.families.filter((family) => familyOffers(family).some((offer) => offer.merchantId === merchantId));
  if (!families.length) throw new Error(`${merchantId}: no hay familias publicables`);
  familiesByMerchant.set(merchantId, families);
}

const report = {
  schemaVersion: 1,
  generatedAt,
  mode: "published_regions_currency_matched",
  regionalSelectionLimitPerMerchant: regionalLimit,
  currencyRule: "EUR feeds are published only in published EUR regions; no currency conversion.",
  merchants: {},
  regions: {}
};
for (const merchantId of merchantIds) {
  const merchant = merchants.get(merchantId);
  report.merchants[merchantId] = {
    name: merchant.name,
    rootFamilies: familiesByMerchant.get(merchantId).length,
    allowedCountries: merchant.countries,
    shippingEvidence: merchant.shippingEvidence
  };
}

for (const region of regionsPayload.regions) {
  if (region.status !== "published" || region.currency !== "EUR" || !region.catalogManifest || !region.affiliateLinks) continue;
  const manifestPath = region.catalogManifest.replace(/^\//, "");
  const linksPath = region.affiliateLinks.replace(/^\//, "");
  const [manifest, linkPayload] = await Promise.all([readJson(manifestPath), readJson(linksPath)]);
  manifest.sources = (manifest.sources || []).filter((source) => !String(source.id || "").startsWith(sourcePrefix));
  const links = Object.fromEntries(Object.entries(linkPayload.links || {}).filter(([, entry]) => !merchantIds.includes(entry.merchantId)));
  const regionReport = { families: 0, offers: 0, merchants: {} };

  for (const merchantId of merchantIds) {
    const merchant = merchants.get(merchantId);
    if (region.countryCode === "ES") {
      const families = familiesByMerchant.get(merchantId);
      let offerCount = 0;
      for (const family of families) {
        for (const offer of familyOffers(family).filter((entry) => entry.merchantId === merchantId)) {
          const canonical = offersById.get(offer.id);
          if (!canonical?.affiliateUrl) throw new Error(`es/${offer.id}: falta enlace canónico`);
          links[offer.id] = { url: canonical.affiliateUrl, merchantId, country: "ES" };
          offerCount += 1;
        }
      }
      regionReport.merchants[merchantId] = {
        families: families.length,
        offers: offerCount,
        source: "canonical-es"
      };
      regionReport.families += families.length;
      regionReport.offers += offerCount;
      continue;
    }
    if (!(merchant.countries || []).includes(region.countryCode)) continue;
    const selected = balancedSelection(familiesByMerchant.get(merchantId), regionalLimit, merchantId);
    const clonedFamilies = selected.map((family) => cloneFamily(family, merchantId, region.countryCode));
    const sourcePath = `data/catalog/${region.id}/awin-v5-${merchantId}.json`;
    await writeJson(sourcePath, {
      schemaVersion: 3,
      generatedAt,
      country: region.countryCode,
      currency: region.currency,
      families: clonedFamilies
    });
    manifest.sources.push({
      id: `${sourcePrefix}${merchantId}`,
      path: `/${sourcePath}`,
      country: region.countryCode,
      currency: region.currency,
      merchantId,
      merchantName: merchant.name
    });
    let offerCount = 0;
    for (const family of clonedFamilies) {
      for (const offer of familyOffers(family)) {
        const canonical = offersById.get(offer.id);
        if (!canonical?.affiliateUrl) throw new Error(`${region.id}/${offer.id}: falta enlace canónico`);
        links[offer.id] = { url: canonical.affiliateUrl, merchantId, country: region.countryCode };
        offerCount += 1;
      }
    }
    regionReport.merchants[merchantId] = { families: clonedFamilies.length, offers: offerCount, source: `/${sourcePath}` };
    regionReport.families += clonedFamilies.length;
    regionReport.offers += offerCount;
  }

  await Promise.all([
    writeJson(manifestPath, manifest),
    writeJson(linksPath, { ...linkPayload, generatedAt, links })
  ]);
  report.regions[region.id] = regionReport;
}

await writeJson("reports/v5-repair-catalogs-2026-08-04.json", report);
console.log(JSON.stringify(report, null, 2));
