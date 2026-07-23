const ASIN_PATTERN = /^[A-Z0-9]{10}$/;
const AMAZON_HOSTS = new Set([
  "amazon.es",
  "www.amazon.es",
  "smile.amazon.es"
]);

export function normalizeAsin(value) {
  const candidate = String(value || "").trim().toUpperCase();
  return ASIN_PATTERN.test(candidate) ? candidate : null;
}

export function extractAsin(value) {
  const raw = String(value || "").trim();
  const direct = normalizeAsin(raw);
  if (direct) return direct;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (!AMAZON_HOSTS.has(url.hostname.toLowerCase())) return null;

  for (const key of ["asin", "ASIN"]) {
    const queryAsin = normalizeAsin(url.searchParams.get(key));
    if (queryAsin) return queryAsin;
  }

  const pathPatterns = [
    /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/gp\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/gp\/aw\/d\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/product\/([A-Z0-9]{10})(?:[/?]|$)/i
  ];
  for (const pattern of pathPatterns) {
    const match = url.pathname.match(pattern);
    const asin = normalizeAsin(match?.[1]);
    if (asin) return asin;
  }

  return null;
}

export function buildAmazonAffiliateUrl(asinValue, associateTag) {
  const asin = normalizeAsin(asinValue);
  if (!asin) throw new Error(`ASIN inválido: ${asinValue}`);
  const tag = String(associateTag || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/i.test(tag)) {
    throw new Error("ID de seguimiento de Amazon inválido");
  }
  const url = new URL(`https://www.amazon.es/dp/${asin}/ref=nosim`);
  url.searchParams.set("tag", tag);
  return url.href;
}

export function validateAmazonAffiliateUrl(value, expectedTag) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (!["amazon.es", "www.amazon.es"].includes(url.hostname.toLowerCase())) return null;
    const match = url.pathname.match(/^\/dp\/([A-Z0-9]{10})(?:\/ref=nosim)?\/?$/i);
    if (!normalizeAsin(match?.[1])) return null;
    if (url.searchParams.get("tag") !== String(expectedTag || "").trim()) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function parseLooseAmazonInput(text) {
  const raw = String(text || "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  const candidates = raw
    .split(/[\r\n\t,; ]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const accepted = [];
  const rejected = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const asin = extractAsin(candidate);
    if (!asin) {
      rejected.push({ input: candidate, reason: "asin_not_found" });
      continue;
    }
    if (seen.has(asin)) continue;
    seen.add(asin);
    accepted.push({ input: candidate, asin });
  }

  return { accepted, rejected };
}

export function parseCsv(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("CSV inválido: comillas sin cerrar");
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }

  const nonEmpty = rows.filter((columns) => columns.some((value) => value.trim()));
  if (!nonEmpty.length) return [];
  const headers = nonEmpty[0].map((value) => value.trim());
  if (new Set(headers).size !== headers.length) {
    throw new Error("CSV inválido: cabeceras duplicadas");
  }
  return nonEmpty.slice(1).map((columns, rowIndex) => {
    const record = { __row: rowIndex + 2 };
    headers.forEach((header, columnIndex) => {
      record[header] = columns[columnIndex] ?? "";
    });
    return record;
  });
}

export function toCsv(rows, headers) {
  const quote = (value) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [
    headers.map(quote).join(","),
    ...rows.map((row) => headers.map((header) => quote(row[header])).join(","))
  ].join("\n") + "\n";
}

export function splitList(value) {
  return String(value || "")
    .split(/\s*\|\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}
