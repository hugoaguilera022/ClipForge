# ClipForge · integración de producción con un clic

- El flujo de transcripción en navegador ahora conecta automáticamente la transcripción VTT y los cortes candidatos editables con el formulario de producción.
- Nueva opción activada por defecto para enviar el trabajo al renderizador al terminar Whisper.
- La producción automática solo se inicia si el usuario ya marcó la confirmación de derechos; si no, conserva el material preparado y solicita esa confirmación.
- Se mantiene el renderizador existente, las validaciones del servidor, la edición manual y la auditoría FFprobe.
- Añadidas pruebas de regresión de integración de interfaz.

## Validación
- Suite completa: 144 pruebas aprobadas.
- Prueba E2E real del servidor con el MP4 canónico de La Resistencia (3:33.34), transcripción temporizada y corte 78–102 s: trabajo completado.
- MP4 resultante: 24.000 s, H.264/AAC, 1080×1920; auditoría de vídeo, audio, dimensiones, duración y tamaño aprobada.
- Esta prueba de servidor usó una transcripción VTT aportada como fixture; no valida la calidad de reconocimiento del modelo Whisper del navegador.
