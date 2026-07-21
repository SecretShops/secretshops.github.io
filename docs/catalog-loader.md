# Cargador del catálogo Awin

## Estado inicial

El cargador queda enlazable, pero desactivado mediante:

```json
"enabled": false
```

en `data/catalog/catalog-runtime.json`. Mientras permanezca así, no carga `merchants.json`, `products.json` ni `offers.json`, y no modifica la interfaz actual.

## Archivos

- `data/catalog/catalog-runtime.json`: interruptor de publicación y opciones de ejecución.
- `scripts/catalog-loader.js`: carga, valida, filtra y agrupa productos y ofertas.
- `scripts/catalog-bootstrap.js`: arranque seguro en navegador y eventos de estado.
- `scripts/catalog-loader.test.mjs`: prueba automatizada del filtrado.
- `scripts/install-catalog-loader.mjs`: añade el módulo a `index.html` sin duplicarlo.
- `scripts/validate-catalog.mjs`: valida configuración, merchants, productos y ofertas.

## Instalación en index.html

Desde la raíz del repositorio:

```bash
node scripts/install-catalog-loader.mjs
```

El resultado añade antes de Cloudflare Analytics:

```html
<script type="module" src="./scripts/catalog-bootstrap.js"></script>
```

Aunque el módulo quede enlazado, el catálogo Awin continúa desactivado.

## Activación después de una aprobación

1. Cambiar el merchant de `pending` a `approved`.
2. Importar y validar una muestra en `products.json` y `offers.json`.
3. Ejecutar:

```bash
node scripts/validate-catalog.mjs
node --test scripts/catalog-loader.test.mjs
```

4. Cambiar `enabled` a `true` en `catalog-runtime.json`.
5. Publicar y comprobar el evento `secretshop:awin-catalog-ready`.

## Comportamiento de seguridad

- Solo incluye merchants con estado `approved`.
- Excluye ofertas no comisionables.
- Exige enlaces afiliados HTTPS.
- Exige la moneda correspondiente al país.
- Excluye productos sin identificador global o revisión manual.
- Marca ofertas antiguas como `isStale`.
- Retira ofertas no disponibles cuando superan el límite configurado.
- No mezcla productos similares como si fueran el mismo artículo.

## Acceso desde la interfaz

Cuando se active, el catálogo queda disponible en:

```js
window.SecretShopAwinCatalog
```

y genera uno de estos eventos:

- `secretshop:awin-catalog-disabled`
- `secretshop:awin-catalog-ready`
- `secretshop:awin-catalog-error`

La conexión visual con las tarjetas actuales se realizará después de validar el primer feed aprobado.
