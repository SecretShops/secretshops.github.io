#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const regionsConfig = JSON.parse(
  await readFile(resolve(root, "data/config/regions.json"), "utf8")
);
const expectedPublishedRegions = regionsConfig.regions.filter(
  (region) => region.status === "published"
).length;
const require = createRequire(import.meta.url);
const playwright = await import(pathToFileURL(require.resolve("playwright")));
const axe = require("axe-core");
const { chromium } = playwright.default || playwright;
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

async function localFile(pathname) {
  const decoded = decodeURIComponent(pathname);
  let candidate = resolve(root, `.${decoded}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return null;
  try {
    const info = await stat(candidate);
    if (info.isDirectory()) candidate = resolve(candidate, "index.html");
    await access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const file = await localFile(url.pathname);
  if (!file) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": mime[extname(file)] || "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(file).pipe(response);
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}/`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined
});
const failures = [];
let productPathname = "";

async function inspectPage(page, label) {
  page.on("pageerror", (error) => failures.push(`${label}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`${label}: consola: ${message.text()}`);
  });
}

async function isolateExternalImages(page) {
  const localOrigin = new URL(baseUrl).origin;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.resourceType() === "image" && url.origin !== localOrigin) {
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
      });
      return;
    }
    await route.continue();
  });
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await inspectPage(desktop, "desktop");
  await isolateExternalImages(desktop);
  await desktop.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await desktop.locator("[data-catalog-grid] .product-card").first().waitFor();

  const initialCards = await desktop.locator("[data-catalog-grid] .product-card").count();
  if (initialCards !== 24) failures.push(`desktop: se esperaban 24 tarjetas iniciales y hay ${initialCards}`);

  await desktop.getByRole("button", { name: "Categorías", exact: true }).click();
  await desktop.locator("[data-nav-categories] a").first().waitFor();
  if (!(await desktop.locator("[data-nav-categories]").isVisible())) {
    failures.push("desktop: el menú de categorías no se fija al hacer clic");
  }
  await desktop.keyboard.press("Escape");

  await desktop.locator(".region-menu [data-pin-menu]").click();
  await desktop.locator("[data-nav-regions] a").first().waitFor();
  const desktopCountries = await desktop.locator("[data-nav-regions] a").count();
  const desktopFlags = await desktop.locator("[data-nav-regions] .region-nav-flag").count();
  if (desktopCountries !== expectedPublishedRegions || desktopFlags !== expectedPublishedRegions) {
    failures.push(
      `desktop: el selector muestra ${desktopCountries} países y ${desktopFlags} banderas`
    );
  }
  await desktop.keyboard.press("Escape");

  const searchTarget = (await desktop.locator("[data-catalog-grid] .product-card h3").first().textContent())?.trim();
  if (!searchTarget) throw new Error("desktop: no se pudo obtener un producto para probar la búsqueda");
  await desktop.locator("#header-search").fill(searchTarget);
  await desktop.locator(".header-search").press("Enter");
  await desktop.locator("[data-catalog-grid] .product-card").first().waitFor();
  await desktop.locator("[data-results-summary]").filter({ hasText: "producto" }).waitFor();
  const searchedCards = await desktop.locator("[data-catalog-grid] .product-card").count();
  if (searchedCards < 1 || searchedCards > 5) {
    failures.push(`desktop: la búsqueda del primer producto devolvió ${searchedCards} tarjetas`);
  }

  await desktop.locator("[data-catalog-grid] .product-card-hit").first().click();
  await desktop.locator("#product-dialog[open]").waitFor();
  productPathname = new URL(desktop.url()).pathname;
  if (!productPathname.startsWith("/producto/")) {
    failures.push("desktop: la ficha no usa una URL de producto real");
  }
  await desktop.locator("#product-dialog .offer-link").first().waitFor();
  const outbound = await desktop.locator("#product-dialog .offer-link").first().getAttribute("href");
  if (!outbound?.startsWith("/go.html?region=es&offer=")) {
    failures.push("desktop: la oferta no usa el redirector regional validado");
  }
  await desktop.locator("#product-dialog [data-close-product]").click();
  if (new URL(desktop.url()).pathname !== "/") {
    failures.push("desktop: cerrar la ficha no restaura la portada regional");
  }

  await desktop.locator(".nav-filter-menu [data-pin-menu]").click();
  await desktop.locator(".header-filter-dropdown [data-clear-filters]").click();
  await desktop.locator("[data-catalog-grid] .product-card").first().waitFor();
  await desktop.locator("[data-catalog-grid] [data-toggle-favorite]").first().click();
  const favoriteCount = await desktop.locator("[data-favorite-count]").first().textContent();
  if (favoriteCount !== "1") failures.push(`desktop: contador de favoritos inesperado (${favoriteCount})`);
  const storageKeys = await desktop.evaluate(() => Object.keys(localStorage));
  if (!storageKeys.includes("secretshop:es:favorites:v2")) {
    failures.push("desktop: favoritos no están aislados por región");
  }

  await desktop.locator("[data-catalog-grid] [data-toggle-compare]").nth(0).click();
  await desktop.locator("[data-catalog-grid] [data-toggle-compare]").nth(1).click();
  await desktop.locator("[data-compare-tray]:not([hidden])").waitFor();
  await desktop.locator("[data-open-compare]").click();
  await desktop.locator("#compare-dialog[open] .comparison-table").waitFor();
  const comparisonColumns = await desktop.locator("#compare-dialog .compare-product-head").count();
  if (comparisonColumns !== 2) failures.push(`desktop: comparador contiene ${comparisonColumns} columnas`);
  await desktop.locator("#compare-dialog [data-close-dialog]").click();

  await desktop.locator("[data-theme-toggle]").first().click();
  if ((await desktop.locator("html").getAttribute("data-theme")) !== "dark") {
    failures.push("desktop: el modo oscuro no se activó");
  }

  await desktop.addScriptTag({ content: axe.source });
  const accessibility = await desktop.evaluate(async () =>
    window.axe.run(document, {
      resultTypes: ["violations"],
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
    })
  );
  const serious = accessibility.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact)
  );
  if (serious.length) {
    failures.push(
      `desktop: accesibilidad ${serious.map((violation) =>
        `${violation.id}(${violation.nodes.length}: ${violation.nodes
          .slice(0, 8)
          .map((node) => node.target.join(" "))
          .join(" | ")})`
      ).join(", ")}`
    );
  }

  const resources = await desktop.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => entry.name)
  );
  if (resources.some((url) => /catalog-(?:base|aliexpress|temu|comparisons)\.js/.test(url))) {
    failures.push("desktop: se cargó un catálogo JavaScript obsoleto");
  }
  await desktop.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await inspectPage(mobile, "mobile");
  await isolateExternalImages(mobile);
  await mobile.addInitScript(() => localStorage.clear());
  await mobile.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await mobile.locator("[data-catalog-grid] .product-card").first().waitFor();
  if (!(await mobile.locator("[data-menu-toggle]").isVisible())) {
    failures.push("mobile: el botón de menú no es visible");
  }
  await mobile.locator("[data-menu-toggle]").click();
  await mobile.locator("#menu-dialog[open]").waitFor();
  await mobile.locator("#menu-dialog [data-close-dialog]").click();
  const columns = await mobile.locator("[data-catalog-grid]").evaluate((node) =>
    getComputedStyle(node).gridTemplateColumns.split(" ").length
  );
  if (columns !== 2) failures.push(`mobile: la cuadrícula usa ${columns} columnas`);
  const homeCategoryColumns = await mobile.locator("[data-category-grid]").evaluate((node) =>
    getComputedStyle(node).gridTemplateColumns.split(" ").length
  );
  if (homeCategoryColumns !== 1) {
    failures.push(`mobile: las categorías de portada usan ${homeCategoryColumns} columnas`);
  }
  if (!(await mobile.locator(".mobile-bottom-nav").isVisible())) {
    failures.push("mobile: la navegación inferior no es visible");
  }
  const visibleMobileBottomActions = await mobile.locator(".mobile-bottom-nav > *:visible").count();
  if (visibleMobileBottomActions !== 5) {
    failures.push(`mobile: la navegación inferior visible contiene ${visibleMobileBottomActions} acciones`);
  }
  if (await mobile.locator("[data-featured-grid]").isVisible()) {
    failures.push("mobile: la sección SecretScore sigue visible en la interfaz mínima");
  }
  const mobilePromotions = await mobile.locator(".mobile-bottom-nav [data-region-promotions]").getAttribute("href");
  if (!mobilePromotions?.startsWith("/promociones/?region=es")) {
    failures.push("mobile: DTO y cupones no abre las promociones regionales");
  }
  if (!(await mobile.locator(".header-actions [data-theme-toggle]").isVisible())) {
    failures.push("mobile: el selector de tema no es visible");
  }

  await mobile.locator("[data-catalog-grid] .product-card-hit").first().click();
  await mobile.locator("#product-dialog[open]").waitFor();
  const mobileOverflow = await mobile.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth ||
    document.querySelector("#product-dialog").scrollWidth >
      document.querySelector("#product-dialog").clientWidth
  );
  if (mobileOverflow) failures.push("mobile: la ficha de producto desborda horizontalmente");
  await mobile.locator("#product-dialog [data-close-product]").click();

  await mobile.locator("[data-catalog-sentinel]").scrollIntoViewIfNeeded();
  await mobile.waitForFunction(() =>
    document.querySelectorAll("[data-catalog-grid] .product-card").length > 24
  );
  const expandedCards = await mobile.locator("[data-catalog-grid] .product-card").count();
  if (expandedCards <= 24) failures.push("mobile: el catálogo infinito no cargó más productos");

  await mobile.locator("[data-catalog-grid] [data-toggle-compare]").nth(0).click();
  await mobile.locator("[data-catalog-grid] [data-toggle-compare]").nth(1).click();
  await mobile.locator("[data-open-compare]").click();
  await mobile.locator("#compare-dialog[open] .comparison-cards").waitFor();
  const mobileComparisonCards = await mobile.locator("#compare-dialog .comparison-card").count();
  if (mobileComparisonCards !== 2) {
    failures.push(`mobile: el comparador contiene ${mobileComparisonCards} tarjetas`);
  }
  if (await mobile.locator("#compare-dialog .comparison-scroll").isVisible()) {
    failures.push("mobile: la tabla de escritorio sigue visible en el comparador");
  }
  await mobile.locator("#compare-dialog [data-close-dialog]").click();

  await mobile.goto(new URL("/categorias/", baseUrl).href, { waitUntil: "domcontentloaded" });
  await mobile.locator("[data-category-directory-grid] .category-card").first().waitFor();
  const directoryCategoryColumns = await mobile
    .locator("[data-category-directory-grid]")
    .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
  if (directoryCategoryColumns !== 1) {
    failures.push(`mobile: el directorio de categorías usa ${directoryCategoryColumns} columnas`);
  }
  const directoryCategoryOverflow = await mobile.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth ||
    document.querySelector("[data-category-directory-grid]").scrollWidth >
      document.querySelector("[data-category-directory-grid]").clientWidth
  );
  if (directoryCategoryOverflow) {
    failures.push("mobile: el directorio de categorías desborda horizontalmente");
  }
  await mobile.locator(".mobile-bottom-nav [data-focus-search]").click();
  await mobile.locator("#hero-search").waitFor({ state: "visible" });
  const focusedMobileSearch = await mobile.evaluate(() => document.activeElement?.id);
  if (focusedMobileSearch !== "hero-search" || new URL(mobile.url()).pathname !== "/") {
    failures.push("mobile: el botón Buscar no vuelve a la portada ni enfoca el buscador");
  }

  await mobile.addScriptTag({ content: axe.source });
  const mobileAccessibility = await mobile.evaluate(async () =>
    window.axe.run(document, {
      resultTypes: ["violations"],
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
    })
  );
  const mobileSerious = mobileAccessibility.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact)
  );
  if (mobileSerious.length) {
    failures.push(
      `mobile: accesibilidad ${mobileSerious.map((violation) =>
        `${violation.id}(${violation.nodes.length}: ${violation.nodes
          .slice(0, 8)
          .map((node) => node.target.join(" "))
          .join(" | ")})`
      ).join(", ")}`
    );
  }
  await mobile.close();

  const tablet = await browser.newPage({ viewport: { width: 768, height: 1024 }, isMobile: true });
  await inspectPage(tablet, "tablet");
  await isolateExternalImages(tablet);
  await tablet.goto(new URL("/categorias/", baseUrl).href, { waitUntil: "domcontentloaded" });
  await tablet.locator("[data-category-directory-grid] .category-card").first().waitFor();
  const tabletCategoryColumns = await tablet
    .locator("[data-category-directory-grid]")
    .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
  if (tabletCategoryColumns !== 1) {
    failures.push(`tablet: el directorio de categorías usa ${tabletCategoryColumns} columnas`);
  }
  await tablet.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await tablet.locator("[data-catalog-grid] .product-card-hit").first().waitFor();
  await tablet.locator("[data-catalog-grid] .product-card-hit").first().click();
  await tablet.locator("#product-dialog[open]").waitFor();
  const tabletOverflow = await tablet.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth ||
    document.querySelector("#product-dialog").getBoundingClientRect().right > window.innerWidth
  );
  if (tabletOverflow) failures.push("tablet: la ficha de producto desborda horizontalmente");
  await tablet.close();

  const compactMobile = await browser.newPage({
    viewport: { width: 320, height: 568 },
    isMobile: true
  });
  await inspectPage(compactMobile, "mobile-320");
  await isolateExternalImages(compactMobile);
  await compactMobile.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await compactMobile.locator("[data-catalog-grid] .product-card").first().waitFor();
  const compactOverflow = await compactMobile.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth
  );
  if (compactOverflow) failures.push("mobile-320: la portada desborda horizontalmente");
  const compactCategoryColumns = await compactMobile
    .locator("[data-category-grid]")
    .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
  if (compactCategoryColumns !== 1) {
    failures.push(`mobile-320: las categorías usan ${compactCategoryColumns} columnas`);
  }
  if (!(await compactMobile.locator("[data-menu-toggle]").isVisible())) {
    failures.push("mobile-320: el botón de menú no es visible");
  }
  if (!(await compactMobile.locator(".mobile-bottom-nav").isVisible())) {
    failures.push("mobile-320: la navegación inferior no es visible");
  }
  await compactMobile.close();

  const architecture = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await inspectPage(architecture, "arquitectura");
  await isolateExternalImages(architecture);
  await architecture.goto(new URL("/paises/", baseUrl).href, { waitUntil: "domcontentloaded" });
  const publishedCountries = await architecture.locator(".country-card").count();
  if (publishedCountries !== expectedPublishedRegions) {
    failures.push(`arquitectura: el selector muestra ${publishedCountries} países publicados`);
  }
  if (await architecture.locator('a[href^="/mx/"], a[href^="/co/"]').count()) {
    failures.push("arquitectura: el selector expone una región draft");
  }
  await architecture.addScriptTag({ content: axe.source });
  const selectorAccessibility = await architecture.evaluate(async () =>
    window.axe.run(document, {
      resultTypes: ["violations"],
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
    })
  );
  const selectorSerious = selectorAccessibility.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact)
  );
  if (selectorSerious.length) {
    failures.push(
      `arquitectura: selector ${selectorSerious.map((violation) => `${violation.id}(${violation.nodes.length})`).join(", ")}`
    );
  }

  await architecture.goto(new URL("/categorias/", baseUrl).href, { waitUntil: "domcontentloaded" });
  await architecture.locator("[data-category-directory-grid] .category-card").first().waitFor();
  if (await architecture.locator("#catalogo").isVisible()) {
    failures.push("arquitectura: el directorio de categorías muestra el catálogo genérico");
  }
  await architecture.locator("[data-category-directory-grid] .category-card").first().click();
  await architecture.locator("[data-subcategory-section]").waitFor();
  if (!new URL(architecture.url()).pathname.startsWith("/categorias/")) {
    failures.push("arquitectura: la categoría no usa una ruta real");
  }

  await architecture.goto(new URL("/tiendas/muebles-style-spain/", baseUrl).href, { waitUntil: "domcontentloaded" });
  await architecture.locator("[data-store-hero]").waitFor();
  const storeOverflow = await architecture.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth
  );
  if (storeOverflow) failures.push("arquitectura: Muebles Style provoca desbordamiento horizontal");

  await architecture.goto(new URL("/pt/", baseUrl).href, { waitUntil: "domcontentloaded" });
  await architecture.locator("[data-catalog-grid] .product-card").first().waitFor();
  const portugueseLabels = await architecture.locator(".mobile-bottom-nav").textContent();
  if (!portugueseLabels?.includes("Categorias") || !portugueseLabels.includes("Lojas")) {
    failures.push("arquitectura: la interfaz portuguesa conserva etiquetas españolas");
  }

  await architecture.goto(new URL("/de/", baseUrl).href, { waitUntil: "domcontentloaded" });
  await architecture.locator("[data-catalog-grid] .product-card").first().waitFor();
  const germanNavigation = await architecture.locator(".primary-nav").textContent();
  if (!germanNavigation?.includes("Kategorien") || !germanNavigation.includes("Aktionen")) {
    failures.push("arquitectura: la interfaz alemana conserva la navegación española");
  }

  await architecture.goto(new URL("/promociones/?region=es", baseUrl).href, {
    waitUntil: "domcontentloaded"
  });
  await architecture.locator("[data-discount-grid]").waitFor();
  await architecture.waitForFunction(() =>
    !document.querySelector("[data-discount-grid] .promotion-loading") ||
    document.querySelector("[data-discount-grid]").textContent.includes("No hay")
  );
  const invalidCopyButtons = await architecture.locator("[data-copy-code]").evaluateAll((buttons) =>
    buttons.filter((button) => !button.dataset.copyCode?.trim()).length
  );
  if (invalidCopyButtons) {
    failures.push(`arquitectura: hay ${invalidCopyButtons} botones para copiar códigos vacíos`);
  }

  await architecture.goto(new URL(productPathname, baseUrl).href, { waitUntil: "domcontentloaded" });
  await architecture.locator(".standalone-product").waitFor();
  const canonical = await architecture.locator('link[rel="canonical"]').getAttribute("href");
  if (!canonical?.endsWith(productPathname)) {
    failures.push("arquitectura: la ficha estática no tiene un canonical propio");
  }
  const staticOutbound = await architecture.locator(".standalone-offer .offer-link").first().getAttribute("href");
  if (!staticOutbound?.startsWith("/go.html?region=es&offer=")) {
    failures.push("arquitectura: la ficha estática no usa el redirector regional");
  }
  await architecture.addScriptTag({ content: axe.source });
  const productAccessibility = await architecture.evaluate(async () =>
    window.axe.run(document, {
      resultTypes: ["violations"],
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }
    })
  );
  const productSerious = productAccessibility.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact)
  );
  if (productSerious.length) {
    failures.push(
      `arquitectura: ficha ${productSerious.map((violation) => `${violation.id}(${violation.nodes.length})`).join(", ")}`
    );
  }
  await architecture.close();
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

if (failures.length) {
  console.error(`Pruebas de navegador: ${failures.length} incidencias`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("Pruebas de navegador: escritorio, móvil, tablet, promociones, selector regional, ficha SEO, búsqueda, favoritos, comparador, tema y accesibilidad OK.");
}
