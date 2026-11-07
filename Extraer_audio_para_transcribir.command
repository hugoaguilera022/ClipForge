#!/bin/bash
set -e
cd "$(dirname "$0")"
if ! command -v ffmpeg >/dev/null 2>&1; then
  osascript -e 'display alert "No se encuentra FFmpeg" message "ClipForge necesita FFmpeg para extraer el audio."'
  exit 1
fi
VIDEO=$(osascript -e 'POSIX path of (choose file with prompt "Selecciona el vídeo del que quieres extraer el audio")')
[ -n "$VIDEO" ] || exit 0
DIR=$(dirname "$VIDEO")
NAME=$(basename "$VIDEO")
STEM="${NAME%.*}"
OUT="$DIR/${STEM}_audio_para_transcribir.m4a"
ffmpeg -y -i "$VIDEO" -vn -c:a aac -b:a 128k "$OUT"
osascript -e "display notification \"Audio guardado en: $OUT\" with title \"ClipForge\""
open -R "$OUT"
