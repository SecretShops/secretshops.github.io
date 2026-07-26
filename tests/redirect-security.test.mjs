import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedDestination,
  entryMatchesRegion
} from "../assets/js/redirect.js";

const spain = {
  id: "es",
  countryCode: "ES",
  status: "published"
};
const mexicoDraft = {
  id: "mx",
  countryCode: "MX",
  status: "draft"
};

test("acepta únicamente los destinos afiliados previstos", () => {
  assert.equal(
    allowedDestination("https://www.awin1.com/pclick.php?p=1&a=2&m=3"),
    "https://www.awin1.com/pclick.php?p=1&a=2&m=3"
  );
  assert.equal(
    allowedDestination("https://s.click.aliexpress.com/e/_ejemplo"),
    "https://s.click.aliexpress.com/e/_ejemplo"
  );
  assert.equal(
    allowedDestination("https://www.amazon.es/dp/B0ABC12345/ref=nosim?tag=christian0ddd-21"),
    "https://www.amazon.es/dp/B0ABC12345/ref=nosim?tag=christian0ddd-21"
  );
  assert.equal(
    allowedDestination(
      "https://shokzes.pxf.io/c/7518894/3800995/48345?prodsku=123&u=https%3A%2F%2Fes.shokz.com%2Fproducts%2Fopenrun&intsrc=CATF_31438"
    ),
    "https://shokzes.pxf.io/c/7518894/3800995/48345?prodsku=123&u=https%3A%2F%2Fes.shokz.com%2Fproducts%2Fopenrun&intsrc=CATF_31438"
  );
  assert.equal(
    allowedDestination(
      "https://loungeeu.sjv.io/c/7518894/3973367/54841?prodsku=123&u=https%3A%2F%2Feu.lounge.com%2Fproducts%2Fexample&intsrc=CATF_35417"
    ),
    "https://loungeeu.sjv.io/c/7518894/3973367/54841?prodsku=123&u=https%3A%2F%2Feu.lounge.com%2Fproducts%2Fexample&intsrc=CATF_35417"
  );
  assert.equal(
    allowedDestination(
      "https://heybikeeu.sjv.io/c/7518894/3806125/49281?prodsku=123&u=https%3A%2F%2Feu.heybike.com%2Fproducts%2Fexample&intsrc=CATF_31506"
    ),
    "https://heybikeeu.sjv.io/c/7518894/3806125/49281?prodsku=123&u=https%3A%2F%2Feu.heybike.com%2Fproducts%2Fexample&intsrc=CATF_31506"
  );
});

test("rechaza protocolos, hosts, rutas y parámetros inseguros", () => {
  for (const value of [
    "http://www.awin1.com/pclick.php?p=1&a=2&m=3",
    "https://awin1.com.ejemplo.test/pclick.php?p=1&a=2&m=3",
    "https://www.awin1.com/otra-ruta?p=1&a=2&m=3",
    "https://www.awin1.com/pclick.php?p=1&a=2",
    "https://s.click.aliexpress.com.ejemplo.test/e/_ejemplo",
    "https://www.amazon.es/dp/B0ABC12345/ref=nosim?tag=otro-tag-21",
    "https://www.amazon.es/gp/product/B0ABC12345?tag=christian0ddd-21",
    "https://amazon.es.ejemplo.test/dp/B0ABC12345?tag=christian0ddd-21",
    "https://shokzes.pxf.io/c/999/3800995/48345?prodsku=123&u=https%3A%2F%2Fes.shokz.com%2Fproducts%2Fopenrun&intsrc=CATF_31438",
    "https://shokzes.pxf.io/c/7518894/3800995/48345?prodsku=123&u=https%3A%2F%2Fevil.example%2Fproducto&intsrc=CATF_31438",
    "https://shokzes.pxf.io/c/7518894/3800995/48345?prodsku=123&u=https%3A%2F%2Fes.shokz.com%2Fproducts%2Fopenrun&intsrc=OTRO",
    "https://example.com/producto",
    "javascript:alert(1)",
    ""
  ]) {
    assert.equal(allowedDestination(value), null, value);
  }
});

test("el redirector rechaza ofertas de otro país y regiones draft", () => {
  const spanishEntry = {
    country: "ES",
    url: "https://www.amazon.es/dp/B0ABC12345/ref=nosim?tag=christian0ddd-21"
  };
  const mexicanEntry = {
    country: "MX",
    url: "https://s.click.aliexpress.com/e/_ejemplo"
  };
  assert.equal(entryMatchesRegion(spanishEntry, spain), true);
  assert.equal(entryMatchesRegion(mexicanEntry, spain), false);
  assert.equal(entryMatchesRegion(mexicanEntry, mexicoDraft), false);
});
