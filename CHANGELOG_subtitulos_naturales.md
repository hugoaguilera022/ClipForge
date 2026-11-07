# Mejora verificada de subtítulos (sobre la base v166)

- `static/browser-whisper.js`: los cues WebVTT ya no se agrupan siempre en bloques rígidos de cinco palabras.
- Ahora se dividen en pausas superiores a 0,42 s, finales de frase, máximo de cinco palabras, 2,25 s y 42 caracteres, conservando las marcas temporales originales de Whisper.
- `tests/test_v166_chunk_runtime.py`: se añadió una prueba ejecutable de agrupación por pausa y puntuación.
- Verificación completa de la suite: 142 pruebas aprobadas.
- Prueba audiovisual independiente con el MP4 canónico de La Resistencia: render de 24 s (78–102 s), H.264/AAC, 1080×1920, 25 fps, audio conservado y subtítulos incrustados. Archivo inspeccionado con ffprobe y subido correctamente.

## Límites

El render de prueba se hizo directamente con FFmpeg en el entorno de pruebas; no demuestra todavía que el botón de exportación de la interfaz web invoque este flujo de principio a fin. Tampoco demuestra diarización acústica ni seguimiento facial fiable. La transcripción automática contiene errores y necesita revisión humana.
