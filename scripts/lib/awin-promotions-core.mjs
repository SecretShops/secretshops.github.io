function cleanText(value, maximumLength = 800) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function isoDate(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function validateAwinPromotionUrl(value, { publisherId, advertiserId }) {
  const url = new URL(value);
  const publisher =
    url.searchParams.get("a") ||
    url.searchParams.get("awinaffid");
  const advertiser =
    url.searchParams.get("m") ||
    url.searchParams.get("awinmid");
  const hasDestination =
    Boolean(url.searchParams.get("p")) ||
    Boolean(url.searchParams.get("ued"));
  if (
    url.protocol !== "https:" ||
    !/(^|\.)awin1\.com$/i.test(url.hostname) ||
    !["/pclick.php", "/cread.php"].includes(url.pathname) ||
    publisher !== String(publisherId) ||
    advertiser !== String(advertiserId) ||
    !hasDestination
  ) {
    throw new Error("Enlace de promoción Awin inválido");
  }
  url.hash = "";
  return url.href;
}

export function promotionItems(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["promotions", "data", "results", "offers"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function rawRegionCodes(raw) {
  if (raw?.regions?.all === true) return null;
  const values =
    raw?.regions?.list ||
    raw?.regionCodes ||
    raw?.regions ||
    [];
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((entry) =>
        String(entry?.countryCode || entry?.code || entry || "").toUpperCase()
      )
      .filter((code) => /^[A-Z]{2}$/.test(code))
  );
}

export function normalizeAwinPromotion(raw, context) {
  const advertiserId = String(
    raw?.advertiser?.id ||
    raw?.advertiserId ||
    raw?.merchantId ||
    ""
  );
  const merchant = context.merchantsByAdvertiser.get(advertiserId);
  if (!merchant || raw?.advertiser?.joined === false) return null;

  const promotionId = String(raw?.promotionId || raw?.id || "").trim();
  const title = cleanText(raw?.title, 180);
  if (!promotionId || !title) return null;

  const startAt = isoDate(raw?.startDate || raw?.startsAt);
  const endAt = isoDate(raw?.endDate || raw?.endsAt);
  const now = Date.parse(context.generatedAt);
  if ((startAt && Date.parse(startAt) > now) || (endAt && Date.parse(endAt) < now)) {
    return null;
  }

  let trackingUrl;
  try {
    trackingUrl = validateAwinPromotionUrl(raw?.urlTracking, {
      publisherId: context.publisherId,
      advertiserId
    });
  } catch {
    return null;
  }

  const availableRegions = context.merchantRegions.get(merchant.id) || new Set();
  const permittedCountries = rawRegionCodes(raw);
  const regions = [...availableRegions]
    .filter((regionId) => {
      if (permittedCountries === null) return true;
      const region = context.regionsById.get(regionId);
      return permittedCountries.has(region?.countryCode);
    })
    .sort();
  if (!regions.length) return null;

  const type = raw?.type === "voucher" ? "voucher" : "promotion";
  const rawCode = type === "voucher" ? cleanText(raw?.voucher?.code, 100) : "";
  const code = rawCode || null;
  return {
    id: `awin:${promotionId}`,
    network: "awin",
    merchantId: merchant.id,
    advertiserId,
    merchantName: cleanText(raw?.advertiser?.name || merchant.name, 120),
    type,
    title,
    description: cleanText(raw?.description, 600) || null,
    terms: cleanText(raw?.terms, 800) || null,
    code,
    exclusive: Boolean(raw?.voucher?.exclusive),
    attributable: Boolean(raw?.voucher?.attributable),
    startAt,
    endAt,
    regions,
    trackingUrl
  };
}

export function samePromotionContent(left, right) {
  const normalized = (payload) =>
    JSON.stringify([...(payload?.promotions || [])].sort((a, b) => a.id.localeCompare(b.id)));
  return normalized(left) === normalized(right);
}
