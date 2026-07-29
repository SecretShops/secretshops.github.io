import "./cloudflare-analytics.js";
import "./google-analytics.js";
import { displayOfferPrice, offerTotal } from "./catalog-core.js";
import { applyStaticLocale, createTranslator } from "./i18n.js";
import { offerRedirectPath, publicAssetUrl } from "./region-core.js";
import {
  buildVariantPresentation,
  chooseVariantForAttribute,
  variantLabels,
  variantValueAvailable
} from "./variant-system.js";

const themeKey = "secretshop:theme:v1";
const locale = document.documentElement.lang || "es-ES";
const regionId = document.documentElement.dataset.region || "es";
const t = createTranslator(locale);
applyStaticLocale(locale);

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
    localStorage.setItem(themeKey, next);
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
  if (!product || product.dataset.simplified === "true") return null;
  product.dataset.simplified = "true";
  product.classList.add("standalone-product-simplified");

  const content = product.querySelector(".standalone-product-content");
  const title = content?.querySelector("h1");
  const mediaImage = product.querySelector(".standalone-product-media img");
  if (!content || !title) return null;

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

  let buySummary = null;
  if (bestOffer) {
    const merchant = bestOffer.querySelector(":scope > div > strong")?.textContent?.trim() || "";
    const price = bestOffer.querySelector(":scope > strong")?.textContent?.trim() || "";
    const sourceLink = bestOffer.querySelector(".offer-link");
    buySummary = createProductElement("section", "product-buy-summary");
    buySummary.setAttribute("aria-label", t("bestPrice"));

    const copy = createProductElement("div", "product-buy-copy");
    copy.append(
      createProductElement("span", "product-buy-label", t("bestPrice")),
      createProductElement("strong", "product-buy-price", price),
      createProductElement("span", "product-buy-store", merchant)
    );
    buySummary.append(copy);

    if (sourceLink) {
      const link = sourceLink.cloneNode(true);
      link.classList.add("product-buy-cta");
      link.textContent = t("viewStoreOffer");
      buySummary.append(link);
    }
    title.insertAdjacentElement("afterend", buySummary);
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

  let fallbackOptions = null;
  if (optionsSection) {
    const { details, body } = productAccordion(t("productOptions"));
    details.dataset.variantFallback = "true";
    const variants = optionsSection.querySelector(".variant-list");
    if (variants) body.append(variants);
    optionsSection.replaceWith(details);
    fallbackOptions = details;
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

  return {
    product,
    content,
    title,
    mediaImage,
    buySummary,
    offersSection,
    fallbackOptions,
    family: null,
    presentation: null
  };
}

function familyIdFromPage(product) {
  const explicit = product?.dataset.familyId?.trim();
  if (explicit) return explicit;
  const segment = location.pathname.split("/").filter(Boolean).at(-1) || "";
  const separator = segment.lastIndexOf("--");
  return separator >= 0 ? decodeURIComponent(segment.slice(separator + 2)) : "";
}

function variantShard(id) {
  let result = 2166136261;
  for (const character of String(id)) {
    result ^= character.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return ((result >>> 0) % 32).toString(16).padStart(2, "0");
}

async function loadVariantFamily(id) {
  if (!id) return null;
  const response = await fetch(`/data/catalog/variant-index/${variantShard(id)}.json`, {
    cache: "force-cache",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload?.families?.[id] || null;
}

function sortedOffers(variant) {
  return [...(variant?.offers || [])].sort((left, right) =>
    (offerTotal(left) ?? Infinity) - (offerTotal(right) ?? Infinity)
  );
}

function updateBuySummary(context, variant) {
  const offers = sortedOffers(variant);
  const best = offers[0];
  if (!best) {
    context.buySummary?.remove();
    context.buySummary = null;
    return;
  }

  if (!context.buySummary) {
    context.buySummary = createProductElement("section", "product-buy-summary");
    context.buySummary.setAttribute("aria-label", t("bestPrice"));
    context.title.insertAdjacentElement("afterend", context.buySummary);
  }

  context.buySummary.replaceChildren();
  const copy = createProductElement("div", "product-buy-copy");
  copy.append(
    createProductElement("span", "product-buy-label", t("bestPrice")),
    createProductElement("strong", "product-buy-price", displayOfferPrice(best)),
    createProductElement("span", "product-buy-store", best.merchantName || "")
  );

  const link = createProductElement("a", "offer-link product-buy-cta", t("viewStoreOffer"));
  link.href = offerRedirectPath(regionId, best.id);
  link.target = "_blank";
  link.rel = "nofollow sponsored noopener";
  link.dataset.outboundOffer = best.id;
  context.buySummary.append(copy, link);
}

function createStaticVariantConfigurator(context) {
  const presentation = context.presentation;
  if (!presentation) return null;
  const labels = variantLabels(locale);
  const groups = presentation.groups || [];
  const availableSizes = presentation.availableSizes || [];
  if (!groups.length && !availableSizes.length) return null;

  const section = createProductElement("section", "product-variant-configurator");
  section.dataset.staticVariantConfigurator = "true";
  section.setAttribute("aria-label", labels.choose);

  groups.forEach((group) => {
    if (group.type === "select") {
      const wrapper = createProductElement("div", "variant-attribute-group");
      wrapper.dataset.variantGroup = group.key;
      const label = createProductElement("label", "", group.label);
      const select = createProductElement("select", "");
      const id = `static-variant-${group.key}`;
      label.htmlFor = id;
      select.id = id;
      select.dataset.staticVariantSelect = group.key;
      group.values.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.value;
        option.selected = item.selected;
        option.disabled = !variantValueAvailable(presentation, group.key, item.value);
        select.append(option);
      });
      wrapper.append(label, select);
      section.append(wrapper);
      return;
    }

    const fieldset = createProductElement("fieldset", "variant-attribute-group");
    fieldset.dataset.variantGroup = group.key;
    fieldset.append(createProductElement("legend", "", group.label));
    const list = createProductElement(
      "div",
      `variant-option-list${group.type === "visual" ? " is-visual" : ""}`
    );

    group.values.forEach((item) => {
      const button = createProductElement(
        "button",
        `variant-option${group.type === "visual" ? " is-visual" : ""}${item.selected ? " is-selected" : ""}`
      );
      button.type = "button";
      button.dataset.staticVariantAttribute = group.key;
      button.dataset.variantValue = item.value;
      button.setAttribute("aria-pressed", item.selected ? "true" : "false");
      button.disabled = !variantValueAvailable(presentation, group.key, item.value);

      if (group.type === "visual") {
        const visual = createProductElement("span", "variant-option-visual");
        if (item.swatch) visual.style.setProperty("--variant-swatch", item.swatch);
        if (item.image) {
          const image = document.createElement("img");
          image.src = publicAssetUrl(item.image);
          image.alt = "";
          image.loading = "lazy";
          visual.append(image);
        }
        button.append(visual);
      }
      button.append(createProductElement("span", "", item.value));
      list.append(button);
    });
    fieldset.append(list);
    section.append(fieldset);
  });

  if (availableSizes.length) {
    const wrapper = createProductElement("div", "variant-attribute-group is-informational");
    wrapper.append(createProductElement("span", "variant-group-label", labels.availableSizes));
    const list = createProductElement("div", "variant-option-list");
    availableSizes.forEach((size) => {
      list.append(createProductElement("span", "variant-option is-information", size));
    });
    wrapper.append(list);
    section.append(wrapper);
  }

  return section;
}

function updateVariantConfigurator(context) {
  context.content.querySelector("[data-static-variant-configurator]")?.remove();
  const configurator = createStaticVariantConfigurator(context);
  if (!configurator) return;
  context.fallbackOptions?.remove();
  context.fallbackOptions = null;
  context.buySummary?.insertAdjacentElement("afterend", configurator);
}

function createStandaloneOffer(offer, index) {
  const article = createProductElement(
    "article",
    `standalone-offer${index === 0 ? " is-best" : ""}`
  );
  const store = createProductElement("div", "");
  store.append(createProductElement("strong", "", offer.merchantName || ""));
  if (index === 0) store.append(createProductElement("span", "score", t("bestPrice")));
  const price = createProductElement("strong", "", displayOfferPrice(offer));
  const link = createProductElement("a", "offer-link", t("viewStoreOffer"));
  link.href = offerRedirectPath(regionId, offer.id);
  link.target = "_blank";
  link.rel = "nofollow sponsored noopener";
  link.dataset.outboundOffer = offer.id;
  article.append(store, price, link);
  return article;
}

function updateOffers(context, variant) {
  if (!context.offersSection) return;
  const offers = sortedOffers(variant);
  const list = context.offersSection.querySelector(".standalone-offers");
  if (!list) return;
  list.replaceChildren(...offers.map(createStandaloneOffer));
  context.offersSection.hidden = offers.length <= 1;
}

function renderStandaloneVariant(context, preferredVariantId = null) {
  context.presentation = buildVariantPresentation(
    context.family,
    preferredVariantId,
    locale
  );
  const variant = context.presentation.selected;
  if (!variant) return;

  const image = variant.images?.[0] || context.family.image || context.family.images?.[0];
  if (context.mediaImage && image) context.mediaImage.src = publicAssetUrl(image);
  updateBuySummary(context, variant);
  updateVariantConfigurator(context);
  updateOffers(context, variant);
}

async function enhanceStandaloneVariants(context) {
  if (!context) return;
  const familyId = familyIdFromPage(context.product);
  const family = await loadVariantFamily(familyId);
  if (!family) return;
  context.family = family;
  renderStandaloneVariant(context, family.variants?.[0]?.id || null);

  context.content.addEventListener("click", (event) => {
    const button = event.target.closest("[data-static-variant-attribute]");
    if (!button || !context.presentation) return;
    const next = chooseVariantForAttribute(
      context.presentation,
      button.dataset.staticVariantAttribute,
      button.dataset.variantValue
    );
    if (next) renderStandaloneVariant(context, next.id);
  });

  context.content.addEventListener("change", (event) => {
    const select = event.target.closest("[data-static-variant-select]");
    if (!select || !context.presentation) return;
    const next = chooseVariantForAttribute(
      context.presentation,
      select.dataset.staticVariantSelect,
      select.value
    );
    if (next) renderStandaloneVariant(context, next.id);
  });
}

const standaloneContext = enhanceStandaloneProduct();
enhanceStandaloneVariants(standaloneContext).catch(() => {
  // La ficha estática simplificada sigue siendo utilizable si falla el índice.
});
