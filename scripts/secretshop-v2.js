(() => {
  "use strict";

  const app = document.getElementById("v2-app");
  if (!app) return;

  const state = {
    query: "",
    category: "Todas",
    store: "Todas",
    sort: "relevance",
    visible: 24,
    favorites: new Set(JSON.parse(localStorage.getItem("secretshop-favorites") || "[]")),
    selectedFamily: null,
    selectedVariant: null,
    drawerOpen: false
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function text(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function getCategories(product) {
    const values = Array.isArray(product.categories)
      ? product.categories
      : product.category ? [product.category] : [];
    return [...new Set(values.filter(Boolean).map(String))];
  }

  function getBrand(product) {
    if (product.brand) return String(product.brand).trim();
    const name = String(product.name || "").trim();
    const first = name.split(/\s+/)[0] || "Producto";
    if (/^(nuevo|nueva|para|con|set|pack|kit|mini|original)$/i.test(first)) return "Selección SecretShop";
    return first.replace(/[,:;].*$/, "");
  }

  function parsePrice(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const raw = String(value || "").replace(/\s/g, "");
    const matches = raw.match(/\d[\d.,]*/g);
    if (!matches) return null;
    let token = matches[0];
    const lastComma = token.lastIndexOf(",");
    const lastDot = token.lastIndexOf(".");
    if (lastComma > lastDot) token = token.replace(/\./g, "").replace(",", ".");
    else token = token.replace(/,/g, "");
    const number = Number(token);
    return Number.isFinite(number) ? number : null;
  }

  function displayPrice(offer) {
    const snapshot = offer?.priceSnapshot;
    if (snapshot && /\d/.test(String(snapshot))) return String(snapshot);
    const value = offer?.price;
    if (value && /\d/.test(String(value))) return String(value);
    return "Ver precio actual";
  }

  function offerKey(offer) {
    return [offer?.store, offer?.country, offer?.url].map(String).join("|");
  }

  function uniqueOffers(offers) {
    const map = new Map();
    (offers || []).forEach((offer) => {
      if (!offer || !offer.url) return;
      map.set(offerKey(offer), offer);
    });
    return [...map.values()];
  }

  function variantLabel(product) {
    if (product.variantLabel) return String(product.variantLabel);
    if (product.variantName) return String(product.variantName);
    if (product.variantKey && product.variantKey !== "default") return String(product.variantKey).replace(/[|:_-]+/g, " · ");
    const attrs = product.attributes || product.specifications || {};
    const picked = ["color", "size", "capacity", "storage", "version", "model"]
      .map((key) => attrs[key] || attrs[key[0].toUpperCase() + key.slice(1)])
      .filter(Boolean)
      .slice(0, 3);
    return picked.length ? picked.join(" · ") : "Modelo estándar";
  }

  function familyKey(product) {
    if (product.comparisonId && (product.comparisonConfirmed === true || product.comparisonStatus === "confirmed")) {
      return `confirmed:${String(product.comparisonId).trim()}`;
    }
    const exact = normalize(product.name);
    if (exact) return `exact:${exact}`;
    return `product:${product.id}`;
  }

  function variantKey(product) {
    if (product.variantKey) return String(product.variantKey);
    return normalize(variantLabel(product)) || "default";
  }

  function buildFamilies(products) {
    const families = new Map();
    (Array.isArray(products) ? products : []).forEach((product) => {
      if (!product || !product.name || !Array.isArray(product.offers) || !product.offers.length) return;
      const key = familyKey(product);
      let family = families.get(key);
      if (!family) {
        family = {
          id: key,
          name: product.comparisonName || product.name,
          description: product.comparisonDescription || product.description || "",
          image: product.comparisonImage || product.image || "",
          brand: getBrand(product),
          categories: new Set(getCategories(product)),
          featured: Boolean(product.featured),
          secretScore: Number.isFinite(Number(product.secretScore)) ? Number(product.secretScore) : null,
          rating: Number.isFinite(Number(product.rating)) ? Number(product.rating) : null,
          ratingCount: Number(product.ratingCount || 0),
          variants: new Map(),
          createdAt: product.createdAt || "1970-01-01"
        };
        families.set(key, family);
      } else {
        getCategories(product).forEach((category) => family.categories.add(category));
        family.featured ||= Boolean(product.featured);
        if (!family.image && product.image) family.image = product.image;
      }
      const vKey = variantKey(product);
      const current = family.variants.get(vKey);
      if (current) {
        current.offers = uniqueOffers([...current.offers, ...product.offers]);
        current.sourceIds.push(product.id);
      } else {
        family.variants.set(vKey, {
          id: vKey,
          label: variantLabel(product),
          image: product.image || family.image,
          description: product.description || family.description,
          attributes: product.attributes || product.specifications || {},
          offers: uniqueOffers(product.offers),
          sourceIds: [product.id]
        });
      }
    });

    return [...families.values()].map((family) => {
      family.categories = [...family.categories];
      family.variants = [...family.variants.values()];
      family.offers = uniqueOffers(family.variants.flatMap((variant) => variant.offers));
      family.stores = [...new Set(family.offers.map((offer) => offer.store).filter(Boolean))];
      family.minPrice = family.offers.reduce((min, offer) => {
        const price = parsePrice(offer.priceSnapshot || offer.price);
        return price == null ? min : Math.min(min, price);
      }, Infinity);
      if (!Number.isFinite(family.minPrice)) family.minPrice = null;
      return family;
    });
  }

  function catalogSource() {
    try {
      return typeof CATALOG !== "undefined" && Array.isArray(CATALOG) ? CATALOG : [];
    } catch {
      return [];
    }
  }

  let families = buildFamilies(catalogSource());

  function filteredFamilies() {
    const query = normalize(state.query);
    const output = families.filter((family) => {
      if (state.category !== "Todas" && !family.categories.includes(state.category)) return false;
      if (state.store !== "Todas" && !family.stores.includes(state.store)) return false;
      if (!query) return true;
      const haystack = normalize([
        family.name,
        family.brand,
        family.description,
        family.categories.join(" "),
        family.stores.join(" "),
        family.variants.map((variant) => variant.label).join(" ")
      ].join(" "));
      return query.split(" ").every((token) => haystack.includes(token));
    });

    if (state.sort === "price-asc") output.sort((a, b) => (a.minPrice ?? Infinity) - (b.minPrice ?? Infinity));
    if (state.sort === "stores") output.sort((a, b) => b.stores.length - a.stores.length);
    if (state.sort === "newest") output.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (state.sort === "relevance") output.sort((a, b) => Number(b.featured) - Number(a.featured) || b.offers.length - a.offers.length);
    return output;
  }

  function scoreMarkup(family) {
    if (family.secretScore != null) return `<span class="v2-score">SecretScore ${text(family.secretScore.toFixed(1))}</span>`;
    if (family.rating != null) return `<span class="v2-rating" aria-label="Valoración ${text(family.rating)} sobre 5">★ ${text(family.rating.toFixed(1))}${family.ratingCount ? ` <small>(${text(family.ratingCount)})</small>` : ""}</span>`;
    return "";
  }

  function lowestOffer(family) {
    return family.offers.reduce((best, offer) => {
      if (!best) return offer;
      const current = parsePrice(offer.priceSnapshot || offer.price);
      const previous = parsePrice(best.priceSnapshot || best.price);
      if (current == null) return best;
      if (previous == null || current < previous) return offer;
      return best;
    }, null);
  }

  function cardMarkup(family) {
    const offer = lowestOffer(family);
    const variantCount = family.variants.length;
    const isFavorite = state.favorites.has(family.id);
    return `
      <article class="v2-product-card" data-family-id="${text(family.id)}" tabindex="0" aria-label="Ver ${text(family.name)}">
        <div class="v2-card-image-wrap">
          ${family.featured ? '<span class="v2-badge">Destacado</span>' : ""}
          <button class="v2-favorite ${isFavorite ? "is-active" : ""}" type="button" aria-label="${isFavorite ? "Quitar de favoritos" : "Guardar en favoritos"}" data-favorite="${text(family.id)}">${isFavorite ? "♥" : "♡"}</button>
          <img class="v2-card-image" src="${text(family.image)}" alt="${text(family.name)}" loading="lazy" onerror="this.closest('.v2-card-image-wrap').classList.add('image-error');this.remove();">
        </div>
        <div class="v2-card-body">
          <p class="v2-eyebrow">${text(family.categories[0] || "Producto")} · ${text(family.brand)}</p>
          <h3>${text(family.name)}</h3>
          <div class="v2-card-rating">${scoreMarkup(family)}</div>
          <p class="v2-variant-summary">${variantCount > 1 ? `${text(variantCount)} variantes disponibles` : text(family.variants[0]?.label || "Modelo estándar")}</p>
          <div class="v2-price-block">
            <span class="v2-price-label">Desde</span>
            <strong>${text(displayPrice(offer))}</strong>
          </div>
          <p class="v2-store-summary">${text(family.stores.length)} ${family.stores.length === 1 ? "tienda" : "tiendas"}${family.offers.length > family.stores.length ? ` · ${text(family.offers.length)} ofertas` : ""}</p>
          <p class="v2-availability"><span></span> Disponible para comparar</p>
          <button class="v2-card-cta" type="button" data-open-family="${text(family.id)}">Comparar precios</button>
        </div>
      </article>`;
  }

  function renderFilters() {
    const categories = [...new Set(families.flatMap((family) => family.categories))].sort((a, b) => a.localeCompare(b, "es"));
    const stores = [...new Set(families.flatMap((family) => family.stores))].sort((a, b) => a.localeCompare(b, "es"));
    const categoryOptions = ["Todas", ...categories].map((value) => `<option ${state.category === value ? "selected" : ""}>${text(value)}</option>`).join("");
    const storeOptions = ["Todas", ...stores].map((value) => `<option ${state.store === value ? "selected" : ""}>${text(value)}</option>`).join("");
    $$("[data-category-select]").forEach((select) => select.innerHTML = categoryOptions);
    $$("[data-store-select]").forEach((select) => select.innerHTML = storeOptions);
  }

  function renderCatalog() {
    const results = filteredFamilies();
    const visible = results.slice(0, state.visible);
    $("#v2-results-count").textContent = `${results.length.toLocaleString("es-ES")} familias de producto`;
    $("#v2-grid").innerHTML = visible.map(cardMarkup).join("") || `<div class="v2-empty"><strong>No hemos encontrado productos.</strong><span>Prueba con otra búsqueda, categoría o tienda.</span></div>`;
    const load = $("#v2-load-more");
    load.hidden = visible.length >= results.length;
    load.textContent = `Ver más productos (${Math.max(0, results.length - visible.length).toLocaleString("es-ES")})`;
  }

  function renderCategoryStrip() {
    const counts = new Map();
    families.forEach((family) => family.categories.forEach((category) => counts.set(category, (counts.get(category) || 0) + 1)));
    const categories = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    $("#v2-category-strip").innerHTML = categories.map(([category, count]) => `
      <button class="v2-category-tile" type="button" data-category="${text(category)}">
        <span class="v2-category-icon">${text(category.charAt(0).toUpperCase())}</span>
        <strong>${text(category)}</strong>
        <small>${text(count.toLocaleString("es-ES"))} productos</small>
      </button>`).join("");
  }

  function renderHighlights() {
    const featured = [...families].sort((a, b) => Number(b.featured) - Number(a.featured) || b.offers.length - a.offers.length).slice(0, 4);
    $("#v2-featured-grid").innerHTML = featured.map(cardMarkup).join("");
    const deals = families.filter((family) => family.minPrice != null).sort((a, b) => a.minPrice - b.minPrice).slice(0, 4);
    $("#v2-deals-grid").innerHTML = deals.map(cardMarkup).join("");

    const mosaic = featured.slice(0, 4);
    $("#v2-hero-mosaic").innerHTML = mosaic.map((family) => `
      <button type="button" class="v2-mosaic-card" data-open-family="${text(family.id)}" aria-label="Ver ${text(family.name)}">
        <img src="${text(family.image)}" alt="" loading="eager">
        <span>${text(family.categories[0] || family.brand)}</span>
      </button>`).join("");
  }

  function renderVariantModal(familyId, preferredVariantId) {
    const family = families.find((item) => item.id === familyId);
    if (!family) return;
    state.selectedFamily = family.id;
    const selected = family.variants.find((variant) => variant.id === preferredVariantId) || family.variants[0];
    state.selectedVariant = selected.id;
    const visibleVariants = family.variants.slice(0, 6);
    const hiddenVariants = family.variants.slice(6);
    const offers = [...selected.offers].sort((a, b) => {
      const pa = parsePrice(a.priceSnapshot || a.price) ?? Infinity;
      const pb = parsePrice(b.priceSnapshot || b.price) ?? Infinity;
      return pa - pb;
    });

    $("#v2-product-dialog-content").innerHTML = `
      <button class="v2-dialog-close" type="button" data-close-dialog aria-label="Cerrar">×</button>
      <div class="v2-detail-layout">
        <div class="v2-detail-media"><img src="${text(selected.image || family.image)}" alt="${text(family.name)}"></div>
        <div class="v2-detail-main">
          <p class="v2-eyebrow">${text(family.categories.join(" · "))}</p>
          <h2>${text(family.name)}</h2>
          ${scoreMarkup(family)}
          <p class="v2-detail-description">${text(selected.description || family.description)}</p>
          <section class="v2-variant-section" aria-labelledby="variant-heading">
            <div class="v2-detail-section-heading"><h3 id="variant-heading">Elige una variante</h3><span>${text(family.variants.length)} disponibles</span></div>
            <div class="v2-variant-list">
              ${visibleVariants.map((variant) => `<button type="button" class="v2-variant-chip ${variant.id === selected.id ? "is-selected" : ""}" data-variant="${text(variant.id)}">${text(variant.label)}</button>`).join("")}
              ${hiddenVariants.length ? `<div class="v2-hidden-variants" hidden>${hiddenVariants.map((variant) => `<button type="button" class="v2-variant-chip ${variant.id === selected.id ? "is-selected" : ""}" data-variant="${text(variant.id)}">${text(variant.label)}</button>`).join("")}</div><button class="v2-more-variants" type="button" data-more-variants>Ver ${text(hiddenVariants.length)} variantes más</button>` : ""}
            </div>
          </section>
          <section class="v2-offers-section" aria-labelledby="offers-heading">
            <div class="v2-detail-section-heading"><h3 id="offers-heading">Compara precios</h3><span>${text(offers.length)} ofertas</span></div>
            <div class="v2-offer-list">
              ${offers.map((offer, index) => `<article class="v2-offer-row ${index === 0 ? "is-best" : ""}">
                <div><strong>${text(offer.store || "Tienda")}</strong><small>${text(offer.country || "Disponible")}${index === 0 ? " · Mejor precio detectado" : ""}</small></div>
                <div class="v2-offer-price"><strong>${text(displayPrice(offer))}</strong><span>Precio final en tienda</span></div>
                <a href="${text(offer.url)}" target="_blank" rel="nofollow sponsored noopener">Ver oferta</a>
              </article>`).join("")}
            </div>
          </section>
        </div>
      </div>`;
    const dialog = $("#v2-product-dialog");
    if (!dialog.open) dialog.showModal();
  }

  function syncAndRender() {
    renderFilters();
    renderCatalog();
  }

  function refreshFromCatalog() {
    families = buildFamilies(catalogSource());
    state.visible = 24;
    renderCategoryStrip();
    renderHighlights();
    syncAndRender();
    $("#v2-total-products").textContent = families.length.toLocaleString("es-ES");
    document.body.classList.add("v2-ready");
  }

  document.addEventListener("input", (event) => {
    if (event.target.matches("[data-search-input]")) {
      state.query = event.target.value.slice(0, 120);
      $$('[data-search-input]').forEach((input) => { if (input !== event.target) input.value = state.query; });
      state.visible = 24;
      renderCatalog();
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-category-select]")) {
      state.category = event.target.value;
      state.visible = 24;
      syncAndRender();
    }
    if (event.target.matches("[data-store-select]")) {
      state.store = event.target.value;
      state.visible = 24;
      syncAndRender();
    }
    if (event.target.matches("#v2-sort")) {
      state.sort = event.target.value;
      renderCatalog();
    }
  });

  document.addEventListener("click", (event) => {
    const favorite = event.target.closest("[data-favorite]");
    if (favorite) {
      event.stopPropagation();
      const id = favorite.dataset.favorite;
      state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
      localStorage.setItem("secretshop-favorites", JSON.stringify([...state.favorites]));
      renderCatalog(); renderHighlights();
      return;
    }
    const open = event.target.closest("[data-open-family], .v2-product-card");
    if (open && !event.target.closest("a, [data-favorite]")) {
      renderVariantModal(open.dataset.openFamily || open.dataset.familyId);
      return;
    }
    const category = event.target.closest("[data-category]");
    if (category) {
      state.category = category.dataset.category;
      state.visible = 24;
      syncAndRender();
      $("#v2-catalog").scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (event.target.closest("#v2-load-more")) {
      state.visible += 24; renderCatalog(); return;
    }
    if (event.target.closest("[data-scroll-catalog]")) {
      $("#v2-catalog").scrollIntoView({ behavior: "smooth" }); return;
    }
    if (event.target.closest("[data-scroll-categories]")) {
      $("#v2-categories").scrollIntoView({ behavior: "smooth" }); return;
    }
    if (event.target.closest("[data-close-dialog]")) {
      $("#v2-product-dialog").close(); return;
    }
    const variant = event.target.closest("[data-variant]");
    if (variant) {
      renderVariantModal(state.selectedFamily, variant.dataset.variant); return;
    }
    const more = event.target.closest("[data-more-variants]");
    if (more) {
      const hidden = $(".v2-hidden-variants", more.parentElement);
      hidden.hidden = false; more.remove(); return;
    }
    if (event.target.closest("#v2-mobile-filter-toggle")) {
      $("#v2-mobile-filters").classList.toggle("is-open"); return;
    }
    if (event.target.closest("#v2-menu-toggle")) {
      $("#v2-mobile-nav").classList.toggle("is-open"); return;
    }
  });

  document.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.classList.contains("v2-product-card")) {
      event.preventDefault(); renderVariantModal(event.target.dataset.familyId);
    }
  });

  document.addEventListener("secretshop:awin-catalog-ready", () => {
    window.setTimeout(refreshFromCatalog, 0);
  });

  refreshFromCatalog();
  window.setTimeout(refreshFromCatalog, 1200);
})();
