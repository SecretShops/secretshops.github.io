import test from "node:test";
import assert from "node:assert/strict";
import {
  createTranslator,
  localizeCategory,
  translateStaticHtml
} from "../assets/js/i18n.js";

test("traduce navegación, controles y categorías de los países publicados", () => {
  assert.equal(createTranslator("de-DE")("productsCount", { count: 12 }), "12 Produkte");
  assert.equal(createTranslator("fr-FR")("viewOffer"), "Voir l’offre");
  assert.equal(createTranslator("bg-BG")("categories"), "Категории");
  assert.equal(createTranslator("mt-MT")("categories"), "Kategoriji");
  assert.equal(localizeCategory("Tecnología", "el-GR"), "Τεχνολογία");
});

test("la generación regional sustituye texto visible y atributos sin tocar scripts", () => {
  const source = [
    '<button aria-label="Cambiar país">Categorías</button>',
    '<input placeholder="Busca productos, marcas o categorías">',
    '<script>const texto = "Categorías";</script>'
  ].join("");
  const output = translateStaticHtml(source, "de-DE");
  assert.match(output, /aria-label="Land ändern"/);
  assert.match(output, />Kategorien</);
  assert.match(output, /placeholder="Produkte, Marken oder Kategorien suchen"/);
  assert.match(output, /const texto = "Categorías"/);
});
