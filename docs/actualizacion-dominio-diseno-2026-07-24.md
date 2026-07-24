# SecretShop — actualización de dominio y diseño

Fecha: 24 de julio de 2026

## Alcance ejecutado

- Migración de las referencias públicas desde las direcciones anteriores a `https://getsecretshop.com`.
- Actualización de `canonical`, Open Graph, sitemap, robots, guías y páginas legales.
- Conservación del archivo `CNAME` con `getsecretshop.com`.
- Eliminación de la configuración obsoleta de Workers del repositorio (`wrangler.jsonc`). Esta eliminación no desactiva el Worker ya publicado en Cloudflare.
- Rediseño de la portada y de la navegación.
- Corrección y refuerzo de búsqueda, filtros, favoritos y acceso por tienda.
- Aplicación de la paleta de marca `#1f1f1f` y `#fee97d` mediante variables centrales y variantes accesibles para los modos claro y oscuro.
- Incorporación del logotipo compacto en cabeceras, menús, pie, favicon y página de redirección.
- Conservación del logotipo original en alta resolución y uso como imagen Open Graph para compartir la web.

## Cambios de interfaz

- Cabecera compacta y una sola navegación principal.
- Botón **Catálogo** con mayor visibilidad.
- Portada reducida aproximadamente un tercio.
- Rotación controlada de la portada cada 12 segundos.
- Cuatro categorías principales: Tecnología, Moda, Hogar y Belleza y cuidado.
- Accesos separados para las colecciones Ofertas, Virales y Menos de 10.
- Imágenes representativas en las categorías.
- Destacados diversificados para evitar secuencias repetitivas de categoría o marca.
- Flechas laterales en escritorio y desplazamiento táctil en móvil.
- Tiendas clicables para abrir el catálogo filtrado.
- Favoritos con corazón de alternancia y botón X de eliminación.
- Terminología pública cambiada a **productos**, **opciones** y **tiendas**.
- CTA principal de productos con varias ofertas: **Comparar precios**.
- Rotaciones detenidas durante interacción, foco o preferencia de movimiento reducido.

## Correcciones funcionales

- Al seleccionar una categoría o volver al catálogo general se eliminan filtros antiguos de tienda y país cuando corresponde.
- La búsqueda ya no acepta como resultado una coincidencia presente únicamente en la descripción.
- Se corrigieron coincidencias parciales de términos cortos: por ejemplo, `tv` ya no coincide por sí solo con `UTV`, `CVT` o `HDTV`.
- La búsqueda `televisor` devuelve productos identificados como televisores y no muebles que solo mencionan esa palabra en la descripción.
- Se mantienen sinónimos y tolerancia a errores ortográficos pequeños.

## Validaciones ejecutadas

Comando ejecutado:

```bash
npm run quality
```

Resultado:

- 38 pruebas automatizadas superadas.
- 21 comercios validados.
- 3.301 productos y 3.301 ofertas del catálogo base validados.
- 4.158 enlaces publicados con destino afiliado válido.
- 0 incidencias de afiliación.
- 11 páginas HTML y 29 archivos JavaScript revisados.
- 0 referencias locales rotas.
- Prueba automatizada de navegador superada en escritorio y móvil: carga del catálogo, búsqueda, ficha, favoritos, comparador, tema y accesibilidad.
- Prueba de navegador aislada de imágenes remotas para que su resultado no dependa de la disponibilidad temporal de los CDN de las tiendas.

## Publicación recomendada

1. Conservar una copia del repositorio actualmente publicado.
2. Subir el contenido de este paquete a la rama `main`.
3. Esperar a que termine GitHub Pages.
4. Comprobar `https://getsecretshop.com` en escritorio y móvil.
5. Revisar portada, navegación, búsqueda, filtros, favoritos, comparador, tiendas, modo oscuro y enlaces externos.
6. Si la comprobación es correcta, mantener esta versión como definitiva.
