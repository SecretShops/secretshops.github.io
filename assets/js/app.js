import {
  asArray,
  bestOffer,
  categoryGuide,
  categoryStats,
  discountPercent,
  displayOfferPrice,
  escapeHtml,
  filterAndSortFamilies,
  filterOptions,
  formatMoney,
  getSuggestions,
  mergeCatalogPayloads,
  offerTotal,
  relatedFamilies,
  topDeals,
  topScored,
  uniqueStrings
} from "./catalog-core.js";
import {
  categoryDirectoryPath,
  categoryPath,
  offerRedirectPath,
  productPath,
  publishedRegions,
  publicAssetUrl,
  regionStorageKeys,
  resolveActiveRegion,
  storeDirectoryPath,
  storePath,
  validateRegionConfig
} from "./region-core.js";
import {
  applyStaticLocale,
  createTranslator,
  localizeCategory
} from "./i18n.js";

const REGIONS_URL = "/data/config/regions.json";
const TAXONOMY_URL = "/data/catalog/category-taxonomy.json";
const STORE_BRANDING_URL = "/data/config/store-branding.json";
const LEGACY_STORAGE_KEYS = {
  favorites: "secretshop:favorites:v1",
  recent: "secretshop:recent:v1",
  searches: "secretshop:searches:v1",
  compare: "secretshop:compare:v1",
  theme: "secretshop:theme:v1"
};

const PAGE_SIZE = 24;
const MAX_COMPARE = 4;
const MAIN_CATEGORIES = ["Tecnología", "Moda", "Hogar", "Belleza y cuidado"];
const DIRECTORY_CATEGORIES = [
  "Tecnología",
  "Moda",
  "Hogar",
  "Belleza y cuidado",
  "Deportes",
  "Familia y ocio",
  "Aventura y viajes",
  "Motor",
  "Mascotas"
];
const HERO_ROTATION_MS = 12_000;
const DEALS_ROTATION_MS = 18_000;
let activeRegion = null;
let regionsConfig = null;
let catalogSources = [];
let categoryTaxonomy = [];
let storeBranding = new Map();
let storageKeys = null;
let formatter = new Intl.NumberFormat("es-ES");
let t = createTranslator("es-ES");

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function readStoredArray(key, legacyKey = null) {
  try {
    const current = localStorage.getItem(key);
    const fallback = current === null && legacyKey ? localStorage.getItem(legacyKey) : null;
    const parsed = JSON.parse(current ?? fallback ?? "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function writeStoredArray(key, values) {
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // La web sigue funcionando aunque el navegador bloquee el almacenamiento.
  }
}

function initialState() {
  const params = new URLSearchParams(location.search);
  const legacy = activeRegion.id === regionsConfig.defaultRegion ? LEGACY_STORAGE_KEYS : {};
  const initialCategory = document.body.dataset.initialCategory || params.get("categoria");
  const initialStore = document.body.dataset.initialStore || params.get("tienda");
  const minimumPrice = Number(params.get("precio_min"));
  const maximumPrice = Number(params.get("precio_max"));
  return {
    query: String(params.get("q") || "").slice(0, 120),
    category: initialCategory || "all",
    country: activeRegion.countryCode,
    store: initialStore || "all",
    sort: params.get("orden") || "relevance",
    minimumPrice: params.has("precio_min") && Number.isFinite(minimumPrice)
      ? Math.max(0, minimumPrice)
      : null,
    maximumPrice: params.has("precio_max") && Number.isFinite(maximumPrice)
      ? Math.max(0, maximumPrice)
      : null,
    discountOnly: params.get("descuento") === "1",
    multipleVariants: params.get("variantes") === "1",
    visible: PAGE_SIZE,
    favorites: new Set(readStoredArray(storageKeys.favorites, legacy.favorites)),
    recent: readStoredArray(storageKeys.recent, legacy.recent),
    searches: readStoredArray(storageKeys.searches, legacy.searches),
    compare: readStoredArray(storageKeys.compare, legacy.compare).slice(0, MAX_COMPARE),
    savedTab: "favorites",
    selectedFamilyId: null,
    selectedVariantId: null,
    selectedImage: null,
    suggestionIndex: -1,
    suggestions: []
  };
}

let state = null;
let families = [];
let familyById = new Map();
let familyByProductPath = new Map();
let categoryByPath = new Map();
let storeByPath = new Map();
let catalogWarnings = [];
let inputTimer = null;
let heroRotationTimer = null;
let dealsRotationTimer = null;
let heroRotationOffset = 0;
let catalogResultCount = 0;
let catalogObserver = null;

function currentFilters(overrides = {}) {
  return {
    query: state.query,
    category: state.category,
    country: state.country,
    store: state.store,
    sort: state.sort,
    minimumPrice: state.minimumPrice,
    maximumPrice: state.maximumPrice,
    discountOnly: state.discountOnly,
    multipleVariants: state.multipleVariants,
    ...overrides
  };
}

function dispatchAnalytics(name, detail = {}) {
  const payload = {
    event: `secretshop_${name}`,
    region: activeRegion.id,
    country: activeRegion.countryCode,
    ...detail
  };
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(payload);
  document.dispatchEvent(new CustomEvent("secretshop:analytics", { detail: payload }));
}

function showToast(message) {
  const region = $("[data-toast-region]");
  if (!region) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function openDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
  document.body.classList.add("modal-open");
}

function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === "function" && dialog.open) dialog.close();
  if (!$$("dialog[open]").some((item) => item !== dialog)) {
    document.body.classList.remove("modal-open");
  }
}

function syncBodyModalState() {
  document.body.classList.toggle("modal-open", $$("dialog[open]").length > 0);
}

async function fetchCatalogSource(source) {
  const response = await fetch(source.path, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`${source.id}: respuesta ${response.status}`);
  }
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.families)) {
    throw new Error(`${source.id}: catálogo sin familias`);
  }
  return { ...source, payload };
}

async function loadCatalog() {
  const settled = await Promise.allSettled(catalogSources.map(fetchCatalogSource));
  const loaded = [];
  const failed = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") loaded.push(result.value);
    else failed.push(`${catalogSources[index].id}: ${result.reason?.message || "error"}`);
  });

  const merged = mergeCatalogPayloads(loaded);
  for (const family of merged.families) {
    for (const offer of family.offers) {
      if (offer.country !== activeRegion.countryCode) {
        throw new Error(`${offer.id}: oferta de ${offer.country} detectada en ${activeRegion.id}`);
      }
      if (offer.currency && offer.currency !== activeRegion.currency) {
        throw new Error(`${offer.id}: moneda ${offer.currency} detectada en ${activeRegion.id}`);
      }
    }
  }
  families = merged.families;
  familyById = new Map(families.map((family) => [family.id, family]));
  familyByProductPath = new Map(
    families.map((family) => [productPath(family, activeRegion), family.id])
  );
  categoryByPath = new Map(
    uniqueStrings(families.flatMap((family) => [
      ...(family.categories || []),
      ...(family.groups || [])
    ])).map((category) => [
      normalizeRoute(categoryPath(category, activeRegion)),
      category
    ])
  );
  storeByPath = new Map(
    uniqueStrings(families.flatMap((family) => family.stores || []))
      .map((store) => [
        normalizeRoute(storePath(store, activeRegion)),
        store
      ])
  );
  catalogWarnings = [...merged.warnings, ...failed];

  state.favorites = new Set(
    [...state.favorites].filter((id) => familyById.has(id))
  );
  state.recent = state.recent.filter((id) => familyById.has(id)).slice(0, 16);
  state.compare = state.compare.filter((id) => familyById.has(id)).slice(0, MAX_COMPARE);
  persistPersonalState();

  if (families.length === 0) {
    throw new Error("No se pudo cargar ningún producto válido");
  }

  return merged.stats;
}

function persistPersonalState() {
  writeStoredArray(storageKeys.favorites, [...state.favorites]);
  writeStoredArray(storageKeys.recent, state.recent);
  writeStoredArray(storageKeys.searches, state.searches);
  writeStoredArray(storageKeys.compare, state.compare);
}

function updateUrl() {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.category !== "all" && state.store !== "all") {
    params.set("tienda", state.store);
  }
  if (state.sort !== "relevance") params.set("orden", state.sort);
  if (Number.isFinite(state.minimumPrice)) params.set("precio_min", String(state.minimumPrice));
  if (Number.isFinite(state.maximumPrice)) params.set("precio_max", String(state.maximumPrice));
  if (state.discountOnly) params.set("descuento", "1");
  if (state.multipleVariants) params.set("variantes", "1");
  const query = params.toString();
  const base = state.category !== "all"
    ? categoryPath(state.category, activeRegion)
    : state.store !== "all"
      ? storePath(state.store, activeRegion)
      : document.body.dataset.pageKind === "categories"
        ? categoryDirectoryPath(activeRegion)
        : document.body.dataset.pageKind === "stores"
          ? storeDirectoryPath(activeRegion)
          : activeRegion.basePath;
  const next = `${base}${query ? `?${query}` : ""}`;
  history.replaceState(history.state, "", next);
}

function syncSearchInputs(source = null) {
  $$("[data-search-input]").forEach((input) => {
    if (input !== source && input.value !== state.query) input.value = state.query;
  });
}

function renderCatalogStatus(stats) {
  const status = $("[data-catalog-status]");
  if (!status) return;
  status.classList.toggle("is-warning", catalogWarnings.length > 0);
  status.classList.toggle("is-ready", catalogWarnings.length === 0);
  status.textContent = catalogWarnings.length
    ? t("catalogPartial", { count: formatter.format(stats.families) })
    : t("productsAvailable", { count: formatter.format(stats.families) });
}

function renderMetrics(stats) {
  $("[data-family-total]").textContent = formatter.format(stats.families);
  $("[data-variant-total]").textContent = formatter.format(stats.variants);
  $("[data-store-total]").textContent = formatter.format(stats.stores.length);
  $$("[data-current-year]").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });
}

function familyHref(family) {
  return productPath(family, activeRegion);
}

function familyPriceMarkup(family, offer) {
  const current = displayOfferPrice(offer);
  const previous = Number(offer?.previousPrice);
  const previousMarkup =
    Number.isFinite(previous) && offer?.currency && previous > (offerTotal(offer) ?? previous)
      ? `<span class="previous-price">${escapeHtml(formatMoney(previous, offer.currency, offer.country))}</span>`
      : "";
  return `
    <div class="price-line">
      <span>${family.minPrice === null ? "" : t("from")}</span>
      <strong>${escapeHtml(current)}</strong>
      ${previousMarkup}
    </div>`;
}

function productCardMarkup(family, options = {}) {
  const offer = bestOffer(family, activeRegion.countryCode);
  const favorite = state.favorites.has(family.id);
  const compared = state.compare.includes(family.id);
  const discount = discountPercent(offer);
  const optionText = family.variantCount === 1
    ? t("oneOption")
    : t("options", { count: formatter.format(family.variantCount) });
  const storeText = family.stores.length === 1
    ? t("oneStoreOffer")
    : t("storeOffers", { count: formatter.format(family.stores.length) });
  const loading = options.eager ? "eager" : "lazy";

  return `
    <article class="product-card" data-family-card="${escapeHtml(family.id)}">
      <a
        class="product-card-hit"
        href="${escapeHtml(familyHref(family))}"
        data-open-family="${escapeHtml(family.id)}"
        aria-label="${escapeHtml(t("openProduct", { title: family.title }))}"
      ></a>
      <div class="product-media">
        <div class="card-badges">
          ${discount > 0 ? `<span class="badge discount">−${discount}%</span>` : ""}
        </div>
        <button
          class="card-icon-button ${favorite ? "is-active" : ""}"
          type="button"
          data-toggle-favorite="${escapeHtml(family.id)}"
          aria-label="${favorite ? t("removeFavorite") : t("addFavorite")}"
          aria-pressed="${favorite}"
        >${favorite ? "♥" : "♡"}</button>
        <img
          src="${escapeHtml(publicAssetUrl(family.image))}"
          data-image-fallback="/assets/brand/product-placeholder.svg"
          alt="${escapeHtml(family.title)}"
          loading="${loading}"
          width="420"
          height="420"
        >
      </div>
      <div class="product-body">
        <p class="product-meta">${escapeHtml(localizeCategory(family.primaryGroup, activeRegion.locale))} · ${escapeHtml(family.brand)}</p>
        <h3>${escapeHtml(family.title)}</h3>
        <div class="card-score-row">
          <span class="score" title="${escapeHtml(t("scoreTitle"))}">SecretScore ${family.secretScore.toFixed(1)}</span>
          <span class="variant-count">${escapeHtml(optionText)}</span>
        </div>
        ${familyPriceMarkup(family, offer)}
        <p class="store-line"><span class="availability-dot"></span>${escapeHtml(storeText)}</p>
        <div class="product-actions">
          <a class="product-open" href="${escapeHtml(familyHref(family))}" data-open-family="${escapeHtml(family.id)}">
            ${family.offerCount > 1 ? t("comparePrices") : t("viewOffer")}
          </a>
          <button
            class="compare-toggle ${compared ? "is-active" : ""}"
            type="button"
            data-toggle-compare="${escapeHtml(family.id)}"
            aria-label="${compared ? t("removeCompare") : t("addCompare")}"
            aria-pressed="${compared}"
          >⇄</button>
        </div>
      </div>
    </article>`;
}

function hasPresentationImage(family) {
  return Boolean(family?.image) && !family.image.includes("amazon-placeholder");
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function dailySelection(familyList, limit, salt, score = (family) => family.secretScore) {
  const day = new Date().toISOString().slice(0, 10);
  const ordered = [...familyList]
    .filter((family) => family?.image)
    .sort((left, right) =>
      Math.floor(score(right) * 2) - Math.floor(score(left) * 2) ||
      stableHash(`${day}:${salt}:${left.id}`) - stableHash(`${day}:${salt}:${right.id}`)
    );
  const output = [];
  const selectedIds = new Set();
  const usedGroups = new Set();
  const usedStores = new Set();

  const append = (family) => {
    output.push(family);
    selectedIds.add(family.id);
    if (family.primaryGroup) usedGroups.add(family.primaryGroup);
    (family.stores || []).forEach((store) => usedStores.add(store));
  };
  const hasNewStore = (family) =>
    (family.stores || []).some((store) => !usedStores.has(store));

  for (const family of ordered) {
    if (output.length >= limit) break;
    if (usedGroups.has(family.primaryGroup) || !hasNewStore(family)) continue;
    append(family);
  }
  for (const family of ordered) {
    if (output.length >= limit) break;
    if (selectedIds.has(family.id) || !hasNewStore(family)) continue;
    append(family);
  }
  for (const family of ordered) {
    if (output.length >= limit) break;
    if (!selectedIds.has(family.id)) append(family);
  }
  return output;
}

function heroSelection() {
  const candidates = families.filter(hasPresentationImage);
  const source = candidates.length >= 3 ? candidates : families;
  const pool = dailySelection(source, Math.min(18, source.length), "hero");
  if (pool.length <= 3) return pool;
  const rotated = [...pool.slice(heroRotationOffset), ...pool.slice(0, heroRotationOffset)];
  return rotated.slice(0, 3);
}

function renderHero({ animate = false } = {}) {
  const container = $("[data-hero-mosaic]");
  const draw = () => {
    const mosaic = heroSelection();
    container.innerHTML = mosaic.map((family) => {
      const offer = bestOffer(family);
      const optionLabel = family.variantCount === 1
        ? t("oneOption")
        : t("options", { count: formatter.format(family.variantCount) });
      return `
        <a class="mosaic-card" href="${escapeHtml(familyHref(family))}" data-open-family="${escapeHtml(family.id)}">
          <img src="${escapeHtml(publicAssetUrl(family.image))}" alt="${escapeHtml(family.title)}" width="500" height="500" loading="eager">
          <span class="mosaic-label">
            <strong>${escapeHtml(family.title)}</strong>
            <span>${escapeHtml(displayOfferPrice(offer))} · ${escapeHtml(optionLabel)}</span>
          </span>
        </a>`;
    }).join("");
    container.classList.remove("is-changing");
  };
  if (!animate) {
    draw();
    return;
  }
  container.classList.add("is-changing");
  window.setTimeout(draw, 180);
}

function categoryImage(categoryName) {
  const candidates = families
    .filter((family) => family.groups.includes(categoryName) && hasPresentationImage(family));
  const fallback = families
    .filter((family) => family.groups.includes(categoryName) && family.image);
  return dailySelection(
    candidates.length ? candidates : fallback,
    1,
    `category:${normalizedLabel(categoryName)}`
  )[0]?.image || "";
}

function normalizedLabel(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function localizedRegionName(region) {
  try {
    return new Intl.DisplayNames([activeRegion?.locale || region.locale || "es"], {
      type: "region"
    }).of(region.countryCode) || region.name;
  } catch {
    return region.name;
  }
}

function familyMatchesCategory(family, categoryName) {
  const target = normalizedLabel(categoryName);
  return [...family.categories, ...family.groups]
    .some((value) => normalizedLabel(value) === target);
}

function categoryProductCount(categoryName) {
  return families.filter((family) => familyMatchesCategory(family, categoryName)).length;
}

function productCountLabel(count) {
  const normalizedCount = Number(count) || 0;
  if (normalizedCount === 1) {
    return t("oneProduct");
  }
  return t("productsCount", { count: formatter.format(normalizedCount) });
}

function categoryEntries() {
  const taxonomyByLabel = new Map(
    categoryTaxonomy.map((entry) => [normalizedLabel(entry.label), entry])
  );
  const statsByName = new Map(
    categoryStats(families).map((entry) => [normalizedLabel(entry.name), entry])
  );

  return DIRECTORY_CATEGORIES
    .map((name, order) => {
      const count = categoryProductCount(name);
      if (!count) return null;
      const key = normalizedLabel(name);
      const taxonomy = taxonomyByLabel.get(key);
      const stats = statsByName.get(key);
      return {
        ...(taxonomy || {}),
        ...(stats || {}),
        id: taxonomy?.id || `directory-${key.replace(/\s+/g, "-")}`,
        name,
        label: name,
        count,
        icon: taxonomy?.icon || stats?.icon || "＋",
        order
      };
    })
    .filter(Boolean);
}

function subcategoryEntries(categoryName) {
  const selected = normalizedLabel(categoryName);
  const parentAliases = new Set([selected]);
  if (selected === "deportes") parentAliases.add("deporte");
  if (selected === "casa") parentAliases.add("hogar");

  let labels = categoryTaxonomy
    .filter((entry) => entry.parent && parentAliases.has(normalizedLabel(entry.parent)))
    .sort((left, right) => (left.order || 999) - (right.order || 999))
    .map((entry) => entry.label);

  const matchingFamilies = families.filter((family) => familyMatchesCategory(family, categoryName));
  if (labels.length === 0 || selected === "moda") {
    const counts = new Map();
    for (const family of matchingFamilies) {
      for (const raw of family.categories) {
        const key = normalizedLabel(raw);
        if (!key || key === selected) continue;
        counts.set(raw, (counts.get(raw) || 0) + 1);
      }
    }
    const priorityLabels = selected === "moda"
      ? ["Moda mujer", "Moda hombre", "Accesorios mujer", "Accesorios hombre", "Moda y accesorios"]
      : [];
    labels = uniqueStrings([
      ...priorityLabels,
      ...labels,
      ...[...counts.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([name]) => name)
    ]);
  }

  return labels
    .map((name) => ({ name, count: categoryProductCount(name) }))
    .filter((entry) => entry.count > 0)
    .slice(0, 14);
}

function categoryCardMarkup(category, options = {}) {
  const image = categoryImage(category.name);
  const href = categoryPath(category.name, activeRegion);
  return `
    <a class="category-card ${options.compact ? "is-compact" : ""}" href="${escapeHtml(href)}" data-set-category="${escapeHtml(category.name)}">
      <span class="category-visual" aria-hidden="true">
        ${image ? `<img src="${escapeHtml(publicAssetUrl(image))}" data-image-fallback="/assets/brand/product-placeholder.svg" alt="" loading="lazy">` : `<span class="category-icon">${escapeHtml(category.icon || "＋")}</span>`}
      </span>
      <span class="category-copy">
        <strong>${escapeHtml(localizeCategory(category.name, activeRegion.locale))}</strong>
        <small>${escapeHtml(productCountLabel(category.count))}</small>
      </span>
      <span class="category-arrow" aria-hidden="true">→</span>
    </a>`;
}

function renderCategories() {
  const allStats = new Map(categoryStats(families).map((category) => [category.name, category]));
  const categories = MAIN_CATEGORIES
    .map((name) => allStats.get(name))
    .filter(Boolean);
  $("[data-category-grid]").innerHTML = categories.map((category) => {
    return categoryCardMarkup(category);
  }).join("");
}

function renderHighlights() {
  const visualFamilies = families.filter(hasPresentationImage);
  const source = visualFamilies.length >= 16 ? visualFamilies : families;
  const dealCandidates = topDeals(source, source.length);
  const fallbackCandidates = topScored(source, source.length);
  const dealFamilies = dailySelection(
    dealCandidates.length ? dealCandidates : fallbackCandidates,
    12,
    "deals",
    (family) => family.maxDiscount || family.secretScore
  );
  const used = new Set(dealFamilies.map((family) => family.id));
  const featuredFamilies = dailySelection(
    topScored(source.filter((family) => !used.has(family.id)), source.length),
    10,
    "secret-score"
  );
  $("[data-deals-carousel]").innerHTML = dealFamilies
    .map((family) => productCardMarkup(family))
    .join("");
  $("[data-featured-grid]").innerHTML = featuredFamilies
    .map((family) => productCardMarkup(family))
    .join("");
}

function storeEntries() {
  const entries = new Map();
  for (const family of families) {
    for (const offer of family.offers) {
      const id = offer.merchantId || normalizedLabel(offer.merchantName).replace(/\s+/g, "-");
      const branding = storeBranding.get(id) || {};
      const groupId = branding.groupId || id;
      const current = entries.get(groupId) || {
        id: groupId,
        name: branding.name || offer.merchantName,
        filterNames: new Set(),
        products: new Set(),
        offers: 0,
        merchantIds: new Set(),
        ...branding
      };
      current.products.add(family.id);
      current.offers += 1;
      current.merchantIds.add(id);
      current.filterNames.add(offer.merchantName);
      entries.set(groupId, current);
    }
  }
  return [...entries.values()]
    .sort((left, right) =>
      right.products.size - left.products.size ||
      left.name.localeCompare(right.name, activeRegion.locale)
    );
}

function storeLogoMarkup(store) {
  if (store.logo) {
    return `
      <span class="store-mark has-logo" aria-hidden="true">
        <img src="${escapeHtml(publicAssetUrl(store.logo))}" alt="" loading="lazy">
        <span class="store-fallback-initials">${escapeHtml(store.name.slice(0, 2).toUpperCase())}</span>
      </span>`;
  }
  return `<span class="store-mark" aria-hidden="true">${escapeHtml(store.name.slice(0, 2).toUpperCase())}</span>`;
}

function storeFilterName(store) {
  return [...(store.filterNames || [])][0] || store.name;
}

function storeCardMarkup(store) {
  const filterName = storeFilterName(store);
  return `
      <a class="store-card" href="${escapeHtml(storePath(filterName, activeRegion))}" data-set-store="${escapeHtml(filterName)}">
        ${storeLogoMarkup(store)}
        <span class="store-copy">
          <strong>${escapeHtml(store.name)}</strong>
          <span>${escapeHtml(productCountLabel(store.products.size))}</span>
        </span>
        <span class="store-arrow" aria-hidden="true">→</span>
      </a>`;
}

function renderStores() {
  $("[data-store-grid]").innerHTML = storeEntries()
    .map(storeCardMarkup)
    .join("");
}

function renderNavigationMenus() {
  const categories = categoryEntries().slice(0, 10);
  const stores = storeEntries();
  const categoryMenu = $("[data-nav-categories]");
  const storeMenu = $("[data-nav-stores]");
  const regionMenu = $("[data-nav-regions]");
  const favoritePreview = $("[data-nav-favorites-preview]");

  if (categoryMenu) {
    categoryMenu.innerHTML = `
      <div class="nav-link-list">
        ${categories.map((category) => `
          <a href="${escapeHtml(categoryPath(category.name, activeRegion))}" data-set-category="${escapeHtml(category.name)}">
            <span>${escapeHtml(localizeCategory(category.name, activeRegion.locale))}</span>
            <small>${formatter.format(category.count)}</small>
          </a>`).join("")}
      </div>
      <a class="nav-view-all" href="${escapeHtml(categoryDirectoryPath(activeRegion))}">
        ${escapeHtml(t("viewAllCategories"))} <span aria-hidden="true">→</span>
      </a>`;
  }
  if (storeMenu) {
    storeMenu.innerHTML = `
      <div class="nav-link-list store-nav-list">
        ${stores.map((store) => `
          <a href="${escapeHtml(storePath(storeFilterName(store), activeRegion))}" data-set-store="${escapeHtml(storeFilterName(store))}">
            ${storeLogoMarkup(store)}
            <span>${escapeHtml(store.name)}</span>
            <small>${formatter.format(store.products.size)}</small>
          </a>`).join("")}
      </div>
      <a class="nav-view-all" href="${escapeHtml(storeDirectoryPath(activeRegion))}">
        ${escapeHtml(t("viewAllStores"))} <span aria-hidden="true">→</span>
      </a>`;
  }
  if (regionMenu) {
    regionMenu.innerHTML = publishedRegions(regionsConfig).map((region) => `
      <a
        href="${escapeHtml(region.basePath)}"
        hreflang="${escapeHtml(region.locale)}"
        ${region.id === activeRegion.id ? 'aria-current="page"' : ""}
      >
        <span class="region-nav-flag" aria-hidden="true">${escapeHtml(region.flag)}</span>
        <span>${escapeHtml(localizedRegionName(region))}</span>
        <small>${escapeHtml(region.currency)}</small>
      </a>`).join("");
  }
  if (favoritePreview) {
    const selected = [...state.favorites]
      .map((id) => familyById.get(id))
      .filter(Boolean)
      .slice(0, 3);
    favoritePreview.innerHTML = selected.length
      ? selected.map((family) => `
          <button type="button" class="nav-product-preview" data-open-family="${escapeHtml(family.id)}">
            <img src="${escapeHtml(publicAssetUrl(family.image))}" alt="">
            <span>${escapeHtml(family.title)}</span>
          </button>`).join("")
      : `<p>${escapeHtml(t("favoritesEmpty"))}</p>`;
  }
  $$("[data-region-categories]").forEach((link) => {
    link.href = categoryDirectoryPath(activeRegion);
  });
  $$("[data-region-stores]").forEach((link) => {
    link.href = storeDirectoryPath(activeRegion);
  });
  $$("[data-region-offers]").forEach((link) => {
    link.href = `${activeRegion.basePath}#ofertas`;
  });
  $$("[data-region-promotions]").forEach((link) => {
    link.href = `/promociones/?region=${encodeURIComponent(activeRegion.id)}`;
  });
  $$("[data-region-guides]").forEach((link) => {
    link.href = "/guias/";
  });
}

function renderFilterOptions() {
  const options = filterOptions(families);
  const categorySelect = $("[data-filter-category]");
  const categoryMarkup = `
    <option value="all">${escapeHtml(t("allCategories"))}</option>
    <optgroup label="${escapeHtml(t("mainCategories"))}">
      ${options.categoryGroups.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(localizeCategory(category, activeRegion.locale))}</option>`).join("")}
    </optgroup>
    <optgroup label="${escapeHtml(t("subcategories"))}">
      ${options.rawCategories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(localizeCategory(category, activeRegion.locale))}</option>`).join("")}
    </optgroup>`;
  categorySelect.innerHTML = categoryMarkup;
  const modalCategory = $("[data-modal-filter-category]");
  if (modalCategory) modalCategory.innerHTML = categoryMarkup;

  const storeMarkup = `
    <option value="all">${escapeHtml(t("allStores"))}</option>
    ${options.stores.map((store) => `<option value="${escapeHtml(store)}">${escapeHtml(store)}</option>`).join("")}`;
  $("[data-filter-store]").innerHTML = storeMarkup;
  const modalStore = $("[data-modal-filter-store]");
  if (modalStore) modalStore.innerHTML = storeMarkup;

  if (![...categorySelect.options].some((option) => option.value === state.category)) {
    state.category = "all";
  }
  if (![...$("[data-filter-store]").options].some((option) => option.value === state.store)) {
    state.store = "all";
  }
  syncFilterControls();
}

function syncFilterControls() {
  $("[data-filter-category]").value = state.category;
  $("[data-filter-store]").value = state.store;
  $("[data-sort]").value = state.sort;
  if ($("[data-modal-filter-category]")) $("[data-modal-filter-category]").value = state.category;
  if ($("[data-modal-filter-store]")) $("[data-modal-filter-store]").value = state.store;
  if ($("[data-modal-sort]")) $("[data-modal-sort]").value = state.sort;
  $("[data-price-min]").value = state.minimumPrice ?? "";
  $("[data-price-max]").value = state.maximumPrice ?? "";
  $("[data-discount-only]").checked = state.discountOnly;
  $("[data-multiple-variants]").checked = state.multipleVariants;
}

function activeFilterEntries() {
  return [
    state.query ? { key: "query", label: t("searchFilter", { query: state.query }) } : null,
    state.category !== "all" ? { key: "category", label: localizeCategory(state.category, activeRegion.locale) } : null,
    state.store !== "all" ? { key: "store", label: state.store } : null,
    Number.isFinite(state.minimumPrice) ? { key: "minimumPrice", label: t("priceFrom", { price: state.minimumPrice }) } : null,
    Number.isFinite(state.maximumPrice) ? { key: "maximumPrice", label: t("priceTo", { price: state.maximumPrice }) } : null,
    state.discountOnly ? { key: "discountOnly", label: t("withDiscount") } : null,
    state.multipleVariants ? { key: "multipleVariants", label: t("multipleOptions") } : null
  ].filter(Boolean);
}

function renderActiveFilters() {
  const entries = activeFilterEntries();
  $("[data-active-filters]").innerHTML = entries.map((entry) => `
    <span class="active-filter">
      ${escapeHtml(entry.label)}
      <button type="button" data-remove-filter="${escapeHtml(entry.key)}" aria-label="${escapeHtml(t("removeFilter", { label: entry.label }))}">×</button>
    </span>`).join("");
  $("[data-clear-filters]").hidden = entries.length === 0;
  const advancedCount = [
    Number.isFinite(state.minimumPrice),
    Number.isFinite(state.maximumPrice),
    state.discountOnly,
    state.multipleVariants
  ].filter(Boolean).length;
  const counter = $("[data-active-filter-count]");
  counter.hidden = advancedCount === 0;
  counter.textContent = String(advancedCount);
}

function renderCategoryGuide() {
  const container = $("[data-category-guide]");
  if (state.category === "all") {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  const guide = categoryGuide(state.category);
  container.hidden = false;
  container.innerHTML = `
    <div>
      <p class="eyebrow">${escapeHtml(t("categoryAdvice"))}</p>
      <h3>${escapeHtml(activeRegion.locale.startsWith("pt") ? localizeCategory(state.category, activeRegion.locale) : guide.title)}</h3>
      <p>${escapeHtml(activeRegion.locale.startsWith("pt") ? t("categoryDirectoryText") : guide.intro)}</p>
    </div>
    ${activeRegion.locale.startsWith("pt") ? "" : `<ul>${guide.points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>`}`;
}

function renderContextHighlights(sourceFamilies) {
  const dealsSection = $("[data-context-deals-section]");
  const scoreSection = $("[data-context-score-section]");
  const dealsContainer = $("[data-context-deals]");
  const scoreContainer = $("[data-context-score]");
  if (!dealsSection || !scoreSection || !dealsContainer || !scoreContainer) return;

  const visual = sourceFamilies.filter(hasPresentationImage);
  const source = visual.length >= 8 ? visual : sourceFamilies;
  const deals = dailySelection(
    topDeals(source, source.length),
    10,
    `context-deals:${state.category}:${state.store}`,
    (family) => family.maxDiscount || family.secretScore
  );
  const used = new Set(deals.map((family) => family.id));
  const scores = dailySelection(
    topScored(source.filter((family) => !used.has(family.id)), source.length),
    10,
    `context-score:${state.category}:${state.store}`
  );
  dealsSection.hidden = deals.length === 0;
  scoreSection.hidden = scores.length === 0;
  dealsContainer.innerHTML = deals.map((family) => productCardMarkup(family)).join("");
  scoreContainer.innerHTML = scores.map((family) => productCardMarkup(family)).join("");
}

function renderDirectoryView() {
  const panel = $("[data-directory-panel]");
  const catalogSection = $("#catalogo");
  if (!panel || !catalogSection) return;
  const requestedKind = document.body.dataset.pageKind || "home";
  const kind = state.category !== "all"
    ? "category"
    : state.store !== "all"
      ? "store"
      : requestedKind;
  const directoryView = ["categories", "category", "stores", "store"].includes(kind);
  const categoryNavigationActive = kind === "categories" || kind === "category";
  const storeNavigationActive = kind === "stores" || kind === "store";
  const categoryNavigation = $(".mobile-bottom-nav [data-region-categories]");
  const storeNavigation = $(".mobile-bottom-nav [data-region-stores]");
  if (categoryNavigationActive) categoryNavigation?.setAttribute("aria-current", "page");
  else categoryNavigation?.removeAttribute("aria-current");
  if (storeNavigationActive) storeNavigation?.setAttribute("aria-current", "page");
  else storeNavigation?.removeAttribute("aria-current");
  document.body.classList.toggle("is-directory-view", directoryView);
  $$("[data-home-only]").forEach((section) => {
    section.hidden = directoryView;
  });
  panel.hidden = !directoryView;
  catalogSection.hidden = kind === "categories" || kind === "stores";

  const eyebrow = $("[data-directory-eyebrow]");
  const title = $("[data-directory-title]");
  const text = $("[data-directory-text]");
  const categoryGrid = $("[data-category-directory-grid]");
  const subcategorySection = $("[data-subcategory-section]");
  const subcategoryGrid = $("[data-subcategory-grid]");
  const storeGrid = $("[data-store-directory-grid]");
  const storeHero = $("[data-store-hero]");
  const catalogTitle = $("[data-catalog-title]");

  categoryGrid.hidden = true;
  subcategorySection.hidden = true;
  storeGrid.hidden = true;
  storeHero.hidden = true;
  $("[data-context-deals-section]").hidden = true;
  $("[data-context-score-section]").hidden = true;
  if (catalogTitle) catalogTitle.textContent = kind === "home"
    ? (activeRegion.locale.startsWith("pt") ? "Encontre a sua próxima compra" : "Encuentra tu próxima compra")
    : t("moreProducts");

  if (!directoryView) return;

  if (kind === "categories") {
    eyebrow.textContent = t("categories");
    title.textContent = t("categoryDirectoryTitle");
    text.textContent = t("categoryDirectoryText");
    categoryGrid.hidden = false;
    categoryGrid.innerHTML = categoryEntries().map(categoryCardMarkup).join("");
    return;
  }

  if (kind === "stores") {
    eyebrow.textContent = t("stores");
    title.textContent = t("storeDirectoryTitle");
    text.textContent = t("storeDirectoryText");
    storeGrid.hidden = false;
    storeGrid.innerHTML = storeEntries().map(storeCardMarkup).join("");
    return;
  }

  if (kind === "category") {
    const selected = localizeCategory(state.category, activeRegion.locale);
    const count = categoryProductCount(state.category);
    eyebrow.textContent = t("categories");
    title.textContent = selected;
    text.textContent = productCountLabel(count);
    const subcategories = subcategoryEntries(state.category);
    subcategorySection.hidden = false;
    const subtitle = $("[data-subcategory-title]");
    if (subtitle) subtitle.textContent = subcategories.length
      ? t("exploreSubcategories")
      : t("noSubcategories");
    subcategoryGrid.innerHTML = subcategories
      .map((entry) => categoryCardMarkup(entry, { compact: true }))
      .join("");
    renderContextHighlights(
      families.filter((family) => familyMatchesCategory(family, state.category))
    );
    return;
  }

  const selectedStore = storeEntries().find(
    (entry) => entry.name === state.store || entry.filterNames?.has(state.store)
  );
  eyebrow.textContent = t("stores");
  title.textContent = state.store;
  text.textContent = selectedStore
    ? productCountLabel(selectedStore.products.size)
    : "";
  storeHero.hidden = false;
  storeHero.innerHTML = selectedStore
    ? `${storeLogoMarkup(selectedStore)}<div><strong>${escapeHtml(selectedStore.name)}</strong><span>${escapeHtml(t("storeProductsTitle", { store: selectedStore.name }))}</span></div>`
    : "";
}

function renderCatalog({ updateHistory = true } = {}) {
  const results = filterAndSortFamilies(families, currentFilters());
  const visible = results.slice(0, state.visible);
  catalogResultCount = results.length;
  const grid = $("[data-catalog-grid]");
  grid.setAttribute("aria-busy", "false");
  grid.innerHTML = visible.length
    ? visible.map((family) => productCardMarkup(family)).join("")
    : `
      <div class="empty-state">
        <div>
          <h3>${escapeHtml(t("noMatches"))}</h3>
          <p>${escapeHtml(t("tryAnother"))}</p>
          <button class="button secondary" type="button" data-clear-filters>${escapeHtml(t("clearFilters"))}</button>
        </div>
      </div>`;

  const summary = $("[data-results-summary]");
  summary.textContent = results.length === 1
    ? t("oneResult", { region: activeRegion.name })
    : t("results", { count: formatter.format(results.length), region: activeRegion.name });
  const sentinel = $("[data-catalog-sentinel]");
  if (sentinel) {
    sentinel.hidden = visible.length >= results.length;
    sentinel.setAttribute("aria-label", t("catalogLoadMore"));
  }
  renderActiveFilters();
  renderCategoryGuide();
  renderDirectoryView();
  syncFilterControls();
  if (updateHistory) updateUrl();
}

function renderFavoriteCount() {
  $$("[data-favorite-count]").forEach((node) => {
    node.textContent = String(state.favorites.size);
  });
}

function renderCompareTray() {
  const tray = $("[data-compare-tray]");
  tray.hidden = state.compare.length === 0;
  $("[data-compare-count]").textContent = String(state.compare.length);
  $("[data-compare-thumbs]").innerHTML = state.compare
    .map((id) => familyById.get(id))
    .filter(Boolean)
    .map((family) => `<img src="${escapeHtml(publicAssetUrl(family.image))}" alt="">`)
    .join("");
}

function renderPersonalizedViews() {
  renderFavoriteCount();
  renderCompareTray();
  renderNavigationMenus();
}

function refreshCardsAndCatalog() {
  renderHighlights();
  renderCatalog();
  renderPersonalizedViews();
}

function setQuery(query, options = {}) {
  state.query = String(query || "").trim().slice(0, 120);
  state.visible = PAGE_SIZE;
  syncSearchInputs(options.source);
  renderCatalog();
  if (options.save && state.query.length >= 2) saveSearch(state.query);
  if (options.scroll) $("#catalogo").scrollIntoView({ behavior: "smooth", block: "start" });
}

function scrollToCurrentView() {
  const directoryOnly = ["categories", "stores"].includes(document.body.dataset.pageKind);
  const target = directoryOnly
    ? $("[data-directory-panel]")
    : $("#catalogo");
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function saveSearch(query) {
  const normalized = query.trim();
  state.searches = [
    normalized,
    ...state.searches.filter((item) => item.toLowerCase() !== normalized.toLowerCase())
  ].slice(0, 10);
  persistPersonalState();
}

function setCategory(category, scroll = true) {
  state.query = "";
  state.category = category || "all";
  state.store = "all";
  state.minimumPrice = null;
  state.maximumPrice = null;
  state.discountOnly = false;
  state.multipleVariants = false;
  state.visible = PAGE_SIZE;
  document.body.dataset.pageKind = state.category === "all" ? "categories" : "category";
  delete document.body.dataset.initialStore;
  document.body.dataset.initialCategory = state.category === "all" ? "" : state.category;
  syncSearchInputs();
  renderCatalog({ updateHistory: false });
  history.pushState({}, "", state.category === "all"
    ? categoryDirectoryPath(activeRegion)
    : categoryPath(state.category, activeRegion));
  if (scroll) scrollToCurrentView();
}

function setStore(store, scroll = true) {
  state.query = "";
  state.category = "all";
  state.store = store || "all";
  state.minimumPrice = null;
  state.maximumPrice = null;
  state.discountOnly = false;
  state.multipleVariants = false;
  state.visible = PAGE_SIZE;
  document.body.dataset.pageKind = state.store === "all" ? "stores" : "store";
  delete document.body.dataset.initialCategory;
  document.body.dataset.initialStore = state.store === "all" ? "" : state.store;
  syncSearchInputs();
  renderCatalog({ updateHistory: false });
  history.pushState({}, "", state.store === "all"
    ? storeDirectoryPath(activeRegion)
    : storePath(state.store, activeRegion));
  if (scroll) scrollToCurrentView();
}

function setCollection(collection) {
  if (collection === "deals") {
    clearFilters();
    state.discountOnly = true;
    renderCatalog();
    $("#catalogo").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (collection === "viral") setCategory("Virales");
  if (collection === "under-10") setCategory("Menos de 10");
}

function clearFilters() {
  state.query = "";
  state.category = "all";
  state.store = "all";
  state.sort = "relevance";
  state.minimumPrice = null;
  state.maximumPrice = null;
  state.discountOnly = false;
  state.multipleVariants = false;
  state.visible = PAGE_SIZE;
  document.body.dataset.pageKind = "home";
  delete document.body.dataset.initialCategory;
  delete document.body.dataset.initialStore;
  syncSearchInputs();
  renderCatalog();
}

function removeFilter(key) {
  const resets = {
    query: "",
    category: "all",
    store: "all",
    minimumPrice: null,
    maximumPrice: null,
    discountOnly: false,
    multipleVariants: false
  };
  if (Object.hasOwn(resets, key)) state[key] = resets[key];
  if (key === "category" || key === "store") {
    document.body.dataset.pageKind = state.category !== "all"
      ? "category"
      : state.store !== "all"
        ? "store"
        : "home";
    delete document.body.dataset.initialCategory;
    delete document.body.dataset.initialStore;
  }
  state.visible = PAGE_SIZE;
  syncSearchInputs();
  renderCatalog();
}

function toggleFavorite(familyId) {
  const family = familyById.get(familyId);
  if (!family) return;
  if (state.favorites.has(familyId)) {
    state.favorites.delete(familyId);
    showToast(t("favoriteRemoved"));
  } else {
    state.favorites.add(familyId);
    showToast(t("favoriteAdded"));
  }
  persistPersonalState();
  refreshCardsAndCatalog();
  if ($("#product-dialog")?.open && state.selectedFamilyId === familyId) {
    renderProductDialog(familyId, state.selectedVariantId);
  }
  if ($("#saved-dialog")?.open) renderSavedContent();
}

function toggleCompare(familyId) {
  if (!familyById.has(familyId)) return;
  if (state.compare.includes(familyId)) {
    state.compare = state.compare.filter((id) => id !== familyId);
  } else if (state.compare.length >= MAX_COMPARE) {
    showToast(t("compareMaximum", { count: MAX_COMPARE }));
    return;
  } else {
    state.compare.push(familyId);
    showToast(t("compareAdded"));
  }
  persistPersonalState();
  refreshCardsAndCatalog();
  if ($("#product-dialog")?.open && state.selectedFamilyId === familyId) {
    renderProductDialog(familyId, state.selectedVariantId);
  }
  if ($("#compare-dialog")?.open) renderComparison();
}

function rememberViewed(familyId) {
  state.recent = [familyId, ...state.recent.filter((id) => id !== familyId)].slice(0, 16);
  persistPersonalState();
}

function availabilityLabel(value) {
  const labels = {
    in_stock: t("inStock"),
    preorder: t("preorder"),
    unknown: t("confirmStore")
  };
  return labels[value] || t("available");
}

function shippingLabel(offer) {
  if (offer.shippingCost === 0) return t("free");
  if (Number.isFinite(offer.shippingCost)) {
    return formatMoney(offer.shippingCost, offer.currency, offer.country);
  }
  return t("consult");
}

function shippingDetailLabel(offer) {
  const label = shippingLabel(offer);
  return label === t("consult") ? t("shippingConfirm") : t("shipping", { value: label });
}

function bestPriceNote(offer, index) {
  return index === 0 && offerTotal(offer) !== null ? t("bestPrice") : "";
}

function variantAttributes(variant) {
  return [
    [t("color"), variant.color],
    [t("size"), variant.size],
    [t("orientation"), variant.orientation],
    [t("dimensions"), variant.dimensions],
    [t("material"), variant.material],
    [t("capacity"), variant.capacity],
    [t("configuration"), variant.configuration]
  ].filter(([, value]) => value);
}

function offerRowMarkup(offer, index) {
  const href = offerRedirectPath(activeRegion.id, offer.id);
  return `
    <tr class="${index === 0 ? "best-row" : ""}">
      <td><strong>${escapeHtml(offer.merchantName)}</strong>${bestPriceNote(offer, index) ? `<br><small>${bestPriceNote(offer, index)}</small>` : ""}</td>
      <td>${escapeHtml(displayOfferPrice(offer))}</td>
      <td>${escapeHtml(shippingLabel(offer))}</td>
      <td>${escapeHtml(availabilityLabel(offer.availability))}</td>
      <td><a class="offer-link" href="${escapeHtml(href)}" target="_blank" rel="nofollow sponsored noopener" data-outbound-offer="${escapeHtml(offer.id)}">${escapeHtml(t("viewOffer"))}</a></td>
    </tr>`;
}

function offerCardMarkup(offer, index) {
  const href = offerRedirectPath(activeRegion.id, offer.id);
  return `
    <article class="offer-card ${index === 0 ? "is-best" : ""}">
      <div class="offer-card-store">
        <strong>${escapeHtml(offer.merchantName)}</strong>
        <small>${bestPriceNote(offer, index) || escapeHtml(availabilityLabel(offer.availability))}</small>
      </div>
      <div class="offer-card-price">
        <strong>${escapeHtml(displayOfferPrice(offer))}</strong>
        <small>${escapeHtml(shippingLabel(offer))}</small>
      </div>
      <a class="offer-link" href="${escapeHtml(href)}" target="_blank" rel="nofollow sponsored noopener" data-outbound-offer="${escapeHtml(offer.id)}">${escapeHtml(t("viewOffer"))}</a>
    </article>`;
}

function renderProductDialog(familyId, preferredVariantId = null) {
  const family = familyById.get(familyId);
  if (!family) return;
  const variant =
    family.variants.find((item) => item.id === preferredVariantId) ||
    family.variants[0];
  state.selectedFamilyId = family.id;
  state.selectedVariantId = variant.id;
  const images = uniqueStrings([...variant.images, ...family.images]).slice(0, 8);
  state.selectedImage =
    images.includes(state.selectedImage) ? state.selectedImage : images[0] || family.image;
  const offers = [...variant.offers].sort((left, right) =>
    (offerTotal(left) ?? Infinity) - (offerTotal(right) ?? Infinity)
  );
  const best = offers[0] || null;
  const attributes = variantAttributes(variant);
  const compared = state.compare.includes(family.id);
  const favorite = state.favorites.has(family.id);
  const related = relatedFamilies(families, family, 3);
  const content = $("[data-product-content]");

  const purchaseSummary = best ? `
    <section class="product-buy-summary" aria-label="${escapeHtml(t("bestPrice"))}">
      <div class="product-buy-copy">
        <span class="product-buy-label">${escapeHtml(t("bestPrice"))}</span>
        <strong class="product-buy-price">${escapeHtml(displayOfferPrice(best))}</strong>
        <span class="product-buy-store">${escapeHtml(best.merchantName)}</span>
      </div>
      <a class="offer-link product-buy-cta" href="${escapeHtml(offerRedirectPath(activeRegion.id, best.id))}" target="_blank" rel="nofollow sponsored noopener" data-outbound-offer="${escapeHtml(best.id)}">${escapeHtml(t("viewStoreOffer"))}</a>
    </section>` : "";

  const variantControl = family.variants.length > 1 ? `
    <div class="product-variant-control">
      <label for="product-variant-select">${escapeHtml(t("exactOption"))}</label>
      <select id="product-variant-select" data-select-variant-select>
        ${family.variants.map((item) => `
          <option value="${escapeHtml(item.id)}" ${item.id === variant.id ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
      </select>
    </div>` : "";

  const offersMarkup = offers.length > 1 ? `
    <section class="detail-section product-offers-section" aria-labelledby="offers-title">
      <div class="detail-section-head">
        <h3 id="offers-title">${escapeHtml(t("compareOffers"))}</h3>
        <span>${escapeHtml(t("offerCount", { count: offers.length }))}</span>
      </div>
      <div class="offer-cards">${offers.map(offerCardMarkup).join("")}</div>
    </section>` : "";

  content.innerHTML = `
    <button class="modal-close product-close" type="button" data-close-product aria-label="${escapeHtml(t("close"))}">×</button>
    <article class="product-detail product-detail-simplified">
      <div class="detail-media">
        <div class="detail-main-image">
          <button type="button" data-open-image="${escapeHtml(state.selectedImage)}" aria-label="${escapeHtml(t("enlargeImage"))}">
            <img src="${escapeHtml(publicAssetUrl(state.selectedImage))}" alt="${escapeHtml(family.title)}">
          </button>
        </div>
        ${images.length > 1 ? `
          <div class="gallery-thumbs" aria-label="${escapeHtml(t("productGallery"))}">
            ${images.map((image, index) => `
              <button class="${image === state.selectedImage ? "is-active" : ""}" type="button" data-select-image="${escapeHtml(image)}" aria-label="${escapeHtml(t("showImage", { count: index + 1 }))}">
                <img src="${escapeHtml(publicAssetUrl(image))}" alt="" loading="lazy">
              </button>`).join("")}
          </div>` : ""}
      </div>
      <div class="detail-content">
        <div class="detail-topbar">
          <span class="breadcrumbs">${escapeHtml(t("home"))} / ${escapeHtml(localizeCategory(family.primaryGroup, activeRegion.locale))} / ${escapeHtml(family.brand)}</span>
          <button class="product-favorite-button" type="button" data-toggle-favorite="${escapeHtml(family.id)}">${favorite ? `♥ ${escapeHtml(t("saved"))}` : `♡ ${escapeHtml(t("favorite"))}`}</button>
        </div>
        <h2 id="product-title">${escapeHtml(family.title)}</h2>
        ${variant.title !== family.title ? `<p class="detail-variant-title">${escapeHtml(variant.title)}</p>` : ""}
        ${purchaseSummary}
        ${variantControl}
        <p class="product-description-preview">${escapeHtml(family.description)}</p>
        ${offersMarkup}

        <div class="product-accordions">
          <details class="product-accordion">
            <summary>${escapeHtml(t("fullDescription"))}</summary>
            <div class="product-accordion-body">
              <p>${escapeHtml(family.description)}</p>
            </div>
          </details>

          ${attributes.length ? `
            <details class="product-accordion">
              <summary>${escapeHtml(t("optionFeatures"))}</summary>
              <div class="product-accordion-body">
                <dl class="attribute-grid">
                  ${attributes.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
                </dl>
              </div>
            </details>` : ""}

          <details class="product-accordion">
            <summary>${escapeHtml(t("moreInformation"))}</summary>
            <div class="product-accordion-body product-secondary-information">
              <p class="detail-disclosure">${escapeHtml(t("storePriceDisclosure"))}</p>
              <button type="button" data-toggle-compare="${escapeHtml(family.id)}">${compared ? `✓ ${escapeHtml(t("comparing"))}` : `⇄ ${escapeHtml(t("compare"))}`}</button>
            </div>
          </details>

          ${related.length ? `
            <details class="product-accordion">
              <summary>${escapeHtml(t("similarAlternatives"))}</summary>
              <div class="product-accordion-body">
                <div class="detail-related">
                  ${related.map((item) => `
                    <a href="${escapeHtml(familyHref(item))}" data-open-family="${escapeHtml(item.id)}">
                      <img src="${escapeHtml(publicAssetUrl(item.image))}" alt="">
                      <span>${escapeHtml(item.title)}</span>
                    </a>`).join("")}
                </div>
              </div>
            </details>` : ""}
        </div>
      </div>
    </article>
    <div class="image-viewer" data-image-viewer hidden>
      <button type="button" data-close-image aria-label="${escapeHtml(t("closeExpandedImage"))}">×</button>
      <img src="${escapeHtml(publicAssetUrl(state.selectedImage))}" alt="${escapeHtml(t("enlarged", { title: family.title }))}">
    </div>`;
}

function openProduct(familyId, options = {}) {
  const family = familyById.get(familyId);
  if (!family) return;
  state.selectedImage = null;
  rememberViewed(familyId);
  renderProductDialog(familyId, options.variantId);
  openDialog($("#product-dialog"));
  if (options.route !== false) {
    const route = familyHref(family);
    if (location.pathname !== route) {
      history.pushState({ product: familyId }, "", route);
    }
  }
  dispatchAnalytics("product_view", {
    family_id: familyId,
    category: family.primaryGroup
  });
}

function closeProduct({ clearRoute = true } = {}) {
  closeDialog($("#product-dialog"));
  state.selectedFamilyId = null;
  state.selectedVariantId = null;
  state.selectedImage = null;
  if (clearRoute && familyByProductPath.has(normalizeRoute(location.pathname))) {
    updateUrl();
  }
}

function normalizeRoute(pathname) {
  const value = String(pathname || "/").replace(/\/+/g, "/");
  return value === "/" ? "/" : `${value.replace(/\/+$/, "")}/`;
}

function handleRouteChange() {
  const pathname = normalizeRoute(location.pathname);
  const familyId = familyByProductPath.get(pathname);
  if (!familyId) {
    if ($("#product-dialog")?.open) closeProduct({ clearRoute: false });
  } else if (familyById.has(familyId)) {
    if (!$("#product-dialog")?.open || state.selectedFamilyId !== familyId) {
      openProduct(familyId, { route: false });
    }
    return;
  } else {
    showToast(t("productUnavailable"));
    return;
  }

  let pageKind = null;
  let category = "all";
  let store = "all";
  if (pathname === normalizeRoute(categoryDirectoryPath(activeRegion))) {
    pageKind = "categories";
  } else if (categoryByPath.has(pathname)) {
    pageKind = "category";
    category = categoryByPath.get(pathname);
  } else if (pathname === normalizeRoute(storeDirectoryPath(activeRegion))) {
    pageKind = "stores";
  } else if (storeByPath.has(pathname)) {
    pageKind = "store";
    store = storeByPath.get(pathname);
  } else if (pathname === normalizeRoute(activeRegion.basePath)) {
    pageKind = "home";
  }
  if (!pageKind) return;

  const params = new URLSearchParams(location.search);
  const minimum = Number(params.get("precio_min"));
  const maximum = Number(params.get("precio_max"));
  const validStores = new Set(storeByPath.values());
  const queryStore = params.get("tienda");
  state.query = String(params.get("q") || "").slice(0, 120);
  state.category = category;
  state.store = category !== "all" && validStores.has(queryStore)
    ? queryStore
    : store;
  state.sort = ["relevance", "score-desc", "price-asc", "discount-desc", "variants-desc"]
    .includes(params.get("orden"))
    ? params.get("orden")
    : "relevance";
  state.minimumPrice = params.has("precio_min") && Number.isFinite(minimum)
    ? Math.max(0, minimum)
    : null;
  state.maximumPrice = params.has("precio_max") && Number.isFinite(maximum)
    ? Math.max(0, maximum)
    : null;
  state.discountOnly = params.get("descuento") === "1";
  state.multipleVariants = params.get("variantes") === "1";
  state.visible = PAGE_SIZE;
  document.body.dataset.pageKind = pageKind;
  if (category !== "all") document.body.dataset.initialCategory = category;
  else delete document.body.dataset.initialCategory;
  if (store !== "all") document.body.dataset.initialStore = store;
  else delete document.body.dataset.initialStore;
  syncSearchInputs();
  renderCatalog({ updateHistory: false });
}

function renderComparison() {
  const selected = state.compare.map((id) => familyById.get(id)).filter(Boolean);
  const content = $("[data-compare-content]");
  if (selected.length === 0) {
    content.innerHTML = `<div class="saved-empty"><div><h3>${escapeHtml(t("comparatorEmpty"))}</h3><p>${escapeHtml(t("comparatorHelp"))}</p></div></div>`;
    return;
  }
  const cells = (valueForFamily) =>
    selected.map((family) => `<td>${valueForFamily(family)}</td>`).join("");
  content.innerHTML = `
    <div class="comparison-scroll">
      <table class="comparison-table">
        <thead>
          <tr>
            <th>${escapeHtml(t("productType"))}</th>
            ${selected.map((family) => `
              <td>
                <div class="compare-product-head">
                  <img src="${escapeHtml(publicAssetUrl(family.image))}" alt="">
                  <strong>${escapeHtml(family.title)}</strong>
                  <button type="button" data-toggle-compare="${escapeHtml(family.id)}">${escapeHtml(t("remove"))}</button>
                </div>
              </td>`).join("")}
          </tr>
        </thead>
        <tbody>
          <tr><th>${escapeHtml(t("category"))}</th>${cells((family) => escapeHtml(localizeCategory(family.primaryGroup, activeRegion.locale)))}</tr>
          <tr><th>SecretScore</th>${cells((family) => `<span class="score">${family.secretScore.toFixed(1)}</span>`)}</tr>
          <tr><th>${escapeHtml(t("price"))}</th>${cells((family) => escapeHtml(displayOfferPrice(bestOffer(family, activeRegion.countryCode))))}</tr>
          <tr><th>${escapeHtml(t("optionsLabel"))}</th>${cells((family) => formatter.format(family.variantCount))}</tr>
          <tr><th>${escapeHtml(t("storesLabel"))}</th>${cells((family) => escapeHtml(family.stores.join(", ")))}</tr>
          <tr><th>${escapeHtml(t("viewDetail"))}</th>${cells((family) => `<a class="button secondary" href="${escapeHtml(familyHref(family))}" data-open-family="${escapeHtml(family.id)}">${escapeHtml(t("open"))}</a>`)}</tr>
        </tbody>
      </table>
    </div>
    <div class="comparison-cards">
      ${selected.map((family) => `
        <article class="comparison-card">
          <div class="comparison-card-head">
            <img src="${escapeHtml(publicAssetUrl(family.image))}" alt="">
            <div>
              <strong>${escapeHtml(family.title)}</strong>
              <span class="score">SecretScore ${family.secretScore.toFixed(1)}</span>
            </div>
          </div>
          <dl>
            <div><dt>${escapeHtml(t("category"))}</dt><dd>${escapeHtml(localizeCategory(family.primaryGroup, activeRegion.locale))}</dd></div>
            <div><dt>${escapeHtml(t("price"))}</dt><dd>${escapeHtml(displayOfferPrice(bestOffer(family, activeRegion.countryCode)))}</dd></div>
            <div><dt>${escapeHtml(t("optionsLabel"))}</dt><dd>${formatter.format(family.variantCount)}</dd></div>
            <div><dt>${escapeHtml(t("storesLabel"))}</dt><dd>${escapeHtml(family.stores.join(", "))}</dd></div>
          </dl>
          <div class="comparison-card-actions">
            <a class="button secondary" href="${escapeHtml(familyHref(family))}" data-open-family="${escapeHtml(family.id)}">${escapeHtml(t("openCard"))}</a>
            <button class="comparison-remove" type="button" data-toggle-compare="${escapeHtml(family.id)}">${escapeHtml(t("remove"))}</button>
          </div>
        </article>`).join("")}
    </div>`;
}

function openComparison() {
  renderComparison();
  openDialog($("#compare-dialog"));
  dispatchAnalytics("compare_open", { product_count: state.compare.length });
}

function renderSavedContent() {
  const content = $("[data-saved-content]");
  const tabs = $$("[data-saved-tab]");
  tabs.forEach((tab) => {
    const selected = tab.dataset.savedTab === state.savedTab;
    tab.setAttribute("aria-selected", String(selected));
  });

  if (state.savedTab === "searches") {
    content.innerHTML = state.searches.length
      ? `<div class="search-history-list">${state.searches.map((query) => `<button type="button" data-use-search="${escapeHtml(query)}">${escapeHtml(query)}</button>`).join("")}</div>`
      : `<div class="saved-empty"><div><h3>${escapeHtml(t("searchesEmptyTitle"))}</h3><p>${escapeHtml(t("searchesEmptyText"))}</p></div></div>`;
    return;
  }

  const ids = state.savedTab === "favorites"
    ? [...state.favorites]
    : state.recent;
  const selectedFamilies = ids.map((id) => familyById.get(id)).filter(Boolean);
  content.innerHTML = selectedFamilies.length
    ? `<div class="saved-list">${selectedFamilies.map((family) => `
        <article class="saved-item">
          <img src="${escapeHtml(publicAssetUrl(family.image))}" alt="">
          <div>
            <strong>${escapeHtml(family.title)}</strong>
            <small>${escapeHtml(localizeCategory(family.primaryGroup, activeRegion.locale))} · ${escapeHtml(displayOfferPrice(bestOffer(family)))}</small>
          </div>
          <div class="saved-item-actions">
            <button type="button" data-open-family="${escapeHtml(family.id)}" aria-label="${escapeHtml(t("openProduct", { title: family.title }))}">→</button>
            ${state.savedTab === "favorites" ? `<button class="saved-remove" type="button" data-remove-favorite="${escapeHtml(family.id)}" aria-label="${escapeHtml(t("removeSavedProduct", { title: family.title }))}">×</button>` : ""}
          </div>
        </article>`).join("")}</div>`
    : `<div class="saved-empty"><div><h3>${escapeHtml(state.savedTab === "favorites" ? t("favoritesEmpty") : t("recentEmpty"))}</h3><p>${escapeHtml(t("savedEmptyText"))}</p></div></div>`;
}

function openSaved() {
  renderSavedContent();
  openDialog($("#saved-dialog"));
}

function renderSuggestions(input) {
  const container = $("[data-search-suggestions]");
  if (!container || input.id !== "header-search") return;
  state.suggestions = getSuggestions(families, input.value, 7);
  state.suggestionIndex = -1;
  input.setAttribute("aria-expanded", String(state.suggestions.length > 0));
  container.hidden = state.suggestions.length === 0;
  container.innerHTML = state.suggestions.map((suggestion, index) => `
    <button
      class="suggestion"
      type="button"
      role="option"
      aria-selected="false"
      data-suggestion-index="${index}"
    >
      ${suggestion.image
        ? `<img src="${escapeHtml(publicAssetUrl(suggestion.image))}" alt="">`
        : `<span class="category-icon" aria-hidden="true">⌕</span>`}
      <span>
        <strong>${escapeHtml(suggestion.label)}</strong>
        <small>${escapeHtml(suggestion.meta)}</small>
      </span>
      <span class="suggestion-type">${escapeHtml(suggestion.type === "product" ? t("productType") : t("categoryType"))}</span>
    </button>`).join("");
}

function closeSuggestions() {
  const container = $("[data-search-suggestions]");
  if (container) {
    container.hidden = true;
    container.innerHTML = "";
  }
  const input = $("#header-search");
  if (input) input.setAttribute("aria-expanded", "false");
  state.suggestions = [];
  state.suggestionIndex = -1;
}

function chooseSuggestion(index) {
  const suggestion = state.suggestions[index];
  if (!suggestion) return;
  closeSuggestions();
  if (suggestion.type === "product") {
    openProduct(suggestion.value);
  } else {
    setCategory(suggestion.value);
  }
}

function moveSuggestion(direction) {
  if (state.suggestions.length === 0) return;
  state.suggestionIndex =
    (state.suggestionIndex + direction + state.suggestions.length) %
    state.suggestions.length;
  $$("[data-suggestion-index]").forEach((button, index) => {
    button.setAttribute("aria-selected", String(index === state.suggestionIndex));
  });
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(storageKeys.theme, next);
  } catch {}
  renderThemeControls();
}

function renderThemeControls() {
  const dark = document.documentElement.dataset.theme === "dark";
  $$("[data-theme-toggle]").forEach((button) => {
    button.setAttribute("aria-label", dark ? t("activateLight") : t("activateDark"));
  });
  $$("[data-theme-label]").forEach((label) => {
    label.textContent = dark ? t("light") : t("dark");
  });
  $$("[data-theme-icon]").forEach((icon) => {
    icon.textContent = dark ? "☀" : "◐";
  });
  const themeMeta = $('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = dark ? "#09181c" : "#f7f2e8";
}

function applyAdvancedFilters(event) {
  event.preventDefault();
  const minimum = Number($("[data-price-min]").value);
  const maximum = Number($("[data-price-max]").value);
  const hasMinimum = $("[data-price-min]").value !== "" && Number.isFinite(minimum);
  const hasMaximum = $("[data-price-max]").value !== "" && Number.isFinite(maximum);
  if (hasMinimum && hasMaximum && minimum > maximum) {
    showToast(t("invalidPriceRange"));
    return;
  }
  state.minimumPrice = hasMinimum ? Math.max(0, minimum) : null;
  state.maximumPrice = hasMaximum ? Math.max(0, maximum) : null;
  state.category = $("[data-modal-filter-category]")?.value || state.category;
  state.store = $("[data-modal-filter-store]")?.value || state.store;
  state.sort = $("[data-modal-sort]")?.value || state.sort;
  state.discountOnly = $("[data-discount-only]").checked;
  state.multipleVariants = $("[data-multiple-variants]").checked;
  state.visible = PAGE_SIZE;
  document.body.dataset.pageKind = state.category !== "all"
    ? "category"
    : state.store !== "all"
      ? "store"
      : "home";
  closeDialog($("#filters-dialog"));
  renderCatalog();
}

function resetAdvancedFilters() {
  state.minimumPrice = null;
  state.maximumPrice = null;
  state.discountOnly = false;
  state.multipleVariants = false;
  syncFilterControls();
}

function closePinnedMenus(except = null) {
  $$("[data-nav-menu].is-pinned").forEach((menu) => {
    if (menu === except) return;
    menu.classList.remove("is-pinned");
    $("[data-pin-menu]", menu)?.setAttribute("aria-expanded", "false");
  });
}

function togglePinnedMenu(trigger) {
  const menu = trigger.closest("[data-nav-menu]");
  if (!menu) return;
  const next = !menu.classList.contains("is-pinned");
  closePinnedMenus(menu);
  menu.classList.toggle("is-pinned", next);
  trigger.setAttribute("aria-expanded", String(next));
}

function focusCatalogSearch() {
  const visibleSearchInput = () =>
    [$("#hero-search"), $("#header-search")]
      .find((candidate) => candidate && candidate.getClientRects().length > 0);

  let input = visibleSearchInput();
  if (!input) {
    state.category = "all";
    state.store = "all";
    state.visible = PAGE_SIZE;
    document.body.dataset.pageKind = "home";
    delete document.body.dataset.initialCategory;
    delete document.body.dataset.initialStore;
    syncSearchInputs();
    renderCatalog();
    input = visibleSearchInput();
  }
  if (!input) return;

  try {
    input.focus({ preventScroll: true });
  } catch {
    input.focus();
  }
  input.scrollIntoView({ behavior: "smooth", block: "center" });
}

function wireEvents() {
  document.addEventListener("submit", (event) => {
    if (event.target.matches("[data-search-form]")) {
      event.preventDefault();
      const input = $("[data-search-input]", event.target);
      closeSuggestions();
      setQuery(input.value, { source: input, save: true, scroll: true });
    }
    if (event.target.matches("[data-advanced-filters]")) {
      applyAdvancedFilters(event);
    }
  });

  document.addEventListener("input", (event) => {
    const input = event.target.closest("[data-search-input]");
    if (!input) return;
    window.clearTimeout(inputTimer);
    state.query = input.value.slice(0, 120);
    syncSearchInputs(input);
    renderSuggestions(input);
    inputTimer = window.setTimeout(() => {
      state.visible = PAGE_SIZE;
      renderCatalog();
    }, 180);
  });

  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-select-variant-select]")) {
      state.selectedImage = null;
      renderProductDialog(state.selectedFamilyId, event.target.value);
      return;
    }
    if (event.target.matches("[data-filter-category]")) {
      if (event.target.value === "all") {
        state.category = "all";
        state.visible = PAGE_SIZE;
        document.body.dataset.pageKind = state.store === "all" ? "home" : "store";
        delete document.body.dataset.initialCategory;
        renderCatalog();
      } else {
        setCategory(event.target.value, false);
      }
    }
    if (event.target.matches("[data-filter-store]")) {
      if (event.target.value === "all") {
        state.store = "all";
        state.visible = PAGE_SIZE;
        document.body.dataset.pageKind = state.category === "all" ? "home" : "category";
        delete document.body.dataset.initialStore;
        renderCatalog();
      } else {
        setStore(event.target.value, false);
      }
    }
    if (event.target.matches("[data-sort]")) {
      state.sort = event.target.value;
      renderCatalog();
    }
    if (event.target.closest("[data-nav-menu]")) {
      closePinnedMenus();
      event.target.blur?.();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.target.id === "header-search") {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSuggestion(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSuggestion(-1);
      } else if (event.key === "Enter" && state.suggestionIndex >= 0) {
        event.preventDefault();
        chooseSuggestion(state.suggestionIndex);
      } else if (event.key === "Escape") {
        closeSuggestions();
      }
    }
    if (event.key === "Escape") closePinnedMenus();
  });

  document.addEventListener("click", (event) => {
    const pinMenu = event.target.closest("[data-pin-menu]");
    if (pinMenu) {
      event.preventDefault();
      togglePinnedMenu(pinMenu);
      return;
    }

    const suggestion = event.target.closest("[data-suggestion-index]");
    if (suggestion) {
      chooseSuggestion(Number(suggestion.dataset.suggestionIndex));
      return;
    }

    const favorite = event.target.closest("[data-toggle-favorite]");
    if (favorite) {
      event.preventDefault();
      event.stopPropagation();
      toggleFavorite(favorite.dataset.toggleFavorite);
      return;
    }

    const compare = event.target.closest("[data-toggle-compare]");
    if (compare) {
      event.preventDefault();
      event.stopPropagation();
      toggleCompare(compare.dataset.toggleCompare);
      return;
    }

    const open = event.target.closest("[data-open-family]");
    if (open) {
      event.preventDefault();
      openProduct(open.dataset.openFamily);
      return;
    }

    const category = event.target.closest("[data-set-category]");
    if (category) {
      event.preventDefault();
      closePinnedMenus();
      category.blur();
      setCategory(category.dataset.setCategory);
      return;
    }

    const collection = event.target.closest("[data-set-collection]");
    if (collection) {
      setCollection(collection.dataset.setCollection);
      return;
    }

    const store = event.target.closest("[data-set-store]");
    if (store) {
      event.preventDefault();
      closePinnedMenus();
      store.blur();
      setStore(store.dataset.setStore);
      return;
    }

    const removeFavorite = event.target.closest("[data-remove-favorite]");
    if (removeFavorite) {
      toggleFavorite(removeFavorite.dataset.removeFavorite);
      return;
    }

    const footerCategory = event.target.closest("[data-footer-category]");
    if (footerCategory) {
      event.preventDefault();
      setCategory(footerCategory.dataset.footerCategory);
      return;
    }

    const removeFilterButton = event.target.closest("[data-remove-filter]");
    if (removeFilterButton) {
      removeFilter(removeFilterButton.dataset.removeFilter);
      return;
    }

    if (event.target.closest("[data-clear-filters]")) {
      clearFilters();
      return;
    }

    const previousCarousel = event.target.closest("[data-carousel-prev]");
    const nextCarousel = event.target.closest("[data-carousel-next]");
    if (previousCarousel || nextCarousel) {
      const key = (previousCarousel || nextCarousel).dataset.carouselPrev ||
        (previousCarousel || nextCarousel).dataset.carouselNext;
      const carousel = $(`[data-carousel-key="${CSS.escape(key)}"]`);
      if (!carousel) return;
      carousel.scrollBy({
        left: (nextCarousel ? 1 : -1) * Math.max(260, carousel.clientWidth * 0.75),
        behavior: "smooth"
      });
      return;
    }

    if (event.target.closest("[data-open-saved]")) {
      openSaved();
      return;
    }
    if (event.target.closest("[data-open-compare]")) {
      openComparison();
      return;
    }
    if (event.target.closest("[data-clear-compare]")) {
      state.compare = [];
      persistPersonalState();
      refreshCardsAndCatalog();
      return;
    }
    if (event.target.closest("[data-open-filters]")) {
      syncFilterControls();
      openDialog($("#filters-dialog"));
      return;
    }
    if (event.target.closest("[data-reset-advanced]")) {
      resetAdvancedFilters();
      return;
    }
    if (event.target.closest("[data-score-help]")) {
      openDialog($("#score-dialog"));
      return;
    }
    if (event.target.closest("[data-theme-toggle]")) {
      toggleTheme();
      return;
    }
    if (event.target.closest("[data-focus-search]")) {
      focusCatalogSearch();
      return;
    }
    if (event.target.closest("[data-menu-toggle]")) {
      openDialog($("#menu-dialog"));
      return;
    }

    const savedTab = event.target.closest("[data-saved-tab]");
    if (savedTab) {
      state.savedTab = savedTab.dataset.savedTab;
      renderSavedContent();
      return;
    }

    const useSearch = event.target.closest("[data-use-search]");
    if (useSearch) {
      closeDialog($("#saved-dialog"));
      setQuery(useSearch.dataset.useSearch, { save: true, scroll: true });
      return;
    }

    const variant = event.target.closest("[data-select-variant]");
    if (variant) {
      state.selectedImage = null;
      renderProductDialog(state.selectedFamilyId, variant.dataset.selectVariant);
      return;
    }
    if (event.target.closest("[data-show-all-variants]")) {
      $$(".extra-variant", $("[data-product-content]")).forEach((chip) => {
        chip.hidden = false;
      });
      event.target.closest("[data-show-all-variants]").remove();
      return;
    }

    const image = event.target.closest("[data-select-image]");
    if (image) {
      state.selectedImage = image.dataset.selectImage;
      const main = $(".detail-main-image img");
      if (main) main.src = publicAssetUrl(state.selectedImage);
      $$("[data-select-image]").forEach((button) => {
        button.classList.toggle("is-active", button === image);
      });
      const openImage = $("[data-open-image]");
      if (openImage) openImage.dataset.openImage = state.selectedImage;
      return;
    }

    if (event.target.closest("[data-open-image]")) {
      const viewer = $("[data-image-viewer]");
      viewer.hidden = false;
      $(".image-viewer img").src = publicAssetUrl(
        event.target.closest("[data-open-image]").dataset.openImage
      );
      return;
    }
    if (event.target.closest("[data-close-image]")) {
      $("[data-image-viewer]").hidden = true;
      return;
    }

    const outbound = event.target.closest("[data-outbound-offer]");
    if (outbound) {
      dispatchAnalytics("outbound_click", {
        offer_id: outbound.dataset.outboundOffer,
        family_id: state.selectedFamilyId
      });
      return;
    }

    if (event.target.closest("[data-close-product]")) {
      closeProduct();
      return;
    }

    const close = event.target.closest("[data-close-dialog]");
    if (close) {
      closeDialog(close.closest("dialog"));
      return;
    }

    if (
      !event.target.closest(".header-search") &&
      !event.target.closest("[data-search-suggestions]")
    ) {
      closeSuggestions();
    }
    const navigationLink = event.target.closest("[data-nav-menu] a");
    if (navigationLink || !event.target.closest("[data-nav-menu]")) closePinnedMenus();

    const menuLink = event.target.closest("#menu-dialog a");
    if (menuLink) closeDialog($("#menu-dialog"));
  });

  document.addEventListener("close", syncBodyModalState, true);
  document.addEventListener("cancel", (event) => {
    if (event.target.id === "product-dialog") closeProduct();
    else syncBodyModalState();
  }, true);

  document.addEventListener("error", (event) => {
    if (event.target instanceof HTMLImageElement) {
      const fallback = event.target.dataset.imageFallback || (
        event.target.closest(
          ".product-card, .mosaic-card, .detail-main-image, .gallery-thumbs, .detail-related"
        )
          ? "/assets/brand/product-placeholder.svg"
          : ""
      );
      if (fallback && event.target.src !== new URL(fallback, location.origin).href) {
        event.target.dataset.imageFallback = "";
        event.target.src = fallback;
        return;
      }
      event.target.hidden = true;
      event.target.parentElement?.classList.add("image-error");
    }
  }, true);

  window.addEventListener("popstate", handleRouteChange);
}

function motionAllowed() {
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function wireInfiniteCatalog() {
  catalogObserver?.disconnect();
  const sentinel = $("[data-catalog-sentinel]");
  if (!sentinel || !("IntersectionObserver" in window)) return;
  catalogObserver = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    if (state.visible >= catalogResultCount) return;
    state.visible = Math.min(catalogResultCount, state.visible + PAGE_SIZE);
    renderCatalog({ updateHistory: false });
  }, { rootMargin: "500px 0px" });
  catalogObserver.observe(sentinel);
}

function stopHeroRotation() {
  window.clearInterval(heroRotationTimer);
  heroRotationTimer = null;
}

function startHeroRotation() {
  stopHeroRotation();
  if (!motionAllowed() || families.length <= 3) return;
  heroRotationTimer = window.setInterval(() => {
    heroRotationOffset = (heroRotationOffset + 3) % Math.max(3, Math.min(18, families.length));
    renderHero({ animate: true });
  }, HERO_ROTATION_MS);
}

function stopDealsRotation() {
  window.clearInterval(dealsRotationTimer);
  dealsRotationTimer = null;
}

function startDealsRotation() {
  stopDealsRotation();
  const carousel = $("[data-deals-carousel]");
  if (!carousel || !motionAllowed()) return;
  dealsRotationTimer = window.setInterval(() => {
    const nearEnd = carousel.scrollLeft + carousel.clientWidth >= carousel.scrollWidth - 20;
    carousel.scrollTo({
      left: nearEnd ? 0 : carousel.scrollLeft + Math.max(260, carousel.clientWidth * 0.75),
      behavior: "smooth"
    });
  }, DEALS_ROTATION_MS);
}

function wireControlledRotations() {
  const hero = $("[data-hero-mosaic]");
  const deals = $("[data-deals-carousel]");
  if (hero) {
    hero.addEventListener("pointerenter", stopHeroRotation);
    hero.addEventListener("pointerleave", startHeroRotation);
    hero.addEventListener("focusin", stopHeroRotation);
    hero.addEventListener("focusout", (event) => {
      if (!hero.contains(event.relatedTarget)) startHeroRotation();
    });
  }
  if (deals) {
    deals.addEventListener("pointerenter", stopDealsRotation);
    deals.addEventListener("pointerleave", startDealsRotation);
    deals.addEventListener("focusin", stopDealsRotation);
    deals.addEventListener("focusout", (event) => {
      if (!deals.contains(event.relatedTarget)) startDealsRotation();
    });
  }
  startHeroRotation();
  startDealsRotation();
}

function renderInitial(stats) {
  renderMetrics(stats);
  renderCatalogStatus(stats);
  renderHero();
  renderCategories();
  renderHighlights();
  renderStores();
  renderFilterOptions();
  renderPersonalizedViews();
  syncSearchInputs();
  renderThemeControls();
  renderCatalog({ updateHistory: false });
  handleRouteChange();
  wireInfiniteCatalog();
  wireControlledRotations();
}

async function fetchJson(url, label) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`${label}: respuesta ${response.status}`);
  return response.json();
}

function upgradeRegionalNavigation() {
  const primary = $(".primary-nav");
  const legacyOffers = primary?.querySelector(":scope > [data-region-offers]");
  if (legacyOffers && !primary.querySelector("[data-region-promotions]")) {
    const wrapper = document.createElement("div");
    wrapper.className = "nav-menu";
    wrapper.dataset.navMenu = "";
    wrapper.innerHTML = `
      <button class="nav-menu-trigger" type="button" data-pin-menu aria-expanded="false">
        Promos <span aria-hidden="true">⌄</span>
      </button>
      <div class="nav-dropdown nav-guides-dropdown nav-promotions-dropdown">
        <a href="/promociones/" data-region-promotions>
          <strong>Promociones y códigos</strong>
          <small>Solo ventajas vigentes y verificadas</small>
        </a>
        <a href="${escapeHtml(activeRegion.basePath)}#ofertas" data-region-offers>
          <strong>Descuentos en productos</strong>
          <small>Precio anterior y ahorro comprobable</small>
        </a>
        <a class="nav-view-all" href="/afiliacion.html">
          Cómo funcionan <span aria-hidden="true">→</span>
        </a>
      </div>`;
    legacyOffers.replaceWith(wrapper);
  }

  const legacyRegion = $(".header-actions > a.region-selector[data-region-selector]");
  if (legacyRegion) {
    const wrapper = document.createElement("div");
    wrapper.className = "header-action-menu nav-menu region-menu";
    wrapper.dataset.navMenu = "";
    wrapper.innerHTML = `
      <button class="region-selector" type="button" data-pin-menu aria-label="Cambiar país" aria-expanded="false">
        <span data-region-flag aria-hidden="true">${escapeHtml(activeRegion.flag)}</span>
        <span class="action-label" data-region-name>${escapeHtml(localizedRegionName(activeRegion))}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      <div class="nav-dropdown region-dropdown">
        <strong>País y moneda</strong>
        <div class="region-nav-list" data-nav-regions></div>
        <a class="nav-view-all" href="/paises/" data-region-selector>
          Ver todos los países <span aria-hidden="true">→</span>
        </a>
      </div>`;
    legacyRegion.replaceWith(wrapper);
  }

  const mobileOffers = $(".mobile-bottom-nav [data-region-offers]");
  if (mobileOffers && !$(".mobile-bottom-nav [data-region-promotions]")) {
    mobileOffers.removeAttribute("data-region-offers");
    mobileOffers.dataset.regionPromotions = "";
    mobileOffers.href = `/promociones/?region=${encodeURIComponent(activeRegion.id)}`;
    mobileOffers.innerHTML = '<span aria-hidden="true">%</span><small>Promos</small>';
  }

  const mobileMenu = $("#menu-dialog nav");
  if (mobileMenu && !mobileMenu.querySelector("[data-region-promotions]")) {
    const promotions = document.createElement("a");
    promotions.href = `/promociones/?region=${encodeURIComponent(activeRegion.id)}`;
    promotions.dataset.regionPromotions = "";
    promotions.textContent = "Promociones y códigos";
    const guides = mobileMenu.querySelector("[data-region-guides]");
    mobileMenu.insertBefore(promotions, guides || mobileMenu.firstChild);
  }
}

async function initializeRegion() {
  const [regionsPayload, taxonomyPayload, brandingPayload] = await Promise.all([
    fetchJson(REGIONS_URL, "Configuración regional"),
    fetchJson(TAXONOMY_URL, "Taxonomía de categorías"),
    fetchJson(STORE_BRANDING_URL, "Identidad visual de tiendas")
  ]);
  regionsConfig = validateRegionConfig(regionsPayload);
  activeRegion = resolveActiveRegion(
    regionsConfig,
    document.documentElement.dataset.region,
    location.pathname
  );
  t = createTranslator(activeRegion.locale);
  upgradeRegionalNavigation();
  applyStaticLocale(activeRegion.locale);
  categoryTaxonomy = Array.isArray(taxonomyPayload?.categories)
    ? taxonomyPayload.categories
    : [];
  storeBranding = new Map(
    (brandingPayload?.stores || []).map((store) => [store.id, store])
  );
  const manifest = await fetchJson(activeRegion.catalogManifest, `Catálogo ${activeRegion.id}`);
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.region !== activeRegion.id ||
    manifest.country !== activeRegion.countryCode ||
    manifest.currency !== activeRegion.currency ||
    !Array.isArray(manifest.sources)
  ) {
    throw new Error(`${activeRegion.id}: manifest regional incoherente`);
  }
  catalogSources = manifest.sources.map((source) => ({
    ...source,
    country: source.country || activeRegion.countryCode,
    currency: source.currency || activeRegion.currency
  }));
  storageKeys = regionStorageKeys(activeRegion.id);
  formatter = new Intl.NumberFormat(activeRegion.locale);
  state = initialState();
  document.documentElement.lang = activeRegion.locale;
  $$("[data-region-name]").forEach((node) => {
    node.textContent = localizedRegionName(activeRegion);
  });
  $$("[data-region-flag]").forEach((node) => {
    node.textContent = activeRegion.flag;
  });
  $$("[data-region-selector]").forEach((link) => {
    link.href = regionsConfig.selectorPath;
  });
  $$("[data-region-home]").forEach((link) => {
    link.href = activeRegion.basePath;
  });
  if (!document.body.dataset.pageKind) document.body.dataset.pageKind = "home";
}

async function start() {
  try {
    await initializeRegion();
    wireEvents();
    const stats = await loadCatalog();
    renderInitial(stats);
  } catch (error) {
    const status = $("[data-catalog-status]");
    if (status) {
      status.textContent = t("catalogUnavailable");
      status.classList.add("is-warning");
    }
    const grid = $("[data-catalog-grid]");
    if (grid) {
      grid.setAttribute("aria-busy", "false");
      grid.innerHTML = `
        <div class="empty-state">
          <div>
            <h3>${escapeHtml(t("loadErrorTitle"))}</h3>
            <p>${escapeHtml(t("loadErrorText"))}</p>
          </div>
        </div>`;
    }
    console.error("[SecretShop] Error de catálogo", error);
  }
}

start();
