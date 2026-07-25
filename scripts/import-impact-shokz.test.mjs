import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  importShokzImpactFeed,
  parseImpactTsv
} from "./lib/impact-shokz-core.mjs";

const HEADERS = [
  "Unique Merchant SKU",
  "Product Name",
  "Product URL",
  "Image URL",
  "Current Price",
  "Original Price",
  "Stock Availability",
  "Parent SKU",
  "Parent Name",
  "Currency",
  "Color",
  "Size",
  "Product Description",
  "Product Type",
  "Category",
  "Labels"
];

function trackingUrl(sku, slug = "openrun") {
  const landing = encodeURIComponent(`https://es.shokz.com/products/${slug}?variant=${sku}`);
  return `https://shokzes.pxf.io/c/7518894/3800995/48345?prodsku=${sku}&u=${landing}&intsrc=CATF_31438`;
}

function feedRow(overrides = {}) {
  const sku = String(overrides["Unique Merchant SKU"] || "SKU-1");
  const row = {
    "Unique Merchant SKU": sku,
    "Product Name": "OpenRun - Negro",
    "Product URL": trackingUrl(sku),
    "Image URL": "https://cdn.shopify.com/files/openrun.png",
    "Current Price": "139.00",
    "Original Price": "",
    "Stock Availability": "Y",
    "Parent SKU": "",
    "Parent Name": "",
    "Currency": "EUR",
    Color: "Negro",
    Size: "",
    "Product Description": "Auriculares deportivos Shokz con una descripción suficientemente completa.",
    "Product Type": "Electronics",
    Category: "Electronics",
    Labels: "active",
    ...overrides
  };
  return HEADERS.map((header) => row[header] ?? "").join("\t");
}

async function createCatalog() {
  const directory = await mkdtemp(resolve(tmpdir(), "secretshop-impact-"));
  const writeJson = (name, value) =>
    writeFile(resolve(directory, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");

  await Promise.all([
    writeJson("products.json", { schemaVersion: 1, generatedAt: null, products: [] }),
    writeJson("offers.json", { schemaVersion: 1, generatedAt: null, offers: [] }),
    writeJson("merchants.json", {
      schemaVersion: 1,
      merchants: [
        {
          id: "shokz-es",
          name: "SHOKZ ES",
          country: "ES",
          status: "approved",
          network: "impact",
          impactTrackingHost: "shokzes.pxf.io",
          impactPublisherId: "7518894",
          impactCampaignId: "3800995",
          impactCreativeId: "48345",
          impactCatalogSource: "CATF_31438",
          landingDomains: ["es.shokz.com"]
        }
      ]
    })
  ]);
  return directory;
}

test("interpreta el formato tabulado de Impact", () => {
  const parsed = parseImpactTsv(`${HEADERS.join("\t")}\n${feedRow()}\n`);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0]["Unique Merchant SKU"], "SKU-1");
  assert.equal(parsed.records[0].Currency, "EUR");
});

test("importa solo variantes públicas, con stock y tracking exacto", async () => {
  const catalogDir = await createCatalog();
  const feedPath = resolve(catalogDir, "feed.txt");
  const rows = [
    feedRow({
      "Unique Merchant SKU": "PARENT-1",
      "Product Name": "OpenRun",
      Color: ""
    }),
    feedRow({
      "Unique Merchant SKU": "CHILD-1",
      "Parent SKU": "PARENT-1",
      "Parent Name": "OpenRun"
    }),
    feedRow({
      "Unique Merchant SKU": "CHILD-2",
      "Parent SKU": "PARENT-1",
      "Parent Name": "OpenRun",
      "Stock Availability": "N"
    }),
    feedRow({
      "Unique Merchant SKU": "INTERNAL-1",
      "Product Name": "OpenRun（chasingstrava）"
    }),
    feedRow({
      "Unique Merchant SKU": "NOINDEX-1",
      Labels: "active,noindex"
    }),
    feedRow({
      "Unique Merchant SKU": "STANDALONE-1",
      "Product Name": "Shokz Visor",
      "Current Price": "20.99"
    })
  ];
  await writeFile(feedPath, `${HEADERS.join("\t")}\n${rows.join("\n")}\n`, "utf8");

  const result = await importShokzImpactFeed({
    inputPath: feedPath,
    catalogDir,
    generatedAt: "2026-07-25T12:00:00.000Z"
  });

  assert.equal(result.report.totals.feedRows, 6);
  assert.equal(result.report.totals.acceptedRows, 2);
  assert.equal(result.report.skipReasons.parent_row, 1);
  assert.equal(result.report.skipReasons.not_in_stock, 1);
  assert.equal(result.report.skipReasons.internal_campaign, 1);
  assert.equal(result.report.skipReasons.noindex, 1);
  assert.equal(result.importedOffers.length, 2);
  assert.ok(result.importedOffers.every((offer) => offer.source.network === "impact"));

  const written = JSON.parse(await readFile(resolve(catalogDir, "offers.json"), "utf8"));
  assert.equal(written.offers.length, 2);
  assert.ok(written.offers.every((offer) => offer.affiliateUrl.includes("shokzes.pxf.io")));
});
