(()=>{'use strict';
const $=s=>document.querySelector(s),clone=x=>JSON.parse(JSON.stringify(x)),uid=()=>('nle-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7));
let installed=false,observer=null,audioNodes=new Map();
const bridge=()=>window.clipforgeEditorBridge;
function project(){return bridge()?.getProject?.()||{}}
function update(mutator){const b=bridge(),p=project(),tracks=clone(p.tracks||[]);mutator(tracks);b?.setTracks?.(tracks);window.dispatchEvent(new CustomEvent('clipforge:nle-changed'));}
function status(m){const e=$('#cfNleStatus');if(e)e.textContent=m;}
function install(){
 const root=$('#cfNle');if(!root)return;
 const name=$('#cfNleName');if(name&&!name.dataset.enhanced){name.dataset.enhanced='1';name.placeholder='Nombre del proyecto';name.addEventListener('change',()=>{const b=bridge();b?.setProjectName?.(name.value.trim()||'Proyecto sin título');status('Nombre actualizado · guarda en Drive para sincronizarlo');});}
 const head=root.querySelector('.cf-nle-head');
 if(head&&!$('#cfNleNewProject')){const b=document.createElement('button');b.id='cfNleNewProject';b.textContent='＋ Nuevo proyecto';b.title='Crear un proyecto vacío';b.onclick=()=>{if(!confirm('¿Crear un proyecto nuevo? Guarda antes los cambios actuales.'))return;update(t=>t.forEach(x=>x.items=[]));if(name)name.value='Mi proyecto';bridge()?.setProjectName?.('Mi proyecto');window.dispatchEvent(new CustomEvent('clipforge:new-project'));status('Proyecto nuevo listo');};head.insertBefore(b,$('#cfNleSave'));}
 const tools=root.querySelector('.cf-nle-tools');
 if(tools&&!$('#cfNleAddAudio')){const b=document.createElement('button');b.id='cfNleAddAudio';b.textContent='＋ Importar audio';b.onclick=()=>{const i=document.createElement('input');i.type='file';i.accept='audio/*';i.onchange=()=>{const f=i.files?.[0];if(!f)return;const url=URL.createObjectURL(f),assetId=uid(),a=new Audio();a.onloadedmetadata=()=>{const d=a.duration||5;window.clipforgeMediaStore?.save(assetId,f).catch(()=>{});update(ts=>{let t=ts.find(x=>x.type==='audio');if(!t){t={id:uid(),type:'audio',name:'A2 · Música',items:[]};ts.push(t);}t.items.push({id:uid(),kind:'audio',assetId, title:f.name,url,assetName:f.name,start:Number($('#cfNleSeek')?.value)||0,end:(Number($('#cfNleSeek')?.value)||0)+d,sourceStart:0,volume:1});});status('Audio añadido a la línea de tiempo.');};a.src=url;};i.click();};tools.insertBefore(b,tools.querySelector('span'));}
 if(tools&&!$('#cfNleAddVideo')){const b=document.createElement('button');b.id='cfNleAddVideo';b.textContent='＋ Importar vídeo/imagen';b.onclick=()=>$('#cfNleImport')?.click();tools.insertBefore(b,tools.querySelector('span'));}
 if(!observer){observer=new MutationObserver(()=>{decorateTracks(root);decorateBlocks(root);decorateInspector(root);wireAudio();});observer.observe(root,{childList:true,subtree:true});}
 decorateTracks(root);decorateBlocks(root);decorateInspector(root);wireAudio();
}
function decorateTracks(root){
 root.querySelectorAll('.cf-nle-track').forEach((row,index)=>{
  const head=row.querySelector('.cf-nle-track-head');if(!head||head.dataset.enhanced)return;head.dataset.enhanced='1';
  const p=project(),t=(p.tracks||[])[index];if(!t)return;
  const controls=document.createElement('div');controls.className='cf-nle-track-controls';
  [['🔒','locked','Bloquear pista'],['♫','muted','Silenciar pista'],['◉','hidden','Ocultar pista']].forEach(([label,key,title])=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.title=title;b.className=t[key]?'is-on':'';b.onclick=e=>{e.stopPropagation();update(ts=>{const x=ts.find(z=>z.id===t.id);if(x)x[key]=!x[key];});};controls.append(b);});
  const up=document.createElement('button');up.textContent='↑';up.title='Subir pista';up.onclick=()=>update(ts=>{const n=ts.findIndex(x=>x.id===t.id);if(n>0)[ts[n-1],ts[n]]=[ts[n],ts[n-1]];});
  const down=document.createElement('button');down.textContent='↓';down.title='Bajar pista';down.onclick=()=>update(ts=>{const n=ts.findIndex(x=>x.id===t.id);if(n>=0&&n<ts.length-1)[ts[n+1],ts[n]]=[ts[n],ts[n+1]];});
  const rename=document.createElement('button');rename.textContent='✎';rename.title='Cambiar nombre de pista';rename.onclick=()=>{const n=prompt('Nombre de la pista',t.name);if(n?.trim())update(ts=>{const x=ts.find(z=>z.id===t.id);if(x)x.name=n.trim();});};const remove=document.createElement('button');remove.textContent='×';remove.title='Eliminar pista';remove.onclick=()=>{if(confirm('¿Eliminar la pista «'+t.name+'» y todos sus elementos?'))update(ts=>{const n=ts.findIndex(z=>z.id===t.id);if(n>=0)ts.splice(n,1);});};controls.append(up,down,rename,remove);head.append(controls);
 });
}
function decorateBlocks(root){
 const px=20*(Number(window.__cfNleZoom)||1);
 root.querySelectorAll('.cf-nle-block').forEach(block=>{
  if(block.dataset.trimReady)return;block.dataset.trimReady='1';
  const trackRow=block.closest('.cf-nle-track'),trackIndex=[...root.querySelectorAll('.cf-nle-track')].indexOf(trackRow),p=project(),t=(p.tracks||[])[trackIndex],id=block.dataset.itemId||null;
  // Recover the selected timeline item by its visible position and label.
  const lane=block.parentElement,blocks=[...lane.querySelectorAll('.cf-nle-block')],itemIndex=blocks.indexOf(block),item=t?.items?.[itemIndex];if(!item)return;
  block.dataset.itemId=item.id;
  ['left','right'].forEach(edge=>{const h=document.createElement('i');h.className='cf-nle-trim '+edge;h.title=edge==='left'?'Recortar inicio':'Recortar final';block.append(h);h.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();if(t.locked)return;const start=item.start,end=item.end,x=e.clientX;h.setPointerCapture?.(e.pointerId);let delta=0;const lane=block.parentElement,duration=Math.max(30,...(p.tracks||[]).flatMap(z=>(z.items||[]).map(q=>Number(q.end)||0))),px=Math.max(1,lane.scrollWidth/duration);const move=ev=>{delta=(ev.clientX-x)/px;};const stop=()=>{window.removeEventListener('pointermove',move);update(ts=>{const target=ts.find(z=>z.id===t.id)?.items.find(z=>z.id===item.id);if(!target)return;if(edge==='left'){const next=Math.max(0,Math.min(end-.15,start+delta));const diff=next-start;target.start=next;target.sourceStart=Math.max(0,Number(target.sourceStart||0)+diff);}else target.end=Math.max(start+.15,end+delta);});window.removeEventListener('pointerup',stop);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop,{once:true});});});
 });
}
function decorateInspector(root){
 const el=root.querySelector('#cfNleInspector');if(!el)return;
 const chosen=root.querySelector('.cf-nle-block.selected');if(!chosen)return;
 const id=chosen.dataset.itemId;if(!id||(el.dataset.fxEnhanced===id&&el.querySelector('.cf-nle-extra-inspector')))return;
 const p=project(),track=(p.tracks||[]).find(t=>t.items?.some(i=>i.id===id)),item=track?.items.find(i=>i.id===id);if(!item)return;
 el.dataset.fxEnhanced=id;
 const group=document.createElement('div');group.className='cf-nle-extra-inspector';
 const add=(label,key,type='number',min='0',max='1',step='.05')=>{const l=document.createElement('label');l.textContent=label;const x=document.createElement('input');x.type=type;x.dataset.extra=key;if(type==='number'||type==='range'){x.min=min;x.max=max;x.step=step;}x.value=item[key]??(key==='opacity'||key==='volume'?1:0);l.append(x);group.append(l);};
 const select=(label,key,opts)=>{const l=document.createElement('label');l.textContent=label;const x=document.createElement('select');x.dataset.extra=key;opts.forEach(([v,n])=>{const o=document.createElement('option');o.value=v;o.textContent=n;x.append(o)});x.value=item[key]||opts[0][0];l.append(x);group.append(l);};
 if(track.type==='video'){add('Opacidad','opacity','range','0','1','.05');add('Velocidad','speed','number','.25','4','.05');select('Entrada','transitionIn',[['none','Sin transición'],['fade','Fundido'],['wipe','Barrido']]);select('Salida','transitionOut',[['none','Sin transición'],['fade','Fundido'],['wipe','Barrido']]);add('Duración de transición (s)','transitionDuration','number','0','3','.1');}
 if(track.type==='audio'){add('Volumen','volume','range','0','1','.05');add('Fundido entrada (s)','fadeIn','number','0','10','.1');add('Fundido salida (s)','fadeOut','number','0','10','.1');}
 if(track.type==='text'||track.type==='subtitles'){add('Opacidad','opacity','range','0','1','.05');add('Contorno (px)','outlineWidth','number','0','12','1');}
 if(group.children.length){const title=document.createElement('b');title.textContent='TRANSFORMACIÓN Y EFECTOS';title.style.cssText='display:block;color:#8ddfc1;font-size:10px;letter-spacing:1px;margin:16px 0 8px';el.append(title,group);group.querySelectorAll('[data-extra]').forEach(x=>x.addEventListener('change',()=>{update(ts=>{const target=ts.find(t=>t.id===track.id)?.items.find(i=>i.id===id);if(!target)return;target[x.dataset.extra]=x.tagName==='SELECT'?x.value:Number(x.value);});}));}
}
function syncAudio(){
 const p=project(),time=Number($('#cfNleSeek')?.value)||0,tracks=p.tracks||[],active=new Set();const vt=tracks.find(t=>t.type==='video'&&!t.hidden);const vv=$('#cfNleVideo');if(vv)vv.muted=!!vt?.muted;applyVisualEffects(tracks,time);
 tracks.filter(t=>t.type==='audio'&&!t.hidden&&!t.muted).forEach(t=>t.items.forEach(i=>{
  if(!i.url||time<Number(i.start)||time>=Number(i.end))return;
  active.add(i.id);let a=audioNodes.get(i.id);if(!a){a=new Audio(i.url);a.preload='auto';audioNodes.set(i.id,a);}
  const wanted=Math.max(0,Number(i.sourceStart||0)+time-Number(i.start));if(Math.abs(a.currentTime-wanted)>.35)try{a.currentTime=wanted}catch{}
  const local=time-Number(i.start),remain=Number(i.end)-time,fi=Math.max(.01,Number(i.fadeIn)||0),fo=Math.max(.01,Number(i.fadeOut)||0);let gain=Math.max(0,Math.min(1,Number(i.volume??1)));if(Number(i.fadeIn)>0)gain*=Math.min(1,local/fi);if(Number(i.fadeOut)>0)gain*=Math.min(1,remain/fo);a.volume=gain;if($('#cfNlePlay')?.textContent.includes('Ⅱ')&&a.paused)a.play().catch(()=>{});
 }));
 for(const [id,a] of audioNodes){if(!active.has(id)){a.pause();}}
}
function applyVisualEffects(tracks,time){
 const v=$('#cfNleVideo');if(!v)return;const t=tracks.find(x=>x.type==='video'&&!x.hidden),i=t?.items.find(x=>time>=Number(x.start)&&time<Number(x.end));if(!i)return;
 const duration=Math.max(.01,Number(i.transitionDuration)||.5),elapsed=time-Number(i.start),remaining=Number(i.end)-time;
 let alpha=Math.max(0,Math.min(1,Number(i.opacity??1)));
 if(i.transitionIn==='fade')alpha*=Math.min(1,elapsed/duration);
 if(i.transitionOut==='fade')alpha*=Math.min(1,remaining/duration);
 v.style.opacity=String(alpha);v.playbackRate=Math.max(.25,Math.min(4,Number(i.speed)||1));
 if(i.transitionIn==='wipe'&&elapsed<duration)v.style.clipPath='inset(0 '+(100*(1-elapsed/duration))+'% 0 0)';
 else if(i.transitionOut==='wipe'&&remaining<duration)v.style.clipPath='inset(0 '+(100*(1-remaining/duration))+'% 0 0)';
 else v.style.clipPath='none';
}
function wireAudio(){
 const play=$('#cfNlePlay'),seek=$('#cfNleSeek'),v=$('#cfNleVideo');if(play&&!play.dataset.audioWired){play.dataset.audioWired='1';play.addEventListener('click',()=>{setTimeout(()=>{if(play.textContent.includes('Ⅱ'))syncAudio();else audioNodes.forEach(a=>a.pause());},30);});}
 if(seek&&!seek.dataset.audioWired){seek.dataset.audioWired='1';seek.addEventListener('input',()=>{audioNodes.forEach(a=>a.pause());syncAudio();});}
 if(v&&!v.dataset.audioWired){v.dataset.audioWired='1';v.addEventListener('timeupdate',syncAudio);v.addEventListener('pause',()=>audioNodes.forEach(a=>a.pause()));}
}
async function exportTimeline(){
 const format=n=>{n=Math.max(0,Number(n)||0);return String(Math.floor(n/60)).padStart(2,'0')+':'+String(Math.floor(n%60)).padStart(2,'0')+'.'+String(Math.floor(n%1*100)).padStart(2,'0')};
 if(typeof MediaRecorder==='undefined'||!HTMLCanvasElement.prototype.captureStream){status('La exportación necesita un navegador con MediaRecorder y captura de canvas. Usa Chrome, Edge o Safari actualizado.');return;}
 const p=project(),tracks=p.tracks||[],items=tracks.flatMap(t=>t.items.map(i=>({track:t,item:i}))),end=Math.max(0,...items.map(x=>Number(x.item.end)||0));
 if(!end){status('La línea de tiempo está vacía.');return;}
 const videos=items.filter(x=>x.track.type==='video'&&x.item.kind!=='image'&&!x.track.hidden);
 const images=items.filter(x=>x.track.type==='video'&&x.item.kind==='image'&&!x.track.hidden);
 const audios=items.filter(x=>x.track.type==='audio'&&!x.track.hidden&&!x.track.muted);
 const texts=items.filter(x=>(x.track.type==='text'||x.track.type==='subtitles')&&!x.track.hidden);
 const source=$('#cfNleVideo')?.currentSrc||$('#cfNleVideo')?.src;
 const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;
 const ctx=canvas.getContext('2d',{alpha:false});const drawCover=(el,x,y,w,h)=>{const sw=el.videoWidth||el.naturalWidth||w,sh=el.videoHeight||el.naturalHeight||h,sr=sw/sh,tr=w/h;let sx=0,sy=0,sw2=sw,sh2=sh;if(sr>tr){sw2=sh*tr;sx=(sw-sw2)/2}else{sh2=sw/tr;sy=(sh-sh2)/2}ctx.drawImage(el,sx,sy,sw2,sh2,x,y,w,h)};if(!ctx){status('No se pudo iniciar el compositor.');return;}
 const AudioCtx=window.AudioContext||window.webkitAudioContext,ac=AudioCtx?new AudioCtx():null,dest=ac?ac.createMediaStreamDestination():null;
 const media=new Map(),audio=new Map(),nodes=[];
 const loadMedia=(x)=>new Promise((resolve,reject)=>{
  const url=x.item.url||(x.item.assetId==='source'?source:source);
  if(!url){reject(Error('Falta el archivo de vídeo de '+(x.item.title||'un clip')+'. Reimpórtalo.'));return;}
  if(x.item.kind==='image'){const el=new Image();el.onload=()=>resolve(el);el.onerror=()=>reject(Error('No se pudo cargar la imagen '+x.item.title));el.src=url;media.set(x.item.id,el);return;}
  const el=document.createElement('video');el.preload='auto';el.playsInline=true;el.src=url;el.muted=false;
  el.onloadedmetadata=()=>{media.set(x.item.id,el);if(ac){try{const node=ac.createMediaElementSource(el),gain=ac.createGain();node.connect(gain);gain.connect(dest);nodes.push({item:x.item,track:x.track,gain});}catch(e){console.warn(e)}}resolve(el)};
  el.onerror=()=>reject(Error('No se pudo decodificar '+(x.item.title||'un vídeo')));el.load();
 });
 const button=$('#cfNleExport');if(button)button.disabled=true;
 let recorder=null,raf=0,stopped=false;
 const stop=()=>{stopped=true;if(raf)cancelAnimationFrame(raf);for(const el of media.values())if(el.tagName==='VIDEO')el.pause();for(const el of audio.values())el.pause();if(recorder&&recorder.state!=='inactive')recorder.stop();};
 try{
  status('Preparando medios y pistas…');
  await Promise.all(videos.map(loadMedia));
  for(const x of images)await loadMedia(x);
  for(const x of audios){
   if(!x.item.url)throw Error('Falta el archivo de audio '+(x.item.title||'importado')+'.');
   const el=new Audio(x.item.url);el.preload='auto';await new Promise((res,rej)=>{el.oncanplaythrough=res;el.onerror=()=>rej(Error('No se pudo cargar el audio '+x.item.title));el.load()});
   audio.set(x.item.id,el);
   if(ac){const node=ac.createMediaElementSource(el),gain=ac.createGain();node.connect(gain);gain.connect(dest);nodes.push({item:x.item,gain});}
  }
  if(ac)await ac.resume();
  const stream=canvas.captureStream(30);if(dest)dest.stream.getAudioTracks().forEach(t=>stream.addTrack(t));
  const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(x=>MediaRecorder.isTypeSupported(x));
  if(!mime)throw Error('Este navegador no permite grabar el vídeo. Prueba Chrome o Edge actualizado.');
  const chunks=[];recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:8000000,audioBitsPerSecond:192000});
  const finished=new Promise((resolve,reject)=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.onerror=()=>reject(Error('Falló la grabación del vídeo.'));recorder.onstop=()=>resolve(new Blob(chunks,{type:mime.split(';')[0]}));});
  recorder.start(1000);const started=performance.now();let lastStatus=0;
  const draw=()=>{
   if(stopped)return;
   const time=Math.min(end,(performance.now()-started)/1000);
   ctx.fillStyle='#000';ctx.fillRect(0,0,1080,1920);
   const active=videos.filter(x=>time>=Number(x.item.start)&&time<Number(x.item.end)).sort((a,b)=>tracks.indexOf(a.track)-tracks.indexOf(b.track));const activeIds=new Set(active.map(x=>x.item.id));media.forEach((el,id)=>{if(el.tagName==='VIDEO'&&!activeIds.has(id)&&!el.paused)el.pause()});
   active.forEach(x=>{
    const el=media.get(x.item.id),i=x.item;if(!el)return;
    const wanted=Math.max(0,Number(i.sourceStart||0)+time-Number(i.start));
    if(el.tagName==='VIDEO'){
     if(Math.abs(el.currentTime-wanted)>.4){try{el.currentTime=wanted}catch(e){}}
     el.playbackRate=Math.max(.25,Math.min(4,Number(i.speed)||1));if(el.paused)el.play().catch(()=>{});
     const d=Math.max(.01,Number(i.transitionDuration)||.5),local=time-Number(i.start),remain=Number(i.end)-time;let alpha=Number(i.opacity??1);
     if(i.transitionIn==='fade')alpha*=Math.min(1,local/d);if(i.transitionOut==='fade')alpha*=Math.min(1,remain/d);
     ctx.globalAlpha=Math.max(0,Math.min(1,alpha));ctx.filter=({cinematic:'contrast(1.15) saturate(.85)',warm:'sepia(.2) saturate(1.2)',cool:'hue-rotate(12deg)',bw:'grayscale(1)'}[i.filterPreset]||'none');
     const scale=Math.max(.1,Number(i.scale)||1),w=1080*scale,h=1920*scale;ctx.save();if(i.transitionIn==='wipe'&&local<d){ctx.beginPath();ctx.rect(0,0,1080,1920*Math.min(1,local/d));ctx.clip();}if(i.transitionOut==='wipe'&&remain<d){ctx.beginPath();ctx.rect(0,0,1080,1920*Math.min(1,remain/d));ctx.clip();}ctx.translate(540,960);ctx.rotate((Number(i.rotation)||0)*Math.PI/180);drawCover(el,-w/2,-h/2,w,h);ctx.restore();ctx.filter='none';ctx.globalAlpha=1;
    }
   });
   images.filter(x=>time>=Number(x.item.start)&&time<Number(x.item.end)).forEach(x=>{const el=media.get(x.item.id);if(el)drawCover(el,0,0,1080,1920)});
   texts.filter(x=>time>=Number(x.item.start)&&time<Number(x.item.end)).forEach(x=>{
    const i=x.item,txt=String(i.text||'');if(!txt)return;ctx.save();ctx.globalAlpha=Number(i.opacity??1);ctx.font='800 '+Math.max(12,Number(i.fontSize)||42)+'px Arial';ctx.textAlign='center';ctx.textBaseline='middle';const xx=Number(i.x??.5)*1080,yy=Number(i.y??.82)*1920;ctx.lineWidth=Number(i.outlineWidth)||5;ctx.strokeStyle=i.outlineColor||'#000';ctx.fillStyle=i.color||'#fff';ctx.strokeText(txt,xx,yy,980);ctx.fillText(txt,xx,yy,980);ctx.restore();
   });
   nodes.forEach(n=>{const i=n.item,local=time-Number(i.start),remain=Number(i.end)-time;let g=n.track?.muted?0:Math.max(0,Math.min(1,Number(i.volume??1)));if(i.fadeIn>0)g*=Math.min(1,local/Number(i.fadeIn));if(i.fadeOut>0)g*=Math.min(1,remain/Number(i.fadeOut));n.gain.gain.value=g});
   audios.forEach(x=>{const i=x.item,el=audio.get(i.id),on=time>=Number(i.start)&&time<Number(i.end);if(!el)return;if(on){const wanted=Math.max(0,Number(i.sourceStart||0)+time-Number(i.start));if(Math.abs(el.currentTime-wanted)>.5)try{el.currentTime=wanted}catch(e){}if(el.paused)el.play().catch(()=>{});}else if(!el.paused)el.pause();});
   if(performance.now()-lastStatus>500){status('Exportando '+Math.floor(time/end*100)+'% · '+format(time)+' / '+format(end));lastStatus=performance.now();}
   if(time>=end){stop();return;}raf=requestAnimationFrame(draw);
  };
  draw();
  const blob=await finished;if(blob.size<2048)throw Error('La grabación ha quedado vacía.');
  status('Convirtiendo a MP4 con FFmpeg…');
  const form=new FormData();form.append('video',blob,'clipforge-timeline.'+(mime.includes('mp4')?'mp4':'webm'));
  const response=await fetch('/api/editor/export',{method:'POST',body:form});const result=await response.json();if(!response.ok||!result.download_url)throw Error(result.message||result.error||'No se pudo convertir el MP4.');
  const a=document.createElement('a');a.href=result.download_url;a.download=(String(p.projectName||'ClipForge').replace(/[^a-z0-9_-]/gi,'_')||'ClipForge')+'.mp4';document.body.append(a);a.click();a.remove();status('MP4 exportado correctamente.');
 }catch(e){stop();status('Error de exportación: '+e.message);console.error(e);}
 finally{if(button)button.disabled=false;if(ac)ac.close().catch(()=>{});}
}
function patchBridge(){
 const b=bridge();if(!b||b.__nleEnhanced)return;
 const get=b.getProject.bind(b),set=b.setTracks.bind(b),name=b.setProjectName?.bind(b);
 b.getProject=()=>({...get(),projectName:$('#cfNleName')?.value||localStorage.getItem('clipforge.nle.name')||'Mi proyecto'});
 b.setTracks=v=>{set(v);queueMicrotask(()=>install());};
 b.setProjectName=n=>{name?.(n);if($('#cfNleName'))$('#cfNleName').value=n;};
 b.__nleEnhanced=true;
}
function style(){if($('#cfNleEnhancementStyle'))return;const s=document.createElement('style');s.id='cfNleEnhancementStyle';s.textContent='.cf-nle-track-controls{display:flex;gap:3px;flex-wrap:wrap;margin-top:6px}.cf-nle-track-controls button{padding:3px 5px;font-size:10px}.cf-nle-track-controls button.is-on{background:#365d54;border-color:#7adbb9}.cf-nle-block{padding-left:10px;padding-right:10px}.cf-nle-trim{position:absolute;top:0;bottom:0;width:7px;background:#d7f6e9aa;cursor:ew-resize;z-index:5}.cf-nle-trim.left{left:0;border-radius:5px 0 0 5px}.cf-nle-trim.right{right:0;border-radius:0 5px 5px 0}.cf-nle button:focus-visible,.cf-nle input:focus-visible{outline:2px solid #8de3c4;outline-offset:2px}.cf-nle-track-head{min-width:132px}.cf-nle-track:has(.cf-nle-track-head .cf-nle-track-controls button.is-on[title="Ocultar pista"]){opacity:.65}';document.head.append(s);}
function init(){patchBridge();style();install();const exportButton=$('#cfNleExport');if(exportButton&&!exportButton.dataset.timelineExport){exportButton.dataset.timelineExport='1';exportButton.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();exportTimeline();},true);}}
document.addEventListener('DOMContentLoaded',init);window.addEventListener('clipforge:editor-ready',init);window.addEventListener('clipforge:open-editor',()=>setTimeout(init,0));window.addEventListener('clipforge:clips-updated',()=>setTimeout(init,0));new MutationObserver(init).observe(document.body,{childList:true,subtree:true});
})();