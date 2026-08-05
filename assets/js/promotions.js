import "./cloudflare-analytics.js";
import "./google-analytics.js";
import {
  discountPercent,
  displayOfferPrice,
  escapeHtml,
  mergeCatalogPayloads
} from "./catalog-core.js";
import { applyStaticLocale } from "./i18n.js";
import {
  productPath,
  promotionRedirectPath,
  publishedRegions,
  regionById,
  validateRegionConfig
} from "./region-core.js";

const REGIONS_URL = "/data/config/regions.json";
const PROMOTIONS_URLS = [
  "/data/promotions/awin.json",
  "/data/promotions/impact.json"
];
const PLACEHOLDER = "/assets/brand/product-placeholder.svg";
const themeKey = "secretshop:theme:v1";

async function fetchJson(path, label) {
  const response = await fetch(path, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`${label}: respuesta ${response.status}`);
  return response.json();
}

function localizedRegionName(region) {
  try {
    return new Intl.DisplayNames([region.locale], { type: "region" }).of(region.countryCode);
  } catch {
    return region.name;
  }
}

function dateLabel(value, locale) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

function promotionTypeLabel(promotion, withCode) {
  const text = `${promotion.type || ""} ${promotion.title || ""} ${promotion.description || ""}`.toLowerCase();
  if (withCode || promotion.type === "voucher") return "Código promocional";
  if (/env[ií]o gratis|free shipping/.test(text)) return "Envío gratuito";
  if (/rebaja|sale|descuento|dto|%/.test(text)) return "Rebaja directa";
  if (/sin c[oó]digo/.test(text)) return "Descuento sin código";
  return "Oferta";
}

function promotionCard(promotion, region, withCode) {
  const end = dateLabel(promotion.endAt, region.locale);
  const action = promotionRedirectPath(region.id, promotion.id);
  const type = promotionTypeLabel(promotion, withCode);
  return `
    <article class="promotion-card${withCode ? " has-code" : ""}">
      <div class="promotion-card-head">
        <span class="promotion-network">${escapeHtml(type)}</span>
        <strong>${escapeHtml(promotion.merchantName)}</strong>
      </div>
      <h3>${escapeHtml(promotion.title)}</h3>
      ${promotion.description ? `<p>${escapeHtml(promotion.description)}</p>` : ""}
      ${withCode ? `
        <div class="promotion-code-row">
          <code>${escapeHtml(promotion.code)}</code>
          <button class="button secondary" type="button" data-copy-code="${escapeHtml(promotion.code)}">
            Copiar
          </button>
        </div>
      ` : ""}
      <div class="promotion-card-footer">
        <small>${end ? `Hasta ${escapeHtml(end)}` : "Vigencia verificada"}</small>
        <a class="button" href="${escapeHtml(action)}" target="_blank" rel="nofollow sponsored noopener">
          Usar
        </a>
      </div>
    </article>
  `;
}

function discountedFamilies(families, countryCode) {
  return families
    .map((family) => {
      const offer = family.offers
        .filter((candidate) => candidate.country === countryCode)
        .map((candidate) => ({ candidate, discount: discountPercent(candidate) }))
        .filter((item) => item.discount > 0)
        .sort((left, right) =>
          right.discount - left.discount ||
          Number(left.candidate.totalPrice ?? left.candidate.price ?? Infinity) -
            Number(right.candidate.totalPrice ?? right.candidate.price ?? Infinity)
        )[0]?.candidate;
      return { family, offer, discount: discountPercent(offer) };
    })
    .filter((item) => item.offer && item.discount > 0)
    .sort((left, right) =>
      right.discount - left.discount ||
      right.family.secretScore - left.family.secretScore
    )
    .slice(0, 36);
}

function discountCard(item, region) {
  const { family, offer, discount } = item;
  const previous = new Intl.NumberFormat(region.locale, {
    style: "currency",
    currency: offer.currency
  }).format(Number(offer.previousPrice));
  return `
    <a class="promotion-product-card" href="${escapeHtml(productPath(family, region))}">
      <div class="promotion-product-media">
        <img
          src="${escapeHtml(family.image || PLACEHOLDER)}"
          alt=""
          loading="lazy"
        >
        <span>-${discount}%</span>
      </div>
      <div>
        <small>${escapeHtml(offer.merchantName)}</small>
        <h3>${escapeHtml(family.title)}</h3>
        <p><del>${escapeHtml(previous)}</del> <strong>${escapeHtml(displayOfferPrice(offer))}</strong></p>
      </div>
      <span class="promotion-product-arrow" aria-hidden="true">→</span>
    </a>
  `;
}

function renderTheme() {
  const dark = document.documentElement.dataset.theme === "dark";
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.textContent = dark ? "☀ Modo claro" : "◐ Modo oscuro";
  });
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#09181c" : "#1f1f1f";
}

function showToast(message) {
  const region = document.querySelector("[data-promotion-toast]");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 2600);
}

async function init() {
  const [configPayload, promotionPayloads] = await Promise.all([
    fetchJson(REGIONS_URL, "Países"),
    Promise.all(
      PROMOTIONS_URLS.map((path) => fetchJson(path, "Promociones"))
    )
  ]);
  const config = validateRegionConfig(configPayload);
  const query = new URLSearchParams(location.search);
  const requested = regionById(config, query.get("region"));
  const region = requested?.status === "published"
    ? requested
    : regionById(config, config.defaultRegion);
  const regions = publishedRegions(config);

  document.documentElement.lang = region.locale;
  document.querySelector("[data-promotion-home]").href = region.basePath;
  document.querySelector("[data-promotion-flag]").textContent = region.flag;
  const selector = document.querySelector("[data-promotion-region]");
  selector.innerHTML = regions.map((item) => `
    <option value="${item.id}"${item.id === region.id ? " selected" : ""}>
      ${escapeHtml(localizedRegionName(item))} · ${item.currency}
    </option>
  `).join("");
  applyStaticLocale(region.locale);

  const now = Date.now();
  const promotions = promotionPayloads
    .flatMap((payload) => payload.promotions || [])
    .filter((promotion) =>
    promotion.regions?.includes(region.id) &&
    (!promotion.startAt || Date.parse(promotion.startAt) <= now) &&
    (!promotion.endAt || Date.parse(promotion.endAt) >= now)
    );
  const codes = promotions.filter((promotion) => promotion.code);
  const withoutCodes = promotions.filter((promotion) => !promotion.code);
  document.querySelector("[data-promotion-code-count]").textContent = String(codes.length);
  document.querySelector("[data-promotion-offer-count]").textContent = String(withoutCodes.length);
  document.querySelector("[data-code-section]").hidden = codes.length === 0;
  document.querySelector("[data-promotion-section]").hidden = withoutCodes.length === 0;
  document.querySelector("[data-promotion-empty]").hidden = promotions.length > 0;
  document.querySelector("[data-code-grid]").innerHTML =
    codes.map((promotion) => promotionCard(promotion, region, true)).join("");
  document.querySelector("[data-promotion-grid]").innerHTML =
    withoutCodes.map((promotion) => promotionCard(promotion, region, false)).join("");

  const manifest = await fetchJson(region.catalogManifest, "Catálogo regional");
  const loaded = await Promise.all((manifest.sources || []).map(async (source) => ({
    ...source,
    payload: await fetchJson(source.path, source.id)
  })));
  const merged = mergeCatalogPayloads(loaded);
  const discounts = discountedFamilies(merged.families, region.countryCode);
  document.querySelector("[data-discount-count]").textContent = String(discounts.length);
  document.querySelector("[data-discount-grid]").innerHTML = discounts.length
    ? discounts.map((item) => discountCard(item, region)).join("")
    : '<p class="promotion-loading">No hay descuentos con precio anterior verificable para este país.</p>';
}

document.addEventListener("change", (event) => {
  if (!event.target.matches("[data-promotion-region]")) return;
  const next = new URL(location.href);
  next.searchParams.set("region", event.target.value);
  location.assign(next.href);
});

document.addEventListener("click", async (event) => {
  const theme = event.target.closest("[data-theme-toggle]");
  if (theme) {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(themeKey, next);
    } catch {}
    renderTheme();
    return;
  }
  const copy = event.target.closest("[data-copy-code]");
  if (!copy) return;
  try {
    await navigator.clipboard.writeText(copy.dataset.copyCode);
    showToast("Código copiado.");
  } catch {
    showToast("No se pudo copiar. Mantén pulsado el código para seleccionarlo.");
  }
});

document.addEventListener("error", (event) => {
  const image = event.target.closest?.(".promotion-product-media img");
  if (!image || image.src.endsWith(PLACEHOLDER)) return;
  image.src = PLACEHOLDER;
}, true);

renderTheme();
init().catch(() => {
  document.querySelector("[data-discount-grid]").innerHTML =
    '<p class="promotion-loading">No hemos podido comprobar las promociones. Inténtalo de nuevo en unos instantes.</p>';
  document.querySelector("[data-promotion-empty]").hidden = false;
});
