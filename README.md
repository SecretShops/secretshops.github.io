# SecretShop

Comparador estático y multirregional de productos físicos. España está publicada en la raíz del dominio; México y Colombia permanecen preparados como borradores hasta que sus catálogos y programas regionales superen la validación de publicación. La interfaz organiza el catálogo como **familia → variante → oferta**, separa los productos parecidos y protege los enlaces comerciales mediante un redirector regional con lista cerrada de destinos.

## Estructura

- `index.html`: portada modular, búsqueda, filtros, fichas, favoritos, historial y comparador.
- `paises/`: selector internacional generado; solo incluye regiones con estado `published`.
- `producto/`: fichas estáticas e indexables del mercado español.
- `assets/`: identidad, estilos, tipografía local y JavaScript de la interfaz.
- `data/config/regions.json`: fuente única para países, estado, locale, moneda, rutas y archivos regionales.
- `data/catalog/es|mx|co/`: manifiesto y resolución de enlaces separados por región.
- `data/catalog/`: catálogos generados y catálogo canónico de importación.
- `data/sources/`: selecciones editoriales con imágenes locales.
- `guias/`: guías de compra indexables.
- `scripts/`: importadores, generadores, validadores y auditorías.
- `tests/`: contratos de interfaz, motor de búsqueda, integridad de datos y humo de navegador.
- `docs/`: arquitectura y procedimientos de importación.

El sitio público no necesita compilación: GitHub Pages puede servir estos archivos directamente. `.nojekyll` evita transformaciones de Jekyll.

## Requisitos de desarrollo

- Node.js `^20.19.0` o `>=22.12.0`
- Python `>=3.10`

```bash
npm ci
npm run quality
```

`quality` reconstruye todos los catálogos, ejecuta las pruebas unitarias y de integridad, audita los enlaces y valida cada referencia local del sitio.

Para la prueba automatizada en un navegador real:

```bash
npx playwright install chromium
npm run test:browser
```

Para revisar el sitio localmente:

```bash
npm run dev
```

## Reconstrucción de datos

```bash
npm run build:catalog
```

Este comando:

1. transforma `products.json` y `offers.json` en familias y variantes;
2. prepara los catálogos de marketplace sin cambiar el estado de publicación de ningún país;
3. genera índices de enlaces autorizados separados por región;
4. genera `/paises/`, las fichas indexables y los sitemaps únicamente para regiones `published`.

Los JSON de catálogo contienen identificadores de oferta, no URLs afiliadas directas. `go.html` exige región y oferta, verifica que la región esté publicada, rechaza ofertas de otro país y solo acepta destinos HTTPS de los dominios expresamente admitidos.

## Arquitectura internacional

- `https://getsecretshop.com/` → España (`published`).
- `https://getsecretshop.com/mx/` → México (`draft`; la carpeta pública no se genera).
- `https://getsecretshop.com/co/` → Colombia (`draft`; la carpeta pública no se genera).
- `https://getsecretshop.com/paises/` → selector con regiones publicadas.

La URL determina el país. No existe redirección automática por IP, no se convierten monedas y la portada no permite mezclar mercados mediante `?pais=`. Favoritos, historial, búsquedas y comparador se almacenan con claves distintas por región.

La especificación completa y el procedimiento de activación están en `docs/arquitectura-internacional-definitiva.md`.
El informe de comprobaciones y riesgos está en `docs/informe-validacion-arquitectura-2026-07-25.md`.

## Incorporar un feed autorizado

El importador universal está documentado en `docs/awin-universal-importer.md`. Antes de una importación completa:

1. registrar y aprobar el merchant;
2. ejecutar un `--dry-run`;
3. revisar el informe;
4. importar el feed;
5. ejecutar `npm run quality`.

No se deben añadir productos sin imagen real, ofertas sin destino HTTPS ni coincidencias basadas únicamente en títulos parecidos.

## Datos del navegador

Favoritos, vistos recientemente, búsquedas, comparador y tema se guardan solo en `localStorage`. No existe cuenta ni sincronización remota.

## Comprobación previa a publicación

El responsable del sitio debe completar en `aviso-legal.html` los datos identificativos exigibles para su caso antes de una explotación comercial. No se incluyen datos ficticios en esta entrega.


## Amazon España sin API

El flujo de Amazon está documentado en `docs/amazon-mass-import.md`.

```bash
npm run amazon:links       # convierte ASIN/URLs en enlaces con christian0ddd-21
npm run amazon:import:dry  # valida el CSV editorial sin modificar el catálogo
npm run amazon:import      # importa, reconstruye y ejecuta quality
```

La automatización no consulta ni extrae páginas de Amazon. Los productos se identifican por ASIN y los precios pueden omitirse; en ese caso la interfaz muestra que deben consultarse en Amazon.
