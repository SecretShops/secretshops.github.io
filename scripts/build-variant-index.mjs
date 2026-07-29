import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputDir = resolve(root, "data/catalog/variant-index");
const SHARDS = 32;

const readJson = async (path) => JSON.parse(await readFile(resolve(root, path.replace(/^\//, "")), "utf8"));

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function shardName(id) {
  return (hash(id) % SHARDS).toString(16).padStart(2, "0");
}

function hasOptions(family) {
  const variants = Array.isArray(family?.variants) ? family.variants : [];
  if (variants.length > 1) return true;
  return variants.some((variant) => typeof variant.size === "string" && variant.size.includes(","));
}

function compactOffer(offer) {
  return {
    id: offer.id,
    merchantId: offer.merchantId,
    merchantName: offer.merchantName,
    country: offer.country,
    currency: offer.currency,
    price: offer.price,
    previousPrice: offer.previousPrice,
    shippingCost: offer.shippingCost,
    totalPrice: offer.totalPrice,
    displayPrice: offer.displayPrice,
    availability: offer.availability,
    deliveryTime: offer.deliveryTime
  };
}

function compactVariant(variant) {
  return {
    id: variant.id,
    title: variant.title,
    label: variant.label,
    color: variant.color,
    size: variant.size,
    orientation: variant.orientation,
    dimensions: variant.dimensions,
    material: variant.material,
    capacity: variant.capacity,
    configuration: variant.configuration,
    mpn: variant.mpn,
    images: variant.images || [],
    offers: (variant.offers || []).map(compactOffer)
  };
}

function compactFamily(family) {
  return {
    id: family.id,
    title: family.title,
    image: family.image,
    images: family.images || [],
    variants: (family.variants || []).map(compactVariant)
  };
}

const regions = await readJson("data/config/regions.json");
const manifests = regions.regions
  .filter((region) => region.status === "published")
  .map((region) => region.catalogManifest);

const sourcePaths = new Set();
for (const manifestPath of manifests) {
  const manifest = await readJson(manifestPath);
  for (const source of manifest.sources || []) sourcePaths.add(source.path);
}

const families = new Map();
for (const sourcePath of sourcePaths) {
  const payload = await readJson(sourcePath);
  for (const family of payload.families || []) {
    if (!hasOptions(family) || families.has(family.id)) continue;
    families.set(family.id, compactFamily(family));
  }
}

const shards = Array.from({ length: SHARDS }, () => ({}));
for (const [id, family] of families) {
  shards[hash(id) % SHARDS][id] = family;
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const files = [];
for (let index = 0; index < SHARDS; index += 1) {
  const name = index.toString(16).padStart(2, "0");
  const payload = {
    schemaVersion: 1,
    shard: name,
    families: shards[index]
  };
  const path = resolve(outputDir, `${name}.json`);
  await writeFile(path, `${JSON.stringify(payload)}\n`, "utf8");
  files.push({
    shard: name,
    path: `/data/catalog/variant-index/${name}.json`,
    families: Object.keys(shards[index]).length
  });
}

await writeFile(
  resolve(outputDir, "manifest.json"),
  `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    shards: SHARDS,
    familyCount: families.size,
    sourceCount: sourcePaths.size,
    files
  }, null, 2)}\n`,
  "utf8"
);

console.log(`Índice de variantes: ${families.size} familias en ${SHARDS} fragmentos.`);
