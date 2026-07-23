# SecretShop

Comparador estático de productos físicos para España, México y Colombia. La interfaz organiza el catálogo como **familia → variante → oferta**, separa los productos parecidos y protege los enlaces comerciales mediante un redirector con lista cerrada de destinos.

## Estructura

- `index.html`: portada modular, búsqueda, filtros, fichas, favoritos, historial y comparador.
- `assets/`: identidad, estilos, tipografía local y JavaScript de la interfaz.
- `data/catalog/`: catálogos públicos generados y catálogo canónico de importación.
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
2. publica los catálogos de México y Colombia;
3. genera el índice centralizado de enlaces autorizados.

Los JSON públicos contienen identificadores de oferta, no URLs afiliadas directas. `go.html` resuelve el identificador y solo acepta destinos HTTPS de los dominios expresamente admitidos.

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
