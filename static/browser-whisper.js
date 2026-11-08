const status = document.querySelector('#browserWhisperStatus');
const runButton = document.querySelector('#browserTranscribe');
const output = document.querySelector('#browserTranscript');
const download = document.querySelector('#downloadBrowserTranscript');
const saveProjectButton = document.querySelector('#saveBrowserProject');
let transcriptData = null;
let asr = null;
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
    const mime = ['audio/webm;codecs=opus', 'audio/webm'].find(x => MediaRecorder.isTypeSupported(x));
    if (!mime) throw new Error('MediaRecorder no admite un formato de audio compatible.');
    recorder = new MediaRecorder(audioStream, { mimeType: mime });
    const chunks = [];
    const done = new Promise((resolve, reject) => {
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onerror = () => reject(new Error('Falló la extracción de audio.'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
    });
    // Start recording before playback so the first audio samples are not lost.
    recorder.start(1000);
    await video.play();
    await new Promise((resolve, reject) => {
      video.onended = resolve;
      video.onerror = () => reject(new Error('El vídeo falló durante la extracción de audio.'));
    });
    if (recorder.state !== 'inactive') recorder.stop();
    return await done;
  } finally {
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch {}
    try { stream?.getTracks().forEach(t => t.stop()); } catch {}
    video.pause();
    video.removeAttribute('src');
    URL.revokeObjectURL(objectUrl);
  }
}

async function extractAudioWithMediabunny(file) {
  // Mediabunny demuxes the MP4 audio track without decoding the video stream
  // or forcing the user to play the whole source in real time.
  const { Input, BlobSource, ALL_FORMATS, AudioSampleSink } =
    await import('https://esm.sh/mediabunny@1.65.2');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error('El MP4 no contiene una pista de audio.');
  if (!(await track.canDecode())) throw new Error('El navegador no puede decodificar el códec de audio de este MP4.');
  const duration = await input.getDurationFromMetadata();
  if (!Number.isFinite(duration) || duration <= 0 || duration > 6 * 60 * 60) {
    throw new Error('La duración del audio del MP4 no es válida.');
  }
  const mono = new Float32Array(Math.ceil(duration * 16000));
  const sink = new AudioSampleSink(track);
  let samples = 0;
  for await (const sample of sink.samples()) {
    try {
      const buffer = sample.toAudioBuffer();
      const offset = Math.max(0, Math.round(sample.timestamp * 16000));
      const sourceFrames = buffer.length;
      if (sourceFrames <= 0 || offset >= mono.length) continue;
      // Linear interpolation converts the FULL source block to 16 kHz while
      // retaining its original media timestamp (including small gaps).
      // Do not cap sourceFrames by the 16 kHz destination buffer: for 44.1 kHz
      // audio that truncates most of every block before resampling.
      const sourceRate = buffer.sampleRate;
      const targetFrames = Math.min(Math.ceil(sourceFrames * 16000 / sourceRate), mono.length - offset);
      for (let j = 0; j < targetFrames; j++) {
        const sourcePos = j * sourceRate / 16000;
        const lo = Math.min(Math.floor(sourcePos), sourceFrames - 1);
        const hi = Math.min(lo + 1, sourceFrames - 1);
        const frac = sourcePos - lo;
        let interpolated = 0;
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
          const channel = buffer.getChannelData(ch);
          interpolated += (channel[lo] * (1 - frac) + channel[hi] * frac) / buffer.numberOfChannels;
        }
        mono[offset + j] = interpolated;
      }
      samples++;
    } finally { sample.close(); }
  }
  if (!samples || !mono.some(value => Math.abs(value) > 1e-7)) {
    throw new Error('No se pudieron extraer muestras de audio del MP4.');
  }
  return mono;
}

async function resampleDecodedAudio(decoded) {
  const length = Math.ceil(decoded.duration * 16000);
  const mono = new Float32Array(length);
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    const input = decoded.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const pos = i * decoded.sampleRate / 16000;
      const lo = Math.floor(pos), hi = Math.min(lo + 1, input.length - 1);
      const frac = pos - lo;
      mono[i] += (input[lo] * (1 - frac) + input[hi] * frac) / decoded.numberOfChannels;
    }
  }
  return mono;
}

async function toMono16k(blob) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) throw new Error('Web Audio no está disponible en este navegador.');
  const ctx = new AudioCtx();
  try { return await resampleDecodedAudio(await ctx.decodeAudioData(await blob.arrayBuffer())); }
  finally { await ctx.close(); }
}

// Whisper has a 30-second audio context limit. Process the full source in
// bounded windows so long interviews do not require one huge inference buffer.
// A 2-second overlap protects words at boundaries; duplicate words are removed
// by their absolute timestamps and normalized text.
async function transcribeAudioInChunks(asr, audio, onProgress = () => {}) {
  const sampleRate = 16000;
  const windowSeconds = 28;
  const overlapSeconds = 2;
  const windowSamples = windowSeconds * sampleRate;
  const stepSamples = (windowSeconds - overlapSeconds) * sampleRate;
  const totalSeconds = audio.length / sampleRate;
  const allChunks = [];
  const fullText = [];
  const totalParts = Math.max(1, Math.ceil(Math.max(0, audio.length - windowSamples) / stepSamples) + 1);

  for (let startSample = 0, part = 0; startSample < audio.length; startSample += stepSamples, part++) {
    const endSample = Math.min(audio.length, startSample + windowSamples);
    const result = await asr(audio.subarray(startSample, endSample), {
      language: 'spanish',
      task: 'transcribe',
      return_timestamps: 'word'
    });
    const offset = startSample / sampleRate;
    const chunkText = String(result.text || '').trim();
    if (chunkText) fullText.push(chunkText);

    for (const chunk of (result.chunks || [])) {
      const localStart = Number(chunk.timestamp?.[0]);
      const localEnd = Number(chunk.timestamp?.[1]);
      const text = String(chunk.text || '').trim();
      if (!text || !Number.isFinite(localStart) || !Number.isFinite(localEnd)) continue;
      const absoluteStart = Math.max(0, offset + localStart);
      const absoluteEnd = Math.min(totalSeconds, offset + Math.max(localStart, localEnd));
      if (absoluteEnd <= absoluteStart) continue;
      // Keep words recognized only in the next window's overlap.
      // Deduplicate matching words by timestamp rather than discarding the overlap.
      const normalized = text.toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
      const duplicate = allChunks.some(previous =>
        Math.abs(previous.start - absoluteStart) < 0.45 &&
        previous.text.toLocaleLowerCase('es').replace(/\s+/g, ' ').trim() === normalized
      );
      if (!duplicate) allChunks.push({ start: absoluteStart, end: absoluteEnd, text });
    }
    onProgress(Math.min(100, Math.round(endSample / audio.length * 100)), part + 1, totalParts);
    if (endSample === audio.length) break;
  }

  allChunks.sort((a, b) => a.start - b.start);
  return { text: (allChunks.length ? allChunks.map(chunk => chunk.text).join(' ') : fullText.join(' ')).replace(/\s+/g, ' ').trim(), chunks: allChunks };
}

function makeVtt(segments) {
  // Build readable cues at natural pauses and sentence boundaries, not at
  // arbitrary fixed five-word intervals. Keep timing from Whisper unchanged.
  const words = segments
    .filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start && String(s.text || '').trim())
    .map(s => ({ start: Number(s.start), end: Number(s.end), text: String(s.text).trim() }))
    .sort((a, b) => a.start - b.start);
  const groups = [];
  let group = [];
  const flush = () => { if (group.length) groups.push(group); group = []; };
  for (const word of words) {
    const previous = group[group.length - 1];
    const proposedText = group.map(x => x.text).concat(word.text).join(' ');
    const gap = previous ? word.start - previous.end : 0;
    const sentenceEnd = previous && /[.!?…][”’"')\]]?$/.test(previous.text);
    if (group.length && (group.length >= 5 || gap > 0.42 || word.end - group[0].start > 2.25 || proposedText.length > 42 || sentenceEnd)) flush();
    group.push(word);
    if (/[.!?…][”’"')\]]?$/.test(word.text)) flush();
  }
  flush();
  const cues = groups.map(items => {
    const start = Math.max(0, items[0].start);
    const end = Math.max(start + 0.15, items[items.length - 1].end);
    return `${timeVtt(start)} --> ${timeVtt(end)}\n${items.map(w => w.text).join(' ').trim()}`;
  });
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

// Las puntuaciones heurísticas no equivalen a una predicción de viralidad.
function rankClipCandidates(words, videoDuration) {
  const minLen = 18, maxLen = 45, candidates = [];
  const sentenceEnd = /[.!?…][”’"')\]]?$/;
  const hooks = /\b(por qué|cómo|qué pasa|no me digas|madre mía|increíble|imagina|resulta que|la verdad|nunca|siempre|pero|entonces|porque|jaj|risas|hostia|ostras|buah|flipante|brutal|vergüenza|miedo|problema|secreto|historia|me dijo|te juro|no sabía|de repente|al final|lo que pasa|y va y|fíjate|en serio|es que|¿)\b/gi;
  const emotional = /\b(risa|risas|llor|miedo|vergüenza|enfado|cabreo|sorpresa|increíble|brutal|absurdo|ridículo|flipante|hostia|joder|buah|ostras|madre mía|qué fuerte)\b/gi;
  const starts = words.filter(w => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start && String(w.text||'').trim()).sort((a,b)=>a.start-b.start);
  if (!starts.length) return [];
  const step = 4;
  for (let i = 0; i < starts.length; i += step) {
    let startIndex = i;
    // Prefer a complete sentence start, but never rewind more than 2.5 seconds.
    for (let p=i-1;p>=0 && starts[i].start-starts[p].start<=2.5;p--) {
      if (sentenceEnd.test(String(starts[p].text||''))) { startIndex=p+1; break; }
      if (p>0 && starts[p].start-starts[p-1].end>.8) { startIndex=p; break; }
    }
    const start = starts[startIndex].start;
    if (start > videoDuration - minLen) break;
    let j = startIndex;
    while (j < starts.length && starts[j].end - start < minLen) j++;
    if (j >= starts.length) continue;
    let k = j;
    while (k + 1 < starts.length && starts[k + 1].end - start <= maxLen) k++;
    // End at the first natural sentence boundary after the minimum length.
    for (let p=j;p<=k;p++) {
      const gap = p+1<starts.length ? starts[p+1].start-starts[p].end : 0;
      if (sentenceEnd.test(String(starts[p].text||'')) || gap>.8) { k=p; break; }
    }
    const group = starts.slice(startIndex, k + 1);
    const duration = group[group.length - 1].end - start;
    if (duration < minLen || duration > maxLen) continue;
    const text = group.map(w => String(w.text).trim()).join(' ');
    const lexical = text.toLowerCase().match(/[a-záéíóúüñ]{3,}/g) || [];
    const uniqueRatio = new Set(lexical).size / Math.max(1, lexical.length);
    const hookCount = (text.match(hooks) || []).length;
    const emotionCount = (text.match(emotional) || []).length;
    const questions = (text.match(/[¿?]/g) || []).length;
    const personalStory = (text.match(/\b(yo|me|mi|mío|mía|nosotros|a mí|cuando era|una vez|me pasó|conocí|estuve)\b/gi)||[]).length;
    const turns = (text.match(/\b(pero|aunque|sin embargo|de repente|entonces|al final|resulta que|y va|y me dice|me dijo)\b/gi)||[]).length;
    const ending = String(group[group.length-1].text||'').trim();
    const completeEnding = sentenceEnd.test(ending) ? 1 : 0;
    const abruptEnding = /\b(y|pero|porque|que|cuando|si|aunque|entonces|de)\s*$/i.test(text) ? 1 : 0;
    const speechDensity = group.length / Math.max(1, duration);
    const lexicalQuality = Math.min(1, uniqueRatio / .62);
    const score = Math.max(0,Math.min(100,
      18 + Math.min(24,hookCount*4) + Math.min(12,emotionCount*4) + Math.min(12,questions*4) +
      Math.min(10,personalStory*1.5) + Math.min(10,turns*3) + lexicalQuality*10 +
      completeEnding*8 + Math.min(8,speechDensity*5) - abruptEnding*14
    ));
    candidates.push({ start, end: group[group.length - 1].end, duration, score: Math.round(score), text });
  }
  candidates.sort((a,b)=>b.score-a.score);
  const chosen=[];
  for (const c of candidates) {
    if (chosen.every(x => c.end <= x.start + 3 || c.start >= x.end - 3)) chosen.push(c);
    if (chosen.length === 4) break;
  }
  return chosen.sort((a,b)=>a.start-b.start);
}

let editableCandidates=[];
function showClipCandidates(words,duration,restoredCandidates=null) {
 const panel=document.querySelector('#browserCandidates'),list=document.querySelector('#browserCandidateList');
 if(!panel||!list)return;
 editableCandidates=(restoredCandidates || rankClipCandidates(words,duration)).map((c,i)=>({...c,title:c.title||`Clip ${i+1}`,selected:c.selected!==false}));
 panel.hidden=false;list.replaceChildren();
 if(!editableCandidates.length){list.textContent='No hay suficientes marcas de tiempo.';const field=document.querySelector('[name="selected_clip_ranges"]');if(field)field.value='';return;}
 const sync=()=>{
  let field=document.querySelector('[name="selected_clip_ranges"]');
  const form=document.querySelector('#video')?.form;
  if(!field&&form){field=document.createElement('input');field.type='hidden';field.name='selected_clip_ranges';form.append(field);}
  if(field)field.value=JSON.stringify(editableCandidates);
 };
 editableCandidates.forEach((c,i)=>{
  const card=document.createElement('article');card.className='candidate-card';
  const heading=document.createElement('strong');heading.textContent=`${c.title} · ${c.score}/100 (heurístico)`;
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
  row.append(a,b);card.append(heading,selectLabel,row,note);list.append(card);
 });
 const info=document.createElement('p');info.textContent='Los cortes editados se enviarán al renderizador al crear el trabajo. Puntuación orientativa, no predicción de viralidad.';list.append(info);sync();
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
    if (!asr) asr = await pipeline('automatic-speech-recognition', modelId, {
      dtype: 'q8',
      progress_callback: p => {
        if (p.status === 'progress') say(`Descargando modelo ${p.file || ''}: ${Math.round(p.progress || 0)}%`);
        else if (p.status) say(`Modelo Whisper: ${p.status}`);
      }
    });
    say('Transcribiendo en fragmentos para reducir memoria y evitar límites de 30 segundos…');
    const result = await transcribeAudioInChunks(asr, audio, (percent, current, total) => {
      say(`Transcribiendo entrevista: ${percent}% · fragmento ${current}/${total}`);
    });
    const chunks = result.chunks || [];
    transcriptData = {
      source: file.name, model: modelId, language: 'es',
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
      showClipCandidates(transcriptData.segments, audio.length / 16000);
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
 