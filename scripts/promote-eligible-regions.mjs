#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { destinationAllowedForCountry } from "../assets/js/redirect.js";
import { atomicWriteJson } from "./lib/awin-feed-utils.mjs";
import { evaluateRegionPublication } from "./lib/region-publication-core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const regionsPath = resolve(root, "data/config/regions.json");
const minimumFamilies = Math.max(
  1,
  Number.parseInt(process.env.MIN_REGION_FAMILIES || "200", 10) || 200
);

function localPath(publicPath) {
  const value = String(publicPath || "");
  if (!value.startsWith("/") || value.includes("..")) {
    throw new Error(`Ruta pública insegura: ${value}`);
  }
  const path = resolve(root, `.${value}`);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error(`Ruta fuera del repositorio: ${value}`);
  }
  return path;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function regionFamilies(region) {
  const manifest = await readJson(localPath(region.catalogManifest));
  const families = [];
  for (const source of manifest.sources || []) {
    const payload = await readJson(localPath(source.path));
    families.push(...(payload.families || []));
  }
  return families;
}

const payload = await readJson(regionsPath);
const evaluations = [];
let changed = false;
for (const region of payload.regions || []) {
  if (region.status !== "draft") continue;
  if (!region.catalogManifest || !region.affiliateLinks) {
    evaluations.push({
      region: region.id,
      eligible: false,
      reasons: ["missing_files"],
      stats: { families: 0, offers: 0, links: 0, minimumFamilies }
    });
    continue;
  }
  const [families, linksPayload] = await Promise.all([
    regionFamilies(region),
    readJson(localPath(region.affiliateLinks))
  ]);
  const result = evaluateRegionPublication({
    region,
    families,
    links: linksPayload.links || {},
    minimumFamilies,
    destinationAllowed: destinationAllowedForCountry
  });
  evaluations.push({ region: region.id, ...result });
  if (result.eligible) {
    region.status = "published";
    changed = true;
  }
}

if (changed) await atomicWriteJson(regionsPath, payload);
console.log(JSON.stringify({
  changed,
  promoted: evaluations.filter((entry) => entry.eligible).map((entry) => entry.region),
  held: evaluations.filter((entry) => !entry.eligible),
  safety: {
    publishedRegionsDemoted: 0,
    minimumFamilies,
    exactCountryCurrencyAndLinksRequired: true
  }
}, null, 2));
