# Importación completa de Muebles Style Spain

## Resultado validado

- Filas del feed: **3.111**
- Productos aceptados: **3.110**
- Productos omitidos: **1**
- Ofertas publicadas: **3.110**
- Conflictos de identificadores: **0**
- Moneda: **EUR**

La fila omitida no contiene GTIN, EAN, UPC ni otro identificador exacto admitido por el perfil.

## Distribución

| Categoría | Productos |
|---|---:|
| Sofás | 1.620 |
| Sillas y sillones | 485 |
| Bancos, pufs y reposapiés | 347 |
| Camas y colchones | 275 |
| Mesas y escritorios | 188 |
| Almacenaje | 107 |
| Textiles y cojines | 33 |
| Iluminación | 25 |
| Jardín y terraza | 25 |
| Cocina y comedor | 5 |
| **Total** | **3.110** |

Los 3.110 productos se agrupan en **413 familias** públicas y conservan sus **3.110 variantes**.

## Informes

- `data/catalog/import-reports/muebles-style-last.json`
- `data/catalog/import-reports/muebles-style-universal-dry-run.json`
- `data/catalog/family-grouping-report.json`

## Publicación

`scripts/build-product-families.py` genera `data/catalog/families.json`. La interfaz carga ese archivo directamente junto con los catálogos de marketplace.

