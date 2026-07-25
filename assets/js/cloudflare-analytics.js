const CLOUDFLARE_ANALYTICS_TOKEN = "ab0e864b07f241f78f5583cb0370e0a7";
const CLOUDFLARE_BEACON_URL = "https://static.cloudflareinsights.com/beacon.min.js";
const PRODUCTION_HOSTS = new Set([
  "getsecretshop.com",
  "www.getsecretshop.com"
]);

function installCloudflareAnalytics() {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const hostname = String(window.location.hostname || "").toLowerCase();
  if (!PRODUCTION_HOSTS.has(hostname)) return;

  if (document.querySelector("script[data-cf-beacon]")) return;

  const script = document.createElement("script");
  script.type = "module";
  script.src = CLOUDFLARE_BEACON_URL;
  script.setAttribute(
    "data-cf-beacon",
    JSON.stringify({ token: CLOUDFLARE_ANALYTICS_TOKEN })
  );

  (document.body || document.head || document.documentElement).append(script);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installCloudflareAnalytics, {
      once: true
    });
  } else {
    installCloudflareAnalytics();
  }
}
