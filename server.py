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
 recovered_ids=[]
 for job_id,job in jobs.items():

…[1 chars truncated — re-run with head/grep/tail for full output]…
nscript':
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
     job_store_for_registry().upsert(JOBS[jid])

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
