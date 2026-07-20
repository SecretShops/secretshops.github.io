"use strict";

window.CATALOG_COMPARISONS = [];

/*
  SECRET SHOP · COMPARACIONES CONFIRMADAS

  Este archivo relaciona productos idénticos de plataformas distintas.
  Déjalo vacío hasta confirmar una coincidencia exacta.

  Reglas:
  - Un grupo representa un mismo modelo y una misma variante.
  - Usa otro variantKey para color, talla, capacidad o número de unidades.
  - confirmed debe ser true para que la web fusione los productos.
  - El envío gratuito debe escribirse como shippingAmount: 0.
  - Solo se comparan precios con la misma currency.
  - priceCheckedAt debe actualizarse al comprobar el precio.

  Ejemplo listo para adaptar:

  window.CATALOG_COMPARISONS.push({
    comparisonId: "audio-x200",
    variantKey: "negro",
    confirmed: true,
    name: "Auriculares Pro X200 negros",
    sources: [
      {
        productId: "amazon-x200-black",
        store: "Amazon",
        country: "ES",
        shipsTo: ["ES", "MX"],
        amount: 650,
        shippingAmount: 0,
        currency: "MXN",
        priceCheckedAt: "2026-07-20"
      },
      {
        productId: "aliexpress-x200-black",
        store: "AliExpress",
        country: "MX",
        shipsTo: ["MX"],
        amount: 500,
        shippingAmount: 20,
        currency: "MXN",
        priceCheckedAt: "2026-07-20"
      }
    ]
  });
*/
