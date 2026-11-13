/* ClipForge Studio — one project model for preview, inspector, timeline and export. */
const clone = value => structuredClone(value);
const listeners = new Set();
const HISTORY_LIMIT = 100;
const DB_NAME = "clipforge-studio-local-v1";
let state = {schema:"clipforge-studio-v2",revision:0,duration:0,fps:30,profile:{width:1080,height:1920,aspect:"9:16"},source:null,projectId:null,clips:[],tracks:[],transcript:null,selected:null,playhead:0,zoom:1,activeClipIndex:0};
let undoStack=[],redoStack=[],dbPromise=null,saveTimer=null;
const assetUrls=new Map(),assetBlobs=new Map(),previewAudio=new Map(),audioBuffers=new Map();
const uid=()=>crypto.randomUUID?.()||("cf-"+Date.now()+"-"+Math.random().toString(36).slice(2));
function emit(reason){state.revision++;for(const fn of listeners)fn(clone(state),reason);window.dispatchEvent(new CustomEvent("clipforge:studio-state",{detail:{state:clone(state),reason}}));scheduleAutosave();}
function db(){
 if(dbPromise)return dbPromise;
 dbPromise=new Promise((resolve,reject)=>{
  if(!("indexedDB" in window)){reject(new Error("IndexedDB no está disponible"));return;}
  const req=indexedDB.open(DB_NAME,1);
  req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains("projects"))d.createObjectStore("projects",{keyPath:"id"});if(!d.objectStoreNames.contains("assets"))d.createObjectStore("assets",{keyPath:"id"});};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error("No se pudo abrir el almacenamiento local"));
 });
 return dbPromise;
}
async function put(store,value){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction(store,"readwrite");tx.objectStore(store).put(value);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);});}
async function get(store,id){const d=await db();return new Promise((resolve,reject)=>{const req=d.transaction(store,"readonly").objectStore(store).get(id);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);});}
async function all(store){const d=await db();return new Promise((resolve,reject)=>{const req=d.transaction(store,"readonly").objectStore(store).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);});}
function scheduleAutosave(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveProject(false).catch(e=>setStatus("No se pudo guardar automáticamente: "+e.message)),650);}
function setStatus(message){const el=document.querySelector(".cf-studio-status");if(el)el.textContent=message;}
function history(label,mutator){
 const before=clone(state);
 try{mutator(state);}catch(error){state=before;throw error;}
 undoStack.push({label,state:before});if(undoStack.length>HISTORY_LIMIT)undoStack.shift();
 redoStack=[];emit(label);
}
export const studioStore={
 getState:()=>clone(state),
 subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
 load(project){undoStack=[];redoStack=[];state={...clone(project),schema:"clipforge-studio-v2"};emit("load");},
 transact:history,
 undo(){if(!undoStack.length)return false;redoStack.push(clone(state));const old=undoStack.pop();state=old.state;emit("undo:"+old.label);return true;},
 redo(){if(!redoStack.length)return false;undoStack.push(clone(state));state=redoStack.pop();emit("redo");return true;},
 ephemeral(reason,patch){Object.assign(state,patch);for(const fn of listeners)fn(clone(state),reason);},
 setPlayheadFromPreview(time){
  state.playhead=Math.max(0,Math.min(state.duration,Number(time)||0));
  window.dispatchEvent(new CustomEvent("clipforge:studio-playhead",{detail:{time:state.playhead}}));
 }
};
function locate(id){for(const track of state.tracks){const item=track.items.find(x=>x.id===id);if(item)return {track,item};}return null;}
export const studioCommands={
 addTrack(type,name){const id=uid();history("Añadir pista",s=>s.tracks.push({id,type,name:name||type,locked:false,muted:false,hidden:false,items:[]}));return id;},
 addItem(trackId,item){const id=item.id||uid();history("Añadir elemento",s=>{const t=s.tracks.find(x=>x.id===trackId);if(!t||t.locked)throw Error("La pista está bloqueada");const start=Math.max(0,Number(item.start)||0),end=Math.max(0,Number(item.end)||0);if(end<=start)throw Error("La duración del elemento debe ser positiva");t.items.push({...item,id,start,end});});return id;},
 patch(id,patch){history("Editar elemento",s=>{const f=locate(id);if(!f||f.track.locked)throw Error("Elemento bloqueado o inexistente");const next={...f.item,...patch};if(next.end<=next.start)throw Error("El final debe ser posterior al inicio");Object.assign(f.item,patch);syncClipFromVideoItem(f.item);});},
 remove(id){history("Eliminar elemento",s=>{const found=locate(id);if(found?.track.type==="video"&&found.item.clipIndex!==undefined&&found.item.clipIndex!==null){const original=s.clips[Number(found.item.clipIndex)];if(original)original.selected=false;}for(const t of s.tracks)t.items=t.items.filter(x=>x.id!==id);if(s.selected===id)s.selected=null;});},
 duplicate(id){let next;history("Duplicar elemento",()=>{const f=locate(id);if(!f||f.track.locked)throw Error("Elemento bloqueado");next={...f.item,id:uid(),start:f.item.start+.1,end:f.item.end+.1};if(f.track.type==="video")next.clipIndex=null;f.track.items.push(next);});return next.id;},
 move(id,toTrack,start){history("Mover elemento",s=>{const f=locate(id),to=s.tracks.find(x=>x.id===toTrack);if(!f||f.track.locked||!to||to.locked)throw Error("No se puede mover el elemento");if(f.track.type!==to.type)throw Error("Solo puedes mover elementos entre pistas del mismo tipo");const duration=f.item.end-f.item.start;const next={...f.item,start:Math.max(0,start),end:Math.max(0,start)+duration};f.track.items=f.track.items.filter(x=>x.id!==id);to.items.push(next);syncClipFromVideoItem(next);});},
 trim(id,edge,time){history("Recortar elemento",()=>{const f=locate(id);if(!f||f.track.locked)throw Error("Elemento bloqueado");const t=Math.max(0,Number(time)||0);if(edge==="start"){const next=Math.min(t,f.item.end-.05);const delta=next-f.item.start;f.item.start=next;f.item.sourceStart=(Number(f.item.sourceStart)||0)+delta;}else f.item.end=Math.max(f.item.start+.05,t);syncClipFromVideoItem(f.item);});},
 split(id,time){let right;history("Dividir elemento",s=>{const f=locate(id),t=Number(time);if(!f||f.track.locked||t<=f.item.start+.03||t>=f.item.end-.03)throw Error("Coloca el cabezal dentro del elemento");const oldEnd=f.item.end;right={...f.item,id:uid(),start:t,sourceStart:(Number(f.item.sourceStart)||0)+(t-f.item.start),end:oldEnd};f.item.end=t;if(f.track.type==="video")right.clipIndex=null;f.track.items.push(right);syncClipFromVideoItem(f.item);});return right.id;},
 setTrack(id,key,value){history("Ajustar pista",s=>{const t=s.tracks.find(x=>x.id===id);if(!t||!["locked","muted","hidden","name"].includes(key))return;t[key]=value;});},
 select(id){
  const found=locate(id),patch={selected:id};
  if(found){
   patch.playhead=Number(found.item.start)||0;
   if(found.track.type==="video"&&found.item.clipIndex!==undefined&&found.item.clipIndex!==null)patch.activeClipIndex=Number(found.item.clipIndex);
  }
  studioStore.ephemeral("selection",patch);
  if(found)window.__cfStudioSeek?.(state.playhead);
 },
 playhead(time){const next=Math.max(0,Math.min(state.duration,Number(time)||0));studioStore.ephemeral("playhead",{playhead:next});window.__cfStudioSeek?.(next);},
 zoom(value){studioStore.ephemeral("zoom",{zoom:Math.max(.25,Math.min(8,Number(value)||1))});}
};
function syncClipFromVideoItem(item){
 if(item.clipIndex===undefined||item.clipIndex===null)return;
 const c=state.clips[Number(item.clipIndex)];if(!c)return;
 c.start=Number(item.start);c.end=Number(item.end);c.duration=c.end-c.start;
 c.sourceStart=Number(item.sourceStart??c.sourceStart??item.start);
 if(item.visualEffects)c.visualEffects=clone(item.visualEffects);
 if(item.transitions)c.transitions=clone(item.transitions);
}
function createTracks(clips,transcript,duration){
 const items=(clips||[]).map((clip,i)=>({...clip,id:"video-"+String(clip.id||i),type:"video",clipIndex:i,sourceStart:Number(clip.start)||0,volume:1}));
 const captions=(transcript?.segments||[]).map((s,i)=>({id:"subtitle-"+i,type:"subtitle",start:Number(s.start),end:Number(s.end),text:String(s.text||""),words:s.words||[],style:transcript.subtitleStyle||null})).filter(x=>Number.isFinite(x.start)&&Number.isFinite(x.end)&&x.end>x.start);
 return [
  {id:"track-v1",type:"video",name:"V1 · Vídeo principal",locked:false,muted:false,hidden:false,items},
  {id:"track-a1",type:"audio",name:"A1 · Audio original",locked:false,muted:false,hidden:false,items:[{id:"audio-source",type:"audio",source:"source-audio",text:"Audio original",start:0,end:duration,sourceStart:0,volume:.8}]},
  {id:"track-a2",type:"audio",name:"A2 · Música",locked:false,muted:false,hidden:false,items:[]},
  {id:"track-a3",type:"audio",name:"A3 · Efectos sonoros",locked:false,muted:false,hidden:false,items:[]},
  {id:"track-s1",type:"subtitles",name:"S1 · Subtítulos",locked:false,muted:false,hidden:false,items:captions},
  {id:"track-t1",type:"text",name:"T1 · Textos y títulos",locked:false,muted:false,hidden:false,items:[]},
  {id:"track-fx",type:"effects",name:"FX · Efectos",locked:false,muted:false,hidden:false,items:[]}
 ];
}
async async function saveProject(downloadBackup=true){
 const id=state.projectId||("project-"+Date.now());state.projectId=id;
 const project=clone(state);project.savedAt=new Date().toISOString();
 await put("projects",{id,name:state.source?.name||"Proyecto ClipForge",sourceName:state.source?.name||"",updatedAt:Date.now(),project});
 // Also synchronize the established project bridge used by the legacy project JSON/export flow.
 const bridge=window.clipforgeEditorBridge;
 if(bridge?.setTracks)bridge.setTracks(state.tracks);
 if(Array.isArray(window.__cfEditableCandidates)){
  state.clips.forEach((clip,i)=>{if(window.__cfEditableCandidates[i])window.__cfEditableCandidates[i]={...window.__cfEditableCandidates[i],...clip};});
  window.dispatchEvent(new CustomEvent("clipforge:candidate-edited"));
 }
 if(downloadBackup){
  const blob=new Blob([JSON.stringify(project,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="clipforge-"+id+".json";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }
 setStatus("Proyecto guardado localmente"+(downloadBackup?" y copia JSON descargada.":"."));
 return project;
}
async async function addAudioAsset(file){
 const id=uid(),blob=file;
 await put("assets",{id,name:file.name,type:file.type||"audio/*",blob,size:file.size});
 assetBlobs.set(id,blob);assetUrls.set(id,URL.createObjectURL(blob));
 let duration=30;
 try{const C=window.AudioContext||window.webkitAudioContext;if(C){const c=new C();const buffer=await c.decodeAudioData(await file.arrayBuffer());duration=buffer.duration;audioBuffers.set(id,buffer);await c.close();}}catch(e){console.warn("No se pudo medir el audio; se usará una duración aproximada",e);}
 return {id,name:file.name,duration};
}
async function getAssetBlob(id){
 if(assetBlobs.has(id))return assetBlobs.get(id);
 const record=await get("assets",id);if(!record?.blob)throw new Error("No se encuentra el archivo de audio "+id);
 assetBlobs.set(id,record.blob);return record.blob;
}
async function getAssetUrl(id){if(assetUrls.has(id))return assetUrls.get(id);const blob=await getAssetBlob(id);const url=URL.createObjectURL(blob);assetUrls.set(id,url);return url;}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function currentVideoItem(s=state){
 const items=s.tracks.filter(t=>t.type==="video"&&!t.hidden).flatMap(t=>t.items||[]);
 const atPlayhead=items.find(x=>s.playhead>=x.start&&s.playhead<=x.end);
 if(atPlayhead)return atPlayhead;
 const selected=items.find(x=>x.id===s.selected);
 if(selected)return selected;
 return items.find(x=>x.clipIndex!==null&&x.clipIndex!==undefined&&Number(x.clipIndex)===Number(s.activeClipIndex))||items[s.activeClipIndex]||null;
}
function previewLayerAt(sourceTime,timelineTime){
 const subTrack=state.tracks.find(t=>t.type==="subtitles"&&!t.hidden);
 const textTrack=state.tracks.find(t=>t.type==="text"&&!t.hidden);
 const sub=subTrack?.items.find(x=>sourceTime>=x.start&&sourceTime<=x.end);
 const txt=textTrack?.items.filter(x=>timelineTime>=x.start&&timelineTime<=x.end)||[];
 return {sub,txt};
}
function syncPreviewVideo(video,overlay){
 const update=()=>{
  const sourceTime=Number(video.currentTime)||0;
  const item=currentVideoItem();
  if(!item)return;
  const t=Number(item.start)+(sourceTime-Number(item.sourceStart??item.start));
  studioStore.setPlayheadFromPreview(t);
  if(sourceTime>=Number(item.sourceStart??item.start)+(Number(item.end)-Number(item.start))-.03&&!video.paused){video.pause();}
  const fx=item?.visualEffects||{};
  const filters={cinematic:"contrast(1.14) saturate(.82)",warm:"sepia(.16) saturate(1.2)",cool:"hue-rotate(12deg) saturate(.9)",bw:"grayscale(1) contrast(1.08)",vintage:"sepia(.32) contrast(.78)",vivid:"saturate(1.45) contrast(1.08)"};
  video.style.filter=[filters[fx.preset]||"",fx.brightness&&fx.brightness!==100?"brightness("+fx.brightness+"%)":"",fx.contrast&&fx.contrast!==100?"contrast("+fx.contrast+"%)":"",fx.saturation&&fx.saturation!==100?"saturate("+fx.saturation+"%)":""].filter(Boolean).join(" ");
  const trans=item?.transitions||{};const dur=Math.max(.1,Math.min(2,Number(trans.duration)||.5));const local=t-(Number(item?.start)||0);let opacity=1,scale=1;
  if(trans.in==="fade")opacity=Math.min(opacity,Math.max(0,local/dur));if(trans.out==="fade")opacity=Math.min(opacity,Math.max(0,(Number(item?.end)-t)/dur));
  if(trans.in==="zoom")scale=1+Math.max(0,1-local/dur)*.12;if(trans.out==="zoom")scale=Math.max(scale,1+Math.max(0,1-(Number(item?.end)-t)/dur)*.12);
  video.style.opacity=String(Math.max(0,Math.min(1,opacity*Number(item.opacity??100)/100)));video.style.transform="scale("+scale+")";
  const {sub,txt}=previewLayerAt(sourceTime,t);
  overlay.replaceChildren();
  if(sub){const cap=document.createElement("div");cap.className="cf-studio-caption-preview";cap.textContent=sub.text||"";const style=sub.style||{};cap.style.color=style.color||"#fff";cap.style.fontSize=Math.max(14,Number(style.size)||28)+"px";cap.style.background=style.background&&style.background!=="transparent"?style.background:"rgba(0,0,0,.68)";cap.style.fontFamily=style.font||"Inter,sans-serif";cap.style.fontWeight=style.bold===false?"500":"800";cap.style.top=style.position==="top"?"9%":style.position==="middle"?"48%":"auto";cap.style.bottom=style.position==="top"||style.position==="middle"?"auto":"8%";overlay.append(cap);}
  for(const layer of txt){const el=document.createElement("div");el.className="cf-studio-text-preview";el.textContent=layer.text||"";el.style.color=layer.color||"#fff";el.style.fontSize=Math.max(14,Number(layer.fontSize)||32)+"px";el.style.top=(Number(layer.y)||22)+"%";el.style.left=(Number(layer.x)||50)+"%";el.style.transform="translate(-50%,-50%)";overlay.append(el);}
 };
 const onTime=()=>update(),onSeek=()=>update(),onMetadata=()=>{window.__cfStudioSeek?.(state.playhead);update();};
 video.addEventListener("timeupdate",onTime);video.addEventListener("seeked",onSeek);video.addEventListener("loadedmetadata",onMetadata);update();
 return ()=>{video.removeEventListener("timeupdate",onTime);video.removeEventListener("seeked",onSeek);video.removeEventListener("loadedmetadata",onMetadata);};
}
function syncExternalAudio(video){
 const audioItems=()=>state.tracks.filter(t=>t.type==="audio"&&!t.muted&&!t.hidden).flatMap(t=>t.items.filter(x=>x.source!=="source-audio"&&x.assetId).map(x=>({track:t,item:x})));
 async function update(){
  const time=Number(state.playhead)||0;
  const sourceTrack=state.tracks.find(t=>t.id==="track-a1"||t.name?.startsWith("A1"));
  const sourceItem=sourceTrack?.items?.find(x=>time>=x.start&&time<x.end);
  video.muted=!sourceItem||!!sourceTrack?.muted||Number(sourceItem?.volume??1)<=0;
  if(sourceItem)video.volume=Math.max(0,Math.min(1,Number(sourceItem.volume??1)));
  const wanted=audioItems().filter(x=>time>=x.item.start&&time<x.item.end);
  const keys=new Set(wanted.map(x=>x.item.id));
  for(const [id,entry] of previewAudio){if(!keys.has(id)){entry.el.pause();entry.el.removeAttribute("src");entry.el.load();previewAudio.delete(id);}}
  for(const entry of wanted){
   let current=previewAudio.get(entry.item.id);
   if(!current){const el=new Audio();el.preload="auto";el.src=await getAssetUrl(entry.item.assetId);current={el,track:entry.track,item:entry.item};previewAudio.set(entry.item.id,current);}
   current.track=entry.track;current.item=entry.item;
   const sourceTime=(Number(entry.item.sourceStart)||0)+(time-entry.item.start);
   if(Math.abs((current.el.currentTime||0)-sourceTime)>.35){try{current.el.currentTime=Math.max(0,sourceTime);}catch{}}
   current.el.volume=Math.max(0,Math.min(1,Number(entry.item.volume??1)));
   if(video.paused)current.el.pause();else current.el.play().catch(()=>{});
  }
 }
 const onTime=()=>update().catch(e=>console.warn("Audio preview:",e));
 const onPlay=()=>update().catch(e=>console.warn("Audio preview:",e));
 const onPause=()=>previewAudio.forEach(x=>x.el.pause());
 video.addEventListener("timeupdate",onTime);video.addEventListener("play",onPlay);video.addEventListener("pause",onPause);
 update().catch(e=>console.warn("Audio preview:",e));
 return ()=>{video.removeEventListener("timeupdate",onTime);video.removeEventListener("play",onPlay);video.removeEventListener("pause",onPause);for(const x of previewAudio.values()){x.el.pause();x.el.removeAttribute("src");}previewAudio.clear();};
}
function renderInspector(root){
 const s=state,item=locate(s.selected)?.item,found=locate(s.selected);
 if(!item){root.innerHTML='<div class="cf-studio-empty">Selecciona un bloque de la línea de tiempo para ver sus propiedades.</div>';return;}
 const track=found.track;
 let html='<div class="cf-studio-inspector-head"><b>Inspector</b><small>'+escapeHtml(track.name)+'</small></div>';
 html+='<label>Nombre / contenido<input data-field="text" value="'+escapeHtml(item.text||item.title||item.assetName||"")+'"></label>';
 html+='<div class="cf-studio-fields"><label>Inicio (s)<input data-field="start" type="number" min="0" step=".01" value="'+Number(item.start).toFixed(2)+'"></label><label>Final (s)<input data-field="end" type="number" min=".05" step=".01" value="'+Number(item.end).toFixed(2)+'"></label></div>';
 if(track.type==="audio"){
  html+='<label>Volumen<input data-field="volume" type="range" min="0" max="200" value="'+Math.round(Number(item.volume??1)*100)+'"></label><div class="cf-studio-fields"><label>Fundido entrada (s)<input data-field="fadeIn" type="number" min="0" max="10" step=".1" value="'+Number(item.fadeIn||0)+'"></label><label>Fundido salida (s)<input data-field="fadeOut" type="number" min="0" max="10" step=".1" value="'+Number(item.fadeOut||0)+'"></label></div>';
  html+='<small>Archivo: '+escapeHtml(item.assetName||"Audio original")+'</small>';
 } else if(track.type==="subtitles"){
  html+='<label>Estilo<select data-field="stylePreset"><option value="classic">Clásico</option><option value="capcut-bold">Impacto</option><option value="karaoke">Karaoke</option><option value="minimal">Minimal</option></select></label>';
  html+='<label>Tamaño<input data-field="fontSize" type="range" min="16" max="64" value="'+Number(item.style?.size||28)+'"></label>';
  html+='<div class="cf-studio-fields"><label>Posición<select data-field="position"><option value="bottom">Inferior</option><option value="middle">Centro</option><option value="top">Superior</option></select></label><label>Animación<select data-field="animation"><option value="none">Sin animación</option><option value="pop">Pop palabra</option></select></label></div>';
  html+='<div class="cf-studio-fields"><label>Color<input data-field="color" type="color" value="'+(item.style?.color||"#ffffff")+'"></label><label>Resalte<input data-field="highlight" type="color" value="'+(item.style?.highlight||"#ffe600")+'"></label></div>';
  html+='<label>Fondo<input data-field="background" type="color" value="'+(item.style?.background&&item.style.background!=="transparent"?item.style.background:"#000000")+'"></label>';
  html+='<div class="cf-studio-fields"><label>Contorno<input data-field="outline" type="color" value="'+(item.style?.outline||"#080808")+'"></label><label>Grosor<input data-field="outlineWidth" type="range" min="0" max="8" value="'+Number(item.style?.outlineWidth||0)+'"></label></div>';
  html+='<label>Palabra activa<select data-field="wordMode"><option value="none">Color uniforme</option><option value="highlight">Resaltar palabra</option></select></label>';
 } else if(track.type==="video"){
  const fx=item.visualEffects||{};
  html+='<label>Filtro<select data-field="preset"><option value="none">Original</option><option value="cinematic">Cinemático</option><option value="warm">Cálido</option><option value="cool">Frío</option><option value="bw">Blanco y negro</option><option value="vintage">Vintage</option><option value="vivid">Intenso</option></select></label>';
  html+='<label>Brillo<input data-field="brightness" type="range" min="50" max="160" value="'+Number(fx.brightness||100)+'"></label><label>Contraste<input data-field="contrast" type="range" min="50" max="180" value="'+Number(fx.contrast||100)+'"></label><label>Saturación<input data-field="saturation" type="range" min="0" max="200" value="'+Number(fx.saturation||100)+'"></label>';
  html+='<label>Opacidad<input data-field="opacity" type="range" min="0" max="100" value="'+Number(item.opacity??100)+'"></label>';
  html+='<div class="cf-studio-fields"><label>Entrada<select data-field="transitionIn"><option value="none">Ninguna</option><option value="fade">Fundido</option><option value="zoom">Zoom</option></select></label><label>Salida<select data-field="transitionOut"><option value="none">Ninguna</option><option value="fade">Fundido</option><option value="zoom">Zoom</option></select></label></div><label>Duración de transición<input data-field="transitionDuration" type="number" min=".1" max="2" step=".1" value="'+Number(item.transitions?.duration||.5)+'"></label>';
 } else if(track.type==="text"){
  html+='<label>Tamaño<input data-field="fontSize" type="range" min="14" max="120" value="'+Number(item.fontSize||32)+'"></label>';
  html+='<div class="cf-studio-fields"><label>Color<input data-field="color" type="color" value="'+(item.color||"#ffffff")+'"></label><label>Fondo<input data-field="background" type="color" value="'+(item.background&&item.background!=="transparent"?item.background:"#000000")+'"></label></div>';
  html+='<div class="cf-studio-fields"><label>Horizontal (%)<input data-field="x" type="number" min="0" max="100" value="'+Number(item.x??50)+'"></label><label>Vertical (%)<input data-field="y" type="number" min="0" max="100" value="'+Number(item.y??22)+'"></label></div>';
  html+='<div class="cf-studio-fields"><label>Contorno<input data-field="outline" type="color" value="'+(item.outline||"#080808")+'"></label><label>Grosor<input data-field="outlineWidth" type="range" min="0" max="8" value="'+Number(item.outlineWidth||0)+'"></label></div>';
  html+='<div class="cf-studio-fields"><label>Fuente<select data-field="font"><option value="system-ui">System</option><option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="Impact">Impacto</option><option value="monospace">Monoespaciada</option></select></label><label>Peso<select data-field="bold"><option value="true">Negrita</option><option value="false">Normal</option></select></label></div>';
 }
 html+='<div class="cf-studio-inspector-actions"><button data-action="duplicate">Duplicar</button><button data-action="delete">Eliminar</button></div>';
 root.innerHTML=html;
 const preset=root.querySelector('[data-field="preset"]');if(preset)preset.value=item.visualEffects?.preset||"none";
 const transitionIn=root.querySelector('[data-field="transitionIn"]');if(transitionIn)transitionIn.value=item.transitions?.in||"none";
 const transitionOut=root.querySelector('[data-field="transitionOut"]');if(transitionOut)transitionOut.value=item.transitions?.out||"none";
 const stylePreset=root.querySelector('[data-field="stylePreset"]');if(stylePreset)stylePreset.value=item.style?.preset||"classic";
 const pos=root.querySelector('[data-field="position"]');if(pos)pos.value=item.style?.position||"bottom";
 const wordMode=root.querySelector('[data-field="wordMode"]');if(wordMode)wordMode.value=item.style?.wordMode||"none";
 const animation=root.querySelector('[data-field="animation"]');if(animation)animation.value=item.style?.animation||"none";
 const font=root.querySelector('[data-field="font"]');if(font)font.value=item.font||"system-ui";
 const bold=root.querySelector('[data-field="bold"]');if(bold)bold.value=String(item.bold!==false);
 const presetStyles={
  classic:{bold:true,background:"#000000",wordMode:"none",outline:"#080808",outlineWidth:0},
  "capcut-bold":{bold:true,background:"#000000",wordMode:"highlight",highlight:"#ffe600",outline:"#080808",outlineWidth:3},
  karaoke:{bold:true,background:"transparent",wordMode:"highlight",highlight:"#ffe600",outline:"#080808",outlineWidth:1,animation:"pop"},
  minimal:{bold:false,background:"transparent",wordMode:"none",outline:"#080808",outlineWidth:0}
 };
 root.querySelectorAll("[data-field]").forEach(el=>el.addEventListener("change",()=>{
  const key=el.dataset.field;let value=el.value;
  if(["start","end","volume","fadeIn","fadeOut","fontSize","brightness","contrast","saturation","transitionDuration","x","y","outlineWidth","opacity"].includes(key))value=Number(value);
  if(key==="volume")value/=100;
  if(key==="bold")value=value!=="false";
  let patch={};
  if(track.type==="video"&&["preset","brightness","contrast","saturation"].includes(key))patch.visualEffects={...(item.visualEffects||{}),[key]:value};
  else if(track.type==="video"&&key==="opacity")patch.opacity=value;
  else if(track.type==="video"&&key.startsWith("transition")){const k=key==="transitionIn"?"in":key==="transitionOut"?"out":"duration";patch.transitions={...(item.transitions||{}),[k]:value};}
  else if(track.type==="subtitles"&&key==="stylePreset"){patch.style={...(item.style||{}),...(presetStyles[value]||presetStyles.classic),preset:value};}
  else if(track.type==="subtitles"&&["position","color","fontSize","highlight","background","outline","outlineWidth","wordMode","animation"].includes(key)){const k=key==="fontSize"?"size":key;patch.style={...(item.style||{}),[k]:value,preset:item.style?.preset||"classic"};}
  else if(track.type==="text"&&["text","fontSize","color","background","x","y","outline","outlineWidth","font","bold"].includes(key))patch[key]=value;
  else patch[key]=value;
  try{studioCommands.patch(item.id,patch);}catch(error){setStatus(error.message);}
 }));
 root.querySelectorAll("[data-action]").forEach(b=>b.addEventListener("click",()=>{try{if(b.dataset.action==="duplicate")studioCommands.duplicate(item.id);else studioCommands.remove(item.id);}catch(e){setStatus(e.message);}}));
}
function mountTimeline(root){
 root.replaceChildren();const panel=document.createElement("section");panel.className="cf-studio-timeline";
 panel.innerHTML='<div class="cf-studio-timeline-head"><b>Línea de tiempo</b><div class="cf-studio-actions"><button data-cmd="undo" title="Deshacer">↶</button><button data-cmd="redo" title="Rehacer">↷</button><button data-cmd="split">✂ Dividir</button><button data-cmd="copy">Copiar</button><button data-cmd="paste">Pegar</button><button data-cmd="duplicate">Duplicar</button><button data-cmd="delete">Eliminar</button><button data-cmd="zoomout">−</button><input data-zoom type="range" min=".25" max="8" step=".25" value="1" aria-label="Zoom"><button data-cmd="zoomin">+</button></div></div><div class="cf-studio-ruler"></div><div class="cf-studio-track-list"></div><div class="cf-studio-timeline-note">Doble clic en la regla para mover el cabezal. Arrastra los bloques para moverlos.</div>';
 root.append(panel);const ruler=panel.querySelector(".cf-studio-ruler"),list=panel.querySelector(".cf-studio-track-list"),note=panel.querySelector(".cf-studio-timeline-note");
 const scale=()=>38*state.zoom;let copied=null;
 function render(s){
  panel.style.setProperty("--scale",scale()+"px");
  const width=Math.max(10,s.duration||10)*scale();ruler.style.width=width+"px";ruler.replaceChildren();
  const step=s.zoom>=3?1:s.zoom>=1?2:5;
  for(let t=0;t<=Math.max(10,s.duration);t+=step){const m=document.createElement("span");m.style.left=(t*scale())+"px";m.textContent=t+"s";ruler.append(m);}
  list.replaceChildren();
  for(const track of s.tracks){
   const row=document.createElement("div");row.className="cf-studio-track-row";
   const label=document.createElement("div");label.className="cf-studio-track-label";
   const name=document.createElement("b");name.textContent=track.name;
   const lock=document.createElement("button");lock.textContent=track.locked?"🔒":"🔓";lock.title="Bloquear pista";lock.onclick=()=>studioCommands.setTrack(track.id,"locked",!track.locked);
   const mute=document.createElement("button");mute.textContent=track.muted?"🔇":"🔊";mute.title="Silenciar pista";mute.onclick=()=>studioCommands.setTrack(track.id,"muted",!track.muted);
   const hide=document.createElement("button");hide.textContent=track.hidden?"◌":"◉";hide.title="Ocultar pista";hide.onclick=()=>studioCommands.setTrack(track.id,"hidden",!track.hidden);
   label.append(name,lock,mute,hide);const lane=document.createElement("div");lane.className="cf-studio-lane";lane.style.width=width+"px";lane.style.opacity=track.hidden?".35":"1";
   for(const item of track.items){
    const block=document.createElement("div");block.className="cf-studio-block"+(s.selected===item.id?" selected":"");block.style.left=(item.start*scale())+"px";block.style.width=Math.max(14,(item.end-item.start)*scale())+"px";block.title=item.start.toFixed(2)+"–"+item.end.toFixed(2)+" s";
    const text=document.createElement("span");text.textContent=item.text||item.title||item.assetName||track.type;block.append(text);
    const left=document.createElement("button"),right=document.createElement("button");left.className="cf-studio-trim cf-left";right.className="cf-studio-trim cf-right";left.title="Recortar inicio";right.title="Recortar final";block.append(left,right);
    block.addEventListener("click",e=>{if(e.target===left||e.target===right)return;studioCommands.select(item.id);});
    block.addEventListener("pointerdown",e=>{
     if(track.locked)return;
     const edge=e.target===left?"start":e.target===right?"end":null;
     const x=e.clientX,initial=edge?(edge==="start"?item.start:item.end):item.start;block.setPointerCapture?.(e.pointerId);
     const move=ev=>{const t=Math.max(0,initial+(ev.clientX-x)/scale());if(edge==="start")block.style.left=t*scale()+"px";else if(edge==="end")block.style.width=Math.max(12,(t-item.start)*scale())+"px";else block.style.left=Math.max(0,t)*scale()+"px";};
     const stop=ev=>{
     block.removeEventListener("pointermove",move);block.removeEventListener("pointerup",stop);block.removeEventListener("pointercancel",stop);
     const t=Math.max(0,initial+(ev.clientX-x)/scale());if(Math.abs(t-initial)<.02)return;
     if(edge){studioCommands.trim(item.id,edge,t);return;}
     const targetRow=document.elementFromPoint(ev.clientX,ev.clientY)?.closest(".cf-studio-track-row");
     const rows=[...list.querySelectorAll(".cf-studio-track-row")],targetIndex=rows.indexOf(targetRow);
     const targetTrack=targetIndex>=0?state.tracks[targetIndex]:track;
     try{studioCommands.move(item.id,targetTrack.id,t);}catch(error){note.textContent=error.message;}
    };
     block.addEventListener("pointermove",move);block.addEventListener("pointerup",stop,{once:true});block.addEventListener("pointercancel",stop,{once:true});
    });
    lane.append(block);
   }
   const head=document.createElement("i");head.className="cf-studio-head";head.style.left=s.playhead*scale()+"px";lane.append(head);
   row.append(label,lane);list.append(row);
  }
 }
 const unsubscribe=studioStore.subscribe(render);render(state);
 const previewHead=e=>{const t=Number(e.detail?.time)||0;panel.querySelectorAll(".cf-studio-head").forEach((head)=>{head.style.left=t*scale()+"px";});};
 window.addEventListener("clipforge:studio-playhead",previewHead);
 const seekFromRuler=e=>{const r=ruler.getBoundingClientRect();studioCommands.playhead(Math.max(0,(e.clientX-r.left)/scale()));};
 ruler.addEventListener("click",seekFromRuler);
 panel.addEventListener("click",e=>{
  const cmd=e.target.closest("[data-cmd]")?.dataset.cmd;if(!cmd)return;
  const s=state,id=s.selected,found=locate(id);
  try{
   if(cmd==="undo")studioStore.undo();if(cmd==="redo")studioStore.redo();
   if(cmd==="zoomin")studioCommands.zoom(s.zoom+.25);if(cmd==="zoomout")studioCommands.zoom(s.zoom-.25);
   if(cmd==="delete"&&id)studioCommands.remove(id);if(cmd==="duplicate"&&id)studioCommands.duplicate(id);
   if(cmd==="split"&&found)studioCommands.split(id,s.playhead);
   if(cmd==="copy"&&found)copied=clone(found.item);
   if(cmd==="paste"&&copied){const track=state.tracks.find(t=>t.type===found?.track.type)||state.tracks.find(t=>t.type===copied.type)||state.tracks[0];studioCommands.addItem(track.id,{...copied,id:uid(),start:state.playhead,end:state.playhead+(copied.end-copied.start)});}
  }catch(err){note.textContent=err.message;}
 });
 panel.querySelector("[data-zoom]").oninput=e=>studioCommands.zoom(e.target.value);
 const keydown=e=>{
  if(e.target.closest("input,textarea,select,[contenteditable=true]"))return;
  const mod=e.metaKey||e.ctrlKey;
  if(mod&&e.key.toLowerCase()==="z"){e.preventDefault();e.shiftKey?studioStore.redo():studioStore.undo();}
  else if(mod&&e.key.toLowerCase()==="c"){const f=locate(state.selected);if(f)copied=clone(f.item);}
  else if(mod&&e.key.toLowerCase()==="v"&&copied){const t=state.tracks.find(x=>x.type===locate(state.selected)?.track.type)||state.tracks[0];if(t)studioCommands.addItem(t.id,{...copied,id:uid(),start:state.playhead,end:state.playhead+copied.end-copied.start});}
  else if((e.key==="Delete"||e.key==="Backspace")&&state.selected){e.preventDefault();studioCommands.remove(state.selected);}
 };
 window.addEventListener("keydown",keydown);
 return ()=>{unsubscribe();window.removeEventListener("keydown",keydown);window.removeEventListener("clipforge:studio-playhead",previewHead);ruler.removeEventListener("click",seekFromRuler);root.replaceChildren();};
}
function mountInspector(root){const off=studioStore.subscribe(s=>renderInspector(root));renderInspector(root);return ()=>{off();root.replaceChildren();};}
async function loadProjectList(){
 const projects=await all("projects");return projects.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
}
async function restoreProject(id){
 const record=await get("projects",id);if(!record?.project)throw new Error("No se encuentra el proyecto guardado");
 studioStore.load(record.project);
 for(const track of state.tracks)for(const item of track.items||[])if(item.assetId)await getAssetUrl(item.assetId);
 const sourceFile=document.querySelector("#video")?.files?.[0];
 if(!sourceFile||sourceFile.name!==state.source?.name){setStatus("Proyecto recuperado. Selecciona de nuevo el vídeo original para vincular la previsualización y exportar.");}
 return state;
}
function makeEditorShell(){
 const shell=document.createElement("section");shell.className="cf-studio-shell";
 shell.innerHTML='<header class="cf-studio-topbar"><button data-action="back">← Clips</button><strong>ClipForge Studio</strong><span class="cf-studio-project-name"></span><button data-action="relink">Vincular vídeo</button><input data-source-input type="file" accept="video/*" hidden><button data-action="undo">↶</button><button data-action="redo">↷</button><button data-action="open">Abrir</button><button data-action="save">Guardar</button><button data-action="export">Exportar MP4</button></header><div class="cf-studio-workspace"><aside class="cf-studio-tools"><b>PROYECTO</b><div class="cf-studio-source">Vídeo original<br><small>Fuente local vinculada</small></div><nav><button data-tool="media">Medios</button><button data-tool="audio">♫ Añadir audio</button><button data-tool="text">T Añadir texto</button><button data-tool="subtitles">CC Subtítulos</button><button data-tool="effects">✧ Efectos</button><button data-tool="transitions">Transiciones</button><button data-addtrack="video">+ Pista vídeo</button><button data-addtrack="audio">+ Pista audio</button></nav><label class="cf-studio-import">Importar audio / música<input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"></label><button data-action="addtext">+ Crear texto</button><div class="cf-studio-media-list"></div></aside><section class="cf-studio-monitor"><div class="cf-studio-preview"><div class="cf-studio-overlay"></div></div><div class="cf-studio-transport"><button data-action="play">▶</button><button data-action="pause">Ⅱ</button><span data-clock>00:00.00</span><span>Previsualización sincronizada</span></div></section><aside class="cf-studio-inspector"></aside></div><div class="cf-studio-timeline-host"></div><section class="cf-studio-media-dialog" data-media-dialog hidden role="dialog" aria-modal="true" aria-label="Medios del proyecto"><div class="cf-studio-media-dialog-card"><header><b>Medios del proyecto</b><button data-action="media-close" aria-label="Cerrar">✕</button></header><p>Vídeo original y archivos de audio importados. Los archivos permanecen en este navegador.</p><div class="cf-studio-media-library"></div><footer><button data-action="relink">Vincular otro vídeo</button><button data-action="media-import-audio">Importar música / sonido</button></footer></div></section><div class="cf-studio-status" role="status">Listo para editar</div>';
 return shell;
}
export function closeStudio(){
 const active=window.__cfStudioActive;if(!active)return;
 clearTimeout(saveTimer);active.cleanup.forEach(fn=>{try{fn?.();}catch{}});
 for(const entry of previewAudio.values()){entry.el.pause();entry.el.removeAttribute("src");}
 previewAudio.clear();
 for(const url of assetUrls.values())URL.revokeObjectURL(url);
 assetUrls.clear();assetBlobs.clear();audioBuffers.clear();
 active.root.replaceChildren();window.__cfStudioActive=null;
}
export async function openStudio({card,clip,transcript,index=0,allClips=null,onBack,onSave,onExport}){
 closeStudio();
 const root=document.querySelector(".cf-opus-editor-slot");if(!root)return;
 const videoItems=Array.isArray(allClips)&&allClips.length?allClips:[clip];
 const video=document.createElement("video"),source=card?.querySelector("video");
 const file=document.querySelector("#video")?.files?.[0];
 if(source){video.src=source.currentSrc||source.src;video.preload="auto";video.playsInline=true;video.controls=true;video.className="cf-studio-video";}
 const duration=Math.max(Number(clip.end)||0,...videoItems.map(x=>Number(x.end)||0),...(transcript?.segments||[]).map(x=>Number(x.end)||0));
 const tracks=Array.isArray(window.clipforgeEditorBridge?.getProject?.().tracks)&&window.clipforgeEditorBridge.getProject().tracks.length?clone(window.clipforgeEditorBridge.getProject().tracks):createTracks(videoItems,transcript,duration);
 const projectId="clipforge-"+(file?.name||"video").replace(/[^a-z0-9]+/gi,"-").toLowerCase()+"-"+(file?.lastModified||Date.now());
 studioStore.load({schema:"clipforge-studio-v2",revision:0,duration,fps:30,profile:{width:1080,height:1920,aspect:"9:16"},source:{name:file?.name||"Vídeo original",size:file?.size||0,lastModified:file?.lastModified||0},projectId,clips:clone(videoItems),tracks,transcript:clone(transcript||null),selected:null,playhead:Number(clip.start)||0,zoom:1,activeClipIndex:Number(index)||0});
 const shell=makeEditorShell();root.replaceChildren(shell);
 const viewer=shell.querySelector(".cf-studio-preview"),overlay=shell.querySelector(".cf-studio-overlay");if(video.src)viewer.prepend(video);
 const initialVideoItem=currentVideoItem();
 if(video.src){
  const firstSourceTime=Number(initialVideoItem?.sourceStart??clip.start)||0;
  video.addEventListener("loadedmetadata",()=>{try{video.currentTime=firstSourceTime;}catch{};window.__cfStudioSeek?.(state.playhead);},{once:true});
  try{video.currentTime=firstSourceTime;}catch{}
 }
 window.__cfStudioSeek=time=>{
  const item=currentVideoItem();if(!item||!video.src)return;
  const wanted=Number(item.sourceStart??item.start)+(Number(time)-Number(item.start));
  try{if(Math.abs(video.currentTime-wanted)>.08)video.currentTime=Math.max(0,wanted);}catch{}
 };
 const detachOverlay=syncPreviewVideo(video,overlay);
 const detachAudio=syncExternalAudio(video);
 const timelineCleanup=mountTimeline(shell.querySelector(".cf-studio-timeline-host"));
 const inspectorCleanup=mountInspector(shell.querySelector(".cf-studio-inspector"));
 const clock=()=>{const el=shell.querySelector("[data-clock]");if(el)el.textContent=(video.currentTime||0).toFixed(2)+" s";};
 video.addEventListener("timeupdate",clock);
 const fileInput=shell.querySelector(".cf-studio-import input");
 fileInput.addEventListener("change",async()=>{
  const audioFile=fileInput.files?.[0];if(!audioFile)return;
  try{
   const asset=await addAudioAsset(audioFile);
   let track=state.tracks.find(t=>t.type==="audio"&&t.id!=="track-a1");
   if(!track){const id=studioCommands.addTrack("audio","A2 · Música");track=state.tracks.find(t=>t.id===id);}
   studioCommands.addItem(track.id,{type:"audio",assetId:asset.id,assetName:asset.name,start:state.playhead,end:Math.min(state.duration,state.playhead+asset.duration),sourceStart:0,volume:1,fadeIn:0,fadeOut:0,text:asset.name});
   const row=document.createElement("div");row.className="cf-studio-media-item";row.textContent="♫ "+asset.name;shell.querySelector(".cf-studio-media-list").append(row);
   setStatus("Audio añadido a la pista. Ya está disponible para previsualización y exportación.");
  }catch(error){setStatus("No se pudo importar el audio: "+error.message);}
  finally{fileInput.value="";}
 });
 shell.addEventListener("click",async e=>{
  const action=e.target.closest("[data-action]")?.dataset.action;
  try{
   if(action==="back"){await saveProject(false).catch(()=>{});closeStudio();onBack?.();}
   if(action==="undo")studioStore.undo();if(action==="redo")studioStore.redo();
   if(action==="play"){if(video.src)await video.play().catch(()=>{});}
   if(action==="pause")video.pause();
   if(action==="relink")sourceInput.click();
   if(action==="save"){const project=await saveProject(true);onSave?.(project);setStatus("Proyecto guardado localmente. La copia JSON también está descargada.");}
   if(action==="export"){await saveProject(false);onExport?.(studioStore.getState());}
   if(action==="addtext"){const id=state.tracks.find(t=>t.type==="text")?.id||studioCommands.addTrack("text","T1 · Textos y títulos");studioCommands.addItem(id,{type:"text",text:"Nuevo título",start:state.playhead,end:Math.min(state.duration,state.playhead+4),fontSize:36,color:"#ffffff",x:50,y:22});}
   if(action==="open"){
    const projects=await loadProjectList();if(!projects.length){setStatus("Todavía no hay proyectos guardados.");return;}
    const choice=window.prompt("Proyectos guardados:\n"+projects.map((p,i)=>(i+1)+". "+p.name+" · "+new Date(p.updatedAt).toLocaleString()).join("\n")+"\n\nEscribe el número del proyecto que quieres abrir:");
    const n=Number(choice)-1;if(!Number.isInteger(n)||n<0||n>=projects.length)return;
    await restoreProject(projects[n].id);
    const savedVideo=state.tracks.find(t=>t.type==="video")?.items?.[0];
    if(savedVideo){state.activeClipIndex=Number(savedVideo.clipIndex)||0;window.__cfStudioSeek?.(state.playhead);}
    setStatus("Proyecto recuperado. Si el original no está cargado, vuelve a vincularlo.");
   }
  }catch(error){setStatus("No se pudo completar la acción: "+error.message);}
  const tool=e.target.closest("[data-tool]")?.dataset.tool;
  if(tool==="media"){
   const dialog=shell.querySelector("[data-media-dialog]");dialog.hidden=false;
   const library=shell.querySelector(".cf-studio-media-library");library.replaceChildren();
   const sourceRow=document.createElement("div");sourceRow.className="cf-studio-media-row";
   sourceRow.innerHTML="<b>Vídeo original</b><span>"+escapeHtml(state.source?.name||"Vídeo no vinculado")+"</span>";
   library.append(sourceRow);
   try{
    for(const asset of await all("assets")){
     const row=document.createElement("div");row.className="cf-studio-media-row";
     const name=document.createElement("b");name.textContent=asset.name;
     const meta=document.createElement("span");meta.textContent=(Number(asset.size||0)/1024/1024).toFixed(1)+" MB · audio local";
     row.append(name,meta);library.append(row);
    }
   }catch(error){setStatus("No se pudo leer la biblioteca local: "+error.message);}
   if(!library.children.length)library.textContent="Todavía no has importado archivos adicionales.";
  }
  if(tool==="audio")fileInput.click();
  if(tool==="text")shell.querySelector('[data-action="addtext"]').click();
  if(tool==="subtitles"){const t=state.tracks.find(x=>x.type==="subtitles");if(t?.items[0])studioCommands.select(t.items[0].id);else setStatus("Todavía no hay subtítulos temporizados en este proyecto.");}
  if(tool==="effects"||tool==="transitions"){const item=currentVideoItem();if(item)studioCommands.select(item.id);setStatus(tool==="effects"?"Selecciona un clip en el inspector para ajustar los filtros.":"Selecciona un clip para ajustar sus transiciones.");}
  const add=e.target.closest("[data-addtrack]")?.dataset.addtrack;if(add)studioCommands.addTrack(add,add==="audio"?"Nueva pista de audio":"Nueva pista de vídeo");
 });
 const off=studioStore.subscribe(s=>{const el=shell.querySelector(".cf-studio-project-name");if(el)el.textContent=s.source?.name||"Proyecto editable";});
 const sourceInput=shell.querySelector("[data-source-input]");
 let linkedSourceUrl=null;
 sourceInput.addEventListener("change",()=>{
  const replacement=sourceInput.files?.[0];if(!replacement)return;
  const url=URL.createObjectURL(replacement);if(linkedSourceUrl)URL.revokeObjectURL(linkedSourceUrl);linkedSourceUrl=url;video.pause();video.src=url;video.load();
  state.source={name:replacement.name,size:replacement.size,lastModified:replacement.lastModified};
  video.addEventListener("loadedmetadata",()=>window.__cfStudioSeek?.(state.playhead),{once:true});
  setStatus("Vídeo original vinculado. Comprueba el encuadre antes de exportar.");
  saveProject(false).catch(e=>setStatus("No se pudo guardar el vínculo del vídeo: "+e.message));
 });
 // Keep the canonical project in the existing project bridge without rebuilding the result cards.
 const bridgeSync=studioStore.subscribe(s=>{
  if(window.clipforgeEditorBridge?.setTracks)window.clipforgeEditorBridge.setTracks(s.tracks);
  if(Array.isArray(window.__cfEditableCandidates))s.clips.forEach((c,i)=>{if(window.__cfEditableCandidates[i])Object.assign(window.__cfEditableCandidates[i],c);});
 });
 window.__cfStudioActive={root:shell,cleanup:[timelineCleanup,inspectorCleanup,detachOverlay,detachAudio,()=>{video.pause();video.removeAttribute("src");video.load();if(linkedSourceUrl)URL.revokeObjectURL(linkedSourceUrl);},()=>off(),()=>bridgeSync(),()=>video.removeEventListener("timeupdate",clock),()=>{delete window.__cfStudioSeek;}]};
 await saveProject(false).catch(e=>setStatus("El guardado automático local no está disponible: "+e.message));
 return shell;
}
window.ClipForgeStudio={open:openStudio,close:closeStudio,getProject:()=>studioStore.getState(),getAssetBlob,getAssetUrl,save:()=>saveProject(false),restoreProject};
