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
assert.ok(!/todos los gitanos/i.test(source.slice(start, end)), 'general Spanish hooks must not be biased toward the supplied test video');
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

// Semantic diversity reranker: choose four editorially strong moments without
// wasting a slot on a near-duplicate when other topics are available.
const semanticStart=source.indexOf('function rerankWithSemanticEmbeddings(');
assert.notEqual(semanticStart,-1,'semantic diversity reranker must exist');
let semanticDepth=0,semanticEnd=-1;
for(let i=source.indexOf('{',semanticStart);i<source.length;i++){
  if(source[i]==='{')semanticDepth++;
  else if(source[i]==='}'&&--semanticDepth===0){semanticEnd=i+1;break;}
}
assert.notEqual(semanticEnd,-1,'semantic reranker must parse as a complete function');
vm.runInContext(source.slice(semanticStart,semanticEnd)+'; this.semanticRerank=rerankWithSemanticEmbeddings;',context);
const semanticCandidates=[
  {start:0,end:20,score:92,text:'A story about a lost train and a funny mistake.'},
  {start:25,end:45,score:90,text:'The same lost train story and the same funny mistake.'},
  {start:50,end:70,score:84,text:'A surprise birthday party and everyone cheering.'},
  {start:75,end:95,score:82,text:'The coach explains the final goal and the team celebration.'},
  {start:100,end:120,score:80,text:'A chef reveals the secret ingredient in a recipe.'}
];
const semanticVectors=[[1,0,0],[.99,.01,0],[0,1,0],[0,0,1],[-1,0,0]];
const semanticSelected=context.semanticRerank(semanticCandidates,semanticVectors,4);
assert.equal(semanticSelected.length,4,'semantic reranker must return four clips');
assert.ok(!semanticSelected.some(clip=>clip.text.startsWith('The same lost train')),'near-duplicate clip must lose its slot to a distinct topic');
assert.ok(semanticSelected.every(clip=>Number.isFinite(clip.semanticScore)&&clip.semanticScore>=0&&clip.semanticScore<=100),'semantic diversity scores must stay within 0–100');
console.log('Semantic reranker passed: four clips selected with duplicate-topic suppression.');

// Generative editor output validation: only existing candidate IDs and
// source timestamps are accepted; duplicate and overlapping choices are rejected.
const decisionStart=source.indexOf('function parseEditorialDecision(');
assert.notEqual(decisionStart,-1,'AI editorial decision parser must exist');
let decisionDepth=0,decisionEnd=-1;
for(let i=source.indexOf('{',decisionStart);i<source.length;i++){
  if(source[i]==='{')decisionDepth++;
  else if(source[i]==='}'&&--decisionDepth===0){decisionEnd=i+1;break;}
}
assert.notEqual(decisionEnd,-1,'AI editorial decision parser must be complete');
vm.runInContext(source.slice(decisionStart,decisionEnd)+'; this.parseDecision=parseEditorialDecision;',context);
const judgePool=[
  {start:0,end:22,text:'An anecdote with a complete payoff.'},
  {start:30,end:54,text:'A funny exchange with a reaction.'},
  {start:60,end:84,text:'A surprising confession.'},
  {start:90,end:114,text:'A strong opinion with context.'},
  {start:120,end:144,text:'A final distinct story.'}
];
const judgeOutput=JSON.stringify({selected:[1,2,3,4].map((id)=>({id,score:90,title:'Momento',reason:'Historia clara y remate.'}))});
const judged=context.parseDecision(judgeOutput,judgePool,4);
assert.equal(judged.length,4);
assert.equal(judged[0].selection_method,'local_generative_editor');
assert.equal(judged[0].start,0,'AI cannot invent or alter source timestamps');
assert.throws(()=>context.parseDecision(JSON.stringify({selected:[1,1,3,4].map(id=>({id}))}),judgePool,4),/cuatro candidatos válidos/);
assert.throws(()=>context.parseDecision(JSON.stringify({selected:[1,2,3,99].map(id=>({id}))}),judgePool,4),/cuatro candidatos válidos/);
console.log('Generative editor validation passed: only grounded IDs and non-overlapping source times are accepted.');


// When the optional embedding download fails, the local fallback must still
// select four high-quality, non-overlapping and lexically distinct moments.
const fallbackStart=source.indexOf('function rerankWithoutEmbeddings(');
assert.notEqual(fallbackStart,-1,'local no-network fallback must exist');
let fallbackDepth=0,fallbackEnd=-1;
for(let i=source.indexOf('{',fallbackStart);i<source.length;i++){
  if(source[i]==='{')fallbackDepth++;
  else if(source[i]==='}'&&--fallbackDepth===0){fallbackEnd=i+1;break;}
}
assert.notEqual(fallbackEnd,-1,'local fallback must parse as a complete function');
vm.runInContext(source.slice(fallbackStart,fallbackEnd)+'; this.localFallback=rerankWithoutEmbeddings;',context);
const fallbackCandidates=[
 {start:0,end:20,score:96,text:'The lost train story and the funny mistake at the station.'},
 {start:22,end:42,score:94,text:'The same lost train story and funny mistake at the station.'},
 {start:50,end:70,score:88,text:'A surprise birthday party with everyone cheering loudly.'},
 {start:80,end:100,score:85,text:'The coach explains the final goal and team celebration.'},
 {start:110,end:130,score:83,text:'A chef reveals the secret ingredient in a chocolate cake.'},
 {start:140,end:160,score:80,text:'A storm suddenly changes the sailing trip at sea.'}
];
const fallbackSelected=context.localFallback(fallbackCandidates,4);
assert.equal(fallbackSelected.length,4,'local fallback must return four clips');
assert.ok(!fallbackSelected.some(c=>c.text.startsWith('The same lost train')),'local fallback must penalize repeated topics');
for(let i=1;i<fallbackSelected.length;i++)assert.ok(fallbackSelected[i].start>=fallbackSelected[i-1].end+1,'local fallback clips must not overlap');
assert.ok(fallbackSelected.every(c=>c.selected===true),'local fallback must mark selected clips for export');
console.log('Local fallback passed: four distinct clips without downloading semantic embeddings.');



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
 
// Unicode-aware Spanish hooks must recognize accented words at token boundaries.
const accentedSpanish = [
  'Increíble, jamás pensé que esto pasaría.',
  'Todo empezó como una broma entre amigos.',
  'Nadie esperaba que la situación cambiara tan rápido.',
  'De repente, todos comenzaron a mirar.',
  'Fue uno de esos momentos que no se olvidan.',
  'Y todavía nos reímos cuando lo contamos.'
].map((text,i)=>({start:i*3.2,end:i*3.2+2.8,text}));
const accentedClips=context.rank(accentedSpanish,25);
assert.ok(accentedClips.length>0,'accented Spanish dialogue must produce a candidate');
assert.ok(accentedClips[0].reasons.includes('inicio que despierta curiosidad'),'accented Spanish hook words such as increíble/jamás must be detected');
console.log('Unicode Spanish hooks passed: accented terms are recognized correctly.');

// Stateful global regexes must not make short-answer/reaction scoring depend
// on how many earlier candidate windows happened to be evaluated.
const reactionDialogue=[
  {start:0,end:2.5,text:'What happened to the keys?'},
  {start:3,end:5.5,text:'I left them in the car.'},
  {start:6,end:8.5,text:'No way!'},
  {start:9,end:11.5,text:'Then we had to walk home.'},
  {start:12,end:14.5,text:'Everyone laughed at me.'},
  {start:15,end:17.5,text:'It was honestly ridiculous.'},
  {start:18,end:20.5,text:'And that is how the night started.'},
  {start:21,end:23.5,text:'We still tell that story.'}
];
const reactionFirst=context.rank(reactionDialogue,25);
const reactionSecond=context.rank(reactionDialogue,25);
assert.deepEqual(reactionFirst.map(x=>({start:x.start,end:x.end,score:x.score,reasons:x.reasons})),reactionSecond.map(x=>({start:x.start,end:x.end,score:x.score,reasons:x.reasons})),'candidate scoring must be deterministic across repeated calls');
console.log('Reaction scoring passed: global regex state cannot change candidate rankings.');

// A short answer must retain its preceding setup even when ASR omitted a
// question mark, and an ellipsis must not be mistaken for a completed beat.
const terseReplyBeat=[
  ['Tell me what happened before the final round.',0,2.8],
  ['No.',3,3.8],
  ['We had already lost the first match.',4,7],
  ['Then we changed the whole strategy.',7.2,10.5],
  ['And suddenly everyone started cheering.',10.6,14],
  ['The last point decided everything.',14.1,18],
  ['We could not believe it.',18.1,21],
  ['That was the best ending.',21.1,25]
].map(([text,start,end])=>({text,start,end}));
const replyBeatClips=context.rank(terseReplyBeat,26);
assert.ok(replyBeatClips.some(c=>c.start===0&&c.text.startsWith('Tell me what happened before the final round. No.')),'short answers must include the preceding setup even without a question mark');
const unfinishedBeat=[
  ['What happened after the show?',0,3],
  ['We went into the old house and heard a noise...',3.2,7.8],
  ['Then someone turned off all the lights.',7.9,11.8],
  ['I opened the door and saw...',11.9,15.8],
  ['my brother standing there with a cake',15.9,19.8],
  ['and everyone started laughing',19.9,23.8],
  ['because it was his surprise birthday.',23.9,29.8]
].map(([text,start,end])=>({text,start,end}));
const completeBeatClips=context.rank(unfinishedBeat,30);
assert.ok(completeBeatClips.some(c=>c.text.includes('my brother standing there with a cake')&&c.text.includes('surprise birthday')),'ellipsis must not cut off a setup before its payoff');
console.log('Context integrity passed: terse replies retain setup and ellipses do not cut story payoffs.');




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


// Language propagation regression: explicit Spanish/English selections must
// reach Whisper, while automatic mode must leave language unset for detection.
const languageCalls=[];
const languageProbe=async(_audio,options)=>{languageCalls.push(options);return {text:'hello mundo',chunks:[]};};
await chunkSandbox.transcribeAudioInChunks(languageProbe,new Float32Array(16000),()=>{},'word','es');
await chunkSandbox.transcribeAudioInChunks(languageProbe,new Float32Array(16000),()=>{},'word','en');
await chunkSandbox.transcribeAudioInChunks(languageProbe,new Float32Array(16000),()=>{},'word',undefined);
assert.equal(languageCalls[0].language,'es','Spanish selection must be passed to Whisper');
assert.equal(languageCalls[1].language,'en','English selection must be passed to Whisper');
assert.equal(languageCalls[2].language,undefined,'automatic mode must not force a source language');
assert.equal(languageCalls[2].task,'transcribe','automatic mode must still use transcription, not translation');
console.log('Bilingual ASR passed: Spanish, English and automatic language detection options.');
