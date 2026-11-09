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
const say = (message) => { if (status) status.textContent = message; };

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
  let stream;
  let recorder;
  try {
    video.muted = false;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = objectUrl;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('El navegador no pudo abrir el vídeo.'));
    });
    const capture = video.captureStream || video.mozCaptureStream;
    if (!capture) throw new Error('Este navegador no permite extraer audio local. Prueba Chrome o Edge actualizado.');
    stream = capture.call(video);
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) throw new Error('El vídeo no contiene una pista de audio reconocible.');
    const audioStream = new MediaStream(audioTracks);
    const mime = ['audio/webm;codecs=opus',
…[1 chars truncated — re-run with head/grep/tail for full output]…
)=>{
  let field=document.querySelector('[name="selected_clip_ranges"]');
  const form=document.querySelector('#video')?.form;
  if(!field&&form){field=document.createElement('input');field.type='hidden';field.name='selected_clip_ranges';form.append(field);}
  if(field)field.value=JSON.stringify(editableCandidates);
 };
 editableCandidates.forEach((c,i)=>{
  const card=document.createElement('article');card.className='candidate-card';
  const heading=document.createElement('strong');heading.textContent=`${c.title} · potencial editorial (heurístico) ${c.score}/100`;
  const rationale=document.createElement('small');rationale.className='candidate-rationale';rationale.textContent=(c.reasons||[]).join(' · ')||'Conversación con cierre natural';
  const preview=document.createElement('button');preview.type='button';preview.className='secondary preview-clip-candidate';preview.textContent='Vista previa';preview.addEventListener('click',()=>window.clipforgeEditorBridge?.previewClip?.(c));
  const selectLabel=document.createElement('label');selectLabel.className='candidate-select';
  const select=document.createElement('input');select.type='checkbox';select.checked=c.selected!==false;
  select.setAttribute('aria-label','Incluir clip en exportación');
  select.addEventListener('change',()=>{editableCandidates[i]={...editableCandidates[i],selected:select.checked};sync();});
  selectLabel.append(select,document.createTextNode(' Incluir en exportación'));
  const row=document.createElement('div');row.className='candidate-edit-grid';
  const a=document.createElement('input');a.type='number';a.min='0';a.step='.1';a.value=Number(c.start).toFixed(2);a.setAttribute('aria-label','Inicio en segundos');
  const b=document.createElement('input');b.type='number';b.min='0';b.step='.1';b.value=Number(c.end).toFixed(2);b.setAttribute('aria-label','Final en segundos');
  const note=document.createElement('textarea');note.value=String(c.text || '');note.rows=3;note.setAttribute('aria-label','Texto del clip');
  const update=()=>{const x=Number(a.value),y=Number(b.value);if(a.value.trim()===''||b.value.trim()===''||!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<=x||y>duration){card.classList.add('candidate-invalid');return;}card.classList.remove('candidate-invalid');editableCandidates[i]={...editableCandidates[i],start:x,end:y,duration:y-x,text:note.value};sync();};
  a.addEventListener('change',update);b.addEventListener('change',update);note.addEventListener('input',update);
  row.append(a,b);card.append(heading,rationale,preview,selectLabel,row,note);list.append(card);
 });
 const info=document.createElement('p');info.textContent='Selección local basada en transcripción, coherencia, interacción, ritmo, energía de audio y cierre. Revisa los cuatro momentos: la puntuación orienta, no predice viralidad.';list.append(info);sync();
 window.dispatchEvent(new CustomEvent('clipforge:clips-updated'));
}

function attachTranscriptToJobForm(vtt) {
  const input = document.querySelector('#transcript');
  if (!input) return false;
  const file = new File([vtt], 'clipforge-transcripcion.vtt', { type: 'text/vtt' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

runButton?.addEventListener('click', async () => {
  const file = document.querySelector('#video')?.files?.[0];
  if (!file) { say('Selecciona primero un vídeo en el formulario de producción.'); return; }
  runButton.disabled = true;
  if (download) download.disabled = true;
  if (output) output.value = '';
  try {
    let audio;
    try {
      say(`Extrayendo la pista AAC/MP3 del MP4 sin reproducir el vídeo (${Math.round(file.size / 1024 / 1024)} MB)…`);
      audio = await extractAudioWithMediabunny(file);
      say(`Audio extraído: ${(audio.length / 16000).toFixed(1)} segundos. Preparando Whisper…`);
    } catch (demuxError) {
      console.warn('Demultiplexado/decodificación por Mediabunny no disponible; usando captura de reproducción como alternativa.', demuxError);
      say('Este navegador o códec no admite extracción directa. Usando reproducción local como alternativa; puede tardar lo mismo que el vídeo…');
      const audioBlob = await captureAudioFromVideo(file);
      audio = await toMono16k(audioBlob);
    }
    say('Cargando Transformers.js y el modelo Whisper abierto. La primera descarga puede tardar.');
    const { pipeline, env } = await import('https://esm.sh/@huggingface/transformers@3.7.2');
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    const model = document.querySelector('#browserWhisperModel')?.value || 'whisper-base';
    const modelId = ({ 'whisper-tiny': 'onnx-community/whisper-tiny_timestamped', 'whisper-base': 'onnx-community/whisper-base_timestamped', 'whisper-small': 'onnx-community/whisper-small_timestamped' })[model];
    if (!modelId) throw new Error('El modelo seleccionado todavía no tiene soporte verificado para marcas de tiempo por palabra.');
    const progress = p => {
      if (p.status === 'progress') say(`Descargando modelo ${p.file || ''}: ${Math.round(p.progress || 0)}%`);
      else if (p.status) say(`Modelo Whisper: ${p.status}`);
    };
    const loadModel = async id => {
      asr = await pipeline('automatic-speech-recognition', id, { dtype: 'q8', progress_callback: progress });
      asrModelId = id;
    };
    const reportProgress = (percent, current, total) => {
      say(`Transcribiendo entrevista: ${percent}% · fragmento ${current}/${total}`);
    };
    let activeModelId = modelId;
    let result;
    try {
      if (!asr || asrModelId !== modelId) {
        asr = null;
        asrModelId = null;
        await loadModel(modelId);
      }
      say('Transcribiendo en fragmentos para reducir memoria y evitar límites de 30 segundos…');
      result = await transcribeAudioInChunks(asr, audio, reportProgress, model === 'whisper-small' ? true : 'word');
      if (model === 'whisper-small' && !(result.chunks || []).length) {
        throw new Error('Whisper Small no devolvió marcas de tiempo utilizables.');
      }
    } catch (transcriptionError) {
      if (model !== 'whisper-small') throw transcriptionError;
      activeModelId = 'onnx-community/whisper-base_timestamped';
      say('Small no pudo cargarse o generar tiempos utilizables. Cambiando automáticamente a Base para conservar los cortes sincronizados…');
      asr = null;
      asrModelId = null;
      await loadModel(activeModelId);
      result = await transcribeAudioInChunks(asr, audio, reportProgress, 'word');
      if (!(result.chunks || []).length) {
        throw new Error(`Whisper Base tampoco devolvió marcas de tiempo. Error de Small: ${transcriptionError.message}`);
      }
    }
    const chunks = result.chunks || [];
    transcriptData = {
      source: file.name, model: activeModelId, language: 'es',
      generated_at: new Date().toISOString(), text: result.text || '',
      // transcribeAudioInChunks already converts model-local timestamps to
      // absolute source-video seconds and returns {start, end, text} objects.
      // Do not read c.timestamp here: that field belongs to raw Transformers.js
      // chunks and would silently reset every saved caption to 0 seconds.
      segments: chunks.map(c => ({
        start: Number(c.start),
        end: Number(c.end),
        text: String(c.text || '').trim()
      })).filter(c => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start && c.text)
    };
    output.value = transcriptData.segments.length
      ? transcriptData.segments.map(s => `[${s.start.toFixed(2)}–${s.end.toFixed(2)}] ${s.text}`).join('\n')
      : (result.text || 'El modelo no devolvió texto temporizado.');
    if (transcriptData.segments.length) {
      showClipCandidates(transcriptData.segments, audio.length / 16000, null, audio);
      const vtt = makeVtt(transcriptData.segments);
      const attached = attachTranscriptToJobForm(vtt);
      say(`Transcripción lista: ${transcriptData.segments.length} fragmentos temporizados. ${attached ? 'Subtítulos y cortes seleccionados conectados al formulario de producción.' : 'Descarga el JSON para conservarla.'} Whisper no identifica hablantes.`);
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
      say('Whisper devolvió texto sin marcas de tiempo utilizables. No se ha adjuntado una transcripción vacía.');
    }
    if (download) download.disabled = !result.text;
    if (saveProjectButton) saveProjectButton.disabled = !transcriptData?.segments?.length;
  } catch (error) {
    console.error(error);
    say(`Error de transcripción: ${error?.message || error}. Prueba Chrome/Edge actualizado y el modelo Tiny.`);
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
  const field=document.querySelector('[name="selected_clip_ranges"]');
  const panel=document.querySelector('#browserCandidates');
  const transcript=document.querySelector('#transcript');
  if (importedProjectPendingSource && transcriptData?.segments?.length) {
    const expected = String(transcriptData.source || '').split(/[\\/]/).pop();
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
  const project = {
    schema: 'clipforge-browser-project-v1',
    saved_at: new Date().toISOString(),
    source: transcriptData.source || document.querySelector('#video')?.files?.[0]?.name || '',
    transcript: transcriptData,
    clips: editableCandidates.map((clip, i) => ({ ...clip, id: String(clip.id || `clip-${i+1}`) }))
  };
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'clipforge-proyecto.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say('Proyecto editable guardado. Incluye transcripción y cortes; conserva también el vídeo original.');
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
      const segments=transcriptData.segments.map(c=>({start:Number(c.start),end:Number(c.end),text:String(c.text||'')})).filter(c=>Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.end>c.start&&c.text);
      if(segments.length) {
        transcriptData.segments=segments;
        output.value=segments.map(c=>`[${c.start.toFixed(2)}–${c.end.toFixed(2)}] ${c.text}`).join('\n');
        if (!sourceFile || String(transcriptData.source || '').split(/[\\/]/).pop() === sourceFile.name) {
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
    say(`Proyecto recuperado: ${editableCandidates.length} clips${transcriptData?.segments?.length ? ' y transcripción' : ''}. Selecciona el vídeo original y podrás continuar editando.`);
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
