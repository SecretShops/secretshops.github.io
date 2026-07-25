# Carga regional del catálogo

## Estado actual

La interfaz no utiliza un cargador global ni mezcla países. El arranque sigue este orden:

1. `assets/js/app.js` carga `data/config/regions.json`.
2. Resuelve la región declarada en la página y comprueba que esté `published`.
3. Carga el manifiesto `data/catalog/<region>/catalog.json`.
4. Carga exclusivamente las fuentes declaradas por ese manifiesto.
5. `assets/js/catalog-core.js` normaliza familias, variantes y ofertas.
6. Se rechaza la carga si una oferta pertenece a otro país o utiliza otra moneda.

España carga:

```text
data/catalog/es/catalog.json
├── data/catalog/families.json
└── data/catalog/aliexpress-es.json
```

México y Colombia conservan manifiestos independientes, pero no se cargan en producción mientras su estado sea `draft`.

## Archivos principales

- `data/config/regions.json`: países, rutas, monedas y publicación.
- `data/catalog/<region>/catalog.json`: fuentes regionales.
- `data/catalog/<region>/affiliate-links.json`: destinos comerciales regionales.
- `assets/js/region-core.js`: resolución de región, rutas y almacenamiento.
- `assets/js/catalog-core.js`: normalización, búsqueda, filtros y comparación.
- `assets/js/app.js`: interfaz del catálogo regional.
- `scripts/build-regional-site.mjs`: fichas y sitemaps.
- `scripts/validate-regions.mjs`: comprobación de aislamiento.

## Seguridad y calidad

- La URL determina el país.
- No existe selección interna `?pais=`.
- No se convierten monedas.
- Un error de país o moneda bloquea el catálogo.
- Los enlaces requieren región publicada y oferta del mismo país.
- Los merchants canónicos deben estar aprobados.
- Las salidas usan HTTPS y dominios expresamente permitidos.
- Los productos con identificadores incompatibles no se fusionan.

## Verificación

```bash
npm run build:regions
npm test
npm run validate:catalog
npm run validate:regions
npm run validate:site
```
