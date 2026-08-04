#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const merchantId = "lounge-eu";
const generatedAt = "2026-08-04T14:00:00.000Z";
const holdConfig = {
  schemaVersion: 1,
  holds: [
    {
      merchantId,
      status: "temporarily-retired",
      regions: ["es"],
      preserveSources: true,
      preserveStaticPages: true,
      expectedPreservedProductPages: 1019,
      productHtmlMarkers: ["Lounge EU", "offer=lounge-eu%3A"],
      storeSlug: "lounge-eu"
    }
  ]
};

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
}

async function writeJson(relativePath, value) {
  const target = resolve(root, relativePath);
  const temporary = `${target}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

const [productsPayload, offersPayload] = await Promise.all([
  readJson("data/catalog/products.json"),
  readJson("data/catalog/offers.json")
]);

const loungeOffers = offersPayload.offers.filter((offer) => offer.merchantId === merchantId);
const offers = offersPayload.offers.filter((offer) => offer.merchantId !== merchantId);
const referencedProductIds = new Set(offers.map((offer) => offer.productId));
let productsDetached = 0;
let productsRemoved = 0;
const products = [];

for (const product of productsPayload.products) {
  if (!(product.sourceMerchants || []).includes(merchantId)) {
    if (referencedProductIds.has(product.id)) products.push(product);
    else productsRemoved += 1;
    continue;
  }
  const sourceMerchants = (product.sourceMerchants || []).filter((id) => id !== merchantId);
  const sourceReferences = { ...(product.sourceReferences || {}) };
  delete sourceReferences[merchantId];
  if (!referencedProductIds.has(product.id)) {
    productsRemoved += 1;
    continue;
  }
  productsDetached += 1;
  products.push({ ...product, sourceMerchants, sourceReferences });
}

products.sort((left, right) => String(left.id).localeCompare(String(right.id), "en"));
offers.sort((left, right) => String(left.id).localeCompare(String(right.id), "en"));
const report = {
  schemaVersion: 1,
  generatedAt,
  merchantId,
  mode: "temporary-publication-hold",
  reversibleFromPreservedSources: true,
  sourceFilesPreserved: true,
  removedOffers: loungeOffers.length,
  productsDetached,
  productsRemoved,
  productsRemaining: products.length,
  offersRemaining: offers.length
};

await Promise.all([
  writeJson("data/catalog/products.json", { schemaVersion: 1, generatedAt, products }),
  writeJson("data/catalog/offers.json", { schemaVersion: 1, generatedAt, offers }),
  writeJson("data/config/catalog-holds.json", holdConfig),
  writeJson("reports/lounge-eu-temporary-removal-2026-08-04.json", report)
]);

console.log(JSON.stringify(report, null, 2));
