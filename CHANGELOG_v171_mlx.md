# v1.71.0 — MLX Whisper para Apple Silicon

- Añade MLX Whisper como primer motor de transcripción en macOS ARM64 (M1/M2/M3/M4).
- Normaliza segmentos y marcas de tiempo por palabra al formato interno de ClipForge.
- Mantiene whisper.cpp con Metal, Faster-Whisper y Apple Speech como alternativas/fallbacks.
- El lanzador instala `mlx-whisper` automáticamente en el entorno virtual privado de macOS ARM64.
- Añade `requirements-macos-mlx.txt` y pruebas unitarias del adaptador con MLX simulado.
- El endpoint `/api/health` informa de la disponibilidad de MLX y del motor seleccionado.
- Añade workflow macOS ARM64 para probar instalación real, transcripción española y timestamps.

La prueba MLX real requiere el runner macOS ARM64; las pruebas ejecutadas en Linux solo validan la integración y los fallbacks simulados.
