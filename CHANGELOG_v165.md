# ClipForge v165

## Corrección crítica de transcripción
- Detectado un desajuste de estructura: `transcribeAudioInChunks()` devuelve `{start, end, text}` con tiempos absolutos, pero el guardado posterior leía `timestamp[0/1]`.
- Esto podía guardar todas las palabras con tiempo 0, dejando los subtítulos fuera de sincronía y contaminando la selección automática.
- Corregido el mapeo para conservar `start` y `end`, validando números finitos y duraciones positivas.
- Añadida prueba de regresión específica para impedir que se vuelva a leer `timestamp` de estos resultados.

## Protección
- No se modifica `clipforge.py`, `render_clip`, filtros FFmpeg ni exportación.
- El cambio solo afecta a la conversión del resultado Whisper a segmentos del proyecto.
