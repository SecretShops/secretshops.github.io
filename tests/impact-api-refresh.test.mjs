import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  candidatesFromImpactItems,
  catalogItemQuery,
  impactBoolean,
  madridCronShouldRun,
  mergeImpactPromotions,
  normalizeImpactPromoCode,
  normalizeImpactPromotion,
  normalizeImpactProgram,
  parseConfiguredImpactUrl,
  updateImpactAffiliateLinks,
  updateImpactCanonicalOffers,
  updateImpactPublicCatalog,
  validateImpactSyncConfig
} from "../scripts/lib/impact-api-core.mjs";

const generatedAt = "2026-07-28T09:00:00.000Z";
const root = resolve(import.meta.dirname, "..");
const target = {
  id: "lounge-eu",
  merchantId: "lounge-eu",
  merchantName: "Lounge EU",
  catalogId: "35417",
  campaignId: "3973367",
  catalogSource: "CATF_35417",
  currencies: ["EUR"],
  regions: ["es", "pt"],
  trackingHosts: ["loungeeu.sjv.io"],
  landingDomains: ["eu.lounge.com"],
  directFallbackWhenDeeplinkingDisabled: true
};
const publisherId = "7518894";
const tracked =
  "https://loungeeu.sjv.io/c/7518894/3973367/99999" +
  "?prodsku=51849314828670" +
  "&u=https%3A%2F%2Feu.lounge.com%2Fproducts%2Fsoft-waffle%3Fvariant%3D51849314828670" +
  "&intsrc=CATF_35417";
const item = {
  Id: "35417-51849314828670",
  CatalogId: "35417",
  CampaignId: "3973367",
  CatalogItemId: "51849314828670",
  ParentSku: "14761231712638",
  CurrentPrice: "42.50",
  OriginalPrice: "45.00",
  Currency: "EUR",
  StockAvailability: "InStock",
  Url: tracked
};

test("valida la allowlist y conserva el modo solo productos existentes", () => {
  const config = validateImpactSyncConfig(
    {
      schemaVersion: 1,
      publisherId,
      mode: "existing_products_only",
      queryBatchSize: 150,
      catalogs: [target]
    },
    {
      regions: [
        { id: "es", currency: "EUR" },
        { id: "pt", currency: "EUR" }
      ]
    }
  );
  assert.equal(config.catalogs.length, 1);
  assert.equal(config.queryBatchSize, 150);
  assert.throws(
    () => validateImpactSyncConfig(
      {
        schemaVersion: 1,
        publisherId,
        mode: "replace_catalog",
        catalogs: [target]
      },
      { regions: [{ id: "es", currency: "EUR" }, { id: "pt", currency: "EUR" }] }
    ),
    /existing_products_only/
  );
});

test("acepta el enlace de producto de la API aunque cambie el creative", () => {
  const parsed = parseConfiguredImpactUrl(tracked, target, publisherId);
  assert.equal(parsed?.creativeId, "99999");
  assert.equal(parsed?.productSku, "51849314828670");
  assert.equal(parsed?.landingUrl.startsWith("https://eu.lounge.com/products/"), true);
  assert.equal(
    parseConfiguredImpactUrl(
      tracked.replace("/7518894/", "/999/"),
      target,
      publisherId
    ),
    null
  );
  assert.equal(
    parseConfiguredImpactUrl(
      tracked.replace("CATF_35417", "CATF_999"),
      target,
      publisherId
    ),
    null
  );
});

test("consulta IDs conocidos en lotes sin permitir sintaxis arbitraria", () => {
  assert.equal(
    catalogItemQuery(["ABC-1", "ABC-2"]),
    "CatalogItemId IN ('ABC-1','ABC-2')"
  );
  assert.throws(() => catalogItemQuery(["ABC' OR 1=1"]), /no válidos/);
});

test("agrupa una variante por ParentSku y activa el fallback directo de Lounge", () => {
  const program = normalizeImpactProgram({
    CampaignId: target.campaignId,
    ContractStatus: "Active",
    AllowsDeeplinking: "false",
    ShippingRegions: ["SPAIN", "PORTUGAL"]
  });
  assert.equal(impactBoolean("false"), false);
  const parsed = candidatesFromImpactItems({
    items: [item],
    target,
    publisherId,
    existingProductIds: new Set(["14761231712638"]),
    generatedAt,
    directFallback: true,
    program
  });
  assert.equal(parsed.candidates.size, 1);
  const candidate = parsed.candidates.get("14761231712638");
  assert.equal(candidate.price, 42.5);
  assert.equal(candidate.previousPrice, 45);
  assert.equal(candidate.availability, "in_stock");
  assert.equal(candidate.directFallback, true);
  assert.equal(
    candidate.affiliateUrl,
    "https://eu.lounge.com/products/soft-waffle?variant=51849314828670"
  );
});

test("actualiza precios y enlaces sin añadir ni eliminar ofertas o familias", () => {
  const parsed = candidatesFromImpactItems({
    items: [item],
    target,
    publisherId,
    existingProductIds: new Set(["14761231712638"]),
    generatedAt,
    directFallback: true
  });
  const candidatesByTarget = new Map([[target.id, parsed.candidates]]);
  const targetIds = () => [target.id];
  const canonical = {
    schemaVersion: 1,
    offers: [{
      id: "lounge-eu:es:14761231712638",
      merchantId: "lounge-eu",
      merchantProductId: "14761231712638",
      price: 45,
      previousPrice: null,
      shippingCost: null,
      totalPrice: 45,
      availability: "in_stock",
      affiliateUrl: tracked,
      landingUrl: "https://eu.lounge.com/products/soft-waffle",
      source: { network: "impact", parentSku: "14761231712638" }
    }]
  };
  const canonicalResult = updateImpactCanonicalOffers({
    payload: canonical,
    targetsForOffer: targetIds,
    candidatesByTarget,
    generatedAt
  });
  assert.equal(canonicalResult.payload.offers.length, 1);
  assert.equal(canonicalResult.payload.offers[0].id, canonical.offers[0].id);
  assert.equal(canonicalResult.payload.offers[0].price, 42.5);
  assert.match(canonicalResult.payload.offers[0].affiliateUrl, /^https:\/\/eu\.lounge\.com/);

  const publicCatalog = {
    schemaVersion: 3,
    families: [{
      id: "familia-existente",
      minPrice: 45,
      maxPrice: 45,
      variants: [{
        id: "variante-existente",
        offers: [{
          id: canonical.offers[0].id,
          merchantId: "lounge-eu",
          price: 45,
          previousPrice: null,
          shippingCost: null,
          totalPrice: 45,
          availability: "in_stock"
        }]
      }]
    }]
  };
  const publicResult = updateImpactPublicCatalog({
    payload: publicCatalog,
    targetsForOffer: targetIds,
    candidatesByTarget,
    linkForOffer: () => tracked,
    generatedAt
  });
  assert.equal(publicResult.payload.families.length, 1);
  assert.equal(publicResult.payload.families[0].variants.length, 1);
  assert.equal(publicResult.payload.families[0].minPrice, 42.5);

  const links = {
    schemaVersion: 1,
    links: {
      [canonical.offers[0].id]: {
        url: tracked,
        merchantId: "lounge-eu",
        country: "ES"
      }
    }
  };
  const linkResult = updateImpactAffiliateLinks({
    payload: links,
    regionId: "es",
    targetsForOffer: targetIds,
    candidatesByTarget,
    targetsById: new Map([[target.id, target]]),
    generatedAt
  });
  assert.deepEqual(Object.keys(linkResult.payload.links), Object.keys(links.links));
  assert.equal(
    linkResult.payload.links[canonical.offers[0].id].fallback,
    "direct_product"
  );
});

test("normaliza promociones y solo códigos literales vigentes", () => {
  const program = normalizeImpactProgram({
    AdvertiserId: "1234",
    AdvertiserName: "Lounge",
    CampaignId: target.campaignId,
    ContractStatus: "Active",
    TrackingLink: "https://loungeeu.sjv.io/c/7518894/3973367/99999",
    AllowsDeeplinking: "false",
    ShippingRegions: ["SPAIN", "PORTUGAL"]
  });
  const context = {
    generatedAt,
    publisherId,
    regionsById: new Map([
      ["es", { id: "es", countryCode: "ES", status: "published" }],
      ["pt", { id: "pt", countryCode: "PT", status: "published" }]
    ]),
    programsByCampaign: new Map([[target.campaignId, program]]),
    targetsByCampaign: new Map([[target.campaignId, target]]),
    targetsByAdvertiser: new Map([["1234", [target]]])
  };
  const promotions = normalizeImpactPromotion(
    {
      AdvertiserId: "1234",
      AdvertiserName: "Lounge",
      PromotionIds: "77",
      PromotionTitle: "20% de descuento",
      PromotionEffectiveDates: "2026-07-01T00:00:00Z/2026-08-01T00:00:00Z",
      GenericRedemptionCode: "LOUNGE20"
    },
    context
  );
  assert.equal(promotions.length, 1);
  assert.deepEqual(promotions[0].regions, ["es", "pt"]);
  assert.equal(promotions[0].code, "LOUNGE20");

  const literal = normalizeImpactPromoCode(
    {
      Id: "88",
      Code: "LOUNGE20",
      State: "ACTIVE",
      MatchMode: "LI",
      CreditRule: "ALWAYS",
      Program: { Id: target.campaignId },
      Advertiser: { Id: "1234", Name: "Lounge" },
      Deal: { Name: "20% de descuento" },
      EndDate: "2026-08-01T00:00:00Z"
    },
    context
  );
  assert.equal(literal?.attributable, true);
  assert.equal(
    normalizeImpactPromoCode(
      {
        Id: "89",
        Code: "LOUNGE.*",
        State: "ACTIVE",
        MatchMode: "RE",
        Program: { Id: target.campaignId }
      },
      context
    ),
    null
  );
  const merged = mergeImpactPromotions(promotions, [literal]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].sourceKind, "promotion_and_promo_code");
});

test("la doble programación mantiene las 09:17 de Madrid todo el año", () => {
  assert.equal(
    madridCronShouldRun("17 7 * * *", new Date("2026-07-28T12:00:00Z")),
    true
  );
  assert.equal(
    madridCronShouldRun("17 8 * * *", new Date("2026-07-28T12:00:00Z")),
    false
  );
  assert.equal(
    madridCronShouldRun("17 7 * * *", new Date("2026-12-28T12:00:00Z")),
    false
  );
  assert.equal(
    madridCronShouldRun("17 8 * * *", new Date("2026-12-28T12:00:00Z")),
    true
  );
});

test("cada catálogo permitido por el backend está también permitido por el redirector", async () => {
  const [config, redirect] = await Promise.all([
    readFile(resolve(root, "data/catalog/impact-sync-config.json"), "utf8")
      .then(JSON.parse),
    readFile(resolve(root, "assets/js/redirect.js"), "utf8")
  ]);
  for (const catalog of config.catalogs) {
    for (const value of [
      catalog.trackingHosts[0],
      `/c/${config.publisherId}/${catalog.campaignId}/`,
      catalog.catalogSource
    ]) {
      assert.ok(redirect.includes(value), `${catalog.id}: falta ${value}`);
    }
  }
});
