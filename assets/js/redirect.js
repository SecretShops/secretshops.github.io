import {
  regionById,
  validateRegionConfig
} from "./region-core.js";

const AMAZON_ASSOCIATE_TAG = "christian0ddd-21";
const SHOKZ_IMPACT_PATH = "/c/7518894/3800995/48345";
const SHOKZ_IMPACT_SOURCE = "CATF_31438";
const REGIONS_URL = "/data/config/regions.json";

function fail(text) {
  const title = document.querySelector("[data-redirect-title]");
  const message = document.querySelector("[data-redirect-message]");
  const back = document.querySelector("[data-redirect-back]");
  const loader = document.querySelector(".redirect-loader");
  title.textContent = "No se pudo abrir esta oferta";
  message.textContent = text;
  back.hidden = false;
  loader.hidden = true;
}

export function allowedDestination(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const awin =
      /(^|\.)awin1\.com$/i.test(url.hostname) &&
      ["/pclick.php", "/cread.php"].includes(url.pathname) &&
      ["a", "p", "m"].every((key) => url.searchParams.get(key));
    const aliexpress = /^s\.click\.aliexpress\.com$/i.test(url.hostname);
    const amazon =
      /^(?:www\.)?amazon\.es$/i.test(url.hostname) &&
      /^\/dp\/[A-Z0-9]{10}\/ref=nosim\/?$/i.test(url.pathname) &&
      url.searchParams.get("tag") === AMAZON_ASSOCIATE_TAG;
    let impact = false;
    if (
      /^shokzes\.pxf\.io$/i.test(url.hostname) &&
      url.pathname === SHOKZ_IMPACT_PATH &&
      Boolean(url.searchParams.get("prodsku")) &&
      url.searchParams.get("intsrc") === SHOKZ_IMPACT_SOURCE
    ) {
      try {
        const landing = new URL(url.searchParams.get("u"));
        impact =
          landing.protocol === "https:" &&
          /(^|\.)es\.shokz\.com$/i.test(landing.hostname);
      } catch {
        impact = false;
      }
    }
    return awin || aliexpress || amazon || impact ? url.href : null;
  } catch {
    return null;
  }
}

export function entryMatchesRegion(entry, region) {
  if (!entry || !region) return false;
  if (region.status !== "published") return false;
  if (String(entry.country || "").toUpperCase() !== region.countryCode) return false;
  const destination = allowedDestination(entry.url);
  if (!destination) return false;
  const url = new URL(destination);
  if (/(^|\.)amazon\.es$/i.test(url.hostname) && region.countryCode !== "ES") return false;
  if (/^shokzes\.pxf\.io$/i.test(url.hostname) && region.countryCode !== "ES") return false;
  return true;
}

async function fetchJson(url, label) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`${label}: respuesta ${response.status}`);
  return response.json();
}

async function redirect() {
  const params = new URLSearchParams(location.search);
  const offerId = params.get("offer")?.trim();
  if (!offerId || offerId.length > 200) {
    fail("La oferta indicada no es válida o ya no está disponible.");
    return;
  }

  try {
    const config = validateRegionConfig(
      await fetchJson(REGIONS_URL, "Configuración regional")
    );
    const requestedRegion = String(params.get("region") || config.defaultRegion).toLowerCase();
    const region = regionById(config, requestedRegion);
    if (!region || region.status !== "published" || !region.affiliateLinks) {
      fail("El país indicado todavía no está disponible.");
      return;
    }
    const back = document.querySelector("[data-redirect-back]");
    if (back) back.href = region.basePath;

    const payload = await fetchJson(region.affiliateLinks, "Enlaces regionales");
    if (payload.region !== region.id || payload.country !== region.countryCode) {
      throw new Error("El archivo de enlaces no pertenece a la región solicitada.");
    }
    const entry = payload?.links?.[offerId];
    const destination = allowedDestination(entry?.url);
    if (!destination || !entryMatchesRegion(entry, region)) {
      fail("La oferta no está publicada para este país o su enlace no supera la verificación.");
      return;
    }

    try {
      sessionStorage.setItem(
        "secretshop:last-outbound:v1",
        JSON.stringify({
          offerId,
          merchantId: entry.merchantId,
          country: entry.country,
          region: region.id,
          at: new Date().toISOString()
        })
      );
    } catch {}

    location.replace(destination);
  } catch {
    fail("No hemos podido verificar el enlace. Vuelve al catálogo e inténtalo de nuevo.");
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  redirect();
}
