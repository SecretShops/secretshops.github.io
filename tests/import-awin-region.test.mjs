import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { importRegionalAwinFeed } from "../scripts/import-awin-region.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("importa Tsarbomba solo en MX/MXN sin modificar la región en modo dry-run", async () => {
  const report = await importRegionalAwinFeed({
    inputPath: resolve(root, "data/sources/awin/tsarbomba-mx.csv.gz"),
    merchantId: "tsarbomba-mx",
    regionId: "mx",
    generatedAt: "2026-08-04T18:00:00.000Z",
    reportPath: null,
    dryRun: true
  });

  assert.equal(report.mode, "dry_run");
  assert.equal(report.country, "MX");
  assert.equal(report.currency, "MXN");
  assert.equal(report.regionStatus, "draft");
  assert.equal(report.rawRows, 242);
  assert.equal(report.acceptedRows, 242);
  assert.equal(report.rejectedRows, 0);
  assert.equal(report.families, 62);
  assert.equal(report.variants, 242);
  assert.equal(report.offers, 242);
  assert.equal(report.affiliateLinks, 242);
  assert.equal(report.safety.publisherId, "2996453");
  assert.equal(report.safety.exactCountry, true);
  assert.equal(report.safety.exactCurrency, true);
  assert.equal(report.safety.regionStatusPreserved, true);
});
