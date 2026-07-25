#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAmazonAffiliateUrl } from "./lib/amazon-associates-core.mjs";
import { parseImpactAffiliateUrl } from "./lib/impact-affiliate-core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

async function writeJsonAtomic(path, value) {
  const output = resolve(root, path);
  const temporary = `${output}.tmp`;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value)}\n`, "utf8");
  await rename(temporary, output);
}

function collectOfferIds(payload) {
  return new Set(
    (payload.families || []).flatMap((family) =>
      (family.variants || []).flatMap((variant) =>
        (variant.offers || []).map((offer) => offer.id)
      )
    )
  );
}

function validateUrl(value, offerId, merchant, productSku = null) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`${offerId}: el enlace no usa HTTPS`);
  }

  const network = merchant?.network || (merchant?.awinAdvertiserId ? "awin" : null);
  if (network === "amazon-associates") {
    const valid = validateAmazonAffiliateUrl(url.href, merchant.associateTag);
    if (!valid) throw new Error(`${offerId}: enlace de Amazon o tag inválido`);
    return valid;
  }
  if (network === "impact") {
    const valid = parseImpactAffiliateUrl(url.href, {
      trackingHost: merchant.impactTrackingHost,
      publisherId: merchant.impactPublisherId,
      campaignId: merchant.impactCampaignId,
      creativeId: merchant.impactCreativeId,
      catalogSource: merchant.impactCatalogSource,
      productSku,
      landingDomains: merchant.landingDomains
    });
    if (!valid) throw new Error(`${offerId}: enlace de Impact inválido`);
    return valid.href;
  }

  const awin =
    /(^|\.)awin1\.com$/i.test(url.hostname) &&
    ["/pclick.php", "/cread.php"].includes(url.pathname);
  const aliexpress = /^s\.click\.aliexpress\.com$/i.test(url.hostname);
  if (!awin && !aliexpress) {
    throw new Error(`${offerId}: dominio de afiliación no permitido`);
  }
  if (awin && !["a", "p", "m"].every((key) => url.searchParams.get(key))) {
    throw new Error(`${offerId}: parámetros de seguimiento incompletos`);
  }
  return url.href;
}

const [
  families,
  spainAliExpressCatalog,
  mexicoCatalog,
  colombiaCatalog,
  offersPayload,
  spainAliExpressSource,
  mexicoSource,
  colombiaSource,
  curatedPayload,
  merchantsPayload,
  regionsPayload
] = await Promise.all([
  readJson("data/catalog/families.json"),
  readJson("data/catalog/aliexpress-es.json"),
  readJson("data/catalog/aliexpress-mx.json"),
  readJson("data/catalog/aliexpress-co.json"),
  readJson("data/catalog/offers.json"),
  readJson("data/aliexpress-es-source.json"),
  readJson("data/aliexpress-mx-source.json"),
  readJson("data/aliexpress-co-source.json"),
  readJson("data/sources/curated-products.json"),
  readJson("data/catalog/merchants.json"),
  readJson("data/config/regions.json")
]);

const merchants = new Map(
  merchantsPayload.merchants.map((merchant) => [merchant.id, merchant])
);
const referencedOfferIds = new Set([
  ...collectOfferIds(families),
  ...collectOfferIds(spainAliExpressCatalog),
  ...collectOfferIds(mexicoCatalog),
  ...collectOfferIds(colombiaCatalog)
]);
const candidates = new Map();

for (const offer of offersPayload.offers || []) {
  candidates.set(offer.id, {
    url: offer.affiliateUrl,
    merchantId: offer.merchantId,
    country: offer.country,
    merchantProductId: offer.merchantProductId
  });
}

for (const record of spainAliExpressSource) {
  candidates.set(`aliexpress-es:${record.product_id}`, {
    url: record.tracking_url,
    merchantId: "aliexpress",
    country: "ES"
  });
}

for (const record of mexicoSource) {
  candidates.set(`aliexpress-mx:${record.product_id}`, {
    url: record.tracking_url,
    merchantId: "aliexpress",
    country: "MX"
  });
}

for (const record of colombiaSource) {
  candidates.set(`aliexpress-co:${record.product_id}`, {
    url: record.tracking_url,
    merchantId: "aliexpress",
    country: "CO"
  });
}

for (const product of curatedPayload.products || []) {
  candidates.set(
    `aliexpress-${String(product.country).toLowerCase()}:${product.productId}`,
    {
      url: product.affiliateUrl,
      merchantId: "aliexpress",
      country: product.country
    }
  );
}

const links = {};
const missing = [];
for (const offerId of [...referencedOfferIds].sort()) {
  const candidate = candidates.get(offerId);
  if (!candidate) {
    missing.push(offerId);
    continue;
  }
  links[offerId] = {
    url: validateUrl(
      candidate.url,
      offerId,
      merchants.get(candidate.merchantId),
      candidate.merchantProductId
    ),
    merchantId: candidate.merchantId,
    country: candidate.country
  };
}

if (missing.length) {
  throw new Error(
    `Faltan ${missing.length} enlaces para ofertas publicadas: ${missing.slice(0, 5).join(", ")}`
  );
}

const entries = Object.values(links);
await writeJsonAtomic("data/catalog/affiliate-links.json", {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  links
});

const generatedAt = new Date().toISOString();
const regionsByCountry = new Map(
  regionsPayload.regions
    .filter((region) => region.catalogManifest && region.affiliateLinks)
    .map((region) => [region.countryCode, region])
);
const regionalLinks = new Map(
  [...regionsByCountry.values()].map((region) => [region.id, {}])
);

for (const [offerId, entry] of Object.entries(links)) {
  const region = regionsByCountry.get(String(entry.country || "").toUpperCase());
  if (!region) {
    throw new Error(`${offerId}: no existe una región configurada para ${entry.country}`);
  }
  regionalLinks.get(region.id)[offerId] = entry;
}

for (const region of regionsByCountry.values()) {
  const regionalPath = region.affiliateLinks.replace(/^\//, "");
  await writeJsonAtomic(regionalPath, {
    schemaVersion: 1,
    region: region.id,
    country: region.countryCode,
    generatedAt,
    links: regionalLinks.get(region.id)
  });
}

console.log(
  JSON.stringify(
    {
      publishedOfferLinks: Object.keys(links).length,
      awin: entries.filter((entry) => entry.url.includes("awin1.com")).length,
      aliexpress: entries.filter((entry) => entry.url.includes("aliexpress.com")).length,
      amazon: entries.filter((entry) => /(^|\.)amazon\.es$/i.test(new URL(entry.url).hostname)).length,
      impact: entries.filter((entry) => /\.pxf\.io$/i.test(new URL(entry.url).hostname)).length,
      regions: Object.fromEntries(
        [...regionalLinks.entries()].map(([regionId, values]) => [
          regionId,
          Object.keys(values).length
        ])
      )
    },
    null,
    2
  )
);
