import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('static/browser-whisper-inline-v3.js','utf8');
function extract(name){
  const asyncStart=source.indexOf(`async function ${name}(`);
  const start=asyncStart>=0?asyncStart:source.indexOf(`function ${name}(`);
  assert.ok(start>=0,name);
  let depth=0,end=-1,body=source.indexOf(') {',start)+2;
  for(let i=body;i<source.length;i++){
    if(source[i]==='{')depth++;
    else if(source[i]==='}'&&--depth===0){end=i+1;break;}
  }
  assert.ok(end>start,name+' closes');
  return source.slice(start,end);
}
const store=new Map();
const fields={
  '#colabEditorUrl':{value:'https://clipforge-test.trycloudflare.com/'},
  '#colabEditorToken':{value:'secret-token'},
  '#colabEditorStatus':{textContent:''},
  '#connectColabEditor':{disabled:false,textContent:'Comprobar y conectar',addEventListener:()=>{}}
};
const requests=[];
const context={
  URL,AbortController,setTimeout,clearTimeout,console,
  sessionStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  document:{querySelector:s=>fields[s]||null},
  fetch:async(url,options={})=>{
    requests.push({url,options});
    if(url.endsWith('/health'))return {ok:true,status:200,json:async()=>({status:'ready',model:'qwen3:4b'})};
    return {ok:true,status:200,json:async()=>({choices:[{message:{content:'{"selected":[]}'}}]})};
  }
};
vm.createContext(context);
vm.runInContext("const COLAB_EDITOR_KEY='clipforge.colab.editor.v1'; let editorialEnginePromise=null;",context);
for(const name of ['getColabEditorConfig','createRemoteEditorialEngine','connectColabEditorialEngine','loadEditorialJudge']){
  vm.runInContext(extract(name)+`;this.${name}=${name};`,context);
}
assert.equal(context.getColabEditorConfig(),null);
await context.connectColabEditorialEngine();
assert.ok(fields['#colabEditorStatus'].textContent.includes('Conectado y comprobado'));
assert.equal(requests[0].url,'https://clipforge-test.trycloudflare.com/health');
assert.equal(requests[0].options.headers.Authorization,'Bearer secret-token');
const config=context.getColabEditorConfig();
assert.equal(config.url,'https://clipforge-test.trycloudflare.com');
const engine=await context.loadEditorialJudge(()=>{});
assert.equal(engine.isRemote,true,'remote inference must not require local WebGPU');
const result=await engine.chat.completions.create({messages:[{role:'user',content:'test'}],max_tokens:100});
assert.equal(result.choices[0].message.content,'{"selected":[]}');
assert.equal(requests[1].url,'https://clipforge-test.trycloudflare.com/v1/chat/completions');
assert.equal(requests[1].options.headers.Authorization,'Bearer secret-token');
assert.equal(requests[1].options.cache,'no-store');
fields['#colabEditorUrl'].value='http://insecure.example';
await context.connectColabEditorialEngine();
assert.ok(fields['#colabEditorStatus'].textContent.includes('HTTPS'));
assert.equal(requests.length,2,'invalid URL must never be called');
console.log('Colab browser bridge passed: authenticated health check, session-only token, remote model without WebGPU, OpenAI-compatible requests and HTTPS host validation.');
