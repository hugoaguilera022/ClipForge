# ClipForge Web 1.72.0 — estudio local de clips con IA

ClipForge convierte vídeos autorizados en clips verticales editables. La web se sirve en el propio equipo; el vídeo, audio y renderizado permanecen locales.

## Arquitectura

- **Interfaz:** HTML/CSS/JavaScript + PWA.
- **Servidor:** Python estándar, sin framework web obligatorio.
- **Transcripción principal en Apple Silicon:** MLX Whisper (M1/M2/M3/M4), acelerado por el hardware Apple y ejecutado en local. En Windows/Linux y como respaldo se utiliza Faster-Whisper/CTranslate2; whisper.cpp es un respaldo nativo con Metal en macOS.
- **Alternativa independiente:** whisper.cpp, motor C/C++ gratuito con aceleración Metal/Accelerate en Apple Silicon; descarga el modelo seleccionado al primer uso.
- **Alineación:** Faster-Whisper entrega marcas de tiempo por palabra. WhisperX queda como mejora opcional para diarización/alineación avanzada; no es requisito del flujo básico.
- **Vídeo:** FFmpeg/FFprobe.
- **Selección de clips:** genera un conjunto ampliado con puntuación editorial contextual; si Ollama y el modelo local `qwen2.5:3b` están instalados, un reranker semántico local selecciona los mejores candidatos. Si no están disponibles, continúa automáticamente con heurísticas. No equivale a predicción de viralidad.
- **Encuadre:** OpenCV/Haar opcional. El seguimiento de rostro es aproximado, no identifica al hablante. En planos con varias caras simultáneas detectadas repetidamente, ClipForge conserva el plano completo sobre fondo desenfocado para evitar cortar a uno de los interlocutores; en planos de una sola cara mantiene el recorte con seguimiento.
- **Compatibilidad:** el servidor y el reconocimiento principal no dependen de Apple Speech ni de Swift. Apple Speech se conserva únicamente como fallback heredado en macOS.

## Requisitos

- Python 3.10+ (se recomienda 3.11 o 3.12 para compatibilidad máxima con extras de visión).
- FFmpeg y FFprobe disponibles en PATH.
- En Mac Apple Silicon, MLX Whisper se instala automáticamente en el entorno privado al iniciar y usa `large-v3-turbo` por defecto; se puede cambiar con `CLIPFORGE_MLX_MODEL`. En otros sistemas se instala Faster-Whisper. El modelo se descarga una vez al primer uso.
- El modelo configurado se descarga una sola vez en el primer trabajo; después la transcripción puede funcionar sin conexión. Modelos disponibles: `tiny`, `base`, `small`, `medium` y `large-v3-turbo`.
- CPU INT8 es la ruta portable. GPU NVIDIA puede acelerarse con configuración CTranslate2/CUDA; Apple Silicon prioriza MLX Whisper; si no está disponible, usa whisper.cpp con Metal cuando esté instalado.

## Ejecutar en macOS

1. Abre `Iniciar_ClipForge.command`.
2. El lanzador crea `.venv` e instala MLX Whisper en Apple Silicon. Si falla, intenta whisper.cpp mediante Homebrew y conserva Faster-Whisper como alternativa. El modelo se descarga al primer uso.
3. Abre `http://127.0.0.1:8765`.
4. En el primer trabajo se descarga el modelo seleccionado. No cierres ClipForge mientras transcribe.

También se puede iniciar manualmente:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python server.py
```

## Modelos y rendimiento

- `base`: menor descarga y uso de memoria; adecuado para comprobar funcionamiento.
- `small`: recomendado para español y calidad equilibrada.
- `medium`: más preciso en condiciones difíciles, con más memoria y tiempo.

La primera descarga requiere Internet. En Apple Silicon el modelo predeterminado es `large-v3-turbo` si se define `CLIPFORGE_MLX_MODEL=large-v3-turbo`; se puede cambiar a `small`, `medium` o `tiny`. El software y los modelos se ejecutan localmente; no se envía el audio a una API. No se promete velocidad en tiempo real: depende de CPU, memoria y duración del vídeo.

## Selección semántica local opcional

ClipForge consulta únicamente `http://127.0.0.1:11434` (Ollama local). Si existe el modelo `qwen2.5:3b`, reordena candidatos usando sus textos y contexto; devuelve IDs, nunca timestamps, para impedir que el LLM invente tiempos. Si Ollama o el modelo no están disponibles, la selección heurística sigue funcionando sin bloquear el trabajo. Puedes cambiar el modelo con `CLIPFORGE_OLLAMA_MODEL` y el endpoint con `CLIPFORGE_OLLAMA_URL`.

## Extras opcionales

`requirements-optional.txt` contiene OpenCV, MediaPipe (cuando hay wheel para la versión de Python) y WhisperX. No son necesarios para la transcripción principal ni para arrancar la web. WhisperX/diarización puede requerir modelos adicionales, mucha memoria y aceptar licencias de modelos de terceros.

## Verificación

```bash
python -m py_compile server.py clipforge.py channel_monitor.py
PYTHONPATH=. pytest -q
node --check static/app.js
```

La batería automatizada verifica lógica y adaptadores con modelos simulados; **no certifica la precisión acústica de Faster-Whisper**. Para certificar reconocimiento real hay que descargar el modelo y ejecutar el vídeo de prueba completo, comparar texto contra el audio y revisar tiempos por palabra. whisper.cpp se integra como fallback, pero no se ha podido descargar ni ejecutar el binario/modelo en este entorno sin acceso a red.

## Limitaciones actuales

- La selección de momentos aún utiliza reglas y puntuación editorial heurística. El siguiente hito es selección semántica local con Ollama y revisión manual de candidatos.
- El encuadre Haar puede seguir una cara equivocada en entrevistas con varias personas. El siguiente hito visual es detección y seguimiento de sujetos con análisis por escenas.
- Publicación automática en redes no está habilitada: requiere OAuth, revisión de aplicaciones y permisos oficiales.
- No exponer el servidor local a Internet: todavía no incorpora autenticación multiusuario, TLS ni almacenamiento de credenciales para despliegue público.
- Procesa únicamente material que tengas derecho a editar. La confirmación de prueba privada no concede derechos de publicación.

## Entrada automática local

La carpeta `incoming/` admite vídeos acompañados de un manifiesto de autorización. Usa `INBOX_MANIFEST.example.json` como plantilla; el ejemplo no concede autorización por sí mismo. El titular y la referencia de permiso deben rellenarse de forma explícita antes de importar.

## Seguridad y recursos

El servidor local limita la subida web a 512 MB. Los trabajos se serializan para limitar consumo de RAM. Los modelos pueden ocupar cientos de MB o más en disco; el usuario debe conservar espacio suficiente.

## v162 — extracción de audio MP4 en navegador

- Sustituye la ruta defectuosa que intentaba pasar el archivo MP4 completo (vídeo + audio) a `AudioContext.decodeAudioData`.
- La ruta preferente ahora usa Mediabunny para demultiplexar la pista de audio del MP4, decodificarla por muestras y convertirla a mono 16 kHz para Whisper sin reproducir los 3:33 en tiempo real.
- Mantiene `captureStream` + `MediaRecorder` como fallback para navegadores/códecs no compatibles.
- Comprueba que exista una pista de audio, que el navegador pueda decodificarla, que la duración sea válida y que se hayan extraído muestras no silenciosas. Cierra cada muestra para evitar acumular memoria.
- El motor Python/FFmpeg de renderizado no se ha modificado.

Verificación en este entorno: el MP4 de prueba dura 213,34 s, contiene H.264 + AAC estéreo a 44,1 kHz; FFmpeg extrajo su audio a mono 16 kHz con duración 213,35 s. `node --check`, `py_compile` y 134 pruebas automatizadas pasan. La ejecución real de Mediabunny y Whisper dentro de Chrome/Safari todavía requiere una prueba de navegador; no se declara completada.

## Núcleo de trabajos persistente (SQLite)

El registro operativo de trabajos se guarda en `data/jobs.sqlite3` con SQLite en modo WAL y sincronización FULL. El archivo `data/jobs.json` se conserva como espejo de compatibilidad y fuente de migración para instalaciones anteriores. La cola recupera trabajos `queued`/`processing` al iniciar cuando la fuente sigue disponible; los metadatos se guardan mediante transacciones y los trabajos activos no se eliminan al limitar el historial. SQLite evita escrituras parciales del registro completo y permite consultas persistentes tras reinicios.

Esta persistencia **no convierte por sí sola la aplicación en un servicio multiusuario ni autoriza su exposición pública**: siguen pendientes autenticación/autorización, almacenamiento de objetos privado, aislamiento de usuarios, límites de recursos y workers desplegables independientes.

## Cola de renderizado con worker independiente

El servidor HTTP ya no ejecuta renderizados en hilos de petición. Las subidas, reintentos y entradas autorizadas de `incoming/` se guardan en SQLite como trabajos `queued`. `worker.py` es un proceso separado que reclama cada trabajo de forma atómica, renueva su concesión mientras ejecuta Whisper/FFmpeg y confirma el estado final solo si conserva la propiedad de la concesión.

Al iniciar `server.py`, se inicia un worker hijo y un supervisor que lo reinicia si el proceso termina. Si el worker cae durante un render, la concesión expira y el siguiente worker recupera el trabajo. El navegador consulta el estado actualizado desde SQLite. También se puede ejecutar el worker manualmente con `python3 worker.py`; todos los procesos deben compartir la misma carpeta de datos y archivos.

La ejecución sigue siendo local-first: servidor y worker comparten la misma carpeta de datos, los archivos subidos y FFmpeg. Esto no equivale todavía a despliegue multiusuario en varios servidores ni a almacenamiento compartido remoto.

### Diarización acústica opcional

La casilla **Separar hablantes por voz** activa `pyannote/speaker-diarization-community-1` sobre el audio completo. Instala `requirements-optional.txt`, acepta las condiciones/licencia del modelo en Hugging Face y configura `HF_TOKEN` en el entorno del servidor/worker. La salida `diarization.json` contiene turnos y etiquetas anónimas (`speaker_1`, `speaker_2`); no identifica personas. Sin token, acceso al modelo o conexión inicial para descargarlo, la opción falla con un error explícito y no inventa hablantes. La diarización no está activada por defecto.


## v169: proyectos persistentes y editor de pistas

Se incorpora un editor local inicial para organizar clips y pistas de vídeo, audio, subtítulos, texto e imágenes. Los proyectos se guardan en `projects/` mediante JSON versionado y escritura atómica.

API de proyectos:
- `GET /api/projects`: lista proyectos.
- `GET /api/projects/{id}`: recupera un proyecto.
- `POST /api/projects`: crea o actualiza un proyecto.

El guardado valida IDs, intervalos temporales, tipos de pista y límites de tamaño. El editor permite modificar los tiempos y el contenido de elementos de pista y recuperar los proyectos guardados.

**Alcance actual:** este editor constituye una base funcional de organización y persistencia de pistas. No debe confundirse con un NLE profesional completo: aún no incorpora reproducción multipista sincronizada, waveform interactiva, keyframes, mezclador avanzado ni previsualización en tiempo real de todas las capas.
