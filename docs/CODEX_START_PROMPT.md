# Prompt de inicio para Codex — ClipForge en una jornada

Trabaja en el repositorio `hugoaguilera022/ClipForge`.

Tu objetivo es entregar en una jornada un MVP web público y verificable de ClipForge, priorizando el procesamiento local en el navegador. Sigue estrictamente `AGENTS.md` y lee completo `docs/CODEX_ONE_DAY_PLAN.md` antes de tocar código.

## Orden de trabajo

1. **Preflight de solo lectura.** Comprueba rama, estado de trabajo, último commit de `main`, árbol, scripts, tests, dependencias y despliegue. Inspecciona `integrated-web-final` y PR #3 como referencia. Explica qué archivos y commits concretos propones portar y qué no vas a importar. No hagas cambios todavía.
2. **Plan corto y ejecutable.** Prioriza un único flujo: vídeo local → Whisper → cuatro clips → edición → MP4/ZIP → guardar proyecto. Diferencia hechos observados de hipótesis.
3. **Implementación aislada.** Crea una rama nueva desde el `main` actualizado. Porta solo los módulos necesarios y sus pruebas. Mantén una implementación canónica; evita variantes duplicadas. No reescribas el proyecto ni cambies el framework.
4. **Verificación continua.** Ejecuta las pruebas tras cada bloque. Añade/actualiza Playwright para cubrir el flujo real, no solo mocks. Comprueba los MP4 con FFprobe cuando sea posible. Corrige los fallos de forma causal; no debilites tests para ocultar regresiones.
5. **Preview y handoff.** Prepara la configuración para un despliegue preview estático en Render. Verifica la URL, consola, subida, transcripción y exportación. No conectes el frontend a un backend inseguro ni guardes datos duraderos en el filesystem Free de Render.
6. **Entrega.** Resume cambios, rama, pruebas, URL, límites y pendientes. Deja un PR listo para revisión.

## Requisitos de producto para el MVP
- Interfaz en español, con soporte de transcripción español/inglés.
- Subida de vídeo local, progreso y errores claros.
- Cuatro candidatos editables, con inicio/fin y texto.
- Subtítulos editables y exportados correctamente.
- MP4 vertical H.264 1080×1920 a 30 fps, conservando audio original cuando sea compatible.
- ZIP descargable con los cuatro clips.
- Guardado/restauración local en IndexedDB.
- No mostrar funciones de servidor, publicación o YouTube como disponibles si no están realmente conectadas.

## Límites y seguridad
- No publiques vídeos del usuario ni los subas a servicios externos.
- No añadas claves, tokens ni secretos al código.
- No habilites APIs de pago ni cambies límites gratuitos.
- No expongas el backend Python heredado a Internet: todavía no tiene el modelo de seguridad multiusuario necesario.
- No fusiones PR #3 ni importes sus 961 commits a ciegas.
- No modifiques `main`, Render production, variables de entorno, secretos ni dominios. Puedes preparar la rama y el PR; pide aprobación antes de producción.
- Si una funcionalidad no cabe o no se puede probar en la jornada, déjala explícitamente fuera del MVP en vez de simularla.

## Comandos base de validación
Adapta a los archivos existentes y ejecuta:
```bash
python -m compileall -q server.py clipforge.py channel_monitor.py diarization.py job_store.py project_store.py worker.py
ruff check --select E9,F63,F7,F82 .
PYTHONPATH=. pytest -q tests/
node --check static/app.js
node --check static/browser-whisper.js
node --check static/browser-export.js
node --check static/browser-url.js
node --check static/editor.js
node --check static/sw.js
```
Ejecuta también los tests JS y el E2E Playwright existente. No informes resultados que no hayas observado.

**Empieza ahora con el preflight de solo lectura y presenta la lista exacta de cambios que vas a realizar. Después continúa con la implementación dentro de los límites anteriores.**
