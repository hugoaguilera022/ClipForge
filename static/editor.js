const statusEl = document.querySelector('#editorStatus');
const timelineEl = document.querySelector('#editorTimeline');
const projectSelect = document.querySelector('#savedProjectList');
const say = message => { if (statusEl) statusEl.textContent = message; };
const previewVideo=document.querySelector('#editorPreviewVideo');
let previewObjectUrl=null,previewSourceKey='',previewEnd=null;
function syncPreviewSource(){
  const file=document.querySelector('#video')?.files?.[0];
  if(!file||!previewVideo)return false;
  const key=`${file.name}:${file.size}:${file.lastModified}`;
  if(key!==previewSourceKey){
    if(previewObjectUrl)URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl=URL.createObjectURL(file);previewSourceKey=key;
    previewVideo.src=previewObjectUrl;previewVideo.load();
  }
  return true;
}
function previewClip(clip){
  if(!syncPreviewSource()){say('Selecciona primero el vídeo original para previsualizar este corte.');return;}
  const start=Number(clip.start),end=Number(clip.end);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start){say('El intervalo de este clip no es válido.');return;}
  previewEnd=end;
  const seek=()=>{let started=false;const play=()=>{if(started)return;started=true;previewVideo.play().catch(()=>say('Pulsa reproducir en el visor para iniciar la vista previa.'));};previewVideo.addEventListener('seeked',play,{once:true});previewVideo.currentTime=start;if(Math.abs(previewVideo.currentTime-start)<.01&&previewVideo.readyState>=2)play();};
  if(previewVideo.readyState>=1)seek();else previewVideo.addEventListener('loadedmetadata',seek,{once:true});
  say(`Previsualizando ${start.toFixed(2)}–${end.toFixed(2)} s del vídeo original.`);
}
window.clipforgeEditorBridge&&(window.clipforgeEditorBridge.previewClip=previewClip);
previewVideo?.addEventListener('timeupdate',()=>{if(previewEnd!==null&&previewVideo.currentTime>=previewEnd){previewVideo.pause();previewVideo.currentTime=previewEnd;previewEnd=null;}});
document.querySelector('#video')?.addEventListener('change',()=>{previewEnd=null;syncPreviewSource();});
let tracks = [];
let activeProjectId = null;
let clips = [];
let transcript = null;
let source = '';
const undoStack = []; const redoStack = []; const HISTORY_LIMIT = 80;
function snapshot(){ return JSON.stringify({tracks,clips,transcript,source}); }
function remember(){ const current=snapshot(); if(undoStack.at(-1)!==current) undoStack.push(current); if(undoStack.length>HISTORY_LIMIT) undoStack.shift(); redoStack.length=0; updateHistoryButtons(); }
function restore(raw){ const state=JSON.parse(raw); tracks=state.tracks||[]; clips=state.clips||[]; transcript=state.transcript||null; source=state.source||''; window.clipforgeEditorBridge?.setClips(clips); if(transcript)window.clipforgeEditorBridge?.setTranscript(transcript); window.clipforgeEditorBridge?.setTracks(tracks); render(); updateHistoryButtons(); }
function updateHistoryButtons(){ const u=document.querySelector('#editorUndo'),r=document.querySelector('#editorRedo'); if(u)u.disabled=!undoStack.length; if(r)r.disabled=!redoStack.length; }
function undo(){ if(!undoStack.length)return; redoStack.push(snapshot()); restore(undoStack.pop()); say('Último cambio deshecho.'); }
function redo(){ if(!redoStack.length)return; undoStack.push(snapshot()); restore(redoStack.pop()); say('Cambio restaurado.'); }

const TYPES = {
  video: 'Vídeo',
  audio: 'Audio',
  subtitles: 'Subtítulos',
  text: 'Texto',
  image: 'Imagen'
};

const PROJECT_DB='clipforge-browser-projects';
function openProjectDB(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)){reject(new Error('IndexedDB no está disponible en este navegador.'));return;}
    const request=indexedDB.open(PROJECT_DB,1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('projects'))request.result.createObjectStore('projects',{keyPath:'id'});};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('No se pudo abrir el almacenamiento local.'));
  });
}
async function localProject(action,project){
  const db=await openProjectDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('projects',action==='list'?'readonly':'readwrite');
    const store=tx.objectStore('projects');
    let request;
    if(action==='list')request=store.getAll();
    else if(action==='get')request=store.get(project);
    else request=store.put(project);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('Error de almacenamiento local.'));
    tx.oncomplete=()=>db.close();
    tx.onerror=()=>{db.close();reject(tx.error||new Error('No se pudo completar el guardado.'));};
  });
}
function bridgeProject() {
  const bridge = window.clipforgeEditorBridge;
  if (bridge?.getProject) {
    const p = bridge.getProject();
    clips = p.clips || [];
    transcript = p.transcript || null;
    source = p.source || '';
  }
}
function makeDefaultTracks() {
  const subtitleItems = (transcript?.segments || []).map((s, i) => ({
    id: `subtitle-${i+1}`, start:Number(s.start), end:Number(s.end), text:String(s.text || '')
  })).filter(x => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start);
  return [
    {id:'track-video-1', type:'video', name:'Clips de vídeo', items:clips.map(c=>({id:c.id,start:c.start,end:c.end,text:c.title || c.text || 'Clip'}))},
    {id:'track-subtitles-1', type:'subtitles', name:'Subtítulos', items:subtitleItems},
    {id:'track-text-1', type:'text', name:'Textos y títulos', items:[]}
  ];
}
function render() {
  if (!timelineEl) return;
  timelineEl.replaceChildren();
  if (!tracks.length) tracks = makeDefaultTracks();
  window.clipforgeEditorBridge?.setTracks(tracks);
  tracks.forEach((track, trackIndex) => {
    const section = document.createElement('section'); section.className='editor-track';
    const head = document.createElement('div'); head.className='editor-track-head';
    const title = document.createElement('strong'); title.textContent = `${TYPES[track.type] || track.type} · ${track.name || `Pista ${trackIndex+1}`}`;
    const count = document.createElement('small'); count.className='muted'; count.textContent=`${track.items.length} elementos`;
    const actions=document.createElement('div'); actions.className='editor-track-actions';
    if(track.type==='text'){
      const add=document.createElement('button'); add.type='button'; add.className='secondary'; add.textContent='Añadir texto';
      add.addEventListener('click',()=>{remember();track.items.push({id:`text-${crypto.randomUUID()}`,start:0,end:5,text:'Nuevo título'});render();say('Capa de texto añadida. Ajusta su intervalo y contenido.');});
      actions.append(add);
    }
    const removeTrack=document.createElement('button');removeTrack.type='button';removeTrack.className='secondary';removeTrack.textContent='Eliminar pista';
    removeTrack.addEventListener('click',()=>{remember();tracks=tracks.filter(t=>t.id!==track.id);window.clipforgeEditorBridge?.setTracks(tracks);render();say('Pista eliminada.');});
    actions.append(removeTrack);head.append(title,count,actions); section.append(head);
    const visual=document.createElement('div');visual.className='editor-timeline-lane';visual.setAttribute('role','group');visual.setAttribute('aria-label',`Línea de tiempo: ${track.name||track.type}`);
    const extent=Math.max(1,...tracks.flatMap(t=>(t.items||[]).map(x=>Number(x.end)||0)),...clips.map(c=>Number(c.end)||0));
    const ruler=document.createElement('div');ruler.className='editor-time-ruler';
    for(let tick=0;tick<=4;tick++){const mark=document.createElement('span');mark.textContent=`${(extent*tick/4).toFixed(1)}s`;mark.style.left=`${tick*25}%`;ruler.append(mark);}
    visual.append(ruler);
    const rail=document.createElement('div');rail.className='editor-track-rail';
    (track.items||[]).forEach((item,index)=>{
      const a=Math.max(0,Number(item.start)||0),b=Math.max(a+.05,Number(item.end)||a+.05);
      const block=document.createElement('button');block.type='button';block.className=`editor-timeline-block ${track.type==='subtitles'?'subtitle':track.type==='text'?'text-layer':track.type}`;
      block.style.left=`${Math.min(99.5,a/extent*100)}%`;block.style.width=`${Math.max(1.2,Math.min(100-a/extent*100,(b-a)/extent*100))}%`;
      block.textContent=String(item.text||item.title||`Elemento ${index+1}`).slice(0,46);block.title=`${a.toFixed(2)}–${b.toFixed(2)} s · ${block.text}`;
      block.addEventListener('click',()=>previewClip(item));rail.append(block);
    });
    visual.append(rail);section.append(visual);
    const items = document.createElement('div'); items.className='editor-track-items';
    if (!track.items.length) {
      const empty = document.createElement('div'); empty.className='editor-empty muted'; empty.textContent='Pista vacía. Puedes añadir elementos desde los clips o transcripción.'; items.append(empty);
    }
    track.items.forEach((item,itemIndex) => {
      const row = document.createElement('div'); row.className='editor-clip';
      const start = document.createElement('input'); start.type='number'; start.min='0'; start.step='.01'; start.value=Number(item.start).toFixed(2); start.setAttribute('aria-label','Inicio del elemento');
      const end = document.createElement('input'); end.type='number'; end.min='0'; end.step='.01'; end.value=Number(item.end).toFixed(2); end.setAttribute('aria-label','Final del elemento');
      const text = document.createElement('input'); text.type='text'; text.value=String(item.text || ''); text.setAttribute('aria-label','Contenido del elemento');
      let previewButton=null;if(track.type==='video'){previewButton=document.createElement('button');previewButton.type='button';previewButton.className='secondary preview-clip';previewButton.textContent='Vista previa';previewButton.addEventListener('click',()=>previewClip(item));}
      const apply = document.createElement('button'); apply.type='button'; apply.className='secondary'; apply.textContent='Aplicar';
      apply.addEventListener('click',()=>{
        const a=Number(start.value), b=Number(end.value);
        if (!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<=a) { say('Intervalo inválido: el final debe ser posterior al inicio.'); return; }
        remember(); Object.assign(item,{start:a,end:b,text:text.value});
        if (track.type==='video') {
          const clip=clips.find(c=>String(c.id)===String(item.id));
          if (clip) Object.assign(clip,{start:a,end:b,text:text.value});
          window.clipforgeEditorBridge?.setClips(clips);
        } else if (track.type==='subtitles') {
          const match=String(item.id).match(/^subtitle-(\d+)$/);
          const segment=match ? transcript?.segments?.[Number(match[1])-1] : null;
          if (segment) {
            Object.assign(segment,{start:a,end:b,text:text.value});
            window.clipforgeEditorBridge?.setTranscript(transcript);
          }
        }
        window.clipforgeEditorBridge?.setTracks(tracks);
        say('Cambios aplicados a la línea de tiempo. Guarda el proyecto para conservarlos.');
        render();
      });
      const remove=document.createElement('button');remove.type='button';remove.className='secondary';remove.textContent='Quitar';
      remove.addEventListener('click',()=>{remember();track.items=track.items.filter(x=>x!==item);window.clipforgeEditorBridge?.setTracks(tracks);render();say('Elemento eliminado de la pista.');});
      row.append(start,end,text);if(previewButton)row.append(previewButton);row.append(apply,remove);items.append(row);
    });
    section.append(items); timelineEl.append(section);
  });
}
async function refreshProjects() {
  if(!projectSelect)return;
  projectSelect.replaceChildren(new Option('Nuevo proyecto',''));
  try{
    if(document.body.dataset.browserOnly==='true')throw new Error('Modo navegador');
    const r=await fetch('/api/projects');
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const data=await r.json();
    (data.projects||[]).forEach(p=>projectSelect.add(new Option(`${p.source||'Proyecto'} · ${p.clip_count} clips`,p.id)));
    projectSelect.dataset.storage='server';
  }catch(serverError){
    try{
      const projects=await localProject('list');
      projects.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
      projects.forEach(p=>projectSelect.add(new Option(`${p.source||'Proyecto'} · ${(p.clips||[]).length} clips (navegador)`,p.id)));
      projectSelect.dataset.storage='browser';
      say('Proyectos guardados en este navegador. No se necesita servidor.');
    }catch(localError){say(`No se pudo cargar el historial: ${localError.message}`);}
  }
}
document.querySelector('#editorUndo')?.addEventListener('click',undo);
document.querySelector('#editorRedo')?.addEventListener('click',redo);
document.addEventListener('keydown',ev=>{ if((ev.metaKey||ev.ctrlKey)&&ev.key.toLowerCase()==='z'){ev.preventDefault(); ev.shiftKey?redo():undo();} });
document.querySelector('#addEditorTrack')?.addEventListener('click',()=>{
  remember(); const type=document.querySelector('#editorTrackType')?.value || 'video';
  tracks.push({id:`track-${crypto.randomUUID()}`,type,name:`${TYPES[type]} ${tracks.filter(t=>t.type===type).length+1}`,items:[]});
  render(); say(`Pista ${TYPES[type]} añadida.`);
});
document.querySelector('#saveSavedProject')?.addEventListener('click',async()=>{
  bridgeProject();
  if(!clips.length&&!transcript&&!tracks.length){say('No hay contenido que guardar todavía.');return;}
  const id=activeProjectId||('browser-'+crypto.randomUUID());
  const project={id,schema:'clipforge-project-v2',source,transcript,clips,tracks,updatedAt:Date.now()};
  try{
    let savedRemotely=false;
    try{
      if(document.body.dataset.browserOnly==='true')throw new Error('Modo navegador');
      const r=await fetch('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:activeProjectId||undefined,...project})});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const data=await r.json();activeProjectId=data.id;savedRemotely=true;
    }catch(_serverUnavailable){
      await localProject('put',project);activeProjectId=id;
    }
    await refreshProjects();projectSelect.value=activeProjectId;
    say(savedRemotely?'Proyecto guardado en el servidor.':'Proyecto guardado en este navegador (IndexedDB); no necesita servidor.');
  }catch(e){say(`Error al guardar el proyecto: ${e.message}`);}
});
document.querySelector('#loadSavedProject')?.addEventListener('click',async()=>{
  const id=projectSelect?.value;
  if(!id){say('Selecciona un proyecto guardado.');return;}
  try{
    let project;
    try{
      if(document.body.dataset.browserOnly==='true')throw new Error('Modo navegador');
      const r=await fetch(`/api/projects/${encodeURIComponent(id)}`);
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      project=await r.json();
    }catch(_serverUnavailable){project=await localProject('get',id);}
    if(!project)throw new Error('El proyecto no existe en este navegador.');
    activeProjectId=id;undoStack.length=0;redoStack.length=0;clips=project.clips||[];tracks=project.tracks||[];
    transcript=project.transcript||null;source=project.source||'';
    window.clipforgeEditorBridge?.setClips(clips);
    if (transcript) window.clipforgeEditorBridge?.setTranscript(transcript);
    window.clipforgeEditorBridge?.setTracks(tracks);
    render();updateHistoryButtons();say(`Proyecto ${id} abierto. ${clips.length} clips y ${tracks.length} pistas recuperados.`);
  }catch(e){say(`No se pudo abrir el proyecto: ${e.message}`);}
});
window.addEventListener('clipforge:editor-ready',()=>{
  bridgeProject(); if(clips.length){tracks=makeDefaultTracks();window.clipforgeEditorBridge?.setTracks(tracks);render();say(`${clips.length} clips disponibles para editar.`);}
});
document.querySelector('#browserTranscribe')?.addEventListener('click',()=>{});
if(window.clipforgeModeReady)refreshProjects();else window.addEventListener('clipforge:mode-ready',refreshProjects,{once:true});
updateHistoryButtons();

window.addEventListener('clipforge:clips-updated',()=>{
  bridgeProject();
  if (!tracks.length) tracks=makeDefaultTracks();
  window.clipforgeEditorBridge?.setTracks(tracks);
  const videoTrack=tracks.find(track=>track.type==='video');
  if (videoTrack) videoTrack.items=clips.map(c=>({id:c.id,start:c.start,end:c.end,text:c.title || c.text || 'Clip'}));
  render();
  say(`${clips.length} clips sincronizados con el editor.`);
});

window.addEventListener('clipforge:candidate-edited',()=>{
  bridgeProject();
  const videoTrack=tracks.find(track=>track.type==='video');
  if(videoTrack)videoTrack.items=clips.map(c=>({id:c.id,start:c.start,end:c.end,text:c.title||c.text||'Clip'}));
  render();
});
