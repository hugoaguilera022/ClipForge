# Diarización acústica opcional

- Añadido backend real `pyannote.audio` para detectar turnos de voz sobre el audio completo.
- Asigna etiquetas anónimas a segmentos y palabras por solapamiento temporal; preserva etiquetas explícitas ya aportadas.
- Añade `--diarize` y casilla web opt-in; registra `diarization.json` y metadatos en el perfil/manifest.
- Requiere `HF_TOKEN`, aceptación de condiciones y acceso al modelo. No simula diarización si el modelo no está disponible.
