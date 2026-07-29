import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildVariantPresentation } from "../assets/js/variant-system.js";

const root = resolve(import.meta.dirname, "..");
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path.replace(/^\//, "")), "utf8"));
const outputJson = resolve(root, "data/catalog/variant-control-audit.json");
const outputCsv = resolve(root, "data/catalog/variant-control-audit.csv");

function hasOptions(family) {
  const variants = Array.isArray(family?.variants) ? family.variants : [];
  return variants.length > 1 || variants.some((variant) => String(variant?.size || "").includes(","));
}

function merchantName(family) {
  for (const variant of family.variants || []) {
    const merchant = variant.offers?.[0]?.merchantName;
    if (merchant) return merchant;
  }
  return "Sin tienda identificada";
}

function csv(value) {
  const text = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

const regions = await readJson("data/config/regions.json");
const sourcePaths = new Set();
for (const region of regions.regions.filter((item) => item.status === "published")) {
  const manifest = await readJson(region.catalogManifest);
  for (const source of manifest.sources || []) sourcePaths.add(source.path);
}

const families = new Map();
for (const sourcePath of sourcePaths) {
  const payload = await readJson(sourcePath);
  for (const family of payload.families || []) {
    if (!families.has(family.id)) families.set(family.id, family);
  }
}

const attributeCounts = {};
const merchantCounts = {};
const categoryCounts = {};
const records = [];
let sourceVariantCount = 0;
let presentedVariantCount = 0;
let genericLabelFamilies = 0;

for (const family of families.values()) {
  if (!hasOptions(family)) continue;
  const originalVariants = family.variants || [];
  const presentation = buildVariantPresentation(family, null, "es-ES");
  const merchant = merchantName(family);
  const categories = family.categories?.length ? family.categories : [family.category].filter(Boolean);
  const genericLabels = originalVariants.filter((variant) => /modelo disponible|model available|op[cç][aã]o dispon[ií]vel/i.test(variant.label || "")).length;

  sourceVariantCount += originalVariants.length;
  presentedVariantCount += presentation.variants.length;
  if (genericLabels) genericLabelFamilies += 1;

  const controls = presentation.groups.map((group) => {
    attributeCounts[group.key] = (attributeCounts[group.key] || 0) + 1;
    return {
      attribute: group.key,
      label: group.label,
      type: group.type,
      values: group.values.map((item) => item.value)
    };
  });
  if (presentation.availableSizes.length) {
    attributeCounts.availableSizes = (attributeCounts.availableSizes || 0) + 1;
  }

  const hasVisibleControl = controls.length > 0 || presentation.availableSizes.length > 0;
  const status = hasVisibleControl
    ? "configurador"
    : presentation.variants.length <= 1
      ? "duplicados_agrupados"
      : "sin_atributo_identificable";

  merchantCounts[merchant] ||= { products: 0, configurators: 0, unresolved: 0 };
  merchantCounts[merchant].products += 1;
  if (status === "configurador") merchantCounts[merchant].configurators += 1;
  if (status === "sin_atributo_identificable") merchantCounts[merchant].unresolved += 1;

  for (const category of categories) {
    categoryCounts[category] ||= { products: 0, configurators: 0, unresolved: 0 };
    categoryCounts[category].products += 1;
    if (status === "configurador") categoryCounts[category].configurators += 1;
    if (status === "sin_atributo_identificable") categoryCounts[category].unresolved += 1;
  }

  records.push({
    id: family.id,
    title: family.title,
    merchant,
    categories,
    sourceVariants: originalVariants.length,
    presentedVariants: presentation.variants.length,
    duplicatesGrouped: Math.max(0, originalVariants.length - presentation.variants.length),
    genericSourceLabels: genericLabels,
    status,
    controls,
    availableSizes: presentation.availableSizes
  });
}

records.sort((left, right) => left.merchant.localeCompare(right.merchant) || left.title.localeCompare(right.title));
const summary = {
  generatedAt: new Date().toISOString(),
  publishedSources: sourcePaths.size,
  uniqueFamiliesReviewed: families.size,
  optionFamiliesReviewed: records.length,
  familiesWithConfigurator: records.filter((item) => item.status === "configurador").length,
  identicalVariantFamiliesCollapsed: records.filter((item) => item.status === "duplicados_agrupados").length,
  familiesWithoutIdentifiableAttribute: records.filter((item) => item.status === "sin_atributo_identificable").length,
  sourceVariants: sourceVariantCount,
  presentedVariants: presentedVariantCount,
  duplicatesGrouped: sourceVariantCount - presentedVariantCount,
  familiesWithGenericSourceLabels: genericLabelFamilies,
  controlsByAttribute: Object.fromEntries(Object.entries(attributeCounts).sort((a, b) => b[1] - a[1])),
  merchants: Object.fromEntries(Object.entries(merchantCounts).sort((a, b) => a[0].localeCompare(b[0]))),
  categories: Object.fromEntries(Object.entries(categoryCounts).sort((a, b) => a[0].localeCompare(b[0])))
};

await mkdir(resolve(root, "data/catalog"), { recursive: true });
await writeFile(outputJson, `${JSON.stringify({ schemaVersion: 1, summary, products: records }, null, 2)}\n`, "utf8");

const csvLines = [
  ["id", "producto", "tienda", "categorias", "variantes_origen", "variantes_presentadas", "duplicados_agrupados", "etiquetas_genericas_origen", "estado", "controles", "valores"].map(csv).join(",")
];
for (const record of records) {
  csvLines.push([
    record.id,
    record.title,
    record.merchant,
    record.categories,
    record.sourceVariants,
    record.presentedVariants,
    record.duplicatesGrouped,
    record.genericSourceLabels,
    record.status,
    record.controls.map((control) => `${control.label} (${control.type})`),
    [
      ...record.controls.map((control) => `${control.label}: ${control.values.join(" / ")}`),
      ...(record.availableSizes.length ? [`Tallas disponibles: ${record.availableSizes.join(" / ")}`] : [])
    ]
  ].map(csv).join(","));
}
await writeFile(outputCsv, `${csvLines.join("\n")}\n`, "utf8");

console.log(JSON.stringify(summary, null, 2));
