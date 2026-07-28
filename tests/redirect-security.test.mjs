import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedDestination,
  entryMatchesRegion,
  promotionMatchesRegion
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
    allowedDestination("https://www.awin1.com/cread.php?awinmid=3&awinaffid=2&ued=https%3A%2F%2Fexample.com"),
    "https://www.awin1.com/cread.php?awinmid=3&awinaffid=2&ued=https%3A%2F%2Fexample.com"
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
  assert.equal(
    allowedDestination(
      "https://lenovo.evyy.net/c/7518894/665754/3831?prodsku=11JHRAT1EU&u=https%3A%2F%2Fwww.lenovo.com%2Fes%2Fes%2Fp%2Fmonitors%2F11jhrat1eu&intsrc=CATF_5021"
    ),
    "https://lenovo.evyy.net/c/7518894/665754/3831?prodsku=11JHRAT1EU&u=https%3A%2F%2Fwww.lenovo.com%2Fes%2Fes%2Fp%2Fmonitors%2F11jhrat1eu&intsrc=CATF_5021"
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

test("las promociones exigen anunciante, publisher, vigencia y país exactos", () => {
  const promotion = {
    id: "awin:77",
    network: "awin",
    advertiserId: "84669",
    regions: ["es"],
    startAt: "2026-07-01T00:00:00.000Z",
    endAt: "2026-08-01T00:00:00.000Z",
    trackingUrl: "https://www.awin1.com/cread.php?awinmid=84669&awinaffid=2996453&ued=https%3A%2F%2Fwww.clarel.es%2F"
  };
  assert.equal(
    promotionMatchesRegion(promotion, spain, new Date("2026-07-28T09:00:00Z")),
    true
  );
  assert.equal(
    promotionMatchesRegion({ ...promotion, advertiserId: "OTRO" }, spain, new Date("2026-07-28T09:00:00Z")),
    false
  );
  assert.equal(
    promotionMatchesRegion(promotion, spain, new Date("2026-08-02T09:00:00Z")),
    false
  );
  assert.equal(promotionMatchesRegion(promotion, mexicoDraft), false);
});
