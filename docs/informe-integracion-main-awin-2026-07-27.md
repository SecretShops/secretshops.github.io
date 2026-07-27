# Integración de `main` y `catalogo-awin-es-piloto`

Fecha de comprobación: 27 de julio de 2026.

## Resultado

Se ha preparado un repositorio completo que conserva:

- el catálogo canónico presente en `main`;
- la navegación, el diseño, los directorios de categorías y tiendas y la versión portuguesa de la rama piloto;
- las eliminaciones realizadas en `main` de la ficha residual `pixar-price-difference-adjustment-voucher`, tanto en España como en Portugal.

Los archivos canónicos `products.json`, `offers.json`, `merchants.json`, `category-taxonomy.json` y todo el directorio `data/sources/` eran idénticos en ambos ZIP. Los conflictos mostrados por GitHub Desktop procedían principalmente de páginas y datos derivados que habían sido regenerados en momentos distintos.

## Reconstrucción

El catálogo y las rutas públicas se han vuelto a generar desde las fuentes canónicas. Resultado:

- 7.251 productos y 7.251 ofertas canónicas;
- 40 comercios y 42 categorías;
- España: 3.520 familias, 10.564 ofertas y 3.520 fichas;
- Portugal: 278 familias, 1.472 ofertas y 278 fichas;
- 8.116 enlaces comerciales canónicos y 24.570 asignaciones regionales, sin incidencias;
- 3.891 páginas HTML y 0 referencias locales rotas.

## Verificaciones

- `npm run quality`: correcto;
- 55 de 55 pruebas automáticas: correctas;
- validación de catálogo, afiliación, regiones, SEO y sitio: correcta;
- prueba en navegador de escritorio y móvil: correcta;
- búsqueda, favoritos, comparador, selector regional, modo oscuro y accesibilidad: correctos.

No se ha modificado GitHub ni Cloudflare. El ZIP entregado es el repositorio completo listo para colocarlo sobre una rama nueva creada desde el `main` actual.
