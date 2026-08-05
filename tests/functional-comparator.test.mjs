import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFunctionalFamily,
  comparableRows,
  comparisonContext,
  functionalAlternatives,
  functionalCompatibility,
  normalizeFunctionalText
} from "../assets/js/functional-comparator.js";

function family(id, title, options = {}) {
  const price = options.price ?? 100;
  return {
    id,
    title,
    brand: options.brand || "Marca",
    model: options.model || null,
    category: options.category || "Tecnología",
    categories: [options.category || "Tecnología"],
    groups: [options.group || "Tecnología"],
    primaryGroup: options.group || "Tecnología",
    variants: [{
      id: `${id}-variant`,
      title,
      label: options.label || title,
      capacity: options.capacity || null,
      configuration: options.configuration || null,
      dimensions: null,
      offers: [{
        id: `${id}-offer`,
        merchantName: "Tienda",
        country: "ES",
        currency: "EUR",
        price,
        shippingCost: 0,
        totalPrice: price,
        displayPrice: `${price} €`,
        availability: "in_stock"
      }]
    }],
    offers: [{
      id: `${id}-offer`,
      merchantName: "Tienda",
      country: "ES",
      currency: "EUR",
      price,
      shippingCost: 0,
      totalPrice: price,
      displayPrice: `${price} €`,
      availability: "in_stock"
    }],
    stores: ["Tienda"],
    variantCount: 1,
    secretScore: options.score || 8
  };
}

test("normaliza tildes, mayúsculas y espacios", () => {
  assert.equal(normalizeFunctionalText("  ESPAÑA  "), "espana");
});

test("clasifica las categorías piloto y excluye accesorios", () => {
  assert.equal(
    classifyFunctionalFamily(family("a", "SHOKZ OpenRun auriculares open-ear 8 horas"))?.functionalType,
    "open-ear-headphones"
  );
  assert.equal(
    classifyFunctionalFamily(family("b", "Hidrolimpiadora doméstica 140 bar 1800 W"))?.functionalType,
    "pressure-washer"
  );
  assert.equal(
    classifyFunctionalFamily(family("c", "Manguera de repuesto para hidrolimpiadora")),
    null
  );
  assert.equal(
    classifyFunctionalFamily(family("d", "Shokz Cargador inalámbrico")),
    null
  );
  assert.equal(
    classifyFunctionalFamily(family("e", "Shokz Almohadillas de alivio OpenMeet")),
    null
  );
});

test("bloquea funciones distintas y mantiene alternativas compatibles", () => {
  const headphones = family("a", "Auriculares open-ear 10 horas", { price: 90 });
  const headphones2 = family("b", "OpenFit auriculares open ear 12 horas", { price: 120, brand: "Otra" });
  const remote = family("c", "Mando universal para TV");
  const swimming = family("d", "Shokz OpenSwim Pro auriculares para natación");
  assert.equal(functionalCompatibility(headphones, headphones2).compatible, true);
  assert.equal(functionalCompatibility(headphones, remote).compatible, false);
  assert.equal(functionalCompatibility(headphones, swimming).compatible, false);
  const alternatives = functionalAlternatives([headphones, headphones2, remote], headphones, 5);
  assert.deepEqual(alternatives.map((entry) => entry.family.id), ["b"]);
});

test("no mezcla alimento adulto con cachorro ni dietas terapéuticas", () => {
  const adult = family("a", "Pienso para perros adultos 12 kg", { category: "Mascotas", group: "Mascotas" });
  const puppy = family("b", "Pienso para perros cachorros 12 kg", { category: "Mascotas", group: "Mascotas" });
  const renal = family("c", "Pienso veterinario renal para perros adultos 12 kg", { category: "Mascotas", group: "Mascotas" });
  assert.equal(classifyFunctionalFamily(adult)?.functionalType, "adult-dog-dry-food");
  assert.equal(classifyFunctionalFamily(puppy), null);
  assert.equal(classifyFunctionalFamily(renal), null);
});

test("muestra precio normalizado sin sustituir el precio total", () => {
  const one = family("a", "SSD externo 1 TB USB-C", { price: 100, capacity: "1 TB" });
  const two = family("b", "Disco duro externo 2 TB USB", { price: 150, capacity: "2 TB" });
  const context = comparisonContext([one, two]);
  assert.equal(context.compatible, true);
  assert.equal(context.label, "Almacenamiento externo");
  const rows = comparableRows([one, two]);
  assert.ok(rows.some((row) => row.key === "capacity"));
  assert.ok(rows.some((row) => row.key === "normalizedPrice"));
});
