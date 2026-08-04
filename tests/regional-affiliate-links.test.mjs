import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { destinationAllowedForCountry } from "../assets/js/redirect.js";

const root = resolve(import.meta.dirname, "..");

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path.replace(/^\//, "")), "utf8"));
}

function offerIds(payload) {
  return new Set(
    (payload.families || []).flatMap((family) =>
      (family.variants || []).flatMap((variant) =>
        (variant.offers || []).map((offer) => offer.id)
      )
    )
  );
}

const regions = await readJson("data/config/regions.json");

test("cada catálogo regional tiene exactamente un enlace aceptado por oferta", async () => {
  for (const region of regions.regions) {
    if (!region.catalogManifest || !region.affiliateLinks) continue;
    const manifest = await readJson(region.catalogManifest);
    const referenced = new Set();
    for (const source of manifest.sources) {
      const payload = await readJson(source.path);
      for (const id of offerIds(payload)) referenced.add(id);
    }
    const linksPayload = await readJson(region.affiliateLinks);
    const linked = new Set(Object.keys(linksPayload.links || {}));
    assert.deepEqual(linked, referenced, `${region.id}: cobertura regional incompleta`);
    for (const [offerId, entry] of Object.entries(linksPayload.links || {})) {
      assert.equal(entry.country, region.countryCode, `${region.id}/${offerId}: país incorrecto`);
      assert.ok(
        destinationAllowedForCountry(entry.url, region.countryCode),
        `${region.id}/${offerId}: destino rechazado por el redirector`
      );
    }
  }
});

test("España conserva los catálogos históricos y añade los nuevos Awin", async () => {
  const links = (await readJson("data/catalog/es/affiliate-links.json")).links;
  for (const prefix of [
    "amazon-es:",
    "aliexpress-es:",
    "shokz-es:",
    "bikila-es:",
    "muebles-style-spain:",
    "voghion-global-es:",
    "al-jazeera-perfumes-eu:",
    "foot-store-es:",
    "gigasport-es:",
    "coach-es:",
    "italist-es:",
    "heybike:",
    "pixar:",
    "dore-rose:"
  ]) {
    assert.ok(
      Object.keys(links).some((offerId) => offerId.startsWith(prefix)),
      `España no conserva enlaces ${prefix}`
    );
  }
});

test("Lounge queda fuera de todos los catálogos y enlaces públicos", async () => {
  for (const region of regions.regions) {
    if (!region.catalogManifest || !region.affiliateLinks) continue;
    const manifest = await readJson(region.catalogManifest);
    for (const source of manifest.sources) {
      const payload = await readJson(source.path);
      assert.ok(
        [...offerIds(payload)].every((offerId) => !offerId.startsWith("lounge-eu:")),
        `${region.id}: Lounge sigue referenciado por ${source.id}`
      );
    }
    const links = (await readJson(region.affiliateLinks)).links || {};
    assert.ok(
      Object.keys(links).every((offerId) => !offerId.startsWith("lounge-eu:")),
      `${region.id}: Lounge sigue publicado en enlaces regionales`
    );
  }
});
