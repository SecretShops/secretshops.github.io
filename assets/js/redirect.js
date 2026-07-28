import {
  regionById,
  validateRegionConfig
} from "./region-core.js";

const AMAZON_ASSOCIATE_TAG = "christian0ddd-21";
const AWIN_PUBLISHER_ID = "2996453";
const IMPACT_PUBLISHER_ID = "7518894";
const REGIONS_URL = "/data/config/regions.json";
const PROMOTIONS_URLS = [
  "/data/promotions/awin.json",
  "/data/promotions/impact.json"
];

const IMPACT_RULES = [
  { host: "shokzes.pxf.io", path: "/c/7518894/3800995/48345", source: "CATF_31438", landing: /(^|\.)es\.shokz\.com$/i, countries: ["ES"] },
  { host: "loungeeu.sjv.io", path: "/c/7518894/3973367/54841", source: "CATF_35417", landing: /(^|\.)eu\.lounge\.com$/i, countries: ["ES", "PT"] },
  { host: "casecess.pxf.io", path: "/c/7518894/3757273/47158", source: "CATF_30305", landing: /(^|\.)casecess\.com$/i, countries: ["US"] },
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
  { host: "outininc.pxf.io", path: "/c/7518894/3830920/49942", source: "CATF_31985", landing: /(^|\.)outin\.com$/i, countries: ["US"] },
  { host: "lenovo.evyy.net", path: "/c/7518894/553883/3831", source: "CATF_4182", landing: /(^|\.)lenovo\.com$/i, countries: ["ES"] },
  { host: "lenovo.evyy.net", path: "/c/7518894/665754/3831", source: "CATF_5021", landing: /(^|\.)lenovo\.com$/i, countries: ["ES"] }
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

function impactRule(url, { allowProgramLink = false } = {}) {
  return IMPACT_RULES.find((rule) => {
    if (url.hostname.toLowerCase() !== rule.host) return false;
    const expected = rule.path.match(/^\/c\/(\d+)\/(\d+)\/\d+$/);
    const actual = url.pathname.match(/^\/c\/(\d+)\/(\d+)\/(\d+)\/?$/);
    if (
      !expected ||
      !actual ||
      actual[1] !== expected[1] ||
      actual[2] !== expected[2]
    ) {
      return false;
    }
    const prodsku = url.searchParams.get("prodsku");
    const source = url.searchParams.get("intsrc");
    const landingValue = url.searchParams.get("u");
    if (!prodsku && !source && !landingValue) return allowProgramLink;
    if (!prodsku || source !== rule.source || !landingValue) return false;
    try {
      const landing = new URL(landingValue);
      return landing.protocol === "https:" && rule.landing.test(landing.hostname);
    } catch {
      return false;
    }
  }) || null;
}

function directImpactRule(url) {
  if (url.protocol !== "https:" || url.pathname === "/") return null;
  return IMPACT_RULES.find((rule) => rule.landing.test(url.hostname)) || null;
}

export function allowedDestination(value, options = {}) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const awinPublisher = url.searchParams.get("a") || url.searchParams.get("awinaffid");
    const awinAdvertiser = url.searchParams.get("m") || url.searchParams.get("awinmid");
    const awinDestination = url.searchParams.get("p") || url.searchParams.get("ued");
    const awin =
      /(^|\.)awin1\.com$/i.test(url.hostname) &&
      ["/pclick.php", "/cread.php"].includes(url.pathname) &&
      Boolean(awinPublisher && awinAdvertiser && awinDestination);
    const aliexpress = /^s\.click\.aliexpress\.com$/i.test(url.hostname);
    const amazon = /^(?:www\.)?amazon\.es$/i.test(url.hostname) && /^\/dp\/[A-Z0-9]{10}\/ref=nosim\/?$/i.test(url.pathname) && url.searchParams.get("tag") === AMAZON_ASSOCIATE_TAG;
    const impact = impactRule(url, {
      allowProgramLink: options.allowImpactProgramLink === true
    });
    const directImpact =
      options.allowDirectImpactProduct !== false && directImpactRule(url);
    return awin || aliexpress || amazon || impact || directImpact ? url.href : null;
  } catch {
    return null;
  }
}

export function promotionMatchesRegion(entry, region, now = new Date()) {
  if (
    !["awin", "impact"].includes(entry?.network) ||
    !region ||
    region.status !== "published" ||
    !Array.isArray(entry.regions) ||
    !entry.regions.includes(region.id)
  ) {
    return false;
  }
  const timestamp = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(timestamp)) return false;
  if (entry.startAt && Date.parse(entry.startAt) > timestamp) return false;
  if (entry.endAt && Date.parse(entry.endAt) < timestamp) return false;
  const destination = allowedDestination(entry.trackingUrl, {
    allowImpactProgramLink: entry.network === "impact",
    allowDirectImpactProduct: false
  });
  if (!destination) return false;
  const url = new URL(destination);
  if (entry.network === "impact") {
    const rule = impactRule(url, { allowProgramLink: true });
    const path = url.pathname.match(/^\/c\/(\d+)\/(\d+)\/\d+\/?$/);
    return Boolean(
      rule &&
      path &&
      path[1] === IMPACT_PUBLISHER_ID &&
      path[2] === String(entry.campaignId || "") &&
      rule.countries.includes(region.countryCode)
    );
  }
  const publisher = url.searchParams.get("a") || url.searchParams.get("awinaffid");
  const advertiser = url.searchParams.get("m") || url.searchParams.get("awinmid");
  return (
    publisher === AWIN_PUBLISHER_ID &&
    advertiser === String(entry.advertiserId || "")
  );
}

export function destinationAllowedForCountry(value, countryCode) {
  const country = String(countryCode || "").toUpperCase();
  const destination = allowedDestination(value);
  if (!destination || !country) return null;
  const url = new URL(destination);
  if (/(^|\.)amazon\.es$/i.test(url.hostname) && country !== "ES") return null;
  const rule = impactRule(url);
  if (rule && !rule.countries.includes(country)) return null;
  const directRule = directImpactRule(url);
  if (directRule && !directRule.countries.includes(country)) return null;
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

async function fetchPromotions() {
  const payloads = await Promise.all(
    PROMOTIONS_URLS.map((url) => fetchJson(url, "Promociones verificadas"))
  );
  return payloads.flatMap((payload) => payload?.promotions || []);
}

async function redirect() {
  const params = new URLSearchParams(location.search);
  const offerId = params.get("offer")?.trim();
  const promotionId = params.get("promo")?.trim();
  if (
    Boolean(offerId) === Boolean(promotionId) ||
    (offerId?.length || 0) > 200 ||
    (promotionId?.length || 0) > 200
  ) {
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
    if (promotionId) {
      const promotions = await fetchPromotions();
      const entry = promotions.find(
        (promotion) => promotion.id === promotionId
      );
      const destination = allowedDestination(entry?.trackingUrl, {
        allowImpactProgramLink: entry?.network === "impact",
        allowDirectImpactProduct: false
      });
      if (!destination || !promotionMatchesRegion(entry, region)) {
        fail("La promoción no está vigente para este país o su enlace no supera la verificación.");
        return;
      }
      try {
        sessionStorage.setItem("secretshop:last-outbound:v1", JSON.stringify({
          promotionId,
          merchantId: entry.merchantId,
          country: region.countryCode,
          region: region.id,
          at: new Date().toISOString()
        }));
      } catch {}
      location.replace(destination);
      return;
    }
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
