# Arquitectura internacional definitiva de SecretShop

Fecha: 25 de julio de 2026

## Decisión aplicada

SecretShop utiliza un solo dominio y una versión comercial aislada por país:

- `https://getsecretshop.com/` → España.
- `https://getsecretshop.com/mx/` → México cuando esté preparado.
- `https://getsecretshop.com/co/` → Colombia cuando esté preparado.
- `https://getsecretshop.com/paises/` → selector internacional.

España permanece en la raíz para conservar las URL actuales. México y Colombia están configurados como `draft`: sus fuentes se pueden depurar y validar, pero el generador no crea sus portadas, fichas ni sitemaps.

## Fuente única de configuración

`data/config/regions.json` controla:

- identificador y código ISO del país;
- locale y moneda;
- subdirectorio público;
- estado `published` o `draft`;
- manifiesto de catálogo;
- archivo regional de enlaces;
- título y descripción regionales.

No hay otra lista de países habilitados. `data/catalog/catalog-config.json` conserva solo reglas de matching, frescura e importación y remite a `regions.json`.

## Separación de datos

Cada mercado dispone de un manifiesto independiente:

```text
data/
├── config/
│   └── regions.json
└── catalog/
    ├── es/
    │   ├── catalog.json
    │   └── affiliate-links.json
    ├── mx/
    │   ├── catalog.json
    │   └── affiliate-links.json
    └── co/
        ├── catalog.json
        └── affiliate-links.json
```

La portada carga exclusivamente las fuentes del manifiesto de su región. Antes de mostrar una oferta, el núcleo comprueba que país y moneda coincidan con la región activa. Un error cruzado detiene la carga en lugar de mezclar mercados.

No se convierten precios entre monedas. Un precio mexicano deberá proceder de una fuente válida para México; cambiar euros por pesos mediante conversión no es una localización válida.

## Navegación y estado local

La URL es la fuente de verdad del país. No se realizan redirecciones automáticas por IP.

El selector `/paises/` se genera desde `regions.json` y solo muestra regiones `published`. La antigua selección `?pais=MX` deja de interpretarse.

Favoritos, historial, búsquedas y comparador usan claves separadas:

```text
secretshop:es:favorites:v2
secretshop:mx:favorites:v2
secretshop:co:favorites:v2
```

El tema visual sigue siendo común. Los favoritos antiguos se migran una vez al espacio español y se depuran contra el catálogo de España.

## Enlaces comerciales

Todas las salidas pasan por:

```text
/go.html?region=es&offer=<id>
```

El redirector:

1. carga `regions.json`;
2. exige una región `published`;
3. abre únicamente el archivo de enlaces de esa región;
4. comprueba que la oferta declare el mismo país;
5. valida HTTPS, host, ruta y parámetros de tracking;
6. impide usar enlaces de Amazon España fuera de España.

Una oferta mexicana o colombiana no puede abrirse mediante la región española. Mientras esos países estén en `draft`, el redirector los rechaza.

## SEO internacional

La arquitectura sustituye las fichas basadas únicamente en `#/producto/...` por páginas HTML reales:

```text
/producto/<slug-estable>/
```

Cada ficha española tiene:

- canonical absoluto propio;
- metadatos Open Graph;
- datos estructurados `Product`;
- enlaces internos rastreables;
- presencia en `sitemap-es.xml`.

`sitemap.xml` es un índice y solo referencia sitemaps de regiones publicadas. `/paises/` funciona como `x-default`. No se generan `hreflang` de México o Colombia mientras sus páginas equivalentes no existan, evitando anotaciones sin reciprocidad.

## Archivos generados

`npm run build:regions`:

1. divide los enlaces autorizados por país;
2. genera `/paises/`;
3. genera fichas de producto para regiones publicadas;
4. genera `sitemap-global.xml`, `sitemap-es.xml` y el índice `sitemap.xml`;
5. escribe `data/config/regions-build-report.json`.

`npm run quality` reconstruye catálogos, genera la capa regional, ejecuta pruebas y valida catálogo, regiones, enlaces y referencias locales.

## Activar un país

No cambiar `status` a `published` hasta cumplir todos estos puntos:

1. catálogo regional suficiente y depurado;
2. moneda real del mercado en cada oferta;
3. precio y disponibilidad obtenidos de una fuente regional válida;
4. merchant y programa de afiliación aprobados para el país;
5. enlace comercial correcto y auditado;
6. imágenes autorizadas y disponibles;
7. categorías, búsqueda, filtros y comparador probados sin cruces;
8. contenido regional suficiente;
9. revisión móvil y escritorio;
10. ejecución correcta de `npm run quality` y `npm run test:browser`.

Después:

1. cambiar únicamente la región correspondiente a `published`;
2. ejecutar `npm run quality`;
3. comprobar que se crean su carpeta, fichas y sitemap;
4. revisar la salida antes de subirla;
5. añadir cualquier `hreflang` solo cuando existan equivalencias reales y recíprocas.

## Hallazgos corregidos en esta versión

- La portada cargaba simultáneamente España, México y Colombia.
- `?pais=` permitía cambiar de mercado dentro de una misma URL.
- Favoritos, historial y comparador compartían almacenamiento entre países.
- El redirector usaba un índice global sin exigir región.
- Las fichas usaban rutas con `#`, no indexables como documentos independientes.
- Países y monedas estaban duplicados en dos configuraciones.
- `wrangler.jsonc` había reaparecido aunque la documentación y el validador lo declaraban obsoleto.

No se han realizado cambios en GitHub, Cloudflare, DNS ni Awin. Este paquete está preparado para una sustitución manual del repositorio.
