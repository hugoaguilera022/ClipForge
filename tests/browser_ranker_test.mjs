import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('static/browser-whisper.js', 'utf8');
const start = source.indexOf('function rankClipCandidates(');
assert.notEqual(start, -1, 'editorial ranker must exist');
let depth = 0, end = -1;
for (let i = source.indexOf('{', start); i < source.length; i++) {
  if (source[i] === '{') depth++;
  else if (source[i] === '}' && --depth === 0) { end = i + 1; break; }
}
assert.notEqual(end, -1, 'editorial ranker must parse as a complete function');
const context = {};
vm.createContext(context);
vm.runInContext(source.slice(start, end) + '; this.rank = rankClipCandidates;', context);

const dialogue = [
  [
    '¿Qué pasó cuando llegaste al colegio?',
    'La profesora nos pidió preparar una exposición sobre animales.',
    'Yo elegí explicar cómo viven las abejas en Mallorca.',
    'Y entonces todos empezaron a hacer preguntas.',
    'Lo mejor fue cuando llevé un panal vacío para enseñarlo.',
    'La clase entera se quedó sorprendida.'
  ],
  [
    '¿Cuál fue el momento más divertido del viaje?',
    'Nos perdimos buscando el camino de la montaña.',
    'Mi amigo dijo que conocía un atajo y acabamos junto a una granja.',
    'El dueño salió a saludarnos y nos invitó a probar queso.',
    'Al final fue la mejor parte del día.',
    'Todavía nos reímos cuando lo recordamos.'
  ],
  [
    '¿Qué haces cuando tienes un problema difícil?',
    'Primero intento entender qué está pasando de verdad.',
    'Después pregunto a alguien que tenga más experiencia.',
    'Una vez arreglamos el tractor siguiendo ese consejo.',
    'Parecía imposible, pero encontramos la pieza que faltaba.',
    'Y desde entonces siempre reviso eso primero.'
  ],
  [
    '¿Qué consejo darías a alguien que empieza?',
    'Que tenga paciencia y que no quiera correr demasiado.',
    'Al principio cuesta aprender todas las tareas.',
    'Pero cada día descubres una cosa nueva.',
    'Lo importante es disfrutar y preguntar cuando no sabes.',
    'Así mejoras mucho más rápido.'
  ]
];
const words = [];
for (let quarter = 0; quarter < dialogue.length; quarter++) {
  for (let i = 0; i < dialogue[quarter].length; i++) {
    const start = quarter * 56 + i * 4 + (quarter === 3 ? 10 : 0);
    words.push({ start, end: start + 2.7, text: dialogue[quarter][i] });
  }
}
const clips = context.rank(words, 210);
console.log('RANKER_DEBUG', JSON.stringify(clips.map(c => ({start:c.start,end:c.end,score:c.score}))));
assert.equal(clips.length, 4, 'must return four distinct clips when four coherent beats exist');
for (const clip of clips) {
  assert.ok(clip.duration >= 15 && clip.duration <= 45, 'clip duration must stay within editorial bounds');
  assert.ok(clip.end > clip.start, 'clip boundaries must be valid');
}
for (let i = 1; i < clips.length; i++) {
  assert.ok(clips[i].start >= clips[i - 1].end + 1, 'selected clips must not overlap');
}
assert.ok(new Set(clips.map(clip => clip.text.slice(0, 25))).size === 4, 'selected moments must not be duplicates');
const sourceQuarter = clip => Math.min(3, Math.floor(clip.start / 52.5));
assert.equal(new Set(clips.map(sourceQuarter)).size, 4, 'four clips must cover all four source quarters');
console.log('Browser ranker passed: four coherent, distinct, non-overlapping clips.');

// English dialogue regression: hooks, payoff and Unicode-safe tokenization.
const englishDialogue = [
  ['Why did everyone suddenly start laughing?', 'I thought the train had already left.', 'But actually, we were on the wrong platform.', 'Everyone was surprised and we all started laughing.', 'In the end, it was the best part of the trip.', 'I will never forget it.'],
  ['How did you hear the news?', 'My friend called just before the match.', 'He told me nobody expected it.', 'Suddenly, the whole stadium started shouting.', 'It was unbelievable, absolutely crazy.', 'And that is why I remember it.'],
  ['Who found the solution?', 'We tried several different ideas.', 'But nothing really worked.', 'Then she noticed one tiny mistake.', 'Exactly, that was the problem.', 'Everything became much simpler.'],
  ['What happened next?', 'We waited for almost an hour.', 'Then the door finally opened.', 'Everyone started applauding.', 'It was insane, I had never seen anything like it.', 'And finally we won.']
];
const englishWords=[];
for(let q=0;q<englishDialogue.length;q++)for(let i=0;i<englishDialogue[q].length;i++){
  const start=q*56+i*4; englishWords.push({start,end:start+2.7,text:englishDialogue[q][i]});
}
const englishClips=context.rank(englishWords,210);
assert.equal(englishClips.length,4,'English dialogue must produce four clips');
assert.equal(new Set(englishClips.map(x=>Math.floor(x.start/52.5))).size,4,'English clips must cover the full source');

console.log('English ranker passed: hooks, payoff and four distributed clips.');

// Sponsor calls-to-action must never outrank editorial moments.
const sponsoredWords=[];
const sponsorLines=['We are giving away a free iPhone 18.','Subscribe to the channel and follow us on Instagram.','Enter to win and use our discount code.','This giveaway is sponsored.','Follow us for more and click the link in bio.','You can win a new iPhone.'];
for(let q=0;q<4;q++){
  const lines=q===1?sponsorLines:dialogue[q];
  for(let i=0;i<lines.length;i++){
    const start=q*56+i*4;
    sponsoredWords.push({start,end:start+2.7,text:lines[i]});
  }
}
const sponsorSafe=context.rank(sponsoredWords,210);
assert.ok(sponsorSafe.length>=3,'ranker should still find non-sponsored moments elsewhere');
assert.ok(sponsorSafe.every(clip=>!/(giveaway|subscribe|follow us|iphone|discount code|sponsored)/i.test(clip.text)),'sponsor calls-to-action must be excluded from selected clips');
console.log('Sponsor filter passed: promotional segments are excluded from editorial selections.');



// Non-speech source regression: music/gameplay/scenic footage still yields
// four usable, distributed moments from the measured audio activity.
const audioSamples = new Float32Array(16000 * 180);
for (let i = 0; i < audioSamples.length; i++) {
  const time = i / 16000;
  const amplitude = Math.floor(time / 24) % 2 === 0 ? 0.42 : 0.08;
  audioSamples[i] = (Math.sin(2 * Math.PI * 180 * time) + 0.25 * Math.sin(2 * Math.PI * 510 * time)) * amplitude;
}
const audioOnly = context.rank([], 180, audioSamples, 16000);
assert.equal(audioOnly.length, 4, 'non-speech video must still produce four moments');
for (const clip of audioOnly) {
  assert.ok(clip.duration >= 15 && clip.duration <= 45, 'audio-only clip duration must be valid');
  assert.ok(clip.reasons.includes('momento sin diálogo'), 'audio-only fallback must identify its mode');
}
for (let i = 1; i < audioOnly.length; i++) {
  assert.ok(audioOnly[i].start >= audioOnly[i - 1].end + 1, 'audio-only clips must not overlap');
}
console.log('Audio-only ranker passed: four distributed, non-overlapping clips without speech.');



// Phrase-level timestamps from adjacent ASR windows may drift while still
// describing the same phrase. The overlap deduper must collapse them.
const chunkStart=source.indexOf('async function transcribeAudioInChunks(');
const chunkEnd=source.indexOf('\nfunction makeVtt(',chunkStart);
if(chunkStart<0||chunkEnd<0)throw new Error('chunked transcription helper not found');
const chunkSandbox={};vm.createContext(chunkSandbox);
vm.runInContext(`${source.slice(chunkStart,chunkEnd)}; this.transcribeAudioInChunks=transcribeAudioInChunks;`,chunkSandbox);
let call=0;
const fakeAsr=async()=>{
  call++;
  return call===1
    ? {text:'Mira, mira, mira.',chunks:[{timestamp:[26.5,27.5],text:'Mira, mira, mira.'}]}
    : {text:'Mira, mira, mira.',chunks:[{timestamp:[0.9,1.9],text:'Mira, mira, mira.'}]};
};
const chunkResult=await chunkSandbox.transcribeAudioInChunks(fakeAsr,new Float32Array(16000*54),()=>{},'word','es');
if(chunkResult.chunks.length!==1)throw new Error(`overlap phrase was duplicated: ${JSON.stringify(chunkResult.chunks)}`);
console.log('Phrase overlap deduplication passed across adjacent Whisper chunks.');
