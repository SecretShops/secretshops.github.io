import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  cleanText,
  isHttpsUrl,
  normalizeSearchText,
  parseBoolean,
  parseCsv,
  parseDecimal,
  parseInteger
} from "./awin-feed-utils.mjs";

const FEED_LIST_ALIASES = Object.freeze({
  advertiserId: ["advertiser id", "advertiser_id", "merchant id", "merchant_id"],
  advertiserName: ["advertiser name", "advertiser_name", "merchant name", "merchant_name"],
  feedId: ["feed id", "feed_id", "data feed id", "data_feed_id"],
  feedName: ["feed name", "feed_name"],
  lastImported: ["last imported", "last_imported", "last updated", "last_updated"],
  url: ["url", "download url", "download_url"]
});

const ROW_ALIASES = Object.freeze({
  advertiserId: ["merchant_id", "advertiser_id", "awin_advertiser_id"],
  merchantProductId: ["merchant_product_id", "merchant_sku", "sku", "id"],
  awProductId: ["aw_product_id", "awin_product_id"],
  dataFeedId: ["data_feed_id", "feed_id"],
  affiliateUrl: ["aw_deep_link", "affiliate_url", "deep_link"],
  currency: ["currency", "currency_code"],
  price: ["search_price", "store_price", "price", "sale_price"],
  previousPrice: ["product_price_old", "rrp_price", "old_price"],
  shippingCost: ["delivery_cost", "shipping_cost"],
  inStock: ["in_stock"],
  isForSale: ["is_for_sale"],
  preOrder: ["pre_order"],
  stockStatus: ["stock_status", "availability"],
  stockQuantity: ["stock_quantity", "number_available"],
  deliveryTime: ["delivery_time"],
  displayPrice: ["display_price"],
  lastUpdated: ["last_updated", "updated_at"],
  landingUrl: ["merchant_deep_link", "product_url", "landing_url", "link"]
});

function normalizedKey(value) {
  return normalizeSearchText(value).replace(/\s+/g, " ");
}

function rowValue(row, aliases) {
  for (const alias of aliases) {
    if (row?.[alias] !== undefined && cleanText(row[alias])) return cleanText(row[alias]);
  }

  const normalized = new Map(
    Object.entries(row || {}).map(([key, value]) => [normalizedKey(key), value])
  );
  for (const alias of aliases) {
    const value = normalized.get(normalizedKey(alias));
    if (value !== undefined && cleanText(value)) return cleanText(value);
  }
  return "";
}

function* csvRows(text) {
  const source = String(text ?? "");
  let row = [];
  let field = "";
  let quoted = false;
  const startIndex = source.charCodeAt(0) === 0xfeff ? 1 : 0;

  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];

    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      yield row;
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (quoted) {
    throw new Error("CSV inválido: comillas sin cerrar");
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    yield row;
  }
}

function roundedMoney(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function parseIsoDate(value, fallback) {
  const text = cleanText(value);
  if (!text) return fallback;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  return Number.isFinite(Date.parse(normalized))
    ? new Date(normalized).toISOString()
    : fallback;
}

function availabilityFromRow(row) {
  const inStock = parseBoolean(rowValue(row, ROW_ALIASES.inStock));
  const isForSale = parseBoolean(rowValue(row, ROW_ALIASES.isForSale));
  const preOrder = parseBoolean(rowValue(row, ROW_ALIASES.preOrder));
  const stockQuantity = parseInteger(rowValue(row, ROW_ALIASES.stockQuantity));
  const status = normalizeSearchText(rowValue(row, ROW_ALIASES.stockStatus));

  if (preOrder === true || ["preorder", "pre order", "preorden"].includes(status)) {
    return "preorder";
  }
  if (
    inStock === false ||
    isForSale === false ||
    stockQuantity === 0 ||
    ["out of stock", "out_of_stock", "unavailable", "agotado"].includes(status)
  ) {
    return "out_of_stock";
  }
  if (
    inStock === true ||
    isForSale === true ||
    (Number.isInteger(stockQuantity) && stockQuantity > 0) ||
    ["in stock", "in_stock", "available", "disponible"].includes(status)
  ) {
    return "in_stock";
  }
  return "unknown";
}

export function decodeMaybeGzip(buffer) {
  const source = Buffer.from(buffer);
  if (source.length >= 2 && source[0] === 0x1f && source[1] === 0x8b) {
    return gunzipSync(source).toString("utf8");
  }
  return source.toString("utf8");
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function parseFeedList(text) {
  const { records } = parseCsv(text);
  return records
    .map((row) => ({
      advertiserId: rowValue(row, FEED_LIST_ALIASES.advertiserId),
      advertiserName: rowValue(row, FEED_LIST_ALIASES.advertiserName),
      feedId: rowValue(row, FEED_LIST_ALIASES.feedId),
      feedName: rowValue(row, FEED_LIST_ALIASES.feedName),
      lastImported: rowValue(row, FEED_LIST_ALIASES.lastImported) || null,
      url: rowValue(row, FEED_LIST_ALIASES.url)
    }))
    .filter((entry) => entry.advertiserId && entry.feedId && entry.url);
}

export function secureFeedUrl(value) {
  const url = new URL(value);
  const allowedHost =
    url.hostname === "productdata.awin.com" ||
    url.hostname === "datafeed.api.productserve.com" ||
    url.hostname.endsWith(".awin.com") ||
    url.hostname.endsWith(".productserve.com");

  if (!allowedHost || !url.pathname.includes("/datafeed/download/")) {
    throw new Error("Awin devolvió una URL de feed no permitida");
  }
  if (url.username || url.password) {
    throw new Error("Awin devolvió una URL de feed con credenciales inseguras");
  }
  url.protocol = "https:";
  url.hash = "";
  return url.href;
}

export function validateAwinAffiliateUrl(value, { publisherId, advertiserId }) {
  const url = new URL(value);
  const allowedHost = /(^|\.)awin1\.com$/i.test(url.hostname);
  if (
    url.protocol !== "https:" ||
    !allowedHost ||
    !["/pclick.php", "/cread.php"].includes(url.pathname) ||
    url.searchParams.get("a") !== String(publisherId) ||
    url.searchParams.get("m") !== String(advertiserId) ||
    !url.searchParams.get("p")
  ) {
    throw new Error("Enlace de afiliación Awin inválido");
  }
  return url.href;
}

export function normalizeFeedRow(row, merchant, publisherId, generatedAt) {
  const advertiserId = rowValue(row, ROW_ALIASES.advertiserId);
  if (advertiserId !== String(merchant.awinAdvertiserId)) return null;

  const merchantProductId = rowValue(row, ROW_ALIASES.merchantProductId);
  const currency = rowValue(row, ROW_ALIASES.currency).toUpperCase();
  const price = roundedMoney(parseDecimal(rowValue(row, ROW_ALIASES.price)));
  const affiliateCandidate = rowValue(row, ROW_ALIASES.affiliateUrl);

  if (
    !merchantProductId ||
    !merchant.expectedCurrencies.has(currency) ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !affiliateCandidate
  ) {
    return null;
  }

  let affiliateUrl;
  try {
    affiliateUrl = validateAwinAffiliateUrl(affiliateCandidate, {
      publisherId,
      advertiserId
    });
  } catch {
    return null;
  }

  const oldPrice = roundedMoney(parseDecimal(rowValue(row, ROW_ALIASES.previousPrice)));
  const shippingCost = roundedMoney(parseDecimal(rowValue(row, ROW_ALIASES.shippingCost)));
  const stockQuantity = parseInteger(rowValue(row, ROW_ALIASES.stockQuantity));
  const landingCandidate = rowValue(row, ROW_ALIASES.landingUrl);
  const availability = availabilityFromRow(row);

  return {
    merchantId: merchant.id,
    advertiserId,
    merchantProductId,
    awProductId: rowValue(row, ROW_ALIASES.awProductId) || null,
    dataFeedId: rowValue(row, ROW_ALIASES.dataFeedId) || null,
    affiliateUrl,
    landingUrl: isHttpsUrl(landingCandidate) ? landingCandidate : null,
    currency,
    price,
    previousPrice: Number.isFinite(oldPrice) && oldPrice > price ? oldPrice : null,
    shippingCost: Number.isFinite(shippingCost) && shippingCost >= 0 ? shippingCost : null,
    availability,
    stockQuantity: Number.isInteger(stockQuantity) ? stockQuantity : null,
    deliveryTime: rowValue(row, ROW_ALIASES.deliveryTime) || null,
    displayPrice: rowValue(row, ROW_ALIASES.displayPrice) || null,
    updatedAt: parseIsoDate(rowValue(row, ROW_ALIASES.lastUpdated), generatedAt)
  };
}

function candidateRank(candidate) {
  const availability = {
    in_stock: 4,
    preorder: 3,
    unknown: 2,
    out_of_stock: 1
  }[candidate.availability] ?? 0;
  return [
    availability,
    Date.parse(candidate.updatedAt) || 0,
    -candidate.price
  ];
}

export function chooseCandidate(current, incoming) {
  if (!current) return incoming;
  const left = candidateRank(current);
  const right = candidateRank(incoming);
  for (let index = 0; index < left.length; index += 1) {
    if (right[index] > left[index]) return incoming;
    if (right[index] < left[index]) return current;
  }
  return incoming.affiliateUrl.localeCompare(current.affiliateUrl) < 0 ? incoming : current;
}

export function candidatesFromFeed(text, merchant, publisherId, generatedAt) {
  const rows = csvRows(text);
  const first = rows.next();
  if (first.done) {
    return { feedRows: 0, acceptedRows: 0, candidates: new Map() };
  }

  const headers = first.value.map((header) => cleanText(header));
  if (headers.some((header) => !header)) {
    throw new Error("CSV inválido: contiene una columna sin nombre");
  }
  const duplicateHeaders = headers.filter(
    (header, index) => headers.indexOf(header) !== index
  );
  if (duplicateHeaders.length > 0) {
    throw new Error(
      `CSV inválido: columnas duplicadas: ${[...new Set(duplicateHeaders)].join(", ")}`
    );
  }

  const relevantHeaders = new Set(
    Object.values(ROW_ALIASES).flat().map((header) => normalizedKey(header))
  );
  const selectedColumns = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => relevantHeaders.has(normalizedKey(header)));
  const candidates = new Map();
  let feedRows = 0;
  let acceptedRows = 0;

  for (const values of rows) {
    if (values.length === 1 && values[0] === "") continue;
    feedRows += 1;
    const row = {};
    for (const { header, index } of selectedColumns) {
      row[header] = values[index] ?? "";
    }
    const candidate = normalizeFeedRow(row, merchant, publisherId, generatedAt);
    if (!candidate) continue;
    acceptedRows += 1;
    candidates.set(
      candidate.merchantProductId,
      chooseCandidate(candidates.get(candidate.merchantProductId), candidate)
    );
  }

  return {
    feedRows,
    acceptedRows,
    candidates
  };
}

export function selectExistingCandidates(candidates, existingProductIds) {
  const existing = existingProductIds instanceof Set
    ? existingProductIds
    : new Set(existingProductIds || []);
  return new Map(
    [...(candidates || new Map())].filter(([productId]) => existing.has(productId))
  );
}

function sameValue(left, right) {
  if (left === right) return true;
  if (left === null || left === undefined || right === null || right === undefined) return false;
  return String(left) === String(right);
}

function assignIfDifferent(target, key, value) {
  if (sameValue(target[key], value)) return false;
  target[key] = value;
  return true;
}

function merchantProductIdFromOffer(offer) {
  if (cleanText(offer.merchantProductId)) return cleanText(offer.merchantProductId);
  const prefix = `${offer.merchantId}:`;
  return String(offer.id || "").startsWith(prefix)
    ? String(offer.id).slice(prefix.length)
    : "";
}

function updatedOffer(offer, candidate, publicOffer) {
  const output = { ...offer };
  let changed = false;
  const shippingCost = candidate.shippingCost ?? offer.shippingCost ?? null;
  const availability =
    candidate.availability === "unknown"
      ? offer.availability
      : candidate.availability;
  const totalPrice = roundedMoney(
    candidate.price + (Number.isFinite(shippingCost) ? shippingCost : 0)
  );

  changed = assignIfDifferent(output, "price", candidate.price) || changed;
  changed = assignIfDifferent(output, "previousPrice", candidate.previousPrice) || changed;
  changed = assignIfDifferent(output, "shippingCost", shippingCost) || changed;
  changed = assignIfDifferent(output, "totalPrice", totalPrice) || changed;
  changed = assignIfDifferent(output, "availability", availability) || changed;

  if (candidate.deliveryTime !== null) {
    changed = assignIfDifferent(output, "deliveryTime", candidate.deliveryTime) || changed;
  }
  if (!publicOffer) {
    changed = assignIfDifferent(output, "affiliateUrl", candidate.affiliateUrl) || changed;
    if (candidate.landingUrl) {
      changed = assignIfDifferent(output, "landingUrl", candidate.landingUrl) || changed;
    }
    if (candidate.stockQuantity !== null) {
      changed = assignIfDifferent(output, "stockQuantity", candidate.stockQuantity) || changed;
    }
    if (candidate.displayPrice) {
      changed = assignIfDifferent(output, "displayPrice", candidate.displayPrice) || changed;
    }
    const source = {
      ...(output.source || {}),
      ...(candidate.awProductId ? { awProductId: candidate.awProductId } : {}),
      ...(candidate.dataFeedId ? { dataFeedId: candidate.dataFeedId } : {}),
      awinMerchantId: candidate.advertiserId
    };
    if (JSON.stringify(source) !== JSON.stringify(output.source || {})) {
      output.source = source;
      changed = true;
    }
  }

  if (changed) {
    output[publicOffer ? "updatedAt" : "lastUpdatedAt"] = candidate.updatedAt;
  }
  return { offer: output, changed };
}

export function updateCanonicalOffers(payload, candidatesByMerchant, generatedAt) {
  const output = structuredClone(payload);
  let changedOffers = 0;
  const matchedByMerchant = new Map();

  output.offers = (output.offers || []).map((offer) => {
    const candidates = candidatesByMerchant.get(offer.merchantId);
    if (!candidates) return offer;
    const productId = merchantProductIdFromOffer(offer);
    const candidate = candidates.get(productId);
    if (!candidate) return offer;
    matchedByMerchant.set(
      offer.merchantId,
      (matchedByMerchant.get(offer.merchantId) || 0) + 1
    );
    const updated = updatedOffer(offer, candidate, false);
    if (updated.changed) changedOffers += 1;
    return updated.offer;
  });

  if (changedOffers > 0) output.generatedAt = generatedAt;
  return { payload: output, changedOffers, matchedByMerchant };
}

function recomputeFamilyPrices(family) {
  const prices = (family.variants || [])
    .flatMap((variant) => variant.offers || [])
    .map((offer) => Number(offer.price))
    .filter((price) => Number.isFinite(price) && price > 0);
  if (!prices.length) return false;
  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  let changed = false;
  changed = assignIfDifferent(family, "minPrice", minimum) || changed;
  changed = assignIfDifferent(family, "maxPrice", maximum) || changed;
  return changed;
}

export function updatePublicCatalog(payload, candidatesByMerchant, generatedAt) {
  const output = structuredClone(payload);
  let changedOffers = 0;
  const matchedByMerchant = new Map();

  for (const family of output.families || []) {
    let familyChanged = false;
    for (const variant of family.variants || []) {
      variant.offers = (variant.offers || []).map((offer) => {
        const candidates = candidatesByMerchant.get(offer.merchantId);
        if (!candidates) return offer;
        const productId = merchantProductIdFromOffer(offer);
        const candidate = candidates.get(productId);
        if (!candidate) return offer;
        matchedByMerchant.set(
          offer.merchantId,
          (matchedByMerchant.get(offer.merchantId) || 0) + 1
        );
        const updated = updatedOffer(offer, candidate, true);
        if (updated.changed) {
          changedOffers += 1;
          familyChanged = true;
        }
        return updated.offer;
      });
    }
    if (familyChanged) recomputeFamilyPrices(family);
  }

  if (changedOffers > 0) output.generatedAt = generatedAt;
  return { payload: output, changedOffers, matchedByMerchant };
}

export function updateAffiliateLinks(payload, candidatesByMerchant, generatedAt) {
  const output = structuredClone(payload);
  let changedLinks = 0;
  for (const [offerId, entry] of Object.entries(output.links || {})) {
    const merchantId = entry.merchantId;
    const candidates = candidatesByMerchant.get(merchantId);
    if (!candidates) continue;
    const prefix = `${merchantId}:`;
    if (!offerId.startsWith(prefix)) continue;
    const candidate = candidates.get(offerId.slice(prefix.length));
    if (!candidate || entry.url === candidate.affiliateUrl) continue;
    entry.url = candidate.affiliateUrl;
    changedLinks += 1;
  }
  if (changedLinks > 0) output.generatedAt = generatedAt;
  return { payload: output, changedLinks };
}

export function madridCronShouldRun(schedule, date = new Date()) {
  if (!schedule) return true;
  const match = String(schedule).match(/^\d+\s+(\d+)\s+\*\s+\*\s+\*$/);
  if (!match) return false;
  const scheduledHour = Number(match[1]);
  const scheduledDate = new Date(date);
  scheduledDate.setUTCHours(scheduledHour, 17, 0, 0);
  const localHour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    hourCycle: "h23"
  }).format(scheduledDate);
  return localHour === "09";
}
