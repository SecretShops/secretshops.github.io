const REGION_ID_PATTERN = /^[a-z]{2}$/;
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function normalizeBasePath(value) {
  const raw = String(value || "/").trim();
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const compact = withLeadingSlash.replace(/\/+/g, "/");
  return compact === "/" ? "/" : `${compact.replace(/\/+$/, "")}/`;
}

export function normalizePathname(value) {
  const raw = String(value || "/").split("?")[0].split("#")[0];
  const compact = `/${raw}`.replace(/\/+/g, "/");
  return compact === "/" ? "/" : `${compact.replace(/\/+$/, "")}/`;
}

export function validateRegionConfig(payload) {
  assert(payload?.schemaVersion === 1, "regions.json: schemaVersion inválido");
  assert(/^https:\/\/[^/]+$/i.test(payload.domain), "regions.json: domain debe ser un origen HTTPS");
  assert(Array.isArray(payload.regions) && payload.regions.length > 0, "regions.json: regions obligatorio");
  assert(typeof payload.defaultRegion === "string", "regions.json: defaultRegion obligatorio");
  assert(normalizeBasePath(payload.selectorPath) === payload.selectorPath, "regions.json: selectorPath inválido");

  const ids = new Set();
  const countries = new Set();
  const paths = new Set();
  for (const region of payload.regions) {
    assert(REGION_ID_PATTERN.test(region.id), `Región con id inválido: ${region.id}`);
    assert(!ids.has(region.id), `Región duplicada: ${region.id}`);
    ids.add(region.id);
    assert(COUNTRY_CODE_PATTERN.test(region.countryCode), `${region.id}: countryCode inválido`);
    assert(!countries.has(region.countryCode), `País duplicado: ${region.countryCode}`);
    countries.add(region.countryCode);
    assert(typeof region.name === "string" && region.name.trim(), `${region.id}: name obligatorio`);
    assert(LOCALE_PATTERN.test(region.locale), `${region.id}: locale inválido`);
    assert(CURRENCY_PATTERN.test(region.currency), `${region.id}: currency inválida`);
    assert(["published", "draft"].includes(region.status), `${region.id}: status inválido`);
    assert(normalizeBasePath(region.basePath) === region.basePath, `${region.id}: basePath inválido`);
    assert(!paths.has(region.basePath), `Ruta regional duplicada: ${region.basePath}`);
    paths.add(region.basePath);
    if (region.status === "published") {
      assert(region.catalogManifest?.startsWith("/data/"), `${region.id}: falta catalogManifest publicable`);
      assert(region.affiliateLinks?.startsWith("/data/"), `${region.id}: falta affiliateLinks publicable`);
    }
  }

  const defaultRegion = payload.regions.find((region) => region.id === payload.defaultRegion);
  assert(defaultRegion, "regions.json: defaultRegion no existe");
  assert(defaultRegion.status === "published", "regions.json: defaultRegion debe estar published");
  return payload;
}

export function publishedRegions(config) {
  return config.regions.filter((region) => region.status === "published");
}

export function regionById(config, id) {
  return config.regions.find((region) => region.id === String(id || "").toLowerCase()) || null;
}

export function regionForPath(config, pathname) {
  const path = normalizePathname(pathname);
  const regional = [...config.regions]
    .filter((region) => region.basePath !== "/")
    .sort((left, right) => right.basePath.length - left.basePath.length)
    .find((region) => path === region.basePath || path.startsWith(region.basePath));
  return regional || regionById(config, config.defaultRegion);
}

export function resolveActiveRegion(config, declaredRegion, pathname) {
  validateRegionConfig(config);
  const declared = regionById(config, declaredRegion);
  const inferred = regionForPath(config, pathname);
  const active = declared || inferred;
  assert(active, "No se pudo resolver la región activa");
  assert(active.status === "published", `${active.id}: la región todavía no está publicada`);
  if (active.basePath !== "/") {
    const path = normalizePathname(pathname);
    assert(path.startsWith(active.basePath), `${active.id}: la URL no pertenece a la región declarada`);
  }
  return active;
}

export function regionStorageKeys(regionId) {
  const id = String(regionId || "").toLowerCase();
  assert(REGION_ID_PATTERN.test(id), "regionStorageKeys: id regional inválido");
  return {
    favorites: `secretshop:${id}:favorites:v2`,
    recent: `secretshop:${id}:recent:v2`,
    searches: `secretshop:${id}:searches:v2`,
    compare: `secretshop:${id}:compare:v2`,
    theme: "secretshop:theme:v1"
  };
}

export function slugifyRoute(value, maximumLength = 72) {
  const slug = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maximumLength)
    .replace(/-+$/g, "");
  return slug || "producto";
}

export function productPath(family, region) {
  const basePath = normalizeBasePath(region?.basePath);
  const title = slugifyRoute(family?.slug || family?.title, 72);
  const identifier = slugifyRoute(family?.id, 48);
  return `${basePath}producto/${title}--${identifier}/`.replace(/\/+/g, "/");
}

export function publicAssetUrl(value) {
  const url = String(value || "").trim();
  if (url.startsWith("./")) return `/${url.slice(2)}`;
  return url;
}

export function offerRedirectPath(regionId, offerId) {
  const region = encodeURIComponent(String(regionId || "").toLowerCase());
  const offer = encodeURIComponent(String(offerId || ""));
  return `/go.html?region=${region}&offer=${offer}`;
}
