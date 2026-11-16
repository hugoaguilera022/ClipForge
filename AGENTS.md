# ClipForge — instrucciones permanentes para Codex

## Objetivo y fuente de verdad
ClipForge es un editor/creador de clips de vídeo con una arquitectura existente HTML/CSS/JavaScript + PWA y un servidor Python local opcional. Lee primero `README.md`, `render.yaml`, los tests y `docs/CODEX_ONE_DAY_PLAN.md`. El estado real del código prevalece sobre changelogs, PR descriptions y planes.

## Reglas obligatorias
- No trabajes directamente en `main`. Usa una rama de trabajo nueva creada desde el `main` actualizado.
- Antes de editar, ejecuta `git status --short --branch`, inspecciona `git log`, las referencias y los tests; no sobrescribas cambios locales.
- La rama `integrated-web-final` y el PR #3 son material de referencia, NO una base que se pueda fusionar a ciegas: la rama diverge de `main` (961 commits ahead / 28 behind en la auditoría del 16-11-2026). Porta selectivamente cambios probados; no importes historial ni archivos duplicados sin demostrar que se usan.
- No elimines archivos, changelogs, fixtures ni funcionalidades existentes por limpieza estética. No hagas reescrituras generales ni cambies de framework.
- Prioriza el flujo de navegador local: el vídeo, el audio y el render deben permanecer en el dispositivo siempre que la funcionalidad lo permita. No subas vídeos a APIs externas ni añadas proveedores de pago por defecto.
- No expongas públicamente `server.py` ni actives el backend heredado como multiusuario: el README declara que faltan autenticación/autorización, aislamiento de usuarios y almacenamiento privado.
- No implementes scraping, bypass de OAuth, automatización de contraseñas/cookies ni publicación social. Respeta los derechos del material de origen y exige confirmación cuando corresponda.
- No añadas secretos al repositorio, logs, prompts, screenshots o archivos de configuración. Usa variables de entorno y secretos de Render/GitHub.
- No cambies los límites de uso, los proveedores, los planes de Render ni actives consumo de APIs de pago sin aprobación expresa.
- No fusiones PRs, no cambies el servicio de producción, no despliegues a producción ni modifiques variables/secretos de Render. Prepara una rama y un PR/preview; solicita aprobación antes de acciones irreversibles o externas.
- No declares una prueba superada por inspección del código. Ejecuta los comandos y reporta salida, cobertura, navegador y limitaciones reales.

## Verificación
Como mínimo, adapta y ejecuta los comandos existentes:
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
Ejecuta también los tests JavaScript existentes y Playwright E2E si el entorno lo permite. Para cada fallo, indica si es regresión real, test obsoleto o limitación de entorno; no borres una aserción solo para poner CI en verde.

## Entrega
Al terminar, informa: rama y commits; archivos modificados; comandos y resultados exactos; flujo probado de extremo a extremo; límites conocidos; URL de preview si existe; y qué queda pendiente. Mantén los cambios pequeños, revisables y reversibles.
