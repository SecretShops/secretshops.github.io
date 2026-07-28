import test from "node:test";
import assert from "node:assert/strict";
import {
  candidatesFromFeed,
  madridCronShouldRun,
  parseFeedList,
  secureFeedUrl,
  updateAffiliateLinks,
  updateCanonicalOffers,
  updatePublicCatalog
} from "../scripts/lib/awin-api-refresh-core.mjs";

const publisherId = "2996453";
const merchant = {
  id: "clarel-es",
  awinAdvertiserId: "84669",
  expectedCurrencies: new Set(["EUR"])
};
const generatedAt = "2026-07-28T09:00:00.000Z";
const feed = [
  "aw_deep_link,description,merchant_product_id,merchant_id,search_price,currency,in_stock,product_price_old,delivery_cost,last_updated,data_feed_id,aw_product_id",
  'https://www.awin1.com/pclick.php?p=111&a=2996453&m=84669,"Texto con coma,\ny salto",32142,84669,12.50,EUR,1,15.00,2.00,2026-07-28 07:45:00,95374,111',
  "https://www.awin1.com/pclick.php?p=222&a=2996453&m=84669,Normal,NUEVO,84669,5.00,EUR,1,,,2026-07-28 07:45:00,95374,222"
].join("\n");

test("interpreta el listado de feeds sin guardar la clave", () => {
  const list = parseFeedList(
    [
      "Advertiser ID,Advertiser Name,Feed ID,Feed Name,Last Imported,URL",
      '84669,Clarel,95374,Default,2026-07-28 08:00:00,"http://datafeed.api.productserve.com/datafeed/download/apikey/SECRETO/fid/95374/format/csv/compression/gzip"'
    ].join("\n")
  );
  assert.equal(list.length, 1);
  assert.equal(list[0].feedId, "95374");
  assert.equal(list[0].advertiserId, "84669");
  assert.ok(!JSON.stringify(list[0]).includes("Bearer"));
});

test("solo admite URLs de descarga oficiales de Awin", () => {
  const safe = secureFeedUrl(
    "http://datafeed.api.productserve.com/datafeed/download/apikey/abc/fid/95374"
  );
  assert.match(safe, /^https:/);
  assert.throws(
    () => secureFeedUrl("https://example.com/datafeed/download/apikey/abc"),
    /no permitida/
  );
});

test("actualiza únicamente productos existentes y conserva sus IDs", () => {
  const parsed = candidatesFromFeed(feed, merchant, publisherId, generatedAt);
  const candidates = new Map([[merchant.id, parsed.candidates]]);
  const canonical = {
    schemaVersion: 1,
    generatedAt: "2026-07-27T00:00:00.000Z",
    offers: [
      {
        id: "clarel-es:32142",
        merchantId: "clarel-es",
        merchantProductId: "32142",
        currency: "EUR",
        price: 10,
        previousPrice: null,
        shippingCost: null,
        totalPrice: 10,
        availability: "unknown",
        affiliateUrl: "https://www.awin1.com/pclick.php?p=000&a=2996453&m=84669",
        source: { awinMerchantId: "84669" },
        lastUpdatedAt: "2026-07-27T00:00:00.000Z"
      }
    ]
  };
  const result = updateCanonicalOffers(canonical, candidates, generatedAt);
  assert.equal(result.changedOffers, 1);
  assert.equal(result.payload.offers.length, 1);
  assert.equal(result.payload.offers[0].id, "clarel-es:32142");
  assert.equal(result.payload.offers[0].price, 12.5);
  assert.equal(result.payload.offers[0].totalPrice, 14.5);
  assert.equal(result.payload.offers[0].availability, "in_stock");
  assert.equal(result.payload.offers[0].source.awProductId, "111");
  assert.ok(!result.payload.offers.some((offer) => offer.id.includes("NUEVO")));
});

test("refresca el catálogo público y sus enlaces sin añadir familias", () => {
  const parsed = candidatesFromFeed(feed, merchant, publisherId, generatedAt);
  const candidates = new Map([[merchant.id, parsed.candidates]]);
  const publicCatalog = {
    schemaVersion: 3,
    generatedAt: "2026-07-27T00:00:00.000Z",
    country: "ES",
    currency: "EUR",
    families: [
      {
        id: "familia-existente",
        minPrice: 10,
        maxPrice: 10,
        variants: [
          {
            id: "variante-existente",
            offers: [
              {
                id: "clarel-es:32142",
                merchantId: "clarel-es",
                country: "ES",
                currency: "EUR",
                price: 10,
                shippingCost: null,
                totalPrice: 10,
                availability: "unknown",
                updatedAt: "2026-07-27T00:00:00.000Z"
              }
            ]
          }
        ]
      }
    ]
  };
  const catalogResult = updatePublicCatalog(publicCatalog, candidates, generatedAt);
  assert.equal(catalogResult.payload.families.length, 1);
  assert.equal(catalogResult.payload.families[0].id, "familia-existente");
  assert.equal(catalogResult.payload.families[0].minPrice, 12.5);

  const linkResult = updateAffiliateLinks(
    {
      schemaVersion: 1,
      links: {
        "clarel-es:32142": {
          merchantId: "clarel-es",
          country: "ES",
          url: "https://www.awin1.com/pclick.php?p=000&a=2996453&m=84669"
        }
      }
    },
    candidates,
    generatedAt
  );
  assert.equal(linkResult.changedLinks, 1);
  assert.match(linkResult.payload.links["clarel-es:32142"].url, /p=111/);
});

test("la doble programación mantiene las 09:00 de Madrid con y sin horario de verano", () => {
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
