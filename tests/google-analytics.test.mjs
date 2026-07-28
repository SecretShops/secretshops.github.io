import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [analytics, staticModule, regionCore, privacy] = await Promise.all([
  readFile(resolve(root, "assets/js/google-analytics.js"), "utf8"),
  readFile(resolve(root, "assets/js/static.js"), "utf8"),
  readFile(resolve(root, "assets/js/region-core.js"), "utf8"),
  readFile(resolve(root, "privacidad.html"), "utf8")
]);

test("GA4 usa el identificador correcto y no se carga antes del consentimiento", () => {
  assert.ok(analytics.includes('const GOOGLE_ANALYTICS_ID = "G-924RW3CPMM"'));
  assert.ok(analytics.includes('analytics_storage: value === "accepted" ? "granted" : "denied"'));
  assert.ok(analytics.includes('if (activeConsent === "accepted") loadGoogleTag()'));
  assert.ok(analytics.includes('window[GOOGLE_ANALYTICS_DISABLE_KEY] = activeConsent !== "accepted"'));
  assert.ok(analytics.includes('allow_google_signals: false'));
  assert.ok(analytics.includes('allow_ad_personalization_signals: false'));
});

test("el módulo común cubre páginas regionales, fichas y páginas estáticas", () => {
  assert.ok(staticModule.includes('import "./google-analytics.js"'));
  assert.ok(regionCore.includes('import "./google-analytics.js"'));
  assert.equal(staticModule.match(/google-analytics\.js/g)?.length, 1);
  assert.equal(regionCore.match(/google-analytics\.js/g)?.length, 1);
});

test("la política de privacidad explica GA4 y permite cambiar la decisión", () => {
  assert.ok(privacy.includes("Google Analytics 4"));
  assert.ok(privacy.includes("data-analytics-consent-settings"));
  assert.ok(privacy.includes("data-analytics-consent-status"));
  assert.ok(analytics.includes("bottom: calc(76px + env(safe-area-inset-bottom))"));
});

test("se registran búsquedas y clics de afiliación sin enviar destinos externos", () => {
  assert.ok(analytics.includes('sendEvent("search"'));
  assert.ok(analytics.includes('sendEvent("affiliate_click"'));
  assert.ok(analytics.includes('url.pathname !== "/go.html"'));
  assert.equal(analytics.includes("entry.url"), false);
});
