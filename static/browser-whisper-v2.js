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
  const windowSeconds = 28;
  const overlapSeconds = 2;
  const windowSamples = windowSeconds * sampleRate;
  const stepSamples = (windowSeconds - overlapSeconds) * sampleRate;
  const totalSeconds = audio.length / sampleRate;
  const allChunks = [];
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
      language: language || undefined,
      task: 'transcribe',
      return_timestamps: timestampMode
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
      const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
      recentChunks = recentChunks.filter(previous => previous.end >= absoluteStart - 0.45);
      const duplicate = recentChunks.some(previous => {
        const previousText=previous.text.toLowerCase().replace(/\s+/g,' ').trim();
        const previousTokens=new Set(previousText.split(' '));
        const currentTokens=new Set(normalized.split(' '));
        const intersection=[...currentTokens].filter(token=>previousTokens.has(token)).length;
        const union=new Set([...previousTokens,...currentTokens]).size;
        const textSimilarity=intersection/Math.max(1,union);
        const overlap=Math.max(0,Math.min(previous.end,absoluteEnd)-Math.max(previous.start,absoluteStart));
        const overlapRatio=overlap/Math.max(0.001,Math.min(previous.end-previous.start,absoluteEnd-absoluteStart));
        // Phrase-level Small timestamps can drift across adjacent 28s windows.
        return (Math.abs(previous.start-absoluteStart)<0.45 && textSimilarity>=0.8) ||
          (overlapRatio>=0.55 && textSimilarity>=0.82);
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
  const stepSeconds=2.5;
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
    const firstUtteranceWords=(firstUtterance.match(/[\\p{L}\\p{N}]{2,}/gu)||[]).length;
    const terseReply=/^(?:sí|si|no|claro|vale|exacto|exactamente|eso|ya|ajá|aja|right|yeah|yes|nope|exactly|sure|okay|ok|of course)[.!?,…]*$/i.test(firstUtterance);
    const shortQuestion=/^(?:¿?(?:cómo es|qué es|quién es|qué pasó|qué|quién|cómo|why|what|who|how)\??)$/i.test(firstUtterance);
    if((terseReply&&firstUtteranceWords<=3)||(shortQuestion&&firstUtteranceWords<=4)){
      let contextStart=si;
      for(let p=si-1;p>=0&&clean[si].start-clean[p].start<=8.5;p--){
        if(clean[p+1].start-clean[p].end>1.2)break;
        contextStart=p;
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
    // Questions are only strong short-form moments when the selected window
    // also contains an intelligible answer or a clear payoff. A question mark
    // by itself is not an editorial hook.
    const questionHasAnswer=questionCount>0&&(
      questionAnswered||shortAnswerReaction||answerClosedAtEnd||
      /\b(porque|por eso|resulta que|la razón|es que|because|that's why|the reason|turns out|actually)\b/i.test(text)
    );
    const hasSetup=/\b(pero|porque|cuando|si|aunque|resulta que|me dijo|y entonces|imagina|una vez)\b/i.test(text);
    const hasTurn=/\b(pero|aunque|sin embargo|de repente|entonces|al final|resulta que|y va|me dijo|y me dice)\b/i.test(text);
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
      (payoffAtEnd?8:0) + (questionAnswered?16:0) + (shortAnswerReaction?18:0) + (answerClosedAtEnd?12:0) + (questionHasAnswer?8:0) + (pivot&&completeEnd?5:0) + (completeEnd?7:0) + acousticScore + visualScore - Math.min(12,fillerCount*.8) -
      (questionAtStart&&!questionHasAnswer?9:0) - (questionCount>=3&&!questionAnswered?5:0) - (abruptStart?18:0) - (fragmentStart?14:0) - (!completeEnd?8:0) - (promotional?55:0) - (wordsPerSecond<1.1?8:0);
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
    if(answerClosedAtEnd)reasons.push('remate completo al final');
    if(completeEnd)reasons.push('cierre natural');
    if(energy.length && acousticScore >= 8)reasons.push('energía y dinámica de audio');
    if(visualChanges.length && visualScore>=3)reasons.push('movimiento y cambios visuales');
    candidates.push({start,end,duration,score,text,promotional,reasons:[...new Set(reasons)].slice(0,3)});
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
    const laterNearDuplicate=candidates.some(other=>
      other.start>c.start&&other.start-c.start<=18&&overlapRatio(c,other)>=.5&&other.score>=c.score&&other.score<=c.score+6&&(strongHook.test(c.text.slice(0,90))||/^\s*[¿]/.test(c.text))
    );
    const preservesContext=candidates.some(other=>
      other.start>c.start&&other.start-c.start<=18&&overlapRatio(c,other)>=.5&&c.duration>=other.duration+5
    );
    return {clip:c,selectionScore:c.score+(laterNearDuplicate?12:0)+(preservesContext?3:0)};
  }).sort((a,b)=>b.selectionScore-a.selectionScore);
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
      const scoreA=a.selectionScore+(represented.has(bucketOf(a.clip))?0:3);
      const scoreB=b.selectionScore+(represented.has(bucketOf(b.clip))?0:3);
      return scoreB-scoreA;
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
async function loadEditorialJudge(onProgress = () => {}) {
  if (!navigator.gpu) throw new Error('Este navegador no ofrece WebGPU. La selección editorial IA requiere Chrome, Edge u otro navegador compatible con WebGPU.');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  if(!adapter)throw new Error('No se ha encontrado una GPU compatible con WebGPU.');
  if (!editorialEnginePromise) {
    editorialEnginePromise = (async () => {
      onProgress('Preparando el editor IA Qwen3-1.7B…');
      const webllm = await import('https://esm.sh/@mlc-ai/web-llm@0.2.87');
      const modelId = 'Qwen3-1.7B-q4f16_1-MLC';
      const record=webllm.prebuiltAppConfig.model_list.find(item=>item.model_id===modelId);
      if(!record)throw new Error('La versión instalada de WebLLM no incluye el modelo editorial Qwen3-1.7B compatible.');
      const appConfig = {...webllm.prebuiltAppConfig, cacheBackend:'opfs', opfsAccessMode:'auto'};
      return await webllm.CreateMLCEngine(modelId,{appConfig,initProgressCallback:report=>onProgress(report?.text||'Descargando el modelo editorial IA…')});
    })().catch(error=>{editorialEnginePromise=null;throw error;});
  }
  return editorialEnginePromise;
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
  el('capacityModel').textContent='Qwen3 1.7B + '+estimate.asrLabel.replace('Whisper ','');
  const length=duration?(duration/60).toFixed(1).replace('.',',')+' min':'duración no detectada';
  const status=el('capacityStatus'),summary=el('capacitySummary');
  if(!adapter){status.textContent='No compatible con selección IA';status.dataset.level='bad';summary.textContent='Vídeo: '+length+' · '+Math.round(file.size/1048576)+' MB. No se detecta WebGPU; la selección editorial generativa no podrá ejecutarse en este navegador.';}
  else if(estimate.ramFit===false){status.textContent='Capacidad posiblemente insuficiente';status.dataset.level='warn';summary.textContent='Vídeo: '+length+' · '+Math.round(file.size/1048576)+' MB. El navegador declara '+estimate.deviceMemoryGb+' GB de RAM; se recomiendan '+formatCapacityGb(estimate.systemRamGb)+'.';}
  else{status.textContent=estimate.ramFit===null?'GPU compatible · RAM no verificable':'Requisitos estimados';status.dataset.level='ok';summary.textContent='Vídeo: '+length+' · '+Math.round(file.size/1048576)+' MB. '+(estimate.ramFit===true?'La memoria declarada parece suficiente.':'WebGPU disponible; evita otras aplicaciones pesadas durante el análisis.');}
  el('capacityDetails').textContent='Para Whisper '+estimate.asrLabel.replace('Whisper ','')+' + Qwen3-1.7B: RAM '+formatCapacityGb(estimate.systemRamGb)+', memoria gráfica '+formatCapacityGb(estimate.gpuRamGb)+', caché de modelos '+formatCapacityGb(estimate.cacheGb)+' y espacio libre recomendado '+formatCapacityGb(estimate.freeDiskGb)+'. '+(estimate.deviceMemoryGb===null?'Este navegador no permite consultar la RAM del dispositivo.':'RAM declarada por el navegador: '+estimate.deviceMemoryGb+' GB (aproximada).')+' El audio temporal ocupa unos '+estimate.audioWorkingSetMb+' MB. No se puede consultar con precisión la VRAM ni el espacio libre real.';
  el('videoCapacity').dataset.level=estimate.status;
}

function parseEditorialDecision(raw, candidates, limit = 4) {
  const text = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('El editor IA no devolvió una selección estructurada.');
  const data = JSON.parse(match[0]);
  if (!Array.isArray(data.selected)) throw new Error('La respuesta del editor IA no contiene una lista de selección.');
  const used = new Set(), selected = [];
  for (const item of data.selected) {
    const id = Number(item.id);
    if (!Number.isInteger(id) || id < 1 || id > candidates.length || used.has(id)) continue;
    const clip = candidates[id - 1];
    // Reject overlapping editorial selections; timestamps always come from ASR.
    if (selected.some(other => clip.start < other.end + 1 && clip.end > other.start - 1)) continue;
    used.add(id);
    const rubric=item.rubric&&typeof item.rubric==='object'?item.rubric:null;
    const rubricKeys=['hook','story','payoff','clarity','completeness','emotion','pacing','originality'];
    const validRubric=rubric&&rubricKeys.every(key=>Number.isFinite(Number(rubric[key]))&&Number(rubric[key])>=0&&Number(rubric[key])<=10);
    const editorialScore=validRubric?Math.round((
      Number(rubric.hook)*1.5+Number(rubric.story)*1+Number(rubric.payoff)*2+
      Number(rubric.clarity)*1.5+Number(rubric.completeness)*2+Number(rubric.emotion)*.5+
      Number(rubric.pacing)*.5+Number(rubric.originality)*1
    )*1):Math.max(0,Math.min(100,Number(item.score)||0));
    selected.push({
      ...clip,
      title: String(item.title || `Clip ${selected.length + 1}`).slice(0, 70),
      ai_editorial_rank: selected.length + 1,
      ai_editorial_score: Math.max(0,Math.min(100,editorialScore)),
      ai_editorial_rubric: validRubric?Object.fromEntries(rubricKeys.map(key=>[key,Number(rubric[key])])):null,
      ai_editorial_reason: String(item.reason || '').slice(0, 240),
      selection_method: 'local_generative_editor'
    });
    if (selected.length >= Math.max(1, Math.min(4, limit))) break;
  }
  if (selected.length !== Math.min(4, candidates.length, Math.max(1, limit))) {
    throw new Error('El editor IA no ha devuelto cuatro candidatos válidos y distintos.');
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
    next=clean[i].start+5.5;
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
      });
      const ei=ordered.find(index=>!chosenEnds.some(previous=>Math.abs(clean[index].end-clean[previous].end)<7));
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
  const maxCandidates=64;
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
    return sampled.sort((a,b)=>a.start-b.start).slice(0,maxCandidates);
  }
  return pool;
}

async function askEditorialModel(engine, pool, count, onProgress, phase) {
  const shortlist=pool.map((clip,index)=>({
    id:index+1,start:Number(clip.start.toFixed(1)),end:Number(clip.end.toFixed(1)),
    transcript:String(clip.text).replace(/\s+/g,' ').slice(0,620),
    prior_editorial_score:Number(clip.ai_editorial_score||0),
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
    'Actúa como editor jefe: busca momentos que un espectador que no conoce el vídeo entienda y quiera terminar. No selecciones por ser representativo del tema; selecciona por ser un buen fragmento autónomo.',
    'Evalúa CADA candidato con una rúbrica de 0 a 10: hook (primeros 2 segundos), story (progresión o tensión), payoff (remate/revelación/respuesta), clarity (se entiende sin contexto externo), completeness (no corta la premisa ni el remate), emotion (reacción genuina), pacing (sin relleno), originality (no repite otro candidato).',
    'Da prioridad a hook, payoff, clarity y completeness. Una frase graciosa aislada pero sin contexto no supera a una historia completa. Una pregunta sin respuesta no es un payoff. Una respuesta necesita incluir la pregunta si sin ella pierde sentido.',
    'Penaliza con fuerza: arranque a mitad de frase, presentación, explicación larga, transición, publicidad/patrocinio, repetición, charla plana, respuesta incomprensible por ASR, remate fuera del corte, final abrupto y dependencia de contexto que no aparece en el clip.',
    'No confundas volumen, risas de fondo, cambios de plano o palabras llamativas con calidad editorial. Úsalas solo como señales secundarias. No inventes reacciones ni atribuyas quién habla si el texto no lo demuestra.',
    'Busca cuatro tipos de momento distintos cuando existan: historia con payoff, intercambio cómico, sorpresa/revelación y reacción/opinión fuerte. No fuerces categorías si el vídeo no las contiene. Evita elegir cuatro fragmentos de la misma conversación o del mismo chiste.',
    'Cada candidato incluye context_before y context_after: son frases cercanas FUERA del corte propuesto y solo sirven para entender la conversación. No las cuentes como contenido del clip ni cambies sus tiempos. Si el gancho, la explicación o el remate dependen demasiado de ese contexto externo, penaliza el candidato o prefiere otro que contenga el intercambio completo.',
    'Prefiere el fragmento completo más corto que conserve la premisa y el remate. Busca variedad de temas y formatos. El idioma puede ser español o inglés.',
    'No inventes hechos ni cambies los tiempos. Solo puedes elegir IDs de esta lista.',
    'En esta ronda elige exactamente '+count+' fragmentos. '+phase,
    'Devuelve SOLO JSON válido: {"selected":[{"id":1,"score":92,"rubric":{"hook":9,"story":8,"payoff":9,"clarity":9,"completeness":10,"emotion":8,"pacing":8,"originality":9},"title":"título breve","reason":"razón editorial concreta que identifica premisa y payoff"}]}.',
    'CANDIDATOS:',JSON.stringify(shortlist)
  ].join('\n');
  onProgress(phase);
  const response=await engine.chat.completions.create({
    messages:[
      {role:'system',content:'Eres un editor audiovisual exigente. No inventes contenido. Responde exclusivamente con JSON válido.'},
      {role:'user',content:prompt}
    ],
    temperature:0.12,
    max_tokens:700,
    response_format:{type:'json_object'}
  });
  const raw=response?.choices?.[0]?.message?.content||'';
  try{return parseEditorialDecision(raw,pool,count);}
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
    return parseEditorialDecision(retry?.choices?.[0]?.message?.content||'',pool,count);
  }
}

async function aiEditorialSelect(candidates, limit = 4, onProgress = () => {}) {
  const pool=(Array.isArray(candidates)?candidates:[]).filter(c=>
    c&&Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.end>c.start&&String(c.text||'').trim()
  );
  if(pool.length<limit)throw new Error('No hay suficientes fragmentos de diálogo para la selección editorial IA.');
  const engine=await loadEditorialJudge(onProgress);
  // The model reviews every neutral window in small batches, then judges the
  // finalists together. No heuristic score decides which candidates survive.
  if(pool.length<=8)return askEditorialModel(engine,pool,limit,onProgress,'El editor IA está comparando todos los momentos disponibles…');
  const finalists=[];
  const batchCount=Math.ceil(pool.length/8);
  // Interleave the chronological pool: every judge batch sees candidates from
  // the beginning, middle and end, instead of eight neighboring windows. This
  // prevents local chronology from biasing the model and gives each batch a
  // genuinely global editorial comparison.
  const batches=Array.from({length:batchCount},(_,batchIndex)=>
    pool.filter((_,candidateIndex)=>candidateIndex%batchCount===batchIndex)
  );
  for(let index=0;index<batches.length;index++){
    const batch=batches[index];
    const keep=Math.min(3,batch.length);
    const selected=await askEditorialModel(engine,batch,keep,onProgress,'Evaluación editorial IA: bloque global '+(index+1)+'/'+batches.length+'…');
    finalists.push(...selected);
  }
  if(finalists.length<limit)throw new Error('La evaluación por bloques no produjo suficientes finalistas.');
  // Independent multilingual embedding judge detects near-duplicate topics.
  // It narrows the finalists to six varied options before the final editorial vote.
  // Narrative quality remains the responsibility of the generative editor.
  let finalPool=finalists;
  if(finalists.length>limit){
    try{
      onProgress('Segundo modelo IA: comparando similitud semántica y diversidad temática…');
      finalPool=await semanticRerankCandidates(finalists,Math.min(6,finalists.length),onProgress);
    }catch(semanticError){
      console.warn('Modelo semántico opcional no disponible; continúa el juez editorial principal.',semanticError);
      onProgress('El modelo semántico opcional no está disponible; continúa el juez editorial principal…');
    }
  }
  return askEditorialModel(engine,finalPool,limit,onProgress,'Comparación final IA: eligiendo los cuatro mejores clips entre todos los finalistas…');
}

async function semanticRerankCandidates(candidates, limit = 4, onProgress = () => {}) {
  if (!Array.isArray(candidates) || candidates.length < 2 || !candidates.some(clip => String(clip.text || '').trim())) {
    return rerankWithoutEmbeddings(candidates, limit);
  }
  const {pipeline, env} = await import('https://esm.sh/@huggingface/transformers@3.7.2');
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

let editableCandidates=[];
function showClipCandidates(words,duration,restoredCandidates=null,audioSamples=null,visualSamples=[]) {
 const panel=document.querySelector('#browserCandidates'),list=document.querySelector('#browserCandidateList');
 if(!panel||!list)return;
 editableCandidates=(restoredCandidates || rankClipCandidates(words,duration,audioSamples,16000,visualSamples)).map((c,i)=>({...c,title:c.title||`Clip ${i+1}`,selected:c.selected!==false}));
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
  const heading=document.createElement('strong');heading.textContent=c.selection_method==='local_generative_editor'?(c.title+' · valoración IA '+c.ai_editorial_score+'/100'):(c.title+' · candidato para revisión');
  const rationale=document.createElement('small');rationale.className='candidate-rationale';rationale.textContent=c.ai_editorial_reason || (c.reasons||[]).join(' · ') || 'Fragmento propuesto para evaluación';
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
 const info=document.createElement('p');info.textContent=editableCandidates.every(c=>c.selection_method==='local_generative_editor')?'Selección editorial realizada por un modelo generativo local. La IA compara el contenido y explica por qué ha elegido cada momento; revisa el resultado antes de exportar.':'Ventanas de transcripción sin selección editorial confirmada.';list.append(info);sync();
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
      say(`Transcribiendo vídeo: ${percent}% · fragmento ${current}/${total}`);
    };
    const selectedLanguage = document.querySelector('#browserWhisperLanguage')?.value || 'auto';
    const sourceLanguage = selectedLanguage === 'auto' ? undefined : selectedLanguage;
    let activeModelId = modelId;
    let result;
    try {
      if (!asr || asrModelId !== modelId) {
        asr = null;
        asrModelId = null;
        await loadModel(modelId);
      }
      say('Transcribiendo en fragmentos para reducir memoria y evitar límites de 30 segundos…');
      result = await transcribeAudioInChunks(asr, audio, reportProgress, model === 'whisper-small' ? true : 'word', sourceLanguage);
      if (model === 'whisper-small' && !(result.chunks || []).length) {
        throw new Error('Whisper Small no devolvió marcas de tiempo utilizables.');
      }
    } catch (transcriptionError) {
      if (model !== 'whisper-small') throw transcriptionError;
      activeModelId = 'onnx-community/whisper-base_timestamped';
      say('Small no pudo cargarse o generar tiempos utilizables. Cambiando automáticamente a Base para conservar los cortes sincronizados…');
      await releaseWhisperModel();
      await loadModel(activeModelId);
      result = await transcribeAudioInChunks(asr, audio, reportProgress, 'word', sourceLanguage);
      if (!(result.chunks || []).length) {
        throw new Error(`Whisper Base tampoco devolvió marcas de tiempo. Error de Small: ${transcriptionError.message}`);
      }
    }
    // Free the large ONNX/Whisper session before video rendering. Keeping it
    // alive caused Chromium to run out of memory while exporting long clips.
    await releaseWhisperModel();
    const chunks = result.chunks || [];
    say('Analizando cambios visuales del vídeo localmente para complementar la transcripción…');
    const visualSamples = await captureVisualActivity(file,audio.length/16000,4);
    transcriptData = {
      source: file.name, model: activeModelId, language: result.language || sourceLanguage,
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
      let candidatePool = buildEditorialCandidatePool(transcriptData.segments, audio.length / 16000, audio, visualSamples, 16000);
      if (candidatePool.length > 0) {
        try {
          if(candidatePool.length<4)throw new Error('No se han generado cuatro ventanas válidas para comparar.');
          say(`Se han preparado ${candidatePool.length} ventanas neutrales. El editor IA comparará todas, sin preselección por puntuación heurística…`);
          candidatePool = await aiEditorialSelect(candidatePool, 4, say);
        } catch (editorError) {
          console.error('El editor IA local no está disponible o no ha devuelto una selección válida.', editorError);
          // Keep the workflow usable when WebGPU or the local generative model
          // is unavailable. This is an explicitly labelled heuristic fallback,
          // never presented as an AI editorial decision.
          showClipCandidates(transcriptData.segments, audio.length / 16000, null, audio, visualSamples);
          say(`El editor IA local no está disponible (${editorError.message}). Se han generado candidatos de respaldo mediante reglas locales para que puedas revisarlos y exportarlos; no se presentan como selección editorial IA. Para la selección generativa, usa Chrome/Edge actualizado con WebGPU.`);
          return;
        }
      }
      showClipCandidates(transcriptData.segments, audio.length / 16000, candidatePool, audio, visualSamples);
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
      // A silent transcript is still a valid input for the non-speech ranker.
      // It uses audio activity to suggest moments for music, gameplay and B-roll.
      showClipCandidates([], audio.length / 16000, null, audio, visualSamples);
      say(editableCandidates.length
        ? `No se detectó diálogo temporizado. Se han propuesto ${editableCandidates.length} momentos mediante actividad sonora; revisa los cortes antes de exportar.`
        : 'No se detectó diálogo ni suficiente actividad sonora para proponer cortes.');
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


document.querySelector('#browserWhisperModel')?.addEventListener('change',()=>{const file=document.querySelector('#video')?.files?.[0];if(file)updateVideoCapacity(file).catch(console.warn);});
