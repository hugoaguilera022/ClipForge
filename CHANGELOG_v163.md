# ClipForge v163

## Corrección
- La transcripción Whisper del navegador procesa el audio en ventanas de 28 segundos con 2 segundos de solapamiento.
- Convierte las marcas de tiempo locales de cada ventana a tiempos absolutos del vídeo.
- Evita añadir dos veces palabras dentro del solapamiento y muestra el progreso por fragmentos.
- Mantiene el motor de renderizado, el servidor y los flujos de exportación sin modificaciones.

## Verificación
- 138 pruebas automatizadas superadas.
- `node --check static/browser-whisper.js` correcto.
- `py_compile` de `server.py` y `clipforge.py` correcto.
- No se ha podido ejecutar una prueba interactiva del modelo Whisper dentro de Chrome/Safari en este entorno; la transcripción completa del MP4 sigue pendiente de validación en navegador.
