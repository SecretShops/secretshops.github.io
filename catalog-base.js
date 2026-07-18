"use strict";

/*
  CATÁLOGO BASE
  Amazon, Vinted y futuras fichas globales o españolas.

  Este archivo se carga de forma independiente. Si otro catálogo
  contiene un error, estas fichas podrán seguir mostrándose.
*/

window.CATALOG_BASE = [
  {
          id: "productos-amazon",
          name: "Selección completa de Amazon",
          description:
            "Accede al escaparate de Atlas Secreto con productos recomendados disponibles en Amazon España.",

          category: "Destacados",

          image:
            "https://placehold.co/900x900/232f3e/ff9900?text=Amazon",

          featured: true,
          createdAt: "2026-07-18",

          offers: [
            {
              store: "Amazon",
              country: "ES",
              price: "Ver escaparate",
              url: "https://www.amazon.es/shop/elatlasecreto"
            }
          ]
        },

  {
        id: "vdevintage-vlc",
        name: "VDE Vintage VLC",
        description:
          "Ropa vintage, prendas únicas y artículos de segunda mano disponibles en Vinted España.",

        category: "Moda vintage",

        image:
          "https://placehold.co/900x900/007782/ffffff?text=VDE+Vintage+VLC",

        featured: true,
        createdAt: "2026-07-18",

        offers: [
          {
            store: "Vinted",
            country: "ES",
            price: "Ver armario",
            url: "https://www.vinted.es/member/69369303-vdevintage-vlc"
          }
        ]
      },

  {
        id: "freshvintage-vlc",
        name: "Fresh Vintage VLC",
        description:
          "Selección de ropa vintage y prendas de segunda mano disponibles en Vinted España.",

        category: "Moda vintage",

        image:
          "https://placehold.co/900x900/007782/ffffff?text=Fresh+Vintage+VLC",

        featured: true,
        createdAt: "2026-07-18",

        offers: [
          {
            store: "Vinted",
            country: "ES",
            price: "Ver armario",
            url: "https://www.vinted.es/member/120782920-freshvintagevlc"
          }
        ]
      }
];
