# ClipForge v164

## Corrección
- Corregida la normalización de espacios en la transcripción por fragmentos. La expresión regular anterior buscaba literalmente `\\s` en vez de espacios, tabulaciones y saltos de línea.
- Ahora la deduplicación de palabras en los solapamientos compara texto normalizado correctamente y el texto final se compacta sin conservar separaciones anómalas.
- Añadida una prueba de regresión específica para impedir que vuelva a introducirse el escape incorrecto.

## Protección de funciones existentes
- No se ha modificado el motor FFmpeg de renderizado, los filtros de vídeo, el audio, ni las rutas de exportación.

## Verificación
- 139 pruebas automatizadas superadas.
- `node --check static/browser-whisper.js` correcto.
- Compilación Python correcta.
- No equivale a validar una transcripción real en Chrome/Safari; esa comprobación sigue pendiente.
