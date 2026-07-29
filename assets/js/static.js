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

function createProductElement(tag, className, text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function conciseProductText(value, maximum = 190) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maximum) return text;
  const sentence = text.slice(0, maximum + 1).match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  const base = sentence && sentence.length >= 70
    ? sentence
    : text.slice(0, maximum).replace(/\s+\S*$/, "").trim();
  return `${base}…`;
}

function productAccordion(label, bodyClass = "") {
  const details = createProductElement("details", "product-accordion");
  const summary = createProductElement("summary", "", label);
  const body = createProductElement(
    "div",
    `product-accordion-body${bodyClass ? ` ${bodyClass}` : ""}`
  );
  details.append(summary, body);
  return { details, body };
}

function enhanceStandaloneProduct() {
  const product = document.querySelector(".standalone-product");
  if (!product || product.dataset.simplified === "true") return;
  product.dataset.simplified = "true";
  product.classList.add("standalone-product-simplified");

  const content = product.querySelector(".standalone-product-content");
  const title = content?.querySelector("h1");
  if (!content || !title) return;

  content.querySelector(":scope > .eyebrow")?.remove();
  content.querySelector(":scope > .detail-summary")?.remove();

  const sections = [...content.querySelectorAll(":scope > .detail-section")];
  const optionsSection = sections.find((section) => section.querySelector("#opciones"));
  const offersSection = sections.find((section) => section.querySelector("#ofertas"));
  const offers = offersSection
    ? [...offersSection.querySelectorAll(".standalone-offer")]
    : [];
  const bestOffer = offers[0];
  const disclosure = offersSection?.querySelector(".detail-disclosure");
  const disclosureText = disclosure?.textContent?.trim() || "";
  disclosure?.remove();

  if (bestOffer) {
    const merchant = bestOffer.querySelector(":scope > div > strong")?.textContent?.trim() || "";
    const price = bestOffer.querySelector(":scope > strong")?.textContent?.trim() || "";
    const sourceLink = bestOffer.querySelector(".offer-link");
    const summary = createProductElement("section", "product-buy-summary");
    summary.setAttribute("aria-label", t("bestPrice"));

    const copy = createProductElement("div", "product-buy-copy");
    copy.append(
      createProductElement("span", "product-buy-label", t("bestPrice")),
      createProductElement("strong", "product-buy-price", price),
      createProductElement("span", "product-buy-store", merchant)
    );
    summary.append(copy);

    if (sourceLink) {
      const link = sourceLink.cloneNode(true);
      link.classList.add("product-buy-cta");
      link.textContent = t("viewStoreOffer");
      summary.append(link);
    }
    title.insertAdjacentElement("afterend", summary);
  }

  const description = content.querySelector(":scope > .detail-description");
  if (description) {
    const fullDescription = description.textContent.trim();
    const preview = conciseProductText(fullDescription);
    description.classList.add("product-description-preview");
    description.textContent = preview;
    if (preview !== fullDescription) {
      const { details, body } = productAccordion(t("fullDescription"));
      body.append(createProductElement("p", "", fullDescription));
      description.insertAdjacentElement("afterend", details);
    }
  }

  if (optionsSection) {
    const { details, body } = productAccordion(t("productOptions"));
    const variants = optionsSection.querySelector(".variant-list");
    if (variants) body.append(variants);
    optionsSection.replaceWith(details);
  }

  if (offersSection) {
    const heading = offersSection.querySelector("h2");
    if (heading) heading.textContent = t("whereToBuy");
    offersSection.querySelector(".detail-section-head > span")?.remove();
    offersSection.classList.add("product-offers-section");
    offers.forEach((offer, index) => {
      offer.classList.toggle("is-best", index === 0);
      offer.querySelector(".score")?.remove();
    });
    if (offers.length <= 1) offersSection.hidden = true;
  }

  if (disclosureText) {
    const { details, body } = productAccordion(t("moreInformation"), "product-secondary-information");
    body.append(createProductElement("p", "detail-disclosure", disclosureText));
    if (offersSection) offersSection.insertAdjacentElement("afterend", details);
    else content.append(details);
  }
}

enhanceStandaloneProduct();
