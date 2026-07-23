import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAmazonAffiliateUrl,
  extractAsin,
  parseCsv,
  parseLooseAmazonInput,
  validateAmazonAffiliateUrl
} from "../scripts/lib/amazon-associates-core.mjs";

const TAG = "christian0ddd-21";

test("extrae ASIN de formatos habituales de Amazon España", () => {
  assert.equal(extractAsin("B0ABC12345"), "B0ABC12345");
  assert.equal(extractAsin("https://www.amazon.es/dp/B0ABC12345/ref=something?th=1"), "B0ABC12345");
  assert.equal(extractAsin("https://amazon.es/gp/product/B0ABC12345?psc=1"), "B0ABC12345");
  assert.equal(extractAsin("https://www.amazon.es/gp/aw/d/B0ABC12345"), "B0ABC12345");
  assert.equal(extractAsin("https://example.com/dp/B0ABC12345"), null);
  assert.equal(extractAsin("https://amzn.to/ejemplo"), null);
});

test("genera un enlace afiliado canónico con el tag configurado", () => {
  const url = buildAmazonAffiliateUrl("B0ABC12345", TAG);
  assert.equal(url, "https://www.amazon.es/dp/B0ABC12345/ref=nosim?tag=christian0ddd-21");
  assert.equal(validateAmazonAffiliateUrl(url, TAG), url);
  assert.equal(validateAmazonAffiliateUrl(url, "otro-tag-21"), null);
});

test("deduplica entradas y omite comentarios", () => {
  const result = parseLooseAmazonInput(`
# comentario
B0ABC12345
https://www.amazon.es/dp/B0ABC12345
https://www.amazon.es/dp/B012345678
entrada-invalida
`);
  assert.deepEqual(result.accepted.map((item) => item.asin), ["B0ABC12345", "B012345678"]);
  assert.equal(result.rejected.length, 1);
});

test("lee CSV con comas y comillas", () => {
  const rows = parseCsv('asin_or_url,title\nB0ABC12345,"Producto, edición especial"\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Producto, edición especial");
  assert.equal(rows[0].__row, 2);
});
