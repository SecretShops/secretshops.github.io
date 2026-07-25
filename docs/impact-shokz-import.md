# Importación de SHOKZ ES desde Impact

Fecha: 25 de julio de 2026

## Resultado aplicado

El feed `Imported Shopify Catalog` contiene 174 filas. SecretShop no publica el
archivo original: lo transforma en el catálogo canónico y conserva únicamente
las variantes aptas para España.

| Resultado | Filas |
| --- | ---: |
| Variantes publicadas | 50 |
| Sin stock | 62 |
| Filas padre no publicadas como producto duplicado | 15 |
| Marcadas `noindex` | 18 |
| Campañas internas `chasingstrava` | 27 |
| Sin precio publicable | 2 |

Las 50 variantes quedan agrupadas en 23 familias. El informe generado se
encuentra en `data/catalog/import-reports/shokz-es-last.json`.

## Seguridad de los enlaces

Cada oferta conserva el deep link individual suministrado por Impact. La
validación exige simultáneamente:

- HTTPS;
- host `shokzes.pxf.io`;
- publisher `7518894`;
- campaña `3800995`;
- creativo `48345`;
- fuente `CATF_31438`;
- `prodsku` idéntico al SKU importado;
- destino final HTTPS bajo `es.shokz.com`;
- país `ES` y moneda `EUR`.

El catálogo público no expone el enlace dentro de la ficha. La salida se
resuelve mediante `/go.html?region=es&offer=<id>` y el índice regional
`data/catalog/es/affiliate-links.json`.

## API

No se necesita un token de API para esta importación. El TXT.GZ descargado desde
Impact ya incluye los campos comerciales y los enlaces de seguimiento
individuales necesarios. Un token solo sería útil para automatizar futuras
descargas o sincronizaciones.

## Actualización futura

El archivo de entrada permanece fuera del repositorio. Para procesar una nueva
descarga:

```bash
node scripts/import-impact-shokz.mjs --input "/ruta/al/feed.txt.gz" --dry-run
node scripts/import-impact-shokz.mjs --input "/ruta/al/feed.txt.gz"
npm run quality
```

El modo `--dry-run` valida y genera el resumen en consola sin modificar los
catálogos. La importación sustituye únicamente los productos y ofertas del
merchant `shokz-es`; el resto del catálogo permanece intacto.

## Archivos implicados

- `scripts/import-impact-shokz.mjs`
- `scripts/lib/impact-shokz-core.mjs`
- `scripts/lib/impact-affiliate-core.mjs`
- `data/catalog/merchants.json`
- `data/catalog/products.json`
- `data/catalog/offers.json`
- `data/catalog/families.json`
- `data/catalog/es/affiliate-links.json`
- `assets/js/redirect.js`

La ejecución de `npm run quality` reconstruye las familias, fichas HTML,
sitemaps e índices regionales y vuelve a auditar todos los enlaces.
