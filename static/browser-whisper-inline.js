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
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('El navegador no pudo abrir el vídeo para extraer el audio.'));
    });

    // Chromium and Firefox can capture the decoded audio track directly.
    const capture = video.captureStream || video.mozCaptureStream;
    if (capture && typeof MediaRecorder !== 'undefined') {
      stream = capture.call(video);
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length) {
        const audioStream = new MediaStream(audioTracks);
        const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
        const mime = mimeCandidates.find(type => MediaRecorder.isTypeSupported?.(type));
        recorder = mime ? new MediaRecorder(audioStream, { mimeType: mime }) : new MediaRecorder(audioStream);
        const chunks = [];
        const done = new Promise((resolve, reject) => {
          recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
          recorder.onerror = event => reject(new Error(event.error?.message || 'Falló la captura del audio.'));
          recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' }));
        });
        recorder.start(1000);
        await video.play();
        await new Promise((resolve, reject) => {
          video.onended = resolve;
          video.onerror = () => reject(new Error('El vídeo falló durante la extracción de audio.'));
        });
        if (recorder.state !== 'inactive') recorder.stop();
        const blob = await done;
        if (blob.size) return blob;
      }
    }

    // Safari may lack captureStream or audio-only MediaRecorder support.
    // Capture decoded PCM with Web Audio instead of requiring MediaRecorder.
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error('Este navegador no ofrece Web Audio para extraer el audio local. Prueba Chrome o Edge actualizado.');
    audioContext = new AudioCtx();
    if (audioContext.state === 'suspended') await audioContext.resume();
    sourceNode = audioContext.createMediaElementSource(video);
    const channels = Math.max(1, Math.min(2, video.audioTracks?.length || 2));
    processor = audioContext.createScriptProcessor(4096, channels, 1);
    const targetLength = Number.isFinite(video.duration) && video.duration > 0
      ? Math.ceil(video.duration * 16000)
      : 0;
    const pcm = new Float32Array(targetLength || Math.ceil((Number(video.duration) || 3600) * 16000));
    let outputSamples = 0;
    let sourceFramesSeen = 0;
    processor.onaudioprocess = event => {
      const input = event.inputBuffer;
      const length = input.length;
      const inputChannels = input.numberOfChannels;
      const from = outputSamples;
      while (true) {
        const absoluteSource = Math.floor(outputSamples * input.sampleRate / 16000);
        if (absoluteSource >= sourceFramesSeen + length) break;
        const local = absoluteSource - sourceFramesSeen;
        if (local < 0) { outputSamples++; continue; }
        let value = 0;
        for (let ch = 0; ch < inputChannels; ch++) value += input.getChannelData(ch)[local] / inputChannels;
        if (outputSamples < pcm.length) pcm[outputSamples++] = value;
        else break;
        if (targetLength && outputSamples >= targetLength) break;
      }
      sourceFramesSeen += length;
      // Keep the processing graph alive without playing the source through speakers.
      for (let ch = 0; ch < event.outputBuffer.numberOfChannels; ch++) event.outputBuffer.getChannelData(ch).fill(0);
    };
    sourceNode.connect(processor);
    processor.connect(audioContext.destination);
    await video.play();
    await new Promise((resolve, reject) => {
      video.onended = resolve;
      video.onerror = () => reject(new Error('El vídeo falló durante la captura PCM.'));
    });
    if (outputSamples < 16000) throw new Error('El vídeo se reprodujo, pero no se recibieron muestras de audio. Comprueba que tenga una pista de audio activa.');
    return pcm.subarray(0, outputSamples);
  } finally {
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch {}
    try { processor?.disconnect(); } catch {}
    try { sourceNode?.disconnect(); } catch {}
    try { stream?.getTracks().forEach(track => track.stop()); } catch {}
    try { await audioContext?.close(); } catch {}
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}
async function extractAudioWithFFmpegWasm(file, onProgress = () => {}) {
  // Fully local codec fallback: decode MP4/MOV audio with FFmpeg WASM.
  // No upload, native install, API key, or real-time playback is required.
  const [{ FFmpeg }, { fetchFile }] = await Promise.all([
    import('https://esm.sh/@ffmpeg/ffmpeg@0.12.15'),
    import('https://esm.sh/@ffmpeg/util@0.12.2')
  ]);
  const ffmpeg = new FFmpeg();
  const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
  const coreURL = base + '/ffmpeg-core.js';
  const wasmURL = base + '/ffmpeg-core.wasm';
  const inputName = 'clipforge-input.' + ((file.name.split('.').pop() || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4');
  const outputName = 'clipforge-audio.pcm';
  let lastProgress = -1;
  ffmpeg.on('progress', ({ progress }) => {
    const percent = Math.max(0, Math.min(100, Math.round((progress || 0) * 100)));
    if (percent !== lastProgress) { lastProgress = percent; onProgress(percent); }
  });
  try {
    await ffmpeg.load({ coreURL, wasmURL, classWorkerURL: new URL('/ffmpeg-worker.js', window.location.origin).href });
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    const exitCode = await ffmpeg.exec(['-i', inputName, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', outputName]);
    if (exitCode !== 0) throw new Error('FFmpeg no pudo decodificar la pista de audio (código ' + exitCode + ').');
    const bytes = await ffmpeg.readFile(outputName);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 64000 || bytes.byteLength % 4 !== 0) {
      throw new Error('FFmpeg no generó suficientes muestras PCM válidas.');
    }
    const aligned = bytes.byteOffset % 4 === 0
      ? bytes
      : bytes.slice();
    const audio = new Float32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 4).slice();
    if (!audio.some(value => Number.isFinite(value) && Math.abs(value) > 1e-7)) {
      throw new Error('La pista extraída no contiene audio audible.');
    }
    return audio;
  } finally {
    try { await ffmpeg.deleteFile(inputName); } catch {}
    try { await ffmpeg.deleteFile(outputName); } catch {}
    try { ffmpeg.terminate(); } catch {}
  }
}

async function extractAudioWithMediabunny(file) {
  // Mediabunny demuxes the MP4 audio track without decoding the video stream
  // or forcing the user to play the whole source in real time.
  const { Input, BlobSource, ALL_FORMATS, AudioSampleSink } =
    await import('https://esm.sh/mediabunny@1.65.2');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('El MP4 no contiene una pista de audio.');
    if (!(await track.canDecode())) throw new Error('El navegador no puede decodificar el códec de audio de este MP4.');
    // Some valid MP4/MOV files omit duration metadata. Fall back to the
    // audio track's measured duration instead of rejecting a usable source.
    const metadataDuration = await input.getDurationFromMetadata();
    const duration = Number.isFinite(metadataDuration) && metadataDuration > 0
      ? metadataDuration
      : await track.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0 || duration > 60 * 60) {
      throw new Error('ClipForge admite vídeos de hasta 60 minutos. Divide el vídeo si supera una hora.');
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
        const sourceRate = buffer.sampleRate;
        const channels = Array.from({length:buffer.numberOfChannels},(_,ch)=>buffer.getChannelData(ch));
        const channelCount = Math.max(1,channels.length);
        const targetFrames = Math.min(Math.ceil(sourceFrames * 16000 / sourceRate), mono.length - offset);
        // Do not blindly average stereo channels: interview tracks often place
        // microphones on separate channels, and phase cancellation can erase
        // speech when L/R are averaged. Pick the strongest channel per decoded
        // audio block so alternating speaker channels remain audible.
        let selectedChannel = 0;
        if (channelCount > 1) {
          let bestEnergy = -1;
          for (let ch = 0; ch < channelCount; ch++) {
            const channel = channels[ch];
            let energy = 0;
            const stride = Math.max(1, Math.floor(sourceFrames / 4096));
            for (let k = 0; k < sourceFrames; k += stride) energy += channel[k] * channel[k];
            if (energy > bestEnergy) { bestEnergy = energy; selectedChannel = ch; }
          }
        }
        const selected = channels[selectedChannel] || channels[0];
        for (let j = 0; j < targetFrames; j++) {
          const sourcePos = j * sourceRate / 16000;
          const lo = Math.min(Math.floor(sourcePos), sourceFrames - 1);
          const hi = Math.min(lo + 1, sourceFrames - 1);
          const frac = sourcePos - lo;
          mono[offset + j] = selected[lo] * (1 - frac) + selected[hi] * frac;
        }
        samples++;
      } finally { sample.close(); }
    }
    if (!samples || !mono.some(value => Math.abs(value) > 1e-7)) {
      throw new Error('No se pudieron extraer muestras de audio del MP4.');
    }
    return mono;
  } finally {
    // Explicitly release demuxer/decoder resources on success and failure.
    input.dispose();
  }
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
async function transcribeAudioInChunks(asr, audio, onProgress = () => {}, timestampMode = 'word', language = null) {
  const sampleRate = 16000;
  // Whisper accepts up to 30 seconds per inference. Use almost the full
  // context and a short overlap to reduce sequential model calls on long videos.
  const windowSeconds = 30;
  const overlapSeconds = 1.25;
  const windowSamples = windowSeconds * sampleRate;
  const stepSamples = (windowSeconds - overlapSeconds) * sampleRate;
  const totalSeconds = audio.length / sampleRate;
  const allChunks = [];
  const windowDiagnostics = [];
  // Only adjacent Whisper windows can produce duplicate phrases: each window
  // overlaps the previous one by two seconds. Keep a tiny rolling comparison
  // set instead of scanning the entire transcript for every recognized word.
  let recentChunks = [];
  const fullText = [];
  const totalParts = Math.max(1, Math.ceil(Math.max(0, audio.length - windowSamples) / stepSamples) + 1);

  for (let startSample = 0, part = 0; startSample < audio.length; startSample += stepSamples, part++) {
    const endSample = Math.min(audio.length, startSample + windowSamples);
    const result = await asr(audio.subarray(startSample, endSample), {
      // A selected language improves consistency; undefined lets Whisper detect
      // whether the source is Spanish or English automatically.
      language: language === 'es' ? 'spanish' : language === 'en' ? 'english' : undefined,
      task: 'transcribe',
      return_timestamps: timestampMode
    });
    const offset = startSample / sampleRate;
    const chunkText = String(result.text || '').trim();
    if (chunkText) fullText.push(chunkText);

    const rawChunks = Array.isArray(result.chunks) ? result.chunks : [];
    windowDiagnostics.push({ part: part + 1, start: Number(offset.toFixed(2)), duration: Number(((endSample-startSample)/sampleRate).toFixed(2)), textWords: (chunkText.match(/\S+/g)||[]).length, rawTimedChunks: rawChunks.length, firstChunkKeys: rawChunks[0] ? Object.keys(rawChunks[0]) : [], firstTimestamp: rawChunks[0]?.timestamp ?? rawChunks[0]?.timestamps ?? rawChunks[0]?.time ?? null });
    for (let chunkIndex = 0; chunkIndex < rawChunks.length; chunkIndex++) {
      const chunk = rawChunks[chunkIndex];
      const rawTimestamp = chunk.timestamp ?? chunk.timestamps ?? chunk.time;
      let rawStart = Array.isArray(rawTimestamp) ? rawTimestamp[0] : rawTimestamp?.start;
      let rawEnd = Array.isArray(rawTimestamp) ? rawTimestamp[1] : rawTimestamp?.end;
      // Some Whisper ONNX exports omit the final end timestamp (or emit null
      // for a boundary token). Recover only from adjacent model timestamps;
      // never invent evenly-spaced timings from the transcript text.
      const nextChunk = rawChunks[chunkIndex + 1];
      const nextTimestamp = nextChunk?.timestamp ?? nextChunk?.timestamps ?? nextChunk?.time;
      const nextStart = Array.isArray(nextTimestamp) ? nextTimestamp[0] : nextTimestamp?.start;
      const previous = allChunks[allChunks.length - 1];
      let localStart = rawStart == null ? (previous ? previous.end - offset : 0) : Number(rawStart);
      let localEnd = rawEnd == null ? (nextStart != null ? Number(nextStart) : endSample / sampleRate - offset) : Number(rawEnd);
      const text = String(chunk.text || '').trim();
      if (!text || !Number.isFinite(localStart) || !Number.isFinite(localEnd)) continue;
      localStart = Math.max(0, localStart);
      localEnd = Math.min((endSample-startSample)/sampleRate, Math.max(localStart, localEnd));
      const absoluteStart = Math.max(0, offset + localStart);
      const absoluteEnd = Math.min(totalSeconds, offset + localEnd);
      if (absoluteEnd <= absoluteStart) continue;
      // Keep words recognized only in the next window's overlap.
      // Deduplicate matching words by timestamp rather than discarding the overlap.
      const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
      recentChunks = recentChunks.filter(previous => previous.end >= absoluteStart - 0.45);
      const duplicate = recentChunks.some(previous => {
        const previousText=previous.text.toLowerCase().replace(/\s+/g,' ').trim();
        const overlap=Math.max(0,Math.min(previous.end,absoluteEnd)-Math.max(previous.start,absoluteStart));
        // Only remove a genuinely repeated token/phrase at almost the same
        // timestamp. Similarity-only matching dropped repeated words such as
        // "sí", "no", "que" across nearby dialogue and could erase speech.
        const sameText=previousText===normalized;
        return sameText && Math.abs(previous.start-absoluteStart)<0.22 && overlap>0;
      });
      if (!duplicate) {
        const item={ start: absoluteStart, end: absoluteEnd, text };
        allChunks.push(item);
        recentChunks.push(item);
      }
    }
    onProgress(Math.min(100, Math.round(endSample / audio.length * 100)), part + 1, totalParts);
    if (endSample === audio.length) break;
  }

  allChunks.sort((a, b) => a.start - b.start);
  return { text: fullText.join(' ').replace(/\s+/g, ' ').trim(), chunks: allChunks, diagnostics: { audioSeconds: Number(totalSeconds.toFixed(2)), windows: windowDiagnostics } };
}

// Fully local speaker diarization with the public ONNX pyannote model.
// It assigns anonymous speaker IDs; it does not identify real-world people.
async function diarizeAudioLocally(audio, onProgress = () => {}) {
  const { AutoProcessor, AutoModelForAudioFrameClassification } =
    await import('https://esm.sh/@huggingface/transformers@3.7.2');
  const modelId = 'onnx-community/pyannote-segmentation-3.0';
  onProgress('Cargando modelo local de separación de hablantes…');
  const [processor, model] = await Promise.all([
    AutoProcessor.from_pretrained(modelId),
    AutoModelForAudioFrameClassification.from_pretrained(modelId, { dtype: 'q8' })
  ]);
  try {
    const inputs = await processor(audio);
    const { logits } = await model(inputs);
    const turns = processor.post_process_speaker_diarization(logits, audio.length);
    return (turns?.[0] || turns || []).map(turn => ({
      start: Number(turn.start), end: Number(turn.end),
      speaker: Number(turn.id ?? turn.speaker),
      confidence: Number(turn.confidence ?? 0)
    })).filter(turn => Number.isFinite(turn.start) && Number.isFinite(turn.end) && turn.end > turn.start && Number.isFinite(turn.speaker));
  } finally {
    try { await model.dispose?.(); } catch {}
  }
}

function assignSpeakerToTranscriptSegments(segments, turns) {
  if (!Array.isArray(turns) || !turns.length) return segments;
  return segments.map(segment => {
    let bestSpeaker = null, bestOverlap = 0;
    for (const turn of turns) {
      const overlap = Math.max(0, Math.min(segment.end, turn.end) - Math.max(segment.start, turn.start));
      if (overlap > bestOverlap) { bestOverlap = overlap; bestSpeaker = turn.speaker; }
    }
    return bestSpeaker === null ? segment : { ...segment, speaker: bestSpeaker, speaker_label: 'Hablante ' + (bestSpeaker + 1) };
  });
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


 // Sample low-resolution frames locally. Frame-to-frame change is a
 // language- and genre-independent signal for cuts, movement and visual activity.
 async function captureVisualActivity(file, duration, stepSeconds = 4) {
  if (!file || !Number.isFinite(duration) || duration < 3) return [];
  const video=document.createElement('video'); video.muted=true; video.playsInline=true; video.preload='auto';
  const url=URL.createObjectURL(file); video.src=url;
  const canvas=document.createElement('canvas'); canvas.width=64; canvas.height=36;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const wait=(event)=>new Promise((resolve,reject)=>{const ok=()=>{cleanup();resolve();};const bad=()=>{cleanup();reject(new Error('No se pudieron analizar los fotogramas del vídeo.'));};const cleanup=()=>{video.removeEventListener(event,ok);video.removeEventListener('error',bad);};video.addEventListener(event,ok,{once:true});video.addEventListener('error',bad,{once:true});});
  try {
   await Promise.race([wait('loadedmetadata'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Tiempo agotado leyendo el vídeo.')),15000))]);
   if(video.readyState<2)await Promise.race([wait('loadeddata'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Tiempo agotado decodificando el primer fotograma.')),15000))]);
   const samples=[]; let previous=null;
   for(let t=0;t<duration;t+=stepSeconds){
    if(t>0){video.currentTime=Math.min(t,Math.max(0,duration-.05));await Promise.race([wait('seeked'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Tiempo agotado analizando fotogramas.')),5000))]);}
    try{ctx.drawImage(video,0,0,64,36);}catch{continue;}
    const data=ctx.getImageData(0,0,64,36).data;const gray=new Uint8Array(64*36);
    for(let i=0,j=0;i<data.length;i+=4,j++)gray[j]=(data[i]*.299+data[i+1]*.587+data[i+2]*.114)|0;
    let change=0;if(previous){for(let i=0;i<gray.length;i++)change+=Math.abs(gray[i]-previous[i]);change/=gray.length*255;}
    samples.push({t,change});previous=gray;
   }
   return samples;
  }catch(error){console.warn('Análisis visual local no disponible:',error);return [];}
  finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
 }

// Editorial ranking: balanced hooks, coherent setup/payoff, dialogue, pace and clean boundaries.
// Las puntuaciones heurísticas no equivalen a una predicción de viralidad.
// It is a transparent local editorial score, not a promise of virality or a copy of OpusClip's model.
function rankClipCandidates(words, videoDuration, audioSamples = null, sampleRate = 16000, visualSamples = [], limit = 4) {
  // Lightweight acoustic profile from the already-decoded audio. It adds a
  // free, on-device signal for energetic moments and avoids sending media away.
  const audioWindow = 0.5;
  const energy = [];
  if (audioSamples && audioSamples.length) {
    const n = Math.ceil(audioSamples.length / (sampleRate * audioWindow));
    for (let k = 0; k < n; k++) {
      const from = Math.floor(k * sampleRate * audioWindow);
      const to = Math.min(audioSamples.length, Math.floor((k + 1) * sampleRate * audioWindow));
      let sum = 0, peak = 0;
      for (let j = from; j < to; j++) { const v = audioSamples[j]; sum += v * v; peak = Math.max(peak, Math.abs(v)); }
      energy.push({ t: k * audioWindow, rms: Math.sqrt(sum / Math.max(1, to - from)), peak });
    }
  }
  const sortedRms = energy.map(x => x.rms).sort((a,b) => a-b);
  const quantile = q => sortedRms.length ? sortedRms[Math.min(sortedRms.length-1, Math.floor((sortedRms.length-1)*q))] : 0;
  const energyFloor = quantile(.2), energyMedian = quantile(.5), energyTop = quantile(.9);
  const energySpan = Math.max(1e-5, energyTop - energyFloor);
  const visualAvailable=visualSamples.length>1;
  const selectionLimit=Math.max(1,Math.min(12,Math.floor(Number(limit)||4)));

  const minLen = 15, maxLen = 45, targetLen = 24;
  const sentenceEnd = /(?<![.])[.!?](?![.])[”’\"')\]]?$/;
  const strongHook = /(?<![\p{L}\p{N}_])(¿qué|quién|cómo|por qué|qué pasa|no me digas|madre mía|increíble|imagina|resulta que|la verdad|nunca|jamás|te juro|no sabía|de repente|en serio|qué fuerte|qué locura|qué dices|a ver si|dime|tell me|what|who|how|why|guess what|you will not believe|unbelievable|imagine|turns out|never|suddenly|seriously|that is crazy|no way)(?![\p{L}\p{N}_])/iu;
  const payoff = /(?<![\p{L}\p{N}_])(al final|resulta que|y entonces|por eso|exactamente|efectivamente|claro|ya te avisaremos|te avisaremos|no|sí|eso|ahí|pues|ya está|lo consiguió|lo he hecho|no puede ser|in the end|turns out|that is why|exactly|actually|that is it|he did it|I did it|cannot believe|there it is|finalement|en fait|exactement|bien sûr|voilà|c’est ça|por fim|no final|na verdade|exatamente|no fim|am ende|genau|natürlich|tatsächlich|so ist es|ecco|alla fine|esattamente|certo|è così)(?![\p{L}\p{N}_])/iu;
  const emotional = /(?<![\p{L}\p{N}_])(risa|risas|riendo|llor|miedo|vergüenza|sorpresa|increíble|brutal|absurdo|ridículo|flipante|hostia|joder|buah|ostras|madre mía|qué fuerte|dios|ja ja|jajaja|puf|potencia|a huevo|bolas|laugh|laughing|cry|scared|embarrassed|surprised|insane|crazy|ridiculous|awesome|damn|wow|oh my god|no way|rire|rires|mort de rire|fou|incroyable|peur|honte|surpris|wahnsinn|verrückt|angst|peinlich|überrascht|lachen|risada|risadas|louco|medo|vergonha|surpreso|risate|pazzesco|paura|imbarazzo|sorpreso)(?![\p{L}\p{N}_])/iu;
  const promotionalPattern = /(?<![\p{L}\p{N}_])(suscr[ií]bete|suscr[ií]banse|s[ií]guenos|s[ií]gueme|dale like|darle like|regalamos|sorteo|participa(r|ci[oó]n)|papeletas extras|c[oó]digo de descuento|link en la descripci[oó]n|patrocinado|colaboraci[oó]n pagada|iphone(?:\s*\d+)?|giving away|win a (?:free|new)|subscribe|follow us|follow me|giveaway|enter to win|use code|discount code|link in bio|sponsored|paid partnership|free iphone)(?![\p{L}\p{N}_])/iu;
  const filler = /(?<![\p{L}\p{N}_])(este|esto|eh|em|mmm|pues|vale|bueno|a ver|en plan|o sea|uh|um|erm|like|you know|I mean|well|euh|ben|bah|enfin|genre|tu sais|donc|also|äh|ähm|na ja|halt|sozusagen|tipo|né|então|assim|quer dizer|cioè|allora|diciamo|insomma)(?![\p{L}\p{N}_])/giu;
  const reactionWord = /(?<![\p{L}\p{N}_])(puf|potencia|dios|bolas|a huevo|jaj+a+|risas?|hostia|buah|ostras|flipante|brutal|wow|damn|no way|oh my god|insane|awesome|rires?|mort de rire|incroyable|wahnsinn|verrückt|risadas?|incrível|pazzesco|risate)(?![\p{L}\p{N}_])/giu;
  const storyPivot = /(?<![\p{L}\p{N}_])(se acabó|lo más importante|tienes que saber|para acabar|una preguntita|esto es|y entonces|ahora|here is the thing|the point is|what happened next|and then|but then|long story short|here is why|voici le truc|et puis|tout à coup|en fait|voilà pourquoi|a questão é|e então|de repente|a verdade é|hier ist der punkt|und dann|plötzlich|am ende|il punto è|e poi|all’improvviso|alla fine)(?![\p{L}\p{N}_])/iu;
  const clean = words.filter(w => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start && String(w.text||'').trim())
    .map(w=>({start:Number(w.start),end:Number(w.end),text:String(w.text).trim()})).sort((a,b)=>a.start-b.start);
  // Non-speech media (music, gameplay, sports, scenic footage, sound design)
  // must not fail just because Whisper has nothing to transcribe. In that case
  // rank evenly distributed windows from the actual audio activity profile.
  // This is deliberately a fallback, not a claim of semantic highlight detection.
  if (!clean.length) {
    if ((!energy.length && !visualAvailable) || !Number.isFinite(videoDuration) || videoDuration < 15) return [];
    const minAudioLen=15, maxAudioLen=45;
    const windowLen=Math.min(maxAudioLen,Math.max(minAudioLen,Math.min(24,videoDuration/4)));
    const hop=Math.max(2.5,windowLen/3);
    const candidates=[];
    for(let start=0;start+minAudioLen<=videoDuration+.001;start+=hop){
      const end=Math.min(videoDuration,start+windowLen);
      if(end-start<minAudioLen)continue;
      const slice=energy.filter(x=>x.t>=start&&x.t<end);
      const values=slice.map(x=>Math.max(0,Math.min(1,(x.rms-energyFloor)/energySpan)));
      const mean=values.length?values.reduce((a,b)=>a+b,0)/values.length:0;
      const active=values.length?values.filter(v=>v>.2).length/values.length:0;
      const peaks=values.length?values.filter(v=>v>.72).length/values.length:0;
      const transitions=values.slice(1).filter((v,i)=>Math.abs(v-values[i])>.22).length/Math.max(1,values.length-1);
      const visualChanges=visualSamples.filter(x=>x.t>=start&&x.t<end).map(x=>x.change);
      const visualMean=visualChanges.length?visualChanges.reduce((a,b)=>a+b,0)/visualChanges.length:0;
      if(!slice.length&&!visualChanges.length)continue;
      const score=Math.round(Math.max(0,Math.min(100,mean*38+active*18+peaks*14+transitions*8+Math.min(1,visualMean*5)*22)));
      const reasons=[];if(energy.length)reasons.push('actividad sonora');if(visualChanges.length)reasons.push('movimiento y cambios visuales');reasons.push('momento sin diálogo');
      candidates.push({start,end,duration:end-start,score,text:'',reasons});
    }
    const chosen=[];
    // Prefer coverage across the whole source, then fill with strongest
    // remaining windows without overlap. A quiet source still gets candidates.
    const quarters=Array.from({length:4},(_,i)=>({a:videoDuration*i/4,b:videoDuration*(i+1)/4}));
    for(const q of quarters){
      const options=candidates.filter(c=>c.start<q.b&&c.end>q.a&&!chosen.some(x=>c.start<x.end+1&&c.end>x.start-1));
      if(options.length)chosen.push(options.sort((a,b)=>b.score-a.score)[0]);
    }
    for(const c of [...candidates].sort((a,b)=>b.score-a.score)){
      if(chosen.length>=Math.min(selectionLimit,candidates.length))break;
      if(!chosen.some(x=>c.start<x.end+1&&c.end>x.start-1))chosen.push(c);
    }
    return chosen.sort((a,b)=>a.start-b.start).map((c,i)=>({...c,title:`Momento ${i+1}`}));
  }
  // Whisper Small in Transformers.js returns reliable phrase-level timestamps
  // without cross-attention export. Detect that shape so editorial features
  // count actual words, not phrase chunks, and don't mistake every subtitle
  // boundary for a speaker turn.
  const averageTokensPerSegment=clean.reduce((n,w)=>n+(w.text.match(/\S+/g)||[]).length,0)/clean.length;
  const phraseTimed=averageTokensPerSegment>1.7;
  const candidates=[];
  const stepSeconds=1.25;
  let nextStart=clean[0].start;
  for(let i=0;i<clean.length;i++){
    if(clean[i].start+0.05<nextStart) continue;
    // Snap to a sentence/turn opening near the sampled point.
    let si=i;
    for(let p=i;p>=0 && clean[i].start-clean[p].start<=8.5;p--){
      if(p===0 || sentenceEnd.test(clean[p-1].text) || clean[p].start-clean[p-1].end>0.72){si=p;break;}
    }
    // Include the immediately preceding question when a candidate opens with its answer.
    let precedingQuestion=-1;
    for(let p=si-1;p>=0&&clean[si].start-clean[p].start<=8.5;p--){if(sentenceEnd.test(clean[p].text)&&/[?¿]/.test(clean[p].text)){precedingQuestion=p;break;}}
    if(precedingQuestion>=0){let q=precedingQuestion;while(q>0&&clean[precedingQuestion].start-clean[q-1].start<=3.5&&!sentenceEnd.test(clean[q-1].text))q--;si=q;}
    // A clip opening on a terse reply ("No.", "Sí.", "Exactly.") is usually
    // missing the setup. Pull in the preceding continuous exchange even when
    // ASR punctuation failed to mark the host's prompt as a question.
    let firstUtteranceEnd=si;
    while(firstUtteranceEnd+1<clean.length&&
      clean[firstUtteranceEnd+1].start-clean[firstUtteranceEnd].end<=.72&&
      !sentenceEnd.test(clean[firstUtteranceEnd].text)) firstUtteranceEnd++;
    const firstUtterance=clean.slice(si,firstUtteranceEnd+1).map(w=>w.text).join(' ').trim();
    const firstUtteranceWords=(firstUtterance.match(/[\p{L}\p{N}]{2,}/gu)||[]).length;
    const terseReply=/^(?:sí|si|no|claro|vale|exacto|exactamente|eso|ya|ajá|aja|right|yeah|yes|nope|exactly|sure|okay|ok|of course)[.!?,…]*$/i.test(firstUtterance);
    const shortQuestion=/^(?:¿?(?:cómo es|qué es|quién es|qué pasó|qué|quién|cómo|why|what|who|how)\??)$/i.test(firstUtterance);
    if((terseReply&&firstUtteranceWords<=3)||(shortQuestion&&firstUtteranceWords<=4)){
      let contextStart=si;
      for(let p=si-1;p>=0&&clean[si].start-clean[p].start<=8.5;p--){
        if(clean[p+1].start-clean[p].end>1.2)break;        contextStart=p;
      }
      si=contextStart;
    }
    const start=clean[si].start;
    if(start>videoDuration-minLen) break;
    let endIndex=-1;
    const possible=[];
    for(let j=si;j<clean.length && clean[j].end-start<=maxLen;j++){
      const dur=clean[j].end-start;
      const endpointText=clean.slice(si,j+1).map(w=>w.text).join(' ');
      const endpointTail=clean.slice(Math.max(si,j-13),j+1).map(w=>w.text).join(' ');
      const completeAnswer=/[¿?]/.test(endpointText)&&/\b(claro|efectivamente|exactamente|ya te avisaremos|te avisaremos|te lo digo|así es|eso es|that is why|exactly|there it is|turns out)\b/i.test(endpointTail);
      const validBoundary=sentenceEnd.test(clean[j].text)||j===clean.length-1||(j+1<clean.length&&clean[j+1].start-clean[j].end>0.72);
      if((dur>=minLen||dur>=16&&completeAnswer)&&validBoundary)possible.push(j);
    }
    if(!possible.length) continue;
    // Prefer a natural endpoint around 24–30 seconds, but let a complete
    // question-and-answer beat finish early rather than adding unrelated tail.
    const endpointCost=index=>{
      const ending=clean.slice(Math.max(si,index-13),index+1).map(w=>w.text).join(' ');
      const whole=clean.slice(si,index+1).map(w=>w.text).join(' ');
      const hasQuestion=/[¿?]/.test(whole);
      const answered=/\b(claro|efectivamente|exactamente|ya te avisaremos|te avisaremos|te lo digo|así es|eso es|that is why|exactly|there it is|turns out)\b/i.test(ending);
      const payoffAtBoundary=/\b(ya te avisaremos|te avisaremos|te lo digo|así es|eso es|there it is|turns out)\s*[.!?]?$/i.test(ending);
      const complete=sentenceEnd.test(clean[index].text);
      const semanticBonus=(hasQuestion&&answered?12:answered?5:0)+(payoffAtBoundary?10:0);
      // Don't cut immediately after an answer if the speaker continues the
      // same beat in the next breath; keep the follow-up reaction together.
      const unfinishedFollowup=payoffAtBoundary&&index+1<clean.length&&clean[index+1].start-clean[index].end<.72;
      const nextText=clean.slice(index+1,Math.min(clean.length,index+10)).map(w=>w.text).join(' ');
      const nextGap=index+1<clean.length?clean[index+1].start-clean[index].end:99;
      const followupReaction=nextGap<2.5&&(/[!¡]/.test(nextText)||/\b(uy|hala|ahí va|wow|no way|oh my god)\b/i.test(nextText));
      const handoff=/\b(pásale al siguiente|pasamos al siguiente|vamos con el siguiente|momento de descartar|continúa el vídeo|siguiente|next one|next person|moving on)\b/i.test(whole);
      return Math.abs((clean[index].end-start)-targetLen)-semanticBonus-(complete?1.5:0)+(followupReaction?8:0)+(handoff?18:0)+(unfinishedFollowup?12:0);
    };
    endIndex=possible.sort((x,y)=>endpointCost(x)-endpointCost(y))[0];
    const group=clean.slice(si,endIndex+1), end=group[group.length-1].end, duration=end-start;
    const text=group.map(w=>w.text).join(' '), lower=text.toLowerCase();
    const promotional=promotionalPattern.test(text);
    const tokens=lower.match(/[\p{L}\p{N}]{2,}/gu)||[];
    const uniqueRatio=new Set(tokens).size/Math.max(1,tokens.length);
    const wordsPerSecond=tokens.length/Math.max(1,duration);
    const questionCount=(text.match(/[¿?]/g)||[]).length;

    const turnCount=group.slice(1).filter((w,i)=>
      w.start-group[i].end>(phraseTimed?1.15:.55) || /^[-–—]/.test(w.text)
    ).length;
    const turnScore=Math.min(10,turnCount*1.25);
    const exclamationCount=(text.match(/[¡!]/g)||[]).length;
    const laughCount=(text.match(/\b(risas?|jaj+a+|ja ja|carcajadas?|puf|¡dios!|mira,? mira|a huevo|bolas)\b/gi)||[]).length;
    const reactionCount=(text.match(reactionWord)||[]).length;
    const pivot=storyPivot.test(text);
    const openingTokens=(text.match(/\S+/g)||[]).slice(0,8).join(' ');
    const closingTokens=(text.match(/\S+/g)||[]).slice(-8).join(' ');
    const hookAtStart=strongHook.test(openingTokens);
    const questionAtStart=/^\s*¿(?:y\s+)?(?:qué|quién|cómo|cuándo|dónde|por qué|cuál|what|who|how|when|where|why|which)\b/i.test(text);
    const payoffAtEnd=payoff.test(closingTokens);
    const questionAnswered=/[¿?]/.test(text)&&/\b(claro|efectivamente|exactamente|ya te avisaremos|te avisaremos|te lo digo|así es|eso es|there it is|turns out)\b/i.test(text);
    const answerClosedAtEnd=/\b(avisaremos|te lo digo|así es|eso es|there it is|turns out)\s*[.!?]?$/i.test(closingTokens);
    const utterances=[];let utterance=[];
    for(let u=0;u<group.length;u++){const item=group[u],previous=group[u-1];if(utterance.length&&previous&&(sentenceEnd.test(previous.text)||item.start-previous.end>.78)){utterances.push(utterance);utterance=[];}utterance.push(item);}
    if(utterance.length)utterances.push(utterance);
    const utteranceText=items=>items.map(x=>x.text).join(' ').trim();
    const shortAnswerReaction=utterances.some((items,index)=>{
      if(index<1||index>=utterances.length-1)return false;
      const before=utteranceText(utterances[index-1]),answer=utteranceText(items),after=utteranceText(utterances[index+1]);
      const answerWords=(answer.match(/[\p{L}\p{N}]{2,}/gu)||[]).length;
      return /[?¿]\s*[”’\"')\]]?$/.test(before)&&answerWords>=1&&answerWords<=5&&(/[!¡]/.test(after)||new RegExp(reactionWord.source,reactionWord.flags.replace('g','')).test(after));
    });
    // A concise answer followed by an immediate interviewer reaction/question
    // is often the strongest self-contained beat in quiz, challenge and
    // street-interview formats. It catches punchlines without literal keywords.
    const questionAnswerExchange=utterances.some((items,index)=>{
      if(index<1||index>=utterances.length-1)return false;
      const before=utteranceText(utterances[index-1]),answer=utteranceText(items),after=utteranceText(utterances[index+1]);
      const answerWords=(answer.match(/[\p{L}\p{N}]{2,}/gu)||[]).length;
      const followupReaction=/[?¿!¡]/.test(after)||new RegExp(reactionWord.source,reactionWord.flags.replace('g','')).test(after)||/\\b(no|pero|cómo|por qué|en serio|de verdad|really|wait|but)\\b/i.test(after);
      return /[?¿]\\s*[”’\"')\\]]?$/.test(before)&&answerWords>=1&&answerWords<=9&&followupReaction;
    });
    // Score the shape of the conversation, not just isolated words.
    // A complete exchange has a setup, an answer and a reaction/follow-up;
    // a longer back-and-forth is stronger evidence of a real moment.
    const utteranceCount=utterances.length;
    const hasQuestionUtterance=utterances.some(items=>/[?¿]/.test(utteranceText(items)));
    const hasAnswerUtterance=utterances.some((items,index)=>index>0&&index<utterances.length-1&&
      (utteranceText(items).match(/[\p{L}\p{N}]{2,}/gu)||[]).length>=1);
    const confirmationReaction=/\b(sería lo bien|sería lo suyo|tal cual|claro|exacto|exactamente|eso es|right|exactly|fair enough|makes sense|that is right)\b/i;
    const hasReactionUtterance=utterances.some((items,index)=>index>0&&
      (/[!¡]/.test(utteranceText(items))||new RegExp(reactionWord.source,reactionWord.flags.replace('g','')).test(utteranceText(items))||confirmationReaction.test(utteranceText(items))));
    const completeConversationBeat=hasQuestionUtterance&&hasAnswerUtterance&&hasReactionUtterance;
    const multiTurnExchange=utteranceCount>=4;
    const shortAnswerFollowup=utterances.some((items,index)=>{
      if(index<1||index>=utterances.length-1)return false;
      const before=utteranceText(utterances[index-1]),answer=utteranceText(items),after=utteranceText(utterances[index+1]);
      const answerWords=(answer.match(/[\p{L}\p{N}]{2,}/gu)||[]).length;
      const followup=/[?¿!¡]/.test(after)||new RegExp(reactionWord.source,reactionWord.flags.replace('g','')).test(after)||confirmationReaction.test(after);
      return /[?¿]\s*[”’"')\]]?$/.test(before)&&answerWords>=1&&answerWords<=12&&followup;
    });
    const dialogueProgression=utteranceCount>=3&&turnCount>=(phraseTimed?2:4);
    // Questions are only strong short-form moments when the selected window
    // also contains an intelligible answer or a clear payoff.
    const questionHasAnswer=questionCount>0&&(
      questionAnswered||shortAnswerReaction||questionAnswerExchange||answerClosedAtEnd||
      /\b(porque|por eso|resulta que|la razón|es que|because|that's why|the reason|turns out|actually)\b/i.test(text)
    );
    const weakOpening=/^(?:bienvenidos|buenas(?: tardes| noches)?|hola,? buenas|formato nuevo|arrancamos|empezamos|antes de que continúe|oye,? antes de|welcome back|hello everyone|new format|let's get started)\b/i.test(text.trim());
    const transitionOnly=/\b(?:pasamos al siguiente|vamos con el siguiente|siguiente participante|continuamos con|momento de publicidad|antes de continuar el vídeo|moving on to the next|next contestant)\b/i.test(text.trim());
    // A window that captures the hand-off AND the next person's introduction
    // is usually two unrelated beats stitched together. Do not penalize a
    // hand-off near the beginning when a proper punchline follows it.
    const handoffIntroMatch=text.match(/\b(?:pásale al siguiente|pasamos al siguiente|siguiente|next one|next person)\b[\s\S]{0,110}\b(?:hola,? buenas|me llamo|mi nombre es|hello,? my name is|i'm called)\b/i);
    const afterHandoffIntro=handoffIntroMatch?text.slice(handoffIntroMatch.index+handoffIntroMatch[0].length).trim():'';
    const newSceneTail=Boolean(handoffIntroMatch&&afterHandoffIntro.split(/\s+/).length<=15&&!/\b(?:jaj+a+|risas?|hostia|buah|wow|no way|madre mía|no puede ser|increíble|that's crazy|oh my god)\b/i.test(afterHandoffIntro));
    const lastSentence=group.slice(-4).map(w=>w.text).join(' ').trim();
    const unansweredEnding=/[?¿]\s*$/.test(lastSentence)&&!/(?:\b(?:sí|si|no|claro|exacto|exactamente|porque|por eso|that's why|because|right|yeah|yes|nope)\b)/i.test(lastSentence);
    const hasSetup=/\b(pero|porque|cuando|si|aunque|resulta que|me dijo|y entonces|imagina|una vez)\b/i.test(text);
    const hasTurn=/\b(pero|aunque|sin embargo|de repente|entonces|al final|resulta que|y va|me dijo|y me dice)\b/i.test(text);
    // Additional capped editorial signals: narrative reveal, conflict, stakes
    // and concrete detail. They complement context/structure; keywords alone
    // cannot turn a weak or incomplete exchange into a strong candidate.
    const revelation=/\b(resulta que|no me esperaba|nadie sabía|nunca pensé|jamás pensé|la verdad es que|te voy a contar|no te imaginas|de repente|al final descubrí|turns out|i never expected|nobody knew|the truth is|i never thought|what happened was|all of a sudden)\b/i.test(text);
    const conflict=/\b(no estoy de acuerdo|estás equivocado|es una locura|me parece fatal|no tiene sentido|estoy harto|no soporto|polémica|controversia|i disagree|you're wrong|that's insane|makes no sense|i'm fed up|can't stand|controversial)\b/i.test(text);
    const stakes=/\b(gané|perdí|eliminad[oa]|descalificad[oa]|me echaron|me despidieron|decidimos|decidió|se acabó|rompimos|descubrimos|won|lost|eliminated|disqualified|fired me|we decided|it was over|we broke up|discovered)\b/i.test(text);
    // Story signals look for an actual anecdote arc, not just isolated viral-sounding words.
    const anecdote=/\b(una vez|el otro día|hace unos días|cuando era|cuando fui|me pasó|me ocurrió|estaba en|íbamos|fui a|one time|the other day|a few days ago|when i was|when i went|it happened to me|i was at|we were going|i went to)\b/i.test(text);
    const progression=/\b(hasta que|pero entonces|y de repente|al cabo de|después de eso|al final|and then|until suddenly|but then|after that|eventually|in the end)\b/i.test(text);
    const strongOpinion=/\b(para mí|en mi opinión|yo creo que|lo mejor es|lo peor es|me parece que|i think|in my opinion|for me|the best part|the worst part|i believe)\b/i.test(text);
    const closingReaction=/\b(jaj+a+|risas?|carcajadas?|no puede ser|qué fuerte|madre mía|hostia|buah|wow|no way|oh my god|you are kidding|are you serious|that's crazy)\b/i.test(closingTokens);
    const concreteDetail=(text.match(/(?:\b\d{1,4}(?:[.,]\d+)?\s?(?:euros?|€|dólares?|\$|por ciento|%|años?|días?|horas?|kilos?|kg)\b|\b\d{2,4}\b)/gi)||[]).length;
    const specificityScore=Math.min(5,concreteDetail*1.5);
    const fillerCount=(text.match(filler)||[]).length;
    const abruptStart=/^(y|pero|porque|que|cuando|si|aunque|entonces|de)\b/i.test(text.trim());
    // Reject windows that begin with a clipped hesitation or an unfinished
    // word: they are poor standalone hooks even when the middle is lively.
    const fragmentStart=/^(?:me|yo|eh|em|mmm|uh|um)\s*(?:\.{2,}|…)/i.test(text.trim());
    const last=group[group.length-1].text;
    const completeEnd=sentenceEnd.test(last);
    const durationScore=Math.max(0,1-Math.abs(duration-targetLen)/19);
    const acoustic = energy.filter(x => x.t >= start && x.t < end);
    const activeRatio = acoustic.length ? acoustic.filter(x => x.rms > Math.max(energyFloor * 1.35, energyMedian * .42)).length / acoustic.length : 0;
    const meanEnergy = acoustic.length ? acoustic.reduce((sum,x)=>sum+x.rms,0)/acoustic.length : 0;
    const peakEnergy = acoustic.length ? Math.max(...acoustic.map(x=>x.rms)) : 0;
    const energyLift = energy.length ? Math.max(0,Math.min(1,(meanEnergy-energyFloor)/energySpan)) : 0;
    const energyContrast = energy.length ? Math.max(0,Math.min(1,(peakEnergy-meanEnergy)/energySpan)) : 0;
    const acousticScore = energy.length ? Math.round(activeRatio*5 + energyLift*4 + energyContrast*3) : 0;
    const visualChanges=visualSamples.filter(x=>x.t>=start&&x.t<end).map(x=>x.change);
    const visualMean=visualChanges.length?visualChanges.reduce((a,b)=>a+b,0)/visualChanges.length:0;
    const visualScore=visualChanges.length?Math.round(Math.min(10,visualMean*50)):0;
    const paceScore=Math.max(0,Math.min(1,(wordsPerSecond-1.15)/2.1));
    const lexicalScore=Math.max(0,Math.min(1,(uniqueRatio-.28)/.42));
    const rawScore = 15 + durationScore*10 + paceScore*12 + lexicalScore*8 +
      (hookAtStart?12:0) + (questionAtStart?12:0) + Math.min(6,questionCount*1.5) + Math.min(10,exclamationCount*2.5) + turnScore +
      Math.min(14,laughCount*7) + Math.min(18,reactionCount*4) + (pivot?8:0) + (hasSetup?6:0) + (hasTurn?6:0) +
      (payoffAtEnd?8:0) + (questionAnswered?16:0) + (shortAnswerReaction?18:0) + (questionAnswerExchange?22:0) + (shortAnswerFollowup?18:0) + (completeConversationBeat?15:0) + (multiTurnExchange?5:0) + (dialogueProgression?6:0) + (answerClosedAtEnd?12:0) + (questionHasAnswer?8:0) + (pivot&&completeEnd?5:0) + (completeEnd?7:0) + (revelation?10:0) + (conflict?7:0) + (stakes?9:0) + (anecdote?7:0) + (progression?8:0) + (strongOpinion?4:0) + (closingReaction?5:0) + specificityScore + acousticScore + visualScore - Math.min(12,fillerCount*.8) -
      (questionAtStart&&!questionHasAnswer?9:0) - (questionCount>=3&&!questionAnswered?5:0) - (abruptStart?18:0) - (fragmentStart?14:0) - (!completeEnd?8:0) - (promotional?55:0) - (weakOpening?18:0) - (transitionOnly?22:0) - (newSceneTail?22:0) - (unansweredEnding?9:0) - (wordsPerSecond<1.1?8:0);
    // Compress the raw weighted sum to avoid the previous ceiling effect where
    // several very different moments all received 100/100.
    const score = Math.max(0, Math.min(100, Math.round(rawScore / 1.5)));
    const reasons=[];
    if(hookAtStart)reasons.push('inicio que despierta curiosidad');
    if(questionCount)reasons.push('pregunta o interacción');
    if(questionAtStart)reasons.push('pregunta que abre el momento');
    if(turnCount>=(phraseTimed?2:5))reasons.push('diálogo dinámico');
    if(exclamationCount||laughCount||reactionCount)reasons.push('reacción emocional');
    if(pivot)reasons.push('cambio de situación o remate');
    if(hasSetup&&payoffAtEnd)reasons.push('planteamiento y remate');
    if(questionAnswered)reasons.push('pregunta y respuesta');
    if(shortAnswerReaction)reasons.push('respuesta breve con reacción');
    if(questionAnswerExchange||shortAnswerFollowup)reasons.push('pregunta, respuesta breve y réplica inmediata');
    if(completeConversationBeat)reasons.push('intercambio completo: pregunta, respuesta y reacción');
    if(multiTurnExchange&&dialogueProgression)reasons.push('conversación con desarrollo y varios turnos');
    if(answerClosedAtEnd)reasons.push('remate completo al final');
    if(revelation)reasons.push('revelación o giro narrativo');
    if(conflict)reasons.push('conflicto u opinión contundente');
    if(stakes)reasons.push('resultado o consecuencia relevante');
    if(anecdote&&progression)reasons.push('anécdota con desarrollo narrativo');
    else if(anecdote)reasons.push('experiencia personal concreta');
    if(strongOpinion)reasons.push('opinión definida');
    if(closingReaction)reasons.push('reacción o remate al cierre');
    if(specificityScore>=3)reasons.push('detalle concreto que aporta contexto');
    if(newSceneTail)reasons.push('penalizado: mezcla con la presentación del siguiente participante');
    if(unansweredEnding)reasons.push('pregunta sin respuesta ni remate');
    if(completeEnd)reasons.push('cierre natural');
    if(energy.length && acousticScore >= 8)reasons.push('energía y dinámica de audio');
    if(visualChanges.length && visualScore>=3)reasons.push('movimiento y cambios visuales');
    candidates.push({start,end,duration,score,text,promotional,editorial_signals:{complete_conversation_beat:completeConversationBeat,short_answer_followup:shortAnswerFollowup,multi_turn_exchange:multiTurnExchange,dialogue_progression:dialogueProgression,weak_opening:weakOpening,transition_only:transitionOnly,new_scene_tail:newSceneTail,unanswered_ending:unansweredEnding},reasons:[...new Set(reasons)].slice(0,4)});
    nextStart=start+stepSeconds;
  }
  // Add a small boundary bonus when a slightly earlier window preserves
  // context but is otherwise almost as strong as a later near-duplicate.
  // Select one strong moment from each quarter of the source first, then fill
  // any empty quarter from the global ranking while enforcing a clean gap.
  const overlapRatio=(a,b)=>{
    const overlap=Math.max(0,Math.min(a.end,b.end)-Math.max(a.start,b.start));
    return overlap/Math.max(.001,Math.min(a.duration,b.duration));
  };
  const editorialCandidates=candidates.filter(c=>!c.promotional);
  const ranked=editorialCandidates.map(c=>{
    const laterNearDuplicate=candidates.some(other=>      other.start>c.start&&other.start-c.start<=18&&overlapRatio(c,other)>=.5&&other.score>=c.score&&other.score<=c.score+6&&(strongHook.test(c.text.slice(0,90))||/^\s*[¿]/.test(c.text))
    );
    const preservesContext=candidates.some(other=>
      other.start>c.start&&other.start-c.start<=18&&overlapRatio(c,other)>=.5&&c.duration>=other.duration+5
    );
    return {clip:c,selectionScore:c.score+(laterNearDuplicate?12:0)+(preservesContext?3:0)};
  }).sort((a,b)=>b.selectionScore-a.selectionScore);
  // Token overlap is a lightweight topic-duplication guard for the free local
  // fallback. It is deliberately applied during the four-clip selection,
  // rather than after ranking, so the best four are diverse as a set.
  const diversityStopWords=new Set('the and for that with this from have your you are was were but then when what why how who where como que para por una uno unos unas los las del con sin sus pero porque cuando donde quien cual este esta esto eso ellos ellas nosotros vosotros ella de y a en un es se al lo mi tu me te yo'.split(' '));
  const diversityTokens=value=>new Set((String(value||'').toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu)||[]).filter(token=>!diversityStopWords.has(token)));
  const lexicalSimilarity=(left,right)=>{
    const a=diversityTokens(left),b=diversityTokens(right);
    if(!a.size||!b.size)return 0;
    let shared=0;for(const token of a)if(b.has(token))shared++;
    return shared/Math.max(1,a.size+b.size-shared);
  };
  const firstStart=clean[0].start;
  const lastEnd=Math.max(clean[clean.length-1].end,videoDuration);
  const quarter=(lastEnd-firstStart)/4;
  const chosen=[];
  const fits=c=>chosen.every(x=>c.end<=x.start-2.5||c.start>=x.end+2.5);
  const bucketOf=c=>Math.min(3,Math.max(0,Math.floor((c.start-firstStart)/Math.max(quarter,.001))));
  // Coverage is a soft preference, never a hard quota: forcing one weak clip
  // into every quarter can make the result worse than choosing four genuinely
  // strong moments. Each uncovered quarter gets a small diversity bonus.
  while(chosen.length<selectionLimit){
    const represented=new Set(chosen.map(bucketOf));
    const options=ranked.filter(item=>!chosen.includes(item.clip)&&fits(item.clip));
    if(!options.length)break;
    options.sort((a,b)=>{
      const marginal=item=>{
        const similarities=chosen.map(previous=>lexicalSimilarity(item.clip.text,previous.text));
        const maxSimilarity=similarities.length?Math.max(...similarities):0;
        const duplicatePenalty=Math.max(0,maxSimilarity-.34)*28;
        const noveltyBonus=similarities.length?(1-maxSimilarity)*2:0;
        const coverageBonus=represented.has(bucketOf(item.clip))?0:3;
        return item.selectionScore+noveltyBonus+coverageBonus-duplicatePenalty;
      };
      return marginal(b)-marginal(a);
    });
    chosen.push(options[0].clip);
  }
  // If long edits leave fewer than four slots, make one second pass with a
  // tighter one-second breathing gap. Never overlap clips or fabricate cuts.
  if(chosen.length<selectionLimit){
    for(const item of ranked){
      if(chosen.length>=selectionLimit)break;
      const c=item.clip;
      if(chosen.includes(c)||chosen.some(x=>!(c.end<=x.start-1||c.start>=x.end+1)))continue;
      chosen.push(c);
    }
  }
  return chosen.sort((a,b)=>a.start-b.start).map((c,i)=>({...c,title:`Momento ${i+1}`}));
}

function rerankWithoutEmbeddings(candidates, limit = 4) {
  const pool=(Array.isArray(candidates)?candidates:[])
    .filter(c=>c&&Number.isFinite(Number(c.start))&&Number.isFinite(Number(c.end))&&Number(c.end)>Number(c.start))
    .map(c=>({...c,score:Number(c.score)||0}));
  const count=Math.max(1,Math.min(4,Math.floor(Number(limit)||4)));
  if(pool.length<=count)return pool.sort((a,b)=>a.start-b.start).map((c,i)=>({...c,title:c.title||`Clip ${i+1}`}));
  const stop=new Set(('the and for that with this from have your you are was were but then when what why how who where como que para por una uno unos unas los las del con sin sus sus que pero porque cuando donde quien cual este esta esto eso ellos ellas nosotros vosotros ella el la de y a en un es se al lo mi tu me te yo').split(/\s+/));
  const tokens=text=>new Set((String(text||'').toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu)||[]).filter(t=>!stop.has(t)));
  const similarity=(a,b)=>{
    const A=tokens(a),B=tokens(b);if(!A.size||!B.size)return 0;
    let common=0;for(const t of A)if(B.has(t))common++;
    return common/Math.max(1,A.size+B.size-common);
  };
  const first=Math.min(...pool.map(c=>Number(c.start))),last=Math.max(...pool.map(c=>Number(c.end)));
  const span=Math.max(1,last-first),bucket=c=>Math.min(3,Math.max(0,Math.floor((Number(c.start)-first)/span*4)));
  const selected=[];
  while(selected.length<count){
    const options=pool.filter(c=>!selected.includes(c)&&selected.every(x=>Number(c.end)<=Number(x.start)-1||Number(c.start)>=Number(x.end)+1));
    if(!options.length)break;
    options.sort((a,b)=>{
      const value=c=>{
        const similarities=selected.map(x=>similarity(c.text,x.text));
        const maxSim=similarities.length?Math.max(...similarities):0;
        const duplicatePenalty=Math.max(0,maxSim-.32)*42;
        const novelty=similarities.length?(1-maxSim)*3:0;
        const coverage=selected.some(x=>bucket(x)===bucket(c))?0:3;
        return c.score+novelty+coverage-duplicatePenalty;
      };
      return value(b)-value(a);
    });
    selected.push(options[0]);
  }
  return selected.sort((a,b)=>a.start-b.start).map((c,i)=>({
    ...c,title:c.title||`Clip ${i+1}`,
    reasons:[...new Set([...(c.reasons||[]),'selección local de respaldo; diversidad léxica y separación temporal'])].slice(0,4),
    selected:true
  }));
}

function rerankWithSemanticEmbeddings(candidates, embeddings, limit = 4) {
  if (!Array.isArray(candidates) || !Array.isArray(embeddings) || candidates.length !== embeddings.length) {
    return (candidates || []).slice(0, limit);
  }
  const cosine = (a, b) => {
    if (!a?.length || a.length !== b?.length) return 0;
    let dot = 0, aa = 0, bb = 0;
    for (let i = 0; i < a.length; i++) {
      const x = Number(a[i]), y = Number(b[i]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
      dot += x * y; aa += x * x; bb += y * y;
    }
    return dot / Math.max(1e-9, Math.sqrt(aa * bb));
  };
  const remaining = candidates.map((clip, index) => ({clip, index}));
  const chosen = [];
  const count = Math.max(1, Math.min(candidates.length, Math.floor(Number(limit) || 4)));
  while (chosen.length < count && remaining.length) {
    const ranked = remaining.map(item => {
      const similarities = chosen.map(previous => cosine(embeddings[item.index], embeddings[previous.index]));
      const maxSimilarity = similarities.length ? Math.max(...similarities) : 0;
      const diversity = similarities.length ? Math.max(0, Math.min(1, 1 - maxSimilarity)) : 1;
      const penalty = similarities.length ? Math.max(0, maxSimilarity - 0.78) * 34 : 0;
      const bonus = similarities.length ? diversity * 8 : 0;
      const editorialScore = Number(item.clip.ai_editorial_score ?? item.clip.score ?? 0);
      return {...item, maxSimilarity, diversity, finalScore: editorialScore + bonus - penalty};
    }).sort((a, b) => b.finalScore - a.finalScore);
    chosen.push(ranked[0]);
    remaining.splice(remaining.findIndex(item => item.index === ranked[0].index), 1);
  }
  return chosen
    .sort((a, b) => Number(a.clip.start) - Number(b.clip.start))
    .map((item, index) => ({
      ...item.clip,
      title: `Clip ${index + 1}`,
      score: Math.max(0, Math.min(100, Math.round(item.finalScore))),
      semanticScore: Math.round(item.diversity * 100),
      reasons: [...new Set([...(item.clip.reasons || []), item.maxSimilarity > 0.82 ? 'tema parecido a otro candidato; se penalizó la duplicidad' : 'diversidad temática revisada'])].slice(0, 4),
      selected: true
    }));
}

// A real generative editorial judge. Unlike the embedding reranker, this
// model reads each candidate as an editor and makes a narrative-quality choice.
// Runs locally through WebGPU: no API key, no paid inference endpoint, no upload.
let editorialEnginePromise = null;
// Free AI provider router; independent editorial passes rotate across providers.

const FREE_AI_PROVIDERS={
 gemini:{label:'Google Gemini',endpoint:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',model:'gemini-3.8-flash'},
 openrouter:{label:'OpenRouter',endpoint:'https://openrouter.ai/api/v1/chat/completions',model:'openrouter/free'},
 groq:{label:'Groq (no se usa en modo gratuito)',endpoint:'https://api.groq.com/openai/v1/chat/completions',model:'openai/gpt-oss-120b',free:false}
};
const FREE_AI_KEYS='clipforge.free-ai-keys.v1';
let freeAIKeysCache={};
let freeAIKeysLoaded=false;
function readFreeAIKeys(){return {...freeAIKeysCache};}
function cleanFreeAIKeys(values){const clean={};for(const id of Object.keys(FREE_AI_PROVIDERS)){const key=String(values[id]||'').trim();if(key)clean[id]=key;}return clean;}
async function loadFreeAIKeysFromCloud(){
 const client=window.clipforgeSupabase;
 if(!client)return {ok:false,error:'El módulo de cuenta todavía no está disponible.'};
 const {data:{session}}=await client.auth.getSession();
 if(!session?.user){freeAIKeysCache={};freeAIKeysLoaded=false;return {ok:false,error:'Inicia sesión con Google para cargar tus proveedores.'};}
 const {data,error}=await client.from('clipforge_user_settings').select('provider_keys').eq('user_id',session.user.id).maybeSingle();
 if(error)return {ok:false,error:error.message};
 let keys=data?.provider_keys||{};
 if(!data){
  let legacy={};try{legacy=JSON.parse(localStorage.getItem(FREE_AI_KEYS)||'{}')||{};}catch{}
  keys=cleanFreeAIKeys(legacy);
  if(Object.keys(keys).length){
   const saved=await client.from('clipforge_user_settings').upsert({user_id:session.user.id,provider_keys:keys,updated_at:new Date().toISOString()},{onConflict:'user_id'});
   if(saved.error)return {ok:false,error:saved.error.message};
  }
 }
 const supportedKeys=cleanFreeAIKeys(keys);
 const removedUnsupported=Object.keys(keys).some(id=>!Object.prototype.hasOwnProperty.call(FREE_AI_PROVIDERS,id));
 if(removedUnsupported){
  const cleaned=await client.from('clipforge_user_settings').upsert({user_id:session.user.id,provider_keys:supportedKeys,updated_at:new Date().toISOString()},{onConflict:'user_id'});
  if(cleaned.error)return {ok:false,error:cleaned.error.message};
 }
 freeAIKeysCache=supportedKeys;freeAIKeysLoaded=true;
 try{localStorage.removeItem(FREE_AI_KEYS);}catch{}
 return {ok:true,keys:freeAIKeysCache};
}
async function saveFreeAIKeys(values){
 const clean=cleanFreeAIKeys(values),client=window.clipforgeSupabase;
 if(!client)throw new Error('No se ha conectado Supabase.');
 const {data:{session}}=await client.auth.getSession();
 if(!session?.user)throw new Error('Inicia sesión con Google antes de guardar las claves.');
 const {error}=await client.from('clipforge_user_settings').upsert({user_id:session.user.id,provider_keys:clean,updated_at:new Date().toISOString()},{onConflict:'user_id'});
 if(error)throw error;
 freeAIKeysCache=clean;freeAIKeysLoaded=true;
 try{localStorage.removeItem(FREE_AI_KEYS);}catch{}
 return clean;
}
function configuredFreeAIProviders(){const keys=readFreeAIKeys();return Object.keys(FREE_AI_PROVIDERS).filter(id=>keys[id]&&FREE_AI_PROVIDERS[id].free!==false).map(id=>({id,...FREE_AI_PROVIDERS[id],key:keys[id]}));}
let freeAIRoundRobin=0;
function createFederatedFreeAIEngine(providers,onProgress,localFallback=null){ let localEnginePromise=null;
 const cooldown=new Map();
 return {isRemote:true,providerChain:providers.map(p=>p.id),chat:{completions:{create:async options=>{
  const now=Date.now(),ready=providers.filter(p=>(cooldown.get(p.id)||0)<=now);
  const ordered=(ready.length?ready:providers).map((_,i)=>(ready.length?ready:providers)[(freeAIRoundRobin+i)%(ready.length?ready.length:providers.length)]);
  const errors=[];
  for(const provider of ordered){
   try{
    onProgress('Juez IA: consultando '+provider.label+'…');
    const response=await fetch(provider.endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+provider.key},body:JSON.stringify({...options,model:provider.model,stream:false})});
    if(!response.ok){const body=await response.text();if(response.status===429||response.status===402)cooldown.set(provider.id,Date.now()+Math.min(3600000,Math.max(60000,Number(response.headers.get('retry-after'))*1000||300000)));throw new Error(provider.label+' HTTP '+response.status+': '+body.slice(0,240));}
    const data=await response.json();
    if(!data?.choices?.[0]?.message?.content)throw new Error(provider.label+' devolvió una respuesta vacía.');
    freeAIRoundRobin=(providers.findIndex(p=>p.id===provider.id)+1)%providers.length;
    return data;
   }catch(error){errors.push(String(error.message||error));cooldown.set(provider.id,Math.max(cooldown.get(provider.id)||0,Date.now()+30000));}
  }
  if(localFallback){onProgress('Cuotas externas agotadas: activando Qwen3 local como último juez…');localEnginePromise=localEnginePromise||localFallback();const local=await localEnginePromise;return local.chat.completions.create(options);}
  throw new Error('Todos los proveedores IA gratuitos configurados están temporalmente indisponibles. '+errors.join(' | '));
 }}}};
}
function initFreeAIProviderSettings(){
 const root=document.querySelector('#freeAIProviderSettings');if(!root||root.dataset.ready)return;root.dataset.ready='1';
 const status=root.querySelector('#freeAIProviderStatus');
 const toggle=document.createElement('button');toggle.type='button';toggle.className='secondary';toggle.textContent='Gestionar proveedores IA';toggle.hidden=true;root.parentNode.insertBefore(toggle,root);
 toggle.addEventListener('click',()=>{root.hidden=!root.hidden;toggle.textContent=root.hidden?'Gestionar proveedores IA':'Ocultar configuración de proveedores';});
 const syncVisibility=()=>{const configured=freeAIKeysLoaded&&Object.keys(readFreeAIKeys()).length>0;if(configured&&!root.dataset.expanded){root.hidden=true;toggle.hidden=false;}else if(!configured){root.hidden=false;toggle.hidden=true;}};
 const paint=()=>{for(const id of Object.keys(FREE_AI_PROVIDERS)){const input=root.querySelector('[data-provider-key="'+id+'"]');if(input)input.value=readFreeAIKeys()[id]||'';}if(status)status.textContent=freeAIKeysLoaded?Object.keys(readFreeAIKeys()).length+' proveedor(es) guardados en tu cuenta de ClipForge.':'Inicia sesión para cargar las claves guardadas en tu cuenta.';syncVisibility();};
 paint();
 root.querySelector('#saveFreeAIProviders')?.addEventListener('click',async()=>{
  const button=root.querySelector('#saveFreeAIProviders');button.disabled=true;if(status)status.textContent='Guardando de forma privada en tu cuenta…';
  try{const values={};for(const id of Object.keys(FREE_AI_PROVIDERS))values[id]=root.querySelector('[data-provider-key="'+id+'"]')?.value||'';const saved=await saveFreeAIKeys(values);if(status)status.textContent=Object.keys(saved).length+' proveedor(es) guardados en tu cuenta. Se recuperarán al iniciar sesión.';root.dataset.expanded='';syncVisibility();}
  catch(error){if(status)status.textContent='No se pudo guardar: '+(error.message||error);}
  finally{button.disabled=false;}
 });
 root.querySelector('#clearFreeAIProviders')?.addEventListener('click',async()=>{
  try{await saveFreeAIKeys({});root.querySelectorAll('[data-provider-key]').forEach(input=>input.value='');if(status)status.textContent='Claves eliminadas de tu cuenta.';root.dataset.expanded='';syncVisibility();}
  catch(error){if(status)status.textContent='No se pudo eliminar: '+(error.message||error);}
 });
 window.addEventListener('clipforge:session',async event=>{if(event.detail?.session){const result=await loadFreeAIKeysFromCloud();if(result.ok)paint();else if(status)status.textContent='No se pudieron cargar las claves: '+result.error;}else{freeAIKeysCache={};freeAIKeysLoaded=false;paint();}});
 const refreshSavedProviders=async()=>{if(!window.clipforgeSupabase)return;const result=await loadFreeAIKeysFromCloud();if(result.ok)paint();else if(status)status.textContent=result.error;};
 // auth.js is a classic script loaded after this module. Its initial getSession()
 // can resolve before this module registers clipforge:session, so replay the
 // persisted session check once the page has fully loaded as well.
 if(window.clipforgeSupabase)refreshSavedProviders();
 window.addEventListener('load',refreshSavedProviders,{once:true});
 window.addEventListener('pageshow',refreshSavedProviders);
}
initFreeAIProviderSettings();
async function loadLocalEditorialJudge(onProgress=()=>{}){
 if(!navigator.gpu)throw new Error('No hay WebGPU para el modelo local Qwen3.');
 const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
 if(!adapter)throw new Error('No se ha encontrado una GPU compatible con WebGPU.');
 if(!editorialEnginePromise){
  editorialEnginePromise=(async()=>{
   // Use the compact 0.6B model by default: it has a materially lower
   // WebGPU/OPFS footprint and avoids the quota failure seen with 1.7B.
   onProgress('Preparando el editor IA local Qwen3 compacto (0.6B)…');
   const webllm=await import('https://esm.sh/@mlc-ai/web-llm@0.2.87');
   const modelId='Qwen3-0.6B-q4f16_1-MLC';
   const record=webllm.prebuiltAppConfig.model_list.find(item=>item.model_id===modelId);
   if(!record)throw new Error('La versión instalada de WebLLM no incluye Qwen3-0.6B compatible.');
   const appConfig={...webllm.prebuiltAppConfig,cacheBackend:'opfs',opfsAccessMode:'auto'};
   return await webllm.CreateMLCEngine(modelId,{appConfig,initProgressCallback:report=>onProgress(report?.text||'Descargando el modelo editorial IA…')});
  })().catch(error=>{editorialEnginePromise=null;throw error;});
 }
 return editorialEnginePromise;
}
async function loadEditorialJudge(onProgress = () => {}) {
 // Prefer connected free API providers; use local WebGPU Qwen3 only as fallback.
 const freeProviders=configuredFreeAIProviders();
 if(freeProviders.length)return createFederatedFreeAIEngine(freeProviders,onProgress,()=>loadLocalEditorialJudge(onProgress));
 return loadLocalEditorialJudge(onProgress);
}

// Approximate per-video resource estimate. Browsers do not expose exact free RAM,
// VRAM or disk space; show safe recommendations and label uncertainty honestly.
function estimateVideoCapacity(options) {
  const {durationSeconds=0,fileBytes=0,whisperModel='whisper-base',deviceMemoryGb=null,webgpu=false}=options||{};
  const minutes=Math.max(0,Number(durationSeconds)||0)/60;
  const asr={
    'whisper-tiny':{label:'Whisper Tiny',downloadMb:80,ramGb:1.8},
    'whisper-base':{label:'Whisper Base',downloadMb:160,ramGb:2.4},
    'whisper-small':{label:'Whisper Small',downloadMb:520,ramGb:4.0}
  }[String(whisperModel)]||{label:'Whisper Base',downloadMb:160,ramGb:2.4};
  const audioGb=minutes*0.00384;
  const systemRamGb=Math.ceil((2.2+asr.ramGb+audioGb)*2)/2;
  const gpuRamGb=2.5;
  const cacheGb=Math.ceil((2.0+asr.downloadMb/1024)*2)/2;
  const tempGb=Math.max(1.5,(Number(fileBytes)||0)/1024**3*1.5);
  const freeDiskGb=Math.ceil((cacheGb+tempGb)*2)/2;
  const deviceRam=deviceMemoryGb!==null&&deviceMemoryGb!==undefined&&Number.isFinite(Number(deviceMemoryGb))?Number(deviceMemoryGb):null;
  const ramFit=deviceRam===null?null:deviceRam>=systemRamGb;
  return {asrLabel:asr.label,systemRamGb,gpuRamGb,cacheGb,freeDiskGb,deviceMemoryGb:deviceRam,webgpu:Boolean(webgpu),ramFit,status:!webgpu?'incompatible':ramFit===false?'limited':deviceRam===null?'unknown':'ready',audioWorkingSetMb:Math.round(audioGb*1024)};
}
function formatCapacityGb(value){return Number(value).toFixed(1).replace('.',',')+' GB';}
async function updateVideoCapacity(file) {
  const el=id=>document.querySelector('#'+id);
  if(!file||!el('capacityStatus'))return;
  el('capacityStatus').textContent='Calculando duración y compatibilidad…';
  let duration=0;
  const url=URL.createObjectURL(file),video=document.createElement('video');
  try{video.preload='metadata';video.src=url;duration=await new Promise(resolve=>{video.onloadedmetadata=()=>resolve(Number(video.duration)||0);video.onerror=()=>resolve(0);setTimeout(()=>resolve(0),12000);});}
  finally{URL.revokeObjectURL(url);video.removeAttribute('src');}
  let adapter=null;try{if(navigator.gpu)adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});}catch{}
  const estimate=estimateVideoCapacity({durationSeconds:duration,fileBytes:file.size,whisperModel:el('browserWhisperModel')?.value||'whisper-base',deviceMemoryGb:navigator.deviceMemory,webgpu:Boolean(adapter)});
  el('capacityRam').textContent=formatCapacityGb(estimate.systemRamGb)+' recomendados';
  el('capacityGpu').textContent=formatCapacityGb(estimate.gpuRamGb)+' recomendados';
  el('capacityDisk').textContent=formatCapacityGb(estimate.freeDiskGb)+' libres';
  el('capacityModel').textContent=('Qwen3 local 1.7B')+' + '+estimate.asrLabel.replace('Whisper ','');
  const length=duration?(duration/60).toFixed(1).replace('.',',')+' min':'duración no detectada';
  const status=el('capacityStatus'),summary=el('capacitySummary');
  if(!adapter){status.textContent='No compatible con selección IA';status.dataset.level='bad';summary.textContent='Vídeo: '+length+' · '+Math.round(file.size/1048576)+' MB. No se detecta WebGPU; la selección editorial generativa no podrá ejecutarse en este navegador.';}
  else if(estimate.ramFit===false){status.textContent='Capacidad posiblemente insuficiente';status.dataset.level='warn';summary.textContent='Vídeo: '+length+' · '+Math.round(file.size/1048576)+' MB. El navegador declara '+estimate.deviceMemoryGb+' GB de RAM; se recomiendan '+formatCapacityGb(estimate.systemRamGb)+'.';}
  else{status.textContent=estimate.ramFit===null?'GPU compatible · RAM no verificable':'Requisitos estimados';status.dataset.level='ok';summary.textContent='Vídeo: '+length+' · '+Math.round(file.size/1048576)+' MB. '+(estimate.ramFit===true?'La memoria declarada parece suficiente.':'WebGPU disponible; evita otras aplicaciones pesadas durante el análisis.');}
  el('capacityDetails').textContent='Para Whisper '+estimate.asrLabel.replace('Whisper ','')+' + Qwen3-1.7B: RAM '+formatCapacityGb(estimate.systemRamGb)+', memoria gráfica '+formatCapacityGb(estimate.gpuRamGb)+', caché de modelos '+formatCapacityGb(estimate.cacheGb)+' y espacio libre recomendado '+formatCapacityGb(estimate.freeDiskGb)+'. '+(estimate.deviceMemoryGb===null?'Este navegador no permite consultar la RAM del dispositivo.':'RAM declarada por el navegador: '+estimate.deviceMemoryGb+' GB (aproximada).')+' El audio temporal ocupa unos '+estimate.audioWorkingSetMb+' MB. No se puede consultar con precisión la VRAM ni el espacio libre real.';
  el('videoCapacity').dataset.level=estimate.status;
}

function parseEditorialDecision(raw, candidates, limit = 4, requireAudit = false, selectionMethod = 'local_generative_editor') {
  const text = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('El editor IA no devolvió una selección estructurada.');
  const data = JSON.parse(match[0]);
  if (!Array.isArray(data.selected)) throw new Error('La respuesta del editor IA no contiene una lista de selección.');
  const selectionLimit=Math.max(1,Math.min(12,Math.floor(Number(limit)||4)));
  const used = new Set(), selected = [];
  for (const item of data.selected) {
    const id = Number(item.id);
    if (!Number.isInteger(id) || id < 1 || id > candidates.length || used.has(id)) continue;
    const clip = candidates[id - 1];
    const auditFlags=Array.isArray(item.audit_flags)?item.audit_flags.map(flag=>String(flag).slice(0,80)):[];
    if(requireAudit&&(item.audit_verdict!=='pass'||auditFlags.length>0))continue;
    // Reject overlapping editorial selections; timestamps always come from ASR.
    if (selected.some(other => clip.start < other.end + 1 && clip.end > other.start - 1)) continue;
    used.add(id);
    const rubric=item.rubric&&typeof item.rubric==='object'?item.rubric:null;
    const rubricKeys=['hook','story','payoff','clarity','completeness','emotion','pacing','originality','importance'];
    const validRubric=rubric&&rubricKeys.every(key=>Number.isFinite(Number(rubric[key]))&&Number(rubric[key])>=0&&Number(rubric[key])<=10);
    // A generative selection is only accepted when the model supplies the complete editorial rubric.
    // Missing dimensions trigger the constrained repair pass; they never become a silent score fallback.
    if(!validRubric)continue;
    if(requireAudit&&Number(rubric.importance)<6.5)continue; // Reject moments that are not materially important.
    const importanceEvidence=String(item.importance_evidence||'').trim();
    if(requireAudit){
      const normalizeEvidence=value=>String(value||'').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
      const quote=normalizeEvidence(importanceEvidence),transcript=normalizeEvidence(clip.text);
      if(quote.split(' ').filter(Boolean).length<4||!transcript.includes(quote))continue;
    }
    const editorialScore=validRubric?Math.round((
      Number(rubric.importance)*4+Number(rubric.story)*1.5+Number(rubric.payoff)*1.5+
      Number(rubric.completeness)*1.5+Number(rubric.clarity)*1+Number(rubric.emotion)*.2+
      Number(rubric.hook)*.1+Number(rubric.originality)*.1+Number(rubric.pacing)*.1
    )*1):Math.max(0,Math.min(100,Number(item.score)||0));
    selected.push({
      ...clip,
      title: String(item.title || `Clip ${selected.length + 1}`).slice(0, 70),
      ai_editorial_rank: selected.length + 1,
      ai_editorial_score: Math.max(0,Math.min(100,editorialScore)),
      ai_editorial_rubric: validRubric?Object.fromEntries(rubricKeys.map(key=>[key,Number(rubric[key])])):null,
      ai_editorial_reason: String(item.reason || '').slice(0, 240),
      ai_editorial_importance_evidence: importanceEvidence.slice(0, 160),
      selection_method: selectionMethod,
      ai_editorial_audit_verdict:requireAudit?item.audit_verdict:null,
      ai_editorial_audit_flags:requireAudit?auditFlags:[]
    });
    if (selected.length >= selectionLimit) break;
  }
  if (selected.length !== Math.min(selectionLimit, candidates.length)) {
    throw new Error('El editor IA no ha devuelto '+selectionLimit+' candidatos válidos y distintos.');
  }
  return selected.sort((a,b) => a.start - b.start).map((clip,i) => ({...clip,title:clip.title || `Clip ${i+1}`}));
}

// Build neutral transcript windows for the AI editor. This stage only places
// legal, sentence-aware candidate boundaries; it does not score or rank moments.
function buildEditorialCandidatePool(segments, videoDuration, audioSamples = null, visualSamples = [], sampleRate = 16000) {
  const clean=(Array.isArray(segments)?segments:[])
    .filter(x=>Number.isFinite(Number(x.start))&&Number.isFinite(Number(x.end))&&Number(x.end)>Number(x.start)&&String(x.text||'').trim())
    .map(x=>({start:Number(x.start),end:Number(x.end),text:String(x.text).trim()}))
    .sort((a,b)=>a.start-b.start);
  if(clean.length<4||!Number.isFinite(videoDuration)||videoDuration<18)return [];
  const boundary=i=>i===0||/[.!?…]["'”’)]?$/.test(clean[i-1].text)||clean[i].start-clean[i-1].end>.72;
  const starts=[];
  let next=clean[0].start;
  for(let i=0;i<clean.length;i++){
    if(clean[i].start+0.01<next||!boundary(i))continue;
    starts.push(i);
    next=clean[i].start+3.8;
  }
  const audioProfile=[];
  if(audioSamples&&audioSamples.length){
    const windowSamples=Math.max(1,Math.floor(sampleRate*.5));
    for(let offset=0;offset<audioSamples.length;offset+=windowSamples){
      let sum=0,peak=0,count=0;
      for(let i=offset;i<Math.min(audioSamples.length,offset+windowSamples);i++){
        const v=Number(audioSamples[i])||0;sum+=v*v;peak=Math.max(peak,Math.abs(v));count++;
      }
      audioProfile.push({t:offset/sampleRate,rms:Math.sqrt(sum/Math.max(1,count)),peak});
    }
  }
  const rmsSorted=audioProfile.map(x=>x.rms).sort((a,b)=>a-b);
  const percentile=q=>rmsSorted.length?rmsSorted[Math.floor((rmsSorted.length-1)*q)]:0;
  const rmsFloor=percentile(.2),rmsMedian=percentile(.5),rmsTop=percentile(.9);
  const pool=[];
  for(const si of starts){
    const start=clean[si].start;
    if(start>videoDuration-15)continue;
    const possible=[];
    for(let j=si;j<clean.length&&clean[j].end-start<=45;j++){
      const duration=clean[j].end-start;
      if(duration<18)continue;
      const naturalEnd=/[.!?…]["'”’)]?$/.test(clean[j].text)||j===clean.length-1||(j+1<clean.length&&clean[j+1].start-clean[j].end>.72);
      if(naturalEnd)possible.push(j);
    }
    if(!possible.length)continue;
    const durationTargets=[22,30,40];
    const chosenEnds=[];
    for(const target of durationTargets){
      const ordered=[...possible].sort((a,b)=>{
        const da=clean[a].end-start,db=clean[b].end-start;
        const pa=/[.!?…]["'”’)]?$/.test(clean[a].text)?0:1;
        const pb=/[.!?…]["'”’)]?$/.test(clean[b].text)?0:1;
        return Math.abs(da-target)-Math.abs(db-target)||pa-pb;
      });      const ei=ordered.find(index=>!chosenEnds.some(previous=>Math.abs(clean[index].end-clean[previous].end)<7));
      if(ei!==undefined)chosenEnds.push(ei);
    }
    for(const ei of chosenEnds){
      const group=clean.slice(si,ei+1),end=group[group.length-1].end;
      const text=group.map(x=>x.text).join(' ').replace(/\s+/g,' ').trim();
      if(end-start<18||end-start>45||!text)continue;
      if(pool.some(x=>Math.abs(x.start-start)<1&&Math.abs(x.end-end)<1))continue;
    const audio=audioProfile.filter(x=>x.t>=start&&x.t<end);
    const rms=audio.length?audio.reduce((a,x)=>a+x.rms,0)/audio.length:0;
    const active=audio.length?audio.filter(x=>x.rms>rmsMedian).length/audio.length:0;
    const peaks=audio.length?audio.filter(x=>x.rms>=rmsTop).length/audio.length:0;
    const visual=visualSamples.filter(x=>x.t>=start&&x.t<end);
    const visualChange=visual.length?visual.reduce((a,x)=>a+Number(x.change||0),0)/visual.length:0;
    const audioActivity=audio.length?Math.max(0,Math.min(1,(rms-rmsFloor)/Math.max(.00001,rmsTop-rmsFloor))):null;
    const evidence={
      audio_activity:audioActivity===null?null:Number(audioActivity.toFixed(2)),
      audio_dynamic_peaks:Number(peaks.toFixed(2)),
      audio_active_ratio:Number(active.toFixed(2)),
      visual_change:Number(visualChange.toFixed(3)),
      visual_samples:visual.length
    };
    // Give the judge a little surrounding dialogue so it can tell whether a
    // candidate depends on a setup just outside its boundaries. These words
    // are context only: the model may select this candidate, never extend it.
    const contextBefore=clean.filter(x=>x.end<=start&&x.end>=start-8.5).slice(-5)
      .map(x=>x.text).join(' ').replace(/\s+/g,' ').trim().slice(-360);
    const contextAfter=clean.filter(x=>x.start>=end&&x.start<=end+7)
      .slice(0,5).map(x=>x.text).join(' ').replace(/\s+/g,' ').trim().slice(0,360);
      pool.push({start,end,duration:end-start,text,context_before:contextBefore,context_after:contextAfter,title:'Candidato editorial',selected:false,selection_method:'neutral_transcript_window',media_evidence:evidence});
    }
  }
  // Bound local-LLM work for long videos. Keep a uniform temporal sample
  // across the complete source instead of ranking windows with heuristics.
  const maxCandidates=videoDuration>1800?48:videoDuration>600?64:96;
  if(pool.length>maxCandidates){
    const ordered=[...pool].sort((a,b)=>a.start-b.start||a.end-b.end);
    const sampled=[],used=new Set();
    for(let bucket=0;bucket<maxCandidates;bucket++){
      const left=videoDuration*bucket/maxCandidates,right=videoDuration*(bucket+1)/maxCandidates;
      const inBucket=ordered.filter(c=>c.start>=left&&c.start<right&&!used.has(c));
      if(!inBucket.length)continue;
      const target=[22,30,40][bucket%3];
      inBucket.sort((a,b)=>Math.abs(a.duration-target)-Math.abs(b.duration-target));
      sampled.push(inBucket[0]);used.add(inBucket[0]);
    }
    if(sampled.length<maxCandidates){
      for(const candidate of ordered){if(used.has(candidate))continue;sampled.push(candidate);used.add(candidate);if(sampled.length>=maxCandidates)break;}
    }
    // Preserve the literal beginning and ending as mandatory anchors. A
    // duration-preference choice inside the first temporal bucket must not
    // silently discard the opening context of the source video.
    if(ordered.length){
      const opening=ordered[0],ending=ordered[ordered.length-1];
      if(!used.has(opening)){sampled[0]=opening;used.add(opening);}
      if(!used.has(ending)){sampled[sampled.length-1]=ending;used.add(ending);}
    }
    return sampled.sort((a,b)=>a.start-b.start).slice(0,maxCandidates);
  }
  return pool;
}

async function askEditorialModel(engine, pool, count, onProgress, phase) {
  const shortlist=pool.map((clip,index)=>({
    id:index+1,start:Number(clip.start.toFixed(1)),end:Number(clip.end.toFixed(1)),
    transcript:String(clip.text).replace(/\s+/g,' ').slice(0,620),
    prior_editorial_score:Number(clip.ai_editorial_score||0),
    editorial_importance:Number(clip.ai_editorial_rubric?.importance||0),
    prior_editorial_reason:String(clip.ai_editorial_reason||'').slice(0,180),
    semantic_diversity_score:Number(clip.semanticScore||0),
    context_before:String(clip.context_before||'').replace(/\s+/g,' ').slice(-160),
    context_after:String(clip.context_after||'').replace(/\s+/g,' ').slice(0,160),
    media_evidence:clip.media_evidence||null
  }));
  const prompt=[
    'Eres el editor jefe de una productora profesional de clips verticales para redes sociales.',
    'Evalúa cada fragmento como un editor de short-form profesional, usando el diálogo y las señales de audio y vídeo adjuntas. No uses popularidad de palabras ni señales superficiales.',
    'Las señales media_evidence son medidas de actividad, no etiquetas semánticas: audio_activity y audio_dynamic_peaks pueden señalar énfasis o reacción; visual_change indica cambios de plano/movimiento, pero no demuestra interés por sí solo. Úsalas solo como evidencia secundaria.',
    'Actúa como editor de contenido: identifica qué partes son más importantes para entender el vídeo. No busques viralidad, ganchos artificiales ni frases impactantes por sí mismas. Selecciona momentos con valor real para el contenido y recórtalos de forma que se entiendan solos.',
    'Evalúa CADA candidato con una rúbrica de 0 a 10: importance (valor real del contenido), story (qué aporta al desarrollo), payoff (qué se descubre, resuelve o demuestra), completeness (si conserva la idea completa), clarity (si se entiende), emotion (solo si aporta significado), originality (si añade algo distinto) y pacing (si el corte evita relleno); hook solo desempata. No midas potencial viral. Importancia incluye hechos que cambian la situación, información nueva, explicaciones clave, ejemplos concretos, decisiones, conflictos, revelaciones, consecuencias y conclusiones relevantes. Una explicación tranquila puede ser más importante que una reacción ruidosa.',
    'Pondera importance 40%, story 15%, payoff 15%, completeness 15%, clarity 10%, emotion 2%, originality 1%, pacing 1% y hook 1%. La prioridad absoluta es la importancia del contenido, no que parezca viral. Puntúa importance según cuánto cambia lo que el espectador sabe, entiende o espera: nueva información, explicación clave, ejemplo concreto, decisión, conflicto, revelación, giro, consecuencia, resultado o conclusión relevante. También puede ser importante una reflexión sustancial aunque no haya conflicto. No confundas importancia con intensidad, volumen, risas, insultos, palabras llamativas ni cambios de plano. Compara los candidatos entre sí: ¿qué cuatro aportan más información, avance, consecuencia o comprensión del vídeo? La calidad del corte solo desempata entre momentos de importancia parecida. No inventes consecuencias ni significado que no aparezcan en el material. Una pregunta sin respuesta no es un payoff; conserva la pregunta si la respuesta depende de ella.',
    'Descarta: arranque a mitad de frase, presentación sin contenido, transición, publicidad/patrocinio, repetición, respuesta incomprensible por ASR, idea sin terminar y dependencia de contexto que no aparece en el clip. No descartes una explicación útil solo por ser tranquila o tener poco ritmo.',
    'No confundas volumen, risas de fondo, cambios de plano o palabras llamativas con calidad editorial. Úsalas solo como señales secundarias. No inventes reacciones ni atribuyas quién habla si el texto no lo demuestra.',
    'La salida final debe contener exactamente cuatro clips. Selecciona los cuatro momentos que más aportan al contenido de TODO el vídeo. No es obligatorio que sean virales, graciosos, emocionantes ni que tengan estructura de chiste. Compara globalmente. No fuerces variedad temporal si hay varios momentos importantes juntos. Evita duplicar el mismo acontecimiento. Si dos candidatos cubren el mismo momento, conserva el corte más completo y claro.',
    'Cada candidato incluye context_before y context_after: son frases cercanas FUERA del corte propuesto y solo sirven para entender la conversación. No las cuentes como contenido del clip ni cambies sus tiempos. Si el gancho, la explicación o el remate dependen demasiado de ese contexto externo, penaliza el candidato o prefiere otro que contenga el intercambio completo.',
    'Prefiere el fragmento completo más corto que conserve la premisa y el remate. Busca variedad de temas y formatos. El idioma puede ser español o inglés.',
    'No inventes hechos ni cambies los tiempos. Solo puedes elegir IDs de esta lista.',
    'En esta ronda elige exactamente '+count+' fragmentos. '+phase,
    'Devuelve SOLO JSON válido: {"selected":[{"id":1,"score":92,"rubric":{"hook":9,"story":8,"payoff":9,"clarity":9,"completeness":10,"emotion":8,"pacing":8,"originality":9,"importance":9},"title":"título breve","reason":"qué aporta este momento al contenido y por qué es importante","importance_evidence":"cita literal de al menos cuatro palabras consecutivas del diálogo que demuestra su importancia"}]}.',
    'CANDIDATOS:',JSON.stringify(shortlist)
  ].join('\n');
  onProgress(phase);
  const response=await engine.chat.completions.create({
    messages:[
      {role:'system',content:'Eres un editor audiovisual exigente. No inventes contenido. Responde exclusivamente con JSON válido.'},
      {role:'user',content:prompt}
    ],
    temperature:0.12,
    max_tokens:Math.min(4096,700+count*260),
    response_format:{type:'json_object'}
  });
  const raw=response?.choices?.[0]?.message?.content||'';
  try{return parseEditorialDecision(raw,pool,count,false,engine.isRemote?'remote_generative_editor':'local_generative_editor');}
  catch(firstError){
    // Small local models sometimes return overlapping IDs even when instructed
    // not to. Give them one constrained repair pass instead of abandoning the
    // generative route or silently switching to heuristic selection.
    onProgress('Revisión editorial: corrigiendo solapamientos y cortes incompletos…');
    const retry=await engine.chat.completions.create({
      messages:[
        {role:'system',content:'Eres un editor audiovisual estricto. Devuelve exclusivamente JSON válido y respeta las restricciones.'},
        {role:'user',content:prompt},
        {role:'assistant',content:String(raw).slice(0,5000)},
        {role:'user',content:'La selección anterior ha sido rechazada: '+String(firstError.message||firstError)+'. Vuelve a evaluar la lista completa y devuelve exactamente '+count+' IDs válidos, todos distintos y sin solapamiento temporal (deja al menos 1 segundo entre clips). No repitas la selección anterior si contiene solapamientos. Devuelve el mismo JSON con la rúbrica editorial completa.'}
      ],temperature:0.08,max_tokens:700,response_format:{type:'json_object'}
    });
    return parseEditorialDecision(retry?.choices?.[0]?.message?.content||'',pool,count,false,engine.isRemote?'remote_generative_editor':'local_generative_editor');
  }
}

async function aiEditorialSelect(candidates, limit = 4, onProgress = () => {}) {
  limit=4; // Product requirement: exactly four important moments per video.
  const pool=(Array.isArray(candidates)?candidates:[]).filter(c=>
    c&&Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.end>c.start&&String(c.text||'').trim()
  );
  if(pool.length<limit)throw new Error('No hay suficientes fragmentos de diálogo para la selección editorial IA.');
  const engine=await loadEditorialJudge(onProgress);
  // Every candidate is judged. Four chronological batches keep each prompt
  // compact; four finalists per block reach the global importance comparison.
  const finalists=[];
  const batchSize=24; // Four broad comparisons reduce external model calls and credit use.
  if(pool.length<=batchSize){
    finalists.push(...pool);
  }else{
    const batchCount=Math.ceil(pool.length/batchSize);
    // Review consecutive chronological blocks for bounded prompts, but keep four
    // options from each. The final global vote may choose several moments from
    // one part of the video; temporal variety never overrides importance.
    const batches=Array.from({length:batchCount},(_,batchIndex)=>
      pool.slice(batchIndex*batchSize,(batchIndex+1)*batchSize)
    );
    for(let index=0;index<batches.length;index++){
      const batch=batches[index];
      const keep=Math.min(4,batch.length); // Four options per block; no forced one-per-quarter quota.
      const selected=await askEditorialModel(engine,batch,keep,onProgress,'Evaluación editorial IA: bloque global '+(index+1)+'/'+batches.length+'…');
      finalists.push(...selected);
    }
  }
  if(finalists.length<limit)throw new Error('La evaluación por bloques no produjo suficientes finalistas.');
  // Keep all block finalists for the global importance-first vote. Avoid downloading
  // a second embedding model: the editorial judge compares importance and duplication.
  const finalPool=finalists;
  const firstVote=await askEditorialModel(engine,finalPool,limit,onProgress,'Primera votación editorial: eligiendo los '+limit+' mejores clips entre todos los finalistas…');
  // A separate, adversarial editorial pass audits the complete finalist set.
  // It is deliberately blind to the first vote's scores and reasons: it sees
  // only the candidate evidence and which IDs were provisionally selected.
  // This is an independent judgment pass, not a claim of a second model.
  onProgress('Segunda pasada editorial: comprobando importancia, contexto y evidencia literal…');
  const auditInput=finalPool.map((clip,index)=>({
    id:index+1,start:Number(clip.start.toFixed(1)),end:Number(clip.end.toFixed(1)),
    transcript:String(clip.text||'').replace(/\\s+/g,' ').slice(0,620),
    context_before:String(clip.context_before||'').replace(/\\s+/g,' ').slice(-160),
    context_after:String(clip.context_after||'').replace(/\\s+/g,' ').slice(0,160),
    provisional:firstVote.some(p=>Math.abs(p.start-clip.start)<0.05&&Math.abs(p.end-clip.end)<0.05)
  }));
  const auditPrompt=[
    'Eres un revisor editorial en una segunda pasada adversarial. Reevalúa el material desde cero y cuestiona la primera votación.',
    'Revisa TODOS los finalistas desde cero. No favorezcas provisional=true: puede ser un error de la primera votación. Esta segunda pasada usa el mismo modelo, así que debe buscar activamente errores y no fingir independencia técnica.',
    'Tu prioridad es comprobar que el momento aporta algo importante al contenido y que el corte conserva su sentido. Importancia: nueva información, explicación clave, ejemplo concreto, decisión, conflicto, revelación, cambio, consecuencia, resultado o conclusión relevante. No confundas volumen, risa o frase llamativa con importancia. Rechaza cortes que dependan de contexto externo, ideas incompletas, ASR ininteligible, relleno y duplicados. No exijas un gancho espectacular ni un remate cómico.',
    'Compara primero la importancia del contenido y después la claridad y autonomía del corte. No evalúes retención probable, viralidad ni popularidad del tema. Si un provisional aporta menos que una alternativa, sustitúyelo. No inventes palabras ni cambies timestamps.',
    'Devuelve exactamente '+limit+' IDs distintos y no solapados. Incluye la rúbrica completa hook, story, payoff, clarity, completeness, emotion, pacing, originality e importance (0-10), title, reason e importance_evidence. importance_evidence debe ser una cita literal de al menos cuatro palabras consecutivas del transcript de ese candidato; no la inventes ni la parafrasees. La razón debe explicar qué aporta al vídeo, no solo describir la escena. Añade audit_verdict="pass" y audit_flags=[] si no detectas defecto; si hay defectos en otros candidatos, no los selecciones.',
    'Devuelve SOLO JSON válido con la misma estructura {"selected":[...]}.',
    'FINALISTAS PARA AUDITAR:',JSON.stringify(auditInput)
  ].join('\n');
  const auditRequest={messages:[
    {role:'system',content:'Actúas como revisor editorial de segunda pasada. Busca motivos para DESCARTAR, no para confirmar. Responde solo JSON válido.'},
    {role:'user',content:auditPrompt}
  ],temperature:0.05,max_tokens:Math.min(4096,700+limit*260),response_format:{type:'json_object'}};
  let audited;
  let auditRaw='';
  try{
    const audit=await engine.chat.completions.create(auditRequest);
    auditRaw=audit?.choices?.[0]?.message?.content||'';
    audited=parseEditorialDecision(auditRaw,finalPool,limit,true,engine.isRemote?'remote_generative_editor':'local_generative_editor');
  }catch(firstAuditError){
    onProgress('Segunda pasada: corrigiendo citas no verificables o clips que no superan la auditoría…');
    const retry=await engine.chat.completions.create({...auditRequest,messages:[
      ...auditRequest.messages,
      {role:'assistant',content:String(auditRaw).slice(0,5000)},
      {role:'user',content:'La auditoría anterior no ha superado la validación: '+String(firstAuditError.message||firstAuditError)+'. Devuelve exactamente cuatro candidatos distintos, sin solapamiento, con importance >= 6.5, audit_verdict="pass", audit_flags=[] y una cita literal de al menos cuatro palabras consecutivas que aparezca en el transcript de su propio candidato. No inventes citas. Si no puedes demostrarlo, elige otro candidato. Devuelve JSON válido únicamente.'}
    ],temperature:0.02});
    audited=parseEditorialDecision(retry?.choices?.[0]?.message?.content||'',finalPool,limit,true,engine.isRemote?'remote_generative_editor':'local_generative_editor');
  }
  const firstKeys=new Set(firstVote.map(c=>`${c.start.toFixed(1)}-${c.end.toFixed(1)}`));
  return audited.map((clip,index)=>({...clip,
    ai_editorial_audit:'second_pass_audit_pass',
    ai_editorial_consensus:firstKeys.has(`${clip.start.toFixed(1)}-${clip.end.toFixed(1)}`)?'both_passes':'critic_replacement',
    ai_editorial_rank:index+1
  }));
}

async function semanticRerankCandidates(candidates, limit = 4, onProgress = () => {}) {
  if (!Array.isArray(candidates) || candidates.length < 2 || !candidates.some(clip => String(clip.text || '').trim())) {
    return rerankWithoutEmbeddings(candidates, limit);
  }  const {pipeline, env} = await import('https://esm.sh/@huggingface/transformers@3.7.2');
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  const extractor = await pipeline(
    'feature-extraction',
    'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    {
      dtype: 'q8',
      progress_callback: progress => {
        if (progress.status === 'progress') onProgress(`Descargando modelo semántico gratuito: ${progress.file || ''} · ${Math.round(progress.progress || 0)}%`);
        else if (progress.status) onProgress(`Modelo semántico: ${progress.status}`);
      }
    }
  );
  try {
    const embeddings = [];
    for (let i = 0; i < candidates.length; i++) {
      onProgress(`Comparando el sentido de los candidatos: ${i + 1}/${candidates.length}…`);
      const text = String(candidates[i].text || '').trim().slice(0, 2200);
      const output = await extractor(text, {pooling: 'mean', normalize: true});
      const vector = Array.from(output.data || []);
      if (!vector.length || vector.some(value => !Number.isFinite(value))) {
        throw new Error('El modelo semántico no devolvió un vector válido.');
      }
      embeddings.push(vector);
    }
    return rerankWithSemanticEmbeddings(candidates, embeddings, limit);
  } finally {
    try { await extractor.dispose?.(); } catch {}
  }
}

// Daily AI clip budget: local device-based cap, persisted per browser profile.
const DAILY_CLIP_BUDGET_KEY='clipforge.ai-clips-daily.v1';
function getDailyClipBudget(){
  const memory=Number(navigator.deviceMemory)||4;
  const max=memory>=8?90:memory>=4?60:30;
  const now=new Date();
  const today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
  let record={date:today,used:0};
  try{const saved=JSON.parse(localStorage.getItem(DAILY_CLIP_BUDGET_KEY)||'null');if(saved?.date===today)record={date:today,used:Math.max(0,Math.floor(Number(saved.used)||0))};}catch{}
  return {date:today,used:record.used,max,remaining:Math.max(0,max-record.used)};
}
function recordDailyAIClips(count){
  const budget=getDailyClipBudget();
  const used=Math.min(budget.max,budget.used+Math.max(0,Math.floor(Number(count)||0)));
  try{localStorage.setItem(DAILY_CLIP_BUDGET_KEY,JSON.stringify({date:budget.date,used}));}catch{}
  return getDailyClipBudget();
}
let editableCandidates=[];
function showClipCandidates(words,duration,restoredCandidates=null,audioSamples=null,visualSamples=[]) {
 const panel=document.querySelector('#browserCandidates'),list=document.querySelector('#browserCandidateList');
 if(!panel||!list)return;
 editableCandidates=(restoredCandidates || rankClipCandidates(words,duration,audioSamples,16000,visualSamples)).map((c,i)=>({...c,title:c.title||`Clip ${i+1}`,selected:c.selected!==false}));
 panel.hidden=false;list.replaceChildren();
 panel.querySelector('.cf-results-toolbar')?.remove();panel.querySelector('.cf-editor-toolbar')?.remove();
 document.body.classList.add('cf-stage-results');document.body.classList.remove('cf-stage-editor');
 const stageHead=document.createElement('div');stageHead.className='cf-results-toolbar';
 const back=document.createElement('button');back.type='button';back.className='secondary cf-back-source';back.textContent='← Cambiar vídeo';back.addEventListener('click',()=>{document.body.classList.remove('cf-stage-results','cf-stage-editor');panel.hidden=true;});
 const stageTitle=document.createElement('div');stageTitle.innerHTML='<strong>Clips seleccionados</strong><small>Elige uno de los cuatro clips para abrir el editor</small>';
 stageHead.append(back,stageTitle);panel.prepend(stageHead);
 if(!editableCandidates.length){list.textContent='No hay suficientes marcas de tiempo.';const field=document.querySelector('[name="selected_clip_ranges"]');if(field)field.value='';return;}
 const sync=()=>{
  let field=document.querySelector('[name="selected_clip_ranges"]');
  const form=document.querySelector('#video')?.form;
  if(!field&&form){field=document.createElement('input');field.type='hidden';field.name='selected_clip_ranges';form.append(field);}
  if(field)field.value=JSON.stringify(editableCandidates);
  window.dispatchEvent(new CustomEvent('clipforge:candidate-edited'));
 };
 const videoDuration=Math.max(1,Number(duration)||1);
 const timeLabel=seconds=>{const n=Math.max(0,Math.floor(seconds));return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');};
 editableCandidates.forEach((c,i)=>{
  const card=document.createElement('article');card.className='candidate-card';card.dataset.candidateIndex=String(i);
  const sourceFile=document.querySelector('#video')?.files?.[0];
  if(sourceFile){
    const key=`${sourceFile.name}:${sourceFile.size}:${sourceFile.lastModified}`;
    if(key!==candidatePreviewKey){if(candidatePreviewUrl)URL.revokeObjectURL(candidatePreviewUrl);candidatePreviewUrl=URL.createObjectURL(sourceFile);candidatePreviewKey=key;}
  }
  const player=document.createElement('div');player.className='cf-inline-player';
  const film=document.createElement('video');film.className='candidate-filmstrip';film.muted=false;film.volume=.8;film.playsInline=true;film.preload='metadata';film.controls=false;film.setAttribute('aria-label','Vista previa integrada del clip');
  if(candidatePreviewUrl){film.src=candidatePreviewUrl;film.addEventListener('loadedmetadata',()=>{film.currentTime=Math.min(Math.max(0,Number(c.start)||0),Math.max(0,film.duration-.1));},{once:true});film.addEventListener('seeked',()=>film.pause(),{once:true});}
  const playerBar=document.createElement('div');playerBar.className='cf-inline-player-controls';
  const seekBack=document.createElement('button');seekBack.type='button';seekBack.className='cf-player-seek';seekBack.textContent='↶ 5';seekBack.setAttribute('aria-label','Retroceder 5 segundos');seekBack.title='Retroceder 5 segundos';seekBack.addEventListener('click',()=>{if(Number.isFinite(film.duration))film.currentTime=Math.max(0,film.currentTime-5);});
  const play=document.createElement('button');play.type='button';play.className='cf-player-play';play.textContent='▶';play.setAttribute('aria-label','Reproducir');play.addEventListener('click',async()=>{if(film.paused){try{await film.play();}catch{} }else film.pause();});
  const seekForward=document.createElement('button');seekForward.type='button';seekForward.className='cf-player-seek';seekForward.textContent='5 ↷';seekForward.setAttribute('aria-label','Avanzar 5 segundos');seekForward.title='Avanzar 5 segundos';seekForward.addEventListener('click',()=>{if(Number.isFinite(film.duration))film.currentTime=Math.min(film.duration,film.currentTime+5);});
  film.addEventListener('play',()=>{play.textContent='Ⅱ';play.setAttribute('aria-label','Pausar');});film.addEventListener('pause',()=>{play.textContent='▶';play.setAttribute('aria-label','Reproducir');});
  const volumeIcon=document.createElement('span');volumeIcon.className='cf-player-volume-icon';volumeIcon.textContent='🔊';
  const volume=document.createElement('input');volume.type='range';volume.className='cf-player-volume';volume.min='0';volume.max='1';volume.step='.01';volume.value='.8';volume.setAttribute('aria-label','Volumen');volume.addEventListener('input',()=>{film.volume=Number(volume.value);film.muted=film.volume===0;volumeIcon.textContent=film.muted?'🔇':'🔊';});
  playerBar.append(seekBack,play,seekForward,volumeIcon,volume);player.append(film,playerBar);
  // Inline subtitle editor scoped to this clip
  const subtitlePanel=document.createElement('section');subtitlePanel.className='cf-inline-subtitles';
  const subtitleHead=document.createElement('div');subtitleHead.className='cf-inline-subtitles-head';subtitleHead.textContent='Subtítulos del clip';
  const subtitleControls=document.createElement('div');subtitleControls.className='cf-subtitle-style-controls';
  const font=document.createElement('select');font.setAttribute('aria-label','Tipo de letra');
  [['Arial','Arial'],['Inter','Inter'],['Roboto','Roboto'],['Montserrat','Montserrat'],['Georgia','Georgia'],['Impact','Impact']].forEach(([v,l])=>font.add(new Option(l,v)));
  const size=document.createElement('input');size.type='number';size.min='12';size.max='72';size.step='1';size.value=String(c.subtitleStyle?.size||28);size.setAttribute('aria-label','Tamaño de subtítulos');
  const color=document.createElement('input');color.type='color';color.value=c.subtitleStyle?.color||'#ffffff';color.setAttribute('aria-label','Color de subtítulos');
  const bg=document.createElement('input');bg.type='color';bg.value=c.subtitleStyle?.background||'#000000';bg.setAttribute('aria-label','Fondo de subtítulos');
  const bold=document.createElement('button');bold.type='button';bold.className='secondary cf-subtitle-bold';bold.textContent='B';bold.setAttribute('aria-label','Negrita');bold.setAttribute('aria-pressed',String(c.subtitleStyle?.bold!==false));
  const subtitlePreview=document.createElement('div');subtitlePreview.className='cf-subtitle-live-preview';subtitlePreview.textContent='Vista previa del subtítulo';
  const subtitleRows=document.createElement('div');subtitleRows.className='cf-subtitle-rows';
  const subtitleSegments=(transcriptData?.segments||[]).map((seg,index)=>({...seg,_sourceIndex:index})).filter(seg=>Number(seg.end)>Number(c.start)&&Number(seg.start)<Number(c.end));
  const subtitleOverlay=document.createElement('div');subtitleOverlay.className='cf-subtitle-video-overlay';subtitleOverlay.hidden=true;player.append(subtitleOverlay);
  const renderActiveSubtitle=()=>{const active=subtitleSegments.find(seg=>film.currentTime>=Number(seg.start)&&film.currentTime<=Number(seg.end));subtitleOverlay.textContent=active?String(active.text||''):'';subtitleOverlay.hidden=!active;};
  film.addEventListener('timeupdate',renderActiveSubtitle);
  const style={font:font.value,size:Number(size.value),color:color.value,background:bg.value,bold:bold.getAttribute('aria-pressed')==='true',...(c.subtitleStyle||{})};
  font.value=style.font||'Arial';size.value=String(style.size||28);color.value=style.color||'#ffffff';bg.value=style.background||'#000000';bold.setAttribute('aria-pressed',String(style.bold!==false));
  const paintSubtitle=()=>{const sizePx=Math.max(12,Math.min(72,Number(style.size)||28))+'px';subtitlePreview.style.fontFamily=style.font;subtitlePreview.style.fontSize=sizePx;subtitlePreview.style.color=style.color;subtitlePreview.style.backgroundColor=style.background;subtitlePreview.style.fontWeight=style.bold?'800':'400';subtitleOverlay.style.fontFamily=style.font;subtitleOverlay.style.fontSize=sizePx;subtitleOverlay.style.color=style.color;subtitleOverlay.style.backgroundColor=style.background;subtitleOverlay.style.fontWeight=style.bold?'800':'400';};
  const saveSubtitleStyle=()=>{style.font=font.value;style.size=Number(size.value)||28;style.color=color.value;style.background=bg.value;style.bold=bold.getAttribute('aria-pressed')==='true';c.subtitleStyle={...style};editableCandidates[i]={...c};paintSubtitle();sync();};
  [font,size,color,bg].forEach(el=>el.addEventListener('input',saveSubtitleStyle));
  bold.addEventListener('click',()=>{bold.setAttribute('aria-pressed',String(bold.getAttribute('aria-pressed')!=='true'));saveSubtitleStyle();});
  subtitleControls.append(font,size,color,bg,bold);
  subtitleSegments.forEach(seg=>{
    const row=document.createElement('div');row.className='cf-subtitle-row';
    const times=document.createElement('div');times.className='cf-subtitle-times';
    const st=document.createElement('input');st.type='number';st.step='.01';st.min=String(c.start);st.max=String(c.end);st.value=Number(seg.start).toFixed(2);st.setAttribute('aria-label','Inicio del subtítulo');
    const en=document.createElement('input');en.type='number';en.step='.01';en.min=String(c.start);en.max=String(c.end);en.value=Number(seg.end).toFixed(2);en.setAttribute('aria-label','Final del subtítulo');
    times.append(st,en);
    const txt=document.createElement('textarea');txt.rows=2;txt.value=String(seg.text||'');txt.setAttribute('aria-label','Texto del subtítulo');
    const applySub=document.createElement('button');applySub.type='button';applySub.className='secondary';applySub.textContent='Aplicar';
    applySub.addEventListener('click',()=>{const a=Number(st.value),b=Number(en.value);if(!Number.isFinite(a)||!Number.isFinite(b)||a<Number(c.start)||b>Number(c.end)||b<=a){say('Revisa los tiempos del subtítulo: deben quedar dentro del clip.');return;}const original=transcriptData?.segments?.[seg._sourceIndex];if(original){original.start=a;original.end=b;original.text=txt.value;seg.start=a;seg.end=b;seg.text=txt.value;paintSubtitleTrack();renderActiveSubtitle();sync();say('Subtítulo actualizado y sincronizado con su bloque en la línea de tiempo.');}});
    txt.addEventListener('input',()=>{subtitlePreview.textContent=txt.value||'Vista previa del subtítulo';});
    row.append(times,txt,applySub);subtitleRows.append(row);
  });
  if(!subtitleSegments.length){const empty=document.createElement('p');empty.className='cf-subtitle-empty';empty.textContent=transcriptData?'No hay subtítulos dentro de este fragmento.':'Transcribe el vídeo para generar y editar los subtítulos aquí.';subtitleRows.append(empty);}
  subtitlePanel.append(subtitleHead,subtitleControls,subtitlePreview,subtitleRows);
  paintSubtitle();
  const timeline=document.createElement('div');timeline.className='cf-clip-timeline';timeline.setAttribute('aria-label','Ajuste preciso de inicio y final');
  const zoomWrap=document.createElement('div');zoomWrap.className='cf-clip-zoom-wrap';
  const overviewHead=document.createElement('div');overviewHead.className='cf-clip-overview-head';overviewHead.textContent='Vídeo completo · referencia';
  const overviewRail=document.createElement('div');overviewRail.className='cf-clip-overview-rail';
  const overviewSelected=document.createElement('div');overviewSelected.className='cf-clip-overview-selected';
  overviewRail.append(overviewSelected);
  const zoomTitle=document.createElement('div');zoomTitle.className='cf-clip-zoom-title';zoomTitle.textContent='Zona seleccionada';
  const zoomRail=document.createElement('div');zoomRail.className='cf-clip-zoom-rail';
  const zoomSelected=document.createElement('div');zoomSelected.className='cf-clip-zoom-selected';
  const zoomLeft=document.createElement('button');zoomLeft.type='button';zoomLeft.className='cf-clip-timeline-handle is-start';zoomLeft.setAttribute('aria-label','Ajustar inicio con precisión');
  const zoomRight=document.createElement('button');zoomRight.type='button';zoomRight.className='cf-clip-timeline-handle is-end';zoomRight.setAttribute('aria-label','Ajustar final con precisión');
  zoomRail.append(zoomSelected,zoomLeft,zoomRight);
  zoomWrap.append(overviewHead,overviewRail,zoomTitle,zoomRail);timeline.append(zoomWrap);
  const subtitleTrackWrap=document.createElement('section');subtitleTrackWrap.className='cf-subtitle-timeline-wrap';
  const subtitleTrackTitle=document.createElement('strong');subtitleTrackTitle.textContent='Línea de tiempo · subtítulos';
  const subtitleTrack=document.createElement('div');subtitleTrack.className='cf-clip-subtitle-track';subtitleTrack.setAttribute('aria-label','Pista de subtítulos del clip');
  const subtitleTrackRuler=document.createElement('div');subtitleTrackRuler.className='cf-subtitle-track-ruler';
  for(let tick=0;tick<=4;tick++){const mark=document.createElement('span');mark.textContent=(Number(c.start)+(Number(c.end)-Number(c.start))*tick/4).toFixed(1)+'s';mark.style.left=(tick*25)+'%';subtitleTrackRuler.append(mark);}
  const subtitleTrackRail=document.createElement('div');subtitleTrackRail.className='cf-subtitle-track-rail';
  const subtitlePlayhead=document.createElement('div');subtitlePlayhead.className='cf-subtitle-track-playhead';subtitlePlayhead.setAttribute('aria-hidden','true');
  const paintSubtitlePlayhead=()=>{const span=Math.max(.001,Number(c.end)-Number(c.start));const pct=Math.max(0,Math.min(100,(film.currentTime-Number(c.start))/span*100));subtitlePlayhead.style.left=pct+'%';};
  film.addEventListener('timeupdate',paintSubtitlePlayhead);
  const paintSubtitleTrack=()=>{
    subtitleTrackRail.replaceChildren();
    subtitleSegments.forEach((seg,index)=>{
      const block=document.createElement('button');block.type='button';block.className='cf-clip-subtitle-block';
      const clipSpan=Math.max(.001,Number(c.end)-Number(c.start));
      const left=Math.max(0,(Number(seg.start)-Number(c.start))/clipSpan*100),width=Math.max(1.2,(Number(seg.end)-Number(seg.start))/clipSpan*100);
      block.style.left=left+'%';block.style.width=Math.min(width,100-left)+'%';
      block.textContent=String(seg.text||'').slice(0,24);block.title=Number(seg.start).toFixed(2)+'–'+Number(seg.end).toFixed(2)+' s · '+String(seg.text||'');
      block.addEventListener('click',()=>{film.pause();film.currentTime=Math.max(Number(c.start),Math.min(Number(c.end)-.01,Number(seg.start)));const row=subtitleRows.children[index];row?.scrollIntoView({behavior:'smooth',block:'nearest'});row?.classList.add('is-active');setTimeout(()=>row?.classList.remove('is-active'),900);});
      subtitleTrackRail.append(block);
    });
    subtitleTrackRail.append(subtitlePlayhead);
  };
  subtitleTrack.addEventListener('click',event=>{if(event.target.closest('.cf-clip-subtitle-block'))return;const rect=subtitleTrackRail.getBoundingClientRect();const pct=Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width)));film.currentTime=Math.max(Number(c.start),Math.min(Number(c.end)-.01,Number(c.start)+pct*(Number(c.end)-Number(c.start))));});
  subtitleTrack.append(subtitleTrackRuler,subtitleTrackRail);
  subtitleTrackWrap.append(subtitleTrackTitle,subtitleTrack);timeline.append(subtitleTrackWrap);
  paintSubtitleTrack();
  // Video-thumbnail lane, like a conventional NLE timeline. Clicking a frame seeks the preview.
  const videoTrackWrap=document.createElement('section');videoTrackWrap.className='cf-video-timeline-wrap';
  const videoTrackTitle=document.createElement('strong');videoTrackTitle.className='cf-video-timeline-title';videoTrackTitle.textContent='Vídeo · pista principal';
  const videoTrackRail=document.createElement('div');videoTrackRail.className='cf-video-track-rail';videoTrackRail.setAttribute('aria-label','Pista de vídeo con fotogramas');
  const videoTrackPlayhead=document.createElement('div');videoTrackPlayhead.className='cf-video-track-playhead';
  const paintVideoPlayhead=()=>{const span=Math.max(.001,Number(c.end)-Number(c.start));videoTrackPlayhead.style.left=Math.max(0,Math.min(100,(film.currentTime-Number(c.start))/span*100))+'%';};
  film.addEventListener('timeupdate',paintVideoPlayhead);
  const buildVideoThumbnails=async()=>{
    if(!film.duration||!Number.isFinite(film.duration)||videoTrackRail.dataset.ready==='1')return;
    videoTrackRail.dataset.ready='1';
    const wasPaused=film.paused,oldTime=film.currentTime;
    const count=12,canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
    canvas.width=120;canvas.height=68;
    for(let n=0;n<count;n++){
      const t=Number(c.start)+(Number(c.end)-Number(c.start))*((n+.5)/count);
      try{
        film.currentTime=Math.max(0,Math.min(film.duration-.05,t));
        await new Promise(resolve=>{if(Math.abs(film.currentTime-t)<.08)return resolve();const done=()=>{film.removeEventListener('seeked',done);resolve();};film.addEventListener('seeked',done,{once:true});setTimeout(done,900);});
        ctx?.drawImage(film,0,0,canvas.width,canvas.height);
        const thumb=document.createElement('img');thumb.className='cf-video-track-thumb';thumb.alt='';thumb.src=canvas.toDataURL('image/jpeg',.65);thumb.dataset.time=String(t);
        thumb.addEventListener('click',()=>{film.currentTime=t;});videoTrackRail.append(thumb);
      }catch{const fallback=document.createElement('span');fallback.className='cf-video-track-thumb-fallback';fallback.textContent='▶';videoTrackRail.append(fallback);}
    }
    film.currentTime=oldTime;
    if(!wasPaused)film.play().catch(()=>{});
    paintVideoPlayhead();
    videoTrackRail.append(videoTrackPlayhead);
  };
  film.addEventListener('loadedmetadata',buildVideoThumbnails,{once:true});
  if(film.readyState>=1)buildVideoThumbnails();
  videoTrackRail.addEventListener('click',event=>{if(event.target.closest('.cf-video-track-thumb'))return;const rect=videoTrackRail.getBoundingClientRect();const pct=Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width)));film.currentTime=Number(c.start)+pct*(Number(c.end)-Number(c.start));});
  videoTrackWrap.append(videoTrackTitle,videoTrackRail);timeline.append(videoTrackWrap);
  // Audio waveform lane, decoded locally from the uploaded source file.
  const audioTrackWrap=document.createElement('section');audioTrackWrap.className='cf-audio-timeline-wrap';
  const audioTrackTitle=document.createElement('strong');audioTrackTitle.className='cf-audio-timeline-title';audioTrackTitle.textContent='Audio · forma de onda';
  const audioTrackRail=document.createElement('div');audioTrackRail.className='cf-audio-track-rail';audioTrackRail.setAttribute('aria-label','Forma de onda del audio');
  const audioPlayhead=document.createElement('div');audioPlayhead.className='cf-audio-track-playhead';
  const paintAudioPlayhead=()=>{const span=Math.max(.001,Number(c.end)-Number(c.start));audioPlayhead.style.left=Math.max(0,Math.min(100,(film.currentTime-Number(c.start))/span*100))+'%';};
  film.addEventListener('timeupdate',paintAudioPlayhead);
  const buildAudioWaveform=async()=>{try{if(!sourceFile||audioTrackRail.dataset.ready==='1')return;audioTrackRail.dataset.ready='1';const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)return;const ctx=new AudioCtx();const buffer=await ctx.decodeAudioData(await sourceFile.arrayBuffer());const channel=buffer.getChannelData(0),count=112,span=Math.max(.001,Number(c.end)-Number(c.start));for(let n=0;n<count;n++){const t=Number(c.start)+span*n/count,from=Math.max(0,Math.floor(t*buffer.sampleRate)),to=Math.min(channel.length,Math.max(from+1,Math.floor((t+span/count)*buffer.sampleRate)));let peak=0;for(let j=from;j<to;j+=Math.max(1,Math.floor((to-from)/80)))peak=Math.max(peak,Math.abs(channel[j]||0));const bar=document.createElement('i');bar.className='cf-audio-wave-bar';bar.style.height=Math.max(8,Math.round(peak*42))+'px';audioTrackRail.append(bar);}audioTrackRail.append(audioPlayhead);paintAudioPlayhead();await ctx.close();}catch{audioTrackTitle.textContent='Audio · vista de onda no disponible';}};
  buildAudioWaveform();
  audioTrackRail.addEventListener('click',event=>{const rect=audioTrackRail.getBoundingClientRect(),pct=Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width)));film.currentTime=Number(c.start)+pct*(Number(c.end)-Number(c.start));});
  audioTrackWrap.append(audioTrackTitle,audioTrackRail);timeline.append(audioTrackWrap);
  const paintTimeline=()=>{const st=Math.max(0,Math.min(videoDuration-.1,Number(c.start)||0)),en=Math.max(st+.1,Math.min(videoDuration,Number(c.end)||st+.1));const pad=Math.max(8,(en-st)*.65),z0=Math.max(0,st-pad),z1=Math.min(videoDuration,en+pad),span=Math.max(.2,z1-z0),zl=(st-z0)/span*100,zr=(en-z0)/span*100;overviewSelected.style.left=(st/videoDuration*100)+'%';overviewSelected.style.width=((en-st)/videoDuration*100)+'%';zoomSelected.style.left=zl+'%';zoomSelected.style.width=(zr-zl)+'%';zoomLeft.style.left=zl+'%';zoomRight.style.left=zr+'%';};
  const changeEdge=(edge,value)=>{const t=Math.max(0,Math.min(videoDuration,value)),gap=Math.min(.1,videoDuration);if(edge==='start')c.start=Math.max(0,Math.min(t,c.end-gap));else c.end=Math.min(videoDuration,Math.max(t,c.start+gap));c.duration=c.end-c.start;editableCandidates[i]={...c};paintTimeline();sync();};
  const bindDrag=(handle,edge,target,zoomed=false)=>{handle.addEventListener('pointerdown',event=>{event.preventDefault();event.stopPropagation();handle.setPointerCapture?.(event.pointerId);const move=ev=>{const rect=target.getBoundingClientRect();let lo=0,hi=videoDuration;if(zoomed){const pad=Math.max(8,(c.end-c.start)*.65);lo=Math.max(0,c.start-pad);hi=Math.min(videoDuration,c.end+pad);}const f=Math.max(0,Math.min(1,(ev.clientX-rect.left)/Math.max(1,rect.width)));changeEdge(edge,lo+f*(hi-lo));};const stop=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',stop);handle.removeEventListener('pointercancel',stop);};handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);});handle.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const d=(event.shiftKey?1:.05)*(event.key==='ArrowLeft'?-1:1);changeEdge(edge,(edge==='start'?c.start:c.end)+d);});};
  bindDrag(zoomLeft,'start',zoomRail,true);bindDrag(zoomRight,'end',zoomRail,true);
  const heading=document.createElement('strong');heading.textContent=(c.selection_method==='local_generative_editor'||c.selection_method==='remote_generative_editor')?(c.title+' · valoración IA '+c.ai_editorial_score+'/100'):(c.title+' · candidato para revisión');
  const exportSingle=document.createElement('button');exportSingle.type='button';exportSingle.className='secondary candidate-export-one';exportSingle.textContent='Exportar este clip';exportSingle.addEventListener('click',()=>{editableCandidates.forEach((candidate,j)=>{candidate.selected=j===i;const checkbox=list.querySelector(`.candidate-card[data-candidate-index="${j}"] .candidate-select input`);if(checkbox)checkbox.checked=j===i;});sync();document.querySelector('#browserExportClips')?.click();});
  const selectLabel=document.createElement('label');selectLabel.className='candidate-select';
  const select=document.createElement('input');select.type='checkbox';select.checked=c.selected!==false;
  select.setAttribute('aria-label','Incluir clip en exportación');
  select.addEventListener('change',()=>{editableCandidates[i]={...editableCandidates[i],selected:select.checked};sync();});
  selectLabel.append(select,document.createTextNode(' Incluir en exportación'));
  paintTimeline();
  const openClip=document.createElement('button');openClip.type='button';openClip.className='secondary cf-open-clip-editor';openClip.textContent='Abrir editor →';
  const openThis=()=>{list.querySelectorAll('.candidate-card').forEach(el=>el.classList.remove('is-open'));card.classList.add('is-open');document.body.classList.remove('cf-stage-results');document.body.classList.add('cf-stage-editor');film.pause();let toolbar=panel.querySelector('.cf-editor-toolbar');if(!toolbar){toolbar=document.createElement('div');toolbar.className='cf-editor-toolbar';const backToResults=document.createElement('button');backToResults.type='button';backToResults.className='secondary';backToResults.textContent='← Volver a los 4 clips';backToResults.addEventListener('click',()=>{document.body.classList.remove('cf-stage-editor');document.body.classList.add('cf-stage-results');toolbar.remove();list.querySelectorAll('.candidate-card').forEach(el=>el.classList.remove('is-open'));});const editorTitle=document.createElement('div');editorTitle.innerHTML='<strong>Editor del clip</strong><small>Vídeo, recorte y subtítulos en un mismo espacio</small>';toolbar.append(backToResults,editorTitle);panel.prepend(toolbar);}window.dispatchEvent(new CustomEvent('clipforge:open-editor',{detail:{card,index:i,clip:{...c}}}));};
  openClip.addEventListener('click',event=>{event.stopPropagation();openThis();});
  card.addEventListener('click',event=>{if(event.target.closest('button,input,textarea,select,label'))return;openThis();});
  card.append(heading,player,timeline,subtitlePanel,openClip,exportSingle,selectLabel);list.append(card);
 });
 const info=document.createElement('p');info.textContent=editableCandidates.every(c=>c.selection_method==='local_generative_editor'||c.selection_method==='remote_generative_editor')?'Selección editorial realizada por un modelo generativo. Cada clip incluye evidencia textual que justifica su importancia y supera una segunda pasada de auditoría; revisa el resultado antes de exportar.':'Candidatos de respaldo sin selección editorial generativa confirmada.';list.append(info);
 sync();
 window.dispatchEvent(new CustomEvent('clipforge:clips-updated'));
}

function startAutomaticClipExport(){
  const panel=document.querySelector('#browserCandidates');
  const cards=panel?.querySelectorAll('.candidate-card').length||0;
  if(cards!==4){say(`Se han preparado ${cards} clips. ClipForge mostrará la pantalla de resultados cuando haya cuatro candidatos válidos.`);return;}
  panel.hidden=false;
  document.body.classList.add('cf-stage-results');
  document.body.classList.remove('cf-stage-editor');
  say('Los cuatro clips están listos. Selecciona uno para abrir su editor.');
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
      console.warn('Mediabunny no pudo extraer el audio; probando decodificación local con FFmpeg WASM.', demuxError);
      say('El decodificador nativo no admite esta pista. Activando FFmpeg local para extraer el audio sin reproducir el vídeo…');
      try {
        audio = await extractAudioWithFFmpegWasm(file, percent => say('Extrayendo audio localmente con FFmpeg: ' + percent + '%'));
        say('Audio extraído con FFmpeg local: ' + (audio.length / 16000).toFixed(1) + ' segundos. Preparando Whisper…');
      } catch (ffmpegError) {
        console.warn('FFmpeg WASM tampoco pudo decodificar el archivo; último recurso: captura en tiempo real.', ffmpegError);
        say('Falló la extracción directa (' + String(demuxError.message || demuxError) + ') y FFmpeg local (' + String(ffmpegError.message || ffmpegError) + '). Último recurso: reproducción local en tiempo real…');
        const capturedAudio = await captureAudioFromVideo(file);
        audio = capturedAudio instanceof Float32Array ? capturedAudio : await toMono16k(capturedAudio);
      }
    }
    const audioStats = (() => {
      let peak = 0, sumSquares = 0, audible = 0;
      const stride = Math.max(1, Math.floor(audio.length / 200000));
      let count = 0;
      for (let i = 0; i < audio.length; i += stride) {
        const value = Number.isFinite(audio[i]) ? audio[i] : 0;
        const abs = Math.abs(value);
        peak = Math.max(peak, abs);
        sumSquares += value * value;
        if (abs > 0.003) audible++;
        count++;
      }
      return { durationSeconds: Number((audio.length / 16000).toFixed(2)), peak: Number(peak.toFixed(4)), rms: Number(Math.sqrt(sumSquares / Math.max(1,count)).toFixed(4)), audiblePercent: Number((audible / Math.max(1,count) * 100).toFixed(1)) };
    })();
    console.info('[ClipForge audio diagnóstico]', audioStats);
    if (audioStats.peak < 0.0005 || audioStats.audiblePercent < 0.1) throw new Error(`La pista extraída parece casi silenciosa (pico ${audioStats.peak}, RMS ${audioStats.rms}, audio activo ${audioStats.audiblePercent}%). No se ejecutará Whisper sobre audio vacío o mal decodificado.`);
    say(`Audio verificado · pico ${audioStats.peak} · RMS ${audioStats.rms} · ${audioStats.audiblePercent}% activo. Cargando Whisper…`);
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
      // Prefer WebGPU on supported Chrome/Edge devices; retain a safe WASM fallback.
      let webgpuReady=false;
      try { if(navigator.gpu) webgpuReady=Boolean(await navigator.gpu.requestAdapter({powerPreference:'high-performance'})); } catch {}
      if(webgpuReady){
        try {
          say('Activando aceleración gráfica WebGPU para acelerar la transcripción…');
          asr = await pipeline('automatic-speech-recognition', id, { device:'webgpu', dtype:'fp16', progress_callback:progress });
          asrModelId=id;
          return;
        } catch(error) {
          console.warn('Whisper WebGPU no disponible para este modelo; usando WASM optimizado.',error);
          asr=null;
        }
      }
      asr = await pipeline('automatic-speech-recognition', id, { dtype:'q8', progress_callback:progress });
      asrModelId = id;
    };
    const reportProgress = (percent, current, total) => {
      say(`Transcribiendo vídeo: ${percent}% · fragmento ${current}/${total}`);
    };
    const languageControl = document.querySelector('#browserWhisperLanguage');
    const selectedLanguage = ['auto','es','en'].includes(languageControl?.value) ? languageControl.value : 'auto';
    const sourceLanguage = selectedLanguage === 'auto' ? undefined : selectedLanguage;
    console.info('[ClipForge ASR configuración]',{selectedLanguage,model,languageControlPresent:Boolean(languageControl),modelControlPresent:Boolean(document.querySelector('#browserWhisperModel'))});
    let activeModelId = modelId;
    let result;
    try {
      if (!asr || asrModelId !== modelId) {
        asr = null;
        asrModelId = null;
        await loadModel(modelId);
      }
      say('Transcribiendo con ventanas optimizadas de 30 segundos y marcas de tiempo por frase para acelerar el proceso…');
      // Phrase-level timestamps are enough for editable captions and clip
      // selection. Word-level alignment adds CPU work to every decode window.
      result = await transcribeAudioInChunks(asr, audio, reportProgress, 'word', sourceLanguage);
      if (model === 'whisper-small' && !(result.chunks || []).length) {
        throw new Error('Whisper Small no devolvió marcas de tiempo utilizables.');
      }
    } catch (transcriptionError) {
      if (model !== 'whisper-small') throw transcriptionError;
      activeModelId = 'onnx-community/whisper-base_timestamped';
      say('Whisper Small ha fallado. Cambiando automáticamente a Whisper Base y conservando el idioma seleccionado…');
      await releaseWhisperModel();
      await loadModel(activeModelId);
      result = await transcribeAudioInChunks(asr, audio, reportProgress, 'word', sourceLanguage);
      if (!(result.chunks || []).length) {
        throw new Error(`Whisper Base tampoco devolvió marcas de tiempo. Error de Small: ${transcriptionError.message}`);
      }
    }
    // A single giant timestamped chunk is not useful for editing. Retry
    // with Whisper's segment timestamps before accepting an under-segmented result.
    const sourceDurationForTiming = audio.length / 16000;
    const plausibleWordFloor = sourceDurationForTiming > 30 ? Math.max(12, Math.floor(sourceDurationForTiming / 8)) : 6;
    let initialWordCount = (String(result.text || '').match(/\S+/g) || []).length;
    // A low but non-empty Small result is a recognition failure, not a valid
    // transcript. Retry once with Base, keeping the exact explicit language.
    // This catches cases where Small returns a few words instead of throwing.
    if (model === 'whisper-small' && sourceDurationForTiming > 15 && initialWordCount < plausibleWordFloor && selectedLanguage !== 'auto') {
      const smallResult = result;
      const smallWords = initialWordCount;
      say(`Whisper Small solo reconoció ${smallWords} palabras. Reintentando todo el audio con Whisper Base en ${selectedLanguage === 'es' ? 'español' : 'inglés'}…`);
      try {
        await releaseWhisperModel();
        activeModelId = 'onnx-community/whisper-base_timestamped';
        await loadModel(activeModelId);
        const baseResult = await transcribeAudioInChunks(asr, audio, reportProgress, 'word', sourceLanguage);
        const baseWords = (String(baseResult.text || '').match(/\\S+/g) || []).length;
        console.info('[ClipForge ASR fallback Base]', { selectedLanguage, smallWords, baseWords, durationSeconds: Number(sourceDurationForTiming.toFixed(2)) });
        if (baseWords > smallWords && (baseResult.chunks || []).length) {
          result = baseResult;
          activeModelId = 'onnx-community/whisper-base_timestamped';
          initialWordCount = baseWords;
        } else {
          // Keep the Base attempt diagnostics visible in the final error; do not
          // silently hide a failed fallback behind the original Small result.
          result = smallResult;
          activeModelId = 'onnx-community/whisper-small_timestamped';
          window.__clipforgeAsrFallback = { attempted: true, selectedLanguage, smallWords, baseWords, baseTimedChunks: (baseResult.chunks || []).length };
          await releaseWhisperModel();
          await loadModel('onnx-community/whisper-small_timestamped');
        }
      } catch (fallbackError) {
        console.warn('[ClipForge ASR fallback Base] failed:', fallbackError);
        result = smallResult;
        activeModelId = 'onnx-community/whisper-small_timestamped';
        await releaseWhisperModel().catch(() => {});
        await loadModel(activeModelId);
      }
    }
    if ((result.chunks || []).length <= 1 && sourceDurationForTiming > 8 && String(result.text || '').trim().split(/\s+/).length > 12) {
      say('La primera pasada devolvió un único bloque. Repitiendo alineación temporal por segmentos…');
      const segmented = await transcribeAudioInChunks(asr, audio, reportProgress, true, sourceLanguage);
      if ((segmented.chunks || []).length > (result.chunks || []).length) result = segmented;
    }
    let transcriptWordCount = (String(result.text || '').match(/\S+/g) || []).length;
    let timedWordCount = (result.chunks || []).reduce((n, item) => n + (String(item.text || '').match(/\S+/g) || []).length, 0);
    console.info('[ClipForge ASR diagnóstico]', { file: file.name, audioSeconds: Number(sourceDurationForTiming.toFixed(2)), transcriptWordCount, timedWordCount, windows: result.diagnostics?.windows });
    if (sourceDurationForTiming > 8 && transcriptWordCount > 12 && timedWordCount < Math.max(8, transcriptWordCount * 0.65)) {
      say(`La alineación por palabra solo ha temporizado ${timedWordCount} de ${transcriptWordCount} palabras. Recuperando tiempos por frase para no perder diálogo…`);
      const phraseResult = await transcribeAudioInChunks(asr, audio, reportProgress, true, sourceLanguage);
      const phraseTimedCount = (phraseResult.chunks || []).reduce((n, item) => n + (String(item.text || '').match(/\S+/g) || []).length, 0);
      if (phraseTimedCount > timedWordCount) result = phraseResult;
      transcriptWordCount = (String(result.text || '').match(/\S+/g) || []).length;
      timedWordCount = (result.chunks || []).reduce((n, item) => n + (String(item.text || '').match(/\S+/g) || []).length, 0);
    }
    const normalizedTranscript = String(result.text || '').toLowerCase();
    if (selectedLanguage === 'es' && transcriptWordCount >= 7) {
      const englishMarkers = (normalizedTranscript.match(/\b(i|i'm|im|you|your|the|and|but|not|going|to|be|is|are|was|were|with|for|that|this|good|guy)\b/g) || []).length;
      const spanishMarkers = (normalizedTranscript.match(/\b(el|la|los|las|un|una|unos|unas|que|de|del|y|pero|no|por|para|con|es|son|está|están|yo|tú|usted|me|mi|se|como)\b/g) || []).length;
      if (englishMarkers >= 3 && englishMarkers >= spanishMarkers * 2) {
        throw new Error('Idioma no coincidente: se seleccionó Español, pero Whisper ha devuelto una frase mayoritariamente inglesa. No se crearán subtítulos ni clips. Comprueba que el audio se haya extraído correctamente; si el vídeo está en inglés, selecciona Inglés manualmente.');
      }
    }
    const minimumPlausibleWords = sourceDurationForTiming > 30 ? Math.max(12, Math.floor(sourceDurationForTiming / 8)) : 6;
    if (sourceDurationForTiming > 15 && transcriptWordCount < minimumPlausibleWords) {
      const fallbackInfo = window.__clipforgeAsrFallback;
      const fallbackNote = fallbackInfo ? ` Base también falló: ${fallbackInfo.baseWords} palabras (${fallbackInfo.baseTimedChunks} bloques temporizados).` : '';
      throw new Error(`Transcripción incompleta: Whisper ${activeModelId.includes('base') ? 'Base' : activeModelId.includes('small') ? 'Small' : 'seleccionado'} reconoció solo ${transcriptWordCount} palabras en ${sourceDurationForTiming.toFixed(0)} s (idioma solicitado: ${selectedLanguage === 'es' ? 'Español' : selectedLanguage === 'en' ? 'Inglés' : 'detección automática'}).${fallbackNote} Se bloquean subtítulos y clips para evitar texto inventado. Se ha comprobado el idioma configurado; revisa la pista de audio.`);
    }
    if (sourceDurationForTiming > 8 && transcriptWordCount > 12 && timedWordCount < Math.max(8, transcriptWordCount * 0.5)) {
      throw new Error(`Whisper reconoce ${transcriptWordCount} palabras, pero solo ha podido sincronizar ${timedWordCount}. No se generarán subtítulos incompletos. Cambia a Whisper Small o prueba en Chrome con WebGPU.`);
    }
    // Free the large Whisper session before loading diarization and video rendering.
    await releaseWhisperModel();
    const chunks = result.chunks || [];
    say('Analizando cambios visuales del vídeo localmente para complementar la transcripción…');
    const sourceDuration=audio.length/16000;
    const visualStep=sourceDuration>1800?45:sourceDuration>600?15:5;
    say(`Analizando cambios visuales cada ${visualStep} segundos para adaptar el proceso a un vídeo de ${Math.round(sourceDuration/60)} minutos…`);
    const visualSamples = await captureVisualActivity(file,sourceDuration,visualStep);
    let diarizationTurns = [];
    let diarizationStatus = 'no disponible';
    try {
      diarizationTurns = await diarizeAudioLocally(audio, message => say(message));
      diarizationStatus = diarizationTurns.length ? 'completada' : 'sin hablantes diferenciables';
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
      ? transcriptData.segments.map(s => `[${s.start.toFixed(2)}–${s.end.toFixed(2)}] ${s.speaker_label ? '['+s.speaker_label+'] ' : ''}${s.text}`).join('\n')
      : (result.text || 'El modelo no devolvió texto temporizado.');
    window.dispatchEvent(new CustomEvent('clipforge:transcript-ready',{detail:{segments:transcriptData.segments.length,words:transcriptWordCount,timedWords:timedWordCount,language:transcriptData.language,model:activeModelId}}));
    if (transcriptData.segments.length) {
      let candidatePool = buildEditorialCandidatePool(transcriptData.segments, audio.length / 16000, audio, visualSamples, 16000);
      if (candidatePool.length > 0) {
        try {
          if(candidatePool.length<4)throw new Error('No se han generado cuatro ventanas válidas para comparar.');
          const requested=4;
          if(candidatePool.length<requested)throw new Error('No hay cuatro momentos candidatos con diálogo suficiente para una selección fiable.');
          say(`Se han preparado ${candidatePool.length} ventanas. La IA comparará todo el vídeo y elegirá exactamente los cuatro momentos más importantes. Se usa una cadena compacta de cuatro comparaciones y dos revisiones finales.`);
          candidatePool = await aiEditorialSelect(candidatePool, requested, say);
          recordDailyAIClips(candidatePool.length);
          say('Selección IA completada: exactamente cuatro momentos importantes y distintos.');
        } catch (editorError) {
          console.error('El editor IA local no está disponible o no ha devuelto una selección válida.', editorError);
          // Never spend the user's time rendering heuristic fallback clips.
          // Preserve the transcript for inspection, but stop before clip creation.
          say(`Selección detenida: el selector editorial no pudo validar cuatro momentos (${editorError.message}). No se crearán ni exportarán clips de respaldo. Conserva la transcripción y vuelve a intentarlo cuando el selector esté disponible.`);
          return;
        }
      }
      if (!Array.isArray(candidatePool) || candidatePool.length !== 4 ||
          !candidatePool.every(item => item.selection_method === 'local_generative_editor' || item.selection_method === 'remote_generative_editor')) {
        say('Selección detenida: no hay cuatro clips validados por IA. No se mostrarán candidatos heurísticos ni se iniciará ninguna exportación.');
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
    say(`Error de transcripción: ${error?.message || error}. Comprueba el idioma seleccionado y prueba Whisper Base si Small falla.`);
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
        if(output)output.value=segments.map(c=>`[${c.start.toFixed(2)}–${c.end.toFixed(2)}] ${c.text}`).join('\n');
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


document.querySelector('#browserWhisperModel')?.addEventListener('change',()=>{const file=document.querySelector('#video')?.files?.[0];if(file)updateVideoCapacity(file).catch(console.warn);});