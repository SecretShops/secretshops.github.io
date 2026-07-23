import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCapturedImages,
  extractAsin,
  parseCsv,
  parseSiteStripePayload,
  serializeCsv
} from "../assets/js/sitestripe-assistant-core.js";

const sitestripeCode = `
<a href="https://www.amazon.es/dp/B0ABC12345?tag=christian0ddd-21">
  <img
    src="//ws-eu.amazon-adsystem.com/widgets/q?_encoding=UTF8&amp;ASIN=B0ABC12345&amp;Format=_SL250_&amp;ID=AsinImage&amp;MarketPlace=ES&amp;ServiceVersion=20070822&amp;WS=1&amp;tag=christian0ddd-21"
    alt="Producto de prueba">
</a>`;

test("extrae ASIN desde código, URL y valor directo", () => {
  assert.equal(extractAsin("B0ABC12345"), "B0ABC12345");
  assert.equal(
    extractAsin("https://www.amazon.es/dp/B0ABC12345?tag=christian0ddd-21"),
    "B0ABC12345"
  );
  assert.equal(extractAsin("sin asin"), null);
});

test("valida código de Imagen de SiteStripe y normaliza su URL", () => {
  const result = parseSiteStripePayload(sitestripeCode, "B0ABC12345");
  assert.equal(result.asin, "B0ABC12345");
  assert.match(result.imageUrl, /^https:\/\/ws-eu\.amazon-adsystem\.com\/widgets\/q\?/);
  assert.match(result.imageUrl, /ASIN=B0ABC12345/);
  assert.match(result.amazonUrl, /amazon\.es\/dp\/B0ABC12345/);
});

test("rechaza el código cuando pertenece a otro producto", () => {
  assert.throws(
    () => parseSiteStripePayload(sitestripeCode, "B0XYZ67890"),
    /pertenece al ASIN B0ABC12345/
  );
});

test("rechaza imágenes de dominios ajenos a Amazon", () => {
  const payload = `
    <a href="https://www.amazon.es/dp/B0ABC12345">
      <img src="https://example.com/producto.jpg">
    </a>`;
  assert.throws(
    () => parseSiteStripePayload(payload, "B0ABC12345"),
    /No se encontró una imagen oficial/
  );
});

test("actualiza imágenes sin alterar columnas ni productos futuros", () => {
  const input = [
    "asin_or_url,title,image_urls,description",
    "B0ABC12345,\"Producto, uno\",https://example.com/placeholder.svg,\"Línea 1",
    "Línea 2\"",
    "B0XYZ67890,Producto futuro,https://example.com/future.svg,Descripción futura"
  ].join("\r\n");
  const parsed = parseCsv(input);
  const captures = {
    B0ABC12345: {
      imageUrl: "https://ws-eu.amazon-adsystem.com/widgets/q?ASIN=B0ABC12345"
    }
  };
  const result = applyCapturedImages(parsed.headers, parsed.rows, captures);

  assert.equal(result.updated, 1);
  assert.equal(result.rows[0].title, "Producto, uno");
  assert.equal(result.rows[0].description, "Línea 1\r\nLínea 2");
  assert.equal(result.rows[1].image_urls, "https://example.com/future.svg");

  const roundTrip = parseCsv(serializeCsv(parsed.headers, result.rows));
  assert.equal(roundTrip.rows.length, 2);
  assert.equal(roundTrip.rows[0].image_urls, captures.B0ABC12345.imageUrl);
});

