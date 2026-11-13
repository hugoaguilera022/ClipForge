/* ClipForge Studio state and timeline core. */
const clone = value => structuredClone(value);
const listeners = new Set();
const LIMIT = 100;
let state = {schema:"clipforge-studio-v1",revision:0,duration:0,fps:30,profile:{width:1080,height:1920,aspect:"9:16"},source:null,clips:[],tracks:[],transcript:null,selected:null,playhead:0,zoom:1};
let undoStack=[],redoStack=[];
function emit(reason){state.revision++;for(const fn of listeners)fn(clone(state),reason);window.dispatchEvent(new CustomEvent("clipforge:studio-state",{detail:{state:clone(state),reason}}));}
export const studioStore={
 getState:()=>clone(state),
 subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
 load(project){undoStack=[];redoStack=[];state={...clone(project),schema:"clipforge-studio-v1"};emit("load");},
 transact(label,fn){undoStack.push({label,state:clone(state)});if(undoStack.length>LIMIT)undoStack.shift();redoStack=[];fn(state);emit(label);},
 undo(){if(!undoStack.length)return false;redoStack.push(clone(state));const old=undoStack.pop();state=old.state;emit("undo:"+old.label);return true;},
 redo(){if(!redoStack.length)return false;undoStack.push(clone(state));state=redoStack.pop();emit("redo");return true;}
};
const uid=()=>crypto.randomUUID?.()||"cf-"+Date.now()+"-"+Math.random().toString(36).slice(2);
function locate(id){for(const track of state.tracks){const item=track.items.find(x=>x.id===id);if(item)return {track,item};}return null;}
export const studioCommands={
 addTrack(type,name){const id=uid();this._run("Añadir pista",()=>state.tracks.push({id,type,name:name||type,locked:false,muted:false,hidden:false,items:[]}));return id;},
 _run(label,fn){studioStore.transact(label,fn);},
 select(id){this._run("Seleccionar",()=>state.selected=id);},
 playhead(time){this._run("Cabezal",()=>state.playhead=Math.max(0,Math.min(state.duration,Number(time)||0)));},
 zoom(value){this._run("Zoom",()=>state.zoom=Math.max(.25,Math.min(8,Number(value)||1)));},
 setTrack(id,key,value){this._run("Pista",()=>{const t=state.tracks.find(x=>x.id===id);if(t&&["locked","muted","hidden","name"].includes(key))t[key]=value;});},
 addItem(trackId,item){const id=item.id||uid();this._run("Añadir elemento",()=>{const t=state.tracks.find(x=>x.id===trackId);if(!t||t.locked)throw Error("Pista bloqueada");t.items.push({...item,id,start:Number(item.start)||0,end:Number(item.end)||0});});return id;},
 patch(id,patch){this._run("Editar elemento",()=>{const f=locate(id);if(!f||f.track.locked)throw Error("Elemento bloqueado");Object.assign(f.item,patch);});},
 remove(id){this._run("Eliminar",()=>{for(const t of state.tracks)t.items=t.items.filter(x=>x.id!==id);state.clips=state.clips.filter(x=>x.id!==id);});},
 duplicate(id){let next;this._run("Duplicar",()=>{const f=locate(id);if(!f||f.track.locked)throw Error("Elemento bloqueado");next={...f.item,id:uid(),start:f.item.start+.1,end:f.item.end+.1};f.track.items.push(next);});return next.id;},
 move(id,toTrack,start){this._run("Mover",()=>{const f=locate(id),to=state.tracks.find(x=>x.id===toTrack);if(!f||f.track.locked||!to||to.locked)throw Error("No se puede mover");const d=f.item.end-f.item.start;const next={...f.item,start:Math.max(0,start),end:Math.max(0,start)+d};f.track.items=f.track.items.filter(x=>x.id!==id);to.items.push(next);});},
 split(id,time){let right;this._run("Dividir",()=>{const f=locate(id),t=Number(time);if(!f||f.track.locked||t<=f.item.start+.03||t>=f.item.end-.03)throw Error("Coloca el cabezal dentro del elemento");right={...f.item,id:uid(),start:t,sourceStart:(Number(f.item.sourceStart)||0)+(t-f.item.start)};f.item.end=t;f.track.items.push(right);});return right.id;}
};
function makeTracks(clip,transcript){
 const prefix=String(clip.id||uid());
 const captions=(transcript?.segments||[]).filter(x=>Number(x.end)>Number(clip.start)&&Number(x.start)<Number(clip.end)).map((x,i)=>({id:prefix+"-s"+i,type:"subtitle",start:Math.max(Number(clip.start),Number(x.start)),end:Math.min(Number(clip.end),Number(x.end)),text:x.text}));
 return [
  {id:prefix+"-v1",type:"video",name:"V1 · Vídeo principal",items:[{...clip,id:prefix+"-video",type:"video",sourceStart:Number(clip.start),volume:1}]},
  {id:prefix+"-a1",type:"audio",name:"A1 · Audio original",items:[{id:prefix+"-audio-original",type:"audio",source:"source-audio",start:clip.start,end:clip.end,volume:.8}]},
  {id:prefix+"-a2",type:"audio",name:"A2 · Música",items:[]},
  {id:prefix+"-a3",type:"audio",name:"A3 · Efectos sonoros",items:[]},
  {id:prefix+"-s1",type:"subtitles",name:"S1 · Subtítulos",items:captions},
  {id:prefix+"-t1",type:"text",name:"T1 · Textos y títulos",items:[]},
  {id:prefix+"-fx",type:"effects",name:"FX · Efectos",items:[]}
 ];
}
function mountTimeline(root){
 const panel=document.createElement("section");panel.className="cf-studio-timeline";
 panel.innerHTML='<div class="cf-studio-timeline-head"><b>Línea de tiempo</b><div class="cf-studio-actions"><button data-cmd="undo">↶</button><button data-cmd="redo">↷</button><button data-cmd="split">✂ Dividir</button><button data-cmd="duplicate">Duplicar</button><button data-cmd="delete">⌫ Eliminar</button><button data-cmd="zoomout">−</button><input data-zoom type="range" min=".25" max="8" step=".25" value="1"><button data-cmd="zoomin">+</button></div></div><div class="cf-studio-ruler"></div><div class="cf-studio-track-list"></div><div class="cf-studio-timeline-note" role="status">Selecciona un bloque para editarlo.</div>';
 root.append(panel);
 const ruler=panel.querySelector(".cf-studio-ruler"),list=panel.querySelector(".cf-studio-track-list"),note=panel.querySelector(".cf-studio-timeline-note");
 const scale=()=>38*studioStore.getState().zoom;
 const render=s=>{
  panel.style.setProperty("--scale",scale()+"px");
  const duration=Math.max(10,s.duration||10),width=duration*scale();
  ruler.style.width=width+"px";ruler.replaceChildren();
  const step=s.zoom>=3?1:s.zoom>=1?2:5;
  for(let t=0;t<=duration;t+=step){const m=document.createElement("span");m.style.left=(t*scale())+"px";m.textContent=t+"s";ruler.append(m);}
  list.replaceChildren();
  for(const track of s.tracks){
   const row=document.createElement("div");row.className="cf-studio-track-row";
   const label=document.createElement("div");label.className="cf-studio-track-label";
   const name=document.createElement("b");name.textContent=track.name;
   const lock=document.createElement("button");lock.textContent=track.locked?"🔒":"🔓";lock.title="Bloquear pista";lock.onclick=()=>studioCommands.setTrack(track.id,"locked",!track.locked);
   const mute=document.createElement("button");mute.textContent=track.muted?"🔇":"🔊";mute.title="Silenciar pista";mute.onclick=()=>studioCommands.setTrack(track.id,"muted",!track.muted);
   label.append(name,lock,mute);
   const lane=document.createElement("div");lane.className="cf-studio-lane";lane.style.width=width+"px";
   for(const item of track.items){
    const block=document.createElement("button");block.className="cf-studio-block"+(s.selected===item.id?" selected":"");block.textContent=item.text||item.title||track.type;block.style.left=item.start*scale()+"px";block.style.width=Math.max(12,(item.end-item.start)*scale())+"px";block.title=item.start.toFixed(2)+"–"+item.end.toFixed(2)+" s";
    block.onclick=()=>studioCommands.select(item.id);
    block.addEventListener("pointerdown",ev=>{if(track.locked)return;const x=ev.clientX,initial=item.start;block.setPointerCapture?.(ev.pointerId);const move=e=>block.style.left=Math.max(0,(initial+(e.clientX-x)/scale())*scale())+"px";const stop=e=>{block.removeEventListener("pointermove",move);block.removeEventListener("pointerup",stop);studioCommands.move(item.id,track.id,Math.max(0,initial+(e.clientX-x)/scale()));};block.addEventListener("pointermove",move);block.addEventListener("pointerup",stop,{once:true});});
    lane.append(block);
   }
   const head=document.createElement("i");head.className="cf-studio-head";head.style.left=s.playhead*scale()+"px";lane.append(head);
   lane.addEventListener("dblclick",ev=>{const rect=lane.getBoundingClientRect();studioCommands.playhead(Math.max(0,(ev.clientX-rect.left)/scale()));});
   row.append(label,lane);list.append(row);
  }
 };
 const off=studioStore.subscribe(render);render(studioStore.getState());
 panel.addEventListener("click",e=>{const c=e.target.closest("[data-cmd]")?.dataset.cmd;if(!c)return;const s=studioStore.getState(),id=s.selected,found=s.tracks.flatMap(t=>t.items).find(x=>x.id===id);try{if(c==="undo")studioStore.undo();if(c==="redo")studioStore.redo();if(c==="zoomin")studioCommands.zoom(s.zoom+.25);if(c==="zoomout")studioCommands.zoom(s.zoom-.25);if(c==="delete"&&id)studioCommands.remove(id);if(c==="duplicate"&&id)studioCommands.duplicate(id);if(c==="split"&&found)studioCommands.split(id,s.playhead);}catch(err){note.textContent=err.message;}});
 panel.querySelector("[data-zoom]").oninput=e=>studioCommands.zoom(e.target.value);
 return ()=>{off();panel.remove();};
}
function mountInspector(root){
 const draw=s=>{
  const selected=s.tracks.flatMap(t=>t.items).find(x=>x.id===s.selected);
  if(!selected){root.innerHTML='<div class="cf-studio-empty">Selecciona un elemento de la línea de tiempo para editar sus propiedades.</div>';return;}
  const escaped=String(selected.text||selected.title||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  root.innerHTML='<b>Propiedades</b><label>Texto / nombre<input data-field="text" value="'+escaped+'"></label><div class="cf-studio-fields"><label>Inicio<input data-field="start" type="number" min="0" step=".01" value="'+selected.start+'"></label><label>Final<input data-field="end" type="number" min="0" step=".01" value="'+selected.end+'"></label></div><label>Volumen<input data-field="volume" type="range" min="0" max="200" value="'+Math.round(Number(selected.volume??1)*100)+'"></label><label>Opacidad<input data-field="opacity" type="range" min="0" max="100" value="'+Math.round(Number(selected.opacity??1)*100)+'"></label><label>Velocidad<input data-field="speed" type="range" min="25" max="200" value="'+Math.round(Number(selected.speed??1)*100)+'"></label>';
 };
 const off=studioStore.subscribe(draw);draw(studioStore.getState());
 root.addEventListener("change",e=>{const field=e.target.dataset.field;if(!field)return;const s=studioStore.getState(),item=s.tracks.flatMap(t=>t.items).find(x=>x.id===s.selected);if(!item)return;let value=e.target.value;if(["start","end","volume","opacity","speed"].includes(field))value=Number(value);if(["volume","opacity","speed"].includes(field))value/=100;studioCommands.patch(item.id,{[field]:value});});
 return ()=>off();
}
export function closeStudio(){const active=window.__cfStudioActive;if(!active)return;active.cleanup.forEach(fn=>fn?.());active.root.replaceChildren();window.__cfStudioActive=null;}
export function openStudio({card,clip,transcript,onBack,onSave,onExport}){
 closeStudio();const root=document.querySelector(".cf-opus-editor-slot");if(!root)return;
 const tracks=makeTracks(clip,transcript);const duration=Math.max(Number(clip.end)||0,...tracks.flatMap(t=>t.items.map(x=>Number(x.end)||0)));
 studioStore.load({schema:"clipforge-studio-v1",revision:0,duration,fps:30,profile:{width:1080,height:1920,aspect:"9:16"},source:transcript?.source||null,clips:[clip],tracks,transcript,selected:null,playhead:Number(clip.start)||0,zoom:1});
 const shell=document.createElement("section");shell.className="cf-studio-shell";
 shell.innerHTML='<header class="cf-studio-topbar"><button data-action="back">← Todos los clips</button><strong>ClipForge Studio</strong><span>Proyecto editable · 9:16</span><button data-action="undo">↶ Deshacer</button><button data-action="redo">↷ Rehacer</button><button data-action="save">Guardar</button><button data-action="export">Exportar MP4</button></header><div class="cf-studio-workspace"><aside class="cf-studio-tools"><b>PROYECTO</b><div class="cf-studio-source">Vídeo original<br><small>Fuente local vinculada</small></div><nav><button data-add="audio">♫ Añadir música</button><button data-add="text">T Añadir texto</button><button data-add="effects">✧ Añadir efecto</button><button data-add="subtitles">CC Subtítulos</button></nav></aside><section class="cf-studio-monitor"><div class="cf-studio-preview"></div><div class="cf-studio-transport"><button data-action="play">▶</button><button data-action="pause">Ⅱ</button><span data-clock>00:00.00</span><span>Previsualización</span></div></section><aside class="cf-studio-inspector"></aside></div><div class="cf-studio-timeline-host"></div><div class="cf-studio-status" role="status">Listo para editar</div>';
 root.replaceChildren(shell);const video=document.createElement("video"),source=card.querySelector("video");if(source){video.src=source.currentSrc||source.src;video.controls=true;video.playsInline=true;video.preload="metadata";video.className="cf-studio-video";shell.querySelector(".cf-studio-preview").append(video);}
 const stopTimeline=mountTimeline(shell.querySelector(".cf-studio-timeline-host")),stopInspector=mountInspector(shell.querySelector(".cf-studio-inspector"));
 const clock=()=>{shell.querySelector("[data-clock]").textContent=(video.currentTime||0).toFixed(2)+" s";};video.addEventListener("timeupdate",clock);
 const off=studioStore.subscribe(s=>{if(Math.abs((video.currentTime||0)-s.playhead)>.2&&Number.isFinite(s.playhead))try{video.currentTime=s.playhead;}catch{}});
 shell.addEventListener("click",async e=>{
  const action=e.target.closest("[data-action]")?.dataset.action;
  if(action==="back"){closeStudio();onBack?.();}
  if(action==="undo")studioStore.undo();if(action==="redo")studioStore.redo();
  if(action==="play")await video.play().catch(()=>{});if(action==="pause")video.pause();
  if(action==="save"){onSave?.(studioStore.getState());shell.querySelector(".cf-studio-status").textContent="Proyecto guardado.";}
  if(action==="export"){onExport?.(studioStore.getState());}
  const add=e.target.closest("[data-add]")?.dataset.add;if(add){const track=studioStore.getState().tracks.find(t=>t.type===add)||{id:studioCommands.addTrack(add)};const s=studioStore.getState();studioCommands.addItem?.(track.id,{type:add,start:s.playhead,end:Math.min(s.duration,s.playhead+4),text:add==="audio"?"Nueva pista de audio":"Nuevo "+add});}
 });
 window.__cfStudioActive={root,cleanup:[stopTimeline,stopInspector,()=>off(),()=>video.removeEventListener("timeupdate",clock)]};
 return shell;
}
window.ClipForgeStudio={open:openStudio,close:closeStudio,getProject:()=>studioStore.getState()};
