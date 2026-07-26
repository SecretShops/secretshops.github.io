import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { filterAndSortFamilies, mergeCatalogPayloads, normalizeText } from "../assets/js/catalog-core.js";

const root = resolve(import.meta.dirname, "..");

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

const [
  spain,
  spainAliExpress,
  mexico,
  colombia,
  links,
  products,
  offers,
  merchants,
  shokzImport,
  curated,
  regions
] = await Promise.all([
  readJson("data/catalog/families.json"),
  readJson("data/catalog/aliexpress-es.json"),
  readJson("data/catalog/aliexpress-mx.json"),
  readJson("data/catalog/aliexpress-co.json"),
  readJson("data/catalog/affiliate-links.json"),
  readJson("data/catalog/products.json"),
  readJson("data/catalog/offers.json"),
  readJson("data/catalog/merchants.json"),
  readJson("data/catalog/import-reports/shokz-es-last.json"),
  readJson("data/sources/curated-products.json"),
  readJson("data/config/regions.json")
]);

const catalogs = [spain, spainAliExpress, mexico, colombia];
const families = catalogs.flatMap((catalog) => catalog.families);
const publicOffers = families.flatMap((family) =>
  family.variants.flatMap((variant) => variant.offers)
);

test("los catálogos preparados usan el esquema definitivo", () => {
  assert.ok(catalogs.every((catalog) => catalog.schemaVersion === 3));
  assert.ok(spain.families.length > 0);
  assert.equal(
    spain.families.reduce((sum, family) => sum + family.variantCount, 0),
    products.products.length
  );
  assert.equal(
    spain.families.flatMap((family) => family.variants.flatMap((variant) => variant.offers)).length,
    offers.offers.length
  );
  assert.ok(mexico.families.length > 0);
  assert.ok(colombia.families.length > 0);
  assert.equal(spainAliExpress.families.length, 411);
  assert.equal(regions.regions.find((region) => region.id === "es").status, "published");
  assert.equal(regions.regions.find((region) => region.id === "mx").status, "draft");
  assert.equal(regions.regions.find((region) => region.id === "co").status, "draft");
});

test("familias, variantes y ofertas tienen IDs únicos", () => {
  const familyIds = families.map((family) => family.id);
  const variantIds = families.flatMap((family) => family.variants.map((variant) => `${family.id}:${variant.id}`));
  const offerIds = publicOffers.map((offer) => offer.id);
  assert.equal(new Set(familyIds).size, familyIds.length);
  assert.equal(new Set(variantIds).size, variantIds.length);
  assert.equal(new Set(offerIds).size, offerIds.length);
});

test("ningún catálogo público contiene enlaces afiliados directos o placeholders", () => {
  const serialized = JSON.stringify(catalogs);
  assert.equal(/affiliateUrl|tracking_url|placehold\.co|PON_AQUI|TU_ENLACE|Atlas Secreto/i.test(serialized), false);
  for (const family of families) {
    assert.ok(family.id && family.title && family.description && family.image);
    assert.equal(family.variantCount, family.variants.length);
    assert.ok(family.variants.length > 0);
    assert.ok(family.variants.every((variant) => variant.offers.length > 0));
  }
});

test("cada oferta publicada tiene exactamente un enlace seguro", () => {
  const referenced = new Set(publicOffers.map((offer) => offer.id));
  const linked = new Set(Object.keys(links.links));
  assert.deepEqual(linked, referenced);
  for (const [offerId, entry] of Object.entries(links.links)) {
    const url = new URL(entry.url);
    assert.equal(url.protocol, "https:", offerId);
    assert.ok(
      /(^|\.)awin1\.com$/i.test(url.hostname) ||
      /^s\.click\.aliexpress\.com$/i.test(url.hostname) ||
      /(^|\.)amazon\.es$/i.test(url.hostname) ||
      /^shokzes\.pxf\.io$/i.test(url.hostname) ||
      /^loungeeu\.sjv\.io$/i.test(url.hostname),
      offerId
    );
  }
});

test("SHOKZ ES conserva únicamente las variantes depuradas y su tracking de Impact", () => {
  const merchant = merchants.merchants.find((item) => item.id === "shokz-es");
  const shokzProducts = products.products.filter((product) =>
    product.sourceMerchants?.includes("shokz-es")
  );
  const shokzOffers = offers.offers.filter((offer) => offer.merchantId === "shokz-es");
  const shokzFamilies = spain.families.filter((family) => family.brand === "Shokz");
  const shokzVariants = shokzFamilies.flatMap((family) => family.variants);

  assert.equal(merchant?.status, "approved");
  assert.equal(merchant?.network, "impact");
  assert.equal(shokzProducts.length, shokzImport.totals.acceptedRows);
  assert.equal(shokzOffers.length, shokzImport.totals.acceptedRows);
  assert.equal(shokzVariants.length, shokzImport.totals.acceptedRows);
  assert.equal(shokzFamilies.length, shokzImport.totals.expectedFamilies);
  assert.ok(
    shokzOffers.every((offer) => {
      const url = new URL(offer.affiliateUrl);
      return (
        offer.country === "ES" &&
        offer.currency === "EUR" &&
        offer.availability === "in_stock" &&
        url.hostname === "shokzes.pxf.io" &&
        url.searchParams.get("prodsku") === offer.merchantProductId
      );
    })
  );
  assert.equal(
    shokzProducts.some((product) => /chasingstrava|after[- ]?sales/i.test(product.title)),
    false
  );
});

test("los cuatro productos curados de Colombia permanecen preparados en su catálogo draft", () => {
  const colombiaIds = new Set(colombia.families.map((family) => family.id));
  for (const product of curated.products) {
    assert.ok(colombiaIds.has(`market-co-${product.productId}`), product.productId);
  }
});

test("todas las imágenes locales publicadas existen", async () => {
  const localImages = new Set(
    families
      .flatMap((family) => [family.image, ...family.images, ...family.variants.flatMap((variant) => variant.images)])
      .filter((image) => /^\.\/images\//.test(image))
  );
  for (const image of localImages) {
    await access(resolve(root, image.replace(/^\.\//, "")));
  }
  assert.ok(localImages.size >= 15);
});


test("la búsqueda de televisores no devuelve muebles por menciones descriptivas", () => {
  const merged = mergeCatalogPayloads(
    catalogs.map((payload, index) => ({ id: `catalog-${index}`, payload }))
  ).families;
  const results = filterAndSortFamilies(merged, { query: "televisor" });

  assert.ok(results.length >= 1);
  assert.equal(results.some((family) => /^KAWOLA/i.test(family.title)), false);
  assert.ok(
    results.every((family) => {
      const strongText = normalizeText([
        family.title,
        family.brand,
        family.model,
        ...family.categories,
        ...family.groups,
        ...family.variants.flatMap((variant) => [variant.title, variant.label])
      ].filter(Boolean).join(" "));
      return strongText.includes("televisor");
    })
  );
});
