import { gunzipSync } from "node:zlib";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import {
  cleanDescription,
  cleanText,
  parseDecimal,
  slugify
} from "./awin-feed-utils.mjs";
import { parseImpactAffiliateUrl } from "./impact-affiliate-core.mjs";

const REQUIRED_HEADERS = [
  "Unique Merchant SKU",
  "Product Name",
  "Product URL",
  "Image URL",
  "Current Price",
  "Stock Availability",
  "Parent SKU",
  "Parent Name",
  "Currency",
  "Labels"
];

const IMAGE_HEADERS = [
  "Image URL",
  "Alternative Image URL 1",
  "Alternative Image URL 2",
  "Alternative Image URL 3",
  "Alternative Image URL 4",
  "Alternative Image URL 5"
];

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeSpaces(value) {
  return cleanText(value).replace(/\s+/g, " ");
}

function localizeProductName(value) {
  return normalizeSpaces(value)
    .replace(/[（(]\s*(?:chasingstrava|after[- ]?sales|amz)\s*[）)]/gi, "")
    .replaceAll("_", " ")
    .replace(/\bClip-On Earbud Carrying Case\b/gi, "Estuche para auriculares Clip-On")
    .replace(/\bEarbuds Accessory\b/gi, "Accesorio para auriculares")
    .replace(/\bProtective Case\b/gi, "Funda protectora")
    .replace(/\bCarrying Case\b/gi, "Estuche de transporte")
    .replace(/\bWireless Charger\b/gi, "Cargador inalámbrico")
    .replace(/\bBelt Bag\b/gi, "Riñonera")
    .replace(/\bTote Bag\b/gi, "Bolsa tote")
    .replace(/\bSwim Cap\b/gi, "Gorro de natación")
    .replace(/\bVisor\b/gi, "Visera")
    .replace(/\bBlack\b/gi, "Negro")
    .replace(/\bWhite\b/gi, "Blanco")
    .replace(/\bGr(?:a|e)y\b/gi, "Gris")
    .replace(/\bLilac\b/gi, "Lila")
    .replace(/\bNacre\b/gi, "Nácar")
    .replace(/\bPianokeys\b/gi, "Teclas de piano")
    .replace(/\s+/g, " ")
    .trim();
}

function modelFor(row, parent) {
  const rawModel = parent?.["Product Name"] || row["Parent Name"] || row["Product Name"];
  const model = localizeProductName(rawModel);
  if (parent || normalizeSpaces(row["Parent SKU"])) return model;
  if (/^(?:Shokz )?Bolsa tote$/i.test(model)) return "Shokz Bolsa tote";
  return model
    .replace(
      /^(Shokz Accesorio para auriculares)\s+(?:Lila|Nácar|Teclas de piano)$/i,
      "$1"
    )
    .replace(
      /^(Shokz Estuche para auriculares Clip-On)\s+(?:Blanco|Negro)$/i,
      "$1"
    );
}

function variantOptionFor(row, title) {
  const explicit = localizeProductName(row.Color);
  if (explicit) return explicit;
  const match = title.match(/\b(Negro|Blanco|Gris|Lila|Nácar|Teclas de piano)$/i);
  return match?.[1] || null;
}

function parseDelimited(text, delimiter = "\t") {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (quoted) throw new Error("Feed TSV inválido: comillas sin cerrar");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseImpactTsv(text) {
  const rows = parseDelimited(text);
  if (rows.length === 0) return { headers: [], records: [] };

  const headers = rows[0].map(normalizeSpaces);
  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (headers.some((header) => !header)) {
    throw new Error("Feed TSV inválido: contiene una columna sin nombre");
  }
  if (duplicates.length > 0) {
    throw new Error(`Feed TSV inválido: columnas duplicadas: ${unique(duplicates).join(", ")}`);
  }

  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new Error(`Feed de Impact incompleto: faltan ${missing.join(", ")}`);
  }

  const records = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const values = rows[rowIndex];
    if (values.length === 1 && values[0] === "") continue;
    if (values.length > headers.length) {
      throw new Error(`Fila ${rowIndex + 1}: contiene más columnas que la cabecera`);
    }
    const record = { __rowNumber: rowIndex + 1 };
    headers.forEach((header, columnIndex) => {
      record[header] = values[columnIndex] ?? "";
    });
    records.push(record);
  }

  return { headers, records };
}

export async function readImpactFeed(inputPath) {
  const absolutePath = resolve(inputPath);
  const buffer = await readFile(absolutePath);
  const extension = extname(absolutePath).toLowerCase();
  let text;

  if (extension === ".gz") {
    text = gunzipSync(buffer).toString("utf8");
  } else if ([".txt", ".tsv"].includes(extension)) {
    text = buffer.toString("utf8");
  } else {
    throw new Error("Formato no compatible. Utiliza el TXT o TXT.GZ descargado de Impact.");
  }

  return {
    ...parseImpactTsv(text),
    sourceFile: basename(absolutePath)
  };
}

function hasLabel(row, expected) {
  return normalizeSpaces(row.Labels)
    .split(",")
    .map((label) => label.trim().toLowerCase())
    .includes(expected);
}

function rowSkipReason(row, referencedParents, merchant) {
  if (normalizeSpaces(row["Stock Availability"]).toUpperCase() !== "Y") {
    return "not_in_stock";
  }
  if (!(parseDecimal(row["Current Price"]) > 0)) return "invalid_price";
  if (normalizeSpaces(row.Currency).toUpperCase() !== "EUR") return "invalid_currency";
  if (hasLabel(row, "noindex")) return "noindex";
  if (/chasingstrava|after[- ]?sales/i.test(row["Product Name"])) {
    return "internal_campaign";
  }
  if (referencedParents.has(normalizeSpaces(row["Unique Merchant SKU"]))) {
    return "parent_row";
  }

  const tracking = parseImpactAffiliateUrl(row["Product URL"], {
    trackingHost: merchant.impactTrackingHost,
    publisherId: merchant.impactPublisherId,
    campaignId: merchant.impactCampaignId,
    creativeId: merchant.impactCreativeId,
    catalogSource: merchant.impactCatalogSource,
    productSku: row["Unique Merchant SKU"],
    landingDomains: merchant.landingDomains
  });
  if (!tracking) return "invalid_tracking_url";

  try {
    const image = new URL(row["Image URL"]);
    if (image.protocol !== "https:") return "invalid_image";
  } catch {
    return "invalid_image";
  }
  return null;
}

function imageUrls(row, parent) {
  return unique(
    [row, parent]
      .filter(Boolean)
      .flatMap((record) => IMAGE_HEADERS.map((header) => normalizeSpaces(record[header])))
      .filter((value) => {
        try {
          return new URL(value).protocol === "https:";
        } catch {
          return false;
        }
      })
  ).slice(0, 6);
}

function productTypeFor(row, parent) {
  const text = `${row["Product Name"]} ${parent?.["Product Name"] ?? ""}`.toLowerCase();
  return /case|funda|bag|bolsa|visor|almohadilla|charger|cargador|cable|cap\b|accesor/
    .test(text)
    ? "Accesorios de audio"
    : "Auriculares";
}

function descriptionFor(row, parent, model, productType) {
  const source = cleanDescription(
    row["Product Description"] || parent?.["Product Description"] || "",
    1_200
  );
  if (source.length >= 40) return source;
  return productType === "Auriculares"
    ? `${model} de Shokz disponible en España. Consulta en la tienda oficial sus características, colores, compatibilidad, precio y disponibilidad actual antes de comprar.`
    : `${model}, accesorio oficial de Shokz disponible en España. Revisa en la tienda oficial la compatibilidad, las variantes, el precio y la disponibilidad actual.`;
}

function configurationFor(row) {
  const bullet = normalizeSpaces(row["Product Bullet Point 1"]);
  if (bullet) return bullet;
  if (/^(?:Shokz )?Tote Bag$/i.test(normalizeSpaces(row["Product Name"]))) {
    return normalizeSpaces(row["Product Name"]);
  }
  const name = normalizeSpaces(row["Product Name"]);
  const slash = name.includes("/") ? name.split("/").slice(1).join("/").trim() : "";
  return slash || null;
}

function productFromRow(row, parent, generatedAt) {
  const sku = normalizeSpaces(row["Unique Merchant SKU"]);
  const title = localizeProductName(row["Product Name"]);
  const model = modelFor(row, parent);
  const productType = productTypeFor(row, parent);
  const images = imageUrls(row, parent);
  const upc = normalizeSpaces(row.UPC) || null;

  return {
    id: `shokz-es-${slugify(sku, "producto")}`,
    title,
    brand: "Shokz",
    model,
    department: "Tecnología",
    category: "Tecnología",
    categories: ["Tecnología"],
    categoryPath: ["Tecnología"],
    description: descriptionFor(row, parent, model, productType),
    shortDescription: `${productType} Shokz con venta y disponibilidad para España.`,
    identifiers: {
      asin: null,
      gtin: null,
      ean: normalizeSpaces(row.EAN) || null,
      upc,
      mpn: normalizeSpaces(row.MPN) || null
    },
    manualMatchApproved: !upc,
    manualMatchReason: !upc
      ? "Variante identificada por SKU único y Parent SKU del feed oficial de Impact"
      : undefined,
    variant: {
      color: variantOptionFor(row, title),
      size: normalizeSpaces(row.Size) || null,
      capacity: null,
      configuration: configurationFor(row)
    },
    condition: "new",
    images,
    attributes: {
      merchantCategory: normalizeSpaces(row.Category) || normalizeSpaces(parent?.Category) || null,
      productType,
      dimensions: null,
      specifications: normalizeSpaces(row.Material) || null,
      warranty: null,
      keywords: unique([
        "Shokz",
        model,
        title,
        normalizeSpaces(row.Color),
        productType
      ]).join(", "),
      promotionalText: normalizeSpaces(row.Promotion) || null
    },
    sourceMerchants: ["shokz-es"],
    sourceReferences: {
      "shokz-es": sku
    },
    sourceUpdatedAt: generatedAt
  };
}

function offerFromRow(row, product, merchant, generatedAt) {
  const sku = normalizeSpaces(row["Unique Merchant SKU"]);
  const tracking = parseImpactAffiliateUrl(row["Product URL"], {
    trackingHost: merchant.impactTrackingHost,
    publisherId: merchant.impactPublisherId,
    campaignId: merchant.impactCampaignId,
    creativeId: merchant.impactCreativeId,
    catalogSource: merchant.impactCatalogSource,
    productSku: sku,
    landingDomains: merchant.landingDomains
  });
  if (!tracking) throw new Error(`Fila ${row.__rowNumber}: enlace de Impact inválido`);

  const price = parseDecimal(row["Current Price"]);
  const originalPrice = parseDecimal(row["Original Price"]);
  return {
    id: `shokz-es:${sku}`,
    productId: product.id,
    merchantId: "shokz-es",
    merchantProductId: sku,
    country: "ES",
    currency: "EUR",
    price,
    previousPrice: originalPrice && originalPrice > price ? originalPrice : null,
    shippingCost: null,
    totalPrice: price,
    availability: "in_stock",
    condition: "new",
    affiliateUrl: tracking.href,
    landingUrl: tracking.landingUrl,
    commissionGroup: null,
    isCommissionable: true,
    stockQuantity: null,
    deliveryTime: null,
    displayPrice: null,
    source: {
      network: "impact",
      trackingHost: tracking.trackingHost,
      publisherId: tracking.publisherId,
      campaignId: tracking.campaignId,
      creativeId: tracking.creativeId,
      catalogSource: tracking.catalogSource,
      parentSku: normalizeSpaces(row["Parent SKU"]) || null,
      feedFormat: "Impact Standardized Format"
    },
    lastUpdatedAt: generatedAt
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJsonAtomic(path, payload, pretty = true) {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.tmp`;
  const spacing = pretty ? 2 : 0;
  await writeFile(temporary, `${JSON.stringify(payload, null, spacing)}\n`, "utf8");
  await rename(temporary, path);
}

export async function importShokzImpactFeed({
  inputPath,
  catalogDir,
  generatedAt = new Date().toISOString(),
  dryRun = false
}) {
  const feed = await readImpactFeed(inputPath);
  const merchantsPath = resolve(catalogDir, "merchants.json");
  const productsPath = resolve(catalogDir, "products.json");
  const offersPath = resolve(catalogDir, "offers.json");
  const reportPath = resolve(catalogDir, "import-reports/shokz-es-last.json");

  const [merchantsPayload, productsPayload, offersPayload] = await Promise.all([
    readJson(merchantsPath),
    readJson(productsPath),
    readJson(offersPath)
  ]);
  const merchant = merchantsPayload.merchants.find((item) => item.id === "shokz-es");
  if (!merchant || merchant.status !== "approved" || merchant.network !== "impact") {
    throw new Error("Falta el merchant aprobado shokz-es con network impact");
  }

  const rowsBySku = new Map(
    feed.records.map((row) => [normalizeSpaces(row["Unique Merchant SKU"]), row])
  );
  if (rowsBySku.size !== feed.records.length) {
    throw new Error("El feed contiene Unique Merchant SKU duplicados");
  }

  const referencedParents = new Set(
    feed.records.map((row) => normalizeSpaces(row["Parent SKU"])).filter(Boolean)
  );
  const skipReasons = {};
  const acceptedRows = [];
  for (const row of feed.records) {
    const reason = rowSkipReason(row, referencedParents, merchant);
    if (reason) {
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
    } else {
      acceptedRows.push(row);
    }
  }
  if (acceptedRows.length === 0) throw new Error("El feed no contiene productos publicables");

  const importedProducts = acceptedRows.map((row) => {
    const parent = rowsBySku.get(normalizeSpaces(row["Parent SKU"])) || null;
    return productFromRow(row, parent, generatedAt);
  });
  const importedOffers = acceptedRows.map((row, index) =>
    offerFromRow(row, importedProducts[index], merchant, generatedAt)
  );

  const importedProductIds = new Set(importedProducts.map((product) => product.id));
  if (importedProductIds.size !== importedProducts.length) {
    throw new Error("La importación generó IDs de producto duplicados");
  }
  const importedOfferIds = new Set(importedOffers.map((offer) => offer.id));
  if (importedOfferIds.size !== importedOffers.length) {
    throw new Error("La importación generó IDs de oferta duplicados");
  }

  const previousProductIds = new Set(
    offersPayload.offers
      .filter((offer) => offer.merchantId === "shokz-es")
      .map((offer) => offer.productId)
  );
  const retainedOffers = offersPayload.offers.filter(
    (offer) => offer.merchantId !== "shokz-es"
  );
  const retainedProductIds = new Set(retainedOffers.map((offer) => offer.productId));
  const retainedProducts = productsPayload.products.filter(
    (product) =>
      !previousProductIds.has(product.id) ||
      retainedProductIds.has(product.id)
  );

  const products = {
    ...productsPayload,
    generatedAt,
    products: [...retainedProducts, ...importedProducts].sort((left, right) =>
      left.id.localeCompare(right.id)
    )
  };
  const offers = {
    ...offersPayload,
    generatedAt,
    offers: [...retainedOffers, ...importedOffers].sort((left, right) =>
      left.id.localeCompare(right.id)
    )
  };

  const familyKeys = new Set(
    importedProducts.map((product) =>
      `${product.brand}|${product.category}|${product.model}|${product.attributes.productType}`
    )
  );
  const report = {
    schemaVersion: 1,
    generatedAt,
    merchantId: "shokz-es",
    sourceFile: feed.sourceFile,
    dryRun,
    totals: {
      feedRows: feed.records.length,
      acceptedRows: acceptedRows.length,
      rejectedRows: feed.records.length - acceptedRows.length,
      expectedFamilies: familyKeys.size,
      productsBefore: productsPayload.products.length,
      productsAfter: products.products.length,
      offersBefore: offersPayload.offers.length,
      offersAfter: offers.offers.length
    },
    skipReasons,
    checks: {
      uniqueMerchantSku: true,
      impactTrackingValidated: true,
      spanishCurrencyOnly: true,
      inStockOnly: true,
      internalCampaignsExcluded: true,
      noindexExcluded: true
    }
  };

  if (!dryRun) {
    await Promise.all([
      writeJsonAtomic(productsPath, products, false),
      writeJsonAtomic(offersPath, offers, false),
      writeJsonAtomic(reportPath, report, true)
    ]);
  }

  return { report, products, offers, importedProducts, importedOffers };
}
