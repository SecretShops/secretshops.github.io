#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAmazonAffiliateUrl,
  extractAsin,
  parseCsv,
  splitList
} from "./lib/amazon-associates-core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const inputPath = resolve(root, option("--input", "data/sources/amazon-es-products.csv"));
const reportPath = resolve(root, option("--report", "data/catalog/import-reports/amazon-es-last.json"));
const dryRun = hasFlag("--dry-run");
const replaceAmazon = hasFlag("--replace-amazon");
const allowPartial = hasFlag("--allow-partial");

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

async function writeAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

function text(record, ...keys) {
  for (const key of keys) {
    const value = String(record[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function optionalNumber(value) {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!raw) return null;
  const number = Number(raw);
  return Number.isFinite(number) && number > 0 ? number : NaN;
}

function optionalBoolean(value, defaultValue = true) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["1", "true", "yes", "si", "sí", "active", "activo"].includes(raw)) return true;
  if (["0", "false", "no", "inactive", "inactivo"].includes(raw)) return false;
  return null;
}

function rootCategory(label, parentByLabel) {
  let current = label;
  const visited = new Set();
  while (parentByLabel.get(current)) {
    if (visited.has(current)) break;
    visited.add(current);
    current = parentByLabel.get(current);
  }
  return current;
}

function normalizeRecord(record, context) {
  const problems = [];
  const active = optionalBoolean(record.active, true);
  if (active === null) problems.push("active debe ser true/false, sí/no o 1/0");
  if (active === false) return { skipped: true, reason: "inactive" };

  const source = text(record, "asin", "url", "amazon_url", "asin_or_url", "source");
  const asin = extractAsin(source);
  if (!asin) problems.push("ASIN o URL de Amazon España inválido");

  const title = text(record, "title", "titulo");
  const brand = text(record, "brand", "marca");
  const category = text(record, "category", "categoria");
  const description = text(record, "description", "descripcion");
  const model = text(record, "model", "modelo") || null;
  const images = splitList(text(record, "image_urls", "images", "imagenes", "image_url", "imagen"));
  const extraCategories = splitList(text(record, "categories", "categorias"));
  const explicitDepartment = text(record, "department", "departamento");
  const price = optionalNumber(text(record, "price_snapshot", "price", "precio"));
  const checkedAt = text(record, "price_checked_at", "source_updated_at", "updated_at");
  const sourceUpdatedAt = checkedAt || context.generatedAt;

  if (!title) problems.push("title/titulo obligatorio");
  if (!brand) problems.push("brand/marca obligatorio");
  if (!category) problems.push("category/categoria obligatoria");
  if (description.length < 20) problems.push("description/descripcion debe tener al menos 20 caracteres");
  if (!images.length) problems.push("image_urls/imagenes obligatorio");
  if (images.some((url) => !/^https:\/\//i.test(url))) problems.push("todas las imágenes deben usar HTTPS");
  if (category && !context.categoryLabels.has(category)) problems.push(`categoría desconocida: ${category}`);
  for (const item of extraCategories) {
    if (!context.categoryLabels.has(item)) problems.push(`categoría adicional desconocida: ${item}`);
  }
  if (explicitDepartment && !context.categoryLabels.has(explicitDepartment)) {
    problems.push(`departamento desconocido: ${explicitDepartment}`);
  }
  if (Number.isNaN(price)) problems.push("price_snapshot/precio debe ser un número positivo");
  if (checkedAt && !Number.isFinite(Date.parse(checkedAt))) problems.push("price_checked_at debe ser una fecha ISO válida");
  if (price !== null && !checkedAt) problems.push("price_checked_at es obligatorio cuando se incluye price_snapshot");

  const availability = text(record, "availability", "disponibilidad") || "unknown";
  if (!["in_stock", "out_of_stock", "preorder", "unknown", "unavailable", "discontinued"].includes(availability)) {
    problems.push(`availability no válida: ${availability}`);
  }
  const condition = text(record, "condition", "condicion") || "new";
  if (!["new", "refurbished", "used", "second_chance"].includes(condition)) {
    problems.push(`condition no válida: ${condition}`);
  }

  if (problems.length) return { problems };

  const department = explicitDepartment || rootCategory(category, context.parentByLabel);
  const categories = [...new Set([department, category, ...extraCategories].filter(Boolean))];
  const productId = `asin-${asin}`;
  const offerId = `amazon-es:${asin}`;
  const affiliateUrl = buildAmazonAffiliateUrl(asin, context.merchant.associateTag);

  return {
    product: {
      id: productId,
      title,
      brand,
      model,
      department,
      category,
      categories,
      categoryPath: department === category ? [category] : [department, category],
      description,
      shortDescription: text(record, "short_description", "descripcion_corta"),
      identifiers: {
        asin,
        gtin: text(record, "gtin") || null,
        ean: text(record, "ean") || null,
        upc: text(record, "upc") || null,
        mpn: text(record, "mpn") || null
      },
      variant: {
        color: text(record, "color") || null,
        size: text(record, "size", "talla", "tamano", "tamaño") || null,
        capacity: text(record, "capacity", "capacidad") || null,
        configuration: text(record, "configuration", "configuracion") || null
      },
      condition,
      images,
      attributes: {
        merchantCategory: text(record, "merchant_category", "categoria_amazon") || null,
        productType: text(record, "product_type", "tipo_producto") || category,
        dimensions: text(record, "dimensions", "medidas") || null,
        specifications: text(record, "specifications", "especificaciones", "material") || null,
        warranty: text(record, "warranty", "garantia") || null,
        keywords: text(record, "keywords", "palabras_clave") || null,
        promotionalText: null
      },
      sourceMerchants: ["amazon-es"],
      sourceReferences: { "amazon-es": asin },
      sourceUpdatedAt
    },
    offer: {
      id: offerId,
      productId,
      merchantId: "amazon-es",
      merchantProductId: asin,
      country: "ES",
      currency: "EUR",
      price,
      previousPrice: null,
      shippingCost: null,
      totalPrice: price,
      availability,
      condition,
      affiliateUrl,
      landingUrl: `https://www.amazon.es/dp/${asin}`,
      commissionGroup: null,
      isCommissionable: true,
      stockQuantity: null,
      deliveryTime: null,
      displayPrice: price === null ? "Consultar precio en Amazon" : null,
      source: {
        network: "amazon-associates",
        asin,
        associateTag: context.merchant.associateTag,
        priceSnapshotAt: price === null ? null : sourceUpdatedAt
      },
      lastUpdatedAt: sourceUpdatedAt
    }
  };
}

const [input, productsPayload, offersPayload, merchantsPayload, taxonomyPayload] = await Promise.all([
  readFile(inputPath, "utf8"),
  readJson("data/catalog/products.json"),
  readJson("data/catalog/offers.json"),
  readJson("data/catalog/merchants.json"),
  readJson("data/catalog/category-taxonomy.json")
]);

const merchant = merchantsPayload.merchants.find((item) => item.id === "amazon-es");
if (!merchant || merchant.status !== "approved" || merchant.network !== "amazon-associates" || !merchant.associateTag) {
  throw new Error("Merchant amazon-es incompleto o no aprobado");
}

const generatedAt = new Date().toISOString();
const categoryLabels = new Set(taxonomyPayload.categories.map((item) => item.label));
const parentByLabel = new Map(taxonomyPayload.categories.map((item) => [item.label, item.parent]));
const records = parseCsv(input);
const accepted = [];
const rejected = [];
const skipped = [];
const seenAsins = new Set();

for (const record of records) {
  const normalized = normalizeRecord(record, {
    generatedAt,
    merchant,
    categoryLabels,
    parentByLabel
  });
  if (normalized.skipped) {
    skipped.push({ row: record.__row, reason: normalized.reason });
    continue;
  }
  if (normalized.problems) {
    rejected.push({ row: record.__row, problems: normalized.problems });
    continue;
  }
  const asin = normalized.product.identifiers.asin;
  if (seenAsins.has(asin)) {
    rejected.push({ row: record.__row, problems: [`ASIN duplicado en el CSV: ${asin}`] });
    continue;
  }
  seenAsins.add(asin);
  accepted.push(normalized);
}

const report = {
  schemaVersion: 1,
  generatedAt,
  input: inputPath,
  dryRun,
  replaceAmazon,
  rows: records.length,
  accepted: accepted.length,
  rejected: rejected.length,
  skipped: skipped.length,
  associateTag: merchant.associateTag,
  rejectedRows: rejected,
  skippedRows: skipped,
  importedAsins: accepted.map((item) => item.product.identifiers.asin)
};
await writeAtomic(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (rejected.length && !allowPartial) {
  console.error(JSON.stringify(report, null, 2));
  throw new Error("Importación cancelada: corrige las filas rechazadas o usa --allow-partial");
}

if (!dryRun) {
  const productById = new Map(
    productsPayload.products
      .filter((item) => !replaceAmazon || !item.sourceMerchants?.includes("amazon-es"))
      .map((item) => [item.id, item])
  );
  const offerById = new Map(
    offersPayload.offers
      .filter((item) => !replaceAmazon || item.merchantId !== "amazon-es")
      .map((item) => [item.id, item])
  );
  for (const item of accepted) {
    productById.set(item.product.id, item.product);
    offerById.set(item.offer.id, item.offer);
  }
  const nextProducts = {
    ...productsPayload,
    generatedAt,
    products: [...productById.values()].sort((left, right) => left.id.localeCompare(right.id))
  };
  const nextOffers = {
    ...offersPayload,
    generatedAt,
    offers: [...offerById.values()].sort((left, right) => left.id.localeCompare(right.id))
  };
  await Promise.all([
    writeAtomic(resolve(root, "data/catalog/products.json"), `${JSON.stringify(nextProducts)}\n`),
    writeAtomic(resolve(root, "data/catalog/offers.json"), `${JSON.stringify(nextOffers)}\n`)
  ]);
}

console.log(JSON.stringify(report, null, 2));
