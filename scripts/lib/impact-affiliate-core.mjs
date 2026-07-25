function clean(value) {
  return String(value ?? "").trim();
}

function hostMatches(hostname, allowedDomain) {
  const host = clean(hostname).toLowerCase();
  const domain = clean(allowedDomain).toLowerCase();
  return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`));
}

export function parseImpactAffiliateUrl(value, options = {}) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;

    const trackingHost = clean(options.trackingHost).toLowerCase();
    if (trackingHost && url.hostname.toLowerCase() !== trackingHost) return null;

    const match = url.pathname.match(/^\/c\/(\d+)\/(\d+)\/(\d+)\/?$/);
    if (!match) return null;

    const [, publisherId, campaignId, creativeId] = match;
    if (clean(options.publisherId) && publisherId !== clean(options.publisherId)) return null;
    if (clean(options.campaignId) && campaignId !== clean(options.campaignId)) return null;
    if (clean(options.creativeId) && creativeId !== clean(options.creativeId)) return null;

    const productSku = clean(url.searchParams.get("prodsku"));
    if (!productSku) return null;
    if (clean(options.productSku) && productSku !== clean(options.productSku)) return null;

    const catalogSource = clean(url.searchParams.get("intsrc"));
    if (!catalogSource) return null;
    if (clean(options.catalogSource) && catalogSource !== clean(options.catalogSource)) return null;

    const landingValue = clean(url.searchParams.get("u"));
    if (!landingValue) return null;
    const landingUrl = new URL(landingValue);
    if (landingUrl.protocol !== "https:") return null;

    const landingDomains = Array.isArray(options.landingDomains)
      ? options.landingDomains.filter(Boolean)
      : [];
    if (
      landingDomains.length > 0 &&
      !landingDomains.some((domain) => hostMatches(landingUrl.hostname, domain))
    ) {
      return null;
    }

    return {
      href: url.href,
      trackingHost: url.hostname.toLowerCase(),
      publisherId,
      campaignId,
      creativeId,
      productSku,
      catalogSource,
      landingUrl: landingUrl.href
    };
  } catch {
    return null;
  }
}

export function validateImpactAffiliateUrl(value, options = {}) {
  return parseImpactAffiliateUrl(value, options)?.href ?? null;
}
