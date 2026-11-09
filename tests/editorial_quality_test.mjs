import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('static/browser-whisper-v2.js','utf8');
function extract(name){const sync=source.indexOf(`function ${name}(`),async=source.indexOf(`async function ${name}(`),a=async>=0&&(sync<0||async<sync)?async:sync;assert.ok(a>=0,name);const body=source.indexOf(') {',a)+2;let d=0,b=-1;for(let i=body;i<source.length;i++){if(source[i]==='{')d++;else if(source[i]==='}'&&--d===0){b=i+1;break;}}assert.ok(b>a,name+' parses');return source.slice(a,b);}
const ctx={console,Set,Math,Number,String,Array,JSON};vm.createContext(ctx);
for(const name of ['buildEditorialCandidatePool','parseEditorialDecision','askEditorialModel','aiEditorialSelect'])vm.runInContext(extract(name)+`;this.${name}=${name};`,ctx);
const transcript=[];for(let i=0;i<500;i++){const start=i*.92;const texts=['¿Qué pasó cuando llegaste?','No me lo podía creer.','Entonces todos empezaron a reírse.','Pero todavía faltaba lo mejor.','Y esa fue la parte que nadie esperaba.'];transcript.push({start,end:start+.7,text:texts[i%texts.length]});}
const pool=ctx.buildEditorialCandidatePool(transcript,460);
assert.equal(pool.length,64,'candidate pool is capped to 64');
assert.ok(pool[0].start<3&&pool.at(-1).end>450,'candidate coverage includes opening and ending');
assert.ok(new Set(pool.map(x=>Math.round(x.duration/5))).size>=3,'candidate durations include compact and extended beats');
assert.ok(pool.every(x=>x.context_before!==undefined&&x.context_after!==undefined),'candidate carries surrounding context');
const calls=[];const engine={chat:{completions:{create:async({messages})=>{const prompt=messages[1].content;const items=JSON.parse(prompt.split('CANDIDATOS:')[1]);const starts=items.map(x=>x.start);calls.push({min:Math.min(...starts),max:Math.max(...starts),count:items.length});const n=Number(prompt.match(/elige exactamente (\d+)/)?.[1]);const picked=[];for(const x of items){if(picked.some(y=>x.start<y.end+1&&x.end>y.start-1))continue;picked.push(x);if(picked.length===n)break;}return {choices:[{message:{content:JSON.stringify({selected:picked.map(x=>({id:x.id,score:1,rubric:{hook:9,story:8,payoff:9,clarity:9,completeness:10,emotion:8,pacing:8,originality:9},title:'Momento',reason:'Premisa completa y remate claro.'}))})}}]};}}}};
ctx.loadEditorialJudge=async()=>engine;ctx.semanticRerankCandidates=async(items,n)=>{const out=[];for(const x of items){if(out.some(y=>x.start<y.end+1&&x.end>y.start-1))continue;out.push(x);if(out.length===n)break;}return out;};
const judgePool=Array.from({length:64},(_,i)=>({start:i*7,end:i*7+25,duration:25,text:'Independent narrative beat '+i,context_before:'Setup '+i,context_after:'Payoff '+i}));
const chosen=await ctx.aiEditorialSelect(judgePool,4,()=>{});
assert.equal(calls.length,9,'8 globally distributed judge batches plus final vote');
assert.ok(calls.slice(0,8).every(x=>x.count===8&&x.max-x.min>350),'each batch compares moments from across the whole video');
assert.equal(chosen.length,4);assert.ok(chosen.every(x=>x.ai_editorial_rubric&&x.ai_editorial_score===90),'weighted editorial rubric is retained and normalized');
for(let i=1;i<chosen.length;i++)assert.ok(chosen[i].start>=chosen[i-1].end+1,'final selections are non-overlapping');
console.log('Editorial quality passed: 64 temporal candidates, duration diversity, context, globally interleaved review batches, weighted rubric and four grounded non-overlapping selections.');
