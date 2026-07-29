const GENERIC_VALUES = new Set([
  "modelo disponible",
  "model available",
  "opcao disponivel",
  "opção disponível",
  "standard",
  "default title",
  "default",
  "n a",
  "na"
]);

const COLOR_NAMES = [
  ["black", "Negro", "#171717"], ["negro", "Negro", "#171717"], ["schwarz", "Negro", "#171717"],
  ["white", "Blanco", "#f5f5f2"], ["blanco", "Blanco", "#f5f5f2"], ["weiss", "Blanco", "#f5f5f2"], ["weiß", "Blanco", "#f5f5f2"], ["buttery white", "Blanco crema", "#eee8d9"], ["buttrig weiss", "Blanco crema", "#eee8d9"], ["buttrig weiß", "Blanco crema", "#eee8d9"],
  ["cream", "Crema", "#eee5cf"], ["crema", "Crema", "#eee5cf"], ["creme", "Crema", "#eee5cf"],
  ["beige", "Beige", "#d7c2a3"], ["sand", "Arena", "#cdbb97"], ["arena", "Arena", "#cdbb97"], ["taupe", "Topo", "#8f8174"], ["topo", "Topo", "#8f8174"],
  ["brown", "Marrón", "#6b4734"], ["marron", "Marrón", "#6b4734"], ["marrón", "Marrón", "#6b4734"], ["braun", "Marrón", "#6b4734"], ["cognac", "Coñac", "#9b5b30"], ["coñac", "Coñac", "#9b5b30"],
  ["navy blue", "Azul marino", "#1d2d50"], ["navyblue", "Azul marino", "#1d2d50"], ["navy", "Azul marino", "#1d2d50"], ["azul marino", "Azul marino", "#1d2d50"], ["turquoise", "Turquesa", "#55b9b3"], ["turquesa", "Turquesa", "#55b9b3"], ["turkisblau", "Turquesa", "#55b9b3"], ["türkisblau", "Turquesa", "#55b9b3"], ["blue", "Azul", "#4776b8"], ["azul", "Azul", "#4776b8"], ["blau", "Azul", "#4776b8"], ["cyan", "Azul cian", "#58bfd0"], ["light blue", "Azul claro", "#91c5e8"], ["azul claro", "Azul claro", "#91c5e8"], ["gletscherblau", "Azul glaciar", "#9fcad5"],
  ["green", "Verde", "#4d8455"], ["verde", "Verde", "#4d8455"], ["grun", "Verde", "#4d8455"], ["grün", "Verde", "#4d8455"], ["mint green", "Verde menta", "#9ccdb5"], ["mint", "Verde menta", "#9ccdb5"], ["sage green", "Verde salvia", "#94a88b"], ["sage", "Verde salvia", "#94a88b"], ["grass green", "Verde hierba", "#5a944e"], ["racing green", "Verde racing", "#234c3c"], ["oliva", "Verde oliva", "#7b8151"], ["olive", "Verde oliva", "#7b8151"],
  ["red", "Rojo", "#b33c35"], ["rojo", "Rojo", "#b33c35"], ["rot", "Rojo", "#b33c35"], ["anchor red", "Rojo", "#9b352f"], ["burgundy", "Burdeos", "#6f263d"], ["burdeos", "Burdeos", "#6f263d"],
  ["pink", "Rosa", "#d89aaa"], ["rosa", "Rosa", "#d89aaa"], ["rose", "Rosa", "#d89aaa"], ["rosé", "Rosa", "#d89aaa"], ["hellrosa", "Rosa claro", "#e7b8c4"],
  ["yellow", "Amarillo", "#d8b83f"], ["amarillo", "Amarillo", "#d8b83f"], ["gelb", "Amarillo", "#d8b83f"], ["champagne", "Champán", "#d8c49a"],
  ["orange", "Naranja", "#d47c3b"], ["naranja", "Naranja", "#d47c3b"],
  ["dark gray", "Gris oscuro", "#55595c"], ["dark grey", "Gris oscuro", "#55595c"], ["darkgray", "Gris oscuro", "#55595c"], ["light gray", "Gris claro", "#b5b7b8"], ["light grey", "Gris claro", "#b5b7b8"], ["mist gray", "Gris niebla", "#aeb5b7"], ["mist grey", "Gris niebla", "#aeb5b7"], ["grey", "Gris", "#888b8d"], ["gray", "Gris", "#888b8d"], ["gris", "Gris", "#888b8d"], ["grau", "Gris", "#888b8d"], ["charcoal", "Antracita", "#4f5355"], ["antracita", "Antracita", "#4f5355"], ["anthracite", "Antracita", "#4f5355"],
  ["silver", "Plata", "#b7bcc2"], ["plata", "Plata", "#b7bcc2"], ["plateado", "Plata", "#b7bcc2"], ["gold", "Dorado", "#c4a34c"], ["dorado", "Dorado", "#c4a34c"]
];

const LABELS = {
  es: {
    color: "Color", size: "Talla", length: "Longitud", dimensions: "Medida", material: "Tejido o material",
    orientation: "Orientación", capacity: "Capacidad", configuration: "Configuración",
    style: "Color o diseño", availableSizes: "Tallas disponibles", choose: "Selecciona una opción", design: "Diseño",
    noBasket: "Sin cesta", frontBasket: "Cesta delantera", rearBasket: "Cesta trasera",
    bothBaskets: "Ambas cestas", oneCase: "1 funda", twoCases: "2 fundas"
  },
  pt: {
    color: "Cor", size: "Tamanho", length: "Comprimento", dimensions: "Medida", material: "Tecido ou material",
    orientation: "Orientação", capacity: "Capacidade", configuration: "Configuração",
    style: "Cor ou design", availableSizes: "Tamanhos disponíveis", choose: "Escolha uma opção", design: "Design",
    noBasket: "Sem cesto", frontBasket: "Cesto dianteiro", rearBasket: "Cesto traseiro",
    bothBaskets: "Ambos os cestos", oneCase: "1 capa", twoCases: "2 capas"
  },
  en: {
    color: "Color", size: "Size", length: "Length", dimensions: "Dimensions", material: "Fabric or material",
    orientation: "Orientation", capacity: "Capacity", configuration: "Configuration",
    style: "Color or design", availableSizes: "Available sizes", choose: "Choose an option", design: "Design",
    noBasket: "No basket", frontBasket: "Front basket", rearBasket: "Rear basket",
    bothBaskets: "Both baskets", oneCase: "1 case", twoCases: "2 cases"
  },
  fr: {
    color: "Couleur", size: "Taille", dimensions: "Dimensions", material: "Tissu ou matériau",
    orientation: "Orientation", capacity: "Capacité", configuration: "Configuration",
    style: "Couleur ou design", availableSizes: "Tailles disponibles", choose: "Choisissez une option",
    noBasket: "Sans panier", frontBasket: "Panier avant", rearBasket: "Panier arrière",
    bothBaskets: "Deux paniers", oneCase: "1 housse", twoCases: "2 housses"
  },
  de: {
    color: "Farbe", size: "Größe", length: "Länge", dimensions: "Maße", material: "Stoff oder Material",
    orientation: "Ausrichtung", capacity: "Kapazität", configuration: "Konfiguration",
    style: "Farbe oder Design", availableSizes: "Verfügbare Größen", choose: "Option auswählen", design: "Design",
    noBasket: "Ohne Korb", frontBasket: "Vorderkorb", rearBasket: "Hinterkorb",
    bothBaskets: "Beide Körbe", oneCase: "1 Bezug", twoCases: "2 Bezüge"
  },
  it: {
    color: "Colore", size: "Taglia", length: "Lunghezza", dimensions: "Misura", material: "Tessuto o materiale",
    orientation: "Orientamento", capacity: "Capacità", configuration: "Configurazione",
    style: "Colore o design", availableSizes: "Taglie disponibili", choose: "Scegli un'opzione", design: "Design",
    noBasket: "Senza cestino", frontBasket: "Cestino anteriore", rearBasket: "Cestino posteriore",
    bothBaskets: "Entrambi i cestini", oneCase: "1 federa", twoCases: "2 federe"
  }
};

const ATTRIBUTE_ORDER = ["color", "style", "size", "length", "configuration", "dimensions", "material", "capacity", "orientation"];

export function variantLabels(locale = "es-ES") {
  const language = String(locale || "es").slice(0, 2).toLowerCase();
  return LABELS[language] || LABELS.en;
}

export function normalizeVariantText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/%20/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9+./| ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clean(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text || GENERIC_VALUES.has(normalizeVariantText(text))) return null;
  if (/^\d{6,}$/.test(text)) return null;
  if (/^tallas disponibles:/i.test(text)) return null;
  if (/^consulta la ficha/i.test(text)) return null;
  if (/^x\s+x\s+cm$/i.test(text)) return null;
  return text;
}

function normalizedKey(value) {
  return normalizeVariantText(value)
    .replace(/\s*[x×]\s*/g, "x")
    .replace(/\s+(cm|mm|inch|inches)\b/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function splitAvailableSizes(value) {
  const text = clean(value);
  if (!text || !text.includes(",")) return [];
  const parts = text.split(",").map((item) => item.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 30) return [];
  if (!parts.every((part) => /^(?:\d{1,2}(?:[.,]\d)?\+?|\d{2,4}|[2-6]?xs|xs|s\+?|m|l|xl|xxl|xxxl|3xl|4xl|5xl|s-m|m-l|l-xl|xl-xxl|xs-s|eu\s*\d+(?:[.,]\d+)?(?:\/us\s*\d+(?:[.,]\d+)?)?)$/i.test(part))) return [];
  return parts;
}

function normalizedSize(value) {
  const text = clean(value);
  if (!text) return null;
  const available = splitAvailableSizes(text);
  if (available.length) return null;
  if (/^(?:one size|un|única|unica|talla única|tamanho único)$/i.test(text)) return null;
  return text.replace(/\s*\|\s*/g, " / ").replace(/\s+/g, " ").trim();
}

function inferSizeFromMpn(mpn) {
  const text = clean(mpn);
  if (!text) return null;
  const parts = text.split(".");
  if (parts.length < 2) return null;
  let suffix = parts.slice(1).join(".").trim();
  suffix = suffix.replace(/-righ(?:t)?$/i, "").replace(/-lef(?:t)?$/i, "");
  if (/^(?:xs|s|m|l|xl|xxl|xxxl|3xl|4xl|5xl|s\/m|m\/l|l\/xl|xs\/s)$/i.test(suffix)) return suffix.toUpperCase();
  if (/^(?:3538|3942|4346|4750)$/.test(suffix)) return `${suffix.slice(0, 2)}–${suffix.slice(2)}`;
  const numericRange = suffix.match(/^(\d{1,2})[\/-](\d{1,2})$/);
  if (numericRange) return `${numericRange[1]}–${numericRange[2]}`;
  if (/^\d{1,2}(?:\.\d)?$/.test(suffix)) return suffix;
  return null;
}

function inferOrientationFromMpn(mpn) {
  const text = String(mpn || "");
  if (/-righ(?:t)?$/i.test(text)) return "Derecha";
  if (/-lef(?:t)?$/i.test(text)) return "Izquierda";
  return null;
}

function findColor(value) {
  const source = normalizeVariantText(value);
  if (!source) return null;
  const sorted = [...COLOR_NAMES].sort((a, b) => b[0].length - a[0].length);
  const found = sorted.find(([term]) => new RegExp(`(?:^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9])`, "i").test(source));
  return found ? { value: found[1], swatch: found[2] } : null;
}

function explicitColorValue(value) {
  const text = clean(value);
  if (!text) return null;
  const normalized = normalizeVariantText(text);
  const exact = COLOR_NAMES.find(([term]) => normalizeVariantText(term) === normalized);
  if (exact) return { value: exact[1], swatch: exact[2] };
  const base = findColor(text);
  return { value: text, swatch: base?.swatch || null };
}

function decodeImageText(images = []) {
  return images.map((image) => {
    try {
      return decodeURIComponent(String(image));
    } catch {
      return String(image);
    }
  }).join(" ");
}

function configurationLabel(value, labels) {
  const text = clean(value);
  if (!text) return null;
  const normalized = normalizeVariantText(text);
  const front = /front basket|cesta delantera|panier avant|vorderkorb|cesto dianteiro/.test(normalized);
  const rear = /rear basket|cesta trasera|panier arriere|hinterkorb|cesto traseiro/.test(normalized);
  if (front && rear) return labels.bothBaskets;
  if (front) return labels.frontBasket;
  if (rear) return labels.rearBasket;
  if (/e bike\+rack\+fender|e-bike\+rack\+fender/.test(normalized) && !front && !rear) return labels.noBasket;
  if (/^1\s*(?:case|cases|funda|fundas)$/.test(normalized)) return labels.oneCase;
  if (/^2\s*(?:case|cases|funda|fundas)$/.test(normalized)) return labels.twoCases;
  return text.replace(/\+/g, " + ").replace(/\s+/g, " ").trim();
}

function labelTokens(variant, family) {
  const raw = clean(variant.label);
  if (!raw) return [];
  return raw.split(/\s+·\s+|\s+\|\s+/).map(clean).filter(Boolean).filter((token) => normalizedKey(token) !== normalizedKey(family.title));
}

function looksLikeDimensions(value) {
  return /\d+(?:[.,]\d+)?\s*(?:x|×)\s*\d+/i.test(String(value || ""));
}

function looksLikeSize(value) {
  const text = String(value || "").trim();
  return /^(?:(?:[2-6]?xs|xs|s\+?|m|l|xl|xxl|xxxl|3xl|4xl|5xl)(?:\s*-\s*for\s*\d+\s*-\s*\d+\s*cm)?|s-m|m-l|l-xl|xl-xxl|xs-s|(?:eu|it|uk|us)\s*\d+(?:[.,]\d+)?(?:\s*\|\s*(?:[2-6]?xs|xs|s|m|l|xl|xxl|xxxl|3xl|4xl|5xl|(?:eu|it|uk|us)\s*\d+(?:[.,]\d+)?))?|\d{1,2}(?:[.,]\d)?(?:\s*cm\s*\/\s*\d+\s*inches)?|(?:twin(?:\s*xl)?|full|queen|king|cal\s*king|standard|jumbo|lumbar|euro)(?:\s*\([^)]*\))?(?:\s*\([^)]*\))?)$/i.test(text);
}

function lengthFromToken(value, locale) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*(?:"|″|inch|inches)(?:\s*\[?pre[- ]?sale\]?)?$/i);
  if (!match) return null;
  const preorder = /pre[- ]?sale/i.test(text);
  const language = String(locale || "es").slice(0, 2).toLowerCase();
  const note = preorder
    ? language === "es" ? " (preventa)" : language === "pt" ? " (pré-venda)" : language === "fr" ? " (précommande)" : language === "de" ? " (Vorbestellung)" : language === "it" ? " (preordine)" : " (pre-order)"
    : "";
  return `${match[1].replace(",", ".")}″${note}`;
}

function primaryImage(variant, family) {
  return variant.images?.[0] || family.images?.[0] || family.image || "";
}

function offerTotal(offer) {
  if (Number.isFinite(Number(offer?.totalPrice))) return Number(offer.totalPrice);
  if (!Number.isFinite(Number(offer?.price))) return Infinity;
  return Number(offer.price) + (Number.isFinite(Number(offer?.shippingCost)) ? Number(offer.shippingCost) : 0);
}

function bestVariant(left, right) {
  const leftPrice = Math.min(...(left.offers || []).map(offerTotal), Infinity);
  const rightPrice = Math.min(...(right.offers || []).map(offerTotal), Infinity);
  return rightPrice < leftPrice ? right : left;
}

function variantTitleTokens(variant, family) {
  const title = clean(variant.title);
  const familyTitle = clean(family.title);
  if (!title || !familyTitle) return [];
  const prefix = `${familyTitle} - `;
  if (!title.toLowerCase().startsWith(prefix.toLowerCase())) return [];
  return title.slice(prefix.length).split(/\s*\/\s*/).map(clean).filter(Boolean);
}

function isIgnoredTitleToken(value) {
  return /^(?:unisex|men|women|mens|womens|hombre|mujer|homme|femme|damen|herren)$/i.test(String(value || "").trim());
}

function inferVariantAttributes(variant, family, locale) {
  const labels = variantLabels(locale);
  const attributes = {};
  const explicitColor = clean(variant.color);
  const color = explicitColor ? explicitColorValue(explicitColor) : null;
  if (color) attributes.color = color.value;

  const explicitSize = normalizedSize(variant.size) || inferSizeFromMpn(variant.mpn);
  if (explicitSize) attributes.size = explicitSize;

  const explicitOrientation = clean(variant.orientation) || inferOrientationFromMpn(variant.mpn);
  if (explicitOrientation) attributes.orientation = explicitOrientation;

  const dimensions = clean(variant.dimensions);
  if (dimensions) attributes.dimensions = dimensions;

  const material = clean(variant.material);
  if (material && normalizedKey(material) !== normalizedKey(dimensions)) attributes.material = material;

  const capacity = clean(variant.capacity);
  if (capacity) attributes.capacity = capacity;

  const explicitConfiguration = configurationLabel(variant.configuration, labels);
  if (explicitConfiguration && normalizedKey(explicitConfiguration) !== normalizedKey(dimensions)) {
    attributes.configuration = explicitConfiguration;
  }

  for (const token of labelTokens(variant, family)) {
    if (!attributes.color) {
      const candidate = findColor(token);
      if (candidate) {
        attributes.color = candidate.value;
        continue;
      }
    }
    if (!attributes.configuration && /basket|cesta|rack|fender|case|funda|pack|combo|edition|edición|edicao|edition/i.test(token)) {
      attributes.configuration = configurationLabel(token, labels);
      continue;
    }
    if (!attributes.length) {
      const length = lengthFromToken(token, locale);
      if (length) {
        attributes.length = length;
        continue;
      }
    }
    if (!attributes.dimensions && looksLikeDimensions(token) && !looksLikeSize(token)) {
      attributes.dimensions = token;
      continue;
    }
    if (!attributes.size && looksLikeSize(token)) {
      attributes.size = token;
      continue;
    }
  }

  for (const token of variantTitleTokens(variant, family)) {
    if (isIgnoredTitleToken(token)) continue;
    const tokenKey = normalizedKey(token);
    const explicitSizeKey = normalizedKey(attributes.size);
    if (explicitSizeKey && tokenKey && (explicitSizeKey.includes(tokenKey) || tokenKey.includes(explicitSizeKey))) continue;
    const candidate = findColor(token);
    if (candidate) {
      if (!attributes.color) attributes.color = candidate.value;
      continue;
    }
    if (looksLikeSize(token) || (attributes.size && normalizedKey(token) === normalizedKey(attributes.size))) {
      if (!attributes.size) attributes.size = token;
      continue;
    }
    const length = lengthFromToken(token, locale);
    if (length) {
      if (!attributes.length) attributes.length = length;
      continue;
    }
    if (attributes.dimensions && normalizedKey(token) === normalizedKey(attributes.dimensions)) continue;
    if (attributes.material && normalizedKey(token) === normalizedKey(attributes.material)) continue;
    if (!attributes.configuration && token.length <= 90) {
      attributes.configuration = configurationLabel(token, labels);
    }
  }

  if (!attributes.color) {
    const imageColor = findColor(decodeImageText(variant.images));
    if (imageColor) attributes.color = imageColor.value;
  }

  return attributes;
}

function signature(attributes) {
  return ATTRIBUTE_ORDER.map((key) => `${key}:${normalizedKey(attributes[key])}`).filter((part) => !part.endsWith(":" )).join("|");
}

function commonAvailableSizes(variants) {
  const lists = variants.map((variant) => splitAvailableSizes(variant.size)).filter((list) => list.length);
  if (!lists.length) return [];
  const first = lists[0].map(normalizedKey).join("|");
  if (!lists.every((list) => list.map(normalizedKey).join("|") === first)) return [];
  return [...new Set(lists[0])];
}

function valueSort(key, values) {
  if (key !== "size") return values;
  const rank = new Map([["xxxs",0],["xxs",1],["xs",2],["s",3],["m",4],["l",5],["xl",6],["xxl",7],["xxxl",8],["3xl",8],["4xl",9],["5xl",10]]);
  return [...values].sort((a,b) => {
    const an=normalizedKey(a), bn=normalizedKey(b);
    if (rank.has(an) || rank.has(bn)) return (rank.get(an) ?? 99) - (rank.get(bn) ?? 99);
    const av=parseFloat(an.replace(",",".")), bv=parseFloat(bn.replace(",","."));
    if (Number.isFinite(av) && Number.isFinite(bv)) return av-bv;
    return String(a).localeCompare(String(b), undefined, {numeric:true});
  });
}

export function buildVariantPresentation(family, selectedVariantId = null, locale = "es-ES") {
  const sourceVariants = Array.isArray(family?.variants) ? family.variants : [];
  let inferred = sourceVariants.map((variant, index) => ({
    ...variant,
    _index: index,
    _attributes: inferVariantAttributes(variant, family, locale),
    _image: primaryImage(variant, family)
  }));

  // Product-level placeholder variants duplicate a real child variant in some feeds.
  // Remove them when at least one exact variant exposes a meaningful attribute.
  if (inferred.length > 1 && inferred.some((variant) => Object.keys(variant._attributes).length > 0)) {
    const filtered = inferred.filter((variant) => {
      const genericLabel = !clean(variant.label);
      const sameTitle = normalizedKey(variant.title) === normalizedKey(family.title);
      const noAttributes = Object.keys(variant._attributes).length === 0;
      return !(genericLabel && sameTitle && noAttributes);
    });
    if (filtered.length) inferred = filtered;
  }

  // If the feed distinguishes otherwise identical variants only through images,
  // expose a small visual selector instead of a list of generic values.
  const labels = variantLabels(locale);
  const imageKeys = [...new Set(inferred.map((variant) => normalizedKey(variant._image)).filter(Boolean))];
  const initialSignatures = inferred.map((variant) => signature(variant._attributes) || "single");
  const signatureBuckets = new Map();
  initialSignatures.forEach((key, index) => {
    if (!signatureBuckets.has(key)) signatureBuckets.set(key, []);
    signatureBuckets.get(key).push(inferred[index]);
  });
  const repeatedSignature = [...signatureBuckets.values()].some((bucket) => bucket.length > 1);
  const noMeaningful = inferred.every((variant) => Object.keys(variant._attributes).length === 0);
  const meaningfulKeys = ATTRIBUTE_ORDER.filter((key) => key !== "style" && new Set(
    inferred.map((variant) => normalizedKey(variant._attributes[key])).filter(Boolean)
  ).size > 1);
  const canUseVisualFallback = imageKeys.length > 1 && imageKeys.length <= 12;

  if (canUseVisualFallback && (noMeaningful || meaningfulKeys.length === 0)) {
    inferred.forEach((variant) => {
      const imageIndex = imageKeys.indexOf(normalizedKey(variant._image));
      if (imageIndex >= 0) variant._attributes.style = `${labels.design} ${imageIndex + 1}`;
    });
  } else if (canUseVisualFallback && repeatedSignature) {
    signatureBuckets.forEach((bucket) => {
      const bucketImages = [...new Set(bucket.map((variant) => normalizedKey(variant._image)).filter(Boolean))];
      if (bucketImages.length <= 1) return;
      bucket.forEach((variant) => {
        const imageIndex = bucketImages.indexOf(normalizedKey(variant._image));
        if (imageIndex >= 0) variant._attributes.style = `${labels.design} ${imageIndex + 1}`;
      });
    });
  }

  const deduped = new Map();
  inferred.forEach((variant) => {
    const key = signature(variant._attributes) || "single";
    const existing = deduped.get(key);
    deduped.set(key, existing ? bestVariant(existing, variant) : variant);
  });
  const variants = [...deduped.values()];

  const selectedSource = inferred.find((variant) => variant.id === selectedVariantId);
  const selectedSignature = selectedSource ? signature(selectedSource._attributes) || "single" : null;
  const selected = variants.find((variant) => variant.id === selectedVariantId)
    || (selectedSignature ? deduped.get(selectedSignature) : null)
    || variants[0]
    || null;

  const groups = ATTRIBUTE_ORDER.map((key) => {
    const valueMap = new Map();
    variants.map((variant) => variant._attributes[key]).filter(Boolean).forEach((value) => {
      const normalized = normalizedKey(value);
      if (!valueMap.has(normalized)) valueMap.set(normalized, value);
    });
    const values = valueSort(key, [...valueMap.values()]);
    if (values.length <= 1) return null;
    const type = key === "color" || key === "style"
      ? "visual"
      : values.length > (key === "size" ? 14 : 9) ? "select" : "buttons";
    return {
      key,
      label: variantLabels(locale)[key],
      type,
      values: values.map((value) => {
        const matching = variants.filter((variant) => normalizedKey(variant._attributes[key]) === normalizedKey(value));
        const visual = matching[0];
        const color = key === "color" ? findColor(value) : null;
        return {
          value,
          image: visual?._image || "",
          swatch: color?.swatch || null,
          selected: selected ? normalizedKey(selected._attributes[key]) === normalizedKey(value) : false
        };
      })
    };
  }).filter(Boolean);

  return {
    family,
    variants,
    selected,
    groups,
    availableSizes: groups.some((group) => group.key === "size") ? [] : commonAvailableSizes(sourceVariants)
  };
}

export function chooseVariantForAttribute(presentation, key, value) {
  const variants = presentation?.variants || [];
  const selected = presentation?.selected;
  const normalizedValue = normalizedKey(value);
  const candidates = variants.filter((variant) => normalizedKey(variant._attributes[key]) === normalizedValue);
  if (!candidates.length) return selected || variants[0] || null;
  if (!selected) return candidates[0];

  const otherKeys = (presentation.groups || []).map((group) => group.key).filter((groupKey) => groupKey !== key);
  return [...candidates].sort((left, right) => {
    const score = (variant) => otherKeys.reduce((sum, groupKey) => (
      normalizedKey(variant._attributes[groupKey]) === normalizedKey(selected._attributes[groupKey]) ? sum + 1 : sum
    ), 0);
    return score(right) - score(left) || left._index - right._index;
  })[0];
}

export function variantValueAvailable(presentation, key, value) {
  const selected = presentation?.selected;
  if (!selected) return true;
  const normalizedValue = normalizedKey(value);
  const otherKeys = (presentation.groups || []).map((group) => group.key).filter((groupKey) => groupKey !== key);
  return (presentation.variants || []).some((variant) => (
    normalizedKey(variant._attributes[key]) === normalizedValue
    && otherKeys.every((groupKey) => {
      const selectedValue = selected._attributes[groupKey];
      return !selectedValue || normalizedKey(variant._attributes[groupKey]) === normalizedKey(selectedValue);
    })
  ));
}
