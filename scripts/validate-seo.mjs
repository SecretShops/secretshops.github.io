#!/usr/bin/env node

import { access, readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const domain = "https://getsecretshop.com";
const errors = [];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

function tagValues(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function jsonLdDocuments(html, name) {
  const documents = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      documents.push(JSON.parse(match[1]));
    } catch (error) {
      errors.push(`${name}: JSON-LD inválido (${error.message})`);
    }
  }
  return documents;
}

function collectTypes(value, output = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectTypes(item, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  const type = value["@type"];
  if (Array.isArray(type)) type.forEach((item) => output.add(item));
  else if (typeof type === "string") output.add(type);
  Object.values(value).forEach((item) => collectTypes(item, output));
  return output;
}

function sitemapLocations(xml) {
  return tagValues(xml, /<loc>([^<]+)<\/loc>/g);
}

function sitemapLastmods(xml) {
  return tagValues(xml, /<lastmod>([^<]+)<\/lastmod>/g);
}

function localPathForUrl(value) {
  const url = new URL(value);
  if (url.origin !== domain) return null;
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") return resolve(root, "index.html");
  if (pathname.endsWith("/")) return resolve(root, `.${pathname}index.html`);
  return resolve(root, `.${pathname}`);
}

const files = await walk(root);
const htmlFiles = files.filter((path) => extname(path) === ".html");
const htmlByCanonical = new Map();
let productPages = 0;
let productRichResultPages = 0;

for (const path of htmlFiles) {
  const name = relative(root, path);
  const html = await readFile(path, "utf8");
  const noindex = /<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
  const canonicals = tagValues(
    html,
    /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/gi
  );

  if (!noindex) {
    if (canonicals.length !== 1) {
      errors.push(`${name}: debe contener una única canonical`);
    } else {
      try {
        const canonical = new URL(canonicals[0]);
        if (canonical.origin !== domain || canonical.hash || canonical.search) {
          errors.push(`${name}: canonical no válida (${canonicals[0]})`);
        }
        if (htmlByCanonical.has(canonicals[0])) {
          errors.push(`${name}: canonical duplicada con ${htmlByCanonical.get(canonicals[0])}`);
        }
        htmlByCanonical.set(canonicals[0], name);
      } catch {
        errors.push(`${name}: canonical no es una URL absoluta`);
      }
    }
  }

  if (/data-cf-beacon/i.test(html)) {
    errors.push(`${name}: conserva un beacon manual; Analytics debe cargarse desde el módulo común`);
  }

  const types = collectTypes(jsonLdDocuments(html, name));
  if (name === "index.html") {
    if (!types.has("Organization")) errors.push("index.html: falta Organization en JSON-LD");
    if (!types.has("WebSite")) errors.push("index.html: falta WebSite en JSON-LD");
  }
  if (name.startsWith("producto/") || name.includes("/producto/")) {
    productPages += 1;
    if (!types.has("WebPage")) errors.push(`${name}: falta WebPage en JSON-LD`);
    if (!types.has("BreadcrumbList")) errors.push(`${name}: falta BreadcrumbList en JSON-LD`);
    if (types.has("Product")) {
      productRichResultPages += 1;
      const serialized = JSON.stringify(jsonLdDocuments(html, name));
      if (!serialized.includes('"@type":"AggregateOffer"')) {
        errors.push(`${name}: Product no contiene AggregateOffer`);
      }
      for (const field of ["priceCurrency", "lowPrice", "highPrice", "offerCount"]) {
        if (!serialized.includes(`"${field}":`)) {
          errors.push(`${name}: AggregateOffer no contiene ${field}`);
        }
      }
    }
  }
}

const analyticsPath = resolve(root, "assets/js/cloudflare-analytics.js");
if (!(await exists(analyticsPath))) {
  errors.push("falta assets/js/cloudflare-analytics.js");
} else {
  const analytics = await readFile(analyticsPath, "utf8");
  if (!analytics.includes("ab0e864b07f241f78f5583cb0370e0a7")) {
    errors.push("cloudflare-analytics.js: token no reconocido");
  }
}
for (const path of ["assets/js/region-core.js", "assets/js/static.js"]) {
  const source = await readFile(resolve(root, path), "utf8");
  if (!source.includes('import "./cloudflare-analytics.js"')) {
    errors.push(`${path}: no carga el módulo común de Analytics`);
  }
}

const robots = await readFile(resolve(root, "robots.txt"), "utf8");
if (!robots.includes(`Sitemap: ${domain}/sitemap.xml`)) {
  errors.push("robots.txt: falta la referencia al índice de sitemaps");
}

const sitemapIndexPath = resolve(root, "sitemap.xml");
const sitemapIndex = await readFile(sitemapIndexPath, "utf8");
const sitemapUrls = sitemapLocations(sitemapIndex);
if (!sitemapUrls.length) errors.push("sitemap.xml: no contiene sitemaps");
const allIndexedUrls = new Map();

for (const sitemapUrl of sitemapUrls) {
  const path = localPathForUrl(sitemapUrl);
  if (!path || !(await exists(path))) {
    errors.push(`sitemap.xml: referencia inexistente ${sitemapUrl}`);
    continue;
  }
  const xml = await readFile(path, "utf8");
  const locations = sitemapLocations(xml);
  const lastmods = sitemapLastmods(xml);
  if (locations.length > 50_000) errors.push(`${relative(root, path)}: supera 50.000 URLs`);
  if ((await stat(path)).size > 50 * 1024 * 1024) errors.push(`${relative(root, path)}: supera 50 MB`);
  if (locations.length !== lastmods.length) {
    errors.push(`${relative(root, path)}: cada URL debe tener lastmod`);
  }
  lastmods.forEach((value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      errors.push(`${relative(root, path)}: lastmod inválido ${value}`);
    }
  });

  for (const location of locations) {
    if (allIndexedUrls.has(location)) {
      errors.push(`${relative(root, path)}: URL duplicada con ${allIndexedUrls.get(location)} (${location})`);
    }
    allIndexedUrls.set(location, relative(root, path));
    const htmlPath = localPathForUrl(location);
    if (!htmlPath || !(await exists(htmlPath))) {
      errors.push(`${relative(root, path)}: URL sin archivo publicado ${location}`);
      continue;
    }
    const html = await readFile(htmlPath, "utf8");
    if (/<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html)) {
      errors.push(`${relative(root, path)}: incluye una página noindex (${location})`);
    }
    const canonical = tagValues(
      html,
      /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/gi
    )[0];
    if (canonical !== location) {
      errors.push(`${relative(root, path)}: canonical no coincide con ${location}`);
    }
  }
}

const productUrls = [...allIndexedUrls.keys()].filter((url) => new URL(url).pathname.includes("/producto/"));
if (productUrls.length !== productPages) {
  errors.push(`sitemap: ${productUrls.length} fichas incluidas frente a ${productPages} fichas publicadas`);
}
if (productRichResultPages === 0) {
  errors.push("ninguna ficha de variante única con precio contiene Product y AggregateOffer");
}

const seoStatePath = resolve(root, "data/config/seo-state.json");
if (!(await exists(seoStatePath))) {
  errors.push("falta data/config/seo-state.json");
} else {
  try {
    const state = JSON.parse(await readFile(seoStatePath, "utf8"));
    if (state.schemaVersion !== 1 || !state.pages || !Object.keys(state.pages).length) {
      errors.push("seo-state.json: estructura inválida");
    }
  } catch (error) {
    errors.push(`seo-state.json: JSON inválido (${error.message})`);
  }
}

if (errors.length) {
  console.error(`Validación SEO: ${errors.length} errores`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(
    `SEO válido: ${htmlFiles.length} páginas, ${productPages} fichas con BreadcrumbList, ${productRichResultPages} fichas exactas elegibles para Product/AggregateOffer, ${allIndexedUrls.size} URLs en sitemaps y Analytics sin duplicados.`
  );
}
