import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAwinPromotion,
  validateAwinPromotionUrl
} from "../scripts/lib/awin-promotions-core.mjs";
import {
  AwinOffersError,
  downloadOfferBatches,
  mergePromotionsWithHeld,
  requestPage
} from "../scripts/refresh-awin-promotions.mjs";

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

test("reintenta los errores temporales y divide la consulta en anunciantes manejables", async () => {
  const requests = [];
  const sleeps = [];
  const payload = { promotions: [], pagination: { totalPages: 1 } };
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    if (requests.length < 3) {
      return new Response("Awin no disponible", { status: 500 });
    }
    return Response.json(payload);
  };

  assert.deepEqual(
    await requestPage({
      token: "oauth-prueba",
      publisherId: "2996453",
      advertiserIds: [84669, 112796],
      page: 1,
      fetchImpl,
      sleepImpl: async (milliseconds) => sleeps.push(milliseconds)
    }),
    payload
  );
  assert.equal(requests.length, 3);
  assert.deepEqual(sleeps, [1_000, 3_000]);
  assert.deepEqual(requests[0].body.filters.advertiserIds, [84669, 112796]);
  assert.equal("regionCodes" in requests[0].body.filters, false);
  assert.match(requests[0].url, /accessToken=oauth-prueba/);
});

test("un error de autenticación sigue bloqueando la actualización", async () => {
  await assert.rejects(
    requestPage({
      token: "oauth-invalido",
      publisherId: "2996453",
      advertiserIds: [84669],
      page: 1,
      fetchImpl: async () => new Response("No autorizado", { status: 401 }),
      sleepImpl: async () => {}
    }),
    (error) =>
      error instanceof AwinOffersError &&
      error.status === 401 &&
      error.retryable === false
  );
});

test("conserva solo las promociones anteriores de los lotes que Awin no pudo servir", async () => {
  const warnings = [];
  const result = await downloadOfferBatches({
    token: "oauth-prueba",
    publisherId: "2996453",
    advertiserIds: [1, 2, 3, 4, 5, 6],
    batchSize: 3,
    requestPageImpl: async ({ advertiserIds }) => {
      if (advertiserIds.includes(4)) {
        throw new AwinOffersError("Offers API: respuesta HTTP 500", {
          status: 500,
          retryable: true
        });
      }
      return {
        promotions: [{ promotionId: 100, advertiserId: 1 }],
        pagination: { totalPages: 1 }
      };
    },
    onWarning: (message) => warnings.push(message)
  });

  assert.deepEqual(result.heldAdvertiserIds, ["4", "5", "6"]);
  assert.equal(result.completedBatches, 1);
  assert.equal(warnings.length, 1);
  const merged = mergePromotionsWithHeld(
    [{ id: "awin:100", advertiserId: "1" }],
    [
      { id: "awin:vieja-exitosa", advertiserId: "1" },
      { id: "awin:retenida", advertiserId: "4" }
    ],
    result.heldAdvertiserIds
  );
  assert.deepEqual(
    merged.map((promotion) => promotion.id).sort(),
    ["awin:100", "awin:retenida"]
  );
});
