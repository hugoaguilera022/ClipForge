# v166 — transcripción larga: pruebas ejecutables

- Recupera palabras que Whisper solo reconoce en la zona solapada de dos fragmentos; deduplica por texto y tiempo.
- Corrige el número total de fragmentos mostrado durante el progreso.
- Prueba ejecutable en Node de 213,34 segundos simulados (9 ventanas), marcas absolutas, duplicados, palabras recuperadas y subtítulos WebVTT.
- Actualiza la antigua prueba que exigía descartar el solapamiento, comportamiento que perdía palabras.
- `clipforge.py` y `server.py` sin modificaciones.
- Whisper real en navegador sigue sin verificar.
