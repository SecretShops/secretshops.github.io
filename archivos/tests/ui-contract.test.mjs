import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [html, css, app, i18n, regionCore, regions, storeBranding, portugalHome] = await Promise.all([
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "assets/css/app.css"), "utf8"),
  readFile(resolve(root, "assets/js/app.js"), "utf8"),
  readFile(resolve(root, "assets/js/i18n.js"), "utf8"),
  readFile(resolve(root, "assets/js/region-core.js"), "utf8"),
  readFile(resolve(root, "data/config/regions.json"), "utf8"),
  readFile(resolve(root, "data/config/store-branding.json"), "utf8"),
  readFile(resolve(root, "pt/index.html"), "utf8")
]);

test("conserva la dirección visual y el texto aprobados", () => {
  assert.ok(html.includes("Compara antes de comprar. <span>Decide mejor.</span>"));
  assert.ok(html.includes("Busca productos, marcas o categorías"));
  assert.ok(html.includes("Podemos recibir una comisión por algunas compras, sin coste adicional para ti."));
  assert.ok(css.includes("--brand-primary: #1f1f1f"));
  assert.ok(css.includes("--brand-secondary: #fee97d"));
  assert.ok(html.includes("secretshop-logo-compact.png"));
  assert.ok(html.includes("secretshop-logo-original.png"));
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
});

test("mantiene las categorías móviles legibles, jerarquizadas y accesibles", () => {
  assert.ok(app.includes("const DIRECTORY_CATEGORIES = ["));
  for (const category of [
    '"Tecnología"',
    '"Moda"',
    '"Hogar"',
    '"Belleza y cuidado"',
    '"Deportes"',
    '"Familia y ocio"',
    '"Aventura y viajes"',
    '"Motor"',
    '"Mascotas"'
  ]) {
    assert.ok(app.includes(category), category);
  }
  assert.ok(app.includes('"Moda y accesorios"'));
  assert.ok(app.includes("function productCountLabel"));
  assert.ok(app.includes("candidate.getClientRects().length > 0"));
  assert.ok(app.includes("input.focus({ preventScroll: true })"));
  assert.ok(app.includes('setAttribute("aria-current", "page")'));
  assert.ok(css.includes('body[data-page-kind="categories"] .category-directory-grid .category-card'));
  assert.ok(css.includes('@media (max-width: 1180px), (hover: none) and (pointer: coarse)'));
  assert.ok(css.includes("grid-template-columns: 76px minmax(0, 1fr) auto"));
  assert.ok(css.includes('body[data-page-kind="category"] .subcategory-grid'));
  assert.ok(css.includes("grid-auto-flow: column"));
  assert.ok(css.includes('body[data-page-kind="category"] [data-context-deals-section]'));
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

test("las tiendas activas tienen identidad visual local", () => {
  const branding = JSON.parse(storeBranding);
  assert.equal(branding.schemaVersion, 1);
  assert.equal(branding.stores.length, 18);
  assert.ok(branding.stores.every((store) =>
    store.domain && store.logo.startsWith("/assets/brands/stores/")
  ));
});

test("todos los diálogos tienen nombre accesible", () => {
  const dialogs = [...html.matchAll(/<dialog\b([^>]*)>/g)].map((match) => match[1]);
  assert.ok(dialogs.length >= 5);
  assert.ok(dialogs.every((attributes) => /aria-(?:label|labelledby)=/.test(attributes)));
});
