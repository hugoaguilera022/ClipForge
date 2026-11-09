import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class WebStaticTests(unittest.TestCase):
 def test_server_contains_preview_route(self):
  self.assertIn("/api/preview/",(ROOT/"server.py").read_text())
 def test_frontend_has_preview_and_download(self):
  js=(ROOT/"static/app.js").read_text()
  self.assertIn("preview_url",js)
  self.assertIn("download_url",js)
 def test_upload_has_rights_gate(self):
  self.assertIn("rights_confirmation_required",(ROOT/"server.py").read_text())
 def test_server_accepts_timed_transcript_upload(self):
  source=(ROOT/"server.py").read_text()
  self.assertIn("unsupported_transcript_format",source)
  self.assertIn("--transcript",source)
 def test_private_test_rights_wording_does_not_claim_publication_permission(self):
  html=(ROOT/"static/index.html").read_text()
  self.assertIn("prueba privada",html)
  self.assertIn("no autoriza su publicación",html)
 def test_production_quality_controls_are_wired_to_backend(self):
  html=(ROOT/"static/index.html").read_text(); server=(ROOT/"server.py").read_text()
  for value in ("name=\"fps\"", "name=\"quality\""):
   self.assertIn(value,html)
  self.assertIn("'high':'18'",server)
  self.assertIn("'--fps',fps",server)
 def test_reference_style_controls_and_tracking_are_present(self):
  html=(ROOT/"static/index.html").read_text()
  engine=(ROOT/"clipforge.py").read_text()
  self.assertIn('name="crop"',html)
  self.assertIn('name="resolution"',html)
  self.assertIn("face_crop_expression",engine)
  self.assertIn(r"\fscx88",engine)
if __name__=="__main__":unittest.main()


class NativeMacSpeechTests(unittest.TestCase):
 def test_macos_native_speech_fallback_is_wired(self):
  source=(ROOT/"clipforge.py").read_text()
  helper=ROOT/"transcribe_macos.swift"
  self.assertTrue(helper.is_file())
  self.assertIn("transcribe_macos_native",source)
  self.assertIn('"--find","swiftc"',source)
  self.assertIn('"-O",str(helper)',source)
  self.assertIn('str(executable),str(audio),language,str(result)',source)
  self.assertNotIn('["swift",str(helper)',source)
  helper_source=helper.read_text()
  self.assertIn("requiresOnDeviceRecognition = true",helper_source)
  self.assertIn("waitOnMainRunLoop",helper_source)
  self.assertIn("RunLoop.current.run",helper_source)
  self.assertNotIn("DispatchSemaphore",helper_source)

class FaceTrackingContinuityTests(unittest.TestCase):
 def test_tracker_uses_continuity_gap_interpolation_and_motion_limit(self):
  source=(ROOT/"clipforge.py").read_text()
  self.assertIn("continuity=abs(cx-previous_cx)",source)
  self.assertIn("gap<=1.5",source)
  self.assertIn("Limit horizontal camera speed",source)
  self.assertIn("frame_step=max(1,int(round(fps*.30)))",source)
  self.assertIn("cap.set(cv2.CAP_PROP_POS_MSEC,start*1000)",source)


class CriticalServerRegressionTests(unittest.TestCase):
 def test_job_outputs_are_isolated_and_api_uses_real_nested_folder(self):
  source=(ROOT/"server.py").read_text()
  self.assertIn("'--output',str(OUTPUTS/jid)",source)
  self.assertIn("actual_output=OUTPUTS/jid/Path(args[3]).stem",source)
  self.assertIn("str(actual_output) if success and actual_output.is_dir()",source)
  self.assertIn("'version':'1.72.0'",source)
 def test_upload_limit_is_memory_safer(self):
  source=(ROOT/"server.py").read_text()
  self.assertIn("length>512*1024*1024",source)
  self.assertIn("'max_bytes':512*1024*1024",source)
 def test_failed_job_removes_partial_output(self):
  source=(ROOT/"server.py").read_text()
  self.assertIn("shutil.rmtree(OUTPUTS/jid,ignore_errors=True)",source)


class UploadGuardAndHealthTests(unittest.TestCase):
 def test_frontend_rejects_oversized_upload_before_network(self):
  js=(ROOT/"static/app.js").read_text()
  self.assertIn("file.size>512*1024*1024",js)
 def test_health_reports_native_speech_capability(self):
  server=(ROOT/"server.py").read_text()
  self.assertIn("apple_native=sys.platform=='darwin'",server)
  self.assertIn("'native_speech':apple_native",server)
  self.assertIn("'mlx_whisper':mlx_available",server)


class ServiceWorkerCacheRegressionTests(unittest.TestCase):
 def test_service_worker_invalidates_old_cache_and_prefers_network(self):
  source=(ROOT/"static/sw.js").read_text()
  self.assertIn("clipforge-web-v144",source)
  self.assertIn("clipforge-web-v180",source)
  self.assertIn("'/browser-whisper.js'",source)
  self.assertIn("self.addEventListener('activate'",source)
  self.assertIn("key.startsWith('clipforge-web-')&&key!==CACHE",source)
  self.assertIn("fetch(event.request)",source)
  self.assertIn("self.clients.claim()",source)


class MediaPreflightTests(unittest.TestCase):
 def test_server_preflights_media_before_queueing(self):
  source=(ROOT/"server.py").read_text()
  self.assertIn("media=inspect_media(src)",source)
  self.assertIn("return self.json(422,media)",source)
  self.assertIn("video_and_audio_required",source)
  self.assertIn("invalid_video",source)
  self.assertIn("'version':'1.72.0'",source)

class YouTubeUrlWorkflowTests(unittest.TestCase):
 def test_backend_accepts_validated_youtube_url_and_fetches_public_metadata(self):
  source=(ROOT/"server.py").read_text()
  self.assertIn("valid_video_url(video_url)",source)
  self.assertIn("fetch_youtube_metadata(video_url)",source)
  self.assertIn("'view_count','like_count','comment_count'",source)
  self.assertIn("yt-dlp",source)
 def test_frontend_offers_url_first_source(self):
  html=(ROOT/"static/index.html").read_text()
  js=(ROOT/"static/app.js").read_text()
  self.assertIn('id="video_url"',html)
  self.assertIn('name="video_url"',html)
  self.assertIn("const url=$('#video_url').value.trim()",js)


class ReviewEndpointTests(unittest.TestCase):
 def test_review_endpoint_is_available_for_completed_jobs(self):
  source=(ROOT/"server.py").read_text()
  self.assertIn("path.startswith('/api/review/')",source)
  self.assertIn("review_not_ready",source)
  js=(ROOT/"static/app.js").read_text()
  self.assertIn("/api/review/${d.id}",js)


class LiveProgressRegressionTests(unittest.TestCase):
 def test_long_running_commands_stream_logs_to_job_status(self):
  source=(ROOT/"server.py").read_text()
  self.assertIn("def run_streaming_command",source)
  self.assertIn('JOBS[jid]["log"]',source)
  self.assertIn("'--newline','--progress'",source)
  self.assertIn("run_streaming_command(args,jid",source)
 def test_engine_python_is_unbuffered_for_live_progress(self):
  source=(ROOT/"server.py").read_text()
  self.assertIn("args=[sys.executable,'-u',str(ROOT/'clipforge.py')",source)


class CriticalYouTubeWorkflowTests(unittest.TestCase):
 def test_downloaded_video_replaces_input_argument_not_script(self):
  source=(ROOT/"server.py").read_text()
  self.assertIn("args=[sys.executable,'-u',str(ROOT/'clipforge.py'),str(src)",source)
  self.assertIn("args[3]=str(downloaded)",source)
  self.assertIn("Path(args[3]).stem",source)
  self.assertNotIn("args[2]=str(downloaded)",source)
 def test_youtube_downloads_manual_and_automatic_captions(self):
  source=(ROOT/"server.py").read_text()
  self.assertIn("'--write-subs','--write-auto-subs'",source)
  self.assertIn("'--sub-langs',sub_langs",source)
  self.assertIn("args.extend(['--transcript',str(subtitle_matches[0])])",source)
 def test_ytdlp_uses_deno_if_installed(self):
  import server
  from unittest.mock import patch
  with patch.object(server.shutil,"which",side_effect=lambda n:"/fake/yt-dlp" if n=="yt-dlp" else ("/fake/deno" if n=="deno" else None)):
   self.assertEqual(server.yt_dlp_command(),["/fake/yt-dlp","--js-runtimes","deno"])


class ChannelMonitorTests(unittest.TestCase):
 def test_channel_id_parser_accepts_channel_and_resolves_handle(self):
  import channel_monitor, io
  from unittest.mock import patch
  good='https://www.youtube.com/channel/UC'+'a'*22
  self.assertEqual(channel_monitor.channel_id_from_url(good),'UC'+'a'*22)
  class Response(io.BytesIO):
   status=200
   def __enter__(self): return self
   def __exit__(self,*a): self.close()
  html=('\"externalId\":\"UC'+'a'*22+'\"').encode()
  with patch.dict('os.environ',{'YOUTUBE_API_KEY':''}), patch('channel_monitor.urllib.request.urlopen',return_value=Response(html)):
   self.assertEqual(channel_monitor.channel_id_from_url('https://www.youtube.com/@somechannel'),'UC'+'a'*22)
  with self.assertRaises(ValueError): channel_monitor.channel_id_from_url('https://www.youtube.com/watch?v=abcdefghijk')
 def test_rss_parser_extracts_real_video_metadata(self):
  import channel_monitor
  xml=b'''<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015"><entry><id>x</id><yt:videoId>abcdefghijk</yt:videoId><title>Nuevo episodio</title><published>2026-11-07T10:00:00+00:00</published><author><name>Canal</name></author></entry></feed>'''
  from unittest.mock import patch
  import io
  class Response(io.BytesIO):
   status=200
   def __enter__(self): return self
   def __exit__(self,*a): self.close()
  with patch('channel_monitor.urllib.request.urlopen',return_value=Response(xml)):
   entries=channel_monitor.fetch_feed('UC'+'a'*22)
  self.assertEqual(entries[0]['video_id'],'abcdefghijk')
  self.assertEqual(entries[0]['title'],'Nuevo episodio')
 def test_channel_monitor_is_public_discovery_not_downloader(self):
  import channel_monitor
  source=Path(channel_monitor.__file__).read_text()
  self.assertIn('youtube.com/feeds/videos.xml',source)
  self.assertNotIn('yt-dlp',source)
  self.assertIn('does not download',source)
 def test_channel_routes_and_ui_exist(self):
  server=(ROOT/'server.py').read_text(); html=(ROOT/'static/index.html').read_text(); js=(ROOT/'static/app.js').read_text()
  self.assertIn("path=='/api/channels'",server)
  self.assertIn("path=='/api/channels/refresh'",server)
  self.assertIn('id="channelForm"',html)
  self.assertIn("/api/channels/refresh",js)

class ChannelMonitorPersistenceTests(unittest.TestCase):
 def test_new_video_flag_survives_later_refreshes(self):
  import channel_monitor, tempfile, json
  from unittest.mock import patch
  from pathlib import Path
  channel={'channel_id':'UC'+'a'*22,'url':'https://www.youtube.com/channel/UC'+'a'*22,'label':'test','enabled':True,'videos':[]}
  with tempfile.TemporaryDirectory() as td:
   store=Path(td)/'channels.json'
   store.write_text(json.dumps([channel]))
   entries=[{'video_id':'abcdefghijk','title':'Nuevo','url':'https://www.youtube.com/watch?v=abcdefghijk','published':'2026-11-07T10:00:00Z','author':'test'}]
   with patch.object(channel_monitor,'STORE',store), patch.object(channel_monitor,'fetch_feed',return_value=entries):
    first=channel_monitor.refresh_channels()
    self.assertEqual(first['new_videos'],1)
    self.assertTrue(json.loads(store.read_text())[0]['videos'][0]['is_new'])
    second=channel_monitor.refresh_channels()
    self.assertEqual(second['new_videos'],0)
    self.assertTrue(json.loads(store.read_text())[0]['videos'][0]['is_new'])

 def test_youtube_api_handle_resolution_uses_forhandle(self):
  import channel_monitor, io, json
  from unittest.mock import patch
  class Response(io.BytesIO):
   status=200
   def __enter__(self): return self
   def __exit__(self,*a): self.close()
  payload=json.dumps({'items':[{'id':'UC'+'b'*22}]}).encode()
  with patch.dict('os.environ',{'YOUTUBE_API_KEY':'test-key'}), patch('channel_monitor.urllib.request.urlopen',return_value=Response(payload)) as mocked:
   self.assertEqual(channel_monitor.channel_id_from_url('https://youtube.com/@creator'),'UC'+'b'*22)
   self.assertIn('forHandle=creator',mocked.call_args.args[0].full_url)

class ChannelReviewWorkflowTests(unittest.TestCase):
 def test_new_channel_video_can_be_marked_seen_and_stays_seen_after_refresh(self):
  import channel_monitor, tempfile, json
  from unittest.mock import patch
  from pathlib import Path
  cid='UC'+'c'*22; vid='abcdefghijk'
  channel={'channel_id':cid,'url':f'https://www.youtube.com/channel/{cid}','label':'test','enabled':True,'videos':[]}
  entries=[{'video_id':vid,'title':'Nuevo','url':f'https://www.youtube.com/watch?v={vid}','published':'2026-11-07T10:00:00Z','author':'test'}]
  with tempfile.TemporaryDirectory() as td:
   store=Path(td)/'channels.json'; store.write_text(json.dumps([channel]))
   with patch.object(channel_monitor,'STORE',store), patch.object(channel_monitor,'fetch_feed',return_value=entries):
    self.assertEqual(channel_monitor.refresh_channels()['new_videos'],1)
    self.assertTrue(channel_monitor.mark_video_seen(cid,vid))
    self.assertFalse(json.loads(store.read_text())[0]['videos'][0]['is_new'])
    channel_monitor.refresh_channels()
    saved=json.loads(store.read_text())[0]['videos'][0]
    self.assertFalse(saved['is_new'])
    self.assertIn('seen_at',saved)
    self.assertFalse(channel_monitor.mark_video_seen(cid,'zzzzzzzzzzz'))
 def test_scheduler_is_singleton_and_seen_route_is_wired(self):
  source=(ROOT/'channel_monitor.py').read_text(); server=(ROOT/'server.py').read_text(); js=(ROOT/'static/app.js').read_text()
  self.assertIn('_SCHEDULER_STARTED',source)
  self.assertIn("endswith('/seen')",server)
  self.assertIn('seen-video',js)
  self.assertIn("'version':'1.72.0'",server)


class ChannelSeenHttpRouteTests(unittest.TestCase):
 def test_seen_endpoint_accepts_actual_frontend_url_shape(self):
  import json, threading, urllib.request, urllib.error
  from http.server import ThreadingHTTPServer
  from unittest.mock import patch
  import server
  cid='UC'+'d'*22; vid='abcdefghijk'
  httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
  thread=threading.Thread(target=httpd.serve_forever,daemon=True); thread.start()
  try:
   req=urllib.request.Request(f'http://127.0.0.1:{httpd.server_port}/api/channels/{cid}/{vid}/seen',data=b'',method='POST')
   with patch.object(server.channel_monitor,'mark_video_seen',return_value=True) as mark:
    with urllib.request.urlopen(req,timeout=3) as response:
     self.assertEqual(response.status,200)
     self.assertTrue(json.loads(response.read())['ok'])
    mark.assert_called_once_with(cid,vid)
  finally:
   httpd.shutdown(); httpd.server_close(); thread.join(timeout=2)


class ChannelRefreshConcurrencyTests(unittest.TestCase):
 def test_feed_network_wait_does_not_hold_storage_lock(self):
  import channel_monitor, tempfile, json, threading
  from pathlib import Path
  from unittest.mock import patch
  cid='UC'+'e'*22
  channel={'channel_id':cid,'url':f'https://www.youtube.com/channel/{cid}','label':'test','enabled':True,'videos':[]}
  entered=threading.Event(); release=threading.Event()
  def slow_feed(_cid):
   entered.set(); release.wait(2)
   return []
  with tempfile.TemporaryDirectory() as td:
   store=Path(td)/'channels.json'; store.write_text(json.dumps([channel]))
   with patch.object(channel_monitor,'STORE',store), patch.object(channel_monitor,'fetch_feed',side_effect=slow_feed):
    worker=threading.Thread(target=channel_monitor.refresh_channels); worker.start()
    self.assertTrue(entered.wait(1))
    # A UI read must not wait for the network request to finish.
    self.assertEqual(len(channel_monitor.list_channels()),1)
    release.set(); worker.join(2)
    self.assertFalse(worker.is_alive())

 def test_refresh_preserves_seen_state_changed_during_network_fetch(self):
  import channel_monitor, tempfile, json, threading
  from pathlib import Path
  from unittest.mock import patch
  cid='UC'+'f'*22; vid='abcdefghijk'
  channel={'channel_id':cid,'url':f'https://www.youtube.com/channel/{cid}','label':'test','enabled':True,'videos':[]}
  entered=threading.Event(); release=threading.Event()
  entry={'video_id':vid,'title':'Nuevo','url':f'https://www.youtube.com/watch?v={vid}','published':'2026-11-07T10:00:00Z','author':'test'}
  def slow_feed(_cid):
   entered.set(); release.wait(2); return [entry]
  with tempfile.TemporaryDirectory() as td:
   store=Path(td)/'channels.json'; store.write_text(json.dumps([channel]))
   with patch.object(channel_monitor,'STORE',store), patch.object(channel_monitor,'fetch_feed',side_effect=slow_feed):
    worker=threading.Thread(target=channel_monitor.refresh_channels); worker.start()
    self.assertTrue(entered.wait(1))
    # Simulate an existing item being marked seen while a later feed refresh runs.
    data=json.loads(store.read_text()); data[0]['videos']=[{**entry,'is_new':False,'seen_at':123}]; store.write_text(json.dumps(data))
    release.set(); worker.join(2)
    saved=json.loads(store.read_text())[0]['videos'][0]
    self.assertFalse(saved['is_new']); self.assertEqual(saved['seen_at'],123)


class PersistentJobRegistryTests(unittest.TestCase):
 def test_job_registry_resumes_recoverable_jobs_and_fails_missing_sources(self):
  import server, tempfile, json
  from pathlib import Path
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as td:
   registry=Path(td)/'jobs.json'; source=Path(td)/'source.mp4'; source.write_bytes(b'video')
   registry.write_text(json.dumps({
    'done':{'id':'done','status':'completed','log':'ok','output':'/tmp/out'},
    'busy':{'id':'busy','status':'processing','log':'rendering','output':None,'args':['python','clipforge.py','--unused',str(Path(td)/'missing.mp4')]},
    'recoverable':{'id':'recoverable','status':'processing','log':'rendering','output':None,'args':['python','clipforge.py','--unused',str(source)]}
   }))
   with patch.object(server,'JOBS_FILE',registry):
    recovered=server.load_job_registry()
    self.assertEqual(recovered['done']['status'],'completed')
    self.assertEqual(recovered['busy']['status'],'failed')
    self.assertIn('interrumpió',recovered['busy']['log'])
    self.assertEqual(recovered['recoverable']['status'],'queued')
    self.assertIn('reanudar',recovered['recoverable']['log'])
    saved=json.loads(registry.read_text())
    self.assertEqual(saved['recoverable']['status'],'queued')

 def test_failed_job_retains_original_for_retry_and_retry_route_exists(self):
  source=(ROOT/'server.py').read_text(); js=(ROOT/'static/app.js').read_text()
  self.assertIn("if success:\n     if not lease_lost:",source)
  self.assertIn("job_store_for_registry().finish_claim(JOBS[jid],worker_id)",source)
  self.assertIn("path.endswith('/retry')",source)
  self.assertIn("retry-job",js)
  self.assertIn("/api/jobs/${encodeURIComponent(button.dataset.id)}/retry",js)

 def test_restart_removes_missing_optional_transcript_from_recovery_command(self):
  import server, tempfile, json
  from pathlib import Path
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as td:
   source=Path(td)/'source.mp4'; source.write_bytes(b'video')
   missing=Path(td)/'gone.srt'; registry=Path(td)/'jobs.json'
   registry.write_text(json.dumps({'recover':{'id':'recover','status':'processing','log':'rendering','output':None,
    'args':['python','-u','clipforge.py',str(source),'--transcript',str(missing)],'transcript_path':str(missing)}}))
   with patch.object(server,'JOBS_FILE',registry):
    job=server.load_job_registry()['recover']
   self.assertEqual(job['status'],'queued')
   self.assertNotIn('--transcript',job['args'])
   self.assertIsNone(job['transcript_path'])

 def test_retry_endpoint_over_http_requeues_and_hides_private_execution_data(self):
  import server, tempfile, threading, urllib.request, json
  from pathlib import Path
  from http.server import ThreadingHTTPServer
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as td:
   source=Path(td)/'original.mp4'; source.write_bytes(b'authorized-source')
   jid='retryhttp1234'; registry=Path(td)/'jobs.json'
   original_jobs=server.JOBS
   with patch.object(server,'JOBS_FILE',registry), patch.object(server,'JOBS',{
    jid:{'id':jid,'status':'failed','source':'original.mp4','created':1,'log':'failed','output':None,
         'args':['python','-u','clipforge.py',str(source)],'transcript_path':None,'video_url':''}
   }), patch.object(server.Handler,'run_job',lambda self,*args: None):
    httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
    thread=threading.Thread(target=httpd.serve_forever,daemon=True); thread.start()
    base=f'http://127.0.0.1:{httpd.server_address[1]}'
    try:
     request=urllib.request.Request(base+f'/api/jobs/{jid}/retry',data=b'',method='POST')
     with urllib.request.urlopen(request,timeout=5) as response:
      self.assertEqual(response.status,202)
      self.assertEqual(json.loads(response.read())['status'],'queued')
     with urllib.request.urlopen(base+f'/api/jobs/{jid}',timeout=5) as response:
      public=json.loads(response.read())
     self.assertNotIn('args',public); self.assertNotIn('transcript_path',public); self.assertNotIn('video_url',public)
     self.assertEqual(server.job_store_for_registry().get(jid)['status'],'queued')
    finally:
     httpd.shutdown(); httpd.server_close()
  server.JOBS=original_jobs

 def test_job_metadata_is_written_atomically_and_bounded(self):
  import server, tempfile, json
  from pathlib import Path
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as td:
   registry=Path(td)/'jobs.json'
   jobs={str(i):{'id':str(i),'status':'completed'} for i in range(105)}
   with patch.object(server,'JOBS_FILE',registry), patch.object(server,'JOBS',jobs):
    with server.LOCK: server.persist_jobs_locked()
    saved=json.loads(registry.read_text())
    self.assertEqual(len(saved),100)
    self.assertFalse(registry.with_suffix('.tmp').exists())


class JobHistoryApiTests(unittest.TestCase):
 def test_job_history_endpoint_returns_safe_summary_and_completed_download(self):
  import server, threading, urllib.request, json, tempfile
  from pathlib import Path
  from http.server import ThreadingHTTPServer
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as td:
   output=Path(td)/'out'; output.mkdir()
   jobs={'a':{'id':'a','status':'completed','source':'source.mp4','created':10,'log':'done','output':str(output)},
         'b':{'id':'b','status':'failed','source':'bad.mp4','created':20,'log':'error','output':None}}
   httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler); thread=threading.Thread(target=httpd.serve_forever,daemon=True); thread.start()
   try:
    with patch.object(server,'JOBS',jobs):
     with urllib.request.urlopen(f'http://127.0.0.1:{httpd.server_port}/api/jobs') as response:
      data=json.loads(response.read())
     self.assertEqual([x['id'] for x in data['jobs']],['b','a'])
     self.assertEqual(data['jobs'][1]['download_url'],'/api/download/a')
     self.assertNotIn('output',data['jobs'][1])
   finally:
    httpd.shutdown(); httpd.server_close(); thread.join(timeout=2)

 def test_history_ui_is_connected_to_api(self):
  html=(ROOT/'static/index.html').read_text(); js=(ROOT/'static/app.js').read_text()
  self.assertIn('id="jobHistory"',html)
  self.assertIn("fetch('/api/jobs')",js)
  self.assertIn('loadJobHistory()',js)

class AuthorizedInboxTests(unittest.TestCase):
 def test_inbox_manifest_requires_explicit_owner_and_permission_reference(self):
  import tempfile, json, server
  with tempfile.TemporaryDirectory() as td:
   old=server.INBOX; server.INBOX=Path(td)
   try:
    video=Path(td)/'episode.mp4'; video.write_bytes(b'not-a-real-video')
    manifest=Path(str(video)+'.clipforge.json')
    manifest.write_text(json.dumps({'rights_confirmed':True,'rights_holder':'Creator'}))
    with self.assertRaisesRegex(ValueError,'explicit_rights_confirmation_required'):
     server._inbox_manifest(video,manifest)
   finally: server.INBOX=old
 def test_inbox_manifest_accepts_complete_authorization_and_safe_settings(self):
  import tempfile, json, server
  with tempfile.TemporaryDirectory() as td:
   old=server.INBOX; server.INBOX=Path(td)
   try:
    video=Path(td)/'episode.mp4'; video.write_bytes(b'x')
    manifest=Path(str(video)+'.clipforge.json')
    manifest.write_text(json.dumps({'rights_confirmed':True,'rights_holder':'Creator','permission_reference':'email-approval-2026','language':'es','clips':5,'min_seconds':20,'max_seconds':45}))
    data=server._inbox_manifest(video,manifest)
    self.assertEqual(data['permission_reference'],'email-approval-2026')
    self.assertEqual(data['crf'],'18')
   finally: server.INBOX=old
 def test_inbox_auto_import_is_wired_to_scheduler_and_ui(self):
  server=(ROOT/'server.py').read_text(); html=(ROOT/'static/index.html').read_text(); js=(ROOT/'static/app.js').read_text()
  self.assertIn('def scan_inbox_once()',server)
  self.assertIn('start_inbox_scheduler()',server)
  self.assertIn("path=='/api/inbox/scan'",server)
  self.assertIn('id="inboxList"',html)
  self.assertIn("fetch('/api/inbox/scan'",js)
  self.assertIn('INBOX_MANIFEST.example.json',(ROOT/'README.md').read_text())
 def test_inbox_watcher_waits_for_stable_video_then_queues_once(self):
  import tempfile, json, subprocess, threading, time, server
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as td:
   root=Path(td); inbox=root/'incoming'; processed=inbox/'processed'; uploads=root/'uploads'; outputs=root/'outputs'; data=root/'data'
   for folder in (inbox,processed,uploads,outputs,data): folder.mkdir(parents=True,exist_ok=True)
   video=inbox/'authorized.mp4'
   subprocess.run(['ffmpeg','-y','-f','lavfi','-i','testsrc=size=320x240:rate=25','-f','lavfi','-i','sine=frequency=440:duration=2','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',str(video)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
   Path(str(video)+'.clipforge.json').write_text(json.dumps({'rights_confirmed':True,'rights_holder':'Creator','permission_reference':'written-consent','language':'es','clips':1,'min_seconds':10,'max_seconds':20}))
   names=('INBOX','INBOX_PROCESSED','UPLOADS','OUTPUTS','JOBS_FILE','JOBS','INBOX_STABILITY','INBOX_SCAN_LOCK')
   old={name:getattr(server,name) for name in names}; old_run=server.Handler.run_job
   calls=[]
   try:
    server.INBOX=inbox;server.INBOX_PROCESSED=processed;server.UPLOADS=uploads;server.OUTPUTS=outputs;server.JOBS_FILE=data/'jobs.json';server.JOBS={};server.INBOX_STABILITY={};server.INBOX_SCAN_LOCK=threading.Lock()
    server.Handler.run_job=lambda self,jid,args,transcript_path=None,video_url='':calls.append(jid)
    first=server.scan_inbox_once(); self.assertEqual(first['waiting'],1); self.assertEqual(first['imported'],[])
    second=server.scan_inbox_once(); self.assertEqual(len(second['imported']),1); self.assertEqual(second['waiting'],0)
    self.assertEqual(len(calls),0)  # HTTP/inbox paths enqueue; the separate worker owns execution.
    jid=second['imported'][0]['job_id'];
    self.assertEqual(server.job_store_for_registry().get(jid)['status'],'queued')
    self.assertTrue((processed/f'{jid}_authorized.mp4').is_file())
    self.assertTrue(Path(server.JOBS[jid]['args'][3]).is_file())
   finally:
    server.Handler.run_job=old_run
    for name,value in old.items():setattr(server,name,value)
 def test_example_manifest_cannot_be_used_as_implicit_permission(self):
  import tempfile, json, server
  with tempfile.TemporaryDirectory() as td:
   old=server.INBOX; server.INBOX=Path(td)
   try:
    video=Path(td)/'episode.mp4'; video.write_bytes(b'x')
    manifest=Path(str(video)+'.clipforge.json')
    manifest.write_text((ROOT/'INBOX_MANIFEST.example.json').read_text())
    with self.assertRaisesRegex(ValueError,'explicit_rights_confirmation_required'):
     server._inbox_manifest(video,manifest)
   finally: server.INBOX=old


class RuntimeTruthfulnessTests(unittest.TestCase):
 def test_health_does_not_claim_native_speech_runtime_was_tested(self):
  source=(ROOT/"server.py").read_text()
  self.assertIn("helper_detected_not_runtime_tested",source)
  self.assertIn("unavailable_in_this_environment",source)
 def test_readme_upload_limit_matches_server(self):
  readme=(ROOT/"README.md").read_text()
  server=(ROOT/"server.py").read_text()
  self.assertIn("512 MB",readme)
  self.assertIn("512*1024*1024",server)

class BrowserWhisperIntegrationTests(unittest.TestCase):
 def test_browser_transcriber_module_is_served_by_static_route(self):
  source=(ROOT/'server.py').read_text()
  self.assertIn("'browser-whisper.js'",source)
  self.assertIn("'browser-whisper.js':'text/javascript'",source)
  html=(ROOT/'static/index.html').read_text()
  self.assertIn('id="browserTranscribe"',html)
  self.assertIn('Transcribir y seleccionar 4 clips automáticamente',html)
  self.assertIn('sin que tengas que escoger momentos manualmente',html)
  self.assertIn('type="module" src="/browser-whisper.js?v=',html)
  module=(ROOT/'static/browser-whisper.js').read_text()
  self.assertIn("import('https://esm.sh/@huggingface/transformers@3.7.2')",module)
  self.assertIn("language: result.language || sourceLanguage",module)
  self.assertIn("return_timestamps: timestampMode",module)
  self.assertIn("model === 'whisper-small' ? true : 'word'",module)


class BrowserWhisperHandoffTests(unittest.TestCase):
 def test_browser_transcriber_converts_word_timestamps_to_vtt_and_attaches_it(self):
  module=(ROOT/'static'/'browser-whisper.js').read_text()
  self.assertIn('function makeVtt(segments)',module)
  self.assertIn('WEBVTT',module)
  self.assertIn("document.querySelector('#transcript')",module)
  self.assertIn("new File([vtt], 'clipforge-transcripcion.vtt'",module)
  self.assertIn("input.dispatchEvent(new Event('change', { bubbles: true }))",module)

 def test_browser_transcriber_does_not_claim_speaker_diarization(self):
  module=(ROOT/'static'/'browser-whisper.js').read_text()
  self.assertIn('Whisper no identifica hablantes',module)


class BrowserFaceTrackingTests(unittest.TestCase):
 def test_browser_export_uses_local_face_detection_and_safe_multi_face_fallback(self):
  module=(ROOT/'static'/'browser-export.js').read_text()
  self.assertIn('@mediapipe/tasks-vision@1.2.2/vision_bundle.mjs',module)
  self.assertIn('faceLandmarker.detectForVideo(sourceCanvas',module)
  self.assertIn('track.activity=track.activity*.72',module)
  self.assertIn('landmarks[13]',module)
  self.assertIn('frameNumber%6===1',module)
  self.assertNotIn('frameNumber%6===1||lastFaceCenter===null',module)
  group=module.split('}else if(seen.length>1){',1)[1].split('}else if(!seen.length&&poseLandmarker){',1)[0]
  self.assertIn('lastFaceCenter=null;',group)
  self.assertIn('activeSpeakerTrack=null;',group)
  self.assertIn('mouth motion alone is not reliable',group)
  self.assertIn('lastFaceCenter*.78+desired*.22',module)
  self.assertIn('ctx.drawImage(sourceCanvas,-left*scale,0,sourceCanvas.width*scale,1920)',module)
  self.assertIn('instead of clamping',module)
  self.assertIn("sample.drawWithFit(ctx,{fit:'contain'})",module)
  self.assertIn('faceLandmarker?.close?.()',module)
  self.assertIn('PoseLandmarker.createFromOptions',module)
  self.assertIn('pose_landmarker_lite.task',module)
  self.assertIn('poseSamples++',module)
  self.assertIn('poseLandmarker?.close?.()',module)
  self.assertTrue(module.rstrip().endswith('});'))


class BrowserClipCandidateTests(unittest.TestCase):
 def test_browser_candidate_ranker_uses_timestamps_and_returns_four_non_overlapping_clips(self):
  module=(ROOT/'static'/'browser-whisper.js').read_text()
  self.assertIn('function buildEditorialCandidatePool',module)
  self.assertIn('function aiEditorialSelect',module)
  self.assertIn('const batchSize=12;',module)
  self.assertIn('const keep=Math.min(2,batch.length);',module)
  self.assertIn('const maxCandidates=96;',module)
  self.assertIn('if(!validRubric)continue;',module)
  self.assertIn("audit_verdict!=='pass'",module)
  self.assertIn('candidatePool = await aiEditorialSelect(candidatePool, 4, say)',module)
  self.assertIn('Qwen3-1.7B-q4f16_1-MLC',module)
  self.assertIn('function estimateVideoCapacity(options)',module)
  self.assertIn('updateVideoCapacity(file)',module)

 def test_small_candidate_pools_still_receive_final_vote_and_critic_audit(self):
  module=(ROOT/'static'/'browser-whisper.js').read_text()
  self.assertIn('if(pool.length<=batchSize){',module)
  self.assertIn('finalists.push(...pool);',module)
  self.assertIn('Juez editorial de control: auditando contexto, gancho y remate',module)
  self.assertNotIn('if(pool.length<=8)return askEditorialModel',module)

 def test_incomplete_ai_rubrics_are_rejected_instead_of_scored_as_fallback(self):
  module=(ROOT/'static'/'browser-whisper.js').read_text()
  self.assertIn('if(!validRubric)continue;',module)
  self.assertIn('repair pass',module)

 def test_candidate_ranker_supports_english_hooks_and_dialogue_turns(self):
  module=(ROOT/'static'/'browser-whisper.js').read_text()
  self.assertIn('guess what|you will not believe',module)
  self.assertIn('here is the thing|the point is',module)
  self.assertIn('turnCount>=(phraseTimed?2:5)',module)
  self.assertIn('questionAtStart=/^\\s*¿(?:y\\s+)?(?:qué|quién|cómo|cuándo|dónde|por qué|cuál|what|who|how|when|where|why|which)\\b/i.test(text)',module)
  self.assertIn('(questionAtStart?12:0)',module)
  self.assertIn('turnScore=Math.min(10,turnCount*1.25)',module)

 def test_candidate_ui_labels_heuristic_scores_honestly(self):
  html=(ROOT/'static'/'index.html').read_text()
  module=(ROOT/'static'/'browser-whisper.js').read_text()
  self.assertIn('Selección editorial IA',html)
  self.assertIn('no se presentan cortes heurísticos como selección IA',module)
  self.assertIn('id="videoCapacity"',html)


class BrowserProjectImportTests(unittest.TestCase):
 def test_project_import_validates_schema_and_clip_times(self):
  module=(ROOT/'static'/'browser-whisper.js').read_text()
  self.assertIn("project?.schema!=='clipforge-browser-project-v1'",module)
  self.assertIn("Number(c.end)<=Number(c.start)",module)
  self.assertIn("browserProjectImport",module)

 def test_project_import_restores_clips_and_transcript(self):
  module=(ROOT/'static'/'browser-whisper.js').read_text()
  self.assertIn("editableCandidates=project.clips.map",module)
  self.assertIn("transcriptData=project.transcript || null",module)
  html=(ROOT/'static'/'index.html').read_text()
  self.assertIn('accept="application/json,.json"',html)

class ManualBrowserRenderIntegrationTests(unittest.TestCase):
 def test_backend_accepts_browser_edit_decision_list(self):
  server=(ROOT/'server.py').read_text()
  engine=(ROOT/'clipforge.py').read_text()
  self.assertIn("fields.get('selected_clip_ranges')",server)
  self.assertIn("'--ranges-json'",server)
  self.assertIn('manual_browser_edit_decision_list',engine)
 def test_manual_ranges_are_bounded_and_validated(self):
  engine=(ROOT/'clipforge.py').read_text()
  self.assertIn('len(windows)>10',engine)
  self.assertIn('b>duration',engine)
  self.assertIn('--ranges-json',engine)
 def test_browser_candidates_submit_ranges_with_job_form(self):
  module=(ROOT/'static'/'browser-whisper.js').read_text()
  self.assertIn("field.name='selected_clip_ranges'",module)
  self.assertIn('JSON.stringify(editableCandidates)',module)

class ProjectRestoreRegressionTests(unittest.TestCase):
 def test_imported_project_reuses_same_editable_candidate_controls(self):
  module=(ROOT/'static'/'browser-whisper.js').read_text()
  self.assertIn('function showClipCandidates(words,duration,restoredCandidates=null,audioSamples=null,visualSamples=[])',module)
  self.assertIn('showClipCandidates([],duration,editableCandidates)',module)
  self.assertIn('Selección editorial realizada por un modelo generativo local',module)
  self.assertIn('c.ai_editorial_reason',module)
 def test_import_no_longer_restores_read_only_cards(self):
  module=(ROOT/'static'/'browser-whisper.js').read_text()
  import_section=module[module.index('// Importación explícita'):]
  self.assertNotIn("document.createElement('p')",import_section)
  self.assertIn('addEventListener(\'change\',update)',module)


class BrowserEditorPreviewTests(unittest.TestCase):
 def test_editor_has_local_source_preview_and_clip_range_playback(self):
  html=(ROOT/'static'/'index.html').read_text()
  module=(ROOT/'static'/'editor.js').read_text()
  self.assertIn('id="editorPreviewVideo"',html)
  self.assertIn('function previewClip(clip)',module)


class BroadVideoContainerSupportTests(unittest.TestCase):
 def test_common_video_containers_are_accepted_and_validated_by_ffprobe(self):
  source=(ROOT/"server.py").read_text()
  for suffix in (".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mpg", ".mpeg", ".mts", ".m2ts", ".ts", ".3gp", ".flv", ".wmv", ".ogv", ".vob", ".mxf"):
   self.assertIn(repr(suffix), source)
  self.assertIn("media=inspect_media(src)",source)
  self.assertIn("ffprobe",source)

 def test_browser_file_picker_is_not_limited_to_four_mime_types(self):
  html=(ROOT/"static/index.html").read_text()
  self.assertIn('accept="video/*',html)
  self.assertIn("AVI, M4V",html)


class MultilingualBrowserTranscriptionTests(unittest.TestCase):
 def test_browser_whisper_uses_the_selected_source_language(self):
  source=(ROOT/"static"/"browser-whisper.js").read_text()
  self.assertIn("async function transcribeAudioInChunks(asr, audio, onProgress = () => {}, timestampMode = 'word', language = null)",source)
  self.assertIn("language: language || undefined",source)
  self.assertIn("const selectedLanguage",source)
  self.assertIn("selectedLanguage === 'auto' ? undefined : selectedLanguage",source)
  self.assertIn('function captureVisualActivity(file, duration, stepSeconds = 4)',source)
  self.assertIn('movimiento y cambios visuales',source)
  self.assertIn('id="browserWhisperLanguage"',(ROOT/"static"/"index.html").read_text())
  self.assertNotIn("language: 'spanish'",source)
  self.assertIn("text.toLowerCase()",source)
  self.assertIn("async function releaseWhisperModel()",source)
  self.assertIn("await releaseWhisperModel();",source)
  self.assertIn("const bucketOf=c=>",source)
  html=(ROOT/"static"/"index.html").read_text()
  self.assertIn('value="auto" selected',html)
  for code in ("es","en"):
   self.assertIn(f'value="{code}"',html)
  for code in ("fr","de","pt","it","ja","zh","ar","ru","hi","ko"):
   self.assertNotIn(f'value="{code}"',html)
  backend=(ROOT/"server.py").read_text()
  self.assertIn("language not in SUPPORTED_LANGUAGES",backend)


class BrowserModelPreferenceTests(unittest.TestCase):
 def test_word_timed_base_model_is_default_with_small_option(self):
  html=(ROOT/"static"/"index.html").read_text()
  model=html.split('id="browserWhisperModel"',1)[1].split('</select>',1)[0]
  self.assertIn('value="whisper-base" selected',model)
  self.assertNotIn('value="whisper-small" selected',model)
  self.assertIn("await loadModel(activeModelId)", (ROOT/"static"/"browser-whisper.js").read_text())

 def test_phrase_overlap_deduplication_uses_time_and_token_similarity(self):
  source=(ROOT/"static"/"browser-whisper.js").read_text()
  self.assertIn("overlapRatio>=0.55 && textSimilarity>=0.82",source)
  self.assertIn("const previousTokens=new Set(previousText.split(' '))",source)
  chunking=source.split("async function transcribeAudioInChunks",1)[1].split("\nfunction makeVtt",1)[0]
  self.assertIn("let recentChunks = [];",chunking)
  self.assertIn("recentChunks = recentChunks.filter(previous => previous.end >= absoluteStart - 0.45);",chunking)
  self.assertIn("recentChunks.some(previous =>",chunking)
  self.assertNotIn("allChunks.some(previous =>",chunking)


class YouTubeProxyValidationTests(unittest.TestCase):
 def test_accepts_supported_youtube_video_urls(self):
  from youtube_proxy import validate_youtube_url
  self.assertEqual(validate_youtube_url('https://www.youtube.com/watch?v=abcdefghijk'),'https://www.youtube.com/watch?v=abcdefghijk')
  self.assertEqual(validate_youtube_url('https://youtu.be/abcdefghijk'),'https://youtu.be/abcdefghijk')
  self.assertEqual(validate_youtube_url('https://youtube.com/shorts/abcdefghijk'),'https://youtube.com/shorts/abcdefghijk')

 def test_rejects_non_youtube_hosts_and_non_video_pages(self):
  from youtube_proxy import validate_youtube_url
  for value in ('http://youtube.com/watch?v=abcdefghijk','https://youtube.com.evil.test/watch?v=abcdefghijk','https://example.com/video.mp4','https://youtube.com/@channel'):
   with self.subTest(value=value), self.assertRaises(ValueError):
    validate_youtube_url(value)

 def test_filename_is_sanitized_and_bounded(self):
  from youtube_proxy import safe_filename
  name=safe_filename('../../vídeo: prueba?')
  self.assertNotIn('/',name)
  self.assertNotIn('\\\\',name)
  self.assertTrue(name.endswith('.mp4'))
  self.assertLessEqual(len(name),125)

 def test_browser_ui_exposes_authorized_youtube_import_and_client_connection(self):
  html=(ROOT/'static'/'index.html').read_text()
  module=(ROOT/'static'/'browser-url.js').read_text()
  self.assertIn('id="browserYoutubeUrl"',html)
  self.assertIn('id="browserYoutubeRights"',html)
  self.assertIn('id="loadBrowserYoutube"',html)
  self.assertIn('clipforge-youtube-importer.onrender.com',module)
  self.assertIn("rights_confirmed: true",module)
  self.assertIn("new File([new Blob(chunks, {type: 'video/mp4'})]",module)


class BrowserWhisperDefaultTests(unittest.TestCase):
 def test_default_browser_model_prioritizes_word_timed_captions(self):
  html=(ROOT/'static'/'index.html').read_text()
  self.assertIn('<option value="whisper-base" selected>Base · recomendado (subtítulos palabra a palabra)</option>',html)
  self.assertIn('<option value="whisper-small">Small · más precisión (subtítulos por frase)</option>',html)
 def test_browser_language_defaults_to_automatic_spanish_or_english_detection(self):
  html=(ROOT/'static'/'index.html').read_text()
  self.assertIn('<option value="auto" selected>Detectar automáticamente (español o inglés)</option>',html)


class BrowserAudioExtractionRobustnessTests(unittest.TestCase):
 def test_missing_mp4_duration_metadata_falls_back_to_audio_track_duration(self):
  source=(ROOT/'static'/'browser-whisper.js').read_text()
  self.assertIn('const metadataDuration = await input.getDurationFromMetadata();',source)
  self.assertIn(': await track.computeDuration();',source)

 def test_mediabunny_input_is_disposed_on_success_and_failure(self):
  source=(ROOT/'static'/'browser-whisper.js').read_text()
  self.assertIn('} finally {\n    // Explicitly release demuxer/decoder resources',source)
  self.assertIn('input.dispose();',source)


class BrowserVideoExportRobustnessTests(unittest.TestCase):
 def test_mov_export_falls_back_to_measured_video_track_duration(self):
  source=(ROOT/'static'/'browser-export.js').read_text()
  self.assertIn('const metadataDuration=await input.getDurationFromMetadata();',source)
  self.assertIn(': await sourceTrack?.computeDuration();',source)
  self.assertIn('mediante metadatos ni midiendo la pista de vídeo',source)

 def test_export_releases_mediabunny_input_after_conversion(self):
  source=(ROOT/'static'/'browser-export.js').read_text()
  self.assertIn('poseLandmarker?.close?.();input.dispose();',source)


class BrowserMultiPersonTrackingFallbackTests(unittest.TestCase):
 def test_pose_tracking_falls_back_when_no_valid_face_is_seen(self):
  source=(ROOT/'static'/'browser-export.js').read_text()
  self.assertIn('}else if(!seen.length&&poseLandmarker){',source)
  self.assertNotIn('}else if(!faces.length&&poseLandmarker){',source)


class BrowserGroupFramingSafetyTests(unittest.TestCase):
 def test_multiple_visible_faces_do_not_trigger_ambiguous_single_face_crop(self):
  source=(ROOT/'static'/'browser-export.js').read_text()
  self.assertIn('}else if(seen.length>1){',source)
  group=source.split('}else if(seen.length>1){',1)[1].split('}else if(!seen.length&&poseLandmarker){',1)[0]
  self.assertIn('lastFaceCenter=null;',group)
  self.assertIn('activeSpeakerTrack=null;',group)
  self.assertIn('mouth motion alone is not reliable',group)


class ViralMomentFallbackSignalsTests(unittest.TestCase):
 def test_fallback_ranking_considers_story_reveals_conflict_stakes_and_specificity(self):
  source=(ROOT/'static'/'browser-whisper.js').read_text()
  for signal in ('const revelation=', 'const conflict=', 'const stakes=', 'const specificityScore='):
   self.assertIn(signal,source)
  self.assertIn('(revelation?10:0)',source)
  self.assertIn('(conflict?7:0)',source)
  self.assertIn('(stakes?9:0)',source)
  self.assertIn('revelación o giro narrativo',source)
  self.assertIn('conflicto u opinión contundente',source)
  self.assertIn('resultado o consecuencia relevante',source)
  self.assertIn('const anecdote=',source)
  self.assertIn('const progression=',source)
  self.assertIn('const strongOpinion=',source)
  self.assertIn('const closingReaction=',source)
  self.assertIn('(anecdote?7:0)',source)
  self.assertIn('(progression?8:0)',source)
  self.assertIn('anécdota con desarrollo narrativo',source)



class ConversationalPunchlineFallbackTests(unittest.TestCase):
 def test_short_question_answer_followup_is_scored_as_a_complete_editorial_beat(self):
  source=(ROOT/'static'/'browser-whisper.js').read_text()
  self.assertIn('const questionAnswerExchange=utterances.some',source)
  self.assertIn('answerWords<=9&&followupReaction',source)
  self.assertIn('(questionAnswerExchange?14:0)',source)
  self.assertIn('pregunta, respuesta breve y réplica inmediata',source)
