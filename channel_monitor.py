"""Low-cost YouTube channel publication monitor using public channel RSS feeds.

It discovers public uploads only. It does not download or copy audiovisual media.
"""
from __future__ import annotations
import json, os, re, threading, time, urllib.request, urllib.error, xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse, urlencode

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
STORE = DATA / 'channels.json'
LOCK = threading.RLock()
_SCHEDULER_LOCK = threading.Lock()
_REFRESH_LOCK = threading.Lock()
_SCHEDULER_STARTED = False
CHANNEL_ID = re.compile(r'^UC[a-zA-Z0-9_-]{22}$')
VIDEO_ID = re.compile(r'^[a-zA-Z0-9_-]{11}$')
NS = {'yt':'http://www.youtube.com/xml/schemas/2015', 'atom':'http://www.w3.org/2005/Atom'}

def channel_id_from_url(value: str) -> str:
    """Resolve canonical channel URLs and @handles; API key is optional."""
    u = urlparse((value or '').strip())
    if u.scheme != 'https' or u.hostname not in {'youtube.com','www.youtube.com','m.youtube.com'}:
        raise ValueError('Introduce una URL HTTPS de un canal de YouTube.')
    match = re.fullmatch(r'/channel/(UC[a-zA-Z0-9_-]{22})/?', u.path)
    if match:
        return match.group(1)
    handle_match = re.fullmatch(r'/@([a-zA-Z0-9._-]{3,30})/?', u.path)
    if not handle_match:
        raise ValueError('Usa la URL del canal /channel/UC… o /@handle. No se admiten enlaces de vídeos.')
    handle = handle_match.group(1)
    api_key = os.getenv('YOUTUBE_API_KEY', '').strip()
    if api_key:
        params = urlencode({'part':'id','forHandle':handle,'key':api_key})
        req = urllib.request.Request('https://www.googleapis.com/youtube/v3/channels?'+params, headers={'User-Agent':'ClipForge/1.0'})
        try:
            with urllib.request.urlopen(req, timeout=12) as response:
                payload = json.loads(response.read(512*1024).decode('utf-8'))
            channel_id = (((payload.get('items') or [{}])[0]).get('id') or '')
            if CHANNEL_ID.fullmatch(channel_id): return channel_id
        except Exception as exc:
            raise ValueError('No se pudo resolver @'+handle+' con la API de YouTube: '+str(exc)[:180]) from exc
        raise ValueError('YouTube no encontró el canal @'+handle+'.')
    # No-key fallback: read only the public channel page and extract its canonical ID.
    req = urllib.request.Request('https://www.youtube.com/@'+handle, headers={'User-Agent':'Mozilla/5.0 (compatible; ClipForge/1.0)'})
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            page = response.read(5*1024*1024).decode('utf-8', 'replace')
        candidates = re.findall(r'"(?:externalId|channelId)"\s*:\s*"(UC[a-zA-Z0-9_-]{22})"', page)
        if not candidates:
            candidates = re.findall(r'youtube\.com/channel/(UC[a-zA-Z0-9_-]{22})', page)
        if candidates and CHANNEL_ID.fullmatch(candidates[0]): return candidates[0]
    except Exception as exc:
        raise ValueError('No se pudo resolver @'+handle+'. Comprueba la conexión o configura YOUTUBE_API_KEY: '+str(exc)[:160]) from exc
    raise ValueError('No se pudo encontrar el ID del canal @'+handle+'. Prueba con su URL /channel/UC… o configura YOUTUBE_API_KEY.')

def _load() -> list[dict]:
    DATA.mkdir(exist_ok=True)
    try:
        data = json.loads(STORE.read_text(encoding='utf-8'))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []

def _save(items: list[dict]) -> None:
    DATA.mkdir(exist_ok=True)
    tmp = STORE.with_suffix('.tmp')
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(STORE)

def list_channels() -> list[dict]:
    with LOCK: return _load()

def add_channel(url: str, label: str = '') -> dict:
    cid = channel_id_from_url(url)
    with LOCK:
        items = _load()
        existing = next((x for x in items if x['channel_id'] == cid), None)
        if existing: return existing
        item = {'channel_id':cid, 'url':f'https://www.youtube.com/channel/{cid}', 'label':(label or cid)[:100], 'enabled':True, 'added_at':int(time.time()), 'videos':[], 'last_checked':None, 'last_error':None}
        items.append(item); _save(items)
        return item

def mark_video_seen(cid: str, video_id: str) -> bool:
    if not CHANNEL_ID.fullmatch(cid) or not VIDEO_ID.fullmatch(video_id):
        raise ValueError('invalid_channel_or_video_id')
    with LOCK:
        items = _load()
        channel = next((x for x in items if x.get('channel_id') == cid), None)
        if channel is None:
            return False
        found = False
        for video in channel.get('videos', []):
            if video.get('video_id') == video_id:
                video['is_new'] = False
                video['seen_at'] = int(time.time())
                found = True
                break
        if found:
            _save(items)
        return found

def remove_channel(cid: str) -> bool:
    with LOCK:
        items = _load(); updated = [x for x in items if x['channel_id'] != cid]
        if len(updated) == len(items): return False
        _save(updated); return True

def fetch_feed(cid: str, timeout: int = 15) -> list[dict]:
    if not CHANNEL_ID.fullmatch(cid): raise ValueError('invalid_channel_id')
    url = f'https://www.youtube.com/feeds/videos.xml?channel_id={cid}'
    req = urllib.request.Request(url, headers={'User-Agent':'ClipForge/1.0 (local channel feed monitor)'})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        if response.status != 200: raise RuntimeError(f'feed_http_{response.status}')
        raw = response.read(2*1024*1024 + 1)
    if len(raw) > 2*1024*1024: raise RuntimeError('feed_too_large')
    root = ET.fromstring(raw)
    entries=[]
    for entry in root.findall('atom:entry', NS):
        vid=(entry.findtext('yt:videoId', default='', namespaces=NS) or '').strip()
        if not VIDEO_ID.fullmatch(vid): continue
        entries.append({'video_id':vid,'title':(entry.findtext('atom:title',default='',namespaces=NS) or '')[:300], 'url':f'https://www.youtube.com/watch?v={vid}', 'published':entry.findtext('atom:published',default='',namespaces=NS), 'author':entry.findtext('atom:author/atom:name',default='',namespaces=NS)})
    return entries

def refresh_channels() -> dict:
    """Refresh feeds without holding the storage lock during network I/O.

    A separate refresh lock prevents the daily scheduler and a manual refresh
    from racing, while ordinary UI reads/add/remove operations remain responsive.
    """
    if not _REFRESH_LOCK.acquire(blocking=False):
        return {'channels': len(list_channels()), 'new_videos': 0, 'errors': [], 'status': 'already_running'}
    changed = 0
    errors = []
    try:
        with LOCK:
            snapshot = [dict(item) for item in _load() if item.get('enabled', True)]
        for snapshot_item in snapshot:
            cid = snapshot_item.get('channel_id', '')
            try:
                entries = fetch_feed(cid)
                previous = {v.get('video_id'): v for v in snapshot_item.get('videos', [])}
                for video in entries:
                    prior = previous.get(video['video_id'])
                    video['is_new'] = bool(prior.get('is_new')) if prior else True
                    if prior and prior.get('seen_at'):
                        video['seen_at'] = prior['seen_at']
                    if prior is None:
                        changed += 1
                error = None
            except Exception as exc:
                entries = None
                error = str(exc)[:300]
                errors.append({'channel_id': cid, 'error': error})
            # Merge only this channel's result. Do not overwrite changes made by
            # the user (e.g. mark-as-seen or remove) while the feed was fetched.
            with LOCK:
                items = _load()
                current = next((x for x in items if x.get('channel_id') == cid), None)
                if current is None:
                    continue
                current['last_checked'] = int(time.time())
                current['last_error'] = error
                if entries is not None:
                    latest = {v.get('video_id'): v for v in current.get('videos', [])}
                    for video in entries:
                        prior = latest.get(video['video_id'])
                        if prior:
                            video['is_new'] = bool(prior.get('is_new'))
                            if prior.get('seen_at'):
                                video['seen_at'] = prior['seen_at']
                    current['videos'] = entries[:15]
                _save(items)
        return {'channels': len(list_channels()), 'new_videos': changed, 'errors': errors, 'status': 'completed'}
    finally:
        _REFRESH_LOCK.release()


def scheduler_loop() -> None:
    # A local app only runs scheduled checks while its Mac process is running.
    while True:
        try: refresh_channels()
        except Exception: pass
        time.sleep(24*60*60)

def start_scheduler() -> bool:
    """Start at most one daily monitor thread per server process."""
    global _SCHEDULER_STARTED
    with _SCHEDULER_LOCK:
        if _SCHEDULER_STARTED:
            return False
        _SCHEDULER_STARTED = True
        thread=threading.Thread(target=scheduler_loop, name='clipforge-channel-monitor', daemon=True)
        thread.start()
        return True
