#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importShokzImpactFeed } from "./lib/impact-shokz-core.mjs";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const input = argumentValue("--input");
if (!input) {
  console.error(
    "Uso: node scripts/import-impact-shokz.mjs --input <Imported-Shopify-Catalog_IR.txt.gz> [--dry-run]"
  );
  process.exit(1);
}

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const result = await importShokzImpactFeed({
  inputPath: resolve(input),
  catalogDir: resolve(root, "data/catalog"),
  dryRun: process.argv.includes("--dry-run")
});

console.log(JSON.stringify(result.report, null, 2));
