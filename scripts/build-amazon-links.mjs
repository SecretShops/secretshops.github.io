#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAmazonAffiliateUrl,
  extractAsin,
  parseCsv,
  parseLooseAmazonInput,
  toCsv
} from "./lib/amazon-associates-core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const inputPath = resolve(root, option("--input", "data/sources/amazon-es-input.txt"));
const outputBase = resolve(root, option("--output", "data/imports/amazon-es/amazon-links"));

async function readMerchant() {
  const payload = JSON.parse(await readFile(resolve(root, "data/catalog/merchants.json"), "utf8"));
  const merchant = payload.merchants.find((item) => item.id === "amazon-es");
  if (!merchant || merchant.status !== "approved") {
    throw new Error("amazon-es no está configurado como merchant aprobado");
  }
  if (!merchant.associateTag) throw new Error("amazon-es no tiene associateTag");
  return merchant;
}

async function writeAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

function extractCandidates(text) {
  if (extname(inputPath).toLowerCase() !== ".csv") {
    return parseLooseAmazonInput(text);
  }
  const accepted = [];
  const rejected = [];
  const seen = new Set();
  for (const row of parseCsv(text)) {
    const candidate = row.asin || row.url || row.amazon_url || row.asin_or_url || row.source || "";
    const asin = extractAsin(candidate);
    if (!asin) {
      rejected.push({ input: candidate || `fila ${row.__row}`, reason: "asin_not_found" });
      continue;
    }
    if (seen.has(asin)) continue;
    seen.add(asin);
    accepted.push({ input: candidate, asin });
  }
  return { accepted, rejected };
}

const [merchant, input] = await Promise.all([
  readMerchant(),
  readFile(inputPath, "utf8")
]);
const { accepted, rejected } = extractCandidates(input);
const generatedAt = new Date().toISOString();
const rows = accepted.map(({ input, asin }) => ({
  asin,
  source_input: input,
  canonical_url: `https://www.amazon.es/dp/${asin}`,
  affiliate_url: buildAmazonAffiliateUrl(asin, merchant.associateTag),
  marketplace: "amazon.es",
  country: "ES",
  generated_at: generatedAt
}));

await Promise.all([
  writeAtomic(`${outputBase}.csv`, toCsv(rows, [
    "asin",
    "source_input",
    "canonical_url",
    "affiliate_url",
    "marketplace",
    "country",
    "generated_at"
  ])),
  writeAtomic(`${outputBase}.json`, `${JSON.stringify({
    schemaVersion: 1,
    generatedAt,
    associateTag: merchant.associateTag,
    products: rows,
    rejected
  }, null, 2)}\n`)
]);

console.log(JSON.stringify({
  input: inputPath,
  accepted: rows.length,
  rejected: rejected.length,
  csv: `${outputBase}.csv`,
  json: `${outputBase}.json`
}, null, 2));
