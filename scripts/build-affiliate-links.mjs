#!/usr/bin/env node

import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { destinationAllowedForCountry } from "../assets/js/redirect.js";
import { validateAmazonAffiliateUrl } from "./lib/amazon-associates-core.mjs";
import { parseImpactOfferUrl } from "./lib/impact-affiliate-core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

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

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

async function readPublicJson(path) {
  return JSON.parse(await readFile(localPath(path), "utf8"));
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

function validateCanonicalUrl(value, offerId, merchant, productSku = null) {
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
    const valid = parseImpactOfferUrl(url.href, {
      trackingHost: merchant.impactTrackingHost,
      publisherId: merchant.impactPublisherId,
      campaignId: merchant.impactCampaignId,
      catalogSource: merchant.impactCatalogSource,
      productSku,
      landingDomains: merchant.landingDomains,
      allowDirectProductFallback: merchant.impactDirectProductFallback === true
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
const canonicalOfferIds = new Set([
  ...collectOfferIds(families),
  ...collectOfferIds(spainAliExpressCatalog),
  ...collectOfferIds(mexicoCatalog),
  ...collectOfferIds(colombiaCatalog)
]);
const canonicalCandidates = new Map();

for (const offer of offersPayload.offers || []) {
  canonicalCandidates.set(offer.id, {
    url: offer.affiliateUrl,
    merchantId: offer.merchantId,
    country: offer.country,
    merchantProductId: offer.merchantProductId
  });
}

for (const record of spainAliExpressSource) {
  canonicalCandidates.set(`aliexpress-es:${record.product_id}`, {
    url: record.tracking_url,
    merchantId: "aliexpress",
    country: "ES"
  });
}

for (const record of mexicoSource) {
  canonicalCandidates.set(`aliexpress-mx:${record.product_id}`, {
    url: record.tracking_url,
    merchantId: "aliexpress",
    country: "MX"
  });
}

for (const record of colombiaSource) {
  canonicalCandidates.set(`aliexpress-co:${record.product_id}`, {
    url: record.tracking_url,
    merchantId: "aliexpress",
    country: "CO"
  });
}

for (const product of curatedPayload.products || []) {
  canonicalCandidates.set(
    `aliexpress-${String(product.country).toLowerCase()}:${product.productId}`,
    {
      url: product.affiliateUrl,
      merchantId: "aliexpress",
      country: product.country
    }
  );
}

const canonicalLinks = {};
const missingCanonical = [];
for (const offerId of [...canonicalOfferIds].sort()) {
  const candidate = canonicalCandidates.get(offerId);
  if (!candidate) {
    missingCanonical.push(offerId);
    continue;
  }
  canonicalLinks[offerId] = {
    url: validateCanonicalUrl(
      candidate.url,
      offerId,
      merchants.get(candidate.merchantId),
      candidate.merchantProductId
    ),
    merchantId: candidate.merchantId,
    country: candidate.country
  };
}

if (missingCanonical.length) {
  throw new Error(
    `Faltan ${missingCanonical.length} enlaces canónicos: ${missingCanonical.slice(0, 5).join(", ")}`
  );
}

const generatedAt = new Date().toISOString();
const regionalPlans = [];
const regionalErrors = [];

for (const region of regionsPayload.regions) {
  if (!region.catalogManifest || !region.affiliateLinks) continue;

  const manifest = await readPublicJson(region.catalogManifest);
  const referencedOfferIds = new Set();
  for (const source of manifest.sources || []) {
    const payload = await readPublicJson(source.path);
    for (const offerId of collectOfferIds(payload)) referencedOfferIds.add(offerId);
  }

  const regionalFile = localPath(region.affiliateLinks);
  const existingPayload = await exists(regionalFile)
    ? JSON.parse(await readFile(regionalFile, "utf8"))
    : { links: {} };

  const candidates = new Map();
  for (const [offerId, entry] of Object.entries(existingPayload.links || {})) {
    if (String(entry.country || "").toUpperCase() === region.countryCode) {
      candidates.set(offerId, entry);
    }
  }
  // Las fuentes canónicas son regenerables y deben prevalecer sobre copias antiguas.
  for (const [offerId, entry] of Object.entries(canonicalLinks)) {
    if (String(entry.country || "").toUpperCase() === region.countryCode) {
      candidates.set(offerId, entry);
    }
  }

  const links = {};
  for (const offerId of [...referencedOfferIds].sort()) {
    const candidate = candidates.get(offerId);
    if (!candidate) {
      regionalErrors.push(`${region.id}: falta enlace para ${offerId}`);
      continue;
    }
    const safeUrl = destinationAllowedForCountry(candidate.url, region.countryCode);
    if (!safeUrl) {
      regionalErrors.push(`${region.id}/${offerId}: destino no permitido`);
      continue;
    }
    links[offerId] = {
      ...candidate,
      url: safeUrl,
      country: region.countryCode
    };
  }

  regionalPlans.push({
    region,
    referencedOfferIds,
    links
  });
}

if (regionalErrors.length) {
  throw new Error(
    `No se pueden generar los enlaces regionales (${regionalErrors.length} incidencias): ${regionalErrors.slice(0, 8).join("; ")}`
  );
}

await writeJsonAtomic("data/catalog/affiliate-links.json", {
  schemaVersion: 1,
  generatedAt,
  links: canonicalLinks
});

for (const { region, links } of regionalPlans) {
  await writeJsonAtomic(region.affiliateLinks.replace(/^\//, ""), {
    schemaVersion: 1,
    region: region.id,
    country: region.countryCode,
    generatedAt,
    links
  });
}

const canonicalEntries = Object.values(canonicalLinks);
console.log(
  JSON.stringify(
    {
      canonicalOfferLinks: Object.keys(canonicalLinks).length,
      awin: canonicalEntries.filter((entry) => entry.url.includes("awin1.com")).length,
      aliexpress: canonicalEntries.filter((entry) => entry.url.includes("aliexpress.com")).length,
      amazon: canonicalEntries.filter((entry) => /(^|\.)amazon\.es$/i.test(new URL(entry.url).hostname)).length,
      impact: canonicalEntries.filter((entry) => /\.(?:pxf|sjv)\.io$/i.test(new URL(entry.url).hostname)).length,
      regions: Object.fromEntries(
        regionalPlans.map(({ region, links }) => [region.id, Object.keys(links).length])
      )
    },
    null,
    2
  )
);
