import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [index, packageJson, robots, sitemap] = await Promise.all([
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "package.json"), "utf8"),
  readFile(resolve(root, "robots.txt"), "utf8"),
  readFile(resolve(root, "sitemap.xml"), "utf8")
]);

test("la portada usa un único Analytics modular y datos estructurados globales", () => {
  assert.equal(index.includes("data-cf-beacon"), false);
  assert.ok(index.includes('"@type": "Organization"'));
  assert.ok(index.includes('"@type": "WebSite"'));
});

test("robots, sitemap y validación SEO forman parte del contrato de calidad", () => {
  assert.ok(robots.includes("Sitemap: https://getsecretshop.com/sitemap.xml"));
  assert.ok(sitemap.includes("https://getsecretshop.com/sitemap-global.xml"));
  assert.ok(sitemap.includes("https://getsecretshop.com/sitemap-es.xml"));
  const packageData = JSON.parse(packageJson);
  assert.equal(packageData.scripts["validate:seo"], "node scripts/validate-seo.mjs");
  assert.ok(packageData.scripts.quality.includes("npm run validate:seo"));
});

test("las fichas generadas incluyen WebPage y BreadcrumbList", async () => {
  const sitemapEs = await readFile(resolve(root, "sitemap-es.xml"), "utf8");
  const productUrl = [...sitemapEs.matchAll(/<loc>(https:\/\/getsecretshop\.com\/producto\/[^<]+)<\/loc>/g)][0]?.[1];
  assert.ok(productUrl, "debe existir al menos una ficha en el sitemap");
  const pathname = new URL(productUrl).pathname;
  const html = await readFile(resolve(root, `.${pathname}index.html`), "utf8");
  assert.ok(html.includes('"@type":"WebPage"'));
  assert.ok(html.includes('"@type":"BreadcrumbList"'));
});
