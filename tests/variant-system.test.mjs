import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVariantPresentation,
  chooseVariantForAttribute,
  variantValueAvailable
} from "../assets/js/variant-system.js";

function offer(id, price = 100) {
  return [{ id, merchantName: "Tienda", currency: "EUR", country: "ES", price, totalPrice: price }];
}

test("PIXAR separa color y cestas, incluida la combinación con ambas cestas", () => {
  const family = {
    id: "pixar-test",
    title: "Bicicleta PIXAR",
    image: "https://cdn.example.com/black-base.png",
    images: [],
    variants: [
      {
        id: "black-base",
        title: "Bicicleta PIXAR - Black / E-bike+Rack+Fender",
        label: "Black · E-bike+Rack+Fender",
        color: "Black",
        images: ["https://cdn.example.com/black-base.png"],
        offers: offer("base")
      },
      {
        id: "black-front",
        title: "Bicicleta PIXAR - Black / E-bike+Rack+Fender+Front Basket",
        label: "Black · E-bike+Rack+Fender+Front Basket",
        color: "Black",
        images: ["https://cdn.example.com/black-front.png"],
        offers: offer("front", 120)
      },
      {
        id: "sand-both",
        title: "Bicicleta PIXAR - Sand / E-bike+Rack+Fender+Front Basket+Rear Basket",
        label: "Sand · E-bike+Rack+Fender+Front Basket+Rear Basket",
        color: "Sand",
        images: ["https://cdn.example.com/sand-both.png"],
        offers: offer("both", 140)
      }
    ]
  };

  const presentation = buildVariantPresentation(family, "black-base", "es-ES");
  assert.deepEqual(presentation.groups.map((group) => group.key), ["color", "configuration"]);
  assert.deepEqual(
    presentation.groups.find((group) => group.key === "configuration").values.map((item) => item.value),
    ["Sin cesta", "Cesta delantera", "Ambas cestas"]
  );

  const next = chooseVariantForAttribute(presentation, "configuration", "Cesta delantera");
  assert.equal(next.id, "black-front");
  assert.equal(next.images[0], "https://cdn.example.com/black-front.png");
  assert.equal(next.offers[0].id, "front");
});

test("Dore & Rose elimina tallas repetidas y deduce colores desde las imágenes", () => {
  const family = {
    id: "dore-test",
    title: "Aura Sleep Bundle",
    image: "https://cdn.example.com/Aura_Black.jpg",
    images: [],
    variants: [
      {
        id: "black-queen",
        title: "Aura Sleep Bundle - Queen (50 x 75cm)",
        label: "Queen (50 x 75cm) (20 x 30inch)",
        size: "Queen (50 x 75cm) (20 x 30inch)",
        images: ["https://cdn.example.com/Aura_Black.jpg"],
        offers: offer("black-queen")
      },
      {
        id: "pink-queen",
        title: "Aura Sleep Bundle - Queen (50 x 75 cm)",
        label: "Queen (50 x 75 cm) (20 x 30inch)",
        size: "Queen (50 x 75 cm) (20 x 30inch)",
        images: ["https://cdn.example.com/Aura_Pink.jpg"],
        offers: offer("pink-queen")
      },
      {
        id: "black-standard",
        title: "Aura Sleep Bundle - Standard",
        label: "Standard (50 x 60cm) (20 x 24inch)",
        size: "Standard (50 x 60cm) (20 x 24inch)",
        images: ["https://cdn.example.com/Aura_Black.jpg"],
        offers: offer("black-standard")
      },
      {
        id: "pink-standard",
        title: "Aura Sleep Bundle - Standard",
        label: "Standard (50 x 60cm) (20 x 24inch)",
        size: "Standard (50 x 60cm) (20 x 24inch)",
        images: ["https://cdn.example.com/Aura_Pink.jpg"],
        offers: offer("pink-standard")
      }
    ]
  };

  const presentation = buildVariantPresentation(family, "black-queen", "es-ES");
  const color = presentation.groups.find((group) => group.key === "color");
  const size = presentation.groups.find((group) => group.key === "size");
  assert.deepEqual(color.values.map((item) => item.value), ["Negro", "Rosa"]);
  assert.equal(size.values.length, 2);
  assert.ok(size.values.some((item) => item.value.startsWith("Queen")));
  assert.ok(size.values.some((item) => item.value.startsWith("Standard")));
});

test("Bikila usa la talla deducida del MPN y no muestra Modelo disponible", () => {
  const family = {
    id: "bikila-test",
    title: "Zapatilla de running",
    stores: ["BIKILA ES"],
    image: "https://cdn.example.com/shoe.jpg",
    images: [],
    variants: [
      { id: "s", title: "Zapatilla de running", label: "Modelo disponible", mpn: "42023.9.5", images: ["https://cdn.example.com/shoe.jpg"], offers: offer("s") },
      { id: "m", title: "Zapatilla de running", label: "Modelo disponible", mpn: "42023.10", images: ["https://cdn.example.com/shoe.jpg"], offers: offer("m") }
    ]
  };
  const presentation = buildVariantPresentation(family, null, "es-ES");
  assert.equal(presentation.groups.length, 1);
  assert.equal(presentation.groups[0].key, "size");
  assert.deepEqual(presentation.groups[0].values.map((item) => item.value), ["EU 43 (US 9,5)", "EU 44 (US 10)"]);
});

test("un producto sin opciones reales no muestra configurador", () => {
  const family = {
    id: "simple",
    title: "Producto simple",
    image: "https://cdn.example.com/simple.jpg",
    images: [],
    variants: [
      { id: "only", title: "Producto simple", label: "Modelo disponible", images: ["https://cdn.example.com/simple.jpg"], offers: offer("only") }
    ]
  };
  const presentation = buildVariantPresentation(family, null, "es-ES");
  assert.equal(presentation.groups.length, 0);
  assert.equal(presentation.availableSizes.length, 0);
});

test("una lista de tallas agregada se presenta una sola vez como información", () => {
  const family = {
    id: "sizes-list",
    title: "Camiseta",
    image: "https://cdn.example.com/shirt.jpg",
    images: [],
    variants: [
      { id: "black", title: "Camiseta negra", label: "XS,S,M,L,XL · negro", color: "negro", size: "XS,S,M,L,XL", images: ["https://cdn.example.com/black.jpg"], offers: offer("black") },
      { id: "white", title: "Camiseta blanca", label: "XS,S,M,L,XL · blanco", color: "blanco", size: "XS,S,M,L,XL", images: ["https://cdn.example.com/white.jpg"], offers: offer("white") }
    ]
  };
  const presentation = buildVariantPresentation(family, null, "es-ES");
  assert.deepEqual(presentation.availableSizes, ["XS", "S", "M", "L", "XL"]);
  assert.deepEqual(presentation.groups.map((group) => group.key), ["color"]);
});

test("no confunde colores de PIXAR con tallas", () => {
  const family = {
    id: "pixar-colors",
    title: "PIXAR C1",
    image: "https://cdn.example.com/black.png",
    variants: [
      { id: "sand", title: "PIXAR C1 - Sand / E-bike+Rack+Fender", label: "Sand · E-bike+Rack+Fender", color: "Sand", images: ["https://cdn.example.com/sand.png"], offers: offer("sand") },
      { id: "mint", title: "PIXAR C1 - Mint Green / E-bike+Rack+Fender", label: "Mint Green · E-bike+Rack+Fender", color: "Mint Green", images: ["https://cdn.example.com/mint.png"], offers: offer("mint") }
    ]
  };
  const presentation = buildVariantPresentation(family, null, "es-ES");
  assert.deepEqual(presentation.groups.map((group) => group.key), ["color"]);
});

test("elimina la variante genérica de feed cuando existe una variante exacta", () => {
  const family = {
    id: "feed-parent",
    title: "Blazer",
    image: "https://cdn.example.com/blazer.jpg",
    variants: [
      { id: "parent", title: "Blazer", label: "Modelo disponible", images: ["https://cdn.example.com/blazer.jpg"], offers: offer("parent") },
      { id: "xs", title: "Blazer - IT44 | XS", label: "IT44 | XS", size: "IT44 | XS", images: ["https://cdn.example.com/blazer.jpg"], offers: offer("xs") }
    ]
  };
  const presentation = buildVariantPresentation(family, null, "es-ES");
  assert.equal(presentation.variants.length, 1);
  assert.equal(presentation.selected.id, "xs");
  assert.equal(presentation.groups.length, 0);
});

test("deduce configuraciones desde el título sin convertir color ni talla en configuración", () => {
  const family = {
    id: "tool-kit",
    title: "Tool Kit",
    image: "https://cdn.example.com/kit.jpg",
    variants: [
      { id: "complete", title: "Tool Kit - Complete Kit / Black / Unisex", label: "Black", color: "Black", images: ["https://cdn.example.com/kit.jpg"], offers: offer("complete", 50) },
      { id: "sew", title: "Tool Kit - Sew-In Needle Kit / Black / Unisex", label: "Black", color: "Black", images: ["https://cdn.example.com/kit.jpg"], offers: offer("sew", 20) }
    ]
  };
  const presentation = buildVariantPresentation(family, null, "es-ES");
  const configuration = presentation.groups.find((group) => group.key === "configuration");
  assert.deepEqual(configuration.values.map((item) => item.value), ["Complete Kit", "Sew-In Needle Kit"]);
  assert.equal(presentation.groups.some((group) => group.key === "color"), false);
});

test("presenta longitudes de extensiones como Longitud", () => {
  const family = {
    id: "hair-length",
    title: "Hair Topper",
    image: "https://cdn.example.com/hair.jpg",
    variants: [
      { id: "10", title: 'Hair Topper - 10"', label: '10"', images: ["https://cdn.example.com/hair10.jpg"], offers: offer("10") },
      { id: "20", title: 'Hair Topper - 20"[Pre Sale]', label: '20"[Pre Sale]', images: ["https://cdn.example.com/hair20.jpg"], offers: offer("20") }
    ]
  };
  const presentation = buildVariantPresentation(family, null, "es-ES");
  const length = presentation.groups.find((group) => group.key === "length");
  assert.equal(length.label, "Longitud");
  assert.deepEqual(length.values.map((item) => item.value), ["10″", "20″ (preventa)"]);
});

test("usa miniaturas de diseño cuando el feed solo aporta imágenes distintas", () => {
  const family = {
    id: "visual-only",
    title: "Gafas",
    image: "https://cdn.example.com/one.jpg",
    variants: [
      { id: "one", title: "Gafas", label: "Modelo disponible", images: ["https://cdn.example.com/one.jpg"], offers: offer("one") },
      { id: "two", title: "Gafas", label: "Modelo disponible", images: ["https://cdn.example.com/two.jpg"], offers: offer("two") }
    ]
  };
  const presentation = buildVariantPresentation(family, null, "es-ES");
  assert.deepEqual(presentation.groups.map((group) => group.key), ["style"]);
  assert.deepEqual(presentation.groups[0].values.map((item) => item.value), ["Diseño 1", "Diseño 2"]);
});

test("las opciones compatibles indirectamente siguen activas y reajustan la combinación", () => {
  const family = {
    id: "combination-test",
    title: "Conjunto",
    image: "https://cdn.example.com/a.jpg",
    variants: [
      { id: "black-s", title: "Conjunto", color: "Black", size: "S", images: ["https://cdn.example.com/a.jpg"], offers: offer("black-s") },
      { id: "pink-m", title: "Conjunto", color: "Pink", size: "M", images: ["https://cdn.example.com/b.jpg"], offers: offer("pink-m") }
    ]
  };
  const presentation = buildVariantPresentation(family, "black-s", "es-ES");
  assert.equal(variantValueAvailable(presentation, "color", "Rosa"), true);
  const next = chooseVariantForAttribute(presentation, "color", "Rosa");
  assert.equal(next.id, "pink-m");
});
