const status = document.querySelector('#browserWhisperStatus');
const runButton = document.querySelector('#browserTranscribe');
const output = document.querySelector('#browserTranscript');
const download = document.querySelector('#downloadBrowserTranscript');
const saveProjectButton = document.querySelector('#saveBrowserProject');
let transcriptData = null;
let asr = null;
let asrModelId = null;
let importedProjectPendingSource = false;
let editorTracks = [];
let candidatePreviewUrl = null;
let candidatePreviewKey = null;
const say = (message) => {
  if (status) status.textContent = message;
  window.dispatchEvent(new CustomEvent('clipforge:transcription-progress',{detail:{message}}));
};

async function releaseWhisperModel() {
  const active = asr;
  try {
    if (typeof active?.model?.dispose === 'function') await active.model.dispose();
    else if (typeof active?.dispose === 'function') await active.dispose();
  } catch (error) {
    console.warn('Whisper model cleanup was not available:', error);
  } finally {
    asr = null;
    asrModelId = null;
  }
}

function timeVtt(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(milli).padStart(3,'0')}`;
}

// Extracts the video's audio locally. This currently takes approximately the
// video's duration because captureStream records playback in real time.
async function captureAudioFromVideo(file) {
  const video = document.createElement('video');
  const objectUrl = URL.createObjectURL(file);
  let stream, recorder, audioContext, sourceNode, processor;
  try {
    video.muted = false;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = objectUrl;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = r
…[1 chars truncated — re-run with head/grep/tail for full output]…
ada' : 'sin hablantes diferenciables';
    } catch (diarizationError) {
      console.warn('La diarización local no pudo completarse:', diarizationError);
      diarizationStatus = 'no disponible: ' + String(diarizationError.message || diarizationError);
    }
    const timedSegments = chunks.map(c => ({
      start: Number(c.start), end: Number(c.end), text: String(c.text || '').trim()
    })).filter(c => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start && c.text);
    const speakerSegments = assignSpeakerToTranscriptSegments(timedSegments, diarizationTurns);
    transcriptData = {
      source: file.name, model: activeModelId, language: result.language || sourceLanguage,
      generated_at: new Date().toISOString(), text: result.text || '',
      diagnostics: { ...result.diagnostics, transcriptWordCount, timedWordCount, videoFileBytes: file.size },
      diarization: { model: 'onnx-community/pyannote-segmentation-3.0', status: diarizationStatus, turns: diarizationTurns },
      // Timestamps are absolute source-video seconds; speaker IDs are anonymous.
      segments: speakerSegments
    };
    if (output) output.value = transcriptData.segments.length
      ? transcriptData.segments.map(s => `[${s.start.toFixed(2)}–${s.end.toFixed(2)}] ${s.speaker_label ? '['+s.speaker_label+'] ' : ''}${s.text}`).join('\  paintSubtitle();\nn')
      : (result.text || 'El modelo no devolvió texto temporizado.');
    window.dispatchEvent(new CustomEvent('clipforge:transcript-ready',{detail:{segments:transcriptData.segments.length,words:transcriptWordCount,timedWords:timedWordCount,language:transcriptData.language,model:activeModelId}}));
    if (transcriptData.segments.length) {
      // Free the now-unneeded Whisper model cache before loading the separate
      // Qwen editorial model. Keep transcriptData and the visible transcript intact.
      // Transformers.js stores model weights in the Cache API under this key.
      try {
        await releaseWhisperModel();
        if (globalThis.caches?.delete) {
          const removed = await caches.delete('transformers-cache');
          if (removed) say('Transcripción conservada. Caché temporal de Whisper liberada para dar espacio al selector editorial…');
        }
        const storage = await navigator.storage?.estimate?.();
        if (storage?.quota && storage?.usage != null) {
          const freeMb = Math.max(0, Math.round((storage.quota - storage.usage) / 1048576));
          console.info('[ClipForge storage before editorial model]', {usedMB:Math.round(storage.usage/1048576),quotaMB:Math.round(storage.quota/1048576),freeMB});
        }
      } catch (cleanupError) {
        console.warn('No se pudo liberar la caché temporal de Whisper:', cleanupError);
      }
      let candidatePool = buildEditorialCandidatePool(transcriptData.segments, audio.length / 16000, audio, visualSamples, 16000);
      if (candidatePool.length > 0) {
        try {
          if(candidatePool.length<4)throw new Error('No se han generado cuatro ventanas válidas para comparar.');
          const requested=4;
          if(candidatePool.length<requested)throw new Error('No hay cuatro momentos candidatos con diálogo suficiente para una selección fiable.');
          say(`Se han preparado ${candidatePool.length} ventanas. La IA comparará todo el vídeo y elegirá exactamente los cuatro momentos más importantes. Se usa una cadena compacta de cuatro comparaciones y dos revisiones finales.`);
          try {
            candidatePool = await aiEditorialSelect(candidatePool, requested, say);
            recordDailyAIClips(candidatePool.length);
            say('Selección generativa completada: cuatro momentos revisados por IA.');
          } catch (editorError) {
            console.warn('[ClipForge] El modelo editorial no ha podido completar la selección; activando selector local de continuidad.',editorError);
            say('El modelo generativo no ha respondido correctamente. Seleccionando cuatro momentos mediante análisis local de transcripción, diversidad y audio para abrir el editor…');
            candidatePool = selectEditorialFallback(candidatePool, requested);
          }
        } catch (editorError) {
          console.error('No se pudieron preparar cuatro momentos editables.',editorError);
          say(`No se han podido preparar cuatro momentos editables: ${editorError.message}. La transcripción se conserva.`);
          return;
        }
      }
      if (!Array.isArray(candidatePool) || candidatePool.length !== 4 ||
          !candidatePool.every(item => ['local_generative_editor','remote_generative_editor','local_editorial_fallback'].includes(item.selection_method))) {
        say('No se han podido validar cuatro momentos editables. La transcripción se conserva.');
        return;
      }
      showClipCandidates(transcriptData.segments, audio.length / 16000, candidatePool, audio, visualSamples);
      // Show the four reviewed candidates only. Export is always an explicit user action.
      const vtt = makeVtt(transcriptData.segments);
      const attached = attachTranscriptToJobForm(vtt);
      say(`Transcripción lista: ${transcriptData.segments.length} fragmentos temporizados · ${transcriptWordCount} palabras reconocidas · audio ${sourceDurationForTiming.toFixed(1)} s · ${result.diagnostics?.windows?.length || 0} bloques procesados · ${new Set(transcriptData.segments.map(s=>s.speaker).filter(Number.isFinite)).size} hablantes asignados · diarización ${transcriptData.diarization?.status || 'no disponible'}. ${attached ? 'Subtítulos y cortes seleccionados conectados al formulario de producción.' : 'Descarga el JSON para conservarla.'}`);
      const autoGenerate = document.querySelector('#autoGenerateAfterTranscription')?.checked;
      const form = document.querySelector('#jobForm');
      const rights = form?.querySelector('[name="rights_confirmed"]');
      if (autoGenerate && attached && file && form) {
        if (rights?.checked) {
          say('Transcripción y cortes listos. Enviando ahora el mismo vídeo al renderizador…');
          form.requestSubmit();
        } else {
          say('Transcripción y cortes listos y adjuntados. Para iniciar el render, marca primero la confirmación de derechos en el formulario y pulsa «Analizar y generar clips».');
          document.querySelector('#jobForm')?.scrollIntoView({behavior:'smooth',block:'center'});
        }
      }
    } else {
      // A silent transcript is still a valid input for the non-speech ranker.
      // It uses audio activity to suggest moments for music, gameplay and B-roll.
      showClipCandidates([], audio.length / 16000, null, audio, visualSamples);
      say(editableCandidates.length
        ? `No se detectó diálogo temporizado. Se han propuesto ${editableCandidates.length} momentos mediante actividad sonora. Iniciando el renderizado de los MP4.`
        : 'No se detectó diálogo ni suficiente actividad sonora para proponer cortes.');
      startAutomaticClipExport();
    }
    if (download) download.disabled = !result.text;
    if (saveProjectButton) saveProjectButton.disabled = !transcriptData?.segments?.length;
  } catch (error) {
    console.error(error);
    say(`Error de transcripción: ${error?.message || error}. Comprueba el idioma del audio y que la pista tenga voces claras; si Small no cabe en la memoria del equipo, prueba Base.`);
  } finally { runButton.disabled = false; }
});

download?.addEventListener('click', () => {
  if (!transcriptData) return;
  const blob = new Blob([JSON.stringify(transcriptData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'clipforge-transcripcion.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.querySelector('#video')?.addEventListener('change', async () => {
  const input = document.querySelector('#video');
  const file = input?.files?.[0];
  if (!file) return;
  updateVideoCapacity(file).catch(error=>console.warn('No se pudo calcular la capacidad del vídeo:',error));
  const field=document.querySelector('[name="selected_clip_ranges"]');
  const panel=document.querySelector('#browserCandidates');
  const transcript=document.querySelector('#transcript');
  if (importedProjectPendingSource && transcriptData?.segments?.length) {
    const expected = String(transcriptData.source || '').split(/[\/]/).pop();
    if (!expected || expected === file.name) {
      if (transcript) attachTranscriptToJobForm(makeVtt(transcriptData.segments));
      const metadataUrl=URL.createObjectURL(file);
      const probe=document.createElement('video'); probe.preload='metadata'; probe.src=metadataUrl;
      const duration=await new Promise(resolve=>{probe.onloadedmetadata=()=>resolve(probe.duration);probe.onerror=()=>resolve(Math.max(0,...editableCandidates.map(c=>Number(c.end))));});
      URL.revokeObjectURL(metadataUrl);
      showClipCandidates([], Number.isFinite(duration)?duration:Math.max(0,...editableCandidates.map(c=>Number(c.end))), editableCandidates);
      importedProjectPendingSource=false;
      say(`Vídeo original vinculado al proyecto: ${file.name}. Se han conservado ${editableCandidates.length} cortes y la transcripción.`);
      return;
    }
    importedProjectPendingSource=false;
    transcriptData=null; editableCandidates=[];
    if(field)field.value=''; if(panel)panel.hidden=true; if(transcript)transcript.value='';
    say(`El archivo seleccionado (${file.name}) no coincide con el vídeo del proyecto (${expected}). Se han descartado los cortes y la transcripción para evitar exportar segmentos incorrectos.`);
    return;
  }
  if (field) field.value=''; editableCandidates=[]; if(panel)panel.hidden=true; transcriptData=null; if(transcript)transcript.value='';
  say(`Vídeo seleccionado: ${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB.`);
});



// Apply manual transcript corrections without inventing new timestamps.
function applyTranscriptEdits() {
  if (!transcriptData?.segments?.length || !output) return;
  const lines = output.value.split(/\r?\n/).filter(line => line.trim());
  const parsed = lines.map(line => {
    const match = line.match(/^\s*\[\s*(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*\]\s*(.*)$/);
    return match ? { start: Number(match[1]), end: Number(match[2]), text: match[3].trim() } : null;
  });
  if (parsed.length !== transcriptData.segments.length || parsed.some((x,i) => !x || !Number.isFinite(x.start) || !Number.isFinite(x.end) || x.end <= x.start || !x.text)) {
    say('No se aplicaron los cambios: conserva una línea por segmento y el formato [inicio–fin] texto.');
    return;
  }
  transcriptData.segments = parsed;
  transcriptData.text = parsed.map(x => x.text).join(' ');
  attachTranscriptToJobForm(makeVtt(parsed));
  say('Correcciones de transcripción aplicadas. Se usarán al incrustar los subtítulos en el MP4.');
}
output?.addEventListener('change', applyTranscriptEdits);

saveProjectButton?.addEventListener('click', () => {
  if (!transcriptData?.segments?.length || !editableCandidates.length) {
    say('Primero transcribe el vídeo y genera la selección de momentos.');
    return;
  }
  const first = document.querySelector('.cf-open-clip-editor');
  if (first) first.click();
  else window.dispatchEvent(new CustomEvent('clipforge:open-editor', {detail:{clip:editableCandidates[0],index:0}}));
  say('Proyecto abierto en el editor multipista. Ponle nombre y utiliza Guardar en Drive.');
});

// Importación explícita de proyectos JSON guardados anteriormente.
document.querySelector('#browserProjectImport')?.addEventListener('change', async (event) => {
  const file=event.target.files?.[0]; if(!file) return;
  try {
    const project=JSON.parse(await file.text());
    if(project?.schema!=='clipforge-browser-project-v1' || !Array.isArray(project.clips)) throw new Error('Formato de proyecto no reconocido.');
    if(project.clips.length<1 || project.clips.length>10) throw new Error('El proyecto contiene demasiados clips.');
    if(project.clips.some(c=>!Number.isFinite(Number(c.start)) || !Number.isFinite(Number(c.end)) || Number(c.start)<0 || Number(c.end)<=Number(c.start))) throw new Error('Hay tiempos de clip inválidos.');
    editableCandidates=project.clips.map((c,i)=>({...c,id:String(c.id||`clip-${i+1}`)}));
    transcriptData=project.transcript || null;
    const sourceFile=document.querySelector('#video')?.files?.[0];
    importedProjectPendingSource=Boolean(transcriptData?.segments?.length && !sourceFile);
    if(Array.isArray(transcriptData?.segments) && transcriptData.segments.length) {
      const segments=transcriptData.segments.map(c=>({start:Number(c.start),end:Number(c.end),text:String(c.text||''),...(Array.isArray(c.words)?{words:c.words.map(w=>({...w,start:Number(w.start),end:Number(w.end)})).filter(w=>Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.end>w.start)}:{})})).filter(c=>Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.end>c.start&&c.text);
      if(segments.length) {
        transcriptData.segments=segments;
        if(output)output.value=segments.map(c=>`[${c.start.toFixed(2)}–${c.end.toFixed(2)}] ${c.text}`).join('\n');
        if (!sourceFile || String(transcriptData.source || '').split(/[\/]/).pop() === sourceFile.name) {
          attachTranscriptToJobForm(makeVtt(segments));
        } else {
          importedProjectPendingSource=false;
          say(`Proyecto importado, pero el vídeo seleccionado no coincide con ${transcriptData.source}. Selecciona el original antes de renderizar.`);
        }
        if(download) download.disabled=false;
        if(saveProjectButton) saveProjectButton.disabled=false;
      }
    }
    const duration=Math.max(0,...editableCandidates.map(c=>Number(c.end)));
    showClipCandidates([],duration,editableCandidates);
    localStorage.setItem('clipforge.browser.project.v1',JSON.stringify(project));
    say(`Proyecto recuperado: ${editableCandidates.length} clips${transcriptData?.segments?.length ? ' y transcripción' : ''}. Selecciona el vídeo original y podrás continuar editando.`);if(transcriptData?.segments?.length){const restoredWordCount=transcriptData.segments.reduce((n,s)=>n+(Array.isArray(s.words)?s.words.length:0),0);window.dispatchEvent(new CustomEvent('clipforge:transcript-ready',{detail:{segments:transcriptData.segments.length,words:restoredWordCount||transcriptData.text?.split(/\s+/).filter(Boolean).length||0,timedWords:restoredWordCount,language:transcriptData.language,model:transcriptData.model}}));}
  } catch(error) { say(`No se pudo abrir el proyecto: ${error.message}`); }
  finally { event.target.value=''; }
});


// Public, read-only bridge for the separate project editor module.
window.clipforgeEditorBridge = {
  getProject() {
    return {
      schema: 'clipforge-project-v2',
      source: transcriptData?.source || document.querySelector('#video')?.files?.[0]?.name || '',
      transcript: transcriptData ? JSON.parse(JSON.stringify(transcriptData)) : null,
      clips: editableCandidates.map((clip, i) => ({...clip, id:String(clip.id || `clip-${i+1}`)})),
      tracks: JSON.parse(JSON.stringify(editorTracks))
    };
  },
  setClips(clips) {
    editableCandidates = Array.isArray(clips) ? clips.map((clip, i) => ({...clip, id:String(clip.id || `clip-${i+1}`)})) : [];
    const duration = Math.max(0, ...editableCandidates.map(clip => Number(clip.end) || 0));
    showClipCandidates([], duration, editableCandidates);
    const field = document.querySelector('[name="selected_clip_ranges"]');
    if (field) field.value = JSON.stringify(editableCandidates);
  },
  setTracks(value) { editorTracks = Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : []; },
  setTranscript(value) {
    if (!value || !Array.isArray(value.segments)) return;
    transcriptData = JSON.parse(JSON.stringify(value));
    if (output) output.value = transcriptData.segments.map(s => `[${Number(s.start).toFixed(2)}–${Number(s.end).toFixed(2)}] ${String(s.text || '')}`).join('\n');
    if (download) download.disabled = false;
    if (saveProjectButton) saveProjectButton.disabled = false;
  }
};
window.dispatchEvent(new CustomEvent('clipforge:editor-ready'));


// Idempotent startup: handle both normal file changes and files selected
// before this module finishes loading (a common race on first page load).
const sourceInput = document.querySelector('#video');
let whisperStartPromise = null;
function startWhisperForSelectedFile() {
  const file = sourceInput?.files?.[0];
  if (!file) return;
  updateVideoCapacity(file).catch(error => console.warn('No se pudo calcular la capacidad del vídeo:', error));
  if (window.clipforgeEditorBridge?.getProject?.().transcript?.segments?.length) return;
  if (sourceInput.dataset.whisperAutoStarted === '1') return;
  if (runButton?.disabled) {
    say('El análisis anterior sigue en curso. Espera a que termine antes de iniciar otro vídeo.');
    return;
  }
  if (!runButton || !document.contains(runButton)) {
    say('Error: el botón de análisis no está conectado al espacio de trabajo. Recarga la página.');
    return;
  }
  sourceInput.dataset.whisperAutoStarted = '1';
  say('Vídeo detectado. Iniciando extracción de audio y transcripción Whisper…');
  // Let the workspace finish its preview update before starting the expensive model.
  whisperStartPromise = Promise.resolve().then(() => runButton.click());
}
sourceInput?.addEventListener('change', startWhisperForSelectedFile);
// Catch files selected while module scripts were still loading.
window.addEventListener('clipforge:workspace-ready', startWhisperForSelectedFile);
window.dispatchEvent(new CustomEvent('clipforge:whisper-ready'));
if (sourceInput?.files?.length) setTimeout(startWhisperForSelectedFile, 0);
document.querySelector('#browserWhisperModel')?.addEventListener('change',()=>{const file=document.querySelector('#video')?.files?.[0];if(file)updateVideoCapacity(file).catch(console.warn);});