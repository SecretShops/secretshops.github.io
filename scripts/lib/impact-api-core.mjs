function clean(value, maximumLength = 1_000) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function upper(value) {
  return clean(value).toUpperCase();
}

function roundedMoney(value) {
  const number = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function isoDate(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function hostMatches(hostname, allowedDomain) {
  const host = clean(hostname).toLowerCase();
  const domain = clean(allowedDomain)
    .toLowerCase()
    .replace(/^\*\./, "");
  return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function collectionValue(payload, keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    const value = payload?.[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      for (const child of [key.replace(/s$/i, ""), "Item", "item"]) {
        if (Array.isArray(value[child])) return value[child];
        if (value[child] && typeof value[child] === "object") return [value[child]];
      }
    }
  }
  return [];
}

export function impactPrograms(payload) {
  return collectionValue(payload, ["Campaigns", "campaigns", "Programs", "programs"]);
}

export function impactCatalogs(payload) {
  return collectionValue(payload, ["Catalogs", "catalogs"]);
}

export function impactItems(payload) {
  return collectionValue(payload, ["Items", "items"]);
}

export function impactPromotions(payload) {
  return collectionValue(payload, ["Promotions", "promotions"]);
}

export function impactPromoCodes(payload) {
  return collectionValue(payload, ["PromoCodes", "promoCodes", "promocodes"]);
}

export function impactBoolean(value) {
  if (value === true || value === false) return value;
  const normalized = upper(value);
  if (["TRUE", "YES", "Y", "1"].includes(normalized)) return true;
  if (["FALSE", "NO", "N", "0"].includes(normalized)) return false;
  return null;
}

export function validateImpactSyncConfig(payload, regionsPayload) {
  if (payload?.schemaVersion !== 1 || !/^\d+$/.test(String(payload?.publisherId || ""))) {
    throw new Error("Configuración Impact inválida: publisherId o versión incorrectos");
  }
  if (payload.mode !== "existing_products_only") {
    throw new Error("Configuración Impact insegura: solo se admite existing_products_only");
  }

  const knownRegions = new Map(
    (regionsPayload?.regions || []).map((region) => [region.id, region])
  );
  const ids = new Set();
  const catalogKeys = new Set();
  const targets = (payload.catalogs || []).map((raw) => {
    const target = {
      ...raw,
      id: clean(raw.id, 100),
      merchantId: clean(raw.merchantId, 100),
      merchantName: clean(raw.merchantName, 120),
      catalogId: clean(raw.catalogId, 30),
      campaignId: clean(raw.campaignId, 30),
      catalogSource: clean(raw.catalogSource, 50),
      currencies: unique((raw.currencies || []).map(upper)),
      regions: unique((raw.regions || []).map((value) => clean(value).toLowerCase())),
      trackingHosts: unique(
        (raw.trackingHosts || []).map((value) => clean(value).toLowerCase())
      ),
      landingDomains: unique(
        (raw.landingDomains || []).map((value) =>
          clean(value).toLowerCase().replace(/^\*\./, "")
        )
      )
    };
    if (
      !target.id ||
      !target.merchantId ||
      !/^\d+$/.test(target.catalogId) ||
      !/^\d+$/.test(target.campaignId) ||
      target.catalogSource !== `CATF_${target.catalogId}` ||
      !target.currencies.length ||
      !target.regions.length ||
      !target.trackingHosts.length ||
      !target.landingDomains.length
    ) {
      throw new Error(`Configuración Impact incompleta: ${target.id || "(sin ID)"}`);
    }
    if (ids.has(target.id)) throw new Error(`Target Impact duplicado: ${target.id}`);
    ids.add(target.id);
    const catalogKey = `${target.catalogId}:${target.campaignId}`;
    if (catalogKeys.has(catalogKey)) {
      throw new Error(`Catálogo Impact duplicado: ${catalogKey}`);
    }
    catalogKeys.add(catalogKey);
    for (const regionId of target.regions) {
      const region = knownRegions.get(regionId);
      if (!region) throw new Error(`${target.id}: región desconocida ${regionId}`);
      if (!target.currencies.includes(upper(region.currency))) {
        throw new Error(
          `${target.id}: la moneda de ${regionId} no coincide con el catálogo`
        );
      }
    }
    return target;
  });
  if (!targets.length) throw new Error("No hay catálogos Impact configurados");
  return {
    ...payload,
    publisherId: String(payload.publisherId),
    queryBatchSize: Math.min(
      200,
      Math.max(1, Number.parseInt(payload.queryBatchSize || "100", 10) || 100)
    ),
    catalogs: targets
  };
}

export function normalizeImpactProgram(raw) {
  return {
    advertiserId: clean(raw?.AdvertiserId || raw?.advertiserId, 50),
    advertiserName: clean(raw?.AdvertiserName || raw?.advertiserName, 120),
    campaignId: clean(raw?.CampaignId || raw?.campaignId, 50),
    campaignName: clean(raw?.CampaignName || raw?.campaignName, 160),
    contractStatus: clean(raw?.ContractStatus || raw?.contractStatus, 40),
    trackingLink: clean(raw?.TrackingLink || raw?.trackingLink, 2_000),
    allowsDeeplinking: impactBoolean(
      raw?.AllowsDeeplinking ?? raw?.allowsDeeplinking
    ),
    deeplinkDomains: unique(
      (raw?.DeeplinkDomains || raw?.deeplinkDomains || [])
        .map((value) => clean(value).toLowerCase())
        .filter(Boolean)
    ),
    shippingRegions: unique(
      (raw?.ShippingRegions || raw?.shippingRegions || []).map(upper)
    )
  };
}

const SHIPPING_REGION_BY_COUNTRY = Object.freeze({
  AR: "ARGENTINA",
  AT: "AUSTRIA",
  BE: "BELGIUM",
  BG: "BULGARIA",
  BR: "BRAZIL",
  CL: "CHILE",
  CO: "COLOMBIA",
  CY: "CYPRUS",
  DE: "GERMANY",
  EE: "ESTONIA",
  ES: "SPAIN",
  FI: "FINLAND",
  FR: "FRANCE",
  GB: "UK",
  GR: "GREECE",
  HR: "CROATIA",
  IE: "IRELAND",
  IT: "ITALY",
  LT: "LITHUANIA",
  LU: "LUXEMBOURG",
  LV: "LATVIA",
  MC: "MONACO",
  MT: "MALTA",
  MX: "MEXICO",
  NL: "NETHERLANDS",
  PE: "PERU",
  PT: "PORTUGAL",
  SI: "SLOVENIA",
  SK: "SLOVAKIA",
  US: "US",
  VE: "VENEZUELA"
});

export function programShipsToCountry(program, countryCode) {
  const shipping = new Set((program?.shippingRegions || []).map(upper));
  if (!shipping.size) return null;
  const country = upper(countryCode);
  return shipping.has(country) || shipping.has(SHIPPING_REGION_BY_COUNTRY[country]);
}

export function programAllowsLandingDomain(program, hostname) {
  const domains = program?.deeplinkDomains || [];
  if (!domains.length) return null;
  return domains.some((domain) => hostMatches(hostname, domain));
}

function trackingPath(value) {
  return String(value || "").match(/^\/c\/(\d+)\/(\d+)\/(\d+)\/?$/);
}

export function parseConfiguredImpactUrl(value, target, publisherId, options = {}) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !target.trackingHosts.includes(url.hostname.toLowerCase())
    ) {
      return null;
    }
    const match = trackingPath(url.pathname);
    if (
      !match ||
      match[1] !== String(publisherId) ||
      match[2] !== String(target.campaignId)
    ) {
      return null;
    }

    const prodsku = clean(url.searchParams.get("prodsku"), 300);
    const source = clean(url.searchParams.get("intsrc"), 100);
    const landingValue = clean(url.searchParams.get("u"), 4_000);
    const hasProductParameters = Boolean(prodsku || source || landingValue);

    if (!hasProductParameters && options.allowProgramLink) {
      url.hash = "";
      return {
        href: url.href,
        trackingHost: url.hostname.toLowerCase(),
        publisherId: match[1],
        campaignId: match[2],
        creativeId: match[3],
        productSku: null,
        catalogSource: null,
        landingUrl: null,
        kind: "program"
      };
    }
    if (
      !prodsku ||
      source !== target.catalogSource ||
      !landingValue
    ) {
      return null;
    }
    const landing = new URL(landingValue);
    if (
      landing.protocol !== "https:" ||
      !target.landingDomains.some((domain) => hostMatches(landing.hostname, domain))
    ) {
      return null;
    }
    url.hash = "";
    landing.hash = "";
    return {
      href: url.href,
      trackingHost: url.hostname.toLowerCase(),
      publisherId: match[1],
      campaignId: match[2],
      creativeId: match[3],
      productSku: prodsku,
      catalogSource: source,
      landingUrl: landing.href,
      kind: "product"
    };
  } catch {
    return null;
  }
}

export function validateDirectProductUrl(value, target) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !target.landingDomains.some((domain) => hostMatches(url.hostname, domain)) ||
      url.pathname === "/"
    ) {
      return null;
    }
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function targetForLink(value, targets, publisherId) {
  for (const target of targets) {
    const parsed = parseConfiguredImpactUrl(value, target, publisherId, {
      allowProgramLink: false
    });
    if (parsed) return { target, parsed };
  }
  return null;
}

export function itemLookupKeys(item, parsedUrl = null) {
  const id = clean(item?.Id || item?.id, 300);
  const idSuffix = id.includes("-") ? id.slice(id.indexOf("-") + 1) : "";
  return unique([
    item?.ParentSku,
    item?.parentSku,
    item?.ItemGroupId,
    item?.itemGroupId,
    parsedUrl?.productSku,
    item?.CatalogItemId,
    item?.catalogItemId,
    item?.Sku,
    item?.sku,
    item?.ProductSku,
    item?.productSku,
    item?.Mpn,
    item?.mpn,
    id,
    idSuffix
  ].map((value) => clean(value, 300)));
}

function availability(value) {
  const status = upper(value).replace(/[^A-Z]/g, "");
  if (["INSTOCK", "AVAILABLE", "Y", "YES", "TRUE"].includes(status)) {
    return "in_stock";
  }
  if (["PREORDER", "PREORDERABLE"].includes(status)) return "preorder";
  if (["OUTOFSTOCK", "UNAVAILABLE", "N", "NO", "FALSE"].includes(status)) {
    return "out_of_stock";
  }
  return "unknown";
}

function candidateRank(candidate) {
  const stock = {
    in_stock: 4,
    preorder: 3,
    unknown: 2,
    out_of_stock: 1
  }[candidate.availability] ?? 0;
  return [stock, -candidate.price];
}

export function chooseImpactCandidate(current, incoming) {
  if (!current) return incoming;
  const left = candidateRank(current);
  const right = candidateRank(incoming);
  for (let index = 0; index < left.length; index += 1) {
    if (right[index] > left[index]) return incoming;
    if (right[index] < left[index]) return current;
  }
  return incoming.affiliateUrl.localeCompare(current.affiliateUrl) < 0
    ? incoming
    : current;
}

export function normalizeImpactItem(
  item,
  target,
  publisherId,
  generatedAt,
  { directFallback = false, program = null } = {}
) {
  const parsed = parseConfiguredImpactUrl(
    item?.Url || item?.url || item?.MobileUrl || item?.mobileUrl,
    target,
    publisherId
  );
  if (!parsed) return null;

  const currency = upper(item?.Currency || item?.currency);
  const price = roundedMoney(item?.CurrentPrice ?? item?.currentPrice);
  if (
    !target.currencies.includes(currency) ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return null;
  }
  if (
    !directFallback &&
    program &&
    programAllowsLandingDomain(program, new URL(parsed.landingUrl).hostname) === false
  ) {
    return null;
  }

  const previous = roundedMoney(item?.OriginalPrice ?? item?.originalPrice);
  const affiliateUrl = directFallback
    ? validateDirectProductUrl(parsed.landingUrl, target)
    : parsed.href;
  if (!affiliateUrl) return null;
  return {
    targetId: target.id,
    merchantId: target.merchantId,
    catalogId: target.catalogId,
    campaignId: target.campaignId,
    merchantProductId: parsed.productSku,
    lookupKeys: itemLookupKeys(item, parsed),
    affiliateUrl,
    landingUrl: parsed.landingUrl,
    directFallback,
    currency,
    price,
    previousPrice:
      Number.isFinite(previous) && previous > price ? previous : null,
    shippingCost: null,
    availability: availability(item?.StockAvailability ?? item?.stockAvailability),
    stockQuantity: null,
    deliveryTime: null,
    displayPrice: null,
    updatedAt: generatedAt,
    tracking: parsed
  };
}

export function candidatesFromImpactItems({
  items,
  target,
  publisherId,
  existingProductIds,
  generatedAt,
  directFallback = false,
  program = null
}) {
  const existing = existingProductIds instanceof Set
    ? existingProductIds
    : new Set(existingProductIds || []);
  const candidates = new Map();
  let acceptedRows = 0;
  let matchedRows = 0;
  let unmatchedRows = 0;

  for (const item of items || []) {
    const candidate = normalizeImpactItem(
      item,
      target,
      publisherId,
      generatedAt,
      { directFallback, program }
    );
    if (!candidate) continue;
    acceptedRows += 1;
    const matches = candidate.lookupKeys.filter((key) => existing.has(key));
    if (!matches.length) {
      unmatchedRows += 1;
      continue;
    }
    matchedRows += 1;
    for (const key of matches) {
      candidates.set(key, chooseImpactCandidate(candidates.get(key), candidate));
    }
  }
  return {
    feedRows: (items || []).length,
    acceptedRows,
    matchedRows,
    unmatchedRows,
    candidates
  };
}

export function offerLookupKeys(offer, linkUrl = null) {
  const id = clean(offer?.id, 300);
  const parts = id.split(":").filter(Boolean);
  let linkSku = "";
  try {
    linkSku = clean(new URL(linkUrl || offer?.affiliateUrl || "").searchParams.get("prodsku"));
  } catch {}
  return unique([
    offer?.merchantProductId,
    offer?.source?.parentSku,
    offer?.source?.productSku,
    linkSku,
    id,
    parts.slice(1).join(":"),
    parts.slice(2).join(":"),
    parts.at(-1)
  ].map((value) => clean(value, 300)));
}

function sameValue(left, right) {
  if (left === right) return true;
  if (
    left === null ||
    left === undefined ||
    right === null ||
    right === undefined
  ) {
    return false;
  }
  return String(left) === String(right);
}

function assign(target, key, value) {
  if (sameValue(target[key], value)) return false;
  target[key] = value;
  return true;
}

function updateOfferValues(offer, candidate, publicOffer) {
  const next = { ...offer };
  let changed = false;
  const shippingCost = candidate.shippingCost ?? offer.shippingCost ?? null;
  const totalPrice = roundedMoney(
    candidate.price + (Number.isFinite(shippingCost) ? shippingCost : 0)
  );
  changed = assign(next, "price", candidate.price) || changed;
  changed = assign(next, "previousPrice", candidate.previousPrice) || changed;
  changed = assign(next, "shippingCost", shippingCost) || changed;
  changed = assign(next, "totalPrice", totalPrice) || changed;
  if (candidate.availability !== "unknown") {
    changed = assign(next, "availability", candidate.availability) || changed;
  }
  if (!publicOffer) {
    changed = assign(next, "affiliateUrl", candidate.affiliateUrl) || changed;
    changed = assign(next, "landingUrl", candidate.landingUrl) || changed;
    const source = {
      ...(next.source || {}),
      network: "impact",
      trackingHost: candidate.tracking.trackingHost,
      publisherId: candidate.tracking.publisherId,
      campaignId: candidate.campaignId,
      creativeId: candidate.tracking.creativeId,
      catalogSource: candidate.tracking.catalogSource,
      parentSku: candidate.lookupKeys[0] || candidate.merchantProductId,
      directProductFallback: candidate.directFallback
    };
    if (JSON.stringify(source) !== JSON.stringify(next.source || {})) {
      next.source = source;
      changed = true;
    }
  }
  if (changed) next[publicOffer ? "updatedAt" : "lastUpdatedAt"] = candidate.updatedAt;
  return { offer: next, changed };
}

function recomputeFamilyPrices(family) {
  const prices = (family.variants || [])
    .flatMap((variant) => variant.offers || [])
    .map((offer) => Number(offer.price))
    .filter((price) => Number.isFinite(price) && price > 0);
  if (!prices.length) return false;
  let changed = false;
  changed = assign(family, "minPrice", Math.min(...prices)) || changed;
  changed = assign(family, "maxPrice", Math.max(...prices)) || changed;
  return changed;
}

function findCandidate(offer, targetIds, candidatesByTarget, linkUrl) {
  const keys = offerLookupKeys(offer, linkUrl);
  for (const targetId of targetIds || []) {
    const candidates = candidatesByTarget.get(targetId);
    if (!candidates) continue;
    for (const key of keys) {
      const candidate = candidates.get(key);
      if (candidate) return candidate;
    }
  }
  return null;
}

export function updateImpactCanonicalOffers({
  payload,
  targetsForOffer,
  candidatesByTarget,
  generatedAt
}) {
  const output = structuredClone(payload);
  let changedOffers = 0;
  output.offers = (output.offers || []).map((offer) => {
    const targetIds = targetsForOffer(offer.id, offer);
    const candidate = findCandidate(
      offer,
      targetIds,
      candidatesByTarget,
      offer.affiliateUrl
    );
    if (!candidate) return offer;
    const result = updateOfferValues(offer, candidate, false);
    if (result.changed) changedOffers += 1;
    return result.offer;
  });
  if (changedOffers) output.generatedAt = generatedAt;
  return { payload: output, changedOffers };
}

export function updateImpactPublicCatalog({
  payload,
  targetsForOffer,
  candidatesByTarget,
  linkForOffer,
  generatedAt
}) {
  const output = structuredClone(payload);
  let changedOffers = 0;
  for (const family of output.families || []) {
    let familyChanged = false;
    for (const variant of family.variants || []) {
      variant.offers = (variant.offers || []).map((offer) => {
        const targetIds = targetsForOffer(offer.id, offer);
        const candidate = findCandidate(
          offer,
          targetIds,
          candidatesByTarget,
          linkForOffer(offer.id)
        );
        if (!candidate) return offer;
        const result = updateOfferValues(offer, candidate, true);
        if (result.changed) {
          changedOffers += 1;
          familyChanged = true;
        }
        return result.offer;
      });
    }
    if (familyChanged) recomputeFamilyPrices(family);
  }
  if (changedOffers) output.generatedAt = generatedAt;
  return { payload: output, changedOffers };
}

export function updateImpactAffiliateLinks({
  payload,
  regionId,
  targetsForOffer,
  candidatesByTarget,
  targetsById,
  generatedAt
}) {
  const output = structuredClone(payload);
  let changedLinks = 0;
  for (const [offerId, entry] of Object.entries(output.links || {})) {
    const targetIds = targetsForOffer(offerId, entry, regionId);
    const keys = offerLookupKeys({ id: offerId }, entry.url);
    let candidate = null;
    let target = null;
    for (const targetId of targetIds || []) {
      const possible = candidatesByTarget.get(targetId);
      if (!possible) continue;
      for (const key of keys) {
        candidate = possible.get(key);
        if (candidate) {
          target = targetsById.get(targetId);
          break;
        }
      }
      if (candidate) break;
    }
    if (!candidate || !target) continue;
    const next = { ...entry, url: candidate.affiliateUrl };
    if (candidate.directFallback) {
      next.network = "impact";
      next.impactCampaignId = target.campaignId;
      next.impactCatalogId = target.catalogId;
      next.fallback = "direct_product";
    } else {
      delete next.network;
      delete next.impactCampaignId;
      delete next.impactCatalogId;
      delete next.fallback;
    }
    if (JSON.stringify(next) === JSON.stringify(entry)) continue;
    output.links[offerId] = next;
    changedLinks += 1;
  }
  if (changedLinks) output.generatedAt = generatedAt;
  return { payload: output, changedLinks };
}

function promotionDates(value) {
  const [start, end] = String(value || "").split("/", 2);
  return {
    startAt: isoDate(start),
    endAt: isoDate(end)
  };
}

function programRegions(target, program, regionsById) {
  return target.regions.filter((regionId) => {
    const region = regionsById.get(regionId);
    return region && programShipsToCountry(program, region.countryCode) !== false;
  });
}

function promotionBase(target, program, regionsById, publisherId) {
  if (upper(program.contractStatus) !== "ACTIVE") return null;
  const tracking = parseConfiguredImpactUrl(
    program.trackingLink,
    target,
    publisherId,
    { allowProgramLink: true }
  );
  if (!tracking) return null;
  const regions = programRegions(target, program, regionsById);
  if (!regions.length) return null;
  return { tracking, regions };
}

export function normalizeImpactPromotion(raw, context) {
  const advertiserId = clean(raw?.AdvertiserId || raw?.advertiserId, 50);
  const promotionId = clean(
    raw?.PromotionIds || raw?.PromotionId || raw?.promotionId || raw?.Id,
    100
  );
  const title = clean(raw?.PromotionTitle || raw?.title, 180);
  if (!advertiserId || !promotionId || !title) return [];
  const dates = promotionDates(
    raw?.PromotionEffectiveDates || raw?.promotionEffectiveDates
  );
  const now = Date.parse(context.generatedAt);
  if (dates.endAt && Date.parse(dates.endAt) < now) return [];

  const targets = context.targetsByAdvertiser.get(advertiserId) || [];
  return targets.flatMap((target) => {
    const program = context.programsByCampaign.get(target.campaignId);
    const base = program && promotionBase(
      target,
      program,
      context.regionsById,
      context.publisherId
    );
    if (!base) return [];
    const code = clean(raw?.GenericRedemptionCode, 100) || null;
    return [{
      id: `impact:promotion:${target.campaignId}:${promotionId}`,
      network: "impact",
      merchantId: target.merchantId,
      advertiserId,
      campaignId: target.campaignId,
      merchantName: clean(raw?.AdvertiserName || program.advertiserName || target.merchantName, 120),
      type: code ? "voucher" : "promotion",
      title,
      description: null,
      terms: null,
      code,
      exclusive: false,
      attributable: null,
      startAt: dates.startAt,
      endAt: dates.endAt,
      regions: base.regions,
      trackingUrl: base.tracking.href,
      sourceKind: "promotion"
    }];
  });
}

export function normalizeImpactPromoCode(raw, context) {
  const state = upper(raw?.State || raw?.state);
  const matchMode = upper(raw?.MatchMode || raw?.matchMode);
  const code = clean(raw?.Code || raw?.code, 100);
  const programId = clean(raw?.Program?.Id || raw?.program?.id, 50);
  const id = clean(raw?.Id || raw?.id, 100);
  if (
    !id ||
    !code ||
    matchMode !== "LI" ||
    !["ACTIVE", "FUTUREDATE"].includes(state)
  ) {
    return null;
  }
  const target = context.targetsByCampaign.get(programId);
  const program = context.programsByCampaign.get(programId);
  if (!target || !program) return null;
  const base = promotionBase(
    target,
    program,
    context.regionsById,
    context.publisherId
  );
  if (!base) return null;
  const startAt = isoDate(raw?.StartDate || raw?.startDate);
  const endAt = isoDate(raw?.EndDate || raw?.endDate);
  if (endAt && Date.parse(endAt) < Date.parse(context.generatedAt)) return null;
  const creditRule = upper(raw?.CreditRule || raw?.creditRule);
  const merchantName = clean(
    raw?.Advertiser?.Name ||
    raw?.advertiser?.name ||
    program.advertiserName ||
    target.merchantName,
    120
  );
  const dealName = clean(raw?.Deal?.Name || raw?.deal?.name, 180);
  return {
    id: `impact:code:${target.campaignId}:${id}`,
    network: "impact",
    merchantId: target.merchantId,
    advertiserId: clean(
      raw?.Advertiser?.Id || raw?.advertiser?.id || program.advertiserId,
      50
    ),
    campaignId: target.campaignId,
    merchantName,
    type: "voucher",
    title: dealName || `Código promocional de ${merchantName}`,
    description: null,
    terms: null,
    code,
    exclusive: false,
    attributable: creditRule === "ALWAYS",
    creditRule: creditRule || null,
    startAt,
    endAt,
    regions: base.regions,
    trackingUrl: base.tracking.href,
    sourceKind: "promo_code"
  };
}

function promotionKey(promotion) {
  return promotion.code
    ? `${promotion.campaignId}:code:${promotion.code.toUpperCase()}`
    : promotion.id;
}

export function mergeImpactPromotions(promotions, promoCodes) {
  const merged = new Map();
  for (const promotion of promotions || []) {
    merged.set(promotionKey(promotion), promotion);
  }
  for (const code of promoCodes || []) {
    const key = promotionKey(code);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, code);
      continue;
    }
    merged.set(key, {
      ...code,
      id: current.id,
      title: current.title || code.title,
      description: current.description || code.description,
      terms: current.terms || code.terms,
      startAt: current.startAt || code.startAt,
      endAt: current.endAt || code.endAt,
      sourceKind: "promotion_and_promo_code"
    });
  }
  return [...merged.values()].sort((left, right) =>
    Number(Boolean(right.code)) - Number(Boolean(left.code)) ||
    left.merchantName.localeCompare(right.merchantName) ||
    left.id.localeCompare(right.id)
  );
}

export function sameImpactPromotionContent(left, right) {
  const normalized = (payload) =>
    JSON.stringify(
      [...(payload?.promotions || [])].sort((a, b) => a.id.localeCompare(b.id))
    );
  return normalized(left) === normalized(right);
}

export function catalogItemQuery(ids) {
  const safe = unique((ids || []).map((value) => clean(value, 300)));
  if (
    !safe.length ||
    safe.some((value) => !/^[A-Za-z0-9._:@/+ -]+$/.test(value))
  ) {
    throw new Error("Identificadores no válidos para la consulta de catálogo");
  }
  const quoted = safe.map((value) => `'${value.replaceAll("'", "''")}'`);
  return `CatalogItemId IN (${quoted.join(",")})`;
}

export function madridCronShouldRun(schedule, date = new Date()) {
  if (!schedule) return true;
  const match = String(schedule).match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
  if (!match) return false;
  const scheduledDate = new Date(date);
  scheduledDate.setUTCHours(Number(match[2]), Number(match[1]), 0, 0);
  const localTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(scheduledDate);
  return localTime === `09:${match[1].padStart(2, "0")}`;
}
