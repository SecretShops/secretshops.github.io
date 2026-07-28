import "./cloudflare-analytics.js";
import "./google-analytics.js";
import { applyStaticLocale, createTranslator } from "./i18n.js";

const key = "secretshop:theme:v1";
const t = createTranslator(document.documentElement.lang);
applyStaticLocale(document.documentElement.lang);

function renderTheme() {
  const dark = document.documentElement.dataset.theme === "dark";
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.textContent = dark ? `☀ ${t("light")}` : `◐ ${t("darkMode")}`;
    button.setAttribute("aria-label", dark ? t("activateLight") : t("activateDark"));
  });
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#09181c" : "#f7f2e8";
}

document.addEventListener("click", (event) => {
  if (!event.target.closest("[data-theme-toggle]")) return;
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(key, next);
  } catch {}
  renderTheme();
});

document.querySelectorAll("[data-current-year]").forEach((node) => {
  node.textContent = String(new Date().getFullYear());
});

document.addEventListener("error", (event) => {
  const image = event.target.closest?.(
    ".standalone-product img, .category-card img, .store-card img"
  );
  if (!image || image.dataset.fallbackApplied) return;
  image.dataset.fallbackApplied = "true";
  image.src = "/assets/brand/product-placeholder.svg";
}, true);

renderTheme();
