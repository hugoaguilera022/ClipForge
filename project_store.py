"""Versioned, atomic local project persistence for ClipForge."""
from __future__ import annotations
import json, os, re, tempfile, time
from pathlib import Path
from typing import Any

SCHEMA = "clipforge-project-v2"
PROJECT_ID = re.compile(r"^[a-f0-9]{12,32}$")
MAX_PROJECT_BYTES = 20 * 1024 * 1024
MAX_CLIPS = 500
MAX_TRACKS = 32

class ProjectError(ValueError):
    pass

def validate_project(data: Any) -> dict:
    if not isinstance(data, dict):
        raise ProjectError("El proyecto debe ser un objeto JSON.")
    if data.get("schema") not in {SCHEMA, "clipforge-browser-project-v1"}:
        raise ProjectError("Versión de proyecto no compatible.")
    source = data.get("source", "")
    if not isinstance(source, str) or len(source) > 1024:
        raise ProjectError("Referencia de vídeo no válida.")
    clips = data.get("clips", [])
    if not isinstance(clips, list) or len(clips) > MAX_CLIPS:
        raise ProjectError("Número de clips no válido.")
    normalized = []
    for index, clip in enumerate(clips):
        if not isinstance(clip, dict):
            raise ProjectError(f"Clip {index + 1} no válido.")
        try:
            start, end = float(clip["start"]), float(clip["end"])
        except (KeyError, TypeError, ValueError):
            raise ProjectError(f"Tiempos no válidos en clip {index + 1}.")
        if start < 0 or end <= start or end > 6 * 60 * 60:
            raise ProjectError(f"Intervalo no válido en clip {index + 1}.")
        normalized.append({**clip, "id": str(clip.get("id") or f"clip-{index+1}"),
                           "start": start, "end": end})
    tracks = data.get("tracks", [])
    if not isinstance(tracks, list) or len(tracks) > MAX_TRACKS:
        raise ProjectError("Número de pistas no válido.")
    allowed_types = {"video", "audio", "subtitles", "text", "image"}
    normalized_tracks = []
    for index, track in enumerate(tracks):
        if not isinstance(track, dict) or track.get("type") not in allowed_types:
            raise ProjectError(f"Tipo de pista no válido en la pista {index + 1}.")
        items = track.get("items", [])
        if not isinstance(items, list) or len(items) > 2000:
            raise ProjectError(f"Elementos no válidos en la pista {index + 1}.")
        clean_items = []
        for item in items:
            if not isinstance(item, dict):
                raise ProjectError("Elemento de pista no válido.")
            try:
                start, end = float(item["start"]), float(item["end"])
            except (KeyError, TypeError, ValueError):
                raise ProjectError("Tiempos de elemento no válidos.")
            if start < 0 or end <= start or end > 6 * 60 * 60:
                raise ProjectError("Intervalo de elemento no válido.")
            clean_items.append({**item, "start": start, "end": end})
        normalized_tracks.append({**track, "id": str(track.get("id") or f"track-{index+1}"),
                                  "items": clean_items})
    transcript = data.get("transcript")
    if transcript is not None and not isinstance(transcript, dict):
        raise ProjectError("Transcripción no válida.")
    result = dict(data)
    result.update({"schema": SCHEMA, "source": source, "clips": normalized,
                   "tracks": normalized_tracks, "updated_at": time.time()})
    return result

def save_project(root: Path, project_id: str, data: Any) -> dict:
    if not PROJECT_ID.fullmatch(project_id):
        raise ProjectError("Identificador de proyecto no válido.")
    normalized = validate_project(data)
    root.mkdir(parents=True, exist_ok=True)
    target = root / f"{project_id}.json"
    encoded = json.dumps(normalized, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_PROJECT_BYTES:
        raise ProjectError("El proyecto supera el límite de 20 MB.")
    fd, tmp_name = tempfile.mkstemp(prefix=f".{project_id}.", suffix=".tmp", dir=root)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp_name, target)
    finally:
        try: os.unlink(tmp_name)
        except FileNotFoundError: pass
    return {"id": project_id, "schema": SCHEMA, "updated_at": normalized["updated_at"],
            "source": normalized["source"], "clip_count": len(normalized["clips"]),
            "track_count": len(normalized["tracks"])}

def load_project(root: Path, project_id: str) -> dict:
    if not PROJECT_ID.fullmatch(project_id):
        raise ProjectError("Identificador de proyecto no válido.")
    path = root / f"{project_id}.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ProjectError("Proyecto no encontrado.")
    except (OSError, json.JSONDecodeError):
        raise ProjectError("El archivo del proyecto está dañado o no se puede leer.")
    return validate_project(data)

def list_projects(root: Path) -> list[dict]:
    if not root.exists(): return []
    result = []
    for path in sorted(root.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        if not PROJECT_ID.fullmatch(path.stem): continue
        try:
            data = load_project(root, path.stem)
            result.append({"id": path.stem, "source": data["source"],
                           "updated_at": data.get("updated_at"),
                           "clip_count": len(data["clips"]),
                           "track_count": len(data["tracks"])})
        except ProjectError:
            continue
    return result
