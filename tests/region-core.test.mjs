import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  offerRedirectPath,
  productPath,
  publishedRegions,
  regionStorageKeys,
  resolveActiveRegion,
  validateRegionConfig
} from "../assets/js/region-core.js";

const root = resolve(import.meta.dirname, "..");
const config = validateRegionConfig(
  JSON.parse(await readFile(resolve(root, "data/config/regions.json"), "utf8"))
);

test("solo España está publicada y los borradores no se ofrecen al usuario", () => {
  assert.deepEqual(publishedRegions(config).map((region) => region.id), ["es"]);
  assert.equal(config.regions.find((region) => region.id === "mx").status, "draft");
  assert.equal(config.regions.find((region) => region.id === "co").status, "draft");
});

test("resuelve la región por URL y bloquea una región draft", () => {
  assert.equal(resolveActiveRegion(config, "es", "/").id, "es");
  assert.throws(
    () => resolveActiveRegion(config, "mx", "/mx/"),
    /todavía no está publicada/
  );
});

test("favoritos, historial y comparador quedan separados por región", () => {
  const spain = regionStorageKeys("es");
  const mexico = regionStorageKeys("mx");
  assert.notEqual(spain.favorites, mexico.favorites);
  assert.notEqual(spain.recent, mexico.recent);
  assert.notEqual(spain.compare, mexico.compare);
  assert.equal(spain.theme, mexico.theme);
});

test("genera rutas de producto reales y enlaces comerciales regionales", () => {
  const spain = config.regions.find((region) => region.id === "es");
  assert.equal(
    productPath({ id: "fam:123", title: "Auriculares inalámbricos" }, spain),
    "/producto/auriculares-inalambricos--fam-123/"
  );
  assert.equal(
    offerRedirectPath("es", "amazon-es:B0ABC12345"),
    "/go.html?region=es&offer=amazon-es%3AB0ABC12345"
  );
});
