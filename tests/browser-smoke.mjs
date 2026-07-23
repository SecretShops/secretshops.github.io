#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
const browser = await chromium.launch({ headless: true });
const failures = [];

async function inspectPage(page, label) {
  page.on("pageerror", (error) => failures.push(`${label}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`${label}: consola: ${message.text()}`);
  });
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await inspectPage(desktop, "desktop");
  await desktop.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await desktop.locator("[data-catalog-status].is-ready, [data-catalog-status].is-warning").waitFor();
  await desktop.locator("[data-catalog-grid] .product-card").first().waitFor();

  const initialCards = await desktop.locator("[data-catalog-grid] .product-card").count();
  if (initialCards !== 24) failures.push(`desktop: se esperaban 24 tarjetas iniciales y hay ${initialCards}`);

  await desktop.locator("#header-search").fill("UGREEN");
  await desktop.locator(".header-search").press("Enter");
  await desktop.locator("[data-results-summary]").filter({ hasText: "familia" }).waitFor();
  const searchedCards = await desktop.locator("[data-catalog-grid] .product-card").count();
  if (searchedCards < 1 || searchedCards > 5) {
    failures.push(`desktop: búsqueda UGREEN devolvió ${searchedCards} tarjetas`);
  }

  await desktop.locator("[data-catalog-grid] [data-open-family]").first().click();
  await desktop.locator("#product-dialog[open]").waitFor();
  await desktop.locator("#product-dialog .offer-link").first().waitFor();
  const outbound = await desktop.locator("#product-dialog .offer-link").first().getAttribute("href");
  if (!outbound?.startsWith("./go.html?offer=")) failures.push("desktop: la oferta no usa el redirector validado");
  await desktop.locator("#product-dialog [data-close-product]").click();

  await desktop.locator("[data-clear-filters]").first().click();
  await desktop.locator("[data-catalog-grid] .product-card").first().waitFor();
  await desktop.locator("[data-catalog-grid] [data-toggle-favorite]").first().click();
  const favoriteCount = await desktop.locator("[data-favorite-count]").first().textContent();
  if (favoriteCount !== "1") failures.push(`desktop: contador de favoritos inesperado (${favoriteCount})`);

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
      `desktop: accesibilidad ${serious.map((violation) => `${violation.id}(${violation.nodes.length})`).join(", ")}`
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
  await mobile.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await mobile.evaluate(() => localStorage.clear());
  await mobile.reload({ waitUntil: "domcontentloaded" });
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
      `mobile: accesibilidad ${mobileSerious.map((violation) => `${violation.id}(${violation.nodes.length})`).join(", ")}`
    );
  }
  await mobile.close();
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

if (failures.length) {
  console.error(`Pruebas de navegador: ${failures.length} incidencias`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("Pruebas de navegador: escritorio, móvil, búsqueda, ficha, favoritos, comparador, tema y accesibilidad OK.");
}
