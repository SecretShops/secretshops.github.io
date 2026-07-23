const ASIN_PATTERN = /^[A-Z0-9]{10}$/;
const ALLOWED_IMAGE_HOSTS = [
  "amazon-adsystem.com",
  "media-amazon.com",
  "ssl-images-amazon.com"
];

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeUrl(value) {
  const decoded = decodeHtml(value).trim();
  return decoded.startsWith("//") ? `https:${decoded}` : decoded;
}

function allowedImageUrl(value) {
  try {
    const url = new URL(normalizeUrl(value));
    return (
      url.protocol === "https:" &&
      ALLOWED_IMAGE_HOSTS.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
      )
    );
  } catch {
    return false;
  }
}

export function extractAsin(value) {
  const source = decodeHtml(value).trim().toUpperCase();
  if (ASIN_PATTERN.test(source)) return source;
  const match = source.match(
    /(?:\/(?:DP|GP\/PRODUCT|GP\/AW\/D)\/|[?&](?:ASIN|ASINS|PD_RD_I)=)([A-Z0-9]{10})(?:[/?&#]|$)/
  );
  return match?.[1] || null;
}

export function parseCsv(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === "\"" && source[index + 1] === "\"") {
        field += "\"";
        index += 1;
      } else if (character === "\"") {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === "\"") {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV inválido: hay comillas sin cerrar.");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  const nonEmptyRows = rows.filter((values) => values.some((value) => value !== ""));
  if (!nonEmptyRows.length) throw new Error("El CSV está vacío.");
  const headers = nonEmptyRows[0].map((header) => header.trim());
  if (!headers.includes("asin_or_url")) {
    throw new Error("El CSV debe contener la columna asin_or_url.");
  }

  return {
    headers,
    rows: nonEmptyRows.slice(1).map((values, index) => {
      const record = Object.fromEntries(
        headers.map((header, column) => [header, values[column] ?? ""])
      );
      record.__row = index + 2;
      return record;
    })
  };
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

export function serializeCsv(headers, rows) {
  return `\uFEFF${[
    headers.map(escapeCsv).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(","))
  ].join("\r\n")}\r\n`;
}

function attributeUrls(payload, attribute) {
  const expression = new RegExp(
    `\\b${attribute}\\s*=\\s*(?:["']([^"']+)["']|([^\\s>]+))`,
    "gi"
  );
  return [...String(payload || "").matchAll(expression)]
    .map((match) => normalizeUrl(match[1] || match[2]))
    .filter(Boolean);
}

export function parseSiteStripePayload(payload, expectedAsin) {
  const source = String(payload || "").trim();
  if (!source) throw new Error("Pega el código de Imagen generado por SiteStripe.");

  const expected = extractAsin(expectedAsin);
  if (!expected) throw new Error("El producto actual no contiene un ASIN válido.");

  const hrefs = attributeUrls(source, "href");
  const sources = attributeUrls(source, "src");
  const plainUrls = [...source.matchAll(/(?:https?:)?\/\/[^\s"'<>]+/gi)]
    .map((match) => normalizeUrl(match[0]))
    .filter(Boolean);
  const allUrls = [...new Set([...hrefs, ...sources, ...plainUrls])];
  const discoveredAsins = new Set(
    [source, ...allUrls].map(extractAsin).filter(Boolean)
  );

  if (discoveredAsins.size && !discoveredAsins.has(expected)) {
    throw new Error(
      `El código pertenece al ASIN ${[...discoveredAsins][0]}, no al producto ${expected}.`
    );
  }

  const imageUrl = allUrls.find(allowedImageUrl);
  if (!imageUrl) {
    throw new Error(
      "No se encontró una imagen oficial de Amazon. En SiteStripe selecciona Imagen, no Texto."
    );
  }

  const amazonUrl =
    hrefs.find((url) => /amazon\.es/i.test(url) && extractAsin(url) === expected) ||
    `https://www.amazon.es/dp/${expected}`;

  return {
    asin: expected,
    imageUrl,
    amazonUrl,
    capturedAt: new Date().toISOString()
  };
}

export function applyCapturedImages(headers, rows, captures) {
  if (!headers.includes("image_urls")) {
    throw new Error("El CSV debe contener la columna image_urls.");
  }
  let updated = 0;
  const outputRows = rows.map((row) => {
    const asin = extractAsin(row.asin_or_url);
    const capture = asin ? captures[asin] : null;
    if (!capture?.imageUrl) return { ...row };
    updated += 1;
    return { ...row, image_urls: capture.imageUrl };
  });
  return { rows: outputRows, updated };
}

