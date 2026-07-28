const GOOGLE_ANALYTICS_ID = "G-924RW3CPMM";
const GOOGLE_TAG_URL = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GOOGLE_ANALYTICS_ID)}`;
const CONSENT_STORAGE_KEY = "secretshop:ga4-consent:v1";
const GOOGLE_TAG_SCRIPT_ID = "secretshop-google-analytics";
const CONSENT_STYLE_ID = "secretshop-ga4-consent-styles";
const CONSENT_BANNER_ID = "secretshop-ga4-consent";
const GOOGLE_TAG_CONFIGURED_KEY = "__secretShopGa4Configured";
const GOOGLE_ANALYTICS_DISABLE_KEY = `ga-disable-${GOOGLE_ANALYTICS_ID}`;
const PRODUCTION_HOSTS = new Set([
  "getsecretshop.com",
  "www.getsecretshop.com"
]);

const COPY = {
  es: {
    title: "Tu privacidad y la analítica",
    text: "Con tu permiso, Google Analytics 4 nos ayuda a entender qué páginas, búsquedas y ofertas interesan más. Google Analytics no se carga hasta que aceptas.",
    accept: "Aceptar analítica",
    reject: "Rechazar analítica",
    more: "Más información",
    accepted: "Aceptada",
    rejected: "Rechazada",
    undecided: "Sin elegir"
  },
  pt: {
    title: "A sua privacidade e as estatísticas",
    text: "Com a sua autorização, o Google Analytics 4 ajuda-nos a perceber quais páginas, pesquisas e ofertas despertam mais interesse. O Google Analytics não é carregado até aceitar.",
    accept: "Aceitar estatísticas",
    reject: "Rejeitar estatísticas",
    more: "Mais informações",
    accepted: "Aceite",
    rejected: "Rejeitada",
    undecided: "Sem escolha"
  },
  en: {
    title: "Your privacy and analytics",
    text: "With your permission, Google Analytics 4 helps us understand which pages, searches and offers are most useful. Google Analytics is not loaded until you accept.",
    accept: "Accept analytics",
    reject: "Reject analytics",
    more: "More information",
    accepted: "Accepted",
    rejected: "Rejected",
    undecided: "Not selected"
  }
};

let activeConsent = null;

function isProductionHost() {
  if (typeof window === "undefined") return false;
  return PRODUCTION_HOSTS.has(String(window.location.hostname || "").toLowerCase());
}

function languageCopy() {
  const language = String(document.documentElement.lang || "es").toLowerCase();
  if (language.startsWith("pt")) return COPY.pt;
  if (language.startsWith("en")) return COPY.en;
  return COPY.es;
}

function ensureGtag() {
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };
  return window.gtag;
}

function readStoredConsent() {
  try {
    const value = localStorage.getItem(CONSENT_STORAGE_KEY);
    return ["accepted", "rejected"].includes(value) ? value : null;
  } catch {
    return null;
  }
}

function storeConsent(value) {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, value);
  } catch {}
}

function consentPayload(value) {
  return {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: value === "accepted" ? "granted" : "denied"
  };
}

function configureGoogleTag() {
  if (window[GOOGLE_TAG_CONFIGURED_KEY]) return;
  const gtag = ensureGtag();
  gtag("js", new Date());
  gtag("config", GOOGLE_ANALYTICS_ID, {
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_flags: "SameSite=Lax;Secure",
    send_page_view: true
  });
  window[GOOGLE_TAG_CONFIGURED_KEY] = true;
}

function loadGoogleTag() {
  const existing = document.getElementById(GOOGLE_TAG_SCRIPT_ID)
    || document.querySelector(`script[src*="googletagmanager.com/gtag/js"][src*="${GOOGLE_ANALYTICS_ID}"]`);

  if (!existing) {
    const script = document.createElement("script");
    script.id = GOOGLE_TAG_SCRIPT_ID;
    script.async = true;
    script.src = GOOGLE_TAG_URL;
    document.head.append(script);
  }

  configureGoogleTag();
  return Boolean(existing);
}

function deleteGoogleAnalyticsCookies() {
  const hostname = String(location.hostname || "").replace(/^www\./, "");
  const cookies = String(document.cookie || "")
    .split(";")
    .map((part) => part.trim().split("=")[0])
    .filter((name) => name === "_ga" || name.startsWith("_ga_"));

  for (const name of cookies) {
    document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
    if (hostname) {
      document.cookie = `${name}=; Max-Age=0; path=/; domain=.${hostname}; SameSite=Lax`;
    }
  }
}

function installConsentStyles() {
  if (document.getElementById(CONSENT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = CONSENT_STYLE_ID;
  style.textContent = `
    .ss-ga4-consent {
      position: fixed;
      z-index: 2147483000;
      right: max(14px, env(safe-area-inset-right));
      bottom: max(14px, env(safe-area-inset-bottom));
      left: max(14px, env(safe-area-inset-left));
      display: flex;
      justify-content: center;
      pointer-events: none;
    }
    .ss-ga4-consent__panel {
      width: min(760px, 100%);
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 20px;
      border: 1px solid var(--line, #d9d3c8);
      border-radius: 18px;
      background: var(--surface, #fff);
      box-shadow: 0 20px 55px rgb(0 0 0 / 22%);
      padding: 20px;
      color: var(--text, #262626);
      pointer-events: auto;
    }
    .ss-ga4-consent__copy h2 {
      margin: 0 0 7px;
      color: var(--text-strong, #111);
      font-size: 1rem;
      line-height: 1.3;
    }
    .ss-ga4-consent__copy p {
      margin: 0;
      color: var(--muted, #5f5f5f);
      font-size: .78rem;
      line-height: 1.55;
    }
    .ss-ga4-consent__copy a {
      color: var(--primary, #705b00);
      font-weight: 750;
    }
    .ss-ga4-consent__actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 9px;
      min-width: 275px;
    }
    .ss-ga4-consent__button {
      min-height: 44px;
      border: 1px solid var(--line, #d9d3c8);
      border-radius: 12px;
      padding: 10px 14px;
      font: inherit;
      font-size: .76rem;
      font-weight: 800;
      cursor: pointer;
    }
    .ss-ga4-consent__button--reject {
      background: var(--surface, #fff);
      color: var(--text-strong, #111);
    }
    .ss-ga4-consent__button--accept {
      border-color: var(--action-bg, #1f1f1f);
      background: var(--action-bg, #1f1f1f);
      color: var(--on-action, #fee97d);
    }
    .ss-ga4-consent__button:focus-visible,
    [data-analytics-consent-settings]:focus-visible {
      outline: 3px solid var(--primary, #705b00);
      outline-offset: 3px;
    }
    @media (max-width: 820px) {
      .ss-ga4-consent {
        bottom: calc(76px + env(safe-area-inset-bottom));
      }
    }
    @media (max-width: 660px) {
      .ss-ga4-consent__panel {
        grid-template-columns: 1fr;
        gap: 15px;
        border-radius: 16px;
        padding: 17px;
      }
      .ss-ga4-consent__actions {
        min-width: 0;
      }
    }
    @media (max-width: 390px) {
      .ss-ga4-consent__actions {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.append(style);
}

function removeConsentBanner() {
  document.getElementById(CONSENT_BANNER_ID)?.remove();
}

function renderConsentStatus() {
  const copy = languageCopy();
  const label = activeConsent === "accepted"
    ? copy.accepted
    : activeConsent === "rejected"
      ? copy.rejected
      : copy.undecided;
  document.querySelectorAll("[data-analytics-consent-status]").forEach((node) => {
    node.textContent = label;
  });
}

function showConsentBanner({ focus = false } = {}) {
  installConsentStyles();
  removeConsentBanner();
  const copy = languageCopy();
  const banner = document.createElement("section");
  banner.id = CONSENT_BANNER_ID;
  banner.className = "ss-ga4-consent";
  banner.setAttribute("role", "region");
  banner.setAttribute("aria-labelledby", `${CONSENT_BANNER_ID}-title`);
  banner.innerHTML = `
    <div class="ss-ga4-consent__panel">
      <div class="ss-ga4-consent__copy">
        <h2 id="${CONSENT_BANNER_ID}-title">${copy.title}</h2>
        <p>${copy.text} <a href="/privacidad.html">${copy.more}</a>.</p>
      </div>
      <div class="ss-ga4-consent__actions">
        <button class="ss-ga4-consent__button ss-ga4-consent__button--reject" type="button" data-ga4-consent="rejected">${copy.reject}</button>
        <button class="ss-ga4-consent__button ss-ga4-consent__button--accept" type="button" data-ga4-consent="accepted">${copy.accept}</button>
      </div>
    </div>
  `;
  document.body.append(banner);
  if (focus) banner.querySelector("[data-ga4-consent]")?.focus();
}

function sendEvent(name, parameters = {}) {
  if (activeConsent !== "accepted" || window[GOOGLE_ANALYTICS_DISABLE_KEY]) return;
  ensureGtag()("event", name, parameters);
}

function setConsent(value) {
  activeConsent = value;
  storeConsent(value);
  const gtag = ensureGtag();
  window[GOOGLE_ANALYTICS_DISABLE_KEY] = value !== "accepted";
  gtag("consent", "update", consentPayload(value));

  if (value === "accepted") {
    const wasAlreadyLoaded = loadGoogleTag();
    if (wasAlreadyLoaded) {
      sendEvent("page_view", {
        page_location: location.href,
        page_title: document.title
      });
    }
  } else {
    deleteGoogleAnalyticsCookies();
  }

  removeConsentBanner();
  renderConsentStatus();
}

function wireConsentControls() {
  document.addEventListener("click", (event) => {
    const decision = event.target.closest?.("[data-ga4-consent]")?.dataset.ga4Consent;
    if (["accepted", "rejected"].includes(decision)) {
      setConsent(decision);
      return;
    }

    const settings = event.target.closest?.("[data-analytics-consent-settings]");
    if (settings) {
      event.preventDefault();
      showConsentBanner({ focus: true });
    }
  });
}

function wireAnalyticsEvents() {
  document.addEventListener("submit", (event) => {
    const form = event.target.closest?.("[data-search-form]");
    const term = form?.querySelector("[data-search-input]")?.value?.trim();
    if (!term) return;
    sendEvent("search", {
      search_term: term.slice(0, 100)
    });
  }, true);

  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href]");
    if (!link) return;
    try {
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin || url.pathname !== "/go.html") return;
      const offerId = String(url.searchParams.get("offer") || "").slice(0, 100);
      const region = String(url.searchParams.get("region") || "").slice(0, 10);
      const merchantId = offerId.split(":")[0].slice(0, 40);
      sendEvent("affiliate_click", {
        offer_id: offerId,
        merchant_id: merchantId,
        region,
        transport_type: "beacon"
      });
    } catch {}
  }, true);
}

function initializeGoogleAnalytics() {
  activeConsent = readStoredConsent();
  const gtag = ensureGtag();
  window[GOOGLE_ANALYTICS_DISABLE_KEY] = activeConsent !== "accepted";
  gtag("consent", "default", consentPayload(activeConsent));
  gtag("set", "ads_data_redaction", true);

  wireConsentControls();
  wireAnalyticsEvents();

  if (activeConsent === "accepted") loadGoogleTag();

  const render = () => {
    renderConsentStatus();
    if (!activeConsent) showConsentBanner();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render, { once: true });
  } else {
    render();
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined" && isProductionHost()) {
  initializeGoogleAnalytics();
}
