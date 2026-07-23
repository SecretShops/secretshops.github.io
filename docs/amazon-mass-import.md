# Importación masiva de Amazon España sin API

SecretShop incorpora un flujo local para trabajar con Amazon España sin Product Advertising API ni extracción automatizada de páginas. El ID de seguimiento configurado es `christian0ddd-21`.

## 1. Convertir ASIN o URLs en enlaces afiliados

Edita:

```text
data/sources/amazon-es-input.txt
```

Pega un ASIN o una URL completa de Amazon.es por línea. Se admiten, entre otros:

```text
B0XXXXXXXX
https://www.amazon.es/dp/B0XXXXXXXX
https://www.amazon.es/gp/product/B0XXXXXXXX
```

No se pueden resolver enlaces acortados `amzn.to` sin consultar la red. En ese caso, abre el enlace y copia la URL final de Amazon.es.

Ejecuta:

```bash
npm run amazon:links
```

Se generan:

```text
data/imports/amazon-es/amazon-links.csv
data/imports/amazon-es/amazon-links.json
```

Cada fila contiene ASIN, URL canónica y enlace afiliado con el formato:

```text
https://www.amazon.es/dp/ASIN/ref=nosim?tag=christian0ddd-21
```

El proceso elimina ASIN repetidos, limpia parámetros de navegación y registra entradas no reconocidas.

## 2. Publicar productos en el catálogo

El enlace por sí solo no basta para crear una ficha pública. SecretShop necesita contenido editorial y una imagen HTTPS. Completa:

```text
data/sources/amazon-es-products.csv
```

Campos mínimos:

- `asin_or_url`
- `title`
- `brand`
- `category`
- `description`, con al menos 20 caracteres
- `image_urls`, separadas por `|` cuando haya varias

Campos opcionales:

- `department`
- `categories`, separadas por `|`
- `model`, `color`, `size`, `capacity`, `configuration`
- `price_snapshot` y `price_checked_at`
- `availability`, `condition`, `active`
- `product_type`, `dimensions`, `specifications`, `keywords`

Las categorías deben coincidir exactamente con las etiquetas de `data/catalog/category-taxonomy.json`.

### Precio

Si no hay una fuente autorizada y actualizada, deja vacíos `price_snapshot` y `price_checked_at`. La web mostrará `Consultar precio en Amazon`.

Si añades un precio manual, `price_checked_at` debe contener una fecha ISO. El valor es una instantánea y deberá revisarse antes de publicar.

### Imágenes y textos

El importador no descarga páginas de Amazon ni copia títulos, descripciones, precios, reseñas o imágenes. Los textos y recursos introducidos en el CSV deben poder publicarse legítimamente.

## 3. Validar antes de modificar el catálogo

```bash
npm run amazon:import:dry
```

El informe se guarda en:

```text
data/catalog/import-reports/amazon-es-last.json
```

Si una fila es inválida, la importación se cancela de forma completa. `--allow-partial` permite importar solo las filas válidas, pero no se recomienda para el flujo normal.

## 4. Importar y ejecutar todas las pruebas

```bash
npm run amazon:import
```

Este comando:

1. inserta o actualiza productos identificados por ASIN;
2. genera las ofertas Amazon con `christian0ddd-21`;
3. reconstruye familias y enlaces públicos;
4. ejecuta pruebas, validación del catálogo y auditoría del sitio.

La importación normal conserva todos los productos de Awin y actualiza únicamente los ASIN incluidos. Para reemplazar todo el subconjunto de Amazon:

```bash
node scripts/import-amazon-products.mjs --replace-amazon
npm run quality
```

## Reglas de seguridad

- Solo se aceptan URLs HTTPS de `amazon.es` o `www.amazon.es`.
- El redirector únicamente acepta rutas `/dp/ASIN/ref=nosim` con el tag configurado.
- Los enlaces se almacenan en `affiliate-links.json`; no aparecen directamente en el catálogo público.
- No se publican precios inexistentes ni se etiqueta una oferta sin precio como «mejor precio».
- El ASIN es único dentro de la fuente Amazon.

## Accesos directos en Windows

También puedes ejecutar el flujo haciendo doble clic, en este orden:

```text
AMAZON-1-GENERAR-ENLACES.cmd
AMAZON-2-VALIDAR-PRODUCTOS.cmd
AMAZON-3-IMPORTAR-PRODUCTOS.cmd
```
