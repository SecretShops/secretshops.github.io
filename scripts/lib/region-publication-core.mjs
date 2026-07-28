const SUPPORTED_LANGUAGES = new Set([
  "bg", "de", "el", "en", "es", "et", "fi", "fr", "hr",
  "it", "lt", "lv", "mt", "nl", "pt", "sk", "sl"
]);

export function evaluateRegionPublication({
  region,
  families,
  links,
  minimumFamilies = 200,
  destinationAllowed = () => true
}) {
  const reasons = [];
  const uniqueFamilies = new Set();
  const offers = [];
  for (const family of families || []) {
    if (family?.id) uniqueFamilies.add(String(family.id));
    for (const variant of family?.variants || []) {
      offers.push(...(variant.offers || []));
    }
  }

  if (region?.status !== "draft") reasons.push("not_draft");
  if (!region?.catalogManifest || !region?.affiliateLinks) reasons.push("missing_files");
  if (!SUPPORTED_LANGUAGES.has(String(region?.locale || "").split("-")[0])) {
    reasons.push("unsupported_language");
  }
  if (uniqueFamilies.size < minimumFamilies) reasons.push("insufficient_products");
  if (offers.length === 0) reasons.push("empty_catalog");

  let invalidCountry = 0;
  let invalidCurrency = 0;
  let missingLinks = 0;
  let unsafeLinks = 0;
  for (const offer of offers) {
    if (String(offer?.country || "").toUpperCase() !== region.countryCode) {
      invalidCountry += 1;
    }
    if (String(offer?.currency || "").toUpperCase() !== region.currency) {
      invalidCurrency += 1;
    }
    const entry = links?.[offer?.id];
    if (!entry || String(entry.country || "").toUpperCase() !== region.countryCode) {
      missingLinks += 1;
    } else if (!destinationAllowed(entry.url, region.countryCode)) {
      unsafeLinks += 1;
    }
  }
  if (invalidCountry) reasons.push("wrong_country");
  if (invalidCurrency) reasons.push("wrong_or_missing_currency");
  if (missingLinks) reasons.push("missing_links");
  if (unsafeLinks) reasons.push("unsafe_links");
  if (Object.keys(links || {}).length !== offers.length) reasons.push("link_count_mismatch");

  return {
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    stats: {
      families: uniqueFamilies.size,
      offers: offers.length,
      links: Object.keys(links || {}).length,
      invalidCountry,
      invalidCurrency,
      missingLinks,
      unsafeLinks,
      minimumFamilies
    }
  };
}
