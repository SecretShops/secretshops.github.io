#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readAwinFeed } from "./lib/awin-feed-utils.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publisherId = "2996453";
const merchantsExpected = {
  "voghion-global-es": {
    advertiserId: "44635",
    countries: ["ES", "PT", "FR", "DE", "IT", "AT", "BE", "NL", "FI", "SK", "LV", "LT", "LU", "EE", "SI", "HR", "GR"],
    feed: "data/sources/awin/voghion-global-es.csv.gz",
    feedRows: 2604,
    rootFamilies: 2604,
    rootOffers: 2604
  },
  "al-jazeera-perfumes-eu": {
    advertiserId: "126135",
    countries: ["ES", "PT", "FR", "DE", "IT", "AT", "BE", "IE", "NL", "FI", "SK", "LV", "LT", "LU", "EE", "SI", "HR", "MC", "GR", "BG"],
    feed: "data/sources/awin/al-jazeera-perfumes-eu.csv.gz",
    feedRows: 85,
    rootFamilies: 83,
    rootOffers: 85
  },
  "foot-store-es": {
    advertiserId: "65912",
    countries: ["ES", "PT", "FR", "DE", "IT", "AT", "BE", "IE", "NL", "SK", "LV", "LT", "LU", "EE", "SI", "HR", "MC", "GR", "BG"],
    feed: "data/sources/awin/foot-store-es.csv.gz",
    feedRows: 316,
    rootFamilies: 114,
    rootOffers: 316
  },
  "gigasport-es": {
    advertiserId: "121582",
    countries: ["ES"],
    feed: "data/sources/awin/gigasport-es.csv.gz",
    feedRows: 404,
    rootFamilies: 120,
    rootOffers: 404
  }
};

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

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path.replace(/^\//, "")), "utf8"));
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

function familyOffers(family) {
  return (family.variants || []).flatMap((variant) => variant.offers || []);
}

function catalogOffers(payload) {
  return (payload.families || []).flatMap(familyOffers);
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right, "en"));
}

function sameValues(actual, expected) {
  return JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected));
}

function validateAwinUrl(value, merchantId, advertiserId, context) {
  const url = new URL(value);
  assert(["awin1.com", "www.awin1.com"].includes(url.hostname), `${context}: host Awin no válido`);
  assert(url.protocol === "https:", `${context}: enlace no HTTPS`);
  assert(url.searchParams.get("a") === publisherId, `${context}: publisher Awin incorrecto`);
  assert(url.searchParams.get("m") === advertiserId, `${context}: anunciante Awin incorrecto`);
  assert(!url.username && !url.password && !url.hash, `${context}: URL Awin insegura`);
  assert(merchantId in merchantsExpected, `${context}: comercio inesperado`);
}

const [regions, merchantsPayload, productsPayload, offersPayload, familiesPayload, canonicalLinks, holds] = await Promise.all([
  readJson("data/config/regions.json"),
  readJson("data/catalog/merchants.json"),
  readJson("data/catalog/products.json"),
  readJson("data/catalog/offers.json"),
  readJson("data/catalog/families.json"),
  readJson("data/catalog/affiliate-links.json"),
  readJson("data/config/catalog-holds.json")
]);

const merchants = new Map(merchantsPayload.merchants.map((merchant) => [merchant.id, merchant]));
const familyIds = new Set();
const offerIds = new Set();
const productIds = new Set();
for (const product of productsPayload.products || []) {
  assert(!productIds.has(product.id), `producto duplicado ${product.id}`);
  productIds.add(product.id);
  assert(!(product.sourceMerchants || []).includes("lounge-eu"), `${product.id}: conserva Lounge como fuente activa`);
}
for (const offer of offersPayload.offers || []) {
  assert(!offerIds.has(offer.id), `oferta duplicada ${offer.id}`);
  offerIds.add(offer.id);
  assert(offer.merchantId !== "lounge-eu", `${offer.id}: oferta Lounge activa`);
}
for (const family of familiesPayload.families || []) {
  assert(!familyIds.has(family.id), `familia duplicada ${family.id}`);
  familyIds.add(family.id);
  assert(familyOffers(family).every((offer) => offer.merchantId !== "lounge-eu"), `${family.id}: familia Lounge activa`);
}
assert(Object.keys(canonicalLinks.links || {}).every((id) => !id.startsWith("lounge-eu:")), "Lounge conserva enlaces canónicos");

for (const [merchantId, expected] of Object.entries(merchantsExpected)) {
  const merchant = merchants.get(merchantId);
  assert(merchant?.status === "approved", `${merchantId}: comercio no aprobado`);
  assert(merchant.currency === "EUR", `${merchantId}: moneda no EUR`);
  assert(merchant.awinAdvertiserId === expected.advertiserId, `${merchantId}: anunciante no coincide`);
  assert(sameValues(merchant.countries || [], expected.countries), `${merchantId}: matriz de países inesperada`);
  assert(/^https:\/\//.test(merchant.shippingEvidence || ""), `${merchantId}: falta evidencia de envío`);

  const rootFamilies = familiesPayload.families.filter((family) =>
    familyOffers(family).some((offer) => offer.merchantId === merchantId)
  );
  const rootOffers = offersPayload.offers.filter((offer) => offer.merchantId === merchantId);
  assert(rootFamilies.length === expected.rootFamilies, `${merchantId}: ${rootFamilies.length} familias raíz`);
  assert(rootOffers.length === expected.rootOffers, `${merchantId}: ${rootOffers.length} ofertas raíz`);
  for (const offer of rootOffers) {
    assert(offer.country === "ES" && offer.currency === "EUR", `${offer.id}: mercado raíz incorrecto`);
    validateAwinUrl(offer.affiliateUrl, merchantId, expected.advertiserId, offer.id);
  }

  const feed = await readAwinFeed(resolve(root, expected.feed));
  assert(feed.records.length === expected.feedRows, `${merchantId}: ${feed.records.length} filas curadas`);
  assert(feed.headers.length > 10, `${merchantId}: cabecera de feed incompleta`);
}

let regionalSources = 0;
let regionalAssignments = 0;
for (const region of regions.regions) {
  if (!region.catalogManifest || !region.affiliateLinks) continue;
  const [manifest, linksPayload] = await Promise.all([
    readJson(region.catalogManifest),
    readJson(region.affiliateLinks)
  ]);
  const sourceByMerchant = new Map(
    (manifest.sources || [])
      .filter((source) => String(source.id || "").startsWith("awin-v5-"))
      .map((source) => [source.merchantId, source])
  );
  const newLinks = Object.entries(linksPayload.links || {}).filter(([, entry]) => entry.merchantId in merchantsExpected);

  for (const [merchantId, expected] of Object.entries(merchantsExpected)) {
    const allowed = region.status === "published"
      && region.currency === "EUR"
      && expected.countries.includes(region.countryCode);
    if (region.countryCode === "ES") {
      assert(!sourceByMerchant.has(merchantId), `${region.id}/${merchantId}: España no debe duplicar la fuente canónica`);
      assert(allowed, `${merchantId}: España dejó de estar permitida`);
    } else {
      assert(sourceByMerchant.has(merchantId) === allowed, `${region.id}/${merchantId}: publicación fuera de matriz`);
    }

    const merchantLinks = newLinks.filter(([, entry]) => entry.merchantId === merchantId);
    assert((merchantLinks.length > 0) === allowed, `${region.id}/${merchantId}: enlaces fuera de matriz`);
    for (const [offerId, entry] of merchantLinks) {
      assert(entry.country === region.countryCode, `${region.id}/${offerId}: país de enlace incorrecto`);
      validateAwinUrl(entry.url, merchantId, expected.advertiserId, `${region.id}/${offerId}`);
      regionalAssignments += 1;
    }

    const source = sourceByMerchant.get(merchantId);
    if (!source) continue;
    regionalSources += 1;
    const payload = await readJson(source.path);
    assert(payload.country === region.countryCode, `${source.id}: país del catálogo incorrecto`);
    assert(payload.currency === "EUR", `${source.id}: moneda del catálogo incorrecta`);
    assert(payload.families.length > 0 && payload.families.length <= 120, `${source.id}: selección regional no acotada`);
    for (const offer of catalogOffers(payload)) {
      assert(offer.merchantId === merchantId, `${source.id}/${offer.id}: comercio mezclado`);
      assert(offer.country === region.countryCode && offer.currency === "EUR", `${source.id}/${offer.id}: mercado mezclado`);
    }
  }
  assert(newLinks.every(([, entry]) => entry.merchantId !== "lounge-eu"), `${region.id}: enlace Lounge activo`);
}

const lounge = merchants.get("lounge-eu");
assert(lounge?.status === "paused" && lounge.publicationStatus === "held_contract_expired", "Lounge no está pausado");
const impactSync = await readJson("data/catalog/impact-sync-config.json");
const loungeSync = (impactSync.catalogs || impactSync.merchants || []).find((entry) => entry.merchantId === "lounge-eu" || entry.id === "lounge-eu");
assert(loungeSync?.enabled === false, "la sincronización Lounge sigue habilitada");
assert((holds.holds || []).some((hold) => hold.merchantId === "lounge-eu" && hold.preserveSources && hold.preserveStaticPages), "falta la retención reversible de Lounge");
const loungeSourceFiles = (await walk(resolve(root, "data/sources/lounge-eu"))).filter((path) => !path.endsWith(".DS_Store"));
assert(loungeSourceFiles.length > 0, "faltan las fuentes preservadas de Lounge");

const heldPages = [];
const productDirectory = resolve(root, "producto");
for (const entry of await readdir(productDirectory, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const path = resolve(productDirectory, entry.name, "index.html");
  if (!(await exists(path))) continue;
  const html = await readFile(path, "utf8");
  if (!html.includes("Lounge EU") || !html.includes("offer=lounge-eu%3A")) continue;
  const canonical = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i)?.[1];
  assert(canonical, `${relative(root, path)}: ficha Lounge sin canonical`);
  heldPages.push(canonical);
}
const expectedHeldPages = holds.holds.find((hold) => hold.merchantId === "lounge-eu")?.expectedPreservedProductPages;
assert(heldPages.length === expectedHeldPages, `Lounge: ${heldPages.length} fichas retenidas para ${expectedHeldPages} previstas`);
assert(await exists(resolve(root, "tiendas/lounge-eu/index.html")), "falta la página histórica de tienda Lounge");
const sitemapFiles = (await readdir(root)).filter((name) => /^sitemap(?:-[a-z]{2})?\.xml$/.test(name));
const sitemapText = (await Promise.all(sitemapFiles.map((name) => readFile(resolve(root, name), "utf8")))).join("\n");
for (const canonical of heldPages) assert(!sitemapText.includes(canonical), `sitemap publica una ficha Lounge retenida: ${canonical}`);
assert(!sitemapText.includes("/tiendas/lounge-eu/"), "sitemap publica la tienda Lounge retenida");

const jsonFiles = (await walk(resolve(root, "data"))).filter((path) => path.endsWith(".json"));
for (const path of jsonFiles) JSON.parse(await readFile(path, "utf8"));

console.log(JSON.stringify({
  status: "ok",
  jsonFilesParsed: jsonFiles.length,
  products: productIds.size,
  offers: offerIds.size,
  families: familyIds.size,
  curatedFeedRows: Object.values(merchantsExpected).reduce((total, entry) => total + entry.feedRows, 0),
  regionalSources,
  regionalAssignments,
  loungeHeldPages: heldPages.length,
  loungeSourceFiles: loungeSourceFiles.length
}, null, 2));
