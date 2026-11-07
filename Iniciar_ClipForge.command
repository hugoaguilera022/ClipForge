#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

TITLE='CLIPFORGE · INICIO LOCAL'
VENV="$PWD/.venv"
PY="$VENV/bin/python3"

clear || true
echo '======================================'
echo "        $TITLE"
echo '======================================'
echo

if ! command -v python3 >/dev/null 2>&1; then
  echo 'ERROR: No encuentro Python 3.'
  echo 'Instala Python 3 desde https://www.python.org/downloads/macos/'
  read -r -p 'Pulsa Intro para cerrar...'
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  echo 'ERROR: No encuentro FFmpeg y FFprobe.'
  echo 'Instálalos con Homebrew: brew install ffmpeg'
  read -r -p 'Pulsa Intro para cerrar...'
  exit 1
fi

echo "Python: $(python3 --version)"
echo "FFmpeg: $(ffmpeg -version | head -n 1)"
echo

if [ ! -x "$PY" ]; then
  echo 'Preparando el entorno privado de ClipForge…'
  python3 -m venv "$VENV"
fi

# MLX Whisper is the preferred engine on Apple Silicon; whisper.cpp remains the fallback.
if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then
  echo 'Preparando MLX Whisper (motor local acelerado para Apple Silicon)…'
  if ! "$PY" -c 'import mlx_whisper' >/dev/null 2>&1; then
    if "$PY" -m pip install -r requirements-macos-mlx.txt; then
      echo 'MLX Whisper instalado. El modelo se descargará una sola vez al transcribir.'
    else
      echo 'AVISO: no se pudo instalar MLX Whisper; se probará whisper.cpp y después Faster-Whisper.'
    fi
  else
    echo 'MLX Whisper ya está instalado.'
  fi
  # Use the best practical local model by default on Apple Silicon.
  # Users can override this with CLIPFORGE_MLX_MODEL before launching.
  export CLIPFORGE_MLX_MODEL="${CLIPFORGE_MLX_MODEL:-large-v3-turbo}"
  echo "Modelo MLX predeterminado: $CLIPFORGE_MLX_MODEL"
  # Keep Faster-Whisper available as a local fallback if MLX/model loading fails.
  if ! "$PY" -c 'import faster_whisper' >/dev/null 2>&1; then
    echo 'Instalando Faster-Whisper como motor de respaldo…'
    "$PY" -m pip install -r requirements.txt || echo 'AVISO: Faster-Whisper no está disponible; MLX sigue siendo el motor principal.'
  fi
fi

# Install optional OpenCV face detection/tracking for better portrait reframing.
if ! "$PY" -c 'import cv2' >/dev/null 2>&1; then
  echo 'Instalando OpenCV para seguimiento visual…'
  "$PY" -m pip install 'opencv-python-headless>=4.9' || echo 'AVISO: OpenCV no está disponible; ClipForge usará encuadre alternativo.'
fi

if [ "$(uname -s)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
  echo 'Preparando whisper.cpp (motor local gratuito con aceleración Metal como respaldo)…'
  if ! command -v whisper-cli >/dev/null 2>&1 && ! command -v whisper-cpp >/dev/null 2>&1; then
    if ! brew install whisper.cpp; then
      echo 'AVISO: no se pudo instalar whisper.cpp; se intentará Faster-Whisper como alternativa.'
    fi
  fi
  if ! "$PY" -c 'import faster_whisper' >/dev/null 2>&1; then
    echo 'Faster-Whisper se mantiene como alternativa opcional; no es necesario para el motor Metal.'
  fi
else
  echo 'Comprobando Faster-Whisper (motor local multiplataforma)…'
  if ! "$PY" -c 'import faster_whisper' >/dev/null 2>&1; then
    if "$PY" -m pip install -r requirements.txt; then
      echo 'Faster-Whisper instalado correctamente.'
    else
      echo 'AVISO: no se pudo instalar Faster-Whisper. Se intentará whisper.cpp si está disponible.'
    fi
  else
    echo 'Faster-Whisper ya está instalado; no se actualizará en cada arranque.'
  fi
fi

# Install whisper.cpp on other Homebrew systems too when Faster-Whisper is unavailable.
if ! command -v whisper-cli >/dev/null 2>&1 && ! command -v whisper-cpp >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1 && ! "$PY" -c 'import faster_whisper' >/dev/null 2>&1; then
    echo 'Instalando motor alternativo gratuito whisper.cpp…'
    brew install whisper.cpp || echo 'AVISO: no se pudo instalar whisper.cpp; se conservarán los motores disponibles.'
  fi
fi

# yt-dlp is optional: never prevent local-file editing if installation/network fails.
echo 'Comprobando yt-dlp (solo se instala si falta)…'
if ! "$PY" -c 'import yt_dlp' >/dev/null 2>&1; then
  if "$PY" -m pip install 'yt-dlp[default]'; then
    echo 'yt-dlp instalado correctamente.'
  else
    echo 'AVISO: No se pudo instalar yt-dlp.'
    echo 'ClipForge seguirá funcionando con vídeos locales; las URLs de YouTube quedarán desactivadas.'
  fi
else
  echo 'yt-dlp ya está instalado; no se actualizará en cada arranque.'
fi

# Deno improves YouTube extraction but is not required for local workflows.
if "$PY" -c 'import yt_dlp' >/dev/null 2>&1 && ! command -v deno >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo
    echo 'Deno es opcional y mejora la extracción de YouTube. Intentando instalarlo…'
    if ! brew install deno; then
      echo 'AVISO: Deno no se pudo instalar; se continuará sin él.'
    fi
  else
    echo 'AVISO: Deno no está instalado; algunas URLs de YouTube pueden fallar.'
  fi
fi

echo
"$PY" - <<'PY'
import importlib.util, shutil
print('yt-dlp:', 'instalado' if importlib.util.find_spec('yt_dlp') else 'NO instalado (vídeos locales disponibles)')
print('Deno:', shutil.which('deno') or 'no instalado (opcional)')
print('MLX Whisper:', 'instalado' if importlib.util.find_spec('mlx_whisper') else 'no instalado (se usará whisper.cpp/Faster-Whisper)')
print('Faster-Whisper:', 'instalado' if importlib.util.find_spec('faster_whisper') else 'no instalado')
print('whisper.cpp:', shutil.which('whisper-cli') or shutil.which('whisper-cpp') or 'no instalado')
print('OpenCV:', 'instalado' if importlib.util.find_spec('cv2') else 'no instalado (se usará recorte centrado)')
PY

echo
echo 'Abriendo ClipForge en http://127.0.0.1:8765'
echo 'Deja esta ventana abierta mientras utilizas la aplicación.'
echo 'Para cerrar ClipForge, pulsa Control + C.'
(sleep 2; open 'http://127.0.0.1:8765') >/dev/null 2>&1 &
exec "$PY" server.py
