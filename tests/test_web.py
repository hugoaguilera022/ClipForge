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
  self.assertIn('str(executable),str(audio),language,
…[1 chars truncated — re-run with head/grep/tail for full output]…
 if(!seen.length&&poseLandmarker){',1)[0]
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
  self.assertIn('const batchSize=24;',module)
  self.assertIn('const keep=Math.min(4,batch.length);',module)
  self.assertIn('const maxCandidates=96;',module)
  self.assertIn('if(!validRubric)continue;',module)
  self.assertIn("audit_verdict!=='pass'",module)
  self.assertIn('aiEditorialSelect(candidatePool, requested, say)',module)
  self.assertIn('getDailyClipBudget()',module)
  self.assertIn('recordDailyAIClips(candidatePool.length)',module)
  self.assertIn('limit=4; // Product requirement: exactly four important moments per video.',module)
  self.assertIn('const requested=4;',module)
  self.assertIn('const finalPool=finalists;',module)
  self.assertIn('Qwen3-1.7B-q4f16_1-MLC',module)
  self.assertIn('function createFederatedFreeAIEngine',module)
  self.assertIn('Cuotas externas agotadas: activando Qwen3 local',module)
  self.assertIn('configuredFreeAIProviders()',module)
  self.assertIn('FREE_AI_PROVIDERS',module)
  self.assertIn('const selectionLimit=Math.max(1,Math.min(12,Math.floor(Number(limit)||4)));',module)
  self.assertIn('selected.length !== Math.min(selectionLimit, candidates.length)',module)
  provider_html=(ROOT/'static'/'index.html').read_text()
  self.assertIn('data-provider-key="gemini"',provider_html)
  self.assertIn('data-provider-key="groq"',provider_html)
  self.assertIn('data-provider-key="cerebras"',provider_html)
  self.assertIn('data-provider-key="mistral"',provider_html)
  self.assertIn('data-provider-key="openrouter"',provider_html)
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
  self.assertIn('(questionAnswerExchange?22:0)',source)
  self.assertIn('pregunta, respuesta breve y réplica inmediata',source)

class EditorialMomentQualityTests(unittest.TestCase):
 def test_fallback_rewards_complete_multi_turn_conversations(self):
  source=(ROOT/'static'/'browser-whisper.js').read_text()
  self.assertIn('const completeConversationBeat=',source)
  self.assertIn('const multiTurnExchange=utteranceCount>=4',source)
  self.assertIn('(completeConversationBeat?15:0)',source)
  self.assertIn('(dialogueProgression?6:0)',source)
  self.assertIn('intercambio completo: pregunta, respuesta y reacción',source)

 def test_fallback_penalizes_intros_and_transition_only_windows(self):
  source=(ROOT/'static'/'browser-whisper.js').read_text()
  self.assertIn('const weakOpening=',source)
  self.assertIn('const transitionOnly=',source)
  self.assertIn('(weakOpening?18:0)',source)
  self.assertIn('(transitionOnly?22:0)',source)

 def test_fallback_penalizes_clips_that_stitch_next_speaker_intro_to_prior_punchline(self):
  source=(ROOT/'static'/'browser-whisper.js').read_text()
  self.assertIn('const handoffIntroMatch=',source)
  self.assertIn('const newSceneTail=',source)
  self.assertIn('(newSceneTail?22:0)',source)
  self.assertIn('pregunta sin respuesta ni remate',source)

 def test_four_clip_selection_penalizes_near_duplicate_topics(self):
  source=(ROOT/'static'/'browser-whisper.js').read_text()
  self.assertIn('const lexicalSimilarity=',source)
  self.assertIn('const duplicatePenalty=Math.max(0,maxSimilarity-.34)*28',source)
  self.assertIn('const noveltyBonus=',source)

 def test_short_answer_followup_detects_question_reaction_and_confirmation(self):
  source=(ROOT/'static'/'browser-whisper.js').read_text()
  self.assertIn('const confirmationReaction=',source)
  self.assertIn('const shortAnswerFollowup=utterances.some',source)
  self.assertIn('answerWords<=12&&followup',source)
  self.assertIn('(shortAnswerFollowup?18:0)',source)

 def test_fallback_samples_moments_at_finer_intervals(self):
  source=(ROOT/'static'/'browser-whisper.js').read_text()
  self.assertIn('const stepSeconds=1.25;',source)
