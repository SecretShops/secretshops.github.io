# Arquitectura definitiva del catálogo

## Capas

SecretShop separa tres responsabilidades:

1. **Catálogo canónico**: `products.json` y `offers.json` conservan los datos normalizados de feeds autorizados.
2. **Catálogos públicos**: `families.json`, `aliexpress-mx.json` y `aliexpress-co.json` usan el esquema 3 y alimentan la interfaz.
3. **Resolución de enlaces**: `affiliate-links.json` asocia cada oferta pública con un destino validado; `go.html` impide redirecciones abiertas.

## Modelo público

```text
familia
└── variante
    └── oferta
```

- Una **familia** representa el mismo modelo comercial.
- Una **variante** conserva color, tamaño, orientación, capacidad, medidas o configuración.
- Una **oferta** pertenece a una tienda y un mercado concretos.

Los artículos que solo se parecen permanecen separados y pueden mostrarse como alternativas.

## Coincidencia

El orden conservador es:

1. GTIN, EAN o UPC idéntico y válido.
2. Marca + MPN idénticos.
3. Marca + modelo + variante completa.
4. Revisión manual explícita.

Un identificador global nuevo nunca se fusiona mediante una coincidencia más débil.

## Fuentes

- `data/catalog/products.json`: productos normalizados.
- `data/catalog/offers.json`: ofertas normalizadas por merchant.
- `data/catalog/merchants.json`: tiendas y estado de aprobación.
- `data/catalog/category-taxonomy.json`: categorías y jerarquía.
- `data/catalog/awin-import-profiles.json`: reglas de importación.
- `data/aliexpress-*-source.json`: fuentes de marketplace.
- `data/aliexpress-*-metadata-cache.json`: metadatos verificados.
- `data/sources/curated-products.json`: selección editorial con recursos locales.

## Reglas de publicación

- Solo productos físicos de consumo.
- Imagen real y descripción suficiente.
- Al menos una variante con una oferta publicable.
- Destino afiliado HTTPS y permitido.
- Sin placeholders, `PON_AQUI`, `TU_ENLACE` ni enlaces inventados.
- Precio anterior y descuento solo cuando existen ambos valores.
- Condición, mercado, moneda y actualización asociados a la oferta.
- Escritura atómica de los JSON generados.

## Generación

```bash
npm run build:catalog
```

El proceso publica un informe de agrupación, un informe de marketplace y una auditoría de enlaces. Los validadores comprueban unicidad, relaciones, imágenes locales, dominios, parámetros de tracking y referencias del sitio.

