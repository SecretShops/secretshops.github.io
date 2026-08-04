#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedAt = "2026-08-04T14:00:00.000Z";
const date = "2026-08-04";

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
}

async function writeJson(relativePath, value) {
  const target = resolve(root, relativePath);
  const temporary = `${target}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

function upsertById(items, entry) {
  const next = items.filter((item) => item.id !== entry.id);
  next.push(entry);
  return next.sort((left, right) => String(left.id).localeCompare(String(right.id), "en"));
}

const merchants = [
  {
    id: "voghion-global-es",
    name: "Voghion Global",
    country: "ES",
    countries: ["ES", "PT", "FR", "DE", "IT", "AT", "BE", "NL", "FI", "SK", "LV", "LT", "LU", "EE", "SI", "HR", "GR"],
    status: "approved",
    network: "awin",
    awinAdvertiserId: "44635",
    feedExpected: true,
    feedId: "98653",
    catalogMode: "retail_curated",
    landingDomains: ["www.voghion.com", "voghion.com", "voghion-appin.onelink.me"],
    currency: "EUR",
    statusUpdatedAt: date,
    publicationStatus: "published_staged",
    preparedCountries: ["ES", "PT", "FR", "DE", "IT", "AT", "BE", "NL", "FI", "SK", "LV", "LT", "LU", "EE", "SI", "HR", "GR"],
    shippingEvidence: "https://www.voghion.com/shipping-policy"
  },
  {
    id: "al-jazeera-perfumes-eu",
    name: "Al Jazeera Perfumes EU",
    country: "ES",
    countries: ["ES", "PT", "FR", "DE", "IT", "AT", "BE", "IE", "NL", "FI", "SK", "LV", "LT", "LU", "EE", "SI", "HR", "MC", "GR", "BG"],
    status: "approved",
    network: "awin",
    awinAdvertiserId: "126135",
    feedExpected: true,
    feedId: "115871",
    catalogMode: "retail_curated",
    landingDomains: ["europe.aljazeeraperfumes.com", "api-europe.aljazeeraperfumes.com"],
    currency: "EUR",
    statusUpdatedAt: date,
    publicationStatus: "published_staged",
    preparedCountries: ["ES", "PT", "FR", "DE", "IT", "AT", "BE", "IE", "NL", "FI", "SK", "LV", "LT", "LU", "EE", "SI", "HR", "MC", "GR", "BG"],
    shippingEvidence: "https://europe.aljazeeraperfumes.com/es/page/shipping-and-delivery"
  },
  {
    id: "foot-store-es",
    name: "Foot-Store ES",
    country: "ES",
    countries: ["ES", "PT", "FR", "DE", "IT", "AT", "BE", "IE", "NL", "SK", "LV", "LT", "LU", "EE", "SI", "HR", "MC", "GR", "BG"],
    status: "approved",
    network: "awin",
    awinAdvertiserId: "65912",
    feedExpected: true,
    feedId: "89032",
    catalogMode: "retail_curated",
    landingDomains: ["foot-store.es", "www.foot-store.es", "cdn.blazimg.com"],
    currency: "EUR",
    statusUpdatedAt: date,
    publicationStatus: "published_staged",
    preparedCountries: ["ES", "PT", "FR", "DE", "IT", "AT", "BE", "IE", "NL", "SK", "LV", "LT", "LU", "EE", "SI", "HR", "MC", "GR", "BG"],
    shippingEvidence: "https://foot-store.es/tarifas-y-opciones-de-envio"
  },
  {
    id: "gigasport-es",
    name: "Gigasport ES",
    country: "ES",
    countries: ["ES"],
    status: "approved",
    network: "awin",
    awinAdvertiserId: "121582",
    feedExpected: true,
    feedId: "112011",
    catalogMode: "retail_curated",
    landingDomains: ["www.gigasport.es", "gigasport.es"],
    currency: "EUR",
    statusUpdatedAt: date,
    publicationStatus: "published_staged",
    preparedCountries: ["ES"],
    shippingEvidence: "https://www.gigasport.es/faq/envios-y-entregas/"
  }
];

const sportRules = [
  { category: "Ciclismo", includeAny: ["cycling", "cyclisme", "ciclismo", "bicicleta", "bicycle", "bike", "velo"] },
  { category: "Zapatillas de trail", includeAny: ["trail shoe", "trail running", "zapatilla trail"] },
  { category: "Zapatillas de running", includeAny: ["running shoe", "running shoes", "zapatilla running"] },
  { category: "Running", includeAny: ["running", "athletisme", "atletismo", "course a pied"] },
  { category: "Aventura y viajes", includeAny: ["outdoor", "hiking", "senderismo", "camping", "ski", "snowboard", "randonnee"] },
  { category: "Textil deportivo", includeAny: ["maillot", "jersey", "camiseta", "shirt", "short", "pantalon", "legging", "chaqueta", "jacket", "ropa"] },
  { category: "Deporte", includeAny: ["football", "futbol", "basket", "handball", "volley", "rugby", "tennis", "padel", "multisports", "fitness", "natation", "swimming", "deportes", "sport"] }
];

const profiles = {
  "voghion-global-es": {
    country: "ES", currency: "EUR", department: "Moda", fallbackCategory: "Accesorios y complementos",
    defaultCondition: "new", requireGlobalIdentifier: false, requireExactIdentifier: false,
    allowMerchantScopedProductId: true,
    categoryRules: [
      { category: "Moda mujer", includeAny: ["women's clothing", "womens clothing"] },
      { category: "Moda hombre", includeAny: ["men's clothing", "mens clothing"] },
      { category: "Moda infantil", includeAny: ["mother & kids", "mother and kids"] },
      { category: "Joyería", includeAny: ["jewelry & accessories", "jewelry and accessories"] },
      { category: "Accesorios y complementos", includeAny: ["shoes", "apparel accessories", "watches"] },
      { category: "Aventura y viajes", includeAny: ["luggage & bags", "luggage and bags"] },
      { category: "Deporte", includeAny: ["sports & outdoor", "sports and outdoor"] },
      { category: "Cuidado del cabello", includeAny: ["hair extensions & wigs", "hair extensions and wigs"] },
      { category: "Belleza y cuidado", includeAny: ["beauty & health", "beauty and health"] },
      { category: "Tecnología", includeAny: ["cellphones & telecommunications", "consumer electronics", "computer & office", "computer and office", "education & office supplies", "education and office supplies"] },
      { category: "Hogar", includeAny: ["home & garden", "home and garden", "home appliances", "home improvement", "tools"] },
      { category: "Coche/Moto", includeAny: ["automobiles & motorcycles", "automobiles and motorcycles", "motors"] },
      { category: "Juguetes", includeAny: ["toys & games", "toys and games"] },
      { category: "Mascotas", includeAny: ["pet products"] }
    ]
  },
  "al-jazeera-perfumes-eu": {
    country: "ES", currency: "EUR", department: "Belleza y cuidado", fallbackCategory: "Perfumería",
    defaultCondition: "new", requireGlobalIdentifier: false, requireExactIdentifier: false,
    allowMerchantScopedProductId: true,
    categoryRules: [{ category: "Perfumería", includeAny: ["perfume", "eau de parfum", "fragrance"] }]
  },
  "foot-store-es": {
    country: "ES", currency: "EUR", department: "Deporte", fallbackCategory: "Deporte",
    defaultCondition: "new", requireGlobalIdentifier: false, requireExactIdentifier: false,
    allowMerchantScopedProductId: true, categoryRules: sportRules
  },
  "gigasport-es": {
    country: "ES", currency: "EUR", department: "Deporte", fallbackCategory: "Deporte",
    defaultCondition: "new", requireGlobalIdentifier: false, requireExactIdentifier: false,
    allowMerchantScopedProductId: true, categoryRules: sportRules
  }
};

const [merchantPayload, profilePayload, taxonomy, branding, impact] = await Promise.all([
  readJson("data/catalog/merchants.json"),
  readJson("data/catalog/awin-import-profiles.json"),
  readJson("data/catalog/category-taxonomy.json"),
  readJson("data/config/store-branding.json"),
  readJson("data/catalog/impact-sync-config.json")
]);

const lounge = merchantPayload.merchants.find((merchant) => merchant.id === "lounge-eu");
if (!lounge) throw new Error("No se encontró lounge-eu en merchants.json");
Object.assign(lounge, {
  status: "paused",
  statusUpdatedAt: date,
  publicationStatus: "held_contract_expired",
  temporaryRemovalReason: "Impact contract expired; sources retained for reversible restoration."
});
merchantPayload.updatedAt = date;
for (const merchant of merchants) merchantPayload.merchants = upsertById(merchantPayload.merchants, merchant);

profilePayload.merchants = { ...(profilePayload.merchants || {}), ...profiles };

const taxonomyAdditions = [
  { id: "fashion", label: "Moda", parent: null, showOnHome: true, order: 65 },
  { id: "kids-fashion", label: "Moda infantil", parent: null, showOnHome: true, order: 85 },
  { id: "fashion-accessories", label: "Accesorios y complementos", parent: null, showOnHome: true, order: 105 },
  { id: "pets", label: "Mascotas", parent: null, showOnHome: true, order: 127 }
];
for (const category of taxonomyAdditions) {
  if (!taxonomy.categories.some((current) => current.label === category.label)) taxonomy.categories.push(category);
}
taxonomy.updatedAt = date;

const newBranding = [
  { id: "voghion-global-es", name: "Voghion Global", domain: "www.voghion.com", logo: "/assets/brands/stores/voghion.svg" },
  { id: "al-jazeera-perfumes-eu", name: "Al Jazeera Perfumes EU", domain: "europe.aljazeeraperfumes.com", logo: "/assets/brands/stores/al-jazeera-perfumes.svg" },
  { id: "foot-store-es", name: "Foot-Store ES", domain: "foot-store.es", logo: "/assets/brands/stores/foot-store.svg" },
  { id: "gigasport-es", name: "Gigasport ES", domain: "www.gigasport.es", logo: "/assets/brands/stores/gigasport.svg" }
];
branding.stores = branding.stores.filter((store) => store.id !== "lounge-eu");
for (const store of newBranding) branding.stores = upsertById(branding.stores, store);
branding.updatedAt = date;

const loungeCatalog = impact.catalogs.find((catalog) => catalog.merchantId === "lounge-eu" || catalog.id === "lounge-eu");
if (!loungeCatalog) throw new Error("No se encontró Lounge en impact-sync-config.json");
Object.assign(loungeCatalog, {
  enabled: false,
  publicationStatus: "held_contract_expired",
  disabledAt: generatedAt
});

await Promise.all([
  writeJson("data/catalog/merchants.json", merchantPayload),
  writeJson("data/catalog/awin-import-profiles.json", profilePayload),
  writeJson("data/catalog/category-taxonomy.json", taxonomy),
  writeJson("data/config/store-branding.json", branding),
  writeJson("data/catalog/impact-sync-config.json", impact)
]);

console.log(JSON.stringify({
  status: "prepared",
  generatedAt,
  merchantsAdded: merchants.map((merchant) => merchant.id),
  loungeStatus: lounge.status,
  loungeSyncEnabled: loungeCatalog.enabled
}, null, 2));
