#!/usr/bin/env node

import {
  access,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  displayOfferPrice,
  mergeCatalogPayloads,
  offerTotal
} from "../assets/js/catalog-core.js";
import {
  normalizeBasePath,
  productPath,
  publicAssetUrl,
  publishedRegions,
  validateRegionConfig
} from "../assets/js/region-core.js";

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
    await rm(path, { recursive: true, force: true });
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

function productJsonLd(config, region, family, canonical) {
  const numericOffers = family.offers.filter((offer) => offerTotal(offer) !== null);
  const values = numericOffers.map(offerTotal);
  const product = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: family.title,
    image: family.images.slice(0, 6).map((image) => absoluteImage(config.domain, image)),
    description: family.description || undefined,
    sku: family.id,
    category: family.primaryGroup,
    brand: family.brand ? { "@type": "Brand", name: family.brand } : undefined,
    url: canonical
  };
  if (values.length) {
    product.offers = {
      "@type": "AggregateOffer",
      priceCurrency: region.currency,
      lowPrice: Math.min(...values),
      highPrice: Math.max(...values),
      offerCount: numericOffers.length,
      availability: "https://schema.org/InStock",
      url: canonical
    };
  }
  return product;
}

function offerMarkup(region, offer, index) {
  const note = index === 0 ? '<span class="score">Opción destacada</span>' : "";
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
                >Ver oferta en la tienda</a>
              </article>`;
}

function productPage(config, region, family, canonical) {
  const description = String(
    family.description ||
    `Compara las opciones y ofertas disponibles de ${family.title} antes de visitar la tienda.`
  ).slice(0, 1800);
  const metaDescription = truncateWords(description, 155);
  const pageTitle = `${truncateWords(family.title, 64)} | SecretShop`;
  const socialTitle = `${truncateWords(family.title, 90)} | SecretShop`;
  const image = absoluteImage(config.domain, family.image);
  const variants = family.variants.slice(0, 20);
  const offers = [...family.offers]
    .filter((offer) => offer.country === region.countryCode)
    .sort((left, right) => (offerTotal(left) ?? Infinity) - (offerTotal(right) ?? Infinity));
  const hiddenVariants = Math.max(0, family.variants.length - variants.length);
  const jsonLd = productJsonLd(config, region, family, canonical);

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
  <title>${html(pageTitle)}</title>
  <link rel="canonical" href="${html(canonical)}">
  <link rel="icon" href="/assets/brand/secretshop-logo-compact.png" type="image/png">
  <link rel="stylesheet" href="/assets/css/app.css">
  <script type="application/ld+json">${jsonScript(jsonLd)}</script>
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
  <a class="skip-link" href="#contenido">Saltar al contenido</a>
  <header class="content-header">
    <div class="shell">
      <a class="brand" href="${html(region.basePath)}" aria-label="SecretShop, inicio">
        <img src="/assets/brand/secretshop-logo-compact.png" alt="" width="42" height="42">
        <span>SecretShop</span>
      </a>
      <div class="content-actions">
        <a class="region-selector" href="${html(config.selectorPath)}" aria-label="Cambiar país">
          <span aria-hidden="true">${html(region.flag)}</span>
          <span>${html(region.name)}</span>
        </a>
        <button class="button secondary" type="button" data-theme-toggle>◐ Modo oscuro</button>
        <a class="button primary" href="${html(region.basePath)}#catalogo">Volver al catálogo</a>
      </div>
    </div>
  </header>

  <main id="contenido" class="standalone-product-page">
    <div class="shell">
      <nav class="standalone-breadcrumbs" aria-label="Migas de pan">
        <a href="${html(region.basePath)}">Inicio</a>
        <span aria-hidden="true">/</span>
        <a href="${html(region.basePath)}?categoria=${encodeURIComponent(family.primaryGroup)}#catalogo">${html(family.primaryGroup)}</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">${html(family.title)}</span>
      </nav>

      <article class="standalone-product">
        <div class="standalone-product-media">
          <img src="${html(publicAssetUrl(family.image))}" alt="${html(family.title)}" width="720" height="720">
        </div>
        <div class="standalone-product-content">
          <p class="eyebrow">${html(family.primaryGroup)} · ${html(region.name)}</p>
          <h1>${html(family.title)}</h1>
          <div class="detail-summary">
            <span class="score">SecretScore ${family.secretScore.toFixed(1)}</span>
            <span>${family.variantCount} ${family.variantCount === 1 ? "opción" : "opciones"}</span>
            <span>${family.stores.length} ${family.stores.length === 1 ? "tienda" : "tiendas"}</span>
          </div>
          <p class="detail-description">${html(description)}</p>

          <section class="detail-section" aria-labelledby="opciones">
            <div class="detail-section-head">
              <h2 id="opciones">Opciones identificadas</h2>
              <span>${family.variantCount} en total</span>
            </div>
            <div class="variant-list">
              ${variants.map((variant) => `<span class="variant-chip">${html(variant.label)}</span>`).join("\n              ")}
              ${hiddenVariants ? `<span class="variant-chip">+${hiddenVariants} opciones más</span>` : ""}
            </div>
          </section>

          <section class="detail-section" aria-labelledby="ofertas">
            <div class="detail-section-head">
              <h2 id="ofertas">${offers.length === 1 ? "Oferta disponible" : "Ofertas disponibles"}</h2>
              <span>${offers.length} para ${html(region.name)}</span>
            </div>
            <div class="standalone-offers">
              ${offers.map((offer, index) => offerMarkup(region, offer, index)).join("\n")}
            </div>
            <p class="detail-disclosure">El precio, el envío y la disponibilidad definitivos se confirman en la tienda. El enlace puede generar una comisión sin coste adicional.</p>
          </section>
        </div>
      </article>
    </div>
  </main>

  <footer class="site-footer">
    <div class="shell footer-bottom">
      <span>© <span data-current-year></span> SecretShop</span>
      <span><a href="/metodologia.html">Metodología</a> · <a href="/afiliacion.html">Afiliación</a> · <a href="/privacidad.html">Privacidad</a></span>
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
  return template
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
    .replaceAll('href="/" data-region-home', `href="${base}" data-region-home`);
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
  const productDirectory = localPath(`${region.basePath}producto/`);
  await resetGeneratedDirectory(productDirectory);
  const routeSet = new Set();

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

  if (region.basePath !== "/") {
    await writeText(
      resolve(localPath(region.basePath), "index.html"),
      regionalHome(rootTemplate, config, region)
    );
  }

  const lastmod = latestDate(catalog.sources);
  const sitemapEntries = [
    { loc: `${config.domain}${region.basePath}`, lastmod },
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
    lastmod
  });
}

await writeText(
  localPath(config.selectorPath + "index.html"),
  selectorPage(config, publicRegions)
);

const globalLastmod = buildResults
  .map((entry) => entry.lastmod)
  .sort()
  .at(-1) || new Date().toISOString().slice(0, 10);
const globalPaths = [
  config.selectorPath,
  "/metodologia.html",
  "/afiliacion.html",
  "/privacidad.html",
  "/aviso-legal.html",
  "/guias/",
  "/guias/comparar-precios.html",
  "/guias/elegir-sofa.html",
  "/guias/compra-segura.html"
];
await writeText(
  resolve(root, "sitemap-global.xml"),
  sitemapUrlset(
    globalPaths.map((path) => ({
      loc: `${config.domain}${path}`,
      lastmod: globalLastmod
    }))
  )
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
  `Arquitectura regional generada: ${buildResults.map((entry) => `${entry.region}=${entry.productPages} fichas`).join(", ")}; ${publicRegions.length} región publicada.`
);
