#!/usr/bin/env node

import {
  access,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  displayOfferPrice,
  mergeCatalogPayloads,
  offerTotal
} from "../assets/js/catalog-core.js";
import {
  categoryDirectoryPath,
  categoryPath,
  normalizeBasePath,
  productPath,
  publicAssetUrl,
  publishedRegions,
  storeDirectoryPath,
  storePath,
  validateRegionConfig
} from "../assets/js/region-core.js";
import {
  createTranslator,
  localizeCategory,
  translateStaticHtml
} from "../assets/js/i18n.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedMarker = "_GENERATED_BY_SECRETSHOP.txt";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function html(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function xml(value) {
  return html(value);
}

function jsonScript(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function truncateWords(value, maximumLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maximumLength) return text;
  const clipped = text.slice(0, Math.max(1, maximumLength - 3));
  const boundary = clipped.lastIndexOf(" ");
  return `${(boundary > maximumLength * 0.65 ? clipped.slice(0, boundary) : clipped).trim()}...`;
}

function cleanProductText(value) {
  return String(value || "")
    .replace(
      /^\s*\d{1,2}\s+de\s+[\p{L}]{3,12}\.?\s*-\s*\d{1,2}\s+de\s+[\p{L}]{3,12}\.?\s*/iu,
      ""
    )
    .replace(
      /^\s*\d{1,2}\s+de\s+[\p{L}]{3,12}\.?\s*[-–—.:]\s*/iu,
      ""
    )
    .replace(/,(?=[\p{L}])/gu, ", ")
    .replace(/,(?=\d+\s+[\p{L}])/gu, ", ")
    .replace(/;(?=[\p{L}])/gu, "; ")
    .replace(/\s*\(\.\s+/gu, ". ")
    .replace(/\s+/g, " ")
    .replace(/\s*\(\s*$/u, "")
    .replace(/[\s|/–—-]+$/u, "")
    .trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function localPath(publicPath) {
  const value = String(publicPath || "");
  assert(value.startsWith("/") && !value.includes(".."), `Ruta pública insegura: ${value}`);
  const output = resolve(root, `.${value}`);
  assert(output === root || output.startsWith(`${root}${sep}`), `Ruta fuera del repositorio: ${value}`);
  return output;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeText(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

async function resetGeneratedDirectory(path) {
  if (await exists(path)) {
    const marker = resolve(path, generatedMarker);
    assert(
      await exists(marker),
      `Se ha rechazado borrar ${relative(root, path)} porque no parece un directorio generado`
    );
    await rm(path, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100
    });
  }
  await mkdir(path, { recursive: true });
  await writeText(
    resolve(path, generatedMarker),
    "Directorio generado por scripts/build-regional-site.mjs. No editar manualmente.\n"
  );
}

function rawOffers(payload) {
  return (payload.families || []).flatMap((family) =>
    (family.variants || []).flatMap((variant) => variant.offers || [])
  );
}

function validateSourceRegion(payload, source, region) {
  assert(payload?.schemaVersion === 3, `${source.id}: schemaVersion de catálogo inválido`);
  assert(Array.isArray(payload.families), `${source.id}: families obligatorio`);
  for (const offer of rawOffers(payload)) {
    const country = String(offer.country || source.country || "").toUpperCase();
    const currency = String(offer.currency || source.currency || "").toUpperCase();
    assert(country === region.countryCode, `${source.id}/${offer.id}: oferta de ${country} en ${region.id}`);
    assert(currency === region.currency, `${source.id}/${offer.id}: moneda ${currency} en ${region.id}`);
  }
}

async function loadRegionCatalog(region) {
  const manifest = await readJson(localPath(region.catalogManifest));
  assert(manifest.schemaVersion === 1, `${region.id}: schemaVersion de manifest inválido`);
  assert(manifest.region === region.id, `${region.id}: el manifest pertenece a ${manifest.region}`);
  assert(manifest.country === region.countryCode, `${region.id}: country del manifest no coincide`);
  assert(manifest.currency === region.currency, `${region.id}: currency del manifest no coincide`);
  assert(manifest.locale === region.locale, `${region.id}: locale del manifest no coincide`);
  assert(Array.isArray(manifest.sources) && manifest.sources.length > 0, `${region.id}: sources obligatorio`);

  const sources = await Promise.all(
    manifest.sources.map(async (source) => {
      const payload = await readJson(localPath(source.path));
      validateSourceRegion(payload, source, region);
      return {
        ...source,
        url: source.path,
        payload
      };
    })
  );
  const merged = mergeCatalogPayloads(sources);
  assert(merged.warnings.length === 0, `${region.id}: ${merged.warnings.join("; ")}`);
  assert(merged.families.length > 0, `${region.id}: catálogo vacío`);
  return { manifest, sources, ...merged };
}

function absoluteImage(domain, value) {
  const normalized = publicAssetUrl(value);
  if (/^https:\/\//i.test(normalized)) return normalized;
  return `${domain}${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
}

function latestDate(sources) {
  const timestamps = sources
    .map((source) => Date.parse(source.payload.generatedAt || ""))
    .filter(Number.isFinite);
  const timestamp = timestamps.length ? Math.max(...timestamps) : Date.now();
  return new Date(timestamp).toISOString().slice(0, 10);
}

function productStructuredData(config, region, family, canonical, title, description) {
  const pricedOffers = family.offers
    .map((offer) => ({ offer, price: Number(offer?.price) }))
    .filter(({ price }) => Number.isFinite(price) && price > 0);
  const prices = pricedOffers.map(({ price }) => price);
  const breadcrumbId = `${canonical}#breadcrumb`;
  const pageId = `${canonical}#webpage`;
  const graph = [
    {
      "@type": "WebPage",
      "@id": pageId,
      url: canonical,
      name: title,
      description,
      inLanguage: region.locale,
      breadcrumb: { "@id": breadcrumbId }
    },
    {
      "@type": "BreadcrumbList",
      "@id": breadcrumbId,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: `SecretShop ${region.name}`,
          item: `${config.domain}${region.basePath}`
        },
        {
          "@type": "ListItem",
          position: 2,
          name: title,
          item: canonical
        }
      ]
    }
  ];

  if (prices.length && family.variantCount === 1) {
    const productId = `${canonical}#product`;
    graph[0].mainEntity = { "@id": productId };
    graph.push({
      "@type": "Product",
      "@id": productId,
      name: title,
      image: family.images.slice(0, 6).map((image) => absoluteImage(config.domain, image)),
      description,
      sku: family.id,
      category: family.primaryGroup,
      brand: family.brand && !/^(?:selecci[oó]n|gen[eé]ric[oa]|sin marca|unknown|n\/?a)$/iu.test(family.brand)
        ? { "@type": "Brand", name: family.brand }
        : undefined,
      url: canonical,
      mainEntityOfPage: { "@id": pageId },
      offers: {
        "@type": "AggregateOffer",
        priceCurrency: region.currency,
        lowPrice: Math.min(...prices),
        highPrice: Math.max(...prices),
        offerCount: pricedOffers.length,
        availability: pricedOffers.some(({ offer }) => offer.availability === "in_stock")
          ? "https://schema.org/InStock"
          : undefined,
        url: canonical
      }
    });
  }

  return {
    "@context": "https://schema.org",
    "@graph": graph
  };
}

function offerMarkup(region, offer, index) {
  const t = createTranslator(region.locale);
  const note = index === 0
    ? `<span class="score">${html(t("highlightedOption"))}</span>`
    : "";
  return `
              <article class="standalone-offer">
                <div>
                  <strong>${html(offer.merchantName)}</strong>
                  ${note}
                </div>
                <strong>${html(displayOfferPrice(offer))}</strong>
                <a
                  class="offer-link"
                  href="/go.html?region=${encodeURIComponent(region.id)}&amp;offer=${encodeURIComponent(offer.id)}"
                  target="_blank"
                  rel="nofollow sponsored noopener"
                >${html(t("viewStoreOffer"))}</a>
              </article>`;
}

function productPage(config, region, family, canonical) {
  const t = createTranslator(region.locale);
  const title = cleanProductText(family.title) || t("productType");
  const cleanedDescription = cleanProductText(family.description);
  const description = String(
    cleanedDescription ||
    (region.locale.startsWith("pt")
      ? `Compare as opções e ofertas disponíveis de ${title} antes de visitar a loja.`
      : `Compara las opciones y ofertas disponibles de ${title} antes de visitar la tienda.`)
  ).slice(0, 1800);
  const metaDescription = truncateWords(description, 155);
  const pageTitle = `${truncateWords(title, 64)} | SecretShop`;
  const socialTitle = `${truncateWords(title, 90)} | SecretShop`;
  const image = absoluteImage(config.domain, family.image);
  const variants = family.variants.slice(0, 20);
  const offers = [...family.offers]
    .filter((offer) => offer.country === region.countryCode)
    .sort((left, right) => (offerTotal(left) ?? Infinity) - (offerTotal(right) ?? Infinity));
  const hiddenVariants = Math.max(0, family.variants.length - variants.length);
  const structuredData = productStructuredData(
    config,
    region,
    family,
    canonical,
    title,
    description
  );

  return `<!doctype html>
<html lang="${html(region.locale)}" data-theme="light" data-region="${html(region.id)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="description" content="${html(metaDescription)}">
  <meta name="theme-color" content="#1f1f1f">
  <meta name="color-scheme" content="light dark">
  <meta property="og:type" content="product">
  <meta property="og:title" content="${html(socialTitle)}">
  <meta property="og:description" content="${html(metaDescription)}">
  <meta property="og:url" content="${html(canonical)}">
  <meta property="og:image" content="${html(image)}">
  <meta property="og:image:alt" content="${html(title)}">
  <title>${html(pageTitle)}</title>
  <link rel="canonical" href="${html(canonical)}">
  <link rel="icon" href="/assets/brand/secretshop-logo-compact.png" type="image/png">
  <link rel="stylesheet" href="/assets/css/app.css">
  <script type="application/ld+json">${jsonScript(structuredData)}</script>
  <script>
    (() => {
      try {
        const saved = localStorage.getItem("secretshop:theme:v1");
        const dark = matchMedia("(prefers-color-scheme: dark)").matches;
        document.documentElement.dataset.theme = saved || (dark ? "dark" : "light");
      } catch {}
    })();
  </script>
</head>
<body>
  <a class="skip-link" href="#contenido">${html(region.locale.startsWith("pt") ? "Saltar para o conteúdo" : "Saltar al contenido")}</a>
  <header class="content-header">
    <div class="shell">
      <a class="brand" href="${html(region.basePath)}" aria-label="${html(t("homeAria"))}">
        <img src="/assets/brand/secretshop-logo-compact.png" alt="" width="42" height="42">
        <span>SecretShop</span>
      </a>
      <div class="content-actions">
        <a class="region-selector" href="${html(config.selectorPath)}" aria-label="${html(t("changeCountry"))}">
          <span aria-hidden="true">${html(region.flag)}</span>
          <span>${html(region.name)}</span>
        </a>
        <button class="button secondary" type="button" data-theme-toggle>◐ ${html(t("darkMode"))}</button>
        <a class="button primary" href="${html(region.basePath)}#catalogo">${html(t("backToCatalog"))}</a>
      </div>
    </div>
  </header>

  <main id="contenido" class="standalone-product-page">
    <div class="shell">
      <nav class="standalone-breadcrumbs" aria-label="${html(t("breadcrumbLabel"))}">
        <a href="${html(region.basePath)}">${html(t("home"))}</a>
        <span aria-hidden="true">/</span>
        <a href="${html(categoryPath(family.primaryGroup, region))}">${html(localizeCategory(family.primaryGroup, region.locale))}</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">${html(title)}</span>
      </nav>

      <article class="standalone-product" data-family-id="${html(family.id)}">
        <div class="standalone-product-media">
          <img src="${html(publicAssetUrl(family.image))}" alt="${html(title)}" width="720" height="720">
        </div>
        <div class="standalone-product-content">
          <p class="eyebrow">${html(localizeCategory(family.primaryGroup, region.locale))} · ${html(region.name)}</p>
          <h1>${html(title)}</h1>
          <div class="detail-summary">
            <span class="score">SecretScore ${family.secretScore.toFixed(1)}</span>
            <span>${html(family.variantCount === 1 ? t("oneOption") : t("options", { count: family.variantCount }))}</span>
            <span>${html(family.stores.length === 1 ? t("oneStore") : t("storesCount", { count: family.stores.length }))}</span>
          </div>
          <p class="detail-description">${html(description)}</p>

          <section class="detail-section" aria-labelledby="opciones">
            <div class="detail-section-head">
              <h2 id="opciones">${html(t("identifiedOptions"))}</h2>
              <span>${html(t("availableInTotal", { count: family.variantCount }))}</span>
            </div>
            <div class="variant-list">
              ${variants.map((variant) => `<span class="variant-chip">${html(variant.label)}</span>`).join("\n              ")}
              ${hiddenVariants ? `<span class="variant-chip">${html(t("optionsMore", { count: hiddenVariants }))}</span>` : ""}
            </div>
          </section>

          <section class="detail-section" aria-labelledby="ofertas">
            <div class="detail-section-head">
              <h2 id="ofertas">${html(offers.length === 1 ? t("oneAvailableOffer") : t("availableOffers"))}</h2>
              <span>${html(t("totalForRegion", { count: offers.length, region: region.name }))}</span>
            </div>
            <div class="standalone-offers">
              ${offers.map((offer, index) => offerMarkup(region, offer, index)).join("\n")}
            </div>
            <p class="detail-disclosure">${html(t("storePriceDisclosure"))}</p>
          </section>
        </div>
      </article>
    </div>
  </main>

  <footer class="site-footer">
    <div class="shell footer-bottom">
      <span>© <span data-current-year></span> SecretShop</span>
      <span><a href="/metodologia.html">${html(t("methodology"))}</a> · <a href="/afiliacion.html">${html(t("affiliation"))}</a> · <a href="/privacidad.html">${html(t("privacy"))}</a></span>
    </div>
  </footer>
  <script type="module" src="/assets/js/static.js"></script>
</body>
</html>
`;
}

function selectorPage(config, regions) {
  const cards = regions.map((region) => `
        <a class="country-card" href="${html(region.basePath)}" hreflang="${html(region.locale)}">
          <span class="country-flag" aria-hidden="true">${html(region.flag)}</span>
          <span>
            <strong>${html(region.name)}</strong>
            <small>${html(region.currency)} · catálogo disponible</small>
          </span>
          <span aria-hidden="true">→</span>
        </a>`).join("\n");
  return `<!doctype html>
<html lang="es" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="description" content="Elige el país para ver únicamente productos, precios, tiendas y enlaces válidos para tu mercado.">
  <meta name="theme-color" content="#1f1f1f">
  <meta name="color-scheme" content="light dark">
  <meta property="og:type" content="website">
  <meta property="og:title" content="Elige tu país | SecretShop">
  <meta property="og:url" content="${html(config.domain + config.selectorPath)}">
  <title>Elige tu país | SecretShop</title>
  <link rel="canonical" href="${html(config.domain + config.selectorPath)}">
  <link rel="alternate" hreflang="x-default" href="${html(config.domain + config.selectorPath)}">
  ${regions.map((region) => `<link rel="alternate" hreflang="${html(region.locale)}" href="${html(config.domain + region.basePath)}">`).join("\n  ")}
  <link rel="icon" href="/assets/brand/secretshop-logo-compact.png" type="image/png">
  <link rel="stylesheet" href="/assets/css/app.css">
  <script>
    (() => {
      try {
        const saved = localStorage.getItem("secretshop:theme:v1");
        const dark = matchMedia("(prefers-color-scheme: dark)").matches;
        document.documentElement.dataset.theme = saved || (dark ? "dark" : "light");
      } catch {}
    })();
  </script>
</head>
<body>
  <header class="content-header">
    <div class="shell">
      <a class="brand" href="/">
        <img src="/assets/brand/secretshop-logo-compact.png" alt="" width="42" height="42">
        <span>SecretShop</span>
      </a>
      <button class="button secondary" type="button" data-theme-toggle>◐ Modo oscuro</button>
    </div>
  </header>
  <main class="content-page">
    <div class="content-shell">
      <header class="content-hero">
        <p class="eyebrow">SecretShop internacional</p>
        <h1>Elige tu país</h1>
        <p>Así verás únicamente productos, precios, tiendas y enlaces preparados para tu mercado. No convertimos monedas ni mezclamos ofertas de países distintos.</p>
      </header>
      <section aria-labelledby="paises-disponibles">
        <h2 id="paises-disponibles" class="sr-only">Países disponibles</h2>
        <div class="country-grid">
${cards}
        </div>
      </section>
      <aside class="prose-card country-note">
        <h2>Expansión progresiva</h2>
        <p>Solo aparecen países con un catálogo completo y validado. Las nuevas regiones se incorporarán cuando sus precios, disponibilidad y enlaces de afiliación estén comprobados.</p>
      </aside>
    </div>
  </main>
  <script type="module" src="/assets/js/static.js"></script>
</body>
</html>
`;
}

function regionalHome(template, config, region) {
  const base = normalizeBasePath(region.basePath);
  const output = template
    .replace(/<html lang="[^"]+" data-theme="light" data-region="[^"]+">/, `<html lang="${region.locale}" data-theme="light" data-region="${region.id}">`)
    .replace(
      /<meta\s+name="description"\s+content="[\s\S]*?"\s*>/,
      `<meta name="description" content="${html(region.description)}">`
    )
    .replace(/<title>[^<]+<\/title>/, `<title>${html(region.title)}</title>`)
    .replace(/<link rel="canonical" href="[^"]+">/, `<link rel="canonical" href="${config.domain}${base}">`)
    .replace(
      /<link rel="alternate" hreflang="[^"]+" href="[^"]+">/,
      `<link rel="alternate" hreflang="${region.locale}" href="${config.domain}${base}">`
    )
    .replace(/<meta property="og:url" content="[^"]+">/, `<meta property="og:url" content="${config.domain}${base}">`)
    .replace(/<meta property="og:title" content="[^"]+">/, `<meta property="og:title" content="${html(region.title)}">`)
    .replace(
      /<meta\s+property="og:description"\s+content="[\s\S]*?"\s*>/,
      `<meta property="og:description" content="${html(region.description)}">`
    )
    .replaceAll('href="/#', `href="${base}#`)
    .replaceAll('href="/" data-region-home', `href="${base}" data-region-home`)
    .replace(
      /(<span\b[^>]*\bdata-region-name[^>]*>)[^<]*(<\/span>)/g,
      `$1${html(region.name)}$2`
    )
    .replace(
      /(<span\b[^>]*\bdata-region-flag[^>]*>)[^<]*(<\/span>)/g,
      `$1${html(region.flag)}$2`
    )
    .replace('"inLanguage": "es-ES"', `"inLanguage": "${region.locale}"`);
  return translateStaticHtml(output, region.locale);
}

function navigationStructuredData(config, region, canonical, title, description, breadcrumbs) {
  const breadcrumbId = `${canonical}#breadcrumb`;
  const pageId = `${canonical}#webpage`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": pageId,
        url: canonical,
        name: title,
        description,
        inLanguage: region.locale,
        breadcrumb: { "@id": breadcrumbId }
      },
      {
        "@type": "BreadcrumbList",
        "@id": breadcrumbId,
        itemListElement: breadcrumbs.map((entry, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: entry.name,
          item: `${config.domain}${entry.path}`
        }))
      }
    ]
  };
}

function navigationPage(
  template,
  config,
  region,
  {
    canonicalPath,
    description,
    initialCategory = null,
    initialStore = null,
    kind,
    title,
    breadcrumbs
  }
) {
  const canonical = `${config.domain}${canonicalPath}`;
  const structuredData = navigationStructuredData(
    config,
    region,
    canonical,
    title,
    description,
    breadcrumbs
  );
  const bodyAttributes = [
    `data-page-kind="${html(kind)}"`,
    initialCategory ? `data-initial-category="${html(initialCategory)}"` : "",
    initialStore ? `data-initial-store="${html(initialStore)}"` : ""
  ].filter(Boolean).join(" ");
  const localizedTemplate = regionalHome(template, config, region);
  assert(
    localizedTemplate.includes('<body data-page-kind="home">'),
    `${region.id}: no se ha encontrado el marcador de página en la plantilla`
  );

  return localizedTemplate
    .replace(
      /<meta\s+name="description"\s+content="[\s\S]*?"\s*>/,
      `<meta name="description" content="${html(description)}">`
    )
    .replace(/<title>[^<]+<\/title>/, `<title>${html(title)}</title>`)
    .replace(/<link rel="canonical" href="[^"]+">/, `<link rel="canonical" href="${html(canonical)}">`)
    .replace(
      /<link rel="alternate" hreflang="[^"]+" href="[^"]+">/,
      `<link rel="alternate" hreflang="${html(region.locale)}" href="${html(canonical)}">`
    )
    .replace(/<meta property="og:url" content="[^"]+">/, `<meta property="og:url" content="${html(canonical)}">`)
    .replace(/<meta property="og:title" content="[^"]+">/, `<meta property="og:title" content="${html(title)}">`)
    .replace(
      /<meta\s+property="og:description"\s+content="[\s\S]*?"\s*>/,
      `<meta property="og:description" content="${html(description)}">`
    )
    .replace(
      '<body data-page-kind="home">',
      `<body ${bodyAttributes}>`
    )
    .replace(
      "</head>",
      `  <script type="application/ld+json">${jsonScript(structuredData)}</script>\n</head>`
    );
}

function categoryLabels(catalog) {
  const labels = new Set();
  for (const family of catalog.families) {
    for (const value of [...(family.categories || []), ...(family.groups || [])]) {
      const label = String(value || "").trim();
      if (label) labels.add(label);
    }
  }
  return [...labels].sort((left, right) => left.localeCompare(right, "es"));
}

function activeStores(catalog) {
  const stores = new Map();
  for (const family of catalog.families) {
    for (const offer of family.offers || []) {
      const name = String(offer.merchantName || "").trim();
      if (name) stores.set(name, name);
    }
  }
  return [...stores.values()].sort((left, right) => left.localeCompare(right));
}

function sitemapUrlset(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((entry) => `  <url><loc>${xml(entry.loc)}</loc><lastmod>${xml(entry.lastmod)}</lastmod></url>`).join("\n")}
</urlset>
`;
}

function sitemapIndex(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((entry) => `  <sitemap><loc>${xml(entry.loc)}</loc><lastmod>${xml(entry.lastmod)}</lastmod></sitemap>`).join("\n")}
</sitemapindex>
`;
}

const config = validateRegionConfig(
  await readJson(resolve(root, "data/config/regions.json"))
);
const publicRegions = publishedRegions(config);
const rootTemplate = await readFile(resolve(root, "index.html"), "utf8");
const buildResults = [];

for (const region of publicRegions) {
  const catalog = await loadRegionCatalog(region);
  const t = createTranslator(region.locale);
  const productDirectory = localPath(`${region.basePath}producto/`);
  const categoryDirectory = localPath(categoryDirectoryPath(region));
  const storeDirectory = localPath(storeDirectoryPath(region));
  await resetGeneratedDirectory(productDirectory);
  await resetGeneratedDirectory(categoryDirectory);
  await resetGeneratedDirectory(storeDirectory);
  const routeSet = new Set();
  const categoryRouteSet = new Set();
  const storeRouteSet = new Set();

  for (const family of catalog.families) {
    const route = productPath(family, region);
    assert(!routeSet.has(route), `${region.id}: ruta de producto duplicada ${route}`);
    routeSet.add(route);
    const canonical = `${config.domain}${route}`;
    await writeText(
      resolve(localPath(route), "index.html"),
      productPage(config, region, family, canonical)
    );
  }

  const categoryDirectoryRoute = categoryDirectoryPath(region);
  const categoryDirectoryTitle = `${t("categoryDirectoryTitle")} | SecretShop ${region.name}`;
  const categoryDirectoryDescription = t("categoryDirectoryText");
  await writeText(
    resolve(categoryDirectory, "index.html"),
    navigationPage(rootTemplate, config, region, {
      canonicalPath: categoryDirectoryRoute,
      description: categoryDirectoryDescription,
      kind: "categories",
      title: categoryDirectoryTitle,
      breadcrumbs: [
        { name: `SecretShop ${region.name}`, path: region.basePath },
        { name: t("categoryDirectoryTitle"), path: categoryDirectoryRoute }
      ]
    })
  );
  categoryRouteSet.add(categoryDirectoryRoute);

  for (const category of categoryLabels(catalog)) {
    const route = categoryPath(category, region);
    assert(!categoryRouteSet.has(route), `${region.id}: ruta de categoría duplicada ${route}`);
    categoryRouteSet.add(route);
    const localizedCategory = localizeCategory(category, region.locale);
    const title = `${localizedCategory} | SecretShop ${region.name}`;
    const description = region.locale.startsWith("pt")
      ? `Explore produtos, opções e ofertas de ${localizedCategory} disponíveis para Portugal.`
      : `Explora productos, opciones y ofertas de ${localizedCategory} disponibles para ${region.name}.`;
    await writeText(
      resolve(localPath(route), "index.html"),
      navigationPage(rootTemplate, config, region, {
        canonicalPath: route,
        description,
        initialCategory: category,
        kind: "category",
        title,
        breadcrumbs: [
          { name: `SecretShop ${region.name}`, path: region.basePath },
          { name: t("categoryDirectoryTitle"), path: categoryDirectoryRoute },
          { name: localizedCategory, path: route }
        ]
      })
    );
  }

  const storeDirectoryRoute = storeDirectoryPath(region);
  const storeDirectoryTitle = `${t("storeDirectoryTitle")} | SecretShop ${region.name}`;
  const storeDirectoryDescription = t("storeDirectoryText");
  await writeText(
    resolve(storeDirectory, "index.html"),
    navigationPage(rootTemplate, config, region, {
      canonicalPath: storeDirectoryRoute,
      description: storeDirectoryDescription,
      kind: "stores",
      title: storeDirectoryTitle,
      breadcrumbs: [
        { name: `SecretShop ${region.name}`, path: region.basePath },
        { name: t("storeDirectoryTitle"), path: storeDirectoryRoute }
      ]
    })
  );
  storeRouteSet.add(storeDirectoryRoute);

  for (const store of activeStores(catalog)) {
    const route = storePath(store, region);
    assert(!storeRouteSet.has(route), `${region.id}: ruta de tienda duplicada ${route}`);
    storeRouteSet.add(route);
    const title = `${store} | SecretShop ${region.name}`;
    const description = region.locale.startsWith("pt")
      ? `Compare os produtos e ofertas disponíveis na ${store} para Portugal.`
      : `Compara los productos y ofertas disponibles en ${store} para ${region.name}.`;
    await writeText(
      resolve(localPath(route), "index.html"),
      navigationPage(rootTemplate, config, region, {
        canonicalPath: route,
        description,
        initialStore: store,
        kind: "store",
        title,
        breadcrumbs: [
          { name: `SecretShop ${region.name}`, path: region.basePath },
          { name: t("storeDirectoryTitle"), path: storeDirectoryRoute },
          { name: store, path: route }
        ]
      })
    );
  }

  if (region.basePath !== "/") {
    await writeText(
      resolve(localPath(region.basePath), "index.html"),
      regionalHome(rootTemplate, config, region)
    );
  }

  const lastmod = latestDate(catalog.sources);
  const sitemapEntries = [
    { loc: `${config.domain}${region.basePath}`, lastmod },
    ...[...categoryRouteSet].map((route) => ({
      loc: `${config.domain}${route}`,
      lastmod
    })),
    ...[...storeRouteSet].map((route) => ({
      loc: `${config.domain}${route}`,
      lastmod
    })),
    ...catalog.families.map((family) => ({
      loc: `${config.domain}${productPath(family, region)}`,
      lastmod
    }))
  ];
  await writeText(
    resolve(root, `sitemap-${region.id}.xml`),
    sitemapUrlset(sitemapEntries)
  );
  buildResults.push({
    region: region.id,
    country: region.countryCode,
    status: region.status,
    families: catalog.families.length,
    variants: catalog.stats.variants,
    offers: catalog.stats.offers,
    productPages: routeSet.size,
    categoryPages: categoryRouteSet.size,
    storePages: storeRouteSet.size,
    lastmod
  });
}

await writeText(
  localPath(config.selectorPath + "index.html"),
  selectorPage(config, publicRegions)
);

const globalPaths = [
  config.selectorPath,
  "/promociones/",
  "/metodologia.html",
  "/afiliacion.html",
  "/privacidad.html",
  "/aviso-legal.html",
  "/guias/",
  "/guias/comparar-precios.html",
  "/guias/elegir-sofa.html",
  "/guias/compra-segura.html"
];
const seoStatePath = resolve(root, "data/config/seo-state.json");
let previousSeoState = { schemaVersion: 1, pages: {} };
if (await exists(seoStatePath)) {
  try {
    previousSeoState = await readJson(seoStatePath);
  } catch {
    previousSeoState = { schemaVersion: 1, pages: {} };
  }
}
const today = new Date().toISOString().slice(0, 10);
const nextSeoPages = {};
const globalEntries = [];
for (const publicPath of globalPaths) {
  const sourcePath = publicPath.endsWith("/")
    ? localPath(`${publicPath}index.html`)
    : localPath(publicPath);
  const content = await readFile(sourcePath, "utf8");
  const digest = sha256(content);
  const previous = previousSeoState?.pages?.[publicPath];
  const lastmod = previous?.sha256 === digest && validDate(previous?.lastmod)
    ? previous.lastmod
    : today;
  nextSeoPages[publicPath] = { sha256: digest, lastmod };
  globalEntries.push({ loc: `${config.domain}${publicPath}`, lastmod });
}
await writeText(
  seoStatePath,
  `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    pages: nextSeoPages
  }, null, 2)}\n`
);
const globalLastmod = globalEntries
  .map((entry) => entry.lastmod)
  .sort()
  .at(-1) || today;
await writeText(
  resolve(root, "sitemap-global.xml"),
  sitemapUrlset(globalEntries)
);
await writeText(
  resolve(root, "sitemap.xml"),
  sitemapIndex([
    { loc: `${config.domain}/sitemap-global.xml`, lastmod: globalLastmod },
    ...buildResults.map((entry) => ({
      loc: `${config.domain}/sitemap-${entry.region}.xml`,
      lastmod: entry.lastmod
    }))
  ])
);
await writeText(
  resolve(root, "data/config/regions-build-report.json"),
  `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    publishedRegions: publicRegions.map((region) => region.id),
    draftRegions: config.regions.filter((region) => region.status === "draft").map((region) => region.id),
    regions: buildResults
  }, null, 2)}\n`
);

console.log(
  `Arquitectura regional generada: ${buildResults.map((entry) => `${entry.region}=${entry.productPages} fichas, ${entry.categoryPages} categorías, ${entry.storePages} tiendas`).join("; ")}; ${publicRegions.length} regiones publicadas.`
);
