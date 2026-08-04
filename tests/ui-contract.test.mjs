import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [html, css, app, staticJs, i18n, regionCore, regions, storeBranding, portugalHome, promotionsHtml, promotionsJs] = await Promise.all([
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "assets/css/app.css"), "utf8"),
  readFile(resolve(root, "assets/js/app.js"), "utf8"),
  readFile(resolve(root, "assets/js/static.js"), "utf8"),
  readFile(resolve(root, "assets/js/i18n.js"), "utf8"),
  readFile(resolve(root, "assets/js/region-core.js"), "utf8"),
  readFile(resolve(root, "data/config/regions.json"), "utf8"),
  readFile(resolve(root, "data/config/store-branding.json"), "utf8"),
  readFile(resolve(root, "pt/index.html"), "utf8"),
  readFile(resolve(root, "promociones/index.html"), "utf8"),
  readFile(resolve(root, "assets/js/promotions.js"), "utf8")
]);

const [variantSystem, variantIndexScript, variantAudit, variantManifest] = await Promise.all([
  readFile(resolve(root, "assets/js/variant-system.js"), "utf8"),
  readFile(resolve(root, "scripts/build-variant-index.mjs"), "utf8"),
  readFile(resolve(root, "data/catalog/variant-control-audit.json"), "utf8"),
  readFile(resolve(root, "data/catalog/variant-index/manifest.json"), "utf8")
]);

test("conserva la dirección visual y el texto aprobados", () => {
  assert.ok(html.includes("<h1>Encuentra el mejor precio</h1>"));
  assert.ok(html.includes("Busca productos, marcas o categorías"));
  assert.ok(html.includes("Podemos recibir una comisión por algunas compras, sin coste adicional para ti."));
  assert.ok(css.includes("--brand-primary: #1f1f1f"));
  assert.ok(css.includes("--brand-secondary: #fee97d"));
  assert.ok(html.includes("secretshop-logo-compact.png"));
  assert.ok(html.includes("secretshop-logo-original.png"));
  assert.ok(html.includes('<a href="/promociones/" data-region-promotions>'));
  assert.ok(html.includes("data-theme-toggle"));
  assert.ok(css.includes("grid-template-columns: repeat(5, 1fr)"));
});

test("incluye la estructura funcional definitiva", () => {
  for (const marker of [
    "data-search-input",
    "data-category-grid",
    "data-deals-carousel",
    "data-catalog-grid",
    "data-compare-tray",
    "product-dialog",
    "saved-dialog",
    "filters-dialog",
    "score-dialog"
  ]) {
    assert.ok(html.includes(marker), marker);
  }
  assert.ok(regionCore.includes("secretshop:${id}:favorites:v2"));
  assert.ok(regionCore.includes("secretshop:${id}:recent:v2"));
  assert.ok(regionCore.includes("secretshop:${id}:searches:v2"));
  assert.ok(app.includes("const MAX_COMPARE = 4"));
  assert.ok(app.includes('const REGIONS_URL = "/data/config/regions.json"'));
  assert.ok(app.includes("offerRedirectPath(activeRegion.id"));
  assert.equal(html.includes("data-filter-country"), false);
  assert.ok(html.includes("data-region-selector"));
  assert.ok(regions.includes('"status": "published"'));
  assert.ok(regions.includes('"status": "draft"'));
});

test("incluye modo oscuro, foco, reducción de movimiento y diseño adaptable", () => {
  assert.ok(css.includes(':root[data-theme="dark"]'));
  assert.ok(css.includes("--action-bg: var(--brand-primary)"));
  assert.ok(css.includes("--action-bg: var(--brand-secondary)"));
  assert.ok(css.includes(":focus-visible"));
  assert.ok(css.includes("@media (prefers-reduced-motion: reduce)"));
  assert.ok(css.includes("@media (max-width: 560px)"));
  assert.ok(css.includes(".comparison-cards"));
  assert.ok(app.includes('class="comparison-cards"'));
  assert.equal(css.includes("fonts.googleapis.com"), false);
});

test("no conserva la aplicación antigua ni menciones públicas indebidas", () => {
  for (const value of [
    "SecretShop V2.0",
    "styles-v2.css",
    "secretshop-v2.js",
    "catalog-base.js",
    "catalog-aliexpress-mx.js",
    "catalog-aliexpress-co.js",
    "Atlas Secreto",
    "Awin"
  ]) {
    assert.equal(html.includes(value), false, value);
  }
});



test("aplica la actualización de diseño y dominio", () => {
  assert.ok(html.includes('<link rel="canonical" href="https://getsecretshop.com/">'));
  assert.ok(html.includes('class="primary-nav"'));
  assert.match(html, /class="[^"]*\bnav-catalog\b[^"]*"/);
  assert.ok(html.includes('data-set-collection="deals"'));
  assert.ok(html.includes('data-category-grid'));
  assert.ok(css.includes('.category-visual'));
  assert.ok(css.includes('.carousel-arrow-prev'));
  assert.ok(app.includes('const MAIN_CATEGORIES = ["Tecnología", "Moda", "Hogar", "Belleza y cuidado"]'));
  assert.ok(app.includes('data-set-store'));
  assert.ok(app.includes('data-remove-favorite'));
  assert.ok(app.includes('HERO_ROTATION_MS'));
  assert.ok(app.includes('DEALS_ROTATION_MS'));
  assert.equal(html.includes('secretshops.github.io'), false);
});

test("incluye navegación avanzada, directorios e infinito móvil", () => {
  for (const marker of [
    "data-nav-categories",
    "data-nav-stores",
    "data-nav-favorites-preview",
    "data-directory-panel",
    "data-category-directory-grid",
    "data-store-directory-grid",
    "data-catalog-sentinel",
    "mobile-bottom-nav",
    "data-modal-filter-category",
    "data-modal-filter-store"
  ]) {
    assert.ok(html.includes(marker), marker);
  }
  assert.equal(html.includes("data-load-more"), false);
  assert.ok(app.includes("IntersectionObserver"));
  assert.ok(app.includes("categoryDirectoryPath(activeRegion)"));
  assert.ok(app.includes("storeDirectoryPath(activeRegion)"));
  assert.ok(regionCore.includes("export function categoryPath"));
  assert.ok(regionCore.includes("export function storePath"));
  assert.ok(css.includes(".score-carousel"));
  assert.ok(css.includes(".mobile-bottom-nav"));
  assert.ok(css.includes("grid-auto-flow: row"));
  assert.ok(html.includes("data-nav-regions"));
  assert.ok(html.includes("region-dropdown"));
  assert.ok(html.includes("data-region-promotions"));
  assert.ok(html.includes("data-focus-search"));
  assert.ok(app.includes("function focusCatalogSearch()"));
  assert.ok(app.includes("upgradeRegionalNavigation"));
  assert.ok(app.includes("publishedRegions(regionsConfig)"));
});

test("Portugal conserva los datos y traduce la interfaz", () => {
  assert.ok(i18n.includes("translateStaticHtml"));
  assert.ok(portugalHome.includes('lang="pt-PT"'));
  assert.ok(portugalHome.includes("Todas as categorias"));
  assert.ok(portugalHome.includes("Todas as lojas"));
  assert.ok(portugalHome.includes("Navegação móvel"));
  assert.equal(portugalHome.includes("Ver todas las categorías"), false);
  assert.equal(portugalHome.includes("Cargando más productos"), false);
});

test("todos los idiomas publicados tienen interfaz localizada", () => {
  const publishedLanguages = new Set(
    JSON.parse(regions).regions
      .filter((region) => region.status === "published")
      .map((region) => region.locale.split("-")[0])
      .filter((language) => !["es", "pt"].includes(language))
  );
  for (const language of publishedLanguages) {
    assert.ok(
      i18n.includes(`${language}: {`) || i18n.includes(`"${language}": {`),
      `falta interfaz ${language}`
    );
  }
  assert.ok(i18n.includes("STATIC_BY_LANGUAGE"));
  assert.ok(i18n.includes("CATEGORY_CORE"));
});

test("las tarjetas completas, imágenes y escaparates tienen comportamiento seguro", () => {
  assert.ok(app.includes('class="product-card-hit"'));
  assert.ok(css.includes(".product-card-hit"));
  assert.ok(app.includes("dailySelection"));
  assert.ok(app.includes('"hero"'));
  assert.ok(app.includes("hasNewStore"));
  assert.ok(app.includes("product-placeholder.svg"));
  assert.ok(html.includes("collection-under-10"));
  assert.ok(html.includes("Menos de 10 €"));
});

test("la página de promociones solo copia códigos reales y usa el redirector", () => {
  assert.ok(promotionsHtml.includes("data-copy-code") === false);
  assert.ok(promotionsHtml.includes("data-code-grid"));
  assert.ok(promotionsJs.includes("promotion.code"));
  assert.ok(promotionsJs.includes("data-copy-code"));
  assert.ok(promotionsJs.includes("promotionRedirectPath"));
  assert.ok(promotionsJs.includes("/data/promotions/awin.json"));
  assert.ok(promotionsJs.includes("/data/promotions/impact.json"));
  assert.ok(regionCore.includes("export function promotionRedirectPath"));
});

test("las tiendas activas tienen identidad visual local", () => {
  const branding = JSON.parse(storeBranding);
  assert.equal(branding.schemaVersion, 1);
  assert.ok(branding.stores.length >= 27);
  assert.ok(branding.stores.every((store) =>
    store.domain && store.logo.startsWith("/assets/brands/stores/")
  ));
  for (const id of [
    "clarel-es",
    "juguetesonline-es",
    "la-drogueria-es",
    "lenovo-es-553883",
    "lenovo-es-665754",
    "omara-jewelry-es",
    "paj-gps-es-pt",
    "perfumeria-comas-es",
    "trotec-iberic-es-pt"
  ]) {
    assert.ok(branding.stores.some((store) => store.id === id), id);
  }
  const lenovo = branding.stores.filter((store) => store.id.startsWith("lenovo-es-"));
  assert.ok(lenovo.length >= 2);
  assert.ok(lenovo.every((store) => store.groupId === "lenovo-es"));
});

test("todos los diálogos tienen nombre accesible", () => {
  const dialogs = [...html.matchAll(/<dialog\b([^>]*)>/g)].map((match) => match[1]);
  assert.ok(dialogs.length >= 5);
  assert.ok(dialogs.every((attributes) => /aria-(?:label|labelledby)=/.test(attributes)));
});


test("simplifica la ficha interior sin perder compra, variantes ni responsive", () => {
  assert.ok(app.includes('class="product-buy-summary"'));
  assert.ok(app.includes("data-select-variant-select"));
  assert.ok(app.includes('class="product-accordion"'));
  assert.equal(app.includes('class="offer-table"'), false);
  assert.ok(staticJs.includes("enhanceStandaloneProduct"));
  assert.ok(staticJs.includes("standalone-product-simplified"));
  assert.ok(css.includes("SecretShop — ficha de producto simplificada y adaptable"));
  assert.ok(css.includes("@media (min-width: 821px) and (max-width: 1080px)"));
  assert.ok(css.includes("@media (max-width: 380px)"));
  for (const key of ["whereToBuy", "moreInformation", "fullDescription", "productOptions"]) {
    assert.ok(i18n.includes(key), key);
  }
});


test("las variantes se presentan por atributos reales y sin opciones genéricas", () => {
  assert.ok(app.includes('from "./variant-system.js"'));
  assert.ok(staticJs.includes('from "./variant-system.js"'));
  for (const marker of [
    "buildVariantPresentation",
    "chooseVariantForAttribute",
    "variantValueAvailable",
    "bothBaskets",
    "availableSizes",
    "lengthFromToken"
  ]) {
    assert.ok(variantSystem.includes(marker), marker);
  }
  assert.ok(app.includes("data-variant-attribute"));
  assert.ok(staticJs.includes("data-static-variant-attribute"));
  assert.ok(css.includes(".product-variant-configurator"));
  assert.ok(css.includes(".variant-option-list.is-visual"));
  assert.ok(variantIndexScript.includes("const SHARDS = 32"));
  const manifest = JSON.parse(variantManifest);
  assert.equal(manifest.shards, 32);
  assert.equal(
    manifest.familyCount,
    manifest.files.reduce((total, file) => total + file.families, 0)
  );
  assert.ok(manifest.familyCount >= 1000);
});

test("la auditoría revisa todos los productos con opciones y no deja atributos sin resolver", () => {
  const audit = JSON.parse(variantAudit);
  assert.ok(audit.summary.uniqueFamiliesReviewed >= 4500);
  assert.ok(audit.summary.optionFamiliesReviewed >= 1600);
  assert.equal(audit.summary.familiesWithoutIdentifiableAttribute, 0);
  assert.ok(audit.summary.duplicatesGrouped >= 1000);
  for (const key of ["size", "color", "style", "configuration", "length", "dimensions", "material"]) {
    assert.ok(audit.summary.controlsByAttribute[key] > 0, key);
  }
});

test("las tarjetas exteriores conservan imágenes legibles en móviles pequeños y tablets", () => {
  assert.ok(css.includes("SecretShop — variantes comprensibles y tarjetas móviles visibles"));
  assert.ok(css.includes("@media (max-width: 820px)"));
  assert.ok(css.includes("min-height: 164px"));
  assert.ok(css.includes("@media (max-width: 420px)"));
  assert.ok(css.includes("min-height: 220px"));
  assert.ok(css.includes("aspect-ratio: 4 / 3"));
  assert.ok(css.includes("grid-template-columns: minmax(0, 1fr)"));
  assert.ok(css.includes("object-fit: contain"));
});
