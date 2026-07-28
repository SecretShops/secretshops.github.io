import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAwinPromotion,
  validateAwinPromotionUrl
} from "../scripts/lib/awin-promotions-core.mjs";

const context = {
  publisherId: "2996453",
  generatedAt: "2026-07-28T09:00:00.000Z",
  merchantsByAdvertiser: new Map([
    ["84669", { id: "clarel-es", name: "Clarel" }]
  ]),
  merchantRegions: new Map([
    ["clarel-es", new Set(["es"])]
  ]),
  regionsById: new Map([
    ["es", { id: "es", countryCode: "ES" }]
  ])
};

test("acepta los dos formatos oficiales de tracking Awin", () => {
  assert.match(
    validateAwinPromotionUrl(
      "https://www.awin1.com/pclick.php?p=123&a=2996453&m=84669",
      { publisherId: "2996453", advertiserId: "84669" }
    ),
    /pclick/
  );
  assert.match(
    validateAwinPromotionUrl(
      "https://www.awin1.com/cread.php?awinmid=84669&awinaffid=2996453&ued=https%3A%2F%2Fwww.clarel.es%2F",
      { publisherId: "2996453", advertiserId: "84669" }
    ),
    /cread/
  );
  assert.throws(
    () => validateAwinPromotionUrl(
      "https://www.awin1.com/cread.php?awinmid=84669&awinaffid=OTRO&ued=https%3A%2F%2Fwww.clarel.es%2F",
      { publisherId: "2996453", advertiserId: "84669" }
    ),
    /inválido/
  );
});

test("publica únicamente promociones activas, asociadas y válidas para el país", () => {
  const promotion = normalizeAwinPromotion({
    promotionId: 77,
    type: "voucher",
    advertiser: { id: 84669, name: "Clarel", joined: true },
    title: "10 % en selección",
    startDate: "2026-07-01T00:00:00.000Z",
    endDate: "2026-08-01T00:00:00.000Z",
    urlTracking: "https://www.awin1.com/cread.php?awinmid=84669&awinaffid=2996453&ued=https%3A%2F%2Fwww.clarel.es%2F",
    regions: { list: [{ countryCode: "ES" }] },
    voucher: { code: "AHORRA10", exclusive: false }
  }, context);
  assert.equal(promotion.code, "AHORRA10");
  assert.deepEqual(promotion.regions, ["es"]);
  assert.equal(
    normalizeAwinPromotion({
      promotionId: 88,
      advertiser: { id: 84669, joined: false },
      title: "Código no asociado",
      urlTracking: "https://www.awin1.com/pclick.php?p=123&a=2996453&m=84669",
      regions: { all: true }
    }, context),
    null
  );
});
