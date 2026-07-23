#!/usr/bin/env node

import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogDir = resolve(root, "data/catalog");
const outputPath = resolve(catalogDir, "affiliate-audit.json");

async function readJson(name) {
  return JSON.parse(await readFile(resolve(catalogDir, name), "utf8"));
}

function publicOfferIds(payload) {
  return new Set(
    (payload.families || []).flatMap((family) =>
      (family.variants || []).flatMap((variant) =>
        (variant.offers || []).map((offer) => offer.id)
      )
    )
  );
}

const [
  offersPayload,
  merchantsPayload,
  linksPayload,
  families,
  mexico,
  colombia
] = await Promise.all([
  readJson("offers.json"),
  readJson("merchants.json"),
  readJson("affiliate-links.json"),
  readJson("families.json"),
  readJson("aliexpress-mx.json"),
  readJson("aliexpress-co.json")
]);

const merchants = new Map(
  merchantsPayload.merchants.map((merchant) => [merchant.id, merchant])
);
const findings = [];
let validCanonicalAwin = 0;

for (const offer of offersPayload.offers) {
  const merchant = merchants.get(offer.merchantId);
  try {
    const url = new URL(offer.affiliateUrl);
    const expectedAdvertiserId = String(
      offer.source?.awinMerchantId ||
      merchant?.awinAdvertiserId ||
      ""
    );
    const valid =
      url.protocol === "https:" &&
      /(^|\.)awin1\.com$/i.test(url.hostname) &&
      ["/pclick.php", "/cread.php"].includes(url.pathname) &&
      Boolean(url.searchParams.get("a")) &&
      Boolean(url.searchParams.get("p")) &&
      url.searchParams.get("m") === expectedAdvertiserId;
    if (valid) validCanonicalAwin += 1;
    else findings.push({ offerId: offer.id, reason: "invalid_canonical_awin_link" });
  } catch {
    findings.push({ offerId: offer.id, reason: "malformed_canonical_link" });
  }
}

const publishedIds = new Set([
  ...publicOfferIds(families),
  ...publicOfferIds(mexico),
  ...publicOfferIds(colombia)
]);
const linkEntries = Object.entries(linksPayload.links || {});

for (const offerId of publishedIds) {
  if (!linksPayload.links?.[offerId]) {
    findings.push({ offerId, reason: "published_offer_without_link" });
  }
}

for (const [offerId, entry] of linkEntries) {
  if (!publishedIds.has(offerId)) {
    findings.push({ offerId, reason: "orphan_public_link" });
    continue;
  }
  try {
    const url = new URL(entry.url);
    const awin =
      /(^|\.)awin1\.com$/i.test(url.hostname) &&
      ["/pclick.php", "/cread.php"].includes(url.pathname) &&
      ["a", "p", "m"].every((key) => url.searchParams.get(key));
    const aliexpress = /^s\.click\.aliexpress\.com$/i.test(url.hostname);
    if (url.protocol !== "https:" || (!awin && !aliexpress)) {
      findings.push({ offerId, reason: "invalid_public_destination" });
    }
  } catch {
    findings.push({ offerId, reason: "malformed_public_destination" });
  }
}

const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  summary: {
    canonicalAwinOffers: offersPayload.offers.length,
    validCanonicalAwinLinks: validCanonicalAwin,
    publishedOffers: publishedIds.size,
    publishedLinks: linkEntries.length,
    awinPublishedLinks: linkEntries.filter(([, entry]) => entry.url.includes("awin1.com")).length,
    aliexpressPublishedLinks: linkEntries.filter(([, entry]) => entry.url.includes("aliexpress.com")).length,
    findings: findings.length,
    allPublishedOffersTracked:
      findings.length === 0 &&
      publishedIds.size === linkEntries.length
  },
  findings
};

const temporary = `${outputPath}.tmp`;
await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await rename(temporary, outputPath);

console.log(
  `Auditoría de afiliación: ${report.summary.publishedLinks}/${report.summary.publishedOffers} ofertas publicadas con enlace válido; ${findings.length} incidencias.`
);

if (findings.length > 0) process.exitCode = 1;
