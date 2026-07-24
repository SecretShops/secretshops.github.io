# Asistente de recopilación SiteStripe

## Acceso

Después de publicar los archivos, abre:

`https://getsecretshop.com/sitestripe-assistant.html`

La página tiene `noindex` y no está enlazada desde la tienda.

## Primera recopilación

1. Inicia sesión en Amazon España con la cuenta asociada a Afiliados.
2. Abre el asistente y espera a que cargue
   `data/sources/amazon-es-products.csv`.
3. Pulsa **Abrir producto en Amazon**.
4. En SiteStripe selecciona **Imagen**.
5. Copia el código HTML completo.
6. Pégalo en el asistente y pulsa **Validar y guardar**.
7. Repite el proceso. El asistente avanza automáticamente.

El progreso se guarda en `localStorage`, únicamente dentro del navegador y
dispositivo utilizados. Conviene pulsar periódicamente **Guardar copia del
progreso** para descargar un respaldo JSON.

## Publicar las imágenes

1. Pulsa **Descargar CSV actualizado**.
2. Cambia el nombre del archivo descargado a
   `amazon-es-products.csv`.
3. En GitHub sustituye:
   `data/sources/amazon-es-products.csv`.
4. Confirma el cambio en la rama `main`.

El workflow **Importar Amazon SiteStripe** se iniciará automáticamente,
regenerará el catálogo, ejecutará las pruebas y guardará los resultados.
Después, la conexión de Cloudflare publicará el nuevo commit.

## Productos futuros

Cada vez que se añadan filas nuevas a `amazon-es-products.csv`, el asistente
las detectará al pulsar **Recargar desde GitHub**. Las capturas anteriores se
conservan por ASIN y los productos nuevos aparecen como pendientes.

Si se cambia de navegador o equipo, utiliza **Guardar copia del progreso** en
el equipo antiguo y **Recuperar progreso** en el nuevo.

## Validaciones incorporadas

- El ASIN del código debe coincidir con el producto seleccionado.
- Solo se aceptan recursos HTTPS servidos desde dominios publicitarios o de
  imágenes de Amazon.
- Se rechazan imágenes de comercios, buscadores y dominios externos.
- El CSV conserva todas las columnas, textos, comillas y saltos de línea.
- Un producto nuevo no elimina ni modifica las capturas existentes.

