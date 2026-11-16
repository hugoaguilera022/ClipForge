# ClipForge — plan de entrega web en una jornada

**Fecha de auditoría:** 16-11-2026  
**Repositorio:** https://github.com/hugoaguilera022/ClipForge  
**Rama de referencia:** `main`  
**Commit de main observado:** `7c34d13e92cd011339819220ebf82844e491f85c`  
**Rama de preparación:** `codex/clipforge-one-day-handoff`

## 1. Estado observado (no asumir que ha cambiado)
- `main` contiene la app local Python + HTML/CSS/JS, SQLite para trabajos, un worker local, FFmpeg y un editor inicial de pistas. El README advierte que el backend no es un servicio público multiusuario.
- El PR #3 (`integrated-web-final`) es un borrador sin fusionar: 961 commits ahead y 28 behind respecto a `main`. Contiene la migración browser-first, transcripción Whisper en navegador, selección de cuatro candidatos, edición y exportación MP4. No fusionarlo entero.
- El CI observado en el head del PR #3 falló: 15 tests fallidos y 195 aprobados (más 4 subtests). Entre los fallos había aserciones de tests que no coincidían con el módulo actual; deben investigarse uno a uno.
- Otra rama experimental reciente registró 32 fallos y 214 aprobados. No atribuir ese resultado a `main` ni al PR #3.
- El PR #4 está cerrado sin fusionar y declara que su base estaba divergida. No usarlo como integración.
- Hay muchas ramas experimentales de Codex para editor, audio, keyframes, subtítulos y exportación. Auditar dependencias antes de portar código.
- El `render.yaml` de `main` declara un Static Site `clipforge-final` y un Web Service Docker `clipforge-api-hugo`; ambos apuntan a `codex/clipforge-editor-stabilization`, no a `main`, y tienen `autoDeploy: false`. El backend aparece en plan Free y el estático reescribe `/api/*` al backend.
- El PR #3 documenta una preview estática en https://clipforge-preview-sb8n.onrender.com, con flujo local de navegador e IndexedDB. Esta URL y su estado actual deben verificarse en Render; no se ha confirmado el estado en vivo desde el dashboard durante esta auditoría.
- La cuenta de GitHub tiene permisos de administrador/escritura sobre el repo. La conexión directa a Render todavía debe completarse para inspeccionar servicios, despliegues, variables y logs reales.

## 2. Objetivo realista para 1 jornada: MVP web estable
Entregar una web pública de preview que permita:
1. Abrir ClipForge sin instalar Python, FFmpeg ni aplicaciones locales.
2. Seleccionar un vídeo local autorizado.
3. Transcribir audio en el navegador (español e inglés; modelos Tiny/Base como ruta estable inicial, sujetos a pruebas reales de memoria).
4. Proponer exactamente cuatro momentos no solapados, con puntuación heurística explicada honestamente.
5. Permitir editar inicio/fin y texto de cada clip, revisar la transcripción y ajustar subtítulos.
6. Exportar clips verticales MP4 H.264, 1080×1920, 30 fps, conservando el audio original cuando el navegador lo permita.
7. Descargar un MP4 individual o un ZIP de los cuatro.
8. Guardar/recuperar un proyecto en IndexedDB en el mismo navegador/dispositivo.
9. Mostrar errores comprensibles, progreso, cancelación cuando sea viable y avisos claros de compatibilidad.

La prioridad es un flujo completo y reproducible, no añadir pantallas sin funcionalidad.

## 3. Alcance que NO cabe prometer en un MVP de 1 día
No presentar como disponible sin implementarlo y probarlo:
- YouTube watch-page URL ingestion / descarga desde páginas de YouTube.
- API Python/FFmpeg desplegada para procesar trabajos en la nube.
- Proyectos compartidos entre cuentas/dispositivos, autenticación o almacenamiento remoto.
- Monitorización de canales, cola multiusuario, workers distribuidos.
- Publicación automática OAuth en YouTube/Instagram/TikTok.
- Editor profesional equivalente a CapCut/Premiere (multitrack en tiempo real, waveform avanzada, keyframes completos, mezcla profesional).
- Compatibilidad garantizada con todos los navegadores móviles.
- Predicción de viralidad o selección semántica equivalente a un editor humano.

No simular funciones ausentes ni mostrar botones que parezcan operativos si no lo están.

## 4. Estrategia de integración
1. Crear una rama nueva desde el `main` más reciente.
2. Hacer un inventario de los archivos realmente referenciados desde `static/index.html`, `static/app.js`, `static/editor.js` y el service worker.
3. Inspeccionar `integrated-web-final` y el PR #3 como fuente de código y pruebas, no como merge directo.
4. Portar en lotes pequeños solo el pipeline browser-first que pase revisión: transcripción timestamped, selección cuatro clips, edición de proyecto y exportación.
5. Mantener una sola implementación canónica por módulo. No incorporar variantes inline/v2/v3/v178/v179 si no son imprescindibles y no están referenciadas.
6. Conservar la ruta local Python como modo avanzado/local, sin exponerla a Internet.
7. Configurar la preview estática para la rama de trabajo. No conectar la ruta `/api/*` a un backend sin autenticación y persistencia adecuadas.
8. Ejecutar pruebas automatizadas y un E2E real con un vídeo autorizado de referencia. Comprobar los MP4 con FFprobe cuando la exportación se pruebe en Chromium/Playwright.
9. Solo después de una aprobación humana, activar despliegue o merge de producción.

## 5. Restricciones técnicas y de coste
- Render Static Site: opción adecuada para el MVP browser-first.
- Render Free Web Service: no tiene disco persistente; puede reiniciarse y su filesystem es efímero. No guardar allí proyectos, vídeos, tokens ni estado durable. Los servicios Free se duermen tras inactividad y no son adecuados para cargas de producción.
- El backend actual usa rutas locales, archivos, SQLite y worker compartido. No trasladarlo a un Free Web Service esperando que sea almacenamiento duradero.
- Si se necesita backend multiusuario en una fase posterior: diseñar autenticación/autorización, aislamiento de usuarios, base de datos Postgres, object storage privado, cola/worker y límites de recursos antes de publicar. No añadir Supabase/servicios externos solo para cumplir el plazo.
- Mantener la primera entrega gratuita y sin APIs de generación de vídeo de pago. Si una función requiere coste o una clave, dejarla desactivada y documentada.
- Proteger claves y OAuth en variables secretas; nunca en JS cliente ni commits.

## 6. Agenda de trabajo sugerida
| Bloque | Tiempo | Resultado |
|---|---:|---|
| Auditoría de ramas, UI y pruebas | 45 min | Decisión de integración y lista de riesgos |
| Portado mínimo de pipeline browser-first | 2 h | Vídeo local → transcripción → cuatro clips |
| Edición y exportación | 2 h | Texto/timestamps/subtítulos → MP4/ZIP |
| UX, responsive y errores | 1 h 30 min | Flujo comprensible en escritorio y móvil compatible |
| Pruebas unitarias + E2E + MP4 real | 2 h | Evidencia reproducible |
| Render preview, smoke test y handoff | 1 h | URL de preview y lista de pendientes |
| **Total** | **9 h 15 min** | **MVP verificable, no SaaS completo** |

## 7. Criterios de aceptación
- [ ] Build y servidor estático responden correctamente.
- [ ] No hay errores JS no controlados en consola durante el flujo principal.
- [ ] Vídeo local de prueba carga y muestra duración.
- [ ] Whisper produce transcripción con marcas de tiempo en español y, al menos, una prueba en inglés.
- [ ] Se generan cuatro candidatos válidos, no solapados, de duración permitida y editables.
- [ ] Editar texto cambia los subtítulos exportados.
- [ ] MP4 exportado tiene vídeo H.264, 1080×1920, 30 fps y audio esperado.
- [ ] ZIP contiene exactamente los clips seleccionados.
- [ ] Proyecto se guarda y restaura en IndexedDB con el vídeo original vuelto a seleccionar.
- [ ] Se informa claramente si WebGPU/WebCodecs o memoria del dispositivo no son compatibles.
- [ ] Pruebas Python/JS y Playwright pasan, o cada fallo pendiente queda documentado con evidencia.
- [ ] Preview Render verificada manualmente; producción no se modifica sin aprobación.

## 8. Recursos que Codex debe leer
- `README.md`
- `render.yaml`
- `PUBLISHING_MATRIX.md`
- `static/index.html`, `static/app.js`, `static/editor.js`, `static/sw.js`
- `static/browser-whisper.js`, `static/browser-export.js`, `static/browser-url.js` (solo si existen en la rama de origen)
- `tests/` y `.github/workflows/quality.yml`
- PR #3: https://github.com/hugoaguilera022/ClipForge/pull/3
- Preview documentada: https://clipforge-preview-sb8n.onrender.com

## 9. Referencia de CI
La última ejecución consultada para el head del PR #3 (`a45f59668e47a5356016e041c5816d5b9eefe5ff`) terminó en fallo durante `pytest`; entre las aserciones desactualizadas aparecen pruebas de service worker, copy de interfaz, selección Whisper y encuadre facial. No eliminar tests de forma masiva: actualiza el contrato o corrige el código con pruebas de regresión. La ejecución de otra rama con 32 fallos tampoco es una medida del estado de `main`.

**Regla de cierre:** el resultado de la jornada debe ser una preview funcional, una rama limpia y evidencia de pruebas. No declarar producción lista si no hay persistencia, seguridad y validación multiusuario.
