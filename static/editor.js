/* ClipForge editor: one project state drives timeline, inspector, history and persistence. */
(() => {
  'use strict';
  const $ = (s, root=document) => root.querySelector(s);
  const statusEl = $('#editorStatus');
  const timelineEl = $('#editorTimeline');
  const projectSelect = $('#savedProjectList');
  const say = message => { if (statusEl) statusEl.textContent = message; };
  const TYPES = {video:'Vídeo',audio:'Audio',subtitles:'Subtítulos',text:'Texto',image:'Imagen'};
  const uid = prefix => prefix + '-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
  const clone = value => JSON.parse(JSON.stringify(value));
  const state = {schema:'clipforge-project-v2',source:'',transcript:null,clips:[],tracks:[],settings:{fps:30,width:1080,height:1920}};
  let activeProjectId = null, selected = null, playhead = 0, duration = 0, clipboard = null;
  let undoStack = [], redoStack = [], sourceUrl = null, previewVideo = null, previewAudio = null;
  const HISTORY_LIMIT = 100;
  function normalizeTrack(track) {
    return {id:String(track.id || uid('track')),type:TYPES[track.type]?track.type:'video',name:String(track.name || TYPES[track.type] || 'Pista'),locked:!!track.locked,muted:!!track.muted,hidden:!!track.hidden,items:Array.isArray(track.items)?track.items:[]};
  }
  function deriveDuration() {
    duration = Math.max(1, ...state.tracks.flatMap(t=>t.items.map(i=>Number(i.end)||0)), ...state.clips.map(c=>Number(c.end)||0));
    return duration;
  }
  function snapshot(){ return JSON.stringify({state,selected,playhead}); }
  function updateHistoryButtons(){
    const u=$('#editorUndo'),r=$('#editorRedo');
    if(u)u.disabled=!undoStack.length;
    if(r)r.disabled=!redoStack.length;
  }
  function remember(){
    const current=snapshot();
    if(undoStack[undoStack.length-1]!==current) undoStack.push(current);
    if(undoStack.length>HISTORY_LIMIT)undoStack.shift();
    redoStack=[];
    updateHistoryButtons();
  }
  function restore(raw){
    const saved=JSON.parse(raw);
    Object.assign(state,saved.state);
    state.tracks=(state.tracks||[]).map(normalizeTrack);
    selected=saved.selected||null; playhead=Number(saved.playhead)||0;
    state.clips=state.clips||[];
    window.clipforgeEditorBridge?.setClips(state.clips);
    deriveDuration(); render(); syncPreview(); updateHistoryButtons(); persistLocal();
  }
  function undo(){if(!undoStack.length)return;redoStack.push(snapshot());restore(undoStack.pop());say('Cambio deshecho.');}
  function redo(){if(!redoStack.length)return;undoStack.push(snapshot());restore(redoStack.pop());say('Cambio restaurado.');}
  function defaultTracks(){
    const subs=(state.transcript?.segments||[]).map((s,i)=>({id:'subtitle-'+(i+1),start:Number(s.start),end:Number(s.end),text:String(s.text||''),kind:'subtitle'})).filter(x=>Number.isFinite(x.start)&&Number.isFinite(x.end)&&x.end>x.start);
    return [
      normalizeTrack({id:'track-video-1',type:'video',name:'V1 · Vídeo',items:state.clips.map(c=>({...c,id:String(c.id||uid('clip')),kind:'clip',text:c.title||c.text||'Clip'}))}),
      normalizeTrack({id:'track-audio-1',type:'audio',name:'A1 · Audio',items:[]}),
      normalizeTrack({id:'track-subtitles-1',type:'subtitles',name:'S1 · Subtítulos',items:subs}),
      normalizeTrack({id:'track-text-1',type:'text',name:'T1 · Texto',items:[]})
    ];
  }
  function getSelected(){
    if(!selected)return null;
    const track=state.tracks.find(t=>t.id===selected.trackId);
    const item=track?.items.find(i=>i.id===selected.itemId);
    return track&&item?{track,item}:null;
  }
  function selectItem(track,item){
    selected={trackId:track.id,itemId:item.id};
    render(); renderInspector(); syncPreview();
  }
  function makeButton(label,action,cls='secondary'){
    const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=label;b.addEventListener('click',action);return b;
  }
  function makeField(label,value,type,onChange,step){
    const wrap=document.createElement('label');wrap.className='editor-field';wrap.textContent=label;
    const input=document.createElement(type==='textarea'?'textarea':'input');
    if(type!=='textarea')input.type=type||'text';
    input.value=value==null?'':String(value);
    if(type==='number'){input.min='0';input.step=step||'.01';}
    input.addEventListener('change',()=>onChange(input.value));
    wrap.append(input);return wrap;
  }
  function ensureWorkspace(){
    let workspace=$('#editorWorkspace');
    if(workspace)return workspace;
    workspace=document.createElement('div');workspace.id='editorWorkspace';workspace.className='editor-workspace';
    const player=document.createElement('section');player.className='editor-preview-panel';
    player.innerHTML='<div class="editor-subhead">PREVISUALIZACIÓN</div><div class="editor-preview-stage"><video id="editorSourcePreview" controls playsinline preload="metadata"></video><div id="editorSubtitleOverlay" class="editor-subtitle-overlay"></div></div><div class="editor-playback"><button type="button" id="editorPlay" class="secondary">▶ Reproducir</button><span id="editorTimecode">00:00.00</span><input id="editorSeek" type="range" min="0" max="100" step=".01" value="0" aria-label="Cabezal de reproducción"></div>';
    const inspector=document.createElement('aside');inspector.id='editorInspector';inspector.className='editor-inspector';
    inspector.innerHTML='<div class="editor-subhead">INSPECTOR</div><div id="editorInspectorBody"><p class="muted">Selecciona un elemento de la línea de tiempo.</p></div>';
    workspace.append(player,inspector);
    const toolbar=document.createElement('div');toolbar.className='editor-actions';
    toolbar.innerHTML='<button type="button" class="secondary" id="editorSplit">Dividir en cabezal</button><button type="button" class="secondary" id="editorDuplicate">Duplicar</button><button type="button" class="secondary" id="editorCopy">Copiar</button><button type="button" class="secondary" id="editorPaste">Pegar</button><button type="button" class="secondary" id="editorDelete">Eliminar</button><button type="button" class="secondary" id="editorAddText">Añadir texto</button>';
    const timelineHead=document.createElement('div');timelineHead.className='editor-timeline-head';
    timelineHead.innerHTML='<div><b>LÍNEA DE TIEMPO MULTIPISTA</b><small id="editorTimelineInfo">Selecciona un elemento para editarlo</small></div><div class="editor-zoom"><button type="button" class="secondary" id="editorZoomOut">−</button><button type="button" class="secondary" id="editorZoomIn">+</button></div>';
    const parent=timelineEl.parentElement;
    parent.insertBefore(workspace,timelineEl);
    parent.insertBefore(toolbar,timelineEl);
    parent.insertBefore(timelineHead,timelineEl);
    previewVideo=$('#editorSourcePreview');
    previewVideo.addEventListener('timeupdate',()=>{playhead=previewVideo.currentTime;updatePlayback();});
    previewVideo.addEventListener('loadedmetadata',()=>{if(Number.isFinite(previewVideo.duration)){duration=Math.max(duration,previewVideo.duration);updatePlayback();}});
    $('#editorPlay').addEventListener('click',()=>{if(previewVideo.paused)previewVideo.play().catch(()=>say('No se pudo reproducir el vídeo fuente.'));else previewVideo.pause();});
    $('#editorSeek').addEventListener('input',e=>seek(Number(e.target.value)));
    $('#editorSplit').addEventListener('click',splitSelected);
    $('#editorDuplicate').addEventListener('click',duplicateSelected);
    $('#editorCopy').addEventListener('click',copySelected);
    $('#editorPaste').addEventListener('click',pasteSelected);
    $('#editorDelete').addEventListener('click',deleteSelected);
    $('#editorAddText').addEventListener('click',addText);
    $('#editorZoomIn').addEventListener('click',()=>{zoom=Math.min(4,zoom+.25);render();});
    $('#editorZoomOut').addEventListener('click',()=>{zoom=Math.max(.5,zoom-.25);render();});
    return workspace;
  }
  let zoom=1;
  function seek(time){
    playhead=Math.max(0,Math.min(duration,time));
    if(previewVideo&&Number.isFinite(previewVideo.duration))previewVideo.currentTime=Math.min(playhead,previewVideo.duration);
    updatePlayback();renderPlayhead();
  }
  function updatePlayback(){
    const time=$('#editorTimecode'),slider=$('#editorSeek');
    if(time)time.textContent=formatTime(playhead);
    if(slider){slider.max=String(Math.max(1,duration));slider.value=String(playhead);}
    const play=$('#editorPlay');if(play&&previewVideo)play.textContent=previewVideo.paused?'▶ Reproducir':'Ⅱ Pausar';
    const active=getSelected()?.item;
    const overlay=$('#editorSubtitleOverlay');
    if(overlay){const active=state.tracks.filter(t=>(t.type==='subtitles'||t.type==='text')&&!t.hidden).flatMap(t=>t.items).find(i=>playhead>=i.start&&playhead<=i.end);overlay.textContent=active?.text||'';}
  }
  function renderPlayhead(){const el=$('#editorPlayhead');if(el)el.style.left=(playhead/Math.max(1,duration)*100)+'%';}
  function formatTime(t){const n=Math.max(0,Number(t)||0);return String(Math.floor(n/60)).padStart(2,'0')+':'+String(Math.floor(n%60)).padStart(2,'0')+'.'+String(Math.floor((n%1)*100)).padStart(2,'0');}
  function render(){
    if(!timelineEl)return;
    ensureWorkspace();deriveDuration();
    timelineEl.replaceChildren();
    timelineEl.style.minWidth=Math.round(600*zoom)+'px';
    const ruler=document.createElement('div');ruler.className='editor-ruler';
    for(let t=0;t<=duration;t+=Math.max(1,Math.ceil(duration/10))){const mark=document.createElement('span');mark.textContent=formatTime(t);mark.style.left=(t/duration*100)+'%';ruler.append(mark);}
    timelineEl.append(ruler);
    state.tracks.forEach((track,index)=>{
      const row=document.createElement('section');row.className='editor-track'+(track.hidden?' is-hidden':'');
      const head=document.createElement('div');head.className='editor-track-head';
      const name=document.createElement('strong');name.textContent=track.name||((TYPES[track.type]||track.type)+' '+(index+1));
      const controls=document.createElement('div');controls.className='editor-track-controls';
      controls.append(makeButton(track.locked?'🔒':'🔓',()=>{remember();track.locked=!track.locked;persistLocal();render();},'track-control'));
      controls.append(makeButton(track.muted?'Activar':'Silenciar',()=>{remember();track.muted=!track.muted;persistLocal();render();},'track-control'));
      controls.append(makeButton(track.hidden?'Mostrar':'Ocultar',()=>{remember();track.hidden=!track.hidden;persistLocal();render();},'track-control'));
      controls.append(makeButton('×',()=>{if(state.tracks.length===1){say('El proyecto debe conservar al menos una pista.');return;}remember();state.tracks=state.tracks.filter(t=>t.id!==track.id);if(selected?.trackId===track.id)selected=null;render();persistLocal();},'track-control'));
      head.append(name,controls);
      const lane=document.createElement('div');lane.className='editor-track-items';lane.dataset.track=track.id;
      lane.addEventListener('click',e=>{if(e.target===lane)seek(Number(e.offsetX/lane.clientWidth*duration));});
      track.items.forEach(item=>{
        const block=document.createElement('button');block.type='button';block.className='editor-clip'+(selected?.itemId===item.id?' selected':'');
        block.style.left=(Math.max(0,item.start)/duration*100)+'%';
        block.style.width=(Math.max(.5,(item.end-item.start))/duration*100)+'%';
        block.textContent=item.text||item.title||TYPES[track.type];
        block.title=formatTime(item.start)+' – '+formatTime(item.end);
        block.disabled=track.locked;
        block.addEventListener('click',e=>{e.stopPropagation();selectItem(track,item);});
        lane.append(block);
      });
      const play=document.createElement('div');play.className='editor-playhead';play.id='editorPlayhead';play.style.left=(playhead/duration*100)+'%';lane.append(play);
      row.append(head,lane);timelineEl.append(row);
    });
    renderInspector();updatePlayback();updateHistoryButtons();
    const info=$('#editorTimelineInfo');if(info)info.textContent=state.tracks.length+' pistas · '+state.clips.length+' clips · duración '+formatTime(duration);
  }
  function renderInspector(){
    const body=$('#editorInspectorBody');if(!body)return;body.replaceChildren();
    const found=getSelected();
    if(!found){const p=document.createElement('p');p.className='muted';p.textContent='Selecciona un elemento de la línea de tiempo.';body.append(p);return;}
    const track=found.track,item=found.item;
    const title=document.createElement('b');title.textContent=(TYPES[track.type]||track.type)+' · Propiedades';body.append(title);
    if(track.locked){const p=document.createElement('p');p.className='muted';p.textContent='La pista está bloqueada. Desbloquéala para editar.';body.append(p);return;}
    body.append(makeField('Nombre / contenido',item.text||item.title||'', 'textarea',v=>mutateItem(item,{text:v})));
    body.append(makeField('Inicio (segundos)',item.start,'number',v=>mutateItem(item,{start:Number(v)})));
    body.append(makeField('Final (segundos)',item.end,'number',v=>mutateItem(item,{end:Number(v)})));
    if(track.type==='video'){
      ['scale','rotation','opacity','volume','speed','x','y'].forEach(key=>{
        const defaults={scale:1,rotation:0,opacity:1,volume:1,speed:1,x:0,y:0};
        body.append(makeField(({scale:'Escala',rotation:'Rotación',opacity:'Opacidad',volume:'Volumen',speed:'Velocidad',x:'Posición X',y:'Posición Y'})[key],item[key]??defaults[key],'number',v=>mutateItem(item,{[key]:Number(v)})));
      });
    }
  }
  function mutateItem(item,patch){
    const a=patch.start??item.start,b=patch.end??item.end;
    if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<=a){say('Intervalo no válido: el final debe ser posterior al inicio.');return;}
    remember();Object.assign(item,patch);
    syncClipsFromTracks();persistLocal();render();say('Propiedad actualizada en el proyecto.');
  }
  function syncClipsFromTracks(){
    const videoTracks=state.tracks.filter(t=>t.type==='video');
    const items=videoTracks.flatMap(t=>t.items);
    state.clips=items.filter(i=>i.kind==='clip'||state.clips.some(c=>c.id===i.id)).map(i=>({...i}));
    window.clipforgeEditorBridge?.setClips(state.clips);
  }
  function splitSelected(){
    const found=getSelected();if(!found){say('Selecciona primero un clip.');return;}
    const {track,item}=found;if(track.locked){say('Desbloquea la pista antes de dividir.');return;}
    if(playhead<=item.start+.05||playhead>=item.end-.05){say('Coloca el cabezal dentro del elemento para dividirlo.');return;}
    remember();const right={...clone(item),id:uid(item.kind||track.type),start:playhead};
    item.end=playhead;track.items.splice(track.items.indexOf(item)+1,0,right);
    if(track.type==='video'){const clip=state.clips.find(c=>c.id===item.id);if(clip)clip.end=playhead;state.clips.push({...right});}
    selected={trackId:track.id,itemId:right.id};syncClipsFromTracks();persistLocal();render();say('Elemento dividido en el cabezal.');
  }
  function duplicateSelected(){
    const found=getSelected();if(!found)return;const {track,item}=found;if(track.locked)return;
    remember();const copy={...clone(item),id:uid(item.kind||track.type),start:item.end,end:item.end+(item.end-item.start)};
    track.items.splice(track.items.indexOf(item)+1,0,copy);if(track.type==='video')state.clips.push({...copy});
    selected={trackId:track.id,itemId:copy.id};syncClipsFromTracks();persistLocal();render();say('Elemento duplicado.');
  }
  function copySelected(){const found=getSelected();if(!found)return;clipboard={trackType:found.track.type,item:clone(found.item)};say('Elemento copiado.');}
  function pasteSelected(){
    if(!clipboard){say('No hay ningún elemento copiado.');return;}
    let track=state.tracks.find(t=>t.type===clipboard.trackType&&!t.locked);
    if(!track){track=normalizeTrack({type:clipboard.trackType,name:(TYPES[clipboard.trackType]||'Pista')+' nueva',items:[]});state.tracks.push(track);}
    remember();const item={...clone(clipboard.item),id:uid(clipboard.trackType),start:playhead,end:playhead+(clipboard.item.end-clipboard.item.start)};
    track.items.push(item);if(track.type==='video')state.clips.push({...item});selected={trackId:track.id,itemId:item.id};syncClipsFromTracks();persistLocal();render();say('Elemento pegado en el cabezal.');
  }
  function deleteSelected(){
    const found=getSelected();if(!found)return;if(found.track.locked){say('Desbloquea la pista antes de eliminar.');return;}
    remember();found.track.items=found.track.items.filter(i=>i.id!==found.item.id);state.clips=state.clips.filter(c=>c.id!==found.item.id);selected=null;syncClipsFromTracks();persistLocal();render();say('Elemento eliminado.');
  }
  function addText(){
    let track=state.tracks.find(t=>t.type==='text'&&!t.locked);
    if(!track){track=normalizeTrack({type:'text',name:'T1 · Textos',items:[]});state.tracks.push(track);}
    remember();const item={id:uid('text'),kind:'text',start:playhead,end:playhead+3,text:'Nuevo título',fontSize:56,color:'#ffffff',x:0.5,y:0.8};
    track.items.push(item);selected={trackId:track.id,itemId:item.id};persistLocal();render();say('Texto añadido a la pista. Puedes editarlo en el inspector.');
  }
  function addTrack(type){
    remember();const n=state.tracks.filter(t=>t.type===type).length+1;
    state.tracks.push(normalizeTrack({type,name:(TYPES[type]||type)+' '+n,items:[]}));
    persistLocal();render();say('Pista '+(TYPES[type]||type)+' añadida.');
  }
  function persistLocal(){
    try{localStorage.setItem('clipforge.editor.autosave',JSON.stringify({state,selected,playhead,savedAt:Date.now()}));}catch(e){say('No se pudo guardar automáticamente en este navegador: '+e.message);}
  }
  async function refreshProjects(){
    if(!projectSelect)return;
    try{const r=await fetch('/api/projects');if(!r.ok)throw new Error('HTTP '+r.status);const data=await r.json();projectSelect.replaceChildren(new Option('Nuevo proyecto',''));(data.projects||[]).forEach(p=>projectSelect.add(new Option((p.source||'Proyecto')+' · '+p.clip_count+' clips',p.id)));}
    catch(e){say('No se pudo cargar la lista de proyectos: '+e.message);}
  }
  async function saveProject(){
    const project={schema:'clipforge-project-v2',source:state.source,transcript:state.transcript,clips:state.clips,tracks:state.tracks,settings:state.settings};
    try{const r=await fetch('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:activeProjectId||undefined,...project})});const data=await r.json();if(!r.ok)throw new Error(data.message||data.error||'HTTP '+r.status);activeProjectId=data.id;await refreshProjects();if(projectSelect)projectSelect.value=activeProjectId;say('Proyecto guardado en el servidor local: '+data.clip_count+' clips y '+data.track_count+' pistas.');}
    catch(e){say('Error al guardar el proyecto: '+e.message);}
  }
  async function loadProject(){
    const id=projectSelect?.value;if(!id){say('Selecciona un proyecto guardado.');return;}
    try{const r=await fetch('/api/projects/'+encodeURIComponent(id));const p=await r.json();if(!r.ok)throw new Error(p.message||p.error||'HTTP '+r.status);activeProjectId=id;Object.assign(state,{schema:'clipforge-project-v2',source:p.source||'',transcript:p.transcript||null,clips:p.clips||[],tracks:(p.tracks||[]).map(normalizeTrack),settings:p.settings||state.settings});if(!state.tracks.length)state.tracks=defaultTracks();selected=null;undoStack=[];redoStack=[];deriveDuration();window.clipforgeEditorBridge?.setClips(state.clips);persistLocal();render();say('Proyecto recuperado: '+state.clips.length+' clips y '+state.tracks.length+' pistas.');}
    catch(e){say('No se pudo abrir el proyecto: '+e.message);}
  }
  function syncPreview(){
    const found=getSelected();if(!found)return;
    const item=found.item;if(previewVideo&&previewVideo.readyState>=1)seek(Math.min(item.start,previewVideo.duration||item.start));
  }
  function attachSource(file){
    if(!file)return;
    if(sourceUrl)URL.revokeObjectURL(sourceUrl);
    sourceUrl=URL.createObjectURL(file);state.source=file.name;
    if(previewVideo){previewVideo.src=sourceUrl;previewVideo.load();}
    persistLocal();say('Vídeo fuente cargado en la previsualización. Los medios se conservan en esta sesión; vuelve a importarlos tras cerrar el navegador.');
  }
  document.addEventListener('keydown',ev=>{
    if(!(ev.metaKey||ev.ctrlKey))return;
    const key=ev.key.toLowerCase();
    if(key==='z'){ev.preventDefault();ev.shiftKey?redo():undo();}
    else if(key==='c'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){ev.preventDefault();copySelected();}
    else if(key==='v'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){ev.preventDefault();pasteSelected();}
    else if(key==='d'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){ev.preventDefault();duplicateSelected();}
  });
  $('#editorUndo')?.addEventListener('click',undo);
  $('#editorRedo')?.addEventListener('click',redo);
  $('#addEditorTrack')?.addEventListener('click',()=>addTrack($('#editorTrackType')?.value||'video'));
  $('#saveSavedProject')?.addEventListener('click',saveProject);
  $('#loadSavedProject')?.addEventListener('click',loadProject);
  $('#video')?.addEventListener('change',e=>attachSource(e.target.files?.[0]));
  window.addEventListener('clipforge:editor-ready',()=>{
    const p=window.clipforgeEditorBridge?.getProject?.();if(!p)return;
    state.source=p.source||'';state.transcript=p.transcript||null;state.clips=p.clips||[];
    state.tracks=Array.isArray(p.tracks)&&p.tracks.length?p.tracks.map(normalizeTrack):defaultTracks();
    deriveDuration();render();persistLocal();say(state.clips.length+' clips cargados en el editor.');
  });
  window.addEventListener('clipforge:clips-updated',()=>{
    const p=window.clipforgeEditorBridge?.getProject?.();if(!p)return;
    state.source=p.source||state.source;state.transcript=p.transcript||state.transcript;state.clips=p.clips||[];
    const video=state.tracks.find(t=>t.type==='video');
    if(video)video.items=state.clips.map(c=>({...c,kind:'clip',text:c.title||c.text||'Clip'}));
    else state.tracks.unshift(normalizeTrack({type:'video',name:'V1 · Vídeo',items:state.clips.map(c=>({...c,kind:'clip'}))}));
    deriveDuration();render();persistLocal();say(state.clips.length+' clips sincronizados con el proyecto.');
  });
  $('#editorTrackType')?.addEventListener('change',()=>{});
  if(timelineEl){
    const saved=(()=>{try{return JSON.parse(localStorage.getItem('clipforge.editor.autosave')||'null');}catch{return null;}})();
    if(saved?.state?.tracks?.length){Object.assign(state,saved.state);state.tracks=state.tracks.map(normalizeTrack);selected=saved.selected||null;playhead=Number(saved.playhead)||0;}
    else {const p=window.clipforgeEditorBridge?.getProject?.();if(p){state.source=p.source||'';state.transcript=p.transcript||null;state.clips=p.clips||[];}state.tracks=defaultTracks();}
    ensureWorkspace();deriveDuration();render();refreshProjects();updateHistoryButtons();
    if(state.clips.length)say(state.clips.length+' clips listos. Selecciona un clip para editar.');
  }
  window.clipforgeEditor = {getProject:()=>clone(state),addTrack,undo,redo,saveProject,select:(trackId,itemId)=>{const t=state.tracks.find(x=>x.id===trackId),i=t?.items.find(x=>x.id===itemId);if(t&&i)selectItem(t,i);}};
})();
