#!/usr/bin/env node

import { access, readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const warnings = [];

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

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function localReference(value) {
  if (
    !value ||
    value.startsWith("#") ||
    /^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(value)
  ) {
    return null;
  }
  return value.split("#")[0].split("?")[0];
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

const files = await walk(root);
const htmlFiles = files.filter((path) => extname(path) === ".html");
const cssFiles = files.filter((path) => extname(path) === ".css");
const javascriptFiles = files.filter((path) => [".js", ".mjs"].includes(extname(path)));

for (const path of htmlFiles) {
  const name = relative(root, path);
  const html = await readFile(path, "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = duplicateValues(ids);
  if (duplicateIds.length) {
    errors.push(`${name}: IDs duplicados (${duplicateIds.join(", ")})`);
  }
  if (!/<html\b[^>]*\blang="es"/i.test(html)) errors.push(`${name}: falta lang="es"`);
  if (!/<meta\b[^>]*name="viewport"/i.test(html)) errors.push(`${name}: falta viewport`);
  if (!/<meta\b[^>]*name="description"/i.test(html)) errors.push(`${name}: falta descripción`);
  if (!/<title>[^<]+<\/title>/i.test(html)) errors.push(`${name}: falta title`);
  if (/data:image\/|;base64,/i.test(html)) errors.push(`${name}: contiene recursos base64 embebidos`);
  const noindex = /<meta\b[^>]*name="robots"[^>]*content="[^"]*noindex/i.test(html);
  if (!noindex && !/<link\b[^>]*rel="canonical"[^>]*href="https:\/\/secretshops\.github\.io\//i.test(html)) {
    errors.push(`${name}: falta canonical absoluto`);
  }

  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const reference = localReference(match[1]);
    if (!reference) continue;
    let target = resolve(dirname(path), decodeURIComponent(reference));
    if (await exists(target)) {
      const targetStat = await stat(target);
      if (targetStat.isDirectory()) target = resolve(target, "index.html");
    }
    if (!(await exists(target))) {
      errors.push(`${name}: referencia local inexistente ${match[1]}`);
    }
  }
}

for (const path of cssFiles) {
  const name = relative(root, path);
  const source = await readFile(path, "utf8");
  if (/@import\s+url\(["']?https?:/i.test(source)) {
    errors.push(`${name}: importa CSS remoto`);
  }
  for (const match of source.matchAll(/\burl\((["']?)([^"')]+)\1\)/g)) {
    const reference = localReference(match[2]);
    if (!reference) continue;
    const target = resolve(dirname(path), decodeURIComponent(reference));
    if (!(await exists(target))) errors.push(`${name}: recurso local inexistente ${match[2]}`);
  }
}

for (const path of javascriptFiles) {
  const name = relative(root, path);
  const source = await readFile(path, "utf8");
  for (const match of source.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)) {
    const target = resolve(dirname(path), match[1]);
    if (!(await exists(target))) errors.push(`${name}: import inexistente ${match[1]}`);
  }
}

for (const legacy of [
  "styles-v2.css",
  "catalog-base.js",
  "catalog-aliexpress-mx.js",
  "catalog-aliexpress-co.js",
  "catalog-temu.js",
  "catalog-comparisons.js",
  "wrangler.jsonc",
  "data/catalog/catalog-runtime.json",
  "scripts/secretshop-v2.js",
  "scripts/catalog-bootstrap.js",
  "scripts/catalog-loader.js",
  "scripts/catalog-ui-adapter.js"
]) {
  if (await exists(resolve(root, legacy))) {
    errors.push(`archivo obsoleto presente: ${legacy}`);
  }
}

const indexPath = resolve(root, "index.html");
const index = await readFile(indexPath, "utf8");
const indexSize = (await stat(indexPath)).size;
if (indexSize > 90_000) errors.push(`index.html demasiado grande: ${indexSize} bytes`);
for (const legacy of [
  "styles-v2.css",
  "secretshop-v2.js",
  "catalog-base.js",
  "catalog-aliexpress-mx.js",
  "catalog-aliexpress-co.js",
  "catalog-temu.js",
  "catalog-comparisons.js"
]) {
  if (index.includes(legacy)) errors.push(`index.html conserva referencia obsoleta: ${legacy}`);
}
if (!index.includes("Compara antes de comprar. <span>Decide mejor.</span>")) {
  errors.push("index.html: falta el titular aprobado");
}
if (!index.includes("Podemos recibir una comisión por algunas compras, sin coste adicional para ti.")) {
  errors.push("index.html: falta el aviso de afiliación aprobado");
}
if (!(await exists(resolve(root, "robots.txt")))) errors.push("falta robots.txt");
if (!(await exists(resolve(root, "sitemap.xml")))) errors.push("falta sitemap.xml");

for (const path of htmlFiles) {
  const html = await readFile(path, "utf8");
  if (/\bAwin\b/i.test(html)) {
    warnings.push(`${relative(root, path)} menciona públicamente una red de afiliación`);
  }
}

if (errors.length) {
  console.error(`Validación del sitio: ${errors.length} errores`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(
    `Sitio válido: ${htmlFiles.length} páginas HTML, ${javascriptFiles.length} archivos JavaScript y 0 referencias locales rotas.`
  );
}

if (warnings.length) {
  warnings.forEach((warning) => console.warn(`Aviso: ${warning}`));
}
