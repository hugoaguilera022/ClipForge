#!/usr/bin/env python3
"""ClipForge Web local-first server. Standard library only; no paid API."""
from __future__ import annotations
import math, platform
import json, os, re, subprocess, sys, threading, uuid, shutil, zipfile, io, importlib.util, time, queue, selectors, codecs
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import channel_monitor
from project_store import ProjectError, load_project, list_projects, save_project

ROOT=Path(__file__).resolve().parent
STATIC=ROOT/'static'; UPLOADS=ROOT/'uploads'; OUTPUTS=ROOT/'outputs'; DATA=ROOT/'data'; INBOX=ROOT/'incoming'; INBOX_PROCESSED=INBOX/'processed'; PROJECTS=ROOT/'projects'
for d in (UPLOADS,OUTPUTS,DATA,INBOX,INBOX_PROCESSED,PROJECTS): d.mkdir(parents=True,exist_ok=True)
INBOX_LOCK=threading.Lock(); INBOX_SCAN_LOCK=threading.Lock(); INBOX_STARTED=False; INBOX_STABILITY={}
JOBS_FILE=DATA/'jobs.json'  # legacy one-time migration source
from job_store import JobStore
JOB_STORE=JobStore(DATA/'jobs.sqlite3')
def job_store_for_registry()->JobStore:
 return JOB_STORE if JOBS_FILE == DATA/'jobs.json' else JobStore(JOBS_FILE.with_suffix('.sqlite3'))
LOCK=threading.RLock(); ENGINE=threading.Semaphore(1)
ACTIVE_WORKER_ID=None

def load_job_registry()->dict:
 store=job_store_for_registry()
 # SQLite is authoritative once it contains data. The legacy JSON is imported
 # only into an empty database; rereading it on every restart could roll back
 # newer job states written by a worker process.
 store.recover_expired()
 jobs=store.all()
 if not jobs:
  try:
   legacy=json.loads(JOBS_FILE.read_text(encoding='utf-8'))
   jobs=legacy if isinstance(legacy,dict) else {}
   if jobs: store.save_many(jobs)
  except (OSError,ValueError):
   jobs={}
 # Resume interrupted jobs when their original source and command are still available.
 recovered=False
 for job in jobs.values():
  if not isinstance(job,dict) or job.get('status') not in {'queued','processing'}:
   continue
  if job.get('status')=='processing' and float(job.get('lease_until') or 0)>time.time():
   # A separate worker still owns this job; do not launch a duplicate after
   # the HTTP server restarts.
   continue
  args=job.get('args')
  source=Path(args[3]) if isinstance(args,list) and len(args)>3 else None
  resumable=isinstance(args,list) and len(args)>3 and (bool(job.get('video_url')) or bool(source and source.is_file()))
  if resumable:
   # A missing optional subtitle file must not make an otherwise recoverable video fail.
   if '--transcript' in args:
    ti=args.index('--transcript')
    if ti+1>=len(args) or not Path(args[ti+1]).is_file():
     del args[ti:ti+2]
     job['args']=args
     job['transcript_path']=None
   elif job.get('transcript_path') and not Path(job['transcript_path']).is_file():
    job['transcript_path']=None
   job['status']='queued'
   job['log']=(str(job.get('log') or '')+'\nTrabajo recuperado tras reiniciar ClipForge; se reanudará automáticamente.').strip()
  else:
   job['status']='failed'
   job['log']=(str(job.get('log') or '')+'\nEl proceso se interrumpió y el archivo original ya no está disponible. Vuelve a importar el vídeo.').strip()
  recovered=True
 if recovered:
  store.save_many(jobs)
  tmp=JOBS_FILE.with_suffix('.tmp'); tmp.write_text(json.dumps(jobs,ensure_ascii=False,indent=2),encoding='utf-8'); tmp.replace(JOBS_FILE)
 return jobs

JOBS=load_job_registry()
_INITIAL_JOBS_OBJECT=JOBS

def sync_jobs_from_store()->None:
 # Refresh cross-process updates before serving status/history requests.
 # Tests and embedding callers may intentionally inject an isolated registry.
 if JOBS is not _INITIAL_JOBS_OBJECT: return
 latest=job_store_for_registry().all()
 with LOCK:
  JOBS.update(latest)

def persist_jobs_locked()->None:
 # Transactional durable persistence; caller must hold LOCK.
 store=job_store_for_registry()
 store.save_many(JOBS, limit=1000)
 snapshot=dict(list(sorted(JOBS.items(),key=lambda item:float(item[1].get('created') or 0),reverse=True))[:100])
 tmp=JOBS_FILE.with_suffix('.tmp')
 tmp.write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding='utf-8')
 tmp.replace(JOBS_FILE)

ALLOWED={'.mp4','.mov','.mkv','.webm'}

def yt_dlp_command()->list[str]|None:
 exe=shutil.which('yt-dlp')
 if exe: cmd=[exe]
 elif importlib.util.find_spec('yt_dlp'): cmd=[sys.executable,'-m','yt_dlp']
 else: return None
 if shutil.which('deno'): cmd.extend(['--js-runtimes','deno'])
 return cmd

def valid_video_url(value:str)->bool:
 from urllib.parse import urlparse
 try:
  u=urlparse(value.strip())
  host=(u.hostname or '').lower()
  return u.scheme=='https' and (host=='youtu.be' or host=='youtube.com' or host.endswith('.youtube.com') or host=='www.youtube.com')
 except Exception:return False

def fetch_youtube_metadata(url:str)->dict:
 cmd=yt_dlp_command()
 if not cmd:raise RuntimeError('Falta yt-dlp. Instálalo con: python3 -m pip install --user -U yt-dlp')
 p=subprocess.run(cmd+['--no-warnings','--no-playlist','--skip-download','--dump-single-json',url],capture_output=True,text=True,timeout=90)
 if p.returncode:raise RuntimeError('No se pudieron consultar los datos públicos de YouTube: '+(p.stderr or p.stdout)[-1200:])
 try:d=json.loads(p.stdout)
 except Exception:raise RuntimeError('YouTube no devolvió metadatos válidos.')
 return {k:d.get(k) for k in ('id','title','channel','uploader','upload_date','duration','view_count','like_count','comment_count','webpage_url','description') if d.get(k) is not None}




def inspect_media(path:Path)->dict:
 """Fast ffprobe preflight: reject corrupt, audio-less or unsupported media before queuing."""
 ffprobe=shutil.which('ffprobe')
 if not ffprobe:
  return {'ok':False,'error':'ffprobe_missing','message':'No se encuentra FFprobe. Instala FFmpeg completo.'}
 try:
  result=subprocess.run([ffprobe,'-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height','-of','json',str(path)],capture_output=True,text=True,timeout=30)
 except subprocess.TimeoutExpired:
  return {'ok':False,'error':'media_probe_timeout','message':'El análisis inicial del vídeo ha superado 30 segundos.'}
 if result.returncode:
  return {'ok':False,'error':'invalid_video','message':'El archivo no es un vídeo válido o está dañado.'}
 try: data=json.loads(result.stdout)
 except json.JSONDecodeError:
  return {'ok':False,'error':'invalid_video_metadata','message':'No se pudieron leer los metadatos del vídeo.'}
 streams=data.get('streams') or []
 video=next((s for s in streams if s.get('codec_type')=='video'),None)
 audio=next((s for s in streams if s.get('codec_type')=='audio'),None)
 try: duration=float((data.get('format') or {}).get('duration') or 0)
 except (TypeError,ValueError): duration=0
 if not video or not audio:
  return {'ok':False,'error':'video_and_audio_required','message':'El archivo debe contener imagen y sonido para generar clips con transcripción.'}
 if duration<=0 or duration>6*60*60:
  return {'ok':False,'error':'invalid_duration','message':'La duración del vídeo debe ser mayor que cero y no superar 6 horas.'}
 width=int(video.get('width') or 0); height=int(video.get('height') or 0)
 if width<160 or height<120:
  return {'ok':False,'error':'invalid_video_dimensions','message':'La resolución del vídeo es demasiado pequeña o no se puede leer.'}
 return {'ok':True,'duration':round(duration,3),'width':width,'height':height,'video_codec':video.get('codec_name'),'audio_codec':audio.get('codec_name')}


class LeaseLostError(RuntimeError):
 pass

def run_streaming_command(cmd:list[str], jid:str, stage:str, timeout:int, worker_id:str|None=None)->None:
 """Run a child process, stream logs, and enforce timeout even when it stops writing."""
 started=time.monotonic()
 proc=subprocess.Popen(cmd,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=False,bufsize=0)
 decoder=codecs.getincrementaldecoder("utf-8")("replace")
 lines=[]; pending=""
 selector=selectors.DefaultSelector()
 assert proc.stdout is not None
 selector.register(proc.stdout,selectors.EVENT_READ)
 try:
  while True:
   remaining=timeout-(time.monotonic()-started)
   if remaining<=0: raise subprocess.TimeoutExpired(cmd,timeout)
   events=selector.select(timeout=min(1.0,remaining))
   if events:
    chunk=os.read(proc.stdout.fileno(),8192)
    if chunk:
     pending+=decoder.decode(chunk)
     while "\n" in pending:
      line,pending=pending.split("\n",1); line=line.rstrip("\r")
      if line:
       lines.append(line)
       if len(lines)>120: lines=lines[-120:]
       with LOCK:
        if jid in JOBS:
         JOBS[jid]["log"]=stage+"\n"+"\n".join(lines[-45:])
         if len(lines)%8==0:
          if worker_id:
           if not job_store_for_registry().update_claim(JOBS[jid],worker_id):
            raise LeaseLostError("El worker perdió la concesión del trabajo; se detiene para evitar resultados duplicados.")
          else: persist_jobs_locked()
    elif proc.poll() is not None: break
   elif proc.poll() is not None: break
  tail=decoder.decode(b"",final=True)+pending
  if tail.strip(): lines.append(tail.strip())
  code=proc.wait(timeout=5)
 except Exception:
  if proc.poll() is None: proc.kill()
  proc.wait()
  raise
 finally:
  selector.close(); proc.stdout.close()
 if code: raise RuntimeError(stage+"\n"+"\n".join(lines[-35:])[-5000:])


def persist_job_locked(jid:str, worker_id:str|None=None)->None:
 """Persist a single worker-owned job without allowing stale workers to overwrite it."""
 if worker_id:
  if not job_store_for_registry().update_claim(JOBS[jid],worker_id):
   raise LeaseLostError("El worker ya no posee la concesión de este trabajo.")
 else:
  persist_jobs_locked()

class Handler(BaseHTTPRequestHandler):
 def log_message(self, fmt, *args): print('[web]',fmt%args)
 def send(self, code, body, ctype='application/json; charset=utf-8'):
  data=body if isinstance(body,bytes) else body.encode()
  self.send_response(code); self.send_header('Content-Type',ctype); self.send_header('Content-Length',str(len(data))); self.send_header('X-Content-Type-Options','nosniff'); self.end_headers(); self.wfile.write(data)
 def json(self, code, obj): self.send(code,json.dumps(obj,ensure_ascii=False), 'application/json; charset=utf-8')
 def do_HEAD(self):
  path=urlparse(self.path).path
  if path in {'/','/index.html'}:
   code=200; ctype='text/html; charset=utf-8'
  elif path=='/api/health':
   code=200; ctype='application/json; charset=utf-8'
  else:
   code=404; ctype='application/json; charset=utf-8'
  self.send_response(code); self.send_header('Content-Type',ctype); self.send_header('Content-Length','0'); self.send_header('X-Content-Type-Options','nosniff'); self.end_headers()
 def do_GET(self):
  path=urlparse(self.path).path
  if path=='/api/health':
   mlx_available=importlib.util.find_spec('mlx_whisper') is not None
   faster_available=importlib.util.find_spec('faster_whisper') is not None
   cpp_available=bool(shutil.which('whisper-cli') or shutil.which('whisper-cpp'))
   apple_native=sys.platform=='darwin' and bool(shutil.which('xcrun') or shutil.which('swiftc')) and (ROOT/'transcribe_macos.swift').is_file()
   if sys.platform=='darwin' and platform.machine().lower() in {'arm64','aarch64'} and mlx_available:
    engine='mlx-whisper'
   elif cpp_available:
    engine='whisper.cpp'
   elif faster_available:
    engine='faster-whisper'
   elif apple_native:
    engine='apple-speech-fallback'
   elif importlib.util.find_spec('whisper') is not None:
    engine='whisper-legacy'
   else:
    engine='not-installed'
   return self.json(200,{'ok':True,'app':'ClipForge Web','version':'1.72.0','mode':'local-first',
    'ffmpeg':bool(shutil.which('ffmpeg')),'ffprobe':bool(shutil.which('ffprobe')),
    'mlx_whisper':mlx_available,'faster_whisper':faster_available,
    'whisper':importlib.util.find_spec('whisper') is not None,'native_speech':apple_native,
    'whisper_cpp':cpp_available,'transcription_engine':engine,
    'native_speech_status':'helper_detected_not_runtime_tested' if apple_native else 'unavailable_in_this_environment',
    'opencv':importlib.util.find_spec('cv2') is not None,'ollama_binary':bool(shutil.which('ollama')),'yt_dlp':yt_dlp_command() is not None})
  if path=='/api/projects': return self.json(200,{'projects':list_projects(PROJECTS)})
  if path.startswith('/api/projects/'):
   project_id=path.rsplit('/',1)[-1]
   try: return self.json(200,load_project(PROJECTS,project_id))
   except ProjectError as exc: return self.json(404,{'error':'project_not_found_or_invalid','message':str(exc)})
  if path=='/api/channels': return self.json(200,{'channels':channel_monitor.list_channels(),'refresh_interval_hours':24,'mode':'public_rss_discovery_only'})
  if path=='/api/inbox':
   items=[]
   for f in sorted(INBOX.iterdir()):
    if f.is_file() and f.suffix.lower() in ALLOWED:
     sidecar=Path(str(f)+'.clipforge.json')
     items.append({'filename':f.name,'size_bytes':f.stat().st_size,'manifest_present':sidecar.is_file(),'status':'ready_to_import' if sidecar.is_file() else 'waiting_for_permission_manifest'})
   return self.json(200,{'folder':str(INBOX),'items':items,'manifest_suffix':'.clipforge.json'})
  if path=='/api/jobs':
   sync_jobs_from_store()
   with LOCK:
    history=[]
    for job in sorted(JOBS.values(),key=lambda x:float(x.get('created') or 0),reverse=True)[:100]:
     item={k:job.get(k) for k in ('id','status','source','created','log')}
     folder=Path(job.get('output') or '')
     if job.get('status')=='completed' and folder.is_dir(): item['download_url']=f"/api/download/{job.get('id')}"
     history.append(item)
   return self.json(200,{'jobs':history,'limit':100})
  if path=='/api/platforms':
   return self.json(200,{'platforms':[
    {'id':'youtube','name':'YouTube Shorts','mode':'oauth_api','status':'not_configured','free':'API quota included; Google project/OAuth required'},
    {'id':'instagram','name':'Instagram Reels','mode':'oauth_api','status':'not_configured','free':'Professional account, Meta app and public media URL required'},
    {'id':'facebook','name':'Facebook Reels','mode':'oauth_api','status':'not_configured','free':'Page permissions and Meta app required'},
    {'id':'tiktok','name':'TikTok','mode':'oauth_api','status':'not_configured','free':'Content Posting API approval/audit required for public posting'},
    {'id':'x','name':'X','mode':'oauth_api','status':'not_configured','free':'Write/media API access may require paid plan'}]})
  if path.startswith('/api/review/'):
   jid=path.rsplit('/',1)[-1]
   with LOCK: job=JOBS.get(jid)
   folder=Path(job.get('output') or '') if job else Path('/nonexistent')
   review=folder/'review.html'
   if not job or job.get('status')!='completed' or not review.is_file(): return self.json(404,{'error':'review_not_ready'})
   return self.send(200,review.read_bytes(),'text/html; charset=utf-8')
  if path.startswith('/api/jobs/') and path.endswith('/source'):
   parts=path.strip('/').split('/')
   if len(parts)!=4 or not re.fullmatch(r'[a-f0-9]{12}',parts[2]): return self.json(404,{'error':'source_not_found'})
   jid=parts[2]
   with LOCK: job=JOBS.get(jid)
   folder=Path(job.get('output') or '') if job else Path('/nonexistent')
   target=(folder/'.clipforge_source.mp4').resolve()
   if not job or job.get('status')!='completed' or target.parent!=folder.resolve() or not target.is_file(): return self.json(404,{'error':'source_not_found'})
   size=target.stat().st_size; header=self.headers.get('Range','').strip()
   if header:
    match=re.fullmatch(r'bytes=(\\d*)-(\\d*)',header)
    if not match: self.send_response(416); self.send_header('Content-Range',f'bytes */{size}'); self.send_header('Content-Length','0'); self.end_headers(); return
    first=int(match.group(1) or 0); last=int(match.group(2) or size-1)
    if first>=size or last<first: self.send_response(416); self.send_header('Content-Range',f'bytes */{size}'); self.send_header('Content-Length','0'); self.end_headers(); return
    last=min(last,size-1); length=last-first+1
    with target.open('rb') as stream: stream.seek(first); data=stream.read(length)
    self.send_response(206); self.send_header('Content-Type','video/mp4'); self.send_header('Accept-Ranges','bytes'); self.send_header('Content-Range',f'bytes {first}-{last}/{size}'); self.send_header('Content-Length',str(len(data))); self.send_header('Cache-Control','private, max-age=60'); self.end_headers(); self.wfile.write(data); return
   data=target.read_bytes()
   self.send_response(200); self.send_header('Content-Type','video/mp4'); self.send_header('Accept-Ranges','bytes'); self.send_header('Content-Length',str(len(data))); self.send_header('Cache-Control','private, max-age=60'); self.end_headers(); self.wfile.write(data); return
  if path.startswith('/api/preview/'):
   parts=path.split('/')
   if len(parts)!=5: return self.json(404,{'error':'not_found'})
   jid,filename=parts[3],parts[4]
   with LOCK: job=JOBS.get(jid)
   folder=Path(job.get('output') or '') if job else Path('/nonexistent')
   target=(folder/filename).resolve()
   if not job or job.get('status')!='completed' or target.parent!=folder.resolve() or not target.is_file() or target.suffix.lower() not in {'.mp4','.srt'}:
    return self.json(404,{'error':'preview_not_found'})
   ctype='video/mp4' if target.suffix.lower()=='.mp4' else 'application/x-subrip; charset=utf-8'
   return self.send(200,target.read_bytes(),ctype)
  if path.startswith('/api/editor/export/'):
   export_id=path.rsplit('/',1)[-1]
   if not re.fullmatch(r'[a-f0-9]{16}',export_id): return self.json(404,{'error':'export_not_found'})
   target=OUTPUTS/'editor_exports'/f'{export_id}.mp4'
   if not target.is_file(): return self.json(404,{'error':'export_not_found'})
   data=target.read_bytes()
   self.send_response(200); self.send_header('Content-Type','video/mp4'); self.send_header('Content-Disposition',f'attachment; filename=clipforge_{export_id}.mp4'); self.send_header('Content-Length',str(len(data))); self.send_header('X-Content-Type-Options','nosniff'); self.end_headers(); self.wfile.write(data); return
  if path.startswith('/api/download/'):
   jid=path.rsplit('/',1)[-1]
   with LOCK: job=JOBS.get(jid)
   folder=Path(job.get('output') or '') if job else Path('/nonexistent')
   if not job or job.get('status')!='completed' or not folder.is_dir(): return self.json(404,{'error':'output_not_ready'})
   buf=io.BytesIO()
   with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
    for f in folder.rglob('*'):
     if f.is_file() and not f.name.startswith('.clipforge_'): z.write(f,f.relative_to(folder))
   self.send_response(200); self.send_header('Content-Type','application/zip'); self.send_header('Content-Disposition',f'attachment; filename=clips_{jid}.zip'); self.send_header('Content-Length',str(len(buf.getvalue()))); self.end_headers(); self.wfile.write(buf.getvalue()); return
  if path.startswith('/api/jobs/'):
   jid=path.rsplit('/',1)[-1]
   sync_jobs_from_store()
   with LOCK: job=JOBS.get(jid)
   if not job: return self.json(404,{'error':'job_not_found'})
   public={k:v for k,v in job.items() if k not in {'output','args','transcript_path','video_url'}}
   if job.get('status')=='completed':
    folder=Path(job.get('output') or '')
    selection={}
    try: selection={x.get('file'):x for x in json.loads((folder/'manifest.json').read_text(encoding='utf-8')).get('clips',[])}
    except Exception: pass
    public['clips']=[{'file':f.name,'preview_url':f'/api/preview/{jid}/{f.name}',**selection.get(f.name,{})} for f in sorted(folder.glob('clip_*.mp4'))]
    try: public['story_profile']=json.loads((folder/'story_profile.json').read_text(encoding='utf-8'))
    except Exception: public['story_profile']=None
    public['download_url']=f'/api/download/{jid}'
   return self.json(200,public)
  if path=='/' or path=='/index.html': return self.send(200,(STATIC/'index.html').read_bytes(),'text/html; charset=utf-8')
  name=path.lstrip('/')
  if name in {'app.js','browser-whisper.js','editor.js','styles.css','manifest.webmanifest','sw.js'}:
   types={'app.js':'text/javascript','browser-whisper.js':'text/javascript','editor.js':'text/javascript','styles.css':'text/css','manifest.webmanifest':'application/manifest+json','sw.js':'text/javascript'}
   return self.send(200,(STATIC/name).read_bytes(),types[name])
  return self.json(404,{'error':'not_found'})
 def do_DELETE(self):
  path=urlparse(self.path).path
  if path.startswith('/api/projects/'):
   project_id=path.rsplit('/',1)[-1]
   try:
    load_project(PROJECTS,project_id)
    (PROJECTS/f'{project_id}.json').unlink()
    return self.json(200,{'ok':True})
   except ProjectError as exc:return self.json(404,{'error':'project_not_found','message':str(exc)})
  if path.startswith('/api/channels/'):
   cid=path.rsplit('/',1)[-1]
   if not re.fullmatch(r'UC[a-zA-Z0-9_-]{22}',cid):return self.json(400,{'error':'invalid_channel_id'})
   return self.json(200,{'ok':channel_monitor.remove_channel(cid)})
  return self.json(404,{'error':'not_found'})
 def do_POST(self):
  path=urlparse(self.path).path
  if path=='/api/projects':
   length=int(self.headers.get('Content-Length','0'))
   if length<=0 or length>20*1024*1024: return self.json(413,{'error':'invalid_project_size','max_bytes':20*1024*1024})
   try:
    data=json.loads(self.rfile.read(length))
    project_id=str(data.pop('id', '') or uuid.uuid4().hex[:16])
    result=save_project(PROJECTS,project_id,data)
    return self.json(200,{'ok':True,**result})
   except (json.JSONDecodeError,ProjectError,TypeError,ValueError) as exc:
    return self.json(400,{'error':'invalid_project','message':str(exc)[:300]})
  if path.startswith('/api/channels/') and path.endswith('/seen'):
   parts=path.strip('/').split('/')
   if len(parts)!=5 or parts[1]!='channels' or parts[4]!='seen':return self.json(404,{'error':'not_found'})
   cid,video_id=parts[2],parts[3]
   try:ok=channel_monitor.mark_video_seen(cid,video_id)
   except ValueError:return self.json(400,{'error':'invalid_channel_or_video_id'})
   return self.json(200,{'ok':ok})
  if path=='/api/inbox/scan':
   result=scan_inbox_once()
   return self.json(200,result)
  if path=='/api/channels/refresh':
   try:return self.json(200,channel_monitor.refresh_channels())
   except Exception as exc:return self.json(502,{'error':'channel_refresh_failed','message':str(exc)[:300]})
  if path=='/api/channels':
   length=int(self.headers.get('Content-Length','0'))
   if length<=0 or length>8192:return self.json(413,{'error':'invalid_request_size'})
   try:data=json.loads(self.rfile.read(length)); item=channel_monitor.add_channel(data.get('url',''),data.get('label',''))
   except (ValueError,TypeError,json.JSONDecodeError) as exc:return self.json(400,{'error':'invalid_channel','message':str(exc)[:300]})
   return self.json(201,{'channel':item})
  if path.startswith('/api/jobs/') and path.endswith('/retry'):
   parts=path.strip('/').split('/')
   if len(parts)!=4:return self.json(404,{'error':'not_found'})
   jid=parts[2]
   with LOCK:
    job=JOBS.get(jid)
    if not job:return self.json(404,{'error':'job_not_found'})
    if job.get('status')!='failed':return self.json(409,{'error':'job_not_retryable','status':job.get('status')})
    args=job.get('args'); transcript_path=job.get('transcript_path'); video_url=job.get('video_url') or ''
    source=Path(args[3]) if isinstance(args,list) and len(args)>3 else None
    if not video_url and (not source or not source.is_file()):return self.json(410,{'error':'source_not_available','message':'El archivo original ya no está disponible; vuelve a importarlo.'})
    if transcript_path and not Path(transcript_path).is_file():transcript_path=None
    if isinstance(args,list) and '--transcript' in args:
     ti=args.index('--transcript')
     if ti+1>=len(args) or not Path(args[ti+1]).is_file():
      del args[ti:ti+2]
      job['args']=args
    job['status']='queued'; job['log']='Reintento solicitado; esperando turno de procesamiento.'
    persist_jobs_locked()
   return self.json(202,{'ok':True,'id':jid,'status':'queued'})
  if path.startswith('/api/re-render/'):
   parts=path.strip('/').split('/')
   if len(parts)!=4:return self.json(404,{'error':'not_found'})
   jid,clipname=parts[2],parts[3]
   if not re.fullmatch(r'clip_\d{2}\.mp4',clipname):return self.json(400,{'error':'invalid_clip_name'})
   with LOCK: job=JOBS.get(jid)
   folder=Path(job.get('output') or '') if job else Path('/nonexistent')
   source=folder/'.clipforge_source.mp4'
   if not job or job.get('status')!='completed' or not source.is_file():return self.json(404,{'error':'source_not_available'})
   length=int(self.headers.get('Content-Length','0'))
   if length<=0 or length>5*1024*1024:return self.json(413,{'error':'invalid_transcript_size'})
   raw=self.rfile.read(length); ctype=self.headers.get('Content-Type','')
   msg=BytesParser(policy=default).parsebytes((f'Content-Type: {ctype}\r\nMIME-Version: 1.0\r\n\r\n'.encode()+raw))
   part=next((x for x in msg.iter_parts() if x.get_param('name',header='content-disposition')=='transcript'),None)
   if not part:return self.json(400,{'error':'transcript_required'})
   transcript=part.get_payload(decode=True) or b''
   if not transcript:return self.json(400,{'error':'empty_transcript'})
   try:
    import clipforge as cf
    clip_index=int(clipname[5:7])-1
    manifest=json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
    clips=manifest.get('clips',[])
    if clip_index<0 or clip_index>=len(clips) or clips[clip_index].get('file')!=clipname:return self.json(404,{'error':'clip_not_found'})
    item=clips[clip_index]; settings=manifest.get('render_settings',{})
    tmp=folder/'.edited_caption.srt'; tmp.write_bytes(transcript)
    segs=cf.read_timed_transcript(tmp); tmp.unlink(missing_ok=True)
    if not segs:return self.json(400,{'error':'invalid_srt'})
    start=float(item['start']); end=float(item['end'])
    absolute=[]
    for seg in segs:
     a=float(seg['start']); b=float(seg['end'])
     if a<0 or b<=a or b>end-start+1:return self.json(400,{'error':'caption_time_outside_clip'})
     absolute.append({**seg,'start':a+start,'end':b+start})
    args=type('RenderArgs',(),settings)()
    args.resolution=settings.get('resolution','1080x1920')
    args.crop=settings.get('crop','center'); args.fps=settings.get('fps',30)
    args.crf=settings.get('crf',20); args.audio_bitrate=settings.get('audio_bitrate','192k')
    args.preset=settings.get('preset','veryfast'); args.normalize_audio=settings.get('normalize_audio',True)
    args.burn_captions=True
    cf.render_clip(source,{'start':start,'end':end},clip_index+1,absolute,folder,args)
    audit=cf.audit_mp4(folder/clipname,*map(int,args.resolution.split('x')),min_duration=1)
    if not audit.get('ok'):return self.json(500,{'error':'render_audit_failed','audit':audit})
    return self.json(200,{'ok':True,'clip':clipname,'audit':audit})
   except Exception as exc:
    return self.json(500,{'error':'rerender_failed','message':str(exc)[-1800:]})
  if path=='/api/editor/export':
   ctype=self.headers.get('Content-Type','')
   if not ctype.lower().startswith('multipart/form-data;'): return self.json(400,{'error':'multipart_form_required'})
   length=int(self.headers.get('Content-Length','0'))
   if length<=0 or length>512*1024*1024: return self.json(413,{'error':'invalid_or_too_large_export','max_bytes':512*1024*1024})
   raw=self.rfile.read(length)
   msg=BytesParser(policy=default).parsebytes((f'Content-Type: {ctype}\r\nMIME-Version: 1.0\r\n\r\n'.encode()+raw))
   part=next((x for x in msg.iter_parts() if x.get_param('name',header='content-disposition')=='video'),None)
   if not part: return self.json(400,{'error':'video_required'})
   payload=part.get_payload(decode=True) or b''
   if not payload: return self.json(400,{'error':'empty_video'})
   export_id=uuid.uuid4().hex[:16]; folder=OUTPUTS/'editor_exports'; folder.mkdir(parents=True,exist_ok=True)
   source=folder/f'{export_id}.webm'; target=folder/f'{export_id}.mp4'
   try:
    source.write_bytes(payload)
    result=subprocess.run([shutil.which('ffmpeg') or 'ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(source),'-map','0:v:0','-map','0:a:0?','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(target)],capture_output=True,text=True,timeout=3600)
    if result.returncode or not target.is_file() or target.stat().st_size<1024:
     target.unlink(missing_ok=True)
     raise RuntimeError((result.stderr or 'FFmpeg no pudo convertir la exportación.')[-1200:])
    source.unlink(missing_ok=True)
    return self.json(201,{'ok':True,'id':export_id,'download_url':f'/api/editor/export/{export_id}'})
   except subprocess.TimeoutExpired:
    source.unlink(missing_ok=True); target.unlink(missing_ok=True)
    return self.json(504,{'error':'export_timeout','message':'La conversión ha superado el límite de una hora.'})
   except Exception as exc:
    source.unlink(missing_ok=True); target.unlink(missing_ok=True)
    return self.json(500,{'error':'export_failed','message':str(exc)[-1200:]})
  if path!='/api/jobs': return self.json(404,{'error':'not_found'})
  ctype=self.headers.get('Content-Type','')
  if not ctype.lower().startswith('multipart/form-data;'): return self.json(400,{'error':'multipart_form_required'})
  length=int(self.headers.get('Content-Length','0'))
  if length<=0 or length>512*1024*1024: return self.json(413,{'error':'invalid_or_too_large_upload','max_bytes':512*1024*1024})
  raw=self.rfile.read(length)
  msg=BytesParser(policy=default).parsebytes((f'Content-Type: {ctype}\r\nMIME-Version: 1.0\r\n\r\n'.encode()+raw))
  fields={}; filepart=None; transcriptpart=None
  for part in msg.iter_parts():
   name=part.get_param('name',header='content-disposition')
   if name=='video': filepart=part
   elif name=='transcript':
    # Browsers may include an empty multipart part for an unselected optional file input.
    # Treat that as no subtitle upload; only accept a real, non-empty SRT/VTT file.
    if part.get_filename() and (part.get_payload(decode=True) or b''):
     transcriptpart=part
   elif name: fields[name]=part.get_content().strip()
  video_url=fields.get('video_url','').strip()
  if not filepart and not video_url:return self.json(400,{'error':'video_or_url_required'})
  if video_url and not valid_video_url(video_url):return self.json(400,{'error':'invalid_youtube_url','message':'Introduce una URL válida de YouTube.'})
  if video_url and yt_dlp_command() is None:return self.json(503,{'error':'yt_dlp_missing','message':'Falta yt-dlp. Cierra ClipForge y vuelve a abrir Iniciar_ClipForge.command para instalarlo automáticamente.'})
  filename=Path(filepart.get_filename() or 'source.mp4').name if filepart else 'youtube_source.mp4'
  if filepart and Path(filename).suffix.lower() not in ALLOWED:return self.json(400,{'error':'unsupported_video_format','allowed':sorted(ALLOWED)})
  if fields.get('rights_confirmed')!='yes':return self.json(403,{'error':'rights_confirmation_required'})
  jid=uuid.uuid4().hex[:12]; src=UPLOADS/f'{jid}_{filename}'
  if filepart:
   src.write_bytes(filepart.get_payload(decode=True) or b'')
   if not src.stat().st_size:src.unlink(missing_ok=True);return self.json(400,{'error':'empty_upload'})
   media=inspect_media(src)
   if not media.get('ok'):
    src.unlink(missing_ok=True)
    return self.json(422,media)
  else:media={'ok':True,'source':'youtube_url'}
  transcript_path=None
  if transcriptpart:
   tname=Path(transcriptpart.get_filename() or 'transcript.srt').name
   if Path(tname).suffix.lower() not in {'.srt','.vtt'}:
    src.unlink(missing_ok=True); return self.json(400,{'error':'unsupported_transcript_format','allowed':['.srt','.vtt']})
   tdata=transcriptpart.get_payload(decode=True) or b''
   if len(tdata)>20*1024*1024:
    src.unlink(missing_ok=True); return self.json(413,{'error':'transcript_too_large','max_bytes':20*1024*1024})
   transcript_path=UPLOADS/f'{jid}_{tname}'; transcript_path.write_bytes(tdata)
   if not tdata:
    src.unlink(missing_ok=True); transcript_path.unlink(missing_ok=True); return self.json(400,{'error':'empty_transcript'})
  language=fields.get('language','es'); model=fields.get('model','small')
  try:
   clips=int(fields.get('clips','5')); min_seconds=float(fields.get('min_seconds','25')); max_seconds=float(fields.get('max_seconds','45'))
  except ValueError: src.unlink(missing_ok=True); return self.json(400,{'error':'invalid_production_settings'})
  if language not in {'es','en'} or model not in {'tiny','base','small','medium'} or not 1<=clips<=10 or not 10<=min_seconds<=max_seconds<=180:
   src.unlink(missing_ok=True); return self.json(400,{'error':'production_settings_out_of_range'})
  resolution=fields.get('resolution','1080x1920'); crop=fields.get('crop','face')
  fps=fields.get('fps','30'); quality=fields.get('quality','high')
  crf={'high':'18','balanced':'20','compact':'23'}.get(quality)
  if resolution not in {'720x1280','1080x1920'} or crop not in {'face','center','blur'} or fps not in {'25','30','50','60'} or crf is None:
   src.unlink(missing_ok=True)
   if transcript_path: transcript_path.unlink(missing_ok=True)
   return self.json(400,{'error':'invalid_video_style'})
  args=[sys.executable,'-u',str(ROOT/'clipforge.py'),str(src),'--rights-confirmed','--language',language,'--model',model,'--clips',str(clips),'--min-seconds',str(min_seconds),'--max-seconds',str(max_seconds),'--output',str(OUTPUTS/jid),'--resolution',resolution,'--crop',crop,'--fps',fps,'--crf',crf,'--audio-bitrate','192k']
  if transcript_path: args.extend(['--transcript',str(transcript_path)])
  ranges_path=None
  if fields.get('selected_clip_ranges'):
   try:
    ranges=json.loads(fields['selected_clip_ranges'])
    if not isinstance(ranges,list) or not 1<=len(ranges)<=10: raise ValueError('Debe haber entre 1 y 10 cortes.')
    for item in ranges:
     a=float(item['start']); b=float(item['end'])
     if not math.isfinite(a) or not math.isfinite(b) or a<0 or b<=a or b-a>180: raise ValueError('Tiempo de corte inválido.')
    ranges_path=UPLOADS/f'{jid}_ranges.json'
    ranges_path.write_text(json.dumps(ranges,ensure_ascii=False),encoding='utf-8')
    args.extend(['--ranges-json',str(ranges_path)])
   except Exception as exc:
    src.unlink(missing_ok=True)
    if transcript_path: transcript_path.unlink(missing_ok=True)
    return self.json(400,{'error':'invalid_selected_clip_ranges','detail':str(exc)})
  if fields.get('burn_captions')=='yes': args.append('--burn-captions')
  if fields.get('diarize')=='yes': args.append('--diarize')
  with LOCK:
   JOBS[jid]={'id':jid,'status':'queued','source':filename,'created':time.time(),'log':'','output':None,'args':list(args),'transcript_path':str(transcript_path) if transcript_path else None,'ranges_path':str(ranges_path) if ranges_path else None,'video_url':video_url}
   persist_jobs_locked()
  return self.json(202,{'id':jid,'status':'queued','status_url':f'/api/jobs/{jid}'})
 def run_job(self,jid,args,transcript_path=None,video_url='',worker_id=None):
  # Whisper/FFmpeg are memory intensive; serialize jobs to avoid exhausting a laptop.
  with ENGINE:
   lease_lost=False
   with LOCK:
    JOBS[jid]['status']='processing'
    persist_job_locked(jid,worker_id)
   try:
    source_meta={}
    if video_url:
     with LOCK:JOBS[jid]['log']='Consultando título, canal y estadísticas públicas de YouTube…'
     source_meta=fetch_youtube_metadata(video_url)
     views=source_meta.get('view_count'); likes=source_meta.get('like_count'); comments=source_meta.get('comment_count')
     try:
      from datetime import datetime,timezone
      uploaded=datetime.strptime(str(source_meta.get('upload_date','')),'%Y%m%d').replace(tzinfo=timezone.utc)
      age_days=max(1,(datetime.now(timezone.utc)-uploaded).days)
     except Exception:age_days=None
     source_meta['public_audience_signals']={
      'views_per_day_estimate':round(views/age_days,1) if isinstance(views,(int,float)) and age_days else None,
      'like_to_view_ratio':round(likes/views,5) if isinstance(likes,(int,float)) and isinstance(views,(int,float)) and views>0 else None,
      'comment_to_view_ratio':round(comments/views,5) if isinstance(comments,(int,float)) and isinstance(views,(int,float)) and views>0 else None,
      'age_days':age_days,
      'interpretation':'Señales de popularidad del vídeo completo; no miden la viralidad de cada fragmento.'
     }
     with LOCK:JOBS[jid]['youtube_metadata']=source_meta
     language=args[args.index('--language')+1] if '--language' in args else 'es'
     sub_langs='es,en' if language=='es' else 'en,es'
     dl=yt_dlp_command()+['--no-warnings','--no-playlist','--newline','--progress',
       '--write-subs','--write-auto-subs','--sub-langs',sub_langs,'--sub-format','srt/vtt/best',
       '-f','bv*+ba/b','--merge-output-format','mp4','-o',str(UPLOADS/f'{jid}_%(title).80s.%(ext)s'),video_url]
     run_streaming_command(dl,jid,'Descargando vídeo y subtítulos disponibles de YouTube…',3*60*60,worker_id)
     subtitle_matches=sorted(x for x in UPLOADS.glob(f'{jid}_*') if x.suffix.lower() in {'.srt','.vtt'} and x.is_file())
     if subtitle_matches and '--transcript' not in args:
      args.extend(['--transcript',str(subtitle_matches[0])])
      with LOCK: JOBS[jid]['log']='Se han encontrado subtítulos de YouTube; se usarán para seleccionar y subtitular clips.'
     matches=sorted(UPLOADS.glob(f'{jid}_*'))
     matches=[x for x in matches if x.suffix.lower() in ALLOWED and x.is_file()]
     if not matches:raise RuntimeError('yt-dlp terminó sin producir un vídeo compatible.')
     downloaded=matches[0]
     args[3]=str(downloaded)
     with LOCK:
      JOBS[jid]['args']=list(args)
      persist_job_locked(jid,worker_id)
    run_streaming_command(args,jid,'Analizando transcripción y renderizando clips…',6*60*60,worker_id)
    # Keep a private source copy beside the project so subtitle edits can be re-rendered
    # without asking the user to upload/transcribe the full source again.
    rendered_folder=OUTPUTS/jid/Path(args[3]).stem
    rendered_folder.mkdir(parents=True,exist_ok=True)
    shutil.copy2(args[3],rendered_folder/'.clipforge_source.mp4')
    success=True
    log='Producción completada. Revisa los clips y el informe de calidad.'
    if source_meta:
     meta_path=OUTPUTS/jid/Path(args[3]).stem/'youtube_source_stats.json'
     if meta_path.parent.exists():
      meta_path.write_text(json.dumps(source_meta,ensure_ascii=False,indent=2),encoding='utf-8')
      log='Metadatos públicos de YouTube guardados en youtube_source_stats.json.\\n'+log
   except LeaseLostError as exc:
    success=False; lease_lost=True; log=str(exc)
   except Exception as exc:
    success=False; log=f'No se pudo iniciar o completar el motor de producción: {exc}'
   finally:
    if success:
     if not lease_lost:
      try: Path(args[3]).unlink(missing_ok=True)
      except Exception: pass
      for subtitle in UPLOADS.glob(f'{jid}_*'):
       if subtitle.suffix.lower() in {'.srt','.vtt'}:
        try: subtitle.unlink(missing_ok=True)
        except Exception: pass
      if transcript_path:
       try: Path(transcript_path).unlink(missing_ok=True)
       except Exception: pass
   with LOCK:
    JOBS[jid]['status']='completed' if success else 'failed'
    JOBS[jid]['log']=log
    actual_output=OUTPUTS/jid/Path(args[3]).stem
    JOBS[jid]['output']=str(actual_output) if success and actual_output.is_dir() else None
    if success and JOBS[jid]['output'] is None:
     JOBS[jid]['status']='failed'
     JOBS[jid]['log'] += "\\nERROR: el motor terminó sin crear la carpeta de salida esperada."
    if JOBS[jid]['status']=='failed' and not lease_lost:
     shutil.rmtree(OUTPUTS/jid,ignore_errors=True)
    if worker_id:
     if not lease_lost:
      job_store_for_registry().finish_claim(JOBS[jid],worker_id)
    else:
     persist_jobs_locked()

def resume_pending_jobs()->int:
 """Count queued jobs; the independent worker process owns execution."""
 sync_jobs_from_store()
 return sum(1 for job in JOBS.values() if isinstance(job,dict) and job.get('status')=='queued')

def _inbox_manifest(video_path:Path, manifest_path:Path)->dict:
 """Validate an owner-supplied sidecar before a watched-folder import."""
 if video_path.parent.resolve()!=INBOX.resolve() or manifest_path.parent.resolve()!=INBOX.resolve():
  raise ValueError('inbox_path_invalid')
 if video_path.is_symlink() or manifest_path.is_symlink() or video_path.suffix.lower() not in ALLOWED or not video_path.is_file() or not manifest_path.is_file():
  raise ValueError('unsupported_or_missing_video_or_manifest')
 if manifest_path.stat().st_size>64*1024: raise ValueError('manifest_too_large')
 if video_path.stat().st_size<=0 or video_path.stat().st_size>20*1024*1024*1024:
  raise ValueError('video_size_out_of_range')
 data=json.loads(manifest_path.read_text(encoding='utf-8'))
 if not isinstance(data,dict): raise ValueError('manifest_must_be_object')
 rights_holder=str(data.get('rights_holder','')).strip(); permission_reference=str(data.get('permission_reference','')).strip()
 placeholders=('nombre del propietario','referencia del consentimiento','consentimiento de prueba','example','placeholder','todo')
 if data.get('rights_confirmed') is not True or len(rights_holder)<3 or len(permission_reference)<5 or any(p in (rights_holder+' '+permission_reference).lower() for p in placeholders):
  raise ValueError('explicit_rights_confirmation_required')
 language=data.get('language','es'); clips=int(data.get('clips',5)); min_seconds=float(data.get('min_seconds',20)); max_seconds=float(data.get('max_seconds',45))
 if language not in {'es','en'} or data.get('model','small') not in {'tiny','base','small','medium'} or not 1<=clips<=10 or not 10<=min_seconds<=max_seconds<=180:
  raise ValueError('invalid_production_settings')
 resolution=data.get('resolution','1080x1920'); crop=data.get('crop','face'); fps=str(data.get('fps',30)); quality=data.get('quality','high')
 crf={'high':'18','balanced':'20','compact':'23'}.get(quality)
 if resolution not in {'720x1280','1080x1920'} or crop not in {'face','center','blur'} or fps not in {'25','30','50','60'} or crf is None:
  raise ValueError('invalid_video_style')
 return {**data,'language':language,'clips':clips,'min_seconds':min_seconds,'max_seconds':max_seconds,'resolution':resolution,'crop':crop,'fps':fps,'crf':crf}

def enqueue_inbox_file(video_path:Path, manifest_path:Path)->str:
 """Queue one authorized video delivered to incoming/; idempotent by source file."""
 with INBOX_LOCK:
  settings=_inbox_manifest(video_path,manifest_path)
  media=inspect_media(video_path)
  if not media.get('ok'): raise ValueError(media.get('message') or media.get('error') or 'invalid_media')
  permission_key=str(settings.get('permission_reference','')).strip()[:300]
  stat=video_path.stat(); fingerprint=f'{stat.st_size}:{stat.st_mtime_ns}'
  with LOCK:
   existing_id=next((str(job['id']) for job in JOBS.values() if job.get('inbox_source')==video_path.name and job.get('inbox_fingerprint')==fingerprint),None)
  if existing_id:
   archive=INBOX_PROCESSED/f'{existing_id}_{re.sub(r"[^A-Za-z0-9._-]+","_",video_path.name)[:160]}'
   if video_path.exists() and manifest_path.exists():
    shutil.copy2(manifest_path,Path(str(archive)+'.clipforge.json'))
    shutil.copy2(video_path,archive)
    video_path.unlink(missing_ok=True); manifest_path.unlink(missing_ok=True)
   return existing_id
  jid=uuid.uuid4().hex[:12]
  safe_name=re.sub(r'[^A-Za-z0-9._-]+','_',video_path.name)[:160]
  source=UPLOADS/f'{jid}_{safe_name}'
  shutil.copy2(video_path,source)
  args=[sys.executable,'-u',str(ROOT/'clipforge.py'),str(source),'--rights-confirmed','--language',settings['language'],'--model',str(settings.get('model','small')),'--clips',str(settings['clips']),'--min-seconds',str(settings['min_seconds']),'--max-seconds',str(settings['max_seconds']),'--output',str(OUTPUTS/jid),'--resolution',settings['resolution'],'--crop',settings['crop'],'--fps',settings['fps'],'--crf',settings['crf'],'--audio-bitrate','192k']
  if settings.get('burn_captions',True): args.append('--burn-captions')
  if settings.get('diarize',False): args.append('--diarize')
  job={'id':jid,'status':'queued','source':video_path.name,'created':time.time(),'log':'Vídeo autorizado recibido en la carpeta de entrada; esperando procesamiento.','output':None,'args':args,'transcript_path':None,'video_url':'','inbox_source':video_path.name,'inbox_fingerprint':fingerprint,'permission_reference':permission_key,'rights_holder':str(settings.get('rights_holder'))[:160]}
  with LOCK:
   JOBS[jid]=job; persist_jobs_locked()
  archive=INBOX_PROCESSED/f'{jid}_{safe_name}'
  archive_manifest=Path(str(archive)+'.clipforge.json')
  # Copy both archive artifacts before removing either inbox file; a crash is recoverable.
  shutil.copy2(manifest_path,archive_manifest); shutil.copy2(video_path,archive)
  video_path.unlink(missing_ok=True); manifest_path.unlink(missing_ok=True)
  return jid

def scan_inbox_once()->dict:
 """Import sidecar-complete files; sidecar must be written after the media copy."""
 if not INBOX_SCAN_LOCK.acquire(blocking=False): return {'imported':[],'errors':[],'waiting':0,'status':'already_running'}
 imported=[]; errors=[]
 try:
  files=sorted(INBOX.iterdir())
  for video in files:
    if not video.is_file() or video.suffix.lower() not in ALLOWED: continue
    manifest=Path(str(video)+'.clipforge.json')
    if not manifest.is_file(): continue
    try:
     # Require an unchanged file across two scans to avoid reading an active copy.
     stat=video.stat(); fingerprint=(stat.st_size,stat.st_mtime_ns)
     previous=INBOX_STABILITY.get(video.name)
     INBOX_STABILITY[video.name]=fingerprint
     if previous!=fingerprint: continue
     jid=enqueue_inbox_file(video,manifest); imported.append({'file':video.name,'job_id':jid}); INBOX_STABILITY.pop(video.name,None)
    except Exception as exc:
     errors.append({'file':video.name,'error':str(exc)[:300]})
  return {'imported':imported,'errors':errors,'waiting':sum(1 for f in INBOX.iterdir() if f.is_file() and f.suffix.lower() in ALLOWED)}
 finally:
  INBOX_SCAN_LOCK.release()

def inbox_scheduler_loop()->None:
 while True:
  try: scan_inbox_once()
  except Exception as exc: print('[inbox] scan failed:',str(exc)[:300])
  time.sleep(20)

def start_inbox_scheduler()->bool:
 global INBOX_STARTED
 with INBOX_LOCK:
  if INBOX_STARTED:return False
  INBOX_STARTED=True
  threading.Thread(target=inbox_scheduler_loop,name='clipforge-inbox-watcher',daemon=True).start()
  return True

if __name__=='__main__':
 host=os.getenv('CLIPFORGE_HOST','127.0.0.1'); port=int(os.getenv('PORT','8765'))
 print(f'ClipForge Web listening on http://{host}:{port}')
 channel_monitor.start_scheduler()
 start_inbox_scheduler()
 resumed=resume_pending_jobs()
 if resumed: print(f'{resumed} trabajo(s) pendiente(s) en cola')
 worker=subprocess.Popen([sys.executable,'-u',str(ROOT/'worker.py')],cwd=ROOT)
 worker_state={'process':worker}; supervisor_stop=threading.Event()
 print(f'Worker independiente iniciado (PID {worker.pid})')
 def supervise_worker():
  while not supervisor_stop.wait(3):
   current=worker_state['process']
   if current.poll() is not None:
    print('[worker-supervisor] worker detenido; reiniciando proceso',flush=True)
    worker_state['process']=subprocess.Popen([sys.executable,'-u',str(ROOT/'worker.py')],cwd=ROOT)
 supervisor=threading.Thread(target=supervise_worker,name='clipforge-worker-supervisor',daemon=True)
 supervisor.start()
 try: ThreadingHTTPServer((host,port),Handler).serve_forever()
 finally:
  supervisor_stop.set(); supervisor.join(timeout=4)
  current=worker_state['process']; current.terminate()
  try: current.wait(timeout=10)
  except subprocess.TimeoutExpired: current.kill()
