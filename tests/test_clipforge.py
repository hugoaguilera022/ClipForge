import importlib.util, tempfile, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("clipforge",ROOT/"clipforge.py")
cf=importlib.util.module_from_spec(spec);spec.loader.exec_module(cf)

class Tests(unittest.TestCase):
 def test_hooks_score_higher(self):
  self.assertGreater(cf.score_text("El secreto increíble que nadie conoce, ¿por qué?","es"),cf.score_text("Hoy hablamos de una herramienta.","es"))
 def test_editorial_reasons_are_explainable(self):
  reasons=cf.editorial_reasons("¿Por qué nunca me lo contaron? Yo perdí mil euros.", "es")
  self.assertIn("pregunta o intriga",reasons)
  self.assertIn("experiencia personal",reasons)
  self.assertIn("dato cuantitativo",reasons)
 def test_sentence_completion_bonus(self):
  self.assertGreater(cf.score_text("Esta es la verdad importante.", "es"), cf.score_text("Esta es la verdad importante", "es"))
 def test_candidate_scores_explain_structure_and_penalties(self):
  good,components,reasons=cf._candidate_quality("¿Sabías que esto puede cambiar tu vida? Yo lo probé y funcionó.","es",30,.9)
  bad,bad_components,bad_reasons=cf._candidate_quality("Y porque bueno eh eh esto", "es", 30,.5)
  self.assertGreater(good,bad)
  self.assertIn("opening_hook",components)
  self.assertIn("abrupt_start_penalty",bad_components)
  self.assertIn("muletillas detectadas",bad_reasons)
 def test_window_contains_score_breakdown(self):
  segs=[{"start":0,"end":8,"text":"¿Sabías que hay un error que casi todo el mundo comete?"},
        {"start":8,"end":16,"text":"Yo lo descubrí después de perder mucho tiempo."}]
  wins=cf.choose_windows(segs,1,12,30,"es")
  self.assertTrue(wins)
  self.assertIn("score_breakdown",wins[0])
  self.assertIn("duration_fit_penalty",wins[0]["score_breakdown"])
 def test_story_arc_rewards_reveal_and_payoff_context(self):
  selected=[{"start":10,"end":18,"text":"Entonces descubrí la verdad y al final conseguí resolverlo."}]
  previous={"start":5,"end":9.8,"text":"Todo empezó cuando cometí un error enorme."}
  following={"start":18.2,"end":22,"text":"Y eso cambió mi vida para siempre."}
  components,reasons=cf._story_arc_quality(selected,previous,following,"es")
  self.assertGreater(components["story_reveal"],0)
  self.assertGreater(components["story_payoff"],0)
  self.assertIn("revelación o giro",reasons)
  self.assertIn("resolución o recompensa",reasons)
 def test_story_question_answer_mini_arc_is_rewarded(self):
  selected=[{"start":0,"end":20,"text":"¿Por qué ocurrió? Resulta que nadie conocía el secreto."}]
  components,reasons=cf._story_arc_quality(selected,None,None,"es")
  self.assertGreater(components["story_mini_arc"],0)
  self.assertIn("planteamiento y recompensa dentro del mismo clip",reasons)
 def test_context_boundary_penalties_use_adjacent_segments(self):
  selected=[{"start":5,"end":8,"text":"porque esto funciona"}]
  previous={"start":2,"end":4.8,"text":"No entendía el motivo"}
  following={"start":8.2,"end":11,"text":"y por eso lo cambié."}
  components,reasons=cf._context_boundary_quality(selected,previous,following)
  self.assertLess(components["context_start_penalty"],0)
  self.assertLess(components["context_end_penalty"],0)
  self.assertIn("la frase parece continuar desde el segmento anterior",reasons)
  self.assertIn("la idea parece continuar en el segmento siguiente",reasons)
 def test_nonoverlap(self):
  segs=[{"start":i*8.0,"end":i*8.0+7,"text":t} for i,t in enumerate([
   "Hoy vamos a descubrir algo increíble que nadie te había contado.",
   "La inteligencia artificial está cambiando la forma de trabajar.",
   "Pero existe un error que comete casi todo el mundo.",
   "Imagina poder ahorrar horas cada semana con esta herramienta.",
   "La verdad es que esto puede cambiar tu negocio.",
   "Nadie esperaba este resultado y ahora te explico por qué."])]
  wins=cf.choose_windows(segs,3,12,45,"es")
  self.assertTrue(wins)
  for a,b in zip(wins,wins[1:]):self.assertLessEqual(a["end"],b["start"])
 def test_invalid_segments_are_ignored(self):
  segs=[{"start":"bad","end":4,"text":"ruido"},{"start":0,"end":8,"text":"Una frase de prueba suficientemente larga para analizar."},{"start":8,"end":7,"text":"mal"}]
  self.assertEqual(cf.choose_windows(segs,2,10,30,"es"),[])
 def test_invalid_bounds(self):self.assertEqual(cf.choose_windows([],3,30,20,"es"),[])
 def test_caption_splitting_limits_line_length(self):
  chunks=cf.split_caption_text("Esta es una frase bastante larga que debe dividirse en fragmentos cómodos para leer en pantalla")
  self.assertGreater(len(chunks),1);self.assertTrue(all(len(x)<=38 for x in chunks))
 def test_srt_keeps_long_phrase_as_one_truthfully_timed_cue(self):
  with tempfile.TemporaryDirectory() as d:
   f=Path(d)/"long.srt"
   cf.write_srt([{"start":0,"end":8,"text":"Esta es una frase bastante larga que debe dividirse en fragmentos cómodos para leer en pantalla"}],0,8,f)
   data=f.read_text()
   blocks=[x for x in data.strip().split("\\n\\n") if x]
   self.assertEqual(len(blocks),1)
   self.assertIn("00:00:00,000 --> 00:00:08,000",data)
 def test_srt(self):
  with tempfile.TemporaryDirectory() as d:
   f=Path(d)/"a.srt";cf.write_srt([{"start":10,"end":12,"text":"Hola"}],9,13,f);self.assertIn("Hola",f.read_text())
 def test_word_level_karaoke_ass(self):
  with tempfile.TemporaryDirectory() as d:
   f=Path(d)/"karaoke.ass";segs=[{"words":[{"start":1.0,"end":1.4,"word":"Hola"},{"start":1.4,"end":1.8,"word":"mundo"}]}]
   self.assertTrue(cf.write_karaoke_ass(segs,0.5,2.0,f));data=f.read_text()
   self.assertIn(r"{\kf40",data);self.assertIn("Hola",data);self.assertIn("mundo",data)
  self.assertIn(r"\fscx88",data)
 def test_karaoke_falls_back_without_word_times(self):
  with tempfile.TemporaryDirectory() as d:
   f=Path(d)/"karaoke.ass";self.assertFalse(cf.write_karaoke_ass([{"start":0,"end":2,"text":"Hola"}],0,2,f))
 def test_read_srt_transcript_with_timestamps(self):
  with tempfile.TemporaryDirectory() as d:
   f=Path(d)/"captions.srt"
   f.write_text("1\n00:00:01,000 --> 00:00:04,500\nUna frase interesante.\n\n2\n00:00:05,000 --> 00:00:09,000\nOtra frase completa.\n",encoding="utf-8")
   segs=cf.read_timed_transcript(f);self.assertEqual(len(segs),2)
   self.assertAlmostEqual(segs[0]["start"],1.0);self.assertAlmostEqual(segs[1]["end"],9.0)
 def test_read_vtt_transcript(self):
  with tempfile.TemporaryDirectory() as d:
   f=Path(d)/"captions.vtt";f.write_text("WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nA timed sentence.\n",encoding="utf-8")
   self.assertEqual(cf.read_timed_transcript(f)[0]["text"],"A timed sentence.")
 def test_cli_requires_rights(self):
  import subprocess,sys
  r=subprocess.run([sys.executable,str(ROOT/"clipforge.py"),"--help"],capture_output=True,text=True)
  self.assertEqual(r.returncode,0);self.assertIn("--rights-confirmed",r.stdout)
  blocked=subprocess.run([sys.executable,str(ROOT/"clipforge.py"),"/ruta/inexistente.mp4"],capture_output=True,text=True)
  self.assertNotEqual(blocked.returncode,0);self.assertIn("confirma autorización",blocked.stderr+blocked.stdout)
 def test_mp4_audit_checks_streams_and_dimensions(self):
  import shutil,subprocess
  if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):self.skipTest("ffmpeg/ffprobe no instalados")
  with tempfile.TemporaryDirectory() as d:
   video=Path(d)/"sample.mp4"
   gen=subprocess.run([shutil.which("ffmpeg"),"-y","-f","lavfi","-i","testsrc2=size=180x320:rate=10","-f","lavfi","-i","sine=frequency=440:duration=2","-t","2","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac",str(video)],capture_output=True)
   self.assertEqual(gen.returncode,0,gen.stderr.decode(errors="ignore")[-1000:])
   report=cf.audit_mp4(video,180,320);self.assertTrue(report["ok"],report);self.assertTrue(report["checks"]["audio_stream"])
 def test_render_with_burned_captions_if_ffmpeg_available(self):
  import argparse,shutil,subprocess
  ff=shutil.which("ffmpeg")
  if not ff:self.skipTest("ffmpeg no instalado")
  with tempfile.TemporaryDirectory() as d:
   folder=Path(d);src=folder/"src.mp4"
   gen=subprocess.run([ff,"-y","-f","lavfi","-i","testsrc2=size=320x180:rate=12","-f","lavfi","-i","sine=frequency=440:duration=3","-t","3","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac",str(src)],capture_output=True)
   if gen.returncode:self.skipTest("No se pudo crear vídeo sintético")
   args=argparse.Namespace(resolution="180x320",crop="blur",burn_captions=True)
   words=[{"start":0.1,"end":0.5,"word":"Texto"},{"start":0.6,"end":1.0,"word":"de"},{"start":1.1,"end":1.8,"word":"prueba"},{"start":1.9,"end":2.4,"word":"incrustado"}]
   segs=[{"start":0.0,"end":2.5,"text":"Texto de prueba incrustado","words":words}]
   w={"start":0.0,"end":2.8,"duration":2.8,"text":"prueba","score":1}
   cf.render_clip(src,w,1,segs,folder,args)
   self.assertTrue((folder/"clip_01.mp4").is_file());self.assertGreater((folder/"clip_01.mp4").stat().st_size,1000)
if __name__=="__main__":unittest.main()


class ReviewReportTests(unittest.TestCase):
 def test_review_exposes_score_breakdown_and_caveat(self):
  with tempfile.TemporaryDirectory() as td:
   folder=Path(td)
   cf.make_review_html([{"score":12.4,"start":1,"end":31,"duration":30,"text":"Una revelación importante.","reasons":["revelación o giro"],"score_breakdown":{"story_reveal":0.72,"duration_fit_penalty":-0.1}}],folder)
   page=(folder/"review.html").read_text()
   self.assertIn("Desglose de puntuación",page)
   self.assertIn("story reveal",page)
   self.assertIn("no una probabilidad ni una predicción de viralidad",page)


class ContextAndIndexTests(unittest.TestCase):
 def test_editorial_index_is_bounded_and_monotonic(self):
  self.assertEqual(cf._editorial_index_100(-2),0.0)
  self.assertGreater(cf._editorial_index_100(12),cf._editorial_index_100(6))
  self.assertLessEqual(cf._editorial_index_100(100),100)
 def test_candidate_keeps_adjacent_story_context(self):
  segs=[{"start":0,"end":5,"text":"Todo empezó con un problema inesperado."},
        {"start":5,"end":15,"text":"Entonces descubrí la verdad y resolví el misterio."},
        {"start":15,"end":22,"text":"Y esa fue la lección que aprendí."}]
  wins=cf.choose_windows(segs,1,9,18,"es")
  self.assertTrue(wins)
  self.assertTrue(wins[0]["context_before"] or wins[0]["context_after"])
  self.assertIn(wins[0]["story_phase"],{"inicio","desarrollo","final"})
  self.assertGreaterEqual(wins[0]["editorial_index_100"],0)
  self.assertLessEqual(wins[0]["editorial_index_100"],100)


class WholeVideoProfileTests(unittest.TestCase):
 def test_profile_extracts_chapters_themes_and_arc(self):
  segs=[
   {"start":0,"end":8,"text":"Todo empezó con un problema de dinero."},
   {"start":8,"end":16,"text":"El problema creció y perdí mucho dinero."},
   {"start":16,"end":24,"text":"Entonces descubrí la verdad y el secreto."},
   {"start":24,"end":32,"text":"Al final lo resolví y aprendí mucho."}]
  profile=cf._build_story_profile(segs,"es")
  self.assertIn("problema",profile["themes"])
  self.assertIn("setup",profile["arc_signals"])
  self.assertIn("reveal",profile["arc_signals"])
  self.assertIn("payoff",profile["arc_signals"])
  self.assertGreaterEqual(len(profile["chapters"]),1)
 def test_whole_video_themes_can_support_candidate_score(self):
  segs=[
   {"start":0,"end":8,"text":"El secreto del dinero era increíble."},
   {"start":8,"end":16,"text":"Nadie conocía ese secreto del dinero."},
   {"start":16,"end":24,"text":"El secreto cambió todo para siempre."}]
  profile=cf._build_story_profile(segs,"es")
  wins=cf.choose_windows(segs,1,12,30,"es",profile)
  self.assertTrue(wins)
  self.assertIn("global_theme_relevance",wins[0]["score_breakdown"])


class LongRangeStoryLinksTests(unittest.TestCase):
 def test_profile_links_question_to_later_answer_with_shared_terms(self):
  segs=[
   {"start":0,"end":5,"text":"¿Por qué desapareció el dinero?"},
   {"start":180,"end":187,"text":"Pasaron varios minutos hablando de otra cosa."},
   {"start":420,"end":428,"text":"Resulta que el dinero desapareció por un error del banco."}]
  profile=cf._build_story_profile(segs,"es")
  self.assertTrue(profile["question_answer_links"])
  link=profile["question_answer_links"][0]
  self.assertEqual(link["question_start"],0)
  self.assertEqual(link["answer_start"],420)
  self.assertIn("dinero",link["shared_terms"])
 def test_review_shows_long_range_links(self):
  with tempfile.TemporaryDirectory() as td:
   folder=Path(td)
   (folder/"story_profile.json").write_text(__import__("json").dumps({
    "themes":["dinero"],"arc_signals":["conflict"],
    "question_answer_links":[{"question":"¿Por qué desapareció el dinero?","answer":"El dinero desapareció por un error.","shared_terms":["dinero"]}],
    "coverage_note":"Léxico determinista."
   }),encoding="utf-8")
   cf.make_review_html([{"score":4,"start":1,"end":31,"duration":30,"text":"El dinero desapareció.","reasons":[],"score_breakdown":{}}],folder)
   page=(folder/"review.html").read_text()
   self.assertIn("Preguntas y respuestas relacionadas",page)
   self.assertIn("error",page)


 def test_phrase_srt_keeps_original_phrase_timing(self):
  with tempfile.TemporaryDirectory() as d:
   target=Path(d)/"phrase.srt"
   segments=[{"start":10.0,"end":14.0,"text":"Esta es una frase larga que debe ocupar dos líneas sin inventar tiempos intermedios"}]
   cf.write_srt(segments,8.0,20.0,target)
   data=target.read_text(encoding="utf-8")
   self.assertIn("00:00:02,000 --> 00:00:06,000",data)
   self.assertEqual(data.count("-->"),1)
   self.assertIn("Esta es una frase larga",data)

class ChapterThemeTests(unittest.TestCase):
 def test_chapters_include_local_themes_and_repeated_phrases(self):
  segs=[
   {"start":0,"end":4,"text":"El proyecto musical necesita mucho dinero."},
   {"start":5,"end":9,"text":"El proyecto musical necesita mucho dinero."},
   {"start":310,"end":314,"text":"Después hablamos de viajes y montañas."},
  ]
  profile=cf._build_story_profile(segs,"es")
  first=profile["chapters"][0]
  self.assertIn("proyecto",first["themes"])
  self.assertIn("proyecto musical",first["recurring_phrases"])
 def test_candidate_scoring_exposes_chapter_relevance(self):
  segs=[
   {"start":0,"end":5,"text":"El proyecto musical necesita mucho dinero."},
   {"start":6,"end":11,"text":"El proyecto musical necesita mucho dinero."},
   {"start":12,"end":17,"text":"El proyecto musical puede cambiarlo todo."},
   {"start":18,"end":23,"text":"El proyecto musical tiene una oportunidad enorme."},
   {"start":24,"end":29,"text":"El proyecto musical puede conseguirlo."},
  ]
  profile=cf._build_story_profile(segs,"es")
  clips=cf.choose_windows(segs,1,20,30,"es",profile)
  self.assertTrue(clips)
  self.assertIn("chapter_theme_relevance",clips[0]["score_breakdown"])


class EditorialSignalTests(unittest.TestCase):
 def test_concrete_emotional_contrast_and_address_are_explained(self):
  score,components,reasons=cf._candidate_quality(
   "Imagina perder 20.000 euros, fue terrible, pero descubrí cómo recuperarlos.",
   "es",30,.9)
  self.assertGreater(components["concrete_detail"],0)
  self.assertGreater(components["emotional_language"],0)
  self.assertGreater(components["contrast_or_turn"],0)
  self.assertGreater(components["direct_address"],0)
  self.assertIn("incluye una cifra o dato concreto",reasons)
 def test_neutral_text_does_not_receive_emotional_or_number_bonus(self):
  _,components,_=cf._candidate_quality(
   "Hoy hablamos tranquilamente de diferentes temas durante la mañana.",
   "es",30,.9)
  self.assertEqual(components["concrete_detail"],0)
  self.assertEqual(components["emotional_language"],0)
  self.assertEqual(components["contrast_or_turn"],0)


class ExplicitSpeakerLabelTests(unittest.TestCase):
 def test_srt_speaker_prefix_is_preserved_as_metadata(self):
  with tempfile.TemporaryDirectory() as td:
   path=Path(td)/"dialogue.srt"
   path.write_text("1\n00:00:00,000 --> 00:00:03,000\nHablante 1: Yo no esperaba esto.\n\n2\n00:00:03,000 --> 00:00:06,000\n[Speaker 2] That changed everything.\n")
   parsed=cf.read_timed_transcript(path)
   self.assertEqual(parsed[0]["speaker_id"],"1")
   self.assertEqual(parsed[0]["text"],"Yo no esperaba esto.")
   self.assertEqual(parsed[1]["speaker_id"],"2")
 def test_profile_reports_only_explicit_speaker_labels(self):
  segs=[
   {"start":0,"end":3,"text":"Yo no esperaba esto.","speaker_id":"1"},
   {"start":3,"end":6,"text":"That changed everything.","speaker_id":"2"},
  ]
  profile=cf._build_story_profile(segs,"es")
  self.assertEqual({x["id"] for x in profile["speakers"]},{"1","2"})
  self.assertIn("Solo se muestran hablantes etiquetados",profile["speaker_detection_note"])


class ActiveFaceSelectionTests(unittest.TestCase):
 def test_mouth_motion_can_select_smaller_active_face(self):
  faces=[
   {"cx":150,"area":18000,"mouth_motion":1.0},
   {"cx":470,"area":9000,"mouth_motion":16.0},
  ]
  chosen=cf._choose_active_face(faces,150,640)
  self.assertEqual(chosen["cx"],470)
 def test_continuity_breaks_ties_between_similar_faces(self):
  faces=[
   {"cx":160,"area":12000,"mouth_motion":5.0},
   {"cx":470,"area":12000,"mouth_motion":5.0},
  ]
  chosen=cf._choose_active_face(faces,150,640)
  self.assertEqual(chosen["cx"],160)
 def test_no_face_returns_none(self):
  self.assertIsNone(cf._choose_active_face([],None,640))


class FaceTrackingStabilityTests(unittest.TestCase):
 def test_keeps_current_face_when_scores_are_close(self):
  faces=[
   {"cx":150,"area":10000,"mouth_motion":8.0},
   {"cx":470,"area":10000,"mouth_motion":10.0},
  ]
  chosen=cf._choose_active_face(faces,150,640)
  self.assertEqual(chosen["cx"],150)
 def test_switches_when_new_face_has_clear_motion_advantage(self):
  faces=[
   {"cx":150,"area":9000,"mouth_motion":0.0},
   {"cx":470,"area":9000,"mouth_motion":18.0},
  ]
  chosen=cf._choose_active_face(faces,150,640)
  self.assertEqual(chosen["cx"],470)


class SceneCutDetectionTests(unittest.TestCase):
 def test_detects_large_frame_difference(self):
  self.assertTrue(cf._scene_change_detected(35.0))
 def test_ignores_normal_motion_and_invalid_values(self):
  self.assertFalse(cf._scene_change_detected(12.0))
  self.assertFalse(cf._scene_change_detected(float("nan")))
 def test_threshold_is_configurable(self):
  self.assertTrue(cf._scene_change_detected(18.0,18.0))


class NarrativeCompletenessTests(unittest.TestCase):
 def test_complete_story_scores_above_hook_only(self):
  complete=[{"text":"Cuando era joven tuve un problema enorme."},
            {"text":"Pero descubrí la verdad y al final lo resolví."}]
  hook=[{"text":"¿Sabías que nadie conoce este secreto?"}]
  full,_=cf._narrative_completeness(complete,"es")
  opening,_=cf._narrative_completeness(hook,"es")
  self.assertGreater(full["narrative_completeness"],opening["narrative_completeness"])
 def test_resolution_and_turn_are_rewarded(self):
  segments=[{"text":"Resulta que todo era un error."},{"text":"Por eso lo resolví y aprendí."}]
  score,reasons=cf._narrative_completeness(segments,"es")
  self.assertGreater(score["narrative_completeness"],0)
  self.assertTrue(reasons)
 def test_unfinished_hook_is_not_mistaken_for_complete_story(self):
  score,_=cf._narrative_completeness([{"text":"¿Por qué ocurrió esto?"}],"es")
  self.assertLess(score["narrative_completeness"],0)


class AudioSilenceSelectionTests(unittest.TestCase):
 def test_penalizes_silence_at_clip_opening_and_closing(self):
  penalty,details,reasons=cf._audio_boundary_quality(10,20,[{"start":9.5,"end":11.0},{"start":19.0,"end":20.5}])
  self.assertLess(penalty,0)
  self.assertGreater(details["audio_start_silence"],0)
  self.assertGreater(details["audio_end_silence"],0)
  self.assertEqual(len(reasons),2)
 def test_speech_continuous_clip_has_no_silence_penalty(self):
  penalty,details,_=cf._audio_boundary_quality(10,20,[{"start":2,"end":4},{"start":25,"end":27}])
  self.assertEqual(penalty,0)
  self.assertEqual(details["audio_internal_silence"],0)
 def test_internal_long_pause_is_reported(self):
  penalty,details,reasons=cf._audio_boundary_quality(10,20,[{"start":14,"end":16}])
  self.assertLess(penalty,0)
  self.assertIn("pausa larga dentro del fragmento",reasons)

 def test_placeholder_transcript_is_rejected(self):
  with tempfile.TemporaryDirectory() as td:
   f=Path(td)/"fixture.srt"
   f.write_text("1\n00:00:00,000 --> 00:00:03,000\n[TEXTO DE PRUEBA 1] conversación entrevista\n",encoding="utf-8")
   with self.assertRaisesRegex(RuntimeError,"texto de prueba"):
    cf.read_timed_transcript(f)

 def test_phrase_only_transcript_does_not_get_fake_word_timing(self):
  import inspect
  source=inspect.getsource(cf.render_clip)
  self.assertNotIn("word_end=cursor+(b-a)*weight/total",source)

 def test_macos_transcription_requires_real_word_timestamps(self):
  import inspect
  source=inspect.getsource(cf.transcribe_macos_native)
  self.assertIn("Apple Speech no devolvió marcas de tiempo de palabras válidas",source)
  self.assertIn("if not all_segments",source)

class MultiFaceDialogueLayoutTests(unittest.TestCase):
 def test_multi_face_dialogue_prefers_full_frame_layout(self):
  self.assertTrue(cf._multi_face_dialogue([2, 2, 1, 2, 2]))
 def test_single_face_or_rare_second_detection_keeps_face_tracking(self):
  self.assertFalse(cf._multi_face_dialogue([1, 1, 2, 1, 1]))
  self.assertFalse(cf._multi_face_dialogue([1, 1, 1, 1]))
 def test_empty_face_samples_are_safe(self):
  self.assertFalse(cf._multi_face_dialogue([]))
