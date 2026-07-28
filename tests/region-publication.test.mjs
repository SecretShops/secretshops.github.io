import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRegionPublication } from "../scripts/lib/region-publication-core.mjs";

function fixture(count, currency = "EUR") {
  const families = Array.from({ length: count }, (_, index) => ({
    id: `family-${index}`,
    variants: [{
      offers: [{
        id: `store:${index}`,
        country: "MT",
        currency
      }]
    }]
  }));
  const links = Object.fromEntries(
    families.map((family, index) => [
      `store:${index}`,
      { country: "MT", url: `https://example.test/${index}` }
    ])
  );
  return { families, links };
}

const malta = {
  id: "mt",
  status: "draft",
  locale: "mt-MT",
  countryCode: "MT",
  currency: "EUR",
  catalogManifest: "/data/catalog/mt/catalog.json",
  affiliateLinks: "/data/catalog/mt/affiliate-links.json"
};

test("solo promociona un borrador con productos, moneda, país y enlaces completos", () => {
  const complete = fixture(200);
  const result = evaluateRegionPublication({
    region: malta,
    ...complete,
    destinationAllowed: () => true
  });
  assert.equal(result.eligible, true);

  const tooSmall = evaluateRegionPublication({
    region: malta,
    ...fixture(199),
    destinationAllowed: () => true
  });
  assert.ok(tooSmall.reasons.includes("insufficient_products"));

  const noCurrency = evaluateRegionPublication({
    region: malta,
    ...fixture(200, null),
    destinationAllowed: () => true
  });
  assert.ok(noCurrency.reasons.includes("wrong_or_missing_currency"));
});

test("un enlace inseguro impide publicar y una región publicada nunca se procesa como borrador", () => {
  const complete = fixture(200);
  const unsafe = evaluateRegionPublication({
    region: malta,
    ...complete,
    destinationAllowed: () => false
  });
  assert.ok(unsafe.reasons.includes("unsafe_links"));

  const published = evaluateRegionPublication({
    region: { ...malta, status: "published" },
    ...complete,
    destinationAllowed: () => true
  });
  assert.ok(published.reasons.includes("not_draft"));
});
