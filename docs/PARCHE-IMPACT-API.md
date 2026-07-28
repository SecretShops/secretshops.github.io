# Parche incremental — Impact API

## Qué incorpora

- Sincronización diaria de todos los catálogos Impact ya integrados.
- Actualización exclusiva de productos existentes: no añade productos nuevos ni elimina los actuales.
- Descarga de promociones y códigos literales vigentes desde Impact.
- Informe de programas, catálogos y productos nuevos retenidos para revisión.
- Comprobación de contrato, países de envío, moneda, dominio y Publisher ID.
- Compatibilidad con catálogos de más de 20.000 filas, incluido Lounge.
- Fallback a la ficha oficial del producto cuando un programa desactiva el deep linking.

## Subida

El ZIP del parche conserva las rutas relativas del repositorio.

1. Abrir la raíz del repositorio en GitHub.
2. Subir el contenido del ZIP manteniendo las carpetas.
3. Confirmar que GitHub muestra únicamente archivos añadidos o modificados, nunca eliminados.
4. Crear un commit único con el mensaje `Añadir sincronización general de Impact`.
5. Abrir **Actions → Actualizar catálogos y promociones Impact → Run workflow**.
6. En la primera ejecución, activar `force` para comprobar todos los catálogos.

No hay que crear secretos nuevos. El workflow utiliza:

- `IMPACT_ACCOUNT_SID`
- `IMPACT_API_TOKEN`

## Funcionamiento diario

El workflow se ejecuta una vez al día a las 09:37 de Europe/Madrid. Se programan dos horas UTC y una comprobación local descarta la ejecución que no corresponda al horario de verano o invierno.

El workflow antiguo de Shokz sigue disponible para ejecución manual, pero ya no tiene programación propia para evitar actualizaciones duplicadas.

## Protecciones

- No incorpora productos ni países nuevos automáticamente.
- No elimina productos, archivos ni regiones.
- No cambia código o configuración durante una ejecución de la API.
- Conserva datos anteriores cuando falla un catálogo o el servicio de promociones.
- Cancela el commit si `main` cambia durante la ejecución.
- Nunca persiste el Account SID, el token ni credenciales FTP.
- Los borradores solo pueden publicarse mediante los controles regionales existentes: productos suficientes, moneda correcta, país correcto y cobertura completa de enlaces.

## Lounge

Impact declara mediante la API si el programa permite enlaces profundos. Cuando están desactivados, el workflow mantiene el producto y cambia su salida a la URL oficial de su ficha para evitar el error 404. Esa salida directa no atribuye comisión mientras el anunciante mantenga desactivado el deep linking.

Cuando Impact vuelva a habilitarlo, una ejecución posterior sustituirá automáticamente el fallback por el enlace de seguimiento de producto devuelto por la API.
