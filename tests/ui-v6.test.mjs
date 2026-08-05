import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [app, css, promotions, staticJs] = await Promise.all([
  readFile(new URL("../assets/js/app.js", import.meta.url), "utf8"),
  readFile(new URL("../assets/css/app.css", import.meta.url), "utf8"),
  readFile(new URL("../assets/js/promotions.js", import.meta.url), "utf8"),
  readFile(new URL("../assets/js/static.js", import.meta.url), "utf8")
]);

test("V6 aísla el scroll y conserva la posición del documento", () => {
  assert.match(app, /lockedScrollY = window\.scrollY/);
  assert.match(app, /window\.scrollTo\(0, restoreY\)/);
  assert.match(app, /preventScrollChaining/);
  assert.match(css, /overscroll-behavior:\s*contain/);
});

test("V6 incorpora buscador de países por nombre y código", () => {
  assert.match(app, /Buscar país o código/);
  assert.match(app, /COUNTRY_ALPHA3/);
  assert.match(app, /No encontramos ese país/);
  assert.match(css, /\.region-search-box/);
});

test("V6 hace explícita la salida de producto y tienda", () => {
  assert.match(app, /Volver a productos/);
  assert.match(app, /Volver a todas las tiendas/);
  assert.match(app, /Ver todos los productos/);
  assert.match(staticJs, /standalone-detail-header/);
});

test("V6 usa promociones compactas y comparador funcional transparente", () => {
  assert.match(promotions, /Código promocional/);
  assert.match(promotions, /\bCopiar\b/);
  assert.match(css, /grid-template-columns:\s*repeat\(5/);
  assert.match(css, /\.functional-alternative-grid/);
  assert.match(app, /No son productos idénticos/);
  assert.match(app, /precio normalizado complementa/);
});
