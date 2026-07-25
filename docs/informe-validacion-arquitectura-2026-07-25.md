# Informe de diseño, comprobación y análisis

Fecha: 25 de julio de 2026

## Dictamen

La entrega queda preparada para sustituir manualmente el contenido del sitio actual sin cambiar dominio, DNS, GitHub Pages, Cloudflare ni Awin. España es la única región publicada. México, Colombia y los siguientes países permanecen aislados como borradores y no generan rutas públicas, fichas ni sitemaps.

La arquitectura resuelve el principal riesgo del estado anterior: un mismo documento ya no mezcla catálogos, monedas, preferencias o enlaces comerciales de distintos países.

## Arquitectura aplicada

| Capa | Solución | Resultado |
|---|---|---|
| URL regional | España en `/`; futuras regiones en `/<país>/`; selector en `/paises/` | El país lo determina la URL, sin redirecciones por IP ni `?pais=` |
| Configuración | `data/config/regions.json` | Una sola fuente para estado, ruta, locale, moneda, catálogo y enlaces |
| Catálogo | Manifiesto independiente en `data/catalog/<región>/catalog.json` | La portada carga únicamente las fuentes del país activo |
| Integridad comercial | País y moneda se validan antes de aceptar una oferta | Una oferta cruzada detiene la carga; no se convierten divisas |
| Redirección afiliada | `/go.html?region=<región>&offer=<id>` | Solo abre enlaces de la región publicada y del país correcto |
| Estado del usuario | Claves `secretshop:<región>:...` | Favoritos, historial, búsquedas y comparador quedan separados |
| SEO | Fichas HTML en `/producto/<slug>/`, canonical, datos estructurados y sitemaps regionales | Los productos dejan de depender de rutas con `#` |
| Publicación progresiva | Solo se generan regiones con estado `published` | México y Colombia pueden depurarse sin quedar expuestos |

## Inventario regional

| Región | Estado | Catálogo preparado | Enlaces regionales | Salida pública |
|---|---:|---:|---:|---|
| España | `published` | 1.014 familias / 3.712 ofertas | 3.712 | `/`, 1.014 fichas y `sitemap-es.xml` |
| México | `draft` | Preparado para validación | 241 | No se genera `/mx/` |
| Colombia | `draft` | Preparado para validación | 205 | No se genera `/co/` |
| Portugal, Chile, Perú, Argentina y Brasil | `draft` | Sin manifiesto todavía | 0 | No se generan subdirectorios |

El índice `sitemap.xml` referencia únicamente `sitemap-global.xml` y `sitemap-es.xml`. El sitemap español contiene la portada y las 1.014 fichas de producto; `/paises/` actúa como `x-default`.

## Comprobaciones realizadas

| Prueba | Resultado |
|---|---|
| Generación regional | Correcta: 1.014 fichas españolas y una sola región publicada |
| Pruebas unitarias y de contrato | 43 de 43 superadas |
| Integridad de catálogo | 21 merchants, 3.301 productos, 3.301 ofertas y 24 categorías válidas |
| Auditoría de afiliación | 4.158 de 4.158 entradas válidas; 0 incidencias |
| Validación regional | España válida; 7 borradores sin publicar |
| Referencias locales | 1.026 páginas HTML, 34 archivos JavaScript y 0 rutas rotas |
| Navegador de escritorio | Búsqueda, ficha, favorito, comparador, tema y accesibilidad correctos |
| Navegador móvil | Menú, cuadrícula, comparador y accesibilidad correctos |
| Compilación Vite | Correcta; 7 módulos transformados |
| Sintaxis adicional | JSON, JavaScript, Python, YAML y 3 sitemaps XML válidos |
| SEO estático | 1.014 fichas con canonical propio; 1.015 URL en el sitemap español |

La prueba de navegador bloqueó las imágenes de terceros para comprobar que la interfaz y las rutas locales funcionan de manera determinista. No constituye una auditoría de disponibilidad de cada imagen remota.

## Hallazgos corregidos

1. La portada cargaba España, México y Colombia a la vez.
2. `?pais=` cambiaba de mercado sin cambiar de documento ni canonical.
3. Favoritos, historial y comparador se compartían entre países.
4. El redirector consultaba un índice global sin exigir región.
5. Las fichas con `#` no eran documentos SEO independientes.
6. Países y monedas se definían en más de un archivo.
7. `wrangler.jsonc` había reaparecido aunque el propio proyecto lo marcaba como configuración obsoleta e incompatible con su validación.

## Riesgos que permanecen

- México y Colombia no deben publicarse todavía. Sus precios, disponibilidad, catálogo y programas comerciales necesitan una validación completa de mercado.
- Parte de las imágenes de producto depende de servidores externos. Si un proveedor cambia o bloquea una URL, esa imagen puede dejar de mostrarse.
- Los títulos y descripciones procedentes de feeds requieren control editorial continuo; la arquitectura evita cruces de mercado, pero no corrige automáticamente textos deficientes del proveedor.
- La generación de 1.014 fichas aumenta el número de archivos. Es intencionado para SEO y se reproduce con `npm run build:regions`.
- La configuración de cabeceras HTTP depende del servicio de publicación. No se ha cambiado porque la nueva arquitectura no exige modificar Cloudflare.

## Condición para activar otra región

Una región solo debe pasar a `published` cuando tenga catálogo suficiente, moneda real, precios y disponibilidad regionales, programa de afiliación aprobado, enlaces auditados, contenido revisado y las mismas pruebas superadas en escritorio y móvil. Después se ejecuta `npm run quality`, se revisa la salida generada y se sube manualmente.

## Acciones externas

No se ha creado ningún commit, push, pull request, despliegue ni cambio de configuración en GitHub, Cloudflare, DNS o Awin.
