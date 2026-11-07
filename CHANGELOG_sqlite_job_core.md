# ClipForge — núcleo persistente de trabajos

- Sustituye el registro operativo principal por SQLite (`data/jobs.sqlite3`) con WAL, `synchronous=FULL`, `busy_timeout` y transacciones `BEGIN IMMEDIATE`.
- Migra automáticamente el registro legado `data/jobs.json` al almacén SQLite.
- Mantiene `jobs.json` como espejo de compatibilidad para instalaciones y herramientas anteriores.
- Conserva trabajos activos al limitar el historial; no expulsa trabajos en cola/proceso.
- Añade upsert transaccional por trabajo para actualizaciones independientes.
- Añade pruebas de reapertura, preservación de payload, retención de trabajos activos y actualizaciones concurrentes.
- Validación: 150 pruebas automatizadas aprobadas; py_compile y node --check aprobados.
- Prueba real: MP4 canónico La Resistencia, corte 78–102 s, 24 s, H.264/AAC, 1080×1920, subtítulos incrustados y FFprobe correcto.

Límite explícito: este cambio mejora persistencia y recuperación local; no implementa aún autenticación multiusuario, almacenamiento de objetos ni despliegue público seguro.
