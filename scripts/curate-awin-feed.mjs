#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { gzipSync, createGunzip } from "node:zlib";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCandidate } from "./lib/awin-catalog-core.mjs";
import { readAwinFeed } from "./lib/awin-feed-utils.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = { input: null, merchantId: null, output: null, report: null, limit: null, selectedFrom: null, variantsPerFamily: 6 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--") && !options.input) options.input = resolve(value);
    else if (value === "--merchant") options.merchantId = argv[++index];
    else if (value === "--output") options.output = resolve(argv[++index]);
    else if (value === "--report") options.report = resolve(argv[++index]);
    else if (value === "--limit") options.limit = Number.parseInt(argv[++index], 10);
    else if (value === "--selected-from") options.selectedFrom = resolve(argv[++index]);
    else if (value === "--variants-per-family") options.variantsPerFamily = Number.parseInt(argv[++index], 10);
    else throw new Error(`Argumento no reconocido: ${value}`);
  }
  if (!options.input || !options.merchantId || !options.output || !options.report) {
    throw new Error("Uso: curate-awin-feed.mjs <feed.csv.gz> --merchant <id> --output <csv.gz> --report <json> [--limit 120 | --selected-from <csv.gz>]");
  }
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) throw new Error("--limit debe ser positivo");
  if (!Number.isInteger(options.variantsPerFamily) || options.variantsPerFamily < 1) throw new Error("--variants-per-family debe ser positivo");
  return options;
}

function csvField(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function increment(object, key) {
  object[key] = (object[key] || 0) + 1;
}

function field(record, ...names) {
  for (const name of names) {
    const value = String(record[name] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function familyKey(record, candidate) {
  const parent = field(record, "parent_product_id");
  if (parent) return `parent:${parent}`;
  const model = field(record, "product_model", "model_number");
  const brand = field(record, "brand_name", "brand");
  if (model) return `model:${brand.toLowerCase()}|${model.toLowerCase()}`;
  const landing = field(record, "merchant_deep_link", "product_url", "landing_url");
  if (landing) {
    try {
      const url = new URL(landing);
      return `url:${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
    } catch {}
  }
  return `product:${candidate.product.id}`;
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
}

async function atomicWrite(path, bytes) {
  const temporary = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, bytes);
  await rename(temporary, path);
}

async function forEachCsvRow(path, onHeaders, onRecord) {
  let headers = null;
  let row = [];
  let fieldValue = "";
  let quoted = false;
  let pendingQuote = false;
  let rowNumber = 0;

  function finishRow() {
    row.push(fieldValue.replace(/\r$/, ""));
    fieldValue = "";
    rowNumber += 1;
    if (!headers) {
      headers = row.map((value) => value.replace(/^\uFEFF/, "").trim());
      onHeaders(headers);
    } else if (!(row.length === 1 && row[0] === "")) {
      const record = { __rowNumber: rowNumber };
      for (let index = 0; index < headers.length; index += 1) record[headers[index]] = row[index] ?? "";
      onRecord(record, row);
    }
    row = [];
  }

  function consume(text) {
    let index = 0;
    if (pendingQuote) {
      pendingQuote = false;
      if (text[0] === '"') {
        fieldValue += '"';
        index = 1;
      } else {
        quoted = false;
      }
    }
    for (; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (character === '"') {
          if (index === text.length - 1) {
            pendingQuote = true;
          } else if (text[index + 1] === '"') {
            fieldValue += '"';
            index += 1;
          } else {
            quoted = false;
          }
        } else {
          fieldValue += character;
        }
      } else if (character === '"' && fieldValue.length === 0) {
        quoted = true;
      } else if (character === ",") {
        row.push(fieldValue);
        fieldValue = "";
      } else if (character === "\n") {
        finishRow();
      } else {
        fieldValue += character;
      }
    }
  }

  const stream = createReadStream(path).pipe(createGunzip());
  stream.setEncoding("utf8");
  for await (const chunk of stream) consume(chunk);
  if (pendingQuote) {
    quoted = false;
    pendingQuote = false;
  }
  if (quoted) throw new Error(`${basename(path)}: comillas sin cerrar`);
  if (fieldValue.length || row.length) finishRow();
  return headers;
}

const options = parseArgs(process.argv.slice(2));
const [merchantsPayload, profilesPayload, taxonomy] = await Promise.all([
  readJson("data/catalog/merchants.json"),
  readJson("data/catalog/awin-import-profiles.json"),
  readJson("data/catalog/category-taxonomy.json")
]);
const merchant = merchantsPayload.merchants.find((item) => item.id === options.merchantId);
if (!merchant) throw new Error(`Merchant no configurado: ${options.merchantId}`);
const profile = {
  ...profilesPayload.default,
  ...(profilesPayload.merchants?.[merchant.id] || {}),
  country: profilesPayload.merchants?.[merchant.id]?.country || merchant.country,
  currency: profilesPayload.merchants?.[merchant.id]?.currency || merchant.currency
};

let selectedOfferIds = null;
if (options.selectedFrom) {
  const reference = await readAwinFeed(options.selectedFrom);
  selectedOfferIds = new Set(reference.records.map((record) => field(record, "merchant_product_id", "merchant_sku", "sku")).filter(Boolean));
}

const generatedAt = "2026-08-04T14:00:00.000Z";
const stats = {
  schemaVersion: 1,
  generatedAt,
  sourceFile: basename(options.input),
  merchantId: merchant.id,
  advertiserId: String(merchant.awinAdvertiserId),
  mode: selectedOfferIds ? "refresh_v5_selection" : "balanced_family_selection",
  requestedFamilies: options.limit,
  referenceOfferIds: selectedOfferIds?.size || null,
  rawRows: 0,
  merchantRows: 0,
  validRows: 0,
  selectedFamilies: 0,
  selectedRows: 0,
  rejected: {},
  selectedCategories: {}
};

let outputHeaders = null;
const selectedRows = [];

if (selectedOfferIds) {
  const found = new Set();
  await forEachCsvRow(options.input, (headers) => { outputHeaders = headers; }, (record, values) => {
    stats.rawRows += 1;
    if (field(record, "merchant_id", "advertiser_id") !== String(merchant.awinAdvertiserId)) return;
    stats.merchantRows += 1;
    const merchantProductId = field(record, "merchant_product_id", "merchant_sku", "sku");
    if (!selectedOfferIds.has(merchantProductId) || found.has(merchantProductId)) return;
    const candidate = buildCandidate({ row: record, merchant, profile, taxonomy, generatedAt });
    if (candidate.problems.length) {
      for (const problem of candidate.problems) increment(stats.rejected, problem);
      return;
    }
    if (!["in_stock", "preorder"].includes(candidate.offer.availability)) {
      increment(stats.rejected, `availability_${candidate.offer.availability}`);
      return;
    }
    stats.validRows += 1;
    found.add(merchantProductId);
    selectedRows.push({ values, candidate, family: familyKey(record, candidate), rowNumber: record.__rowNumber });
  });
  const missing = [...selectedOfferIds].filter((id) => !found.has(id));
  stats.missingReferenceOffers = missing;
  if (missing.length) throw new Error(`${merchant.id}: faltan ${missing.length} ofertas de la selección v5 en el feed nuevo`);
} else {
  const families = new Map();
  await forEachCsvRow(options.input, (headers) => { outputHeaders = headers; }, (record) => {
    stats.rawRows += 1;
    if (field(record, "merchant_id", "advertiser_id") !== String(merchant.awinAdvertiserId)) return;
    stats.merchantRows += 1;
    const candidate = buildCandidate({ row: record, merchant, profile, taxonomy, generatedAt });
    if (candidate.problems.length) {
      for (const problem of candidate.problems) increment(stats.rejected, problem);
      return;
    }
    if (!["in_stock", "preorder"].includes(candidate.offer.availability)) {
      increment(stats.rejected, `availability_${candidate.offer.availability}`);
      return;
    }
    stats.validRows += 1;
    const key = familyKey(record, candidate);
    if (!families.has(key)) families.set(key, { key, category: candidate.product.category, rank: hash(`${merchant.id}|${key}`) });
  });

  const queues = new Map();
  for (const family of families.values()) {
    if (!queues.has(family.category)) queues.set(family.category, []);
    queues.get(family.category).push(family);
  }
  for (const queue of queues.values()) queue.sort((left, right) => left.rank.localeCompare(right.rank));
  const categories = [...queues.keys()].sort((left, right) => left.localeCompare(right, "es"));
  const selectedFamilies = [];
  while (selectedFamilies.length < options.limit) {
    let added = false;
    for (const category of categories) {
      const family = queues.get(category).shift();
      if (!family) continue;
      selectedFamilies.push(family);
      added = true;
      if (selectedFamilies.length >= options.limit) break;
    }
    if (!added) break;
  }
  const selectedFamilyKeys = new Set(selectedFamilies.map((family) => family.key));
  const variantsByFamily = new Map();
  await forEachCsvRow(options.input, () => {}, (record, values) => {
    if (field(record, "merchant_id", "advertiser_id") !== String(merchant.awinAdvertiserId)) return;
    const candidate = buildCandidate({ row: record, merchant, profile, taxonomy, generatedAt });
    if (candidate.problems.length || !["in_stock", "preorder"].includes(candidate.offer.availability)) return;
    const key = familyKey(record, candidate);
    if (!selectedFamilyKeys.has(key)) return;
    const count = variantsByFamily.get(key) || 0;
    if (count >= options.variantsPerFamily) return;
    variantsByFamily.set(key, count + 1);
    selectedRows.push({ values, candidate, family: key, rowNumber: record.__rowNumber });
  });
}

selectedRows.sort((left, right) => left.rowNumber - right.rowNumber);
const uniqueFamilies = new Set();
for (const row of selectedRows) {
  uniqueFamilies.add(row.family);
  increment(stats.selectedCategories, row.candidate.product.category);
}
stats.selectedFamilies = uniqueFamilies.size;
stats.selectedRows = selectedRows.length;
if (!stats.selectedRows) throw new Error(`${merchant.id}: la selección ha quedado vacía`);

const csv = [
  outputHeaders.map(csvField).join(","),
  ...selectedRows.map((row) => row.values.map(csvField).join(","))
].join("\n") + "\n";
stats.outputSha256 = hash(csv);
stats.selectedCategories = Object.fromEntries(Object.entries(stats.selectedCategories).sort((left, right) => right[1] - left[1]));

await Promise.all([
  atomicWrite(options.output, gzipSync(Buffer.from(csv), { level: 9 })),
  atomicWrite(options.report, Buffer.from(`${JSON.stringify(stats, null, 2)}\n`))
]);

console.log(JSON.stringify(stats, null, 2));
