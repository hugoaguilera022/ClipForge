import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('static/browser-whisper.js','utf8');
function extract(name){
  const asyncStart=source.indexOf(`async function ${name}(`);
  const start=asyncStart>=0?asyncStart:source.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`${name} must exist`);
  let depth=0,end=-1;
  const bodyStart=source.indexOf(') {',start)+2;
  assert.ok(bodyStart>1,`${name} body must exist`);
  for(let i=bodyStart;i<source.length;i++){
    if(source[i]==='{')depth++;
    else if(source[i]==='}'&&--depth===0){end=i+1;break;}
  }
  assert.notEqual(end,-1,`${name} must parse`);
  return source.slice(start,end);
}
assert.ok(source.includes("https://esm.sh/@mlc-ai/web-llm@0.2.87"),'editorial runtime must stay pinned');
assert.ok(source.includes("Qwen3-1.7B-q4f16_1-MLC"),'production selector must use the chosen Qwen3 model');
assert.ok(source.includes("webllm.prebuiltAppConfig.model_list.find"),'model availability must be checked before initialization');
const candidates=Array.from({length:64},(_,i)=>({
  start:i*70,end:i*70+25,duration:25,
  text:`Story ${i}: an unexpected reveal and a complete punchline ${i}`,
  context_before:`The setup before story ${i}`,
  context_after:`The reaction after story ${i}`
}));
const seen=new Set(),calls=[];
const engine={chat:{completions:{create:async({messages})=>{
  const prompt=messages[1].content;
  const marker=prompt.includes('FINALISTAS PARA AUDITAR:')?'FINALISTAS PARA AUDITAR:':'CANDIDATOS:';
  const json=prompt.split(marker)[1]?.trim();
  assert.ok(json,'candidate payload must be included in every model request');
  const batch=JSON.parse(json);
  for(const item of batch)seen.add(item.start);
  const count=Number(prompt.match(/(?:elige exactamente |exactamente )(\d+)/)?.[1]);
  assert.ok(count>0,'each model round must specify its requested selection count');
  calls.push({size:batch.length,count,ids:batch.map(x=>x.id)});
  const chosen=[...batch].reverse().slice(0,count).map((item,index)=>({id:item.id,score:90-index,title:`Clip ${item.id}`,reason:'Complete narrative with a payoff.',...(prompt.includes('FINALISTAS PARA AUDITAR:')?{audit_verdict:'pass',audit_flags:[]}: {})}));
  return {choices:[{message:{content:JSON.stringify({selected:chosen})}}]};
}}}};
const context={console,Set,Math,Number,String,Array,JSON};
context.loadEditorialJudge=async()=>engine;
let semanticInputCount=0,semanticLimit=0;
context.semanticRerankCandidates=async(items,limit)=>{semanticInputCount=items.length;semanticLimit=limit;return items.slice(0,limit);};
vm.createContext(context);
for(const name of ['parseEditorialDecision','askEditorialModel','aiEditorialSelect']){
  vm.runInContext(extract(name)+`;this.${name}=${name};`,context);
}
const selected=await context.aiEditorialSelect(candidates,4,()=>{});
assert.equal(seen.size,64,'the generative judge must see every neutral candidate across batches');
assert.equal(calls.length,10,'64 candidates must be evaluated in eight batches, a first vote and an independent critic audit');
assert.equal(semanticInputCount,24,'three finalists per batch should reach semantic diversity review');
assert.equal(semanticLimit,6,'semantic review should narrow to six finalists');
assert.equal(selected.length,4,'final model round must return four clips');
assert.ok(selected.every(x=>x.selection_method==='local_generative_editor'),'all final clips must be marked as generative selections');
assert.ok(selected.every(x=>x.ai_editorial_audit==='independent_critic_pass'),'all final clips must pass the critic audit');
for(let i=1;i<selected.length;i++)assert.ok(selected[i].start>=selected[i-1].end+1,'final clips must not overlap');
console.log('Editorial selector integration passed: 64/64 candidates reviewed, 24 finalists, semantic diversity stage, first vote, independent critic audit and four grounded final clips.');
