import {
  bestOffer,
  displayOfferPrice,
  offerTotal
} from "./catalog-core.js";

const PILOT_TYPES = [
  {
    id: "open-ear-headphones",
    label: "Auriculares open-ear",
    include: [
      /\bopen[\s-]?ear\b/,
      /\bconduccion osea\b/,
      /\bbone conduction\b/,
      /\bopenrun\w*\b/,
      /\bopenfit\w*\b/,
      /\bopenswim\w*\b/,
      /\bopen(?:comm|dots|move|meet)\w*\b/
    ],
    exclude: [
      /\bfunda\b/,
      /\bestuche\b/,
      /\bcable\b/,
      /\brepuesto\b/,
      /\baccesorio\b/,
      /\balmohadilla\w*\b/,
      /\bcargador\w*\b/,
      /\bbolsa\b/,
      /\bgorro\b/,
      /\brinonera\b/,
      /\bvisera\b/
    ]
  },
  {
    id: "pressure-washer",
    label: "Limpiadoras a presión",
    include: [
      /\bhidrolimpiadora\b/,
      /\blimpiadora(?:s)? a presion\b/,
      /\bpressure washer\b/,
      /\bnettoyeur haute pression\b/,
      /\bhochdruckreiniger\b/
    ],
    exclude: [
      /\bmanguera\b/,
      /\bboquilla\b/,
      /\bpistola\b/,
      /\bconector\b/,
      /\brepuesto\b/,
      /\baccesorio\b/,
      /\blanza\b/
    ]
  },
  {
    id: "universal-tv-remote",
    label: "Mandos universales para TV",
    include: [
      /\bmando(?:s)? universal(?:es)?\b.*\b(?:tv|television|televisor)\b/,
      /\b(?:tv|television|televisor)\b.*\bmando(?:s)? universal(?:es)?\b/,
      /\buniversal (?:tv|television) remote\b/,
      /\btelecommande universelle\b.*\b(?:tv|television)\b/
    ],
    exclude: [/\bgaraje\b/, /\bgarage\b/, /\bpuerta\b/, /\bporton\b/, /\bcoche\b/]
  },
  {
    id: "external-storage",
    label: "Almacenamiento externo",
    include: [
      /\bssd externo\b/,
      /\bdisco duro externo\b/,
      /\bexternal (?:ssd|hard drive|storage)\b/,
      /\bportable (?:ssd|hard drive)\b/,
      /\bunidad externa\b/
    ],
    exclude: [/\bfunda\b/, /\bcaja vacia\b/, /\benclosure\b/, /\badaptador\b/, /\bcable\b/]
  },
  {
    id: "adult-dog-dry-food",
    label: "Comida seca para perros adultos",
    include: [
      /\b(?:pienso|comida seca|alimento seco)\b.*\bperro(?:s)?\b/,
      /\bperro(?:s)?\b.*\b(?:pienso|comida seca|alimento seco)\b/,
      /\badult dog dry food\b/,
      /\bdry dog food\b.*\badult\b/
    ],
    require: [/\badult(?:o|os|a|as)?\b/],
    exclude: [
      /\bcachorro(?:s)?\b/,
      /\bpuppy\b/,
      /\bveterinari\w*\b/,
      /\brenal\b/,
      /\bhepatic\w*\b/,
      /\bhypoallergenic\w*\b/,
      /\bdiabetic\w*\b/
    ]
  }
];

const ATTRIBUTE_LABELS = {
  capacity: "Capacidad",
  count: "Cantidad",
  power: "Potencia",
  pressure: "Presión",
  flow: "Caudal",
  autonomy: "Autonomía",
  weight: "Peso",
  volume: "Volumen",
  interface: "Conexión",
  protection: "Protección",
  size: "Tamaño"
};

const UNIT_LABELS = {
  gb: "GB",
  tb: "TB",
  kg: "kg",
  g: "g",
  l: "l",
  ml: "ml",
  unit: "unidad",
  seat: "plaza",
  dose: "dosis"
};

export function normalizeFunctionalText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceText(family) {
  return normalizeFunctionalText([
    family?.title,
    family?.brand,
    family?.model,
    family?.category,
    ...(family?.categories || []),
    ...(family?.groups || []),
    ...(family?.variants || []).slice(0, 4).flatMap((variant) => [
      variant?.title,
      variant?.label,
      variant?.capacity,
      variant?.configuration,
      variant?.dimensions
    ])
  ].filter(Boolean).join(" "));
}

function firstMatch(text, regexes = []) {
  return regexes.some((pattern) => pattern.test(text));
}

function numberValue(value) {
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractMetric(text, patterns) {
  for (const { regex, unit, multiplier = 1 } of patterns) {
    const match = text.match(regex);
    if (!match) continue;
    const value = numberValue(match[1]);
    if (value === null) continue;
    return { value: value * multiplier, unit, display: `${match[1].replace(".", ",")} ${unit}` };
  }
  return null;
}

function extractAttributes(family, text) {
  const joined = `${text} ${normalizeFunctionalText(
    (family?.variants || []).map((variant) => [
      variant?.capacity,
      variant?.configuration,
      variant?.dimensions,
      variant?.label
    ].filter(Boolean).join(" ")).join(" ")
  )}`;
  const attributes = {};

  const storage = extractMetric(joined, [
    { regex: /\b(\d+(?:[.,]\d+)?)\s*tb\b/, unit: "TB" },
    { regex: /\b(\d+(?:[.,]\d+)?)\s*gb\b/, unit: "GB" }
  ]);
  if (storage) attributes.capacity = storage;

  const weight = extractMetric(joined, [
    { regex: /\b(\d+(?:[.,]\d+)?)\s*kg\b/, unit: "kg" },
    { regex: /\b(\d+(?:[.,]\d+)?)\s*g\b/, unit: "g" }
  ]);
  if (weight) attributes.weight = weight;

  const volume = extractMetric(joined, [
    { regex: /\b(\d+(?:[.,]\d+)?)\s*(?:litros?|l)\b/, unit: "l" },
    { regex: /\b(\d+(?:[.,]\d+)?)\s*ml\b/, unit: "ml" }
  ]);
  if (volume) attributes.volume = volume;

  const count = extractMetric(joined, [
    { regex: /\b(\d+)\s*(?:unidades?|uds?|piezas?|pcs?)\b/, unit: "unidades" },
    { regex: /\bpack\s*(?:de\s*)?(\d+)\b/, unit: "unidades" },
    { regex: /\b(\d+)\s*(?:plazas?|personas?)\b/, unit: "plazas" }
  ]);
  if (count) attributes.count = count;

  const power = extractMetric(joined, [
    { regex: /\b(\d+(?:[.,]\d+)?)\s*kw\b/, unit: "kW" },
    { regex: /\b(\d+(?:[.,]\d+)?)\s*w\b/, unit: "W" }
  ]);
  if (power) attributes.power = power;

  const pressure = extractMetric(joined, [
    { regex: /\b(\d+(?:[.,]\d+)?)\s*bar\b/, unit: "bar" },
    { regex: /\b(\d+(?:[.,]\d+)?)\s*psi\b/, unit: "psi" }
  ]);
  if (pressure) attributes.pressure = pressure;

  const flow = extractMetric(joined, [
    { regex: /\b(\d+(?:[.,]\d+)?)\s*l\s*(?:\/|por)\s*h\b/, unit: "l/h" }
  ]);
  if (flow) attributes.flow = flow;

  const autonomy = extractMetric(joined, [
    { regex: /\b(\d+(?:[.,]\d+)?)\s*(?:horas?|h)\b/, unit: "h" }
  ]);
  if (autonomy) attributes.autonomy = autonomy;

  const interfaces = [
    ["Thunderbolt", /\bthunderbolt\b/],
    ["USB-C", /\busb\s*c\b|\btype\s*c\b/],
    ["USB 3.2", /\busb\s*3\s*2\b/],
    ["USB 3.0", /\busb\s*3\s*0\b/],
    ["USB", /\busb\b/]
  ];
  const detectedInterface = interfaces.find(([, pattern]) => pattern.test(joined));
  if (detectedInterface) attributes.interface = { display: detectedInterface[0] };

  const protection = [
    /\bip\s*68\b/.test(joined) ? "IP68" : "",
    /\bip\s*67\b/.test(joined) ? "IP67" : "",
    /\bresistente al agua\b|\bwaterproof\b/.test(joined) ? "Resistencia al agua" : ""
  ].find(Boolean);
  if (protection) attributes.protection = { display: protection };

  return attributes;
}

function contextFor(type, text) {
  if (type === "pressure-washer") {
    if (/\bprofesional\b|\bindustrial\b|\bcommercial\b/.test(text)) return "professional";
    return "domestic";
  }
  if (type === "open-ear-headphones") {
    if (/\bnatacion\b|\bswim\b|\bopenswim\w*\b/.test(text)) return "swimming";
    if (/\brunning\b|\bdeporte\b|\bsport\b|\bopenrun\w*\b/.test(text)) return "sport";
    return "general";
  }
  return "general";
}

function compatibilityFor(type, text) {
  if (type === "adult-dog-dry-food") {
    return { species: "dog", lifeStage: "adult", therapeutic: false };
  }
  if (type === "universal-tv-remote") {
    return { deviceClass: "television" };
  }
  if (type === "external-storage") {
    // La interfaz se presenta como atributo comparable. No se usa como bloqueo
    // automático porque USB, USB-C y Thunderbolt pueden coexistir mediante
    // puertos compatibles o adaptadores; la interfaz debe quedar visible para
    // que el usuario confirme la compatibilidad de su dispositivo.
    return { deviceClass: "external-storage" };
  }
  return {};
}

function normalizedQuantity(attributes) {
  const candidates = [
    ["capacity", attributes.capacity],
    ["weight", attributes.weight],
    ["volume", attributes.volume],
    ["count", attributes.count]
  ];
  for (const [key, metric] of candidates) {
    if (!metric?.value || metric.value <= 0) continue;
    let value = metric.value;
    let unit = String(metric.unit || "").toLowerCase();
    if (unit === "tb") {
      value *= 1024;
      unit = "gb";
    } else if (unit === "g") {
      value /= 1000;
      unit = "kg";
    } else if (unit === "ml") {
      value /= 1000;
      unit = "l";
    } else if (unit === "unidades") {
      unit = "unit";
    } else if (unit === "plazas") {
      unit = "seat";
    }
    return { key, value, unit };
  }
  return null;
}

export function classifyFunctionalFamily(family) {
  const text = sourceText(family);
  const rule = PILOT_TYPES.find((candidate) =>
    firstMatch(text, candidate.include) &&
    !firstMatch(text, candidate.exclude) &&
    (!candidate.require || firstMatch(text, candidate.require))
  );
  if (!rule) return null;

  const attributes = extractAttributes(family, text);
  const best = bestOffer(family);
  const totalPrice = offerTotal(best);
  const quantity = normalizedQuantity(attributes);
  const normalizedPrice = Number.isFinite(totalPrice) && quantity
    ? totalPrice / quantity.value
    : null;

  return {
    familyId: family.id,
    functionalType: rule.id,
    functionalLabel: rule.label,
    context: contextFor(rule.id, text),
    compatibility: compatibilityFor(rule.id, text),
    attributes,
    totalPrice: Number.isFinite(totalPrice) ? totalPrice : null,
    displayPrice: displayOfferPrice(best),
    normalizedPrice,
    normalizedUnit: quantity?.unit || null,
    brand: String(family.brand || "").trim(),
    model: String(family.model || "").trim()
  };
}

function criticalCompatibility(left, right) {
  if (!left || !right) return { compatible: false, reason: "Sin clasificación funcional suficiente" };
  if (left.functionalType !== right.functionalType) {
    return { compatible: false, reason: "Resuelven funciones distintas" };
  }
  const swimmingContext = [left.context, right.context].includes("swimming");
  if (
    left.context !== right.context &&
    (swimmingContext || ![left.context, right.context].includes("general"))
  ) {
    return { compatible: false, reason: "Están destinados a contextos de uso incompatibles" };
  }
  const keys = new Set([
    ...Object.keys(left.compatibility || {}),
    ...Object.keys(right.compatibility || {})
  ]);
  for (const key of keys) {
    const a = left.compatibility?.[key];
    const b = right.compatibility?.[key];
    if (a === undefined || b === undefined || a === "unspecified" || b === "unspecified") continue;
    if (a !== b) {
      return { compatible: false, reason: `Incompatibilidad crítica: ${key}` };
    }
  }
  return { compatible: true, reason: "Compatibilidad funcional suficiente" };
}

export function functionalCompatibility(leftFamily, rightFamily) {
  return criticalCompatibility(
    classifyFunctionalFamily(leftFamily),
    classifyFunctionalFamily(rightFamily)
  );
}

function relationFor(target, candidate) {
  const sameBrand = normalizeFunctionalText(target.brand) &&
    normalizeFunctionalText(target.brand) === normalizeFunctionalText(candidate.brand);
  if (sameBrand) return "same-family";
  if (
    Number.isFinite(target.totalPrice) &&
    Number.isFinite(candidate.totalPrice) &&
    candidate.totalPrice < target.totalPrice
  ) return "economic";
  const targetMetricCount = Object.keys(target.attributes).length;
  const candidateMetricCount = Object.keys(candidate.attributes).length;
  if (candidateMetricCount > targetMetricCount) return "complete";
  return "functional";
}

function relationLabel(relation) {
  if (relation === "same-family") return "Misma familia o generación";
  if (relation === "economic") return "Más económico";
  if (relation === "complete") return "Opción más completa";
  return "Alternativa para la misma función";
}

function comparableMetricScore(left, right) {
  const keys = new Set([
    ...Object.keys(left.attributes || {}),
    ...Object.keys(right.attributes || {})
  ]);
  let shared = 0;
  for (const key of keys) {
    if (left.attributes?.[key] && right.attributes?.[key]) shared += 1;
  }
  return shared;
}

export function functionalAlternatives(families, targetFamily, limit = 6) {
  const target = classifyFunctionalFamily(targetFamily);
  if (!target) return [];

  return families
    .filter((candidate) => candidate?.id !== targetFamily.id)
    .map((family) => ({ family, classification: classifyFunctionalFamily(family) }))
    .filter(({ classification }) => criticalCompatibility(target, classification).compatible)
    .map(({ family, classification }) => {
      const difference = Number.isFinite(target.totalPrice) && Number.isFinite(classification.totalPrice)
        ? classification.totalPrice - target.totalPrice
        : null;
      const relation = relationFor(target, classification);
      return {
        family,
        classification,
        relation,
        relationLabel: relationLabel(relation),
        priceDifference: difference,
        sharedMetrics: comparableMetricScore(target, classification)
      };
    })
    .sort((left, right) =>
      (right.sharedMetrics - left.sharedMetrics) ||
      (right.family.secretScore - left.family.secretScore) ||
      (Math.abs(left.priceDifference ?? Infinity) - Math.abs(right.priceDifference ?? Infinity))
    )
    .slice(0, Math.max(0, limit));
}

export function comparisonContext(families) {
  const entries = families.map((family) => ({
    family,
    classification: classifyFunctionalFamily(family)
  }));
  if (entries.length < 2) {
    return {
      mode: entries[0]?.classification ? "functional" : "manual",
      compatible: true,
      label: entries[0]?.classification?.functionalLabel || "Comparación manual",
      entries,
      warning: ""
    };
  }
  if (entries.some((entry) => !entry.classification)) {
    return {
      mode: "manual",
      compatible: false,
      label: "Comparación manual",
      entries,
      warning: "No hay clasificación funcional suficiente para afirmar que todos los productos resuelven la misma necesidad."
    };
  }
  const reference = entries[0].classification;
  const incompatible = entries.slice(1).find((entry) =>
    !criticalCompatibility(reference, entry.classification).compatible
  );
  return {
    mode: "functional",
    compatible: !incompatible,
    label: reference.functionalLabel,
    entries,
    warning: incompatible
      ? criticalCompatibility(reference, incompatible.classification).reason
      : "Alternativas para la misma función. Las diferencias de precio y prestaciones se muestran sin afirmar que sean productos idénticos."
  };
}

export function comparableRows(families) {
  const entries = families.map((family) => ({
    family,
    classification: classifyFunctionalFamily(family)
  }));
  const attributeKeys = [...new Set(entries.flatMap((entry) =>
    Object.keys(entry.classification?.attributes || {})
  ))];
  const rows = attributeKeys.map((key) => ({
    key,
    label: ATTRIBUTE_LABELS[key] || key,
    values: entries.map((entry) => entry.classification?.attributes?.[key]?.display || "No consta")
  }));
  const normalizedAvailable = entries.some((entry) =>
    Number.isFinite(entry.classification?.normalizedPrice)
  );
  if (normalizedAvailable) {
    rows.push({
      key: "normalizedPrice",
      label: "Precio normalizado",
      values: entries.map((entry) => {
        const classification = entry.classification;
        if (!Number.isFinite(classification?.normalizedPrice)) return "No calculable";
        const unit = UNIT_LABELS[classification.normalizedUnit] || classification.normalizedUnit;
        return `${classification.normalizedPrice.toFixed(2).replace(".", ",")} €/${unit}`;
      })
    });
  }
  return rows;
}

export function functionalTypeCatalog() {
  return PILOT_TYPES.map(({ id, label }) => ({ id, label }));
}
