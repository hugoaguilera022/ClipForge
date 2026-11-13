import { EditorStore, makeTracks } from './editor-store.js';
import { EditorCommands } from './editor-commands.js';

const store=new EditorStore();
const commands=new EditorCommands(store);
let bridge=null,originalBridge=null,initialized=false;
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const status=message=>window.dispatchEvent(new CustomEvent('clipforge:editor-status',{detail:{message}}));

function syncBridge(reason){
  if(!originalBridge||!store.ready)return;
  try{
    // Keep the legacy engine informed about track layout, but do not rebuild
    // its candidate cards while an edit is in progress. Export reads the
    // canonical store directly, avoiding a second source of truth.
    if(originalBridge.setTracks)originalBridge.setTracks(store.snapshot().tracks);
  }catch(error){status('No se pudo sincronizar la estructura de pistas: '+error.message);}
}
function connectBridge(){
  bridge=window.clipforgeEditorBridge;
  if(!bridge?.getProject||initialized)return;
  originalBridge={...bridge};
  const incoming=bridge.getProject();
  const clips=Array.isArray(incoming.clips)?incoming.clips:[];
  const transcript=incoming.transcript||null;
  const tracks=Array.isArray(incoming.tracks)&&incoming.tracks.length?incoming.tracks:makeTracks(clips,transcript);
  store.hydrate({...incoming,clips,transcript,tracks});
  initialized=true;
  // The bridge remains the compatibility boundary for the existing Whisper and
  // candidate-generation engine. Its data is mirrored into the canonical store.
  bridge.getCanonicalProject=()=>store.snapshot();
  bridge.getCommands=()=>commands;
  window.clipforgeProjectStore=store;
  window.clipforgeEditorCommands=commands;
  window.dispatchEvent(new CustomEvent('clipforge:project-store-ready',{detail:{store,commands}}));
  store.addEventListener('change',event=>syncBridge(event.detail.reason));
  store.addEventListener('storage-error',event=>status('No se pudo guardar automáticamente: '+(event.detail?.message||'almacenamiento no disponible')));
  status('Proyecto central activo · guardado automático local');
  store.recoverLast().then(saved=>{
    if(!saved||!saved.source||saved.source!==store.project.source||!saved.updatedAt)return;
    store.hydrate(saved);
    status('Se ha recuperado la última versión guardada de este proyecto.');
  }).catch(()=>{});
}
window.addEventListener('clipforge:editor-ready',connectBridge);
if(window.clipforgeEditorBridge)connectBridge();

// Keyboard commands operate on the same canonical project as the timeline and inspector.
window.addEventListener('keydown',event=>{
  const target=event.target;
  const typing=target&&(target.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  if(typing||!store.ready)return;
  const mod=event.metaKey||event.ctrlKey;
  if(mod&&event.key.toLowerCase()==='z'){
    event.preventDefault();event.shiftKey?store.redo():store.undo();
  }else if(mod&&event.key.toLowerCase()==='y'){
    event.preventDefault();store.redo();
  }else if(mod&&event.key.toLowerCase()==='c'){
    const count=commands.copy(store.project.selection);if(count)status(`${count} elemento(s) copiados.`);
  }else if(mod&&event.key.toLowerCase()==='v'){
    const ids=commands.paste(store.project.playhead);if(ids.length)status(`${ids.length} elemento(s) pegados.`);
  }else if(mod&&event.key.toLowerCase()==='d'){
    event.preventDefault();store.project.selection.forEach(id=>commands.duplicate(id));
  }else if(event.key==='Delete'||event.key==='Backspace'){
    if(store.project.selection.length){event.preventDefault();commands.remove(store.project.selection);store.select([]);}
  }else if(event.code==='Space'){
    const video=document.querySelector('#cfWorkspace .cf-opus-editing-card video, #cfWorkspace .cf-inline-player video, #editorPreviewVideo');
    if(video){event.preventDefault();if(video.paused)video.play().catch(()=>{});else video.pause();}
  }
});
window.addEventListener('clipforge:clips-updated',()=>{
  const current=window.clipforgeEditorBridge?.getProject?.();
  if(!current)return;
  store.hydrate({...store.snapshot(),...current,tracks:current.tracks?.length?current.tracks:makeTracks(current.clips,current.transcript)});
});
window.addEventListener('clipforge:candidate-edited',()=>{
  const current=window.clipforgeEditorBridge?.getProject?.();
  if(!current)return;
  if(Array.isArray(current.clips)){
    store.commit('candidate-edit',project=>{
      const video=project.tracks.find(t=>t.type==='video');
      if(video)video.items=current.clips.map((clip,i)=>({...clip,id:String(clip.id||`clip-${i+1}`),start:Number(clip.start),end:Number(clip.end)}));
      project.clips=clone(current.clips);
    });
  }
});
