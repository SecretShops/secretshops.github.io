#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeCatalogPayloads } from "../assets/js/catalog-core.js";
import {
  productPath,
  publishedRegions,
  validateRegionConfig
} from "../assets/js/region-core.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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
  assert(value.startsWith("/") && !value.includes(".."), `Ruta pública insegura: ${value}`);
  const output = resolve(root, `.${value}`);
  assert(output === root || output.startsWith(`${root}${sep}`), `Ruta fuera del repositorio: ${value}`);
  return output;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function collect(payload) {
  const families = payload.families || [];
  const offers = families.flatMap((family) =>
    (family.variants || []).flatMap((variant) => variant.offers || [])
  );
  return { families, offers };
}

async function countProductPages(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await exists(resolve(directory, entry.name, "index.html"))) count += 1;
  }
  return count;
}

const config = validateRegionConfig(
  await readJson(resolve(root, "data/config/regions.json"))
);
const publicRegionIds = new Set(publishedRegions(config).map((region) => region.id));
const selector = await readFile(localPath(config.selectorPath + "index.html"), "utf8");
const rootIndex = await readFile(resolve(root, "index.html"), "utf8");
const app = await readFile(resolve(root, "assets/js/app.js"), "utf8");
const totals = [];

assert(!rootIndex.includes("data-filter-country"), "index.html todavía permite mezclar mercados");
assert(!app.includes("const DATA_SOURCES"), "app.js todavía define catálogos multirregionales globales");
assert(!app.includes('params.get("pais")'), "app.js todavía interpreta el selector antiguo ?pais=");

for (const region of config.regions) {
  const isPublished = publicRegionIds.has(region.id);
  if (isPublished) {
    assert(selector.includes(`href="${region.basePath}"`), `${region.id}: no aparece en /paises/`);
  } else {
    assert(!selector.includes(`href="${region.basePath}"`), `${region.id}: una región draft aparece en /paises/`);
    if (region.basePath !== "/") {
      assert(
        !(await exists(resolve(localPath(region.basePath), "index.html"))),
        `${region.id}: existe una portada pública para una región draft`
      );
    }
  }

  if (!region.catalogManifest) continue;
  const manifest = await readJson(localPath(region.catalogManifest));
  assert(manifest.region === region.id, `${region.id}: manifest regional incorrecto`);
  assert(manifest.country === region.countryCode, `${region.id}: país del manifest incorrecto`);
  assert(manifest.currency === region.currency, `${region.id}: moneda del manifest incorrecta`);
  assert(manifest.locale === region.locale, `${region.id}: locale del manifest incorrecto`);

  const familyIds = new Set();
  const offerIds = new Set();
  const loadedSources = [];
  for (const source of manifest.sources) {
    const payload = await readJson(localPath(source.path));
    loadedSources.push({ ...source, payload });
    const { families, offers } = collect(payload);
    for (const family of families) {
      assert(!familyIds.has(family.id), `${region.id}: familia duplicada ${family.id}`);
      familyIds.add(family.id);
    }
    for (const offer of offers) {
      const country = String(offer.country || source.country || "").toUpperCase();
      const currency = String(offer.currency || source.currency || "").toUpperCase();
      assert(country === region.countryCode, `${region.id}/${offer.id}: país ${country}`);
      assert(currency === region.currency, `${region.id}/${offer.id}: moneda ${currency}`);
      assert(!offerIds.has(offer.id), `${region.id}: oferta duplicada ${offer.id}`);
      offerIds.add(offer.id);
    }
  }

  const links = await readJson(localPath(region.affiliateLinks));
  assert(links.region === region.id, `${region.id}: affiliate-links pertenece a ${links.region}`);
  assert(links.country === region.countryCode, `${region.id}: country de affiliate-links incorrecto`);
  const linkedIds = new Set(Object.keys(links.links || {}));
  assert(linkedIds.size === offerIds.size, `${region.id}: número de enlaces distinto al de ofertas`);
  for (const offerId of offerIds) {
    assert(linkedIds.has(offerId), `${region.id}: falta enlace para ${offerId}`);
    assert(links.links[offerId].country === region.countryCode, `${region.id}/${offerId}: enlace de otro país`);
  }

  if (isPublished) {
    const productDirectory = localPath(`${region.basePath}producto/`);
    assert(await exists(resolve(productDirectory, "_GENERATED_BY_SECRETSHOP.txt")), `${region.id}: falta marcador de fichas generadas`);
    const productPages = await countProductPages(productDirectory);
    assert(productPages === familyIds.size, `${region.id}: ${productPages} fichas para ${familyIds.size} familias`);
    assert(await exists(resolve(root, `sitemap-${region.id}.xml`)), `${region.id}: falta sitemap regional`);

    const merged = mergeCatalogPayloads(loadedSources);
    assert(merged.warnings.length === 0, `${region.id}: ${merged.warnings.join("; ")}`);
    const seenRoutes = new Set();
    for (const family of merged.families) {
      const route = productPath(family, region);
      assert(!seenRoutes.has(route), `${region.id}: ruta duplicada ${route}`);
      seenRoutes.add(route);
      assert(await exists(resolve(localPath(route), "index.html")), `${region.id}: falta ${route}`);
    }
    totals.push({ region: region.id, families: familyIds.size, offers: offerIds.size, productPages });
  }
}

const sitemap = await readFile(resolve(root, "sitemap.xml"), "utf8");
for (const region of publishedRegions(config)) {
  assert(sitemap.includes(`/sitemap-${region.id}.xml`), `${region.id}: no figura en sitemap.xml`);
}
for (const region of config.regions.filter((entry) => entry.status === "draft")) {
  assert(!sitemap.includes(`/sitemap-${region.id}.xml`), `${region.id}: sitemap draft publicado`);
}

console.log(
  `Regiones válidas: ${totals.map((entry) => `${entry.region} ${entry.families} familias/${entry.offers} ofertas/${entry.productPages} fichas`).join("; ")}. Drafts sin publicar: ${config.regions.filter((region) => region.status === "draft").map((region) => region.id).join(", ")}.`
);
