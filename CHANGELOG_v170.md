# ClipForge v1.70

- Añadidos controles Deshacer/Rehacer al editor de pistas.
- Historial de edición limitado a 80 estados para evitar crecimiento ilimitado.
- Atajos Cmd/Ctrl+Z y Cmd/Ctrl+Shift+Z.
- Al abrir un proyecto se reinicia el historial para no mezclar estados de proyectos.
- Se conserva la validación de proyectos y guardado atómico introducidos en v1.69.

## Validación
- 169 pruebas automatizadas superadas.
- Python compile, Node syntax checks y Swift parse correctos.
- La prueba Playwright de navegación a localhost sigue bloqueada por `ERR_BLOCKED_BY_ADMINISTRATOR`.
- El editor sigue siendo una base multipista funcional de edición de segmentos/metadatos, no un NLE profesional con composición y reproducción multicapa sincronizada.
- Transcripción y diarización automáticas del MP4 canónico no se han validado en este entorno.
