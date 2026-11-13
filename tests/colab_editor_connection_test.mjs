import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// The current editor no longer contains the legacy Colab tunnel bridge.
// Validate the active free-provider -> local WebGPU Qwen3 routing instead.
const source=fs.readFileSync('static/browser-whisper-inline-v3.js','utf8');
function extract(name){
  const start=source.indexOf(`async function ${name}(`)>=0
    ?source.indexOf(`async function ${name}(`)
    :source.indexOf(`function ${name}(`);
  assert.ok(start>=0,name+' must exist in the active browser module');
  const brace=source.indexOf('{',start);
  let depth=0,end=-1;
  for(let i=brace;i<source.length;i++){
    if(source[i]==='{')depth++;
    else if(source[i]==='}'&&--depth===0){end=i+1;break;}
  }
  assert.ok(end>start,name+' must be a complete function');
  return source.slice(start,end);
}
const context={Math,Number,String,Boolean,Object,Array};
vm.createContext(context);
let providerList=[];
let localCalls=0;
const localEngine={isRemote:false,chat:{completions:{create:async()=>({choices:[{message:{content:'local-ok'}}]})}}};
context.configuredFreeAIProviders=()=>providerList;
context.loadLocalEditorialJudge=async()=>{localCalls++;return localEngine;};
context.createFederatedFreeAIEngine=(providers,onProgress,fallback)=>({isRemote:true,providerChain:providers.map(p=>p.id),fallback});
vm.runInContext(extract('loadEditorialJudge')+';this.loadJudge=loadEditorialJudge;',context);

const local=await context.loadJudge(()=>{});
assert.equal(local,localEngine,'Qwen3 local engine must be used when no free provider is configured');
assert.equal(localCalls,1);
providerList=[{id:'provider-a',label:'Proveedor gratuito'}];
const federated=await context.loadJudge(()=>{});
assert.equal(federated.isRemote,true,'configured free providers must be preferred over local inference');
assert.deepEqual(Array.from(federated.providerChain),['provider-a']);
assert.equal(typeof federated.fallback,'function','local Qwen3 must remain available as fallback');

vm.runInContext(extract('estimateVideoCapacity')+';this.estimateCapacity=estimateVideoCapacity;',context);
const noWebGpu=context.estimateCapacity({durationSeconds:460,fileBytes:28034880,whisperModel:'whisper-base',deviceMemoryGb:8,webgpu:false});
assert.equal(noWebGpu.status,'incompatible','the capacity estimate must not claim local Qwen3 works without WebGPU');
assert.equal(noWebGpu.ramFit,true);
const gpuReady=context.estimateCapacity({durationSeconds:460,fileBytes:28034880,whisperModel:'whisper-base',deviceMemoryGb:8,webgpu:true});
assert.equal(gpuReady.status,'ready');
assert.ok(gpuReady.systemRamGb>0&&gpuReady.gpuRamGb>0&&gpuReady.freeDiskGb>0);
console.log('Browser AI routing passed: free providers first, Qwen3 local fallback, and honest WebGPU/resource compatibility checks.');
