#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readAwinFeed } from "./lib/awin-feed-utils.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publisherId = "2996453";
const expected = Object.freeze({
  "fidelis-es": {
    advertiserId: "123348",
    feedId: "114212",
    region: "es",
    country: "ES",
    currency: "EUR",
    rows: 112,
    families: 112,
    feedSha256: "67351db5ff5b83249fa880f7cadf7c924d76840e866e88dcdde77cf6a1698ed6"
  },
  "tsarbomba-mx": {
    advertiserId: "109230",
    feedId: "108930",
    region: "mx",
    country: "MX",
    currency: "MXN",
    rows: 242,
    families: 62,
    feedSha256: "4eda1277b7dc133ab3a95f0c93cfe37a7909428ded87b8a1ed99d2473432e2a0"
  }
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
}

function localPublicPath(publicPath) {
  const value = String(publicPath || "");
  assert(value.startsWith("/") && !value.includes(".."), `Ruta pública insegura: ${value}`);
  const output = resolve(root, `.${value}`);
  assert(output === root || output.startsWith(`${root}${sep}`), `Ruta fuera del repositorio: ${value}`);
  return output;
}

function collectOffers(payload) {
  return (payload.families || []).flatMap((family) =>
    (family.variants || []).flatMap((variant) => variant.offers || [])
  );
}

function validateAwinUrl(value, advertiserId, offerId) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${offerId}: enlace Awin inválido`);
  }
  assert(url.protocol === "https:", `${offerId}: enlace sin HTTPS`);
  assert(/(^|\.)awin1\.com$/i.test(url.hostname), `${offerId}: host Awin incorrecto`);
  assert(["/pclick.php", "/cread.php"].includes(url.pathname), `${offerId}: ruta Awin incorrecta`);
  assert((url.searchParams.get("a") || url.searchParams.get("awinaffid")) === publisherId, `${offerId}: publisher incorrecto`);
  assert((url.searchParams.get("m") || url.searchParams.get("awinmid")) === advertiserId, `${offerId}: advertiser incorrecto`);
  assert(Boolean(url.searchParams.get("p") || url.searchParams.get("ued")), `${offerId}: destino de seguimiento ausente`);
}

async function sha256(relativePath) {
  return createHash("sha256").update(await readFile(resolve(root, relativePath))).digest("hex");
}

const [
  merchantsPayload,
  profilesPayload,
  regionsPayload,
  offersPayload,
  productsPayload,
  brandingPayload,
  fidelisCuration,
  tsarbombaCuration,
  fidelisImport,
  tsarbombaImport
] = await Promise.all([
  readJson("data/catalog/merchants.json"),
  readJson("data/catalog/awin-import-profiles.json"),
  readJson("data/config/regions.json"),
  readJson("data/catalog/offers.json"),
  readJson("data/catalog/products.json"),
  readJson("data/config/store-branding.json"),
  readJson("reports/fidelis-es-curation-2026-08-04.json"),
  readJson("reports/tsarbomba-mx-curation-2026-08-04.json"),
  readJson("data/catalog/import-reports/fidelis-es-last.json"),
  readJson("data/catalog/import-reports/tsarbomba-mx-mx-last.json")
]);

const merchants = new Map(merchantsPayload.merchants.map((merchant) => [merchant.id, merchant]));
const regions = new Map(regionsPayload.regions.map((region) => [region.id, region]));
for (const [merchantId, rule] of Object.entries(expected)) {
  const merchant = merchants.get(merchantId);
  const profile = profilesPayload.merchants?.[merchantId];
  assert(merchant?.status === "approved", `${merchantId}: merchant no aprobado`);
  assert(merchant.network === "awin", `${merchantId}: red incorrecta`);
  assert(String(merchant.awinAdvertiserId) === rule.advertiserId, `${merchantId}: advertiser incorrecto`);
  assert(String(merchant.feedId) === rule.feedId, `${merchantId}: feed incorrecto`);
  assert(JSON.stringify(merchant.countries) === JSON.stringify([rule.country]), `${merchantId}: countries debe ser exactamente ${rule.country}`);
  assert(JSON.stringify(merchant.preparedCountries) === JSON.stringify([rule.country]), `${merchantId}: preparedCountries incorrecto`);
  assert(merchant.currency === rule.currency, `${merchantId}: moneda de merchant incorrecta`);
  assert(profile?.country === rule.country && profile?.currency === rule.currency, `${merchantId}: perfil regional incorrecto`);
  assert(profile.requireExactIdentifier === true, `${merchantId}: el perfil debe exigir identificación exacta`);
  assert(profile.allowMerchantScopedProductId === false, `${merchantId}: identidad SKU permisiva no autorizada`);
}
assert(merchants.get("fidelis-es").shippingEvidence === "https://fidelis.es/products/ternera-deshidratado-2500g", "Fidelis: evidencia de envío incorrecta");
assert(merchants.get("tsarbomba-mx").shippingEvidence === "https://tsarbomba.com/es/pages/entrega-y-envio", "Tsarbomba: evidencia de envío incorrecta");
assert(regions.get("es")?.status === "published", "España debe permanecer publicada");
assert(regions.get("mx")?.status === "draft", "México debe permanecer draft hasta superar su control regional general");

assert(fidelisCuration.rawRows === 112 && fidelisCuration.selectedRows === 112, "Fidelis: recuento de curación incorrecto");
assert(Object.keys(fidelisCuration.rejected || {}).length === 0, "Fidelis: la curación contiene rechazos inesperados");
assert(tsarbombaCuration.rawRows === 243 && tsarbombaCuration.selectedRows === 242, "Tsarbomba: recuento de curación incorrecto");
assert(tsarbombaCuration.rejected?.invalid_currency === 1, "Tsarbomba: no consta la exclusión de la fila USD incompatible");
assert(fidelisImport.totals.acceptedRows === 112 && fidelisImport.totals.skippedRows === 0, "Fidelis: informe de importación incorrecto");
assert(tsarbombaImport.rawRows === 242 && tsarbombaImport.offers === 242 && tsarbombaImport.families === 62, "Tsarbomba: informe regional incorrecto");
assert(tsarbombaImport.regionStatus === "draft" && tsarbombaImport.safety?.regionStatusPreserved === true, "Tsarbomba: se alteró indebidamente el estado regional");

for (const [merchantId, rule] of Object.entries(expected)) {
  const feedPath = `data/sources/awin/${merchantId === "fidelis-es" ? "fidelis-es" : "tsarbomba-mx"}.csv.gz`;
  assert(await sha256(feedPath) === rule.feedSha256, `${merchantId}: SHA-256 del feed curado incorrecto`);
  const feed = await readAwinFeed(resolve(root, feedPath));
  assert(feed.records.length === rule.rows, `${merchantId}: filas del feed curado incorrectas`);
  for (const row of feed.records) {
    assert(String(row.merchant_id) === rule.advertiserId, `${merchantId}: fila de otro advertiser`);
    assert(String(row.data_feed_id) === rule.feedId, `${merchantId}: fila de otro feed`);
    assert(String(row.currency).toUpperCase() === rule.currency, `${merchantId}: moneda incompatible retenida`);
    validateAwinUrl(row.aw_deep_link, rule.advertiserId, `${merchantId}:${row.merchant_product_id}`);
  }
}

const canonicalFidelisOffers = offersPayload.offers.filter((offer) => offer.merchantId === "fidelis-es");
const canonicalTsarbombaOffers = offersPayload.offers.filter((offer) => offer.merchantId === "tsarbomba-mx");
assert(canonicalFidelisOffers.length === 112, "Fidelis: faltan ofertas canónicas");
assert(canonicalTsarbombaOffers.length === 0, "Tsarbomba: no debe mezclarse con el catálogo canónico español");
for (const offer of canonicalFidelisOffers) {
  assert(offer.country === "ES" && offer.currency === "EUR", `${offer.id}: mercado canónico incorrecto`);
  validateAwinUrl(offer.affiliateUrl, "123348", offer.id);
}
assert(productsPayload.products.filter((product) => (product.sourceMerchants || []).includes("fidelis-es")).length === 112, "Fidelis: productos canónicos incompletos");
assert(productsPayload.products.every((product) => !(product.sourceMerchants || []).includes("tsarbomba-mx")), "Tsarbomba: producto filtrado al catálogo español");

const regionalAssignments = { "fidelis-es": {}, "tsarbomba-mx": {} };
for (const region of regionsPayload.regions) {
  if (!region.catalogManifest || !region.affiliateLinks) continue;
  const manifest = await readJson(region.catalogManifest.replace(/^\//, ""));
  const linksPayload = await readJson(region.affiliateLinks.replace(/^\//, ""));
  for (const source of manifest.sources || []) {
    const payload = await readJson(source.path.replace(/^\//, ""));
    for (const offer of collectOffers(payload)) {
      if (!(offer.merchantId in regionalAssignments)) continue;
      regionalAssignments[offer.merchantId][region.id] = (regionalAssignments[offer.merchantId][region.id] || 0) + 1;
      const rule = expected[offer.merchantId];
      assert(region.id === rule.region, `${offer.id}: ${offer.merchantId} aparece en ${region.id}`);
      assert(offer.country === rule.country && offer.currency === rule.currency, `${offer.id}: país o moneda regional incorrectos`);
      const link = linksPayload.links?.[offer.id];
      assert(link?.merchantId === offer.merchantId && link.country === rule.country, `${region.id}/${offer.id}: enlace regional incorrecto`);
      validateAwinUrl(link.url, rule.advertiserId, offer.id);
    }
  }
}
assert(JSON.stringify(regionalAssignments["fidelis-es"]) === JSON.stringify({ es: 112 }), "Fidelis: asignaciones regionales incorrectas");
assert(JSON.stringify(regionalAssignments["tsarbomba-mx"]) === JSON.stringify({ mx: 242 }), "Tsarbomba: asignaciones regionales incorrectas");

const mxSource = await readJson("data/catalog/mx/awin-tsarbomba-mx.json");
assert(mxSource.schemaVersion === 3 && mxSource.country === "MX" && mxSource.currency === "MXN", "Tsarbomba: fuente MX inválida");
assert(mxSource.families.length === 62 && collectOffers(mxSource).length === 242, "Tsarbomba: fuente MX incompleta");
assert((await readJson("data/catalog/mx/catalog.json")).sources.some((source) => source.id === "awin-tsarbomba-mx"), "Tsarbomba: fuente ausente del manifiesto MX");

const branding = new Map(brandingPayload.stores.map((store) => [store.id, store]));
assert(branding.get("fidelis-es")?.logo === "/assets/brands/stores/fidelis.svg", "Fidelis: branding ausente");
assert(branding.get("tsarbomba-mx")?.logo === "/assets/brands/stores/tsarbomba.svg", "Tsarbomba: branding ausente");
assert(!branding.has("lounge-eu"), "Lounge ha reaparecido en el branding");
await Promise.all([
  access(resolve(root, "assets/brands/stores/fidelis.svg")),
  access(resolve(root, "assets/brands/stores/tsarbomba.svg"))
]);

console.log("Parche Fidelis/Tsarbomba válido: Fidelis ES 112 familias/112 ofertas; Tsarbomba MX 62 familias/242 ofertas; 1 fila USD excluida; sin mezcla de países ni monedas.");
