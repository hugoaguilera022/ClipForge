# ClipForge v169 — Persistencia de proyectos y editor de pistas

## Cambios
- Añadido almacenamiento persistente local de proyectos mediante JSON versionado y escritura atómica.
- Añadidas rutas `GET /api/projects`, `GET /api/projects/{id}` y `POST /api/projects`.
- Añadida validación de identificadores, intervalos, tipos de pista y límites de tamaño.
- Añadido panel de edición de proyectos con pistas de vídeo, audio, subtítulos, texto e imagen.
- Conectada la selección de clips del motor de navegador con el editor.
- Añadido guardado y reapertura de proyectos desde la base de almacenamiento local de ClipForge.
- Añadidos recursos del editor a la caché de la aplicación.

## Validación
- 169 pruebas automatizadas superadas.
- Compilación Python y sintaxis JavaScript/Swift correctas.
- Prueba HTTP real de creación, listado y lectura de proyectos superada.
- Rechazo de identificadores de proyecto no válidos comprobado.
- No se ha podido ejecutar Playwright contra localhost en este entorno por bloqueo de navegación del administrador.
- No se ha validado la transcripción automática del vídeo canónico en este entorno: no hay motor Whisper instalado.
- El editor implementado es una primera edición multipista de segmentos y metadatos; no equivale todavía a un editor de vídeo profesional con reproducción sincronizada, waveform, keyframes y composición visual en tiempo real.
