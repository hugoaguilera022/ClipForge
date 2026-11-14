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
    toolbar.innerHTML='<button type="button" class="secondary" id="editorSplit">Dividir en cabezal</button><button type="button" class="secondary" id="editorDuplicate">Duplicar</button><button type="button" class="secondary" id="editorCopy">Copiar</button><button type="button" class="secondary" id="editorPaste">Pegar</button><button type="button" class="secondary" id="editorDelete">Eliminar</button><button type="button" class="secondary" id="editorAddText">Añadir texto</button><button type="button" class="primary" id="editorExport">Exportar clip MP4</button>';
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
    $('#editorExport').addEventListener('click',exportSelectedClip);
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
    const activeVideo=state.tracks.filter(t=>t.type==='video'&&!t.hidden).flatMap(t=>t.items).find(i=>playhead>=i.start&&playhead<=i.end);
    if(previewVideo){previewVideo.muted=state.tracks.filter(t=>t.type==='video').every(t=>t.muted);previewVideo.style.filter=filterCss(activeVideo?.filterPreset);previewVideo.style.opacity=String(transitionOpacity(activeVideo,playhead));}
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
      controls.append(makeButton('↑',()=>reorderTrack(track.id,-1),'track-control'));
      controls.append(makeButton('↓',()=>reorderTrack(track.id,1),'track-control'));
      controls.append(makeButton('×',()=>{if(state.tracks.length===1){say('El proyecto debe conservar al menos una pista.');return;}remember();state.tracks=state.tracks.filter(t=>t.id!==track.id);if(selected?.trackId===track.id)selected=null;render();persistLocal();},'track-control'));
      head.append(name,controls);
      const lane=document.createElement('div');lane.className='editor-track-items';lane.dataset.track=track.id;
      lane.addEventListener('click',e=>{if(e.target===lane)seek(Number(e.offsetX/lane.clientWidth*duration));});
      lane.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move';});
      lane.addEventListener('drop',e=>{e.preventDefault();const raw=e.dataTransfer.getData('application/x-clipforge-item');if(!raw)return;try{moveTimelineItem(JSON.parse(raw),track,Math.max(0,Math.min(duration,e.offsetX/Math.max(1,lane.clientWidth)*duration)));}catch{say('No se pudo mover el elemento.');}});
      track.items.forEach(item=>{
        const block=document.createElement('button');block.type='button';block.className='editor-clip'+(selected?.itemId===item.id?' selected':'');
        block.style.left=(Math.max(0,item.start)/duration*100)+'%';
        block.style.width=(Math.max(.5,(item.end-item.start))/duration*100)+'%';
        block.textContent=item.text||item.title||TYPES[track.type];
        block.title=formatTime(item.start)+' – '+formatTime(item.end);
        block.disabled=track.locked;
        block.draggable=!track.locked;
        block.addEventListener('dragstart',e=>{e.dataTransfer.setData('application/x-clipforge-item',JSON.stringify({trackId:track.id,itemId:item.id}));e.dataTransfer.effectAllowed='move';});
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
      body.append(makeSelectField('Filtro',item.filterPreset||'none',[['none','Original'],['cinematic','Cinemático'],['bw','Blanco y negro'],['warm','Cálido'],['cool','Frío'],['vintage','Vintage']],v=>mutateItem(item,{filterPreset:v})));
      body.append(makeField('Fundido de entrada (s)',item.fadeIn??0,'number',v=>mutateItem(item,{fadeIn:Math.max(0,Number(v))})));
      body.append(makeField('Fundido de salida (s)',item.fadeOut??0,'number',v=>mutateItem(item,{fadeOut:Math.max(0,Number(v))})));
      ['scale','rotation','opacity','volume','speed','x','y'].forEach(key=>{
        const defaults={scale:1,rotation:0,opacity:1,volume:1,speed:1,x:0,y:0};
        body.append(makeField(({scale:'Escala',rotation:'Rotación',opacity:'Opacidad',volume:'Volumen',speed:'Velocidad',x:'Posición X',y:'Posición Y'})[key],item[key]??defaults[key],'number',v=>mutateItem(item,{[key]:Number(v)})));
      });
    }
  }
  function makeSelectField(label,value,options,onChange){
    const wrap=document.createElement('label');wrap.className='editor-field';wrap.textContent=label;
    const select=document.createElement('select');options.forEach(([v,t])=>select.add(new Option(t,v)));select.value=value;
    select.addEventListener('change',()=>onChange(select.value));wrap.append(select);return wrap;
  }
  function filterCss(preset){return ({cinematic:'contrast(1.16) saturate(.88) brightness(.96)',bw:'grayscale(1) contrast(1.08)',warm:'sepia(.22) saturate(1.18)',cool:'saturate(.9) hue-rotate(12deg) brightness(1.02)',vintage:'sepia(.32) contrast(.92) saturate(.82)'})[preset]||'none';}
  function transitionOpacity(item,time){if(!item)return 1;let a=Number(item.opacity??1);const fi=Math.max(0,Number(item.fadeIn)||0),fo=Math.max(0,Number(item.fadeOut)||0);if(fi>0&&time<item.start+fi)a*=Math.max(0,(time-item.start)/fi);if(fo>0&&time>item.end-fo)a*=Math.max(0,(item.end-time)/fo);return Math.max(0,Math.min(1,a));}
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

  function reorderTrack(trackId,direction){
    const index=state.tracks.findIndex(t=>t.id===trackId),next=index+direction;
    if(index<0||next<0||next>=state.tracks.length)return;
    remember();const [track]=state.tracks.splice(index,1);state.tracks.splice(next,0,track);
    persistLocal();render();say('Orden de pistas actualizado.');
  }
  function moveTimelineItem(source,targetTrack,newStart){
    const sourceTrack=state.tracks.find(t=>t.id===source.trackId);
    const item=sourceTrack?.items.find(i=>i.id===source.itemId);
    if(!sourceTrack||!item||sourceTrack.locked||targetTrack.locked)return;
    if(sourceTrack!==targetTrack&&sourceTrack.type!==targetTrack.type){say('Solo puedes mover elementos entre pistas del mismo tipo.');return;}
    const length=item.end-item.start;
    remember();
    if(sourceTrack!==targetTrack){sourceTrack.items=sourceTrack.items.filter(i=>i.id!==item.id);targetTrack.items.push(item);}
    item.start=newStart;item.end=newStart+length;
    syncClipsFromTracks();selected={trackId:targetTrack.id,itemId:item.id};
    persistLocal();render();say('Elemento movido en la línea de tiempo.');
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
  async function exportSelectedClip(){
    const found=getSelected();
    if(!found||found.track.type!=='video'){say('Selecciona un clip de vídeo para exportarlo.');return;}
    if(!previewVideo||!previewVideo.src){say('Carga el archivo de vídeo original antes de exportar.');return;}
    const item=found.item, start=Number(item.start), end=Number(item.end);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start){say('El intervalo del clip no es válido.');return;}
    const button=$('#editorExport');if(button){button.disabled=true;button.textContent='Exportando…';}
    let recorder=null, canvasStream=null, mediaStream=null;
    try{
      if(previewVideo.readyState<1)await new Promise((resolve,reject)=>{previewVideo.addEventListener('loadedmetadata',resolve,{once:true});previewVideo.addEventListener('error',()=>reject(new Error('No se pudieron leer los metadatos del vídeo.')),{once:true});});
      const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('No se pudo crear el lienzo de exportación.');
      const seekTo=()=>new Promise((resolve,reject)=>{const done=()=>{cleanup();resolve();};const fail=()=>{cleanup();reject(new Error('No se pudo posicionar el vídeo.'));};const cleanup=()=>{previewVideo.removeEventListener('seeked',done);previewVideo.removeEventListener('error',fail);};previewVideo.addEventListener('seeked',done,{once:true});previewVideo.addEventListener('error',fail,{once:true});previewVideo.currentTime=start;if(Math.abs(previewVideo.currentTime-start)<.02)done();});
      await seekTo();
      const videoTracks=state.tracks.filter(t=>t.type==='video'&&!t.hidden);
      const textItems=state.tracks.filter(t=>(t.type==='text'||t.type==='subtitles')&&!t.hidden).flatMap(t=>t.items);
      const draw=()=>{
        const vw=previewVideo.videoWidth||1920,vh=previewVideo.videoHeight||1080;
        const scale=Math.max(canvas.width/vw,canvas.height/vh),dw=vw*scale,dh=vh*scale;
        const activeVideo=videoTracks.flatMap(t=>t.items).find(x=>previewVideo.currentTime>=x.start&&previewVideo.currentTime<=x.end);
        const alpha=transitionOpacity({...item,...activeVideo},previewVideo.currentTime);
        ctx.save();ctx.clearRect(0,0,canvas.width,canvas.height);ctx.globalAlpha=alpha*Math.max(0,Math.min(1,Number(item.opacity??1)));ctx.filter=filterCss(item.filterPreset);ctx.translate(canvas.width/2+(Number(item.x)||0),canvas.height/2+(Number(item.y)||0));ctx.rotate((Number(item.rotation)||0)*Math.PI/180);const itemScale=Math.max(.1,Math.min(4,Number(item.scale)||1));ctx.scale(itemScale,itemScale);
        ctx.drawImage(previewVideo,-dw/2,-dh/2,dw,dh);ctx.restore();
        const active=textItems.filter(x=>previewVideo.currentTime>=x.start&&previewVideo.currentTime<=x.end);
        active.forEach((x,index)=>{const font=Math.max(24,Math.min(110,Number(x.fontSize)||64));ctx.save();ctx.globalAlpha=alpha;ctx.font='700 '+font+'px Arial,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=Math.max(4,font*.09);ctx.strokeStyle='rgba(0,0,0,.82)';ctx.fillStyle=x.color||'#ffffff';const words=String(x.text||'').split(/\s+/);let lines=[],line='';for(const word of words){const test=line?line+' '+word:word;if(ctx.measureText(test).width>canvas.width*.88&&line){lines.push(line);line=word;}else line=test;}if(line)lines.push(line);const y=canvas.height*(Number(x.y)||.82);lines.slice(0,3).forEach((ln,i)=>{const yy=y+(i-(Math.min(lines.length,3)-1)/2)*font*1.15;ctx.strokeText(ln,canvas.width/2,yy);ctx.fillText(ln,canvas.width/2,yy);});ctx.restore();});
      };
      const drawLoop=()=>{if(previewVideo.readyState>=2)draw();if(!recorder||recorder.state!=='recording')return;if(previewVideo.currentTime>=end){previewVideo.pause();recorder.stop();return;}requestAnimationFrame(drawLoop);};
      canvasStream=canvas.captureStream(30);
      const capture=previewVideo.captureStream?previewVideo.captureStream():previewVideo.mozCaptureStream?previewVideo.mozCaptureStream():null;
      const tracks=[...canvasStream.getVideoTracks(),...(capture?.getAudioTracks()||[])];
      mediaStream=new MediaStream(tracks);
      const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));
      if(!mime)throw new Error('Este navegador no permite exportar vídeo. Usa Chrome o Edge actualizado.');
      const chunks=[];recorder=new MediaRecorder(mediaStream,{mimeType:mime,videoBitsPerSecond:8000000});
      const stopped=new Promise((resolve,reject)=>{recorder.addEventListener('stop',resolve,{once:true});recorder.addEventListener('error',()=>reject(new Error('Falló la grabación del clip.')),{once:true});});
      recorder.addEventListener('dataavailable',e=>{if(e.data?.size)chunks.push(e.data);});
      previewVideo.muted=state.tracks.filter(t=>t.type==='video').every(t=>t.muted);
      previewVideo.volume=Math.max(0,Math.min(1,Number(item.volume??1)));previewVideo.playbackRate=Math.max(.25,Math.min(4,Number(item.speed)||1));
      recorder.start(500);await previewVideo.play();drawLoop();await stopped;
      const blob=new Blob(chunks,{type:mime});if(blob.size<1024)throw new Error('La grabación quedó vacía.');
      const form=new FormData();form.append('video',blob,'clip.webm');
      say('Convirtiendo el clip a MP4 H.264…');
      const response=await fetch('/api/editor/export',{method:'POST',body:form});const result=await response.json();
      if(!response.ok)throw new Error(result.message||result.error||'HTTP '+response.status);
      const link=document.createElement('a');link.href=result.download_url;link.download='clipforge_'+result.id+'.mp4';document.body.append(link);link.click();link.remove();
      say('Exportación MP4 terminada. Se ha iniciado la descarga.');
    }catch(error){say('No se pudo exportar: '+error.message);}
    finally{if(recorder&&recorder.state!=='inactive')recorder.stop();if(canvasStream)canvasStream.getTracks().forEach(t=>t.stop());if(mediaStream)mediaStream.getTracks().forEach(t=>t.stop());if(previewVideo)previewVideo.playbackRate=1;if(button){button.disabled=false;button.textContent='Exportar clip MP4';}}
  }
  function addTrack(type){
    remember();const n=state.tracks.filter(t=>t.type===type).length+1;
    state.tracks.push(normalizeTrack({type,name:(TYPES[type]||type)+' '+n,items:[]}));
    persistLocal();render();say('Pista '+(TYPES[type]||type)+' añadida.');
  }
  function persistLocal(){
    try{localStorage.setItem('clipforge.editor.autosave',JSON.stringify({state,selected,playhead,savedAt:Date.now()}));}catch(e){say('No se pudo guardar automáticamente en este navegador: '+e.message);}
  }
  function readLocalProjects(){try{const value=JSON.parse(localStorage.getItem('clipforge.editor.projects')||'{}');return value&&typeof value==='object'?value:{};}catch{return {};}}
  function writeLocalProjects(projects){localStorage.setItem('clipforge.editor.projects',JSON.stringify(projects));}
  async function refreshProjects(){
    if(!projectSelect)return;
    const local=readLocalProjects();let remote=[];
    try{const r=await fetch('/api/projects');if(r.ok){const data=await r.json();remote=data.projects||[];}}catch{}
    projectSelect.replaceChildren(new Option('Nuevo proyecto',''));
    const merged=new Map();
    remote.forEach(p=>merged.set(p.id,{id:p.id,source:p.source,clip_count:p.clip_count}));
    Object.entries(local).forEach(([id,p])=>merged.set(id,{id,source:p.source,clip_count:(p.clips||[]).length}));
    [...merged.values()].forEach(p=>projectSelect.add(new Option((p.source||'Proyecto')+' · '+p.clip_count+' clips',p.id)));
  }
  async function saveProject(){
    const project={schema:'clipforge-project-v2',source:state.source,transcript:state.transcript,clips:state.clips,tracks:state.tracks,settings:state.settings};
    try{
      activeProjectId=activeProjectId||crypto.randomUUID().replaceAll('-','').slice(0,16);
      const local=readLocalProjects();local[activeProjectId]={...clone(project),savedAt:Date.now()};writeLocalProjects(local);
      try{await fetch('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:activeProjectId,...project})});}catch{}
      await refreshProjects();if(projectSelect)projectSelect.value=activeProjectId;
      say('Proyecto guardado en este navegador. Para recuperar los medios, vuelve a seleccionar el vídeo original.');
    }catch(e){say('No se pudo guardar el proyecto local: '+e.message);}
  }
  async function loadProject(){
    const id=projectSelect?.value;if(!id){say('Selecciona un proyecto guardado.');return;}
    try{
      const local=readLocalProjects();let p=local[id];
      if(!p){const r=await fetch('/api/projects/'+encodeURIComponent(id));p=await r.json();if(!r.ok)throw new Error(p.message||p.error||'HTTP '+r.status);}
      activeProjectId=id;Object.assign(state,{schema:'clipforge-project-v2',source:p.source||'',transcript:p.transcript||null,clips:p.clips||[],tracks:(p.tracks||[]).map(normalizeTrack),settings:p.settings||state.settings});
      if(!state.tracks.length)state.tracks=defaultTracks();selected=null;undoStack=[];redoStack=[];deriveDuration();window.clipforgeEditorBridge?.setClips(state.clips);persistLocal();render();say('Proyecto recuperado: '+state.clips.length+' clips y '+state.tracks.length+' pistas. Vuelve a importar el vídeo original para previsualizar y exportar.');
    }catch(e){say('No se pudo abrir el proyecto: '+e.message);}
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
    else if(key==='Delete'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){ev.preventDefault();deleteSelected();}
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
    state.source=p.source||state.source;state.transcript=p.transcript||null;state.clips=p.clips||[];
    const transcriptSegments=Array.isArray(state.transcript?.segments)?state.transcript.segments:[];
    if(transcriptSegments.length){let subtitles=state.tracks.find(t=>t.type==='subtitles');if(!subtitles){subtitles=normalizeTrack({type:'subtitles',name:'S1 · Subtítulos',items:[]});state.tracks.push(subtitles);}subtitles.items=transcriptSegments.map((s,i)=>({id:String(s.id||'subtitle-'+(i+1)),kind:'subtitle',start:Number(s.start),end:Number(s.end),text:String(s.text||'')})).filter(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.end>s.start&&s.text);}
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
