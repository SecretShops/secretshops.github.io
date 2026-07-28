# Automatización de catálogos Awin

El workflow `Actualizar catálogos Awin` se ejecuta una vez al día alrededor de
las 09:00 de España y también puede iniciarse manualmente desde GitHub Actions.

## Credenciales

La automatización utiliza exclusivamente:

- `AWIN_API_TOKEN`, secreto de Actions con el token OAuth2 de Awin.
- `AWIN_DATAFEED_API_KEY`, secreto de Actions para los feeds Legacy/CSV.
- `AWIN_PUBLISHER_ID`, variable de Actions con el Publisher ID `2996453`.

Las credenciales se leen durante la ejecución y nunca se escriben en el
repositorio, los informes o los archivos públicos.

## Límites de publicación

La actualización:

- solo procesa anunciantes Awin aprobados que ya tienen productos publicados;
- conserva los identificadores, familias, variantes, categorías y países;
- actualiza precios, disponibilidad y enlaces de productos existentes;
- no añade automáticamente anunciantes, países ni productos nuevos;
- conserva productos que falten temporalmente en un feed;
- bloquea cualquier eliminación;
- ejecuta todos los tests y validadores antes de escribir en `main`;
- cancela la publicación si `main` cambia durante el proceso.

Los productos nuevos detectados quedan contabilizados en el informe de la
ejecución, pero requieren una incorporación revisada para validar envíos,
moneda, categorías y los umbrales regionales.
