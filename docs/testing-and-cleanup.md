# Informe de pruebas y depuración

Fecha de cierre: **23 de julio de 2026**

## Resultado funcional

- 413 familias de España.
- 241 familias publicables de México.
- 205 familias publicables de Colombia.
- **859 familias**, **3.556 variantes** y **3.556 ofertas públicas** en total.
- 20 merchants y 24 categorías en el catálogo canónico.
- 4 productos editoriales de Colombia con galería local completa.

## Batería ejecutada

| Área | Resultado |
|---|---:|
| Pruebas Node de importación, matching, búsqueda, filtros, datos, redirector e interfaz | 24/24 |
| Enlaces comerciales publicados | 3.556/3.556 válidos |
| Incidencias de la auditoría de enlaces | 0 |
| Páginas HTML revisadas | 10 |
| Referencias locales rotas | 0 |
| Grupos de archivos idénticos restantes | 0 |
| Vulnerabilidades conocidas de dependencias (`npm audit`) | 0 |
| Violaciones Axe WCAG 2 A/AA/2.1 AA en portada | 0 |

La auditoría Axe se ejecutó en cuatro combinaciones:

- escritorio, tema claro;
- móvil 390 × 844, tema claro;
- escritorio, tema oscuro;
- móvil 390 × 844, tema oscuro.

También se ejercitaron en navegador real la búsqueda inteligente, ficha de producto, galería, favoritos, vistos recientemente, búsquedas guardadas, comparador, tema, menú, páginas legales, guías y rechazo de una oferta desconocida. La consola de la aplicación no registró errores.

Se comprobaron además:

- sintaxis de todos los JavaScript y Python;
- parseo de todos los JSON;
- sitemap XML;
- workflow YAML;
- coherencia de `package-lock.json`;
- recursos de la tipografía local;
- ausencia de CSS remoto.

## Elementos eliminados tras verificar dependencias

- aplicación monolítica y estilos V2;
- cinco catálogos JavaScript heredados;
- cargador, adaptador y arranque duplicados;
- tests ligados exclusivamente al cargador retirado;
- carpeta `tools` incompleta;
- archivos de instrucciones históricos;
- dos copias idénticas del catálogo MX archivado;
- CSV auxiliares ya consolidados en las fuentes JSON;
- configuración de Cloudflare no utilizada por GitHub Pages;
- updater y workflow antiguos que apuntaban a rutas inexistentes;
- imágenes y cachés de la identidad Atlas;
- ejemplos incompletos y configuración runtime sin consumidor.

## Elementos conservados deliberadamente

Los 58 registros MX todavía incompletos permanecen en la fuente de trabajo para que el actualizador pueda enriquecerlos. El generador los rechaza y demuestra que no aparecen en el catálogo público.

`products.json` y `offers.json` son voluminosos, pero no son duplicados prescindibles: constituyen la fuente canónica necesaria para reconstruir familias y validar la trazabilidad.

## Comandos de reproducción

```bash
npm ci
npm run quality
npx playwright install chromium
npm run test:browser
```

