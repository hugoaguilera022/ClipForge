#!/usr/bin/env python3
"""ClipForge 0.7 — local-first clip production for authorized source media."""
from __future__ import annotations
import argparse, html, json, re, shutil, subprocess, sys, tempfile, platform, math, threading, os, urllib.request, urllib.error
from pathlib import Path
from typing import Any

SUPPORTED_LANGUAGES={"es","en","fr","de","pt","it","ja","zh","ar","ru","hi","ko","nl","pl","tr","uk","sv","da","no","fi","el","cs","ro","hu","id","vi","th","he"}
HOOK_WORDS = {
 "es":["nunca","increíble","secreto","error","problema","millón","dinero","nadie","verdad","brutal","imagina","importante","imposible","por qué","cómo","descubrí","funciona","cuidado","deja de"],
 "en":["never","incredible","secret","mistake","problem","million","money","nobody","truth","crazy","imagine","important","impossible","why","how","discovered","works","stop","warning"],
 "fr":["jamais","incroyable","secret","erreur","problème","million","argent","personne","vérité","imagine","important","impossible","pourquoi","comment","découvert","attention"],
 "de":["niemals","unglaublich","geheimnis","fehler","problem","million","geld","niemand","wahrheit","stell dir vor","wichtig","unmöglich","warum","wie","entdeckt","achtung"],
 "pt":["nunca","incrível","segredo","erro","problema","milhão","dinheiro","ninguém","verdade","imagina","importante","impossível","porquê","como","descobri","atenção"],
 "it":["mai","incredibile","segreto","errore","problema","milione","soldi","nessuno","verità","immagina","importante","impossibile","perché","come","scoperto","attenzione"]}
FILLERS={"es":["eh","em","este","bueno"],"en":["uh","um","you know"],"fr":["euh","ben","voilà"],"de":["äh","also","halt"],"pt":["é","tipo","né"],"it":["ehm","cioè","allora"]}

def run(cmd:list[str])->None:
 p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 if p.returncode: raise RuntimeError(f"Command failed: {' '.join(cmd)}\n{p.stderr[-2500:]}")

def fmt_srt_time(seconds:float)->str:
 ms=max(0,int(round(seconds*1000))); h,ms=divmod(ms,3600000); m,ms=divmod(ms,60000); s,ms=divmod(ms,1000)
 return f"{h:02}:{m:02}:{s:02},{ms:03}"

def transcribe_macos_native(video:Path,language:str)->dict[str,Any]:
 """Use Apple's on-device Speech framework; compile its helper once per job."""
 if platform.system() != "Darwin":
  raise RuntimeError("El reconocimiento nativo de Apple solo está disponible en macOS.")
 helper=Path(__file__).with_name("transcribe_macos.swift")
 if not helper.is_file(): raise RuntimeError("Falta transcribe_macos.swift.")
 if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
  raise RuntimeError("Faltan FFmpeg/FFprobe; instala ambos antes de transcribir.")
 probe=subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",str(video)],capture_output=True,text=True)
 if probe.returncode: raise RuntimeError("No se pudo medir la duración del vídeo: "+probe.stderr[-1000:])
 try: duration=float(probe.stdout.strip())
 except ValueError as exc: raise RuntimeError("FFprobe devolvió una duración no válida.") from exc
 if not math.isfinite(duration) or duration<=0: raise RuntimeError("El vídeo tiene una duración no válida.")
 # Prefer the active Xcode/Command Line Tools compiler selected by xcode-select.
 # Calling `swift` for every chunk recompiles the script repeatedly and hides toolchain errors.
 xcrun=shutil.which("xcrun")
 compiler=""
 if xcrun:
  found=subprocess.run([xcrun,"--find","swiftc"],capture_output=True,text=True,timeout=20)
  if found.returncode==0: compiler=found.stdout.strip()
 if not compiler: compiler=shutil.which("swiftc") or ""
 if not compiler:
  raise RuntimeError("No se encuentra swiftc. Instala/selecciona Xcode Command Line Tools y comprueba `xcode-select -p`.")
 with tempfile.TemporaryDirectory(prefix="clipforge_speech_") as td:
  folder=Path(td); executable=folder/"clipforge-speech"
  built=subprocess.run([compiler,"-O",str(helper),"-o",str(executable)],capture_output=True,text=True,timeout=180)
  if built.returncode:
   detail=(built.stderr or built.stdout or "Error desconocido al compilar Speech.framework")[-3500:]
   if "SDK is not supported by the compiler" in detail or "SwiftBridging" in detail or "toolchain" in detail.lower():
    raise RuntimeError("El compilador Swift y el SDK de macOS no coinciden. No es un fallo del vídeo ni de ClipForge. Ejecuta `xcode-select -p` y selecciona una instalación de Xcode/Command Line Tools compatible. Detalle: "+detail)
   raise RuntimeError("No se pudo compilar el motor Apple Speech: "+detail)
  all_segments=[]
  for index,start in enumerate(range(0,int(math.ceil(duration)),45)):
   length=min(45.0,duration-start)
   if length<=0: continue
   audio=folder/f"speech_{index:03}.m4a"; result=folder/f"transcript_{index:03}.json"
   run(["ffmpeg","-hide_banner","-loglevel","error","-y","-ss",str(start),"-i",str(video),"-t",str(length),"-vn","-ac","1","-ar","16000","-c:a","aac","-b:a","96k",str(audio)])
   proc=subprocess.run([str(executable),str(audio),language,str(result)],capture_output=True,text=True,timeout=15*60)
   if proc.returncode:
    raise RuntimeError("Reconocimiento local de Apple: "+(proc.stderr or proc.stdout)[-1800:])
   try: data=json.loads(result.read_text(encoding="utf-8"))
   except (OSError,json.JSONDecodeError) as exc: raise RuntimeError("Apple Speech no generó un JSON de transcripción válido.") from exc
   for segment in data.get("segments",[]):
    segment["start"]=float(segment["start"])+start
    segment["end"]=float(segment["end"])+start
    for word in segment.get("words",[]):
     word["start"]=float(word["start"])+start
     word["end"]=float(word["end"])+start
    all_segments.append(segment)
 if not all_segments:
  raise RuntimeError("Apple Speech terminó sin reconocer palabras. Comprueba idioma, permisos y que el vídeo tenga diálogo inteligible.")
 clean=[]
 for seg in all_segments:
  words=[]
  for word in seg.get("words",[]) or []:
   try:
    a,b=float(word["start"]),float(word["end"]); token=str(word.get("word"," ")).strip()
    if token and 0 <= a < b <= duration + 1.0:
     words.append({"start":a,"end":b,"word":token})
   except (KeyError,TypeError,ValueError): continue
  if words:
   clean.append({"start":words[0]["start"],"end":words[-1]["end"],
                 "text":" ".join(w["word"] for w in words),"words":words})
 if not clean:
  raise RuntimeError("Apple Speech no devolvió marcas de tiempo de palabras válidas; no se generarán subtítulos inventados.")
 return {"segments":clean}

_MLX_WHISPER_MODELS = {
 "tiny": "mlx-community/whisper-tiny",
 "base": "mlx-community/whisper-base",
 "small": "mlx-community/whisper-small",
 "medium": "mlx-community/whisper-medium",
 "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
}

def _transcribe_mlx_whisper(video:Path,model_name:str,language:str)->dict[str,Any]:
 """Apple-Silicon accelerated local ASR using MLX Whisper (no remote API)."""
 if platform.system() != "Darwin" or platform.machine().lower() not in {"arm64", "aarch64"}:
  raise RuntimeError("MLX Whisper requiere macOS en Apple Silicon (M1/M2/M3/M4).")
 try:
  import mlx_whisper
 except ImportError as exc:
  raise RuntimeError("MLX Whisper no está instalado. El lanzador de ClipForge puede instalarlo automáticamente en macOS Apple Silicon.") from exc
 requested = os.environ.get("CLIPFORGE_MLX_MODEL", model_name).strip().lower()
 repo = _MLX_WHISPER_MODELS.get(requested, _MLX_WHISPER_MODELS.get(model_name.lower(), _MLX_WHISPER_MODELS["small"]))
 try:
  result = mlx_whisper.transcribe(str(video), path_or_hf_repo=repo, language=language,
                                  word_timestamps=True, condition_on_previous_text=True)
 except Exception as exc:
  raise RuntimeError(f"MLX Whisper no pudo transcribir con {repo}: {exc}") from exc
 segments=[]
 for segment in result.get("segments", []) or []:
  try: a=float(segment.get("start", 0)); b=float(segment.get("end", 0))
  except (TypeError, ValueError): continue
  words=[]
  for word in segment.get("words", []) or []:
   try:
    wa=float(word.get("start")); wb=float(word.get("end")); token=str(word.get("word", "")).strip()
    if token and math.isfinite(wa) and math.isfinite(wb) and 0 <= wa < wb:
     words.append({"start":wa,"end":wb,"word":token,
                   "probability":word.get("probability")})
   except (TypeError, ValueError, AttributeError): continue
  text_value=str(segment.get("text", "")).strip()
  if not text_value and words: text_value=" ".join(w["word"] for w in words)
  if text_value and math.isfinite(a) and math.isfinite(b) and 0 <= a < b:
   row={"start":a,"end":b,"text":text_value}
   if words: row["words"]=words
   segments.append(row)
 if not segments:
  raise RuntimeError("MLX Whisper terminó sin segmentos de voz válidos.")
 return {"segments":segments,"language":result.get("language",language),
         "engine":"mlx-whisper","model":repo}

_FASTER_WHISPER_MODELS:dict[tuple[str,str],Any]={}
_FASTER_WHISPER_LOCK=threading.Lock()


def _transcribe_faster_whisper(video:Path,model_name:str,language:str)->dict[str,Any]:
 """Cross-platform local ASR using CTranslate2; no Apple framework or API required."""
 try:
  from faster_whisper import WhisperModel
 except ImportError as exc:
  raise RuntimeError("Faster-Whisper no está instalado. Instala las dependencias de ClipForge con `python -m pip install -r requirements.txt`.") from exc
 # CPU INT8 is the most portable baseline (including Apple Silicon); it avoids
 # CUDA/Metal assumptions and keeps RAM use lower. Cache loaded models per process.
 key=(model_name,"cpu-int8")
 with _FASTER_WHISPER_LOCK:
  model=_FASTER_WHISPER_MODELS.get(key)
  if model is None:
   try:
    model=WhisperModel(model_name,device="cpu",compute_type="int8")
   except Exception as exc:
    raise RuntimeError(f"No se pudo cargar Faster-Whisper ({model_name}): {exc}") from exc
   _FASTER_WHISPER_MODELS[key]=model
 try:
  iterator,info=model.transcribe(str(video),language=language,word_timestamps=True,
      vad_filter=True,beam_size=5,condition_on_previous_text=True)
  segments=[]
  for segment in iterator:
   words=[]
   for word in (getattr(segment,"words",None) or []):
    try:
     a=float(word.start);b=float(word.end);token=str(word.word or "").strip()
     if token and math.isfinite(a) and math.isfinite(b) and 0<=a<b:
      words.append({"start":a,"end":b,"word":token,
                    "probability":getattr(word,"probability",None)})
    except (TypeError,ValueError,AttributeError):
     continue
   text_value=str(getattr(segment,"text","") or "").strip()
   if not text_value and words:text_value=" ".join(w["word"] for w in words)
   if not text_value:continue
   try:a=float(segment.start);b=float(segment.end)
   except (TypeError,ValueError,AttributeError):
    if words:a,b=words[0]["start"],words[-1]["end"]
    else:continue
   if not math.isfinite(a) or not math.isfinite(b) or b<=a:continue
   row={"start":a,"end":b,"text":text_value}
   if words:row["words"]=words
   segments.append(row)
 except Exception as exc:
  raise RuntimeError(f"Faster-Whisper no pudo transcribir el audio: {exc}") from exc
 if not segments:
  raise RuntimeError("Faster-Whisper no reconoció voz. Comprueba que el vídeo tenga diálogo audible y que el idioma seleccionado sea correcto.")
 return {"segments":segments,"language":getattr(info,"language",language),
         "language_probability":getattr(info,"language_probability",None),
         "engine":"faster-whisper","model":model_name}


def _whisper_cpp_model_path(model_name:str)->Path:
 """Resolve/download the official quantized Whisper.cpp model in the user cache."""
 aliases={"base":"base","small":"small","medium":"medium","tiny":"tiny"}
 name=aliases.get(str(model_name).lower(),"small")
 folder=Path.home()/".cache"/"clipforge"/"whisper.cpp"/"models"
 folder.mkdir(parents=True,exist_ok=True)
 target=folder/f"ggml-{name}.bin"
 if target.is_file() and target.stat().st_size>20_000_000:
  return target
 url=f"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{name}.bin"
 tmp=target.with_suffix(".bin.part")
 try:
  request=urllib.request.Request(url,headers={"User-Agent":"ClipForge/1.50"})
  with urllib.request.urlopen(request,timeout=45) as response, tmp.open("wb") as out:
   shutil.copyfileobj(response,out)
  if tmp.stat().st_size<20_000_000:
   raise RuntimeError("El modelo descargado está incompleto (menos de 20 MB).")
  tmp.replace(target)
 except Exception as exc:
  try: tmp.unlink(missing_ok=True)
  except OSError: pass
  raise RuntimeError(f"No se pudo descargar el modelo Whisper.cpp ({name}). Comprueba Internet y vuelve a intentarlo: {exc}") from exc
 return target


def _parse_whisper_cpp_json(path:Path,language:str,model_name:str)->dict[str,Any]:
 """Normalize whisper.cpp JSON into ClipForge segments and word-level timings."""
 try: data=json.loads(path.read_text(encoding="utf-8"))
 except (OSError,json.JSONDecodeError) as exc:
  raise RuntimeError("Whisper.cpp no generó un JSON de transcripción válido.") from exc
 rows=data.get("transcription") or data.get("segments") or []
 segments=[]
 def stamp(value:Any)->float|None:
  if isinstance(value,(int,float)): return float(value)/1000.0 if value>1000 else float(value)
  if isinstance(value,str):
   m=re.search(r"(\d+):(\d+):(\d+)[,.](\d+)",value)
   if m:return int(m.group(1))*3600+int(m.group(2))*60+int(m.group(3))+float("0."+m.group(4))
  return None
 for row in rows:
  ts=row.get("timestamps",{}) or {}
  a=stamp(ts.get("from",row.get("start"))); b=stamp(ts.get("to",row.get("end")))
  text_value=str(row.get("text","")).strip()
  if not text_value: continue
  if a is None or b is None or b<=a: continue
  words=[]
  for token in row.get("tokens",[]) or []:
   tts=token.get("timestamps",{}) or {}
   wa=stamp(tts.get("from",token.get("start"))); wb=stamp(tts.get("to",token.get("end")))
   token_text=str(token.get("text","")).strip()
   if token_text and wa is not None and wb is not None and 0<=wa<wb:
    words.append({"start":wa,"end":wb,"word":token_text})
  segment={"start":a,"end":b,"text":text_value}
  if words: segment["words"]=words
  segments.append(segment)
 if not segments:
  raise RuntimeError("Whisper.cpp terminó sin segmentos de voz válidos; revisa el audio y el idioma.")
 return {"segments":segments,"language":(data.get("result",{}) or {}).get("language",language),"engine":"whisper.cpp","model":model_name}


def _transcribe_whisper_cpp(video:Path,model_name:str,language:str)->dict[str,Any]:
 """Cross-platform native Whisper fallback; Metal acceleration on Apple Silicon."""
 binary=shutil.which("whisper-cli") or shutil.which("whisper-cpp")
 if not binary and platform.system()=="Darwin" and shutil.which("brew"):
  install=subprocess.run([shutil.which("brew"),"install","whisper.cpp"],capture_output=True,text=True,timeout=900)
  binary=shutil.which("whisper-cli") or shutil.which("whisper-cpp")
  if not binary:
   raise RuntimeError("No se pudo instalar whisper.cpp con Homebrew: "+(install.stderr or install.stdout)[-1800:])
 if not binary:
  raise RuntimeError("No encuentro whisper-cli. En macOS con Homebrew: brew install whisper.cpp; en Linux instala whisper.cpp desde su paquete o código fuente.")
 model=_whisper_cpp_model_path(model_name)
 with tempfile.TemporaryDirectory(prefix="clipforge_whispercpp_") as td:
  folder=Path(td); audio=folder/"audio.wav"; out=folder/"transcript"
  run(["ffmpeg","-hide_banner","-loglevel","error","-y","-i",str(video),"-vn","-ac","1","-ar","16000","-c:a","pcm_s16le",str(audio)])
  cmd=[binary,"-m",str(model),"-f",str(audio),"-l",language,"-ojf","-ml","1","-of",str(out),"-t",str(max(2,min(os.cpu_count() or 4,8))),"-np"]
  proc=subprocess.run(cmd,capture_output=True,text=True,timeout=60*60)
  result_path=Path(str(out)+".json")
  if proc.returncode:
   raise RuntimeError("Whisper.cpp falló: "+(proc.stderr or proc.stdout)[-2500:])
  return _parse_whisper_cpp_json(result_path,language,model_name)


def transcribe(video:Path,model_name:str,language:str)->dict[str,Any]:
 """Prefer MLX on Apple Silicon, then Metal whisper.cpp; use portable engines elsewhere."""
 errors=[]
 if platform.system()=="Darwin" and platform.machine().lower() in {"arm64", "aarch64"}:
  try:return _transcribe_mlx_whisper(video,model_name,language)
  except Exception as exc:errors.append(f"MLX Whisper: {exc}")
 cpp_available=bool(shutil.which("whisper-cli") or shutil.which("whisper-cpp"))
 if platform.system()=="Darwin" and cpp_available:
  try:return _transcribe_whisper_cpp(video,model_name,language)
  except Exception as exc:errors.append(f"Whisper.cpp: {exc}")
 try:return _transcribe_faster_whisper(video,model_name,language)
 except Exception as exc:errors.append(f"Faster-Whisper: {exc}")
 if not (platform.system()=="Darwin" and cpp_available):
  try:return _transcribe_whisper_cpp(video,model_name,language)
  except Exception as exc:errors.append(f"Whisper.cpp alternativo: {exc}")
 if platform.system()=="Darwin" and language in {"es","en"} and (shutil.which("xcrun") or shutil.which("swiftc")):
  try:return transcribe_macos_native(video,language)
  except Exception as exc:errors.append(f"Apple Speech heredado: {exc}")
 try:
  import whisper
  model=whisper.load_model(model_name,device="cpu")
  return model.transcribe(str(video),language=language,verbose=False,word_timestamps=True,
                          fp16=False,condition_on_previous_text=False)
 except ImportError:
  pass
 except Exception as exc:errors.append(f"Whisper clásico: {exc}")
 raise RuntimeError("No se pudo completar la transcripción con los motores locales disponibles.\n"+"\n".join(errors))

def read_timed_transcript(path:Path)->list[dict[str,Any]]:
 """Read SRT or WebVTT cues as timed transcript segments (no speech recognition needed)."""
 raw=path.read_text(encoding="utf-8-sig",errors="replace").replace("\r\n","\n")
 blocks=re.split(r"\n\s*\n",raw.strip())
 stamp=r"(?P<a>(?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(?P<b>(?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{1,3})"
 def seconds(value:str)->float:
  hms=value.replace(",",".").split(":")
  if len(hms)==3: h,m,sec=hms
  elif len(hms)==2: h="0";m,sec=hms
  else: raise ValueError("timestamp inválido")
  return int(h)*3600+int(m)*60+float(sec)
 result=[]
 for block in blocks:
  lines=block.splitlines()
  if not lines: continue
  found=None
  for idx,line in enumerate(lines):
   found=re.search(stamp,line)
   if found:
    text=" ".join(re.sub(r"<[^>]+>","",x).strip() for x in lines[idx+1:] if x.strip())
    text=re.sub(r"\s+"," ",text).strip()
    speaker_match=re.match(r"^\s*(?:\[(?:speaker|hablante)\s*([\w-]+)\]|(?:speaker|hablante)\s*([\w-]+)\s*:|([A-ZÁÉÍÓÚÑ][\w -]{1,24})\s*:\s*)\s*",text,re.I)
    speaker_id=None
    if speaker_match:
     speaker_id=next((x for x in speaker_match.groups() if x),None)
     text=text[speaker_match.end():].strip()
    if text:
     try:
      a,b=seconds(found.group("a")),seconds(found.group("b"))
      if b>a:
       item={"start":a,"end":b,"text":text}
       if speaker_id:item["speaker_id"]=speaker_id
       result.append(item)
     except ValueError: pass
    break
 if result:
  joined=" ".join(str(item.get("text","")) for item in result).lower()
  placeholders=("[texto de prueba", "[test text", "placeholder transcript", "transcripción de prueba")
  if any(marker in joined for marker in placeholders):
   raise RuntimeError("El SRT contiene texto de prueba, no diálogo real. Elimina ese archivo y deja que ClipForge transcriba el audio.")
 return sorted(result,key=lambda x:x["start"])

def score_text(text:str,language:str)->float:
 """Explainable editorial heuristic. Never a prediction of virality."""
 low=re.sub(r"\s+"," ",text.lower()).strip(); words=re.findall(r"\w+",low)
 hooks=HOOK_WORDS.get(language,[])
 fillers=FILLERS.get(language,[])
 score=min(len(words)/24,2.0)
 score+=sum(1.15 for w in hooks if re.search(rf"(?<!\w){re.escape(w)}(?!\w)",low))
 score+=min(text.count("?")*.9,1.8)+min(text.count("!")*.6,1.2)
 score+=.7 if re.search(r"\b(pero|porque|entonces|sin embargo|but|because|however|so)\b",low) else 0
 score+=.45 if re.search(r"\b(yo|me|mi|nosotros|tú|tu|you|i|my|we)\b",low) else 0
 score+=.35 if re.search(r"\b(€|euros?|d[oó]lares?|por ciento|%|mill[oó]n|mil|million|thousand)\b",low) else 0
 score+=.35 if re.search(r"\b(primera vez|nunca|jam[aá]s|no sabía|no esperaba|first time|never|didn't know)\b",low) else 0
 score-=sum(.35 for w in fillers if re.search(rf"\b{re.escape(w)}\b",low))
 if len(words)<8: score-=1.5
 if len(words)>110: score-=1
 if re.search(r"[.!?…]\s*$",text.strip()): score+=.65
 if re.match(r"^(y|pero|porque|entonces|así que|and|but|because|so)\b",low): score-=.35
 if text.count(",")>=5: score-=.25
 return round(score,3)

def editorial_reasons(text:str,language:str)->list[str]:
 """Human-readable reasons behind a heuristic score; not semantic fact checking."""
 low=text.lower(); reasons=[]
 if re.search(r"[¿?]",text): reasons.append("pregunta o intriga")
 if re.search(r"[¡!]",text): reasons.append("énfasis expresivo")
 if re.search(r"\b(yo|me|mi|tú|tu|you|i|my)\b",low): reasons.append("experiencia personal")
 if re.search(r"\b(pero|porque|entonces|sin embargo|but|because|however)\b",low): reasons.append("contraste o explicación")
 if re.search(r"\b(€|euros?|d[oó]lares?|por ciento|%|mill[oó]n|mil|million|thousand)\b",low): reasons.append("dato cuantitativo")
 if re.search(r"[.!?…]\s*$",text.strip()): reasons.append("cierre de frase")
 return reasons or ["puntuación basada en longitud y estructura del texto"]

def _candidate_quality(text:str,language:str,duration:float,speech_ratio:float)->tuple[float,dict[str,float],list[str]]:
 """Score editorial structure and timing; transparent heuristics, not semantic AI."""
 low=re.sub(r"\s+"," ",text.lower()).strip(); words=re.findall(r"\w+",low)
 base=score_text(text,language)
 rate=len(words)/max(duration,1.0)
 # Penalise implausibly fast/slow transcript windows; keep broad bounds for natural speech.
 pace=0.0
 if rate>3.8: pace=-min(1.4,(rate-3.8)*0.45)
 elif 0.0<rate<0.75: pace=-min(1.0,(0.75-rate)*1.2)
 start_penalty=0.0; end_penalty=0.0
 if re.match(r"^(y|pero|porque|entonces|así que|o sea|and|but|because|so|which|that)\b",low): start_penalty+=0.85
 if re.search(r"\b(y|pero|porque|entonces|así que|de|con|para|que|and|but|because|with|to|which)\s*$",low): end_penalty+=0.9
 if text.strip() and text.strip()[0].islower(): start_penalty+=0.25
 if text.strip() and not re.search(r"[.!?…]\s*$",text.strip()): end_penalty+=0.3
 # A clear opening question/hook and a complete closing thought improve standalone usability.
 opening=0.55 if re.match(r"^(¿|¡|por qué|cómo|qué pasa|sabías que|imagina|what if|why|how|did you know)",low) else 0.0
 closure=0.45 if re.search(r"[.!?…][\"»’)]?\s*$",text.strip()) else 0.0
 filler_count=sum(len(re.findall(rf"(?<!\w){re.escape(w)}(?!\w)",low)) for w in FILLERS.get(language,[]))
 filler_penalty=min(1.2,filler_count*0.32)
 # Lightweight editorial signals: concrete numbers, emotional language, direct address and contrast.
 number_signal=bool(re.search(r"\b\d+(?:[.,]\d+)?\s?(?:%|euros?|d[oó]lares?|años?|meses?|d[ií]as?|horas?|millones?|mil|k|m)?\b",low))
 emotion_pattern=r"\b(incre[ií]ble|brutal|terrible|verg[uü]enza|orgullo|miedo|feliz|triste|rabia|llor[eé]|sorprend|impact|amazing|incredible|terrible|ashamed|proud|afraid|happy|sad|angry|cried|shocking|surprising)\w*\b"
 emotion_hits=len(re.findall(emotion_pattern,low))
 contrast=bool(re.search(r"\b(pero|sin embargo|aunque|en cambio|pensaba que|resulta que|instead|however|although|but|i thought|turns out)\b",low))
 direct_address=bool(re.search(r"\b(t[uú]|contigo|imagina|piensa|f[ií]jate|you|your|imagine|think about)\b",low))
 uniqueness=len(set(w for w in words if len(w)>3))/max(1,len(words))
 components={"base_editorial":base,"speech_pace":round(pace,3),"opening_hook":opening,"sentence_closure":closure,"abrupt_start_penalty":-round(start_penalty,3),"abrupt_end_penalty":-round(end_penalty,3),"filler_penalty":-filler_penalty,"speech_density":round(min(.35,max(0,speech_ratio-.55)*.7),3),
             "concrete_detail":.28 if number_signal else 0.0,"emotional_language":round(min(.55,emotion_hits*.18),3),"contrast_or_turn":.32 if contrast else 0.0,"direct_address":.18 if direct_address else 0.0,"lexical_variety":round(min(.25,max(0,uniqueness-.35)*.35),3)}
 total=sum(components.values())
 reasons=editorial_reasons(text,language)
 if opening: reasons.append("apertura directa")
 if closure: reasons.append("final cerrado")
 if pace<-.2: reasons.append("ritmo de habla poco natural según transcripción")
 if start_penalty: reasons.append("comienza con conector; posible frase cortada")
 if end_penalty: reasons.append("termina con conector; posible frase incompleta")
 if filler_penalty: reasons.append("muletillas detectadas")
 if number_signal: reasons.append("incluye una cifra o dato concreto")
 if emotion_hits: reasons.append("lenguaje emocional o reacción personal")
 if contrast: reasons.append("incluye contraste o cambio de perspectiva")
 if direct_address: reasons.append("interpela directamente a la audiencia")
 return round(total,3),components,list(dict.fromkeys(reasons))

def _context_boundary_quality(selected:list[dict[str,Any]], previous:dict[str,Any]|None, following:dict[str,Any]|None)->tuple[dict[str,float],list[str]]:
 """Estimate whether a transcript window begins/ends mid-thought using adjacent timed segments."""
 first=selected[0]["text"].strip(); last=selected[-1]["text"].strip()
 start_penalty=0.0; end_penalty=0.0; reasons=[]
 start_low=first.lower()
 continuation=r"^(y|pero|porque|entonces|así que|o sea|que|lo que|de hecho|and|but|because|so|which|that)\\b"
 if re.match(continuation,start_low):
  start_penalty+=0.45; reasons.append("inicio dependiente de la frase anterior")
 if first and first[0].islower():
  start_penalty+=0.35; reasons.append("inicio sin mayúscula; posible continuación")
 if previous:
  gap=float(selected[0]["start"])-float(previous["end"])
  prev_text=str(previous.get("text","")).strip()
  if 0<=gap<=1.25 and prev_text and not re.search(r"[.!?…][\\\"»’)]?\\s*$",prev_text):
   start_penalty+=0.5; reasons.append("la frase parece continuar desde el segmento anterior")
 if following:
  gap=float(following["start"])-float(selected[-1]["end"])
  if 0<=gap<=1.25 and last and not re.search(r"[.!?…][\\\"»’)]?\\s*$",last):
   end_penalty+=0.5; reasons.append("la idea parece continuar en el segmento siguiente")
 if re.search(r"\\b(y|pero|porque|entonces|así que|de|con|para|que|and|but|because|with|to|which)\\s*$",last.lower()):
  end_penalty+=0.45; reasons.append("final dependiente; posible frase cortada")
 return {"context_start_penalty":-round(min(1.1,start_penalty),3),"context_end_penalty":-round(min(1.0,end_penalty),3)},reasons

def _story_arc_quality(selected:list[dict[str,Any]], previous:dict[str,Any]|None, following:dict[str,Any]|None, language:str)->tuple[dict[str,float],list[str]]:
 """Score narrative signals in and around a candidate; lightweight, transparent, not semantic comprehension."""
 text=" ".join(x["text"] for x in selected).strip()
 before=str(previous.get("text","")) if previous else ""
 after=str(following.get("text","")) if following else ""
 low=text.lower(); context=(before+" "+text+" "+after).lower()
 patterns={
  "setup":r"\b(una vez|cuando era|hace años|al principio|todo empezó|un día|me acuerdo|recuerdo|once|when i was|years ago|at first|one day|i remember)\b",
  "conflict":r"\b(problema|error|fallo|discut|pelea|miedo|perdí|fracaso|imposible|nadie|contra|pero|sin embargo|problem|mistake|fight|afraid|lost|failure|impossible|nobody|against|however)\b",
  "reveal":r"\b(resulta que|la verdad|en realidad|descubrí|me di cuenta|no sabía|nadie sabe|el secreto|lo increíble|al final|de repente|turns out|the truth|actually|i discovered|realized|secret|in the end|suddenly)\b",
  "payoff":r"\b(por eso|así que|lo conseguí|conseguí resolver|resolverlo|resolví|funcionó|aprendí|cambió todo|valió la pena|esa fue|y entonces|that's why|so i|it worked|i learned|changed everything|worth it|that's how)\b",
  "stakes":r"\b(millones?|miles?|euros?|dólares?|años?|minutos?|segundos?|primera vez|nunca|jamás|millions?|thousands?|dollars?|years?|minutes?|seconds?|first time|never)\b"
 }
 weights={"setup":.28,"conflict":.48,"reveal":.72,"payoff":.62,"stakes":.28}
 components={}; reasons=[]
 for name,pattern in patterns.items():
  inside=bool(re.search(pattern,low)); surrounding=bool(re.search(pattern,context))
  value=weights[name]*(1.0 if inside else .35 if surrounding else 0.0)
  components["story_"+name]=round(value,3)
  if inside:
   reasons.append({"setup":"contexto de historia","conflict":"conflicto o tensión","reveal":"revelación o giro","payoff":"resolución o recompensa","stakes":"apuesta o dato concreto"}[name])
 # A clip containing both a question/problem and an answer/reveal has a stronger mini-arc.
 has_question=bool(re.search(r"[¿?]|\b(por qué|cómo|qué pasó|why|how|what happened)\b",low))
 has_answer=bool(re.search(patterns["reveal"]+"|"+patterns["payoff"],low))
 mini_arc=.42 if has_question and has_answer else 0.0
 components["story_mini_arc"]=mini_arc
 if mini_arc: reasons.append("planteamiento y recompensa dentro del mismo clip")
 # First-person storytelling and temporal cues make a clip feel like a concrete anecdote.
 personal=bool(re.search(r"\b(yo|me|mi|mío|nosotros|i|my|we|me)\b",low))
 temporal=bool(re.search(r"\b(antes|después|entonces|al día siguiente|años más tarde|before|after|then|the next day|years later)\b",context))
 narrative=.22 if personal and temporal else 0.0
 components["story_progression"]=narrative
 if narrative: reasons.append("progresión temporal de una experiencia")
 return components,reasons

def _narrative_completeness(selected:list[dict[str,Any]],language:str)->tuple[dict[str,float],list[str]]:
 """Reward self-contained story progression while avoiding hook-only fragments."""
 text=" ".join(str(x.get("text","")) for x in selected).lower()
 patterns=[
  ("setup",r"\b(una vez|cuando era|hace años|al principio|todo empezó|un día|recuerdo|when i was|years ago|at first|one day|i remember)\b"),
  ("tension",r"\b(problema|error|fallo|miedo|perdí|fracaso|pero|sin embargo|imposible|problem|mistake|afraid|lost|failure|but|however)\b"),
  ("turn",r"\b(resulta que|en realidad|descubrí|me di cuenta|la verdad|de repente|turns out|actually|i discovered|realized|the truth|suddenly)\b"),
  ("resolution",r"\b(por eso|lo conseguí|resolví|funcionó|aprendí|al final|cambió todo|that's why|it worked|i learned|in the end|changed everything)\b"),
 ]
 present=[name for name,pattern in patterns if re.search(pattern,text)]
 # A mini-story needs at least two distinct stages; a resolution is especially valuable.
 score=0.0; reasons=[]
 if len(present)>=2: score+=min(.48,(len(present)-1)*.16)
 if "resolution" in present and ("tension" in present or "turn" in present): score+=.24
 if "setup" in present and ("turn" in present or "resolution" in present): score+=.16
 if score:
  reasons.append("progresión narrativa interna: "+", ".join(present))
 # Avoid rewarding an opening hook that never develops into an answer.
 hook=bool(re.search(r"^(¿|por qué|cómo|qué pasa|sabías que|what if|why|how)",text.strip()))
 if hook and not any(x in present for x in ("turn","resolution")):
  score-=.18; reasons.append("gancho sin desarrollo o respuesta dentro del fragmento")
 return {"narrative_completeness":round(score,3)},reasons


def _build_story_profile(segments:list[dict[str,Any]],language:str)->dict[str,Any]:
 """Build whole-video themes, chapters and explainable long-range question/answer links."""
 clean=[]
 for index,item in enumerate(segments):
  try:
   a,b=float(item["start"]),float(item["end"]); text=str(item.get("text","")).strip()
   if b>a and text:
    item={"index":index,"start":a,"end":b,"text":text}
    if segments[index].get("speaker_id") is not None:item["speaker_id"]=str(segments[index]["speaker_id"])
    clean.append(item)
  except (KeyError,TypeError,ValueError): continue
 joined=" ".join(x["text"] for x in clean)
 words=re.findall(r"\w+",joined.lower())
 stop={"que","de","la","el","y","a","en","un","una","lo","me","mi","yo","es","se","por","con","no","the","and","to","of","i","it","is","in","that","you","we","my","this","was","are","pero","como","para","del","los","las","muy","más","una","uno","fue","era"}
 freq={}
 for word in words:
  if len(word)>=4 and word not in stop: freq[word]=freq.get(word,0)+1
 themes=[w for w,n in sorted(freq.items(),key=lambda kv:(-kv[1],kv[0]))[:8]]
 groups=[]
 if clean:
  total=max(x["end"] for x in clean)
  count=min(6,max(1,math.ceil(total/300)))
  for k in range(count):
   a=total*k/count;b=total*(k+1)/count
   group=[x for x in clean if x["start"]<b and x["end"]>a]
   if not group: continue
   txt=" ".join(x["text"] for x in group);low=txt.lower();signals={}
   chapter_words=[w for w in re.findall(r"\w+",low) if len(w)>=4 and w not in stop]
   chapter_freq={}
   for word in chapter_words: chapter_freq[word]=chapter_freq.get(word,0)+1
   chapter_themes=[w for w,n in sorted(chapter_freq.items(),key=lambda kv:(-kv[1],kv[0]))[:6]]
   chapter_bigrams={}
   for left,right in zip(chapter_words,chapter_words[1:]):
    phrase=left+" "+right
    chapter_bigrams[phrase]=chapter_bigrams.get(phrase,0)+1
   distinctive_phrases=[w for w,n in sorted(chapter_bigrams.items(),key=lambda kv:(-kv[1],kv[0])) if n>=2][:8]
   for name,pattern in {
    "setup":r"\b(una vez|cuando era|hace años|al principio|todo empezó|one day|when i was|at first)\b",
    "conflict":r"\b(problema|error|pelea|miedo|perdí|fracaso|problem|mistake|fight|afraid|lost|failure)\b",
    "reveal":r"\b(resulta que|la verdad|en realidad|descubrí|me di cuenta|el secreto|de repente|turns out|the truth|actually|discovered|secret|suddenly)\b",
    "payoff":r"\b(por eso|lo conseguí|resolví|funcionó|aprendí|cambió todo|al final|that's why|it worked|i learned|in the end)\b"
   }.items():
    if re.search(pattern,low):signals[name]=True
   groups.append({"start":round(a,2),"end":round(b,2),"text":txt[:1200],"signals":signals,
                  "themes":chapter_themes,"recurring_phrases":distinctive_phrases})
 # Link earlier questions to later answer/reveal segments using distinctive shared words.
 # This is a transparent lexical callback heuristic, not semantic reasoning.
 q_re=re.compile(r"[¿?]|\b(por qué|cómo|qué pasó|quién|cuándo|dónde|why|how|what happened|who|when|where)\b",re.I)
 a_re=re.compile(r"\b(resulta que|la verdad|en realidad|descubrí|me di cuenta|porque|por eso|la razón|la respuesta|turns out|the truth|actually|i discovered|because|the reason|the answer)\b",re.I)
 link_stop=stop|{"porque","resulta","verdad","respuesta","reason","answer","happened","thing","cosas","algo"}
 def terms(value:str)->set[str]:
  return {w for w in re.findall(r"\w+",value.lower()) if len(w)>=4 and w not in link_stop}
 questions=[]; answers=[]; links=[]
 for item in clean:
  if q_re.search(item["text"]): questions.append(item)
  if a_re.search(item["text"]): answers.append(item)
 for q in questions:
  qt=terms(q["text"])
  if not qt: continue
  best=None
  for ans in answers:
   if ans["start"]<=q["start"] or ans["start"]-q["end"]>900: continue
   overlap=qt&terms(ans["text"])
   ratio=len(overlap)/max(1,len(qt))
   if len(overlap)>=1 and (best is None or ratio>best[0]):
    best=(ratio,ans,sorted(overlap))
  if best:
   ratio,ans,shared=best
   links.append({"question_start":round(q["start"],2),"answer_start":round(ans["start"],2),
                 "question":q["text"][:240],"answer":ans["text"][:240],
                 "shared_terms":shared,"lexical_overlap":round(ratio,3)})
 arc=[]
 for name in ("setup","conflict","reveal","payoff"):
  if any(name in g["signals"] for g in groups): arc.append(name)
 speaker_counts={}
 for item in clean:
  if item.get("speaker_id") is not None:
   key=str(item["speaker_id"]);speaker_counts[key]=speaker_counts.get(key,0)+1
 return {"duration_seconds":round(max((x["end"] for x in clean),default=0),2),
         "segment_count":len(clean),"speakers":[{"id":key,"segments":value} for key,value in sorted(speaker_counts.items())],
         "speaker_detection_note":"Solo se muestran hablantes etiquetados explícitamente en la transcripción; no se infiere identidad ni diarización acústica.",
         "themes":themes,"chapters":groups,
         "arc_signals":arc,"question_answer_links":links,
         "coverage_note":"Análisis léxico determinista de la transcripción completa. Los enlaces pregunta-respuesta se basan en términos compartidos; no implican comprensión semántica ni identifican hablantes."}


def _editorial_index_100(raw_score:float)->float:
 """Map heuristic raw points to a readable 0–100 index; explicitly not a probability."""
 return round(100.0*(1.0-math.exp(-max(0.0,float(raw_score))/10.0)),1)

def detect_audio_silences(video:Path,noise_db:float=-36.0,min_duration:float=0.28)->list[dict[str,float]]:
 """Read silence intervals with FFmpeg; used only as a timing cue, not speaker detection."""
 command=["ffmpeg","-hide_banner","-nostats","-i",str(video),"-vn","-af",
          f"silencedetect=noise={noise_db}dB:d={min_duration}","-f","null","-"]
 proc=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 output=proc.stderr
 intervals=[]; pending=None
 for event in re.finditer(r"silence_(start|end):\s*(-?\d+(?:\.\d+)?)",output):
  kind,value=event.group(1),float(event.group(2))
  if kind=="start": pending=max(0.0,value)
  elif pending is not None and value>pending:
   intervals.append({"start":pending,"end":value});pending=None
 if pending is not None:
  probe=subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",str(video)],capture_output=True,text=True)
  try: duration=float(probe.stdout.strip())
  except ValueError: duration=pending
  if duration>pending:intervals.append({"start":pending,"end":duration})
 return intervals


def _audio_boundary_quality(start:float,end:float,silences:list[dict[str,float]])->tuple[float,dict[str,float],list[str]]:
 """Penalize clips that open/end in silence or contain long dead-air gaps."""
 start_silence=0.0;end_silence=0.0;internal=0.0
 for silence in silences:
  a=float(silence["start"]);b=float(silence["end"])
  overlap=max(0.0,min(end,b)-max(start,a))
  if overlap<=0:continue
  internal+=overlap
  if a<=start+.08 and b>start:start_silence=max(start_silence,min(end,b)-start)
  if a<end and b>=end-.08:end_silence=max(end_silence,end-max(start,a))
 penalty=min(1.0,start_silence*1.2)+min(.9,end_silence*1.1)+min(.8,max(0.0,internal-start_silence-end_silence)*.12)
 reasons=[]
 if start_silence>.18:reasons.append("el audio comienza con silencio")
 if end_silence>.18:reasons.append("el audio termina con silencio")
 if internal-start_silence-end_silence>1.0:reasons.append("pausa larga dentro del fragmento")
 return -round(penalty,3),{"audio_silence_penalty":-round(penalty,3),
                           "audio_start_silence":round(start_silence,3),
                           "audio_end_silence":round(end_silence,3),
                           "audio_internal_silence":round(max(0,internal-start_silence-end_silence),3)},reasons


def choose_windows(segments:list[dict[str,Any]],count:int,min_dur:float,max_dur:float,language:str,story_profile:dict[str,Any]|None=None,silence_regions:list[dict[str,float]]|None=None)->list[dict[str,Any]]:
 if not segments or count<1 or min_dur<=0 or max_dur<min_dur:return []
 clean=[]
 for seg in segments:
  try:
   a,b=float(seg["start"]),float(seg["end"]); text=str(seg.get("text"," ")).strip()
   if a>=0 and b>a and text:
    item={"start":a,"end":b,"text":text}
    if seg.get("speaker_id") is not None:item["speaker_id"]=str(seg["speaker_id"])
    clean.append(item)
  except (KeyError,TypeError,ValueError): continue
 clean.sort(key=lambda x:x["start"]); cand=[]
 for i in range(len(clean)):
  start=float(clean[i]["start"])
  for j in range(i,len(clean)):
   end=float(clean[j]["end"]); spoken_duration=end-start
   if spoken_duration>max_dur:break
   if spoken_duration<min_dur:continue
   selected=clean[i:j+1]; text=" ".join(x["text"] for x in selected).strip()
   if text:
    prev_end=float(clean[i-1]["end"]) if i else 0.0
    next_start=float(clean[j+1]["start"]) if j+1<len(clean) else end+.45
    s0=max(prev_end,start-.45,0.0);e0=min(next_start,end+.45)
    if e0-s0>max_dur+1.0:e0=end
    speech_duration=sum(max(0.0,float(x["end"])-float(x["start"])) for x in selected)
    speech_ratio=min(1.0,speech_duration/max(e0-s0,0.01))
    duration=e0-s0
    score,components,reasons=_candidate_quality(text,language,duration,speech_ratio)
    previous=clean[i-1] if i>0 else None
    following=clean[j+1] if j+1<len(clean) else None
    context_components,context_reasons=_context_boundary_quality(selected,previous,following)
    story_components,story_reasons=_story_arc_quality(selected,previous,following,language)
    completeness_components,completeness_reasons=_narrative_completeness(selected,language)
    story_components.update(completeness_components)
    story_reasons.extend(completeness_reasons)
    global_themes=set((story_profile or {}).get("themes",[]))
    candidate_terms=set(re.findall(r"\w+",text.lower()))
    theme_hits=global_themes & candidate_terms
    theme_component=round(min(.6,len(theme_hits)*.2),3)
    story_components["global_theme_relevance"]=theme_component
    if theme_hits: story_reasons.append("conexión con temas recurrentes del vídeo: "+", ".join(sorted(theme_hits)[:4]))
    midpoint=(s0+e0)/2
    chapter_matches=[]
    for chapter in (story_profile or {}).get("chapters",[]):
     if float(chapter.get("start",0))<=midpoint<=float(chapter.get("end",0)):
      chapter_vocab=set(chapter.get("themes",[]))
      phrase_hits=[phrase for phrase in chapter.get("recurring_phrases",[]) if phrase in text.lower()]
      overlap=chapter_vocab & candidate_terms
      chapter_matches.append((len(overlap),len(phrase_hits),overlap,phrase_hits))
    if chapter_matches:
     _,_,chapter_words,phrase_hits=max(chapter_matches,key=lambda x:(x[0]+2*x[1],x[0]))
     chapter_bonus=min(.8,.15*len(chapter_words)+.3*len(phrase_hits))
    else: chapter_words=set();phrase_hits=[];chapter_bonus=0
    story_components["chapter_theme_relevance"]=round(chapter_bonus,3)
    if chapter_words or phrase_hits:
     story_reasons.append("coherencia con el capítulo: "+", ".join(sorted(chapter_words)[:3]+phrase_hits[:2]))
    answer_links=[link for link in (story_profile or {}).get("question_answer_links",[])
                  if abs(float(link.get("answer_start", -999))-start)<=max_dur
                  and set(link.get("shared_terms",[])) & candidate_terms]
    callback_bonus=min(.75,.25*len(answer_links))
    story_components["long_range_callback"]=round(callback_bonus,3)
    if answer_links: story_reasons.append("responde o retoma una pregunta planteada anteriormente en el vídeo")
    speaker_sequence=[str(x.get("speaker_id")) for x in selected if x.get("speaker_id") is not None]
    distinct_speakers=set(speaker_sequence)
    speaker_switches=sum(1 for left,right in zip(speaker_sequence,speaker_sequence[1:]) if left!=right)
    dialogue_bonus=.28 if len(distinct_speakers)>=2 and len(distinct_speakers)<=3 else 0.0
    rapid_switch_penalty=.12*max(0,speaker_switches-5)
    story_components["explicit_dialogue_bonus"]=dialogue_bonus
    story_components["excessive_speaker_switch_penalty"]=-round(min(.6,rapid_switch_penalty),3)
    if dialogue_bonus:story_reasons.append("diálogo entre varios interlocutores etiquetados")
    components.update(context_components)
    components.update(story_components)
    score=round(score+sum(context_components.values())+sum(story_components.values()),3)
    reasons.extend(context_reasons)
    reasons.extend(story_reasons)
    # Prefer clips near the midpoint of the allowed duration range, without overwhelming content quality.
    target=(min_dur+max_dur)/2
    duration_penalty=min(.65,abs(duration-target)/max(max_dur-min_dur,1)*.65)
    score=round(score-duration_penalty,3)
    components["duration_fit_penalty"]=-round(duration_penalty,3)
    if duration_penalty>.35: reasons.append("duración alejada del objetivo")
    if silence_regions:
     audio_delta,audio_components,audio_reasons=_audio_boundary_quality(s0,e0,silence_regions)
     score=round(score+audio_delta,3);components.update(audio_components);reasons.extend(audio_reasons)
    before_text=str(previous.get("text","")).strip() if previous else ""
    after_text=str(following.get("text","")).strip() if following else ""
    phase=("inicio" if start<=max(60.0,(clean[-1]["end"] if clean else 0)*.15) else
           "final" if end>=(clean[-1]["end"] if clean else end)*.85 else "desarrollo")
    cand.append({"start":s0,"end":e0,"text":text,"score":score,
                 "editorial_index_100":_editorial_index_100(score),"duration":duration,
                 "story_phase":phase,"context_before":before_text,"context_after":after_text,
                 "speech_ratio":round(speech_ratio,3),"speakers":sorted({str(x.get("speaker_id")) for x in selected if x.get("speaker_id") is not None}),
                 "speaker_switches":speaker_switches,"reasons":reasons,"score_breakdown":components})
   if spoken_duration>=min_dur+12:break
 cand.sort(key=lambda x:(x["score"],len(x["text"])),reverse=True);chosen=[]
 for c in cand:
  if c["score"]<0 or c["duration"]<min_dur*.8:continue
  tokens=set(re.findall(r"\w+",c["text"].lower())); duplicate=False
  for picked in chosen:
   other=set(re.findall(r"\w+",picked["text"].lower())); union=tokens|other
   temporal_overlap=max(0.0,min(c["end"],picked["end"])-max(c["start"],picked["start"]))
   temporal_ratio=temporal_overlap/max(0.01,min(c["duration"],picked["duration"]))
   if len(tokens&other)/max(1,len(union))>=0.62 or temporal_ratio>=0.35:duplicate=True;break
  if duplicate:continue
  if all(c["end"]<=x["start"] or c["start"]>=x["end"] for x in chosen):
   chosen.append(c)
   if len(chosen)>=count:break
 return sorted(chosen,key=lambda x:x["start"])


def ollama_rerank_windows(candidates:list[dict[str,Any]],count:int,language:str)->list[dict[str,Any]]|None:
 """Optional fully-local semantic reranker. Returns None when Ollama/model is unavailable."""
 if len(candidates)<=count:return None
 base=os.getenv("CLIPFORGE_OLLAMA_URL","http://127.0.0.1:11434").rstrip("/")
 model=os.getenv("CLIPFORGE_OLLAMA_MODEL","qwen2.5:3b")
 try:
  with urllib.request.urlopen(base+"/api/tags",timeout=1.2) as response:
   tags=json.loads(response.read().decode("utf-8"))
  installed={str(x.get("name", "")) for x in tags.get("models",[]) if isinstance(x,dict)}
  if model not in installed and not any(name.split(":")[0]==model.split(":")[0] for name in installed):
   return None
  items=[]
  for index,item in enumerate(candidates):
   items.append({"id":index,"duration_seconds":round(float(item.get("duration",0)),1),
     "text":str(item.get("text",""))[:1200],"context_before":str(item.get("context_before",""))[:240],
     "context_after":str(item.get("context_after",""))[:240],"story_phase":item.get("story_phase")})
  language_name={"es":"español","en":"inglés","fr":"francés","de":"alemán","pt":"portugués","it":"italiano","ja":"japonés","zh":"chino","ar":"árabe","ru":"ruso","hi":"hindi","ko":"coreano","nl":"neerlandés","pl":"polaco","tr":"turco","uk":"ucraniano","sv":"sueco","da":"danés","no":"noruego","fi":"finés","el":"griego","cs":"checo","ro":"rumano","hu":"húngaro","id":"indonesio","vi":"vietnamita","th":"tailandés","he":"hebreo"}.get(language,language)
  prompt=("Eres editor de vídeos cortos. Selecciona los mejores fragmentos para Shorts/Reels/TikTok. "
    f"Evalúa en {language_name}: gancho inicial, claridad sin contexto externo, idea completa, emoción/humor/sorpresa, "
    "pregunta-respuesta, valor y cierre. Penaliza frases cortadas, contexto dependiente, repeticiones y pausas. "
    f"Elige exactamente {count} IDs distintos. No inventes timestamps ni cambies el texto. "
    "Devuelve SOLO JSON con esta forma: {\"selected\":[{\"id\":0,\"reason\":\"motivo breve\"}]}. "
    "Candidatos: "+json.dumps(items,ensure_ascii=False))
  body=json.dumps({"model":model,"stream":False,"format":"json","options":{"temperature":0.1},
                   "messages":[{"role":"user","content":prompt}]}).encode("utf-8")
  request=urllib.request.Request(base+"/api/chat",data=body,headers={"Content-Type":"application/json"},method="POST")
  with urllib.request.urlopen(request,timeout=90) as response:
   payload=json.loads(response.read().decode("utf-8"))
  content=payload.get("message",{}).get("content","")
  parsed=json.loads(content)
  selected=[]; seen=set()
  for item in parsed.get("selected",[]):
   if not isinstance(item,dict):continue
   try:index=int(item.get("id"))
   except (TypeError,ValueError):continue
   if index<0 or index>=len(candidates) or index in seen:continue
   candidate=dict(candidates[index]); candidate["ai_editorial_reason"]=str(item.get("reason", ""))[:240]
   candidate["ai_editorial_rank"]=len(selected)+1
   selected.append(candidate);seen.add(index)
   if len(selected)>=count:break
  if len(selected)!=count:return None
  return selected
 except (OSError,TimeoutError,ValueError,KeyError,TypeError,urllib.error.URLError):
  return None


def split_caption_text(text:str,max_chars:int=38,max_words:int=7)->list[str]:
 """Split transcript text into short readable caption cards without breaking words."""
 words=re.findall(r"\S+", re.sub(r"\s+"," ",text).strip())
 lines=[]; current=[]
 for word in words:
  candidate=" ".join(current+[word])
  if current and (len(candidate)>max_chars or len(current)>=max_words):
   lines.append(" ".join(current)); current=[word]
  else: current.append(word)
 if current: lines.append(" ".join(current))
 return lines

def write_srt(segments:list[dict[str,Any]],start:float,end:float,path:Path)->None:
 """Write phrase-level captions without fabricating word/chunk timestamps."""
 entries=[]
 for seg in segments:
  try: seg_start,seg_end=float(seg["start"]),float(seg["end"])
  except (KeyError,TypeError,ValueError): continue
  a=max(seg_start,start); b=min(seg_end,end)
  if b<=a: continue
  txt=re.sub(r"\s+"," ",str(seg.get("text","")).strip())
  if not txt: continue
  # Wrap for mobile readability, but retain the original phrase timing exactly.
  words=txt.split(); rows=[]; row=""
  for word in words:
   candidate=(row+" "+word).strip()
   if len(candidate)>42 and row:
    rows.append(row); row=word
   else: row=candidate
  if row: rows.append(row)
  # Limit visual height; do not split a phrase into invented timed fragments.
  if len(rows)>2: rows=[rows[0], " ".join(rows[1:])]
  entries.append((a,b,"\n".join(rows)))
 lines=[]
 for idx,(a,b,txt) in enumerate(sorted(entries),1):
  lines += [str(idx),f"{fmt_srt_time(a-start)} --> {fmt_srt_time(b-start)}",txt,""]
 path.write_text("\n".join(lines),encoding="utf-8")

def srt_to_ass(srt:Path,ass:Path)->None:
 """Convert basic SRT to styled ASS captions using FFmpeg's subtitle converter."""
 run(["ffmpeg","-y","-i",str(srt),str(ass)])


def ass_time(seconds:float)->str:
 cs=max(0,int(round(seconds*100))); h,cs=divmod(cs,360000); m,cs=divmod(cs,6000); sec,cs=divmod(cs,100)
 return f"{h}:{m:02}:{sec:02}.{cs:02}"

def ass_escape(text:str)->str:
 return text.replace("\\","\\\\").replace("{","\\{").replace("}","\\}").replace("\n"," ")

def write_karaoke_ass(segments:list[dict[str,Any]],start:float,end:float,path:Path)->bool:
 """Create word-timed karaoke captions when Whisper supplies word timestamps."""
 words=[]
 for seg in segments:
  for word in seg.get("words",[]) or []:
   try:
    a=max(start,float(word["start"])); b=min(end,float(word["end"]))
    token=str(word.get("word","")).strip()
    if token and b>a: words.append((a,b,token))
   except (KeyError,TypeError,ValueError): continue
 words.sort(key=lambda x:x[0])
 if not words:return False
 header="""[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,62,&H00FFFFFF,&H0000D7FF,&H00101010,&H80000000,1,0,0,0,100,100,0,0,1,5,2,2,48,48,420,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
 lines=[header]
 # Keep short phrases on screen and align every word to Whisper timestamps.
 for i in range(0,len(words),6):
  group=words[i:i+6]
  phrase_start=group[0][0]; phrase_end=group[-1][1]
  if phrase_end<=phrase_start:continue
  parts=[]
  for a,b,token in group:
   centis=max(1,int(round((b-a)*100)))
   clean=ass_escape(token)
   emphasis=bool(re.search(r"(?i)^(incre[ií]ble|nunca|siempre|error|secreto|dinero|mill[oó]n|imposible|brutal|never|secret|money|million|mistake|incredible)[,!.?]*$",token))
   pop=r"\fscx88\fscy88\t(0,110,\fscx108\fscy108)"
   color=r"\c&H0000D7FF&" if emphasis else ""
   parts.append("{"+r"\kf"+str(centis)+pop+color+"}"+clean+r"{\rDefault}")
  text=" ".join(parts)
  lines.append(f"Dialogue: 0,{ass_time(phrase_start-start)},{ass_time(phrase_end-start)},Default,,0,0,0,,{text}\n")
 path.write_text("".join(lines),encoding="utf-8")
 return True

def make_review_html(windows:list[dict[str,Any]],folder:Path)->None:
 cards=[]
 for i,w in enumerate(windows,1):
  breakdown=w.get("score_breakdown",{})
  details="".join(f"<li><span>{html.escape(k.replace('_',' '))}</span><b>{v:+.2f}</b></li>" for k,v in sorted(breakdown.items(),key=lambda item:abs(item[1]),reverse=True) if abs(float(v))>=0.01)
  before=html.escape(w.get("context_before","")) or "No hay segmento anterior disponible"
  after=html.escape(w.get("context_after","")) or "No hay segmento posterior disponible"
  index=float(w.get("editorial_index_100",_editorial_index_100(w["score"])))
  ai_reason=("<p><b>Selección IA local:</b> "+html.escape(w.get("ai_editorial_reason",""))+"</p>") if w.get("ai_editorial_reason") else ""
  speaker_note=(" · Hablantes etiquetados: "+", ".join(html.escape(x) for x in w.get("speakers",[]))) if w.get("speakers") else ""
  cards.append(f"<article><h2>Clip {i:02} · Índice editorial {index:.1f}/100</h2><p>{w['start']:.1f}s–{w['end']:.1f}s · {w['duration']:.1f}s · {html.escape(w.get('story_phase',''))}{speaker_note}</p><p>{html.escape(w['text'])}</p>{ai_reason}<details><summary>Contexto anterior y posterior</summary><p><b>Antes:</b> {before}</p><p><b>Después:</b> {after}</p></details><p><small>Señales detectadas: {html.escape(', '.join(w.get('reasons', []))) or 'Sin señales destacadas'}</small></p><details><summary>Desglose de puntuación</summary><ul>{details}</ul></details><video controls preload='metadata' src='clip_{i:02}.mp4'></video><p><a href='clip_{i:02}.srt'>Descargar subtítulos SRT</a></p></article>")
 profile_html=""
 try:
  profile=json.loads((folder/"story_profile.json").read_text(encoding="utf-8"))
  themes=", ".join(profile.get("themes",[])) or "No se detectaron temas frecuentes"
  arc=", ".join(profile.get("arc_signals",[])) or "No se detectó una secuencia narrativa clara"
  speaker_list=", ".join(x.get("id","") for x in profile.get("speakers",[])) or "Sin etiquetas explícitas de hablante"
  links=profile.get("question_answer_links",[])
  link_html="".join(f"<li><b>{html.escape(x.get('question',''))}</b><br>↳ {html.escape(x.get('answer',''))}<br><small>Términos compartidos: {html.escape(', '.join(x.get('shared_terms',[])))}</small></li>" for x in links[:8])
  profile_html=f"<section><h2>Panorama de la conversación</h2><p><b>Temas recurrentes:</b> {html.escape(themes)}</p><p><b>Señales narrativas globales:</b> {html.escape(arc)}</p><p><b>Hablantes:</b> {html.escape(speaker_list)}</p><details><summary>Preguntas y respuestas relacionadas en distintos momentos ({len(links)})</summary><ul>{link_html or '<li>No se han encontrado conexiones léxicas suficientemente claras.</li>'}</ul></details><p><small>{html.escape(profile.get('coverage_note',''))}</small></p></section>"
 except Exception: pass
 page="<!doctype html><html lang='es'><meta charset='utf-8'><meta name='viewport' content='width=device-width'><title>ClipForge Review</title><style>body{font:16px system-ui;max-width:900px;margin:2rem auto;padding:0 1rem;background:#10131a;color:#eee}article{padding:1rem;margin:1rem 0;background:#1b2230;border-radius:14px}video{width:min(100%,320px);background:#000}a{color:#70d7ff}details{margin:.7rem 0}li{display:flex;justify-content:space-between;gap:1rem;padding:.2rem 0;color:#cbd5e1}</style><h1>ClipForge · Revisión editorial</h1><p>El índice 0–100 es una heurística editorial, no una probabilidad ni una predicción de viralidad. Comprueba el contexto completo, los derechos, los subtítulos y la calidad antes de publicar.</p>"+profile_html+"".join(cards)+"</html>"
 (folder/"review.html").write_text(page,encoding="utf-8")


def ffprobe_dimensions(video:Path)->tuple[int,int]:
 p=subprocess.run(["ffprobe","-v","error","-select_streams","v:0","-show_entries","stream=width,height","-of","json",str(video)],capture_output=True,text=True)
 if p.returncode: raise RuntimeError("No se pudieron leer las dimensiones del vídeo.")
 data=json.loads(p.stdout); stream=(data.get("streams") or [{}])[0]
 return int(stream.get("width",0)),int(stream.get("height",0))

def _choose_active_face(candidates:list[dict[str,float]],previous_cx:float|None,source_w:float)->dict[str,float]|None:
 """Choose a likely active face from visual mouth motion, size and temporal continuity."""
 if not candidates:return None
 ranked=[]
 for face in candidates:
  cx=float(face["cx"]); area=max(1.0,float(face.get("area",1.0)))
  motion=max(0.0,float(face.get("mouth_motion",0.0)))
  continuity=abs(cx-previous_cx)/max(source_w,1.0) if previous_cx is not None else 0.0
  # Motion is a weak cue; size and continuity stabilize fallback.
  score=(0.55*min(1.0,motion/18.0)+0.25*min(1.0,(area**0.5)/180.0)+0.20/(1.0+5.0*continuity))
  ranked.append((score,face))
 ranked.sort(key=lambda x:x[0],reverse=True)
 best_score,best=ranked[0]
 # Hysteresis: keep the current track unless another face wins clearly.
 if previous_cx is not None:
  current=min(ranked,key=lambda item:abs(float(item[1]["cx"])-previous_cx))
  if abs(float(current[1]["cx"])-previous_cx)<=source_w*.12 and current[0]>=best_score-.14:
   return current[1]
 return best


def _scene_change_detected(mean_difference:float,threshold:float=24.0)->bool:
 """Conservative hard-cut detector from mean grayscale frame difference."""
 try: value=float(mean_difference)
 except (TypeError,ValueError): return False
 return math.isfinite(value) and value>=threshold


def _multi_face_dialogue(face_counts:list[int], minimum_frames:int=2, ratio:float=0.25)->bool:
 """Return true when simultaneous faces make a single-person vertical crop risky."""
 if not face_counts:return False
 multi=sum(1 for count in face_counts if int(count)>=2)
 return multi>=minimum_frames and multi/max(1,len(face_counts))>=ratio


def has_multi_face_dialogue(video:Path,start:float,duration:float)->bool:
 """Sample a clip for repeated simultaneous faces; use full-frame layout for dialogue shots."""
 try: import cv2
 except ImportError:return False
 try:
  detector=cv2.CascadeClassifier(str(Path(cv2.data.haarcascades)/"haarcascade_frontalface_default.xml"))
  cap=cv2.VideoCapture(str(video))
  if detector.empty() or not cap.isOpened():
   cap.release();return False
  fps=float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
  if not math.isfinite(fps) or fps<=0:fps=25.0
  sample_count=max(2,min(12,int(duration/1.0)+1))
  counts=[]
  for index in range(sample_count):
   timestamp=start+(duration*index/max(1,sample_count-1))
   cap.set(cv2.CAP_PROP_POS_MSEC,timestamp*1000)
   ok,frame=cap.read()
   if not ok:continue
   h,w=frame.shape[:2];factor=min(1.0,640.0/w)
   small=cv2.resize(frame,(max(1,int(w*factor)),max(1,int(h*factor))))
   gray=cv2.cvtColor(small,cv2.COLOR_BGR2GRAY)
   faces=detector.detectMultiScale(gray,scaleFactor=1.10,minNeighbors=4,minSize=(32,32))
   counts.append(len(faces))
  cap.release()
  return _multi_face_dialogue(counts)
 except Exception:
  return False


def face_crop_expression(video:Path,start:float,duration:float,target_w:int,target_h:int)->str|None:
 """Track a likely active face using weak mouth-motion cues, size and continuity; not audio diarization."""
 try: import cv2
 except ImportError: return None
 source_w,source_h=ffprobe_dimensions(video)
 if not source_w or not source_h:return None
 crop_w=min(source_w,int(round(source_h*target_w/target_h)))
 if crop_w>=source_w:return None
 detector=cv2.CascadeClassifier(str(Path(cv2.data.haarcascades)/"haarcascade_frontalface_default.xml"))
 if detector.empty():return None
 cap=cv2.VideoCapture(str(video))
 if not cap.isOpened():return None
 samples=[]; previous_cx=None; previous_mouth={}; previous_gray=None
 fps=float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
 if not math.isfinite(fps) or fps<=0:fps=25.0
 frame_step=max(1,int(round(fps*.30)))
 cap.set(cv2.CAP_PROP_POS_MSEC,start*1000)
 frame_index=0
 while frame_index/fps<duration:
  ok,frame=cap.read()
  if not ok:break
  t=frame_index/fps
  frame_index+=1
  if int(round(t*fps))%frame_step:continue
  h,w=frame.shape[:2]; factor=min(1.0,640.0/w)
  small=cv2.resize(frame,(max(1,int(w*factor)),max(1,int(h*factor))))
  gray=cv2.cvtColor(small,cv2.COLOR_BGR2GRAY)
  if previous_gray is not None:
   scene_delta=float(cv2.absdiff(gray,previous_gray).mean())
   if _scene_change_detected(scene_delta):
    # Do not let face identity/position continuity leak across a hard edit.
    previous_cx=None; previous_mouth={}
  previous_gray=gray
  faces=detector.detectMultiScale(gray,scaleFactor=1.10,minNeighbors=4,minSize=(32,32))
  if len(faces):
   candidates=[]
   current_mouth={}
   for x,y,fw,fh in faces:
    cx=(x+fw/2)/factor; area=(fw*fh)/(factor*factor)
    # The lower-face patch approximates mouth activity; it is only a visual cue.
    mx=max(0,int(x+fw*.18)); my=max(0,int(y+fh*.55))
    mw=max(1,min(gray.shape[1]-mx,int(fw*.64))); mh=max(1,min(gray.shape[0]-my,int(fh*.30)))
    patch=cv2.resize(gray[my:my+mh,mx:mx+mw],(32,16))
    previous_key=min(previous_mouth,key=lambda key:abs(key-cx)) if previous_mouth else None
    motion=0.0
    if previous_key is not None and abs(previous_key-cx)<source_w*.18:
     motion=float(cv2.absdiff(patch,previous_mouth[previous_key]).mean())
    current_mouth[cx]=patch
    candidates.append({"cx":cx,"area":area,"mouth_motion":motion})
   chosen=_choose_active_face(candidates,previous_cx,source_w)
   previous_mouth=current_mouth
   cx=float(chosen["cx"])
   previous_cx=cx
   samples.append((t,max(0,min(source_w-crop_w,cx-crop_w/2))))
  else:
   previous_mouth={}
 cap.release()
 if not samples:return None
 # Fill short detection gaps by interpolation; longer gaps hold the last known position.
 filled=[]
 for tm,x in samples:
  if filled and tm-filled[-1][0]>0.31:
   prev_t,prev_x=filled[-1]
   gap=tm-prev_t
   if gap<=1.5:
    steps=max(1,int(gap/0.30))
    for k in range(1,steps):
     alpha=k/steps
     filled.append((prev_t+gap*alpha,prev_x+(x-prev_x)*alpha))
  filled.append((tm,x))
 samples=filled
 if samples[0][0]>0:samples.insert(0,(0,samples[0][1]))
 if samples[-1][0]<duration:samples.append((duration,samples[-1][1]))
 smooth=[]
 for i,(tm,x) in enumerate(samples):
  near=[v for _,v in samples[max(0,i-2):min(len(samples),i+3)]]
  smooth.append((tm,sum(near)/len(near)))
 # Limit horizontal camera speed to avoid distracting snap movements.
 bounded=[smooth[0]]
 for tm,x in smooth[1:]:
  pt,px=bounded[-1]; limit=source_w*0.65*max(0.0,tm-pt)
  bounded.append((tm,max(px-limit,min(px+limit,x))))
 smooth=bounded
 expr=f"{smooth[-1][1]:.1f}"
 for i in range(len(smooth)-2,-1,-1):
  t0,x0=smooth[i];t1,x1=smooth[i+1]
  if t1>t0:
   expr=f"if(lt(t,{t1:.3f}),({x0:.1f}+({x1-x0:.1f})*(t-{t0:.3f})/{t1-t0:.3f}),{expr})"
 return expr

def render_clip(video:Path,w:dict[str,Any],idx:int,segments:list[dict[str,Any]],outdir:Path,args:argparse.Namespace)->None:
 start,end=float(w["start"]),float(w["end"]);duration=end-start
 width,height=map(int,args.resolution.split("x"))
 srt=outdir/f"clip_{idx:02}.srt";write_srt(segments,start,end,srt)
 source_w,source_h=ffprobe_dimensions(video);crop_mode=getattr(args,"crop","face");vf=""
 if crop_mode=="face":
  if has_multi_face_dialogue(video,start,duration):
   crop_mode="blur";print(f"  clip_{idx:02}: varias caras simultáneas; se conserva el plano completo")
  else:
   xexpr=face_crop_expression(video,start,duration,width,height)
   crop_w=min(source_w,int(round(source_h*width/height)))
   if xexpr:
    vf=f"crop={crop_w}:{source_h}:{xexpr.replace(chr(44), chr(92)+chr(44))}:0,scale={width}:{height}:flags=lanczos"
    print(f"  clip_{idx:02}: seguimiento facial activado")
   else:
    crop_mode="blur";print(f"  clip_{idx:02}: tracking ambiguo; se conserva el plano completo")
 if not vf and crop_mode=="blur":
  vf=(f"split=2[bg][fg];[bg]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},boxblur=20[bg];"
      f"[fg]scale={width}:{height}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2")
 elif not vf:
  vf=f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1"
 if args.burn_captions:
  ass=outdir/f"clip_{idx:02}.ass"
  if not write_karaoke_ass(segments,start,end,ass):
   # Never fabricate word timing; phrase-level captions stay static.
   srt_to_ass(srt,ass)
  vf+=f",ass={ass.as_posix().replace(':',r'\:')}"
 mp4=outdir/f"clip_{idx:02}.mp4"
 audio_filter=["-af","loudnorm=I=-16:TP=-1.5:LRA=11"] if getattr(args,"normalize_audio",True) else []
 run(["ffmpeg","-y","-ss",f"{start:.3f}","-i",str(video),"-t",f"{duration:.3f}","-map","0:v:0","-map","0:a:0","-vf",vf,
      "-r",str(getattr(args,"fps",30)),"-c:v","libx264","-preset",getattr(args,"preset","veryfast"),"-crf",str(getattr(args,"crf",18)),
      *audio_filter,"-c:a","aac","-b:a",getattr(args,"audio_bitrate","192k"),"-ar","48000","-movflags","+faststart",str(mp4)])

def audit_mp4(path:Path, expected_width:int, expected_height:int, min_duration:float=1.0)->dict[str,Any]:
 """Verify that an encoded clip is readable, correctly sized and has audio."""
 ffprobe=shutil.which("ffprobe")
 if not ffprobe:
  raise RuntimeError("No se encuentra ffprobe; instala FFmpeg completo para auditar los MP4.")
 p=subprocess.run([ffprobe,"-v","error","-show_streams","-show_format","-of","json",str(path)],capture_output=True,text=True)
 if p.returncode:
  raise RuntimeError(f"ffprobe no puede leer {path.name}: {p.stderr[-1200:]}")
 data=json.loads(p.stdout); streams=data.get("streams",[])
 video=next((x for x in streams if x.get("codec_type")=="video"),None)
 audio=next((x for x in streams if x.get("codec_type")=="audio"),None)
 duration=float(data.get("format",{}).get("duration",0) or 0)
 checks={
  "video_stream": video is not None,
  "audio_stream": audio is not None,
  "dimensions": bool(video and int(video.get("width",0))==expected_width and int(video.get("height",0))==expected_height),
  "duration": duration>=min_duration,
  "file_size": path.is_file() and path.stat().st_size>1024,
 }
 return {"file":path.name,"ok":all(checks.values()),"duration_seconds":round(duration,3),
         "width":int(video.get("width",0)) if video else None,
         "height":int(video.get("height",0)) if video else None,
         "video_codec":video.get("codec_name") if video else None,
         "audio_codec":audio.get("codec_name") if audio else None,"checks":checks}

def process(video:Path,args:argparse.Namespace)->Path:
 if not video.is_file():raise FileNotFoundError(video)
 width,height=map(int,args.resolution.split("x"))
 outdir=args.output/video.stem;outdir.mkdir(parents=True,exist_ok=True)
 if getattr(args,"transcript",None):
  print(f"Leyendo transcripción con tiempos: {args.transcript.name}")
  segments=read_timed_transcript(args.transcript)
  if not segments: raise RuntimeError("La transcripción no contiene segmentos SRT/VTT válidos con marcas de tiempo.")
 else:
  print(f"Transcribiendo: {video.name}")
  result=transcribe(video,args.model,args.language);segments=result.get("segments",[])
 diarization_report={"status":"not_requested","engine":None,"speaker_count":0,"speakers":[]}
 if getattr(args,"diarize",False):
  print("Identificando turnos de voz con diarización acústica…")
  from diarization import diarize_video
  diarization_report=diarize_video(video,segments)
 story_profile=_build_story_profile(segments,args.language)
 if diarization_report.get("status")=="completed":
  story_profile["speakers"] = diarization_report["speakers"]
  story_profile["speaker_detection_note"] = "Diarización acústica anónima mediante pyannote.audio; las etiquetas speaker_N no identifican personas."
  (outdir/"diarization.json").write_text(json.dumps(diarization_report,ensure_ascii=False,indent=2),encoding="utf-8")
 try:
  silence_regions=detect_audio_silences(video)
  story_profile["audio_silence_intervals"]=len(silence_regions)
 except Exception:
  silence_regions=[]
  story_profile["audio_silence_intervals"]=None
 if getattr(args,"ranges_json",None):
  try: windows=json.loads(Path(args.ranges_json).read_text(encoding="utf-8"))
  except Exception as exc: raise RuntimeError(f"No se pudieron leer los cortes manuales: {exc}")
  if not isinstance(windows,list) or not windows: raise RuntimeError("La lista de cortes manuales está vacía o no es válida.")
  if len(windows)>10: raise RuntimeError("Se permiten como máximo 10 cortes manuales por trabajo.")
  probe=subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",str(video)],capture_output=True,text=True)
  if probe.returncode: raise RuntimeError("No se pudo validar la duración del vídeo.")
  duration=float(probe.stdout.strip())
  for item in windows:
   a=float(item["start"]); b=float(item["end"])
   if not math.isfinite(a) or not math.isfinite(b) or a<0 or b<=a or b>duration or b-a>180: raise RuntimeError("Hay un corte manual fuera de los límites del vídeo.")
   # The browser may omit derived metadata; normalize it before review/export.
   item["start"]=a; item["end"]=b
   item.setdefault("duration",b-a)
   item.setdefault("score",0.0); item.setdefault("text","")
  selection_mode="manual_browser_edit_decision_list"
 else:
  candidate_pool=choose_windows(segments,min(30,max(args.clips,args.clips*3)),args.min_seconds,args.max_seconds,args.language,story_profile,silence_regions)
  if not candidate_pool:raise RuntimeError(f"No hay suficientes candidatos en {video.name}")
  ai_selected=ollama_rerank_windows(candidate_pool,args.clips,args.language)
  windows=ai_selected if ai_selected else candidate_pool[:args.clips]
  selection_mode="ollama_local_semantic_rerank" if ai_selected else "contextual_heuristics_fallback"
 (outdir/"story_profile.json").write_text(json.dumps(story_profile,ensure_ascii=False,indent=2),encoding="utf-8")
 (outdir/"selection.json").write_text(json.dumps(windows,ensure_ascii=False,indent=2),encoding="utf-8")
 audits=[]
 for idx,w in enumerate(windows,1):
  render_clip(video,w,idx,segments,outdir,args)
  audit=audit_mp4(outdir/f"clip_{idx:02}.mp4",width,height)
  audits.append(audit)
  if not audit["ok"]:raise RuntimeError(f"Auditoría fallida en clip_{idx:02}.mp4: {audit['checks']}")
  print(f"  clip_{idx:02}.mp4 · {w['score']:.2f} · verificado")
 (outdir/"quality_report.json").write_text(json.dumps(audits,ensure_ascii=False,indent=2),encoding="utf-8")
 make_review_html(windows,outdir)
 manifest={"source_file":video.name,"rights_confirmed_by_operator":True,"language":args.language,
           "model":args.model,"render_settings":{"resolution":args.resolution,"crop":args.crop,"fps":getattr(args,"fps",30),"crf":getattr(args,"crf",23),"audio_bitrate":getattr(args,"audio_bitrate","160k"),"preset":getattr(args,"preset","veryfast"),"normalize_audio":getattr(args,"normalize_audio",True),"burn_captions":getattr(args,"burn_captions",False)},"quality_report":"quality_report.json","story_profile":"story_profile.json","speaker_labels_available":bool(story_profile.get("speakers")),"diarization":diarization_report,"selection_method":selection_mode,"selection_note":"Ollama local solo se usa si el servidor y el modelo configurado están instalados; si no, se usa puntuación editorial heurística contextual. Ninguna puntuación predice viralidad ni retención real.","clips":[{"file":f"clip_{i:02}.mp4","editorial_potential_score":w.get("editorial_index_100",_editorial_index_100(w["score"])),"raw_heuristic_points":w["score"],"score_type":"índice heurístico 0–100; no es probabilidad de viralidad","start":w["start"],"end":w["end"],"text":w["text"],"story_phase":w.get("story_phase"),"context_before":w.get("context_before",""),"context_after":w.get("context_after","") ,"ai_editorial_reason":w.get("ai_editorial_reason"),"ai_editorial_rank":w.get("ai_editorial_rank")} for i,w in enumerate(windows,1)]}
 (outdir/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
 return outdir

def main()->None:
 ap=argparse.ArgumentParser(description="Clipping local de vídeos para los que tienes autorización.")
 ap.add_argument("input",type=Path,help="Archivo de vídeo o carpeta con vídeos")
 ap.add_argument("--rights-confirmed",action="store_true",help="Confirma que tienes permiso/licencia para editar y publicar este contenido")
 ap.add_argument("--clips",type=int,default=5);ap.add_argument("--language",choices=sorted(SUPPORTED_LANGUAGES),default="es")
 ap.add_argument("--model",choices=["tiny","base","small","medium","large-v3-turbo"],default="small")
 ap.add_argument("--min-seconds",type=float,default=25);ap.add_argument("--max-seconds",type=float,default=45)
 ap.add_argument("--output",type=Path,default=Path("output"))
 ap.add_argument("--transcript",type=Path,default=None,help="Transcripción SRT/VTT con marcas de tiempo; evita Whisper")
 ap.add_argument("--diarize",action="store_true",help="Diarización acústica anónima con pyannote; requiere HF_TOKEN y acceso al modelo")
 ap.add_argument("--ranges-json",type=Path,default=None,help="Lista JSON de cortes manuales editados desde el navegador")
 ap.add_argument("--resolution",choices=["720x1280","1080x1920"],default="1080x1920")
 ap.add_argument("--crop",choices=["center","blur","face"],default="face",help="Seguimiento facial opcional; si falta OpenCV, recorte central.")
 ap.add_argument("--burn-captions",action="store_true",help="Incrusta subtítulos; requiere conversor ASS de FFmpeg")
 ap.add_argument("--normalize-audio",action=argparse.BooleanOptionalAction,default=True,help="Normaliza volumen para una escucha consistente")
 ap.add_argument("--fps",type=int,choices=[25,30,50,60],default=30)
 ap.add_argument("--preset",choices=["ultrafast","veryfast","faster","fast","medium"],default="veryfast")
 ap.add_argument("--crf",type=int,choices=range(18,31),default=23)
 ap.add_argument("--audio-bitrate",choices=["128k","160k","192k","256k"],default="160k")
 args=ap.parse_args()
 if not args.rights_confirmed:raise SystemExit("Bloqueado: confirma autorización con --rights-confirmed. No uses contenido ajeno sin permiso.")
 if args.clips<1 or args.min_seconds<=0 or args.max_seconds<args.min_seconds:raise SystemExit("Parámetros inválidos: clips debe ser >=1 y max-seconds >= min-seconds >0.")
 if not shutil.which("ffmpeg"):raise SystemExit("FFmpeg no está instalado.")
 if not shutil.which("ffprobe"):raise SystemExit("No se encuentra ffprobe; necesitas FFmpeg completo.")
 if args.input.is_file():items=[args.input.resolve()]
 elif args.input.is_dir():items=sorted([x for x in args.input.iterdir() if x.is_file() and x.suffix.lower() in {".mp4",".mov",".mkv",".webm"}])
 else:raise SystemExit("La ruta de entrada no existe.")
 if not items:raise SystemExit("No se encontraron vídeos compatibles.")
 failures=[]
 seen=set()
 for video in items:
  try:
   if video.stem in seen: raise RuntimeError("Dos archivos de entrada comparten nombre base; renómbralos para evitar sobrescribir resultados.")
   seen.add(video.stem)
   print(f"Salida: {process(video,args)}")
  except Exception as e:failures.append({"file":video.name,"error":str(e)});print(f"ERROR {video.name}: {e}")
 if failures:
  (args.output/"batch_errors.json").write_text(json.dumps(failures,ensure_ascii=False,indent=2),encoding="utf-8")
  raise SystemExit(f"{len(failures)} vídeo(s) no procesados; revisa batch_errors.json")
 print("Lote terminado. Revisa review.html y aprueba cada clip manualmente antes de publicar.")

if __name__=="__main__":main()
