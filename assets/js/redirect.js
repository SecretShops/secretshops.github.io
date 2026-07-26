import {
  regionById,
  validateRegionConfig
} from "./region-core.js";

const AMAZON_ASSOCIATE_TAG = "christian0ddd-21";
const REGIONS_URL = "/data/config/regions.json";

const IMPACT_RULES = [
  { host: "shokzes.pxf.io", path: "/c/7518894/3800995/48345", source: "CATF_31438", landing: /(^|\.)es\.shokz\.com$/i, countries: ["ES"] },
  { host: "loungeeu.sjv.io", path: "/c/7518894/3973367/54841", source: "CATF_35417", landing: /(^|\.)eu\.lounge\.com$/i, countries: ["ES"] },
  { host: "coacheu.pxf.io", path: "/c/7518894/3956002/52133", source: "CATF_34935", landing: /(^|\.)es\.coach\.com$/i, countries: ["ES"] },
  { host: "italistinc.pxf.io", path: "/c/7518894/3947549/53066", source: "CATF_34671", landing: /(^|\.)r114wg-zn\.myshopify\.com$/i, countries: ["ES", "PT"] },
  { host: "italistinc.pxf.io", path: "/c/7518894/3902447/53066", source: "CATF_33797", landing: /(^|\.)italist\.com$/i, countries: ["US", "VE"] },
  { host: "hewi.pxf.io", path: "/c/7518894/3904894/53088", source: "CATF_33842", landing: /(^|\.)hardlyeverwornit\.com$/i, countries: ["GB"] },
  { host: "vivienhair.sjv.io", path: "/c/7518894/3858868/51252", source: "CATF_32690", landing: /(^|\.)vivienhair\.com$/i, countries: ["US", "VE"] },
  { host: "go.sjv.io", path: "/c/7518894/3933983/54011", source: "CATF_34508", landing: /(^|\.)xteink\.com$/i, countries: ["US"] },
  { host: "plantifique.sjv.io", path: "/c/7518894/3942357/54380", source: "CATF_34614", landing: /(^|\.)plantifique\.com$/i, countries: ["US"] },
  { host: "heybikeeu.sjv.io", path: "/c/7518894/3806125/49281", source: "CATF_31506", landing: /(^|\.)eu\.heybike\.com$/i, countries: ["AT", "BE", "HR", "EE", "FI", "FR", "DE", "IE", "IT", "LV", "LT", "LU", "NL", "PT", "SK", "SI", "ES"] },
  { host: "pixar.sjv.io", path: "/c/7518894/3971350/55246", source: "CATF_35357", landing: /(^|\.)pixarbikes\.com$/i, countries: ["AT", "BE", "FR", "DE", "IE", "IT", "NL", "PT", "ES"] },
  { host: "doreroseeu.sjv.io", path: "/c/7518894/3947787/54473", source: "CATF_34681", landing: /(^|\.)doreandrose\.com$/i, countries: ["BE", "FI", "FR", "DE", "GR", "IT", "LU", "MC", "NL", "PT", "ES"] },
  { host: "outininc.pxf.io", path: "/c/7518894/3830920/49942", source: "CATF_31985", landing: /(^|\.)outin\.com$/i, countries: ["US"] }
];

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

function impactRule(url) {
  return IMPACT_RULES.find((rule) => {
    if (url.hostname.toLowerCase() !== rule.host || url.pathname !== rule.path) return false;
    if (!url.searchParams.get("prodsku") || url.searchParams.get("intsrc") !== rule.source) return false;
    try {
      const landing = new URL(url.searchParams.get("u"));
      return landing.protocol === "https:" && rule.landing.test(landing.hostname);
    } catch {
      return false;
    }
  }) || null;
}

export function allowedDestination(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const awin = /(^|\.)awin1\.com$/i.test(url.hostname) && ["/pclick.php", "/cread.php"].includes(url.pathname) && ["a", "p", "m"].every((key) => url.searchParams.get(key));
    const aliexpress = /^s\.click\.aliexpress\.com$/i.test(url.hostname);
    const amazon = /^(?:www\.)?amazon\.es$/i.test(url.hostname) && /^\/dp\/[A-Z0-9]{10}\/ref=nosim\/?$/i.test(url.pathname) && url.searchParams.get("tag") === AMAZON_ASSOCIATE_TAG;
    return awin || aliexpress || amazon || impactRule(url) ? url.href : null;
  } catch {
    return null;
  }
}

export function destinationAllowedForCountry(value, countryCode) {
  const country = String(countryCode || "").toUpperCase();
  const destination = allowedDestination(value);
  if (!destination || !country) return null;
  const url = new URL(destination);
  if (/(^|\.)amazon\.es$/i.test(url.hostname) && country !== "ES") return null;
  const rule = impactRule(url);
  if (rule && !rule.countries.includes(country)) return null;
  return destination;
}

export function entryMatchesRegion(entry, region) {
  if (!entry || !region || region.status !== "published") return false;
  if (String(entry.country || "").toUpperCase() !== region.countryCode) return false;
  return Boolean(destinationAllowedForCountry(entry.url, region.countryCode));
}

async function fetchJson(url, label) {
  const target = new URL(url, location.origin);
  target.searchParams.set("_ss", String(Date.now()));
  const response = await fetch(target.href, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache"
    }
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
    const config = validateRegionConfig(await fetchJson(REGIONS_URL, "Configuración regional"));
    const requestedRegion = String(params.get("region") || config.defaultRegion).toLowerCase();
    const region = regionById(config, requestedRegion);
    if (!region || region.status !== "published" || !region.affiliateLinks) {
      fail("El país indicado todavía no está disponible.");
      return;
    }
    const back = document.querySelector("[data-redirect-back]");
    if (back) back.href = region.basePath;
    const payload = await fetchJson(region.affiliateLinks, "Enlaces regionales");
    if (payload.region !== region.id || payload.country !== region.countryCode) throw new Error("El archivo de enlaces no pertenece a la región solicitada.");
    const entry = payload?.links?.[offerId];
    const destination = allowedDestination(entry?.url);
    if (!destination || !entryMatchesRegion(entry, region)) {
      fail("La oferta no está publicada para este país o su enlace no supera la verificación.");
      return;
    }
    try {
      sessionStorage.setItem("secretshop:last-outbound:v1", JSON.stringify({ offerId, merchantId: entry.merchantId, country: entry.country, region: region.id, at: new Date().toISOString() }));
    } catch {}
    location.replace(destination);
  } catch {
    fail("No hemos podido verificar el enlace. Vuelve al catálogo e inténtalo de nuevo.");
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") redirect();
