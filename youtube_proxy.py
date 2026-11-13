#!/usr/bin/env python3
"""Temporary, bounded YouTube source importer for ClipForge's browser editor."""
from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlparse

FRONTEND_ORIGIN = os.getenv("CLIPFORGE_FRONTEND_ORIGIN", "https://clipforge-preview-sb8n.onrender.com").rstrip("/")
MAX_BYTES = 512 * 1024 * 1024
MAX_DURATION = 6 * 60 * 60
DOWNLOADS = threading.BoundedSemaphore(2)
RATE_LOCK = threading.Lock()
RATE = {}


def validate_youtube_url(value: str) -> str:
    """Accept only HTTPS watch/shorts/youtu.be URLs; never arbitrary remote hosts."""
    parsed = urlparse(str(value or "").strip())
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not (
        host == "youtu.be" or host == "youtube.com" or host.endswith(".youtube.com")
    ):
        raise ValueError("Introduce un enlace HTTPS de YouTube válido.")
    if host == "youtu.be":
        video_id = parsed.path.strip("/").split("/")[0]
        if not re.fullmatch(r"[A-Za-z0-9_-]{6,20}", video_id):
            raise ValueError("El enlace corto de YouTube no contiene un ID válido.")
    elif not (parsed.path == "/watch" or parsed.path.startswith(("/shorts/", "/live/", "/embed/"))):
        raise ValueError("Usa un enlace de vídeo de YouTube, no una página de canal o lista.")
    if parsed.username or parsed.password or parsed.port:
        raise ValueError("El enlace contiene componentes no permitidos.")
    return value.strip()


def safe_filename(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or "clipforge-youtube"))
    return (value.strip("._-")[:120] or "clipforge-youtube") + ".mp4"


def rate_allowed(client: str) -> bool:
    now = time.time()
    with RATE_LOCK:
        recent = [stamp for stamp in RATE.get(client, []) if now - stamp < 600]
        if len(recent) >= 3:
            RATE[client] = recent
            return False
        recent.append(now)
        RATE[client] = recent
        return True


class Handler(BaseHTTPRequestHandler):
    server_version = "ClipForgeIngest/1.0"

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin == FRONTEND_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", FRONTEND_ORIGIN)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "600")
            self.send_header("Access-Control-Expose-Headers", "Content-Disposition, Content-Length")

    def _json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if self.headers.get("Origin") != FRONTEND_ORIGIN:
            self.send_error(403)
            return
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_HEAD(self):
        if self.path not in ("/", "/health"):
            self.send_response(404)
            self.end_headers()
            return
        body = json.dumps({"ok": True, "service": "clipforge-youtube-ingest", "max_bytes": MAX_BYTES}).encode("utf-8")
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_GET(self):
        if self.path not in ("/", "/health"):
            self._json(404, {"error": "not_found"})
            return
        self._json(200, {"ok": True, "service": "clipforge-youtube-ingest", "max_bytes": MAX_BYTES})

    def do_POST(self):
        if self.path != "/api/youtube/download":
            self._json(404, {"error": "not_found"})
            return
        if self.headers.get("Origin") != FRONTEND_ORIGIN:
            self._json(403, {"error": "origin_not_allowed"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 16_384:
                raise ValueError("La petición no es válida.")
            payload = json.loads(self.rfile.read(length))
            if payload.get("rights_confirmed") is not True:
                raise ValueError("Confirma que tienes autorización para descargar y editar este vídeo.")
            url = validate_youtube_url(payload.get("url", ""))
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            self._json(400, {"error": str(exc)})
            return

        client = (self.headers.get("X-Forwarded-For", "").split(",")[0].strip() or self.client_address[0])[:80]
        if not rate_allowed(client):
            self._json(429, {"error": "Has alcanzado el límite temporal de importaciones. Espera unos minutos."})
            return
        if not DOWNLOADS.acquire(blocking=False):
            self._json(429, {"error": "Hay dos importaciones en curso. Vuelve a intentarlo en unos minutos."})
            return

        try:
            try:
                import yt_dlp
            except ImportError:
                self._json(503, {"error": "El descargador gratuito no está instalado en este servicio."})
                return

            with tempfile.TemporaryDirectory(prefix="clipforge-") as folder:
                output = str(Path(folder) / "source.%(ext)s")

                def progress_hook(data):
                    if data.get("status") == "downloading" and int(data.get("downloaded_bytes") or 0) > MAX_BYTES:
                        raise yt_dlp.utils.DownloadError("El vídeo supera el límite de 512 MB.")

                options = {
                    "format": "bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4][height<=1080]/best[ext=mp4]",
                    "outtmpl": output,
                    "noplaylist": True,
                    "quiet": True,
                    "no_warnings": True,
                    "max_filesize": MAX_BYTES,
                    "socket_timeout": 25,
                    "retries": 2,
                    "fragment_retries": 2,
                    "js_runtimes": {"deno": {}},
                    "remote_components": ["ejs:github"],
                    "progress_hooks": [progress_hook],
                    "merge_output_format": "mp4",
                }
                try:
                    with yt_dlp.YoutubeDL(options) as ydl:
                        info = ydl.extract_info(url, download=False)
                        if float(info.get("duration") or 0) > MAX_DURATION:
                            raise ValueError("El vídeo supera las seis horas permitidas.")
                        info = ydl.process_ie_result(info, download=True)
                        path = Path(ydl.prepare_filename(info))
                        if not path.is_file():
                            candidates = [p for p in Path(folder).iterdir() if p.is_file() and not p.name.endswith(".part")]
                            path = candidates[0] if candidates else path
                except ValueError:
                    raise
                except Exception as exc:
                    message = str(exc)
                    if "512 MB" in message:
                        raise ValueError("El vídeo supera el límite de 512 MB.") from exc
                    raise RuntimeError("No se pudo descargar este vídeo de YouTube. Puede ser privado, estar restringido o requerir una sesión.") from exc

                if not path.is_file() or path.stat().st_size <= 0:
                    raise RuntimeError("YouTube no devolvió un archivo de vídeo válido.")
                if path.suffix.lower() != ".mp4":
                    raise RuntimeError("No se pudo obtener una versión MP4 compatible de este vídeo.")
                size = path.stat().st_size
                if size > MAX_BYTES:
                    raise ValueError("El vídeo supera el límite de 512 MB.")

                name = safe_filename(info.get("title") or info.get("id"))
                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "video/mp4" if path.suffix.lower() == ".mp4" else "application/octet-stream")
                self.send_header("Content-Length", str(size))
                self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(name))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                with path.open("rb") as stream:
                    while True:
                        chunk = stream.read(1024 * 1024)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
        except (ValueError, RuntimeError) as exc:
            self._json(400, {"error": str(exc)})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self._json(500, {"error": "La importación ha fallado. Inténtalo con otro enlace compatible."})
        finally:
            DOWNLOADS.release()

    def log_message(self, fmt, *args):
        # Avoid logging full YouTube URLs or personal identifiers.
        print("ClipForge ingest:", fmt % args, flush=True)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "10000"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
