(()=>{'use strict';
const $=s=>document.querySelector(s),clone=x=>JSON.parse(JSON.stringify(x)),uid=()=>('nle-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7));
let installed=false,observer=null;
const bridge=()=>window.clipforgeEditorBridge;
function project(){return bridge()?.getProject?.()||{}}
function update(mutator){const b=bridge(),p=project(),tracks=clone(p.tracks||[]);mutator(tracks);b?.setTracks?.(tracks);window.dispatchEvent(new CustomEvent('clipforge:nle-changed'));}
function status(m){const e=$('#cfNleStatus');if(e)e.textContent=m;}
function install(){
 const root=$('#cfNle');if(!root)return;
 const name=$('#cfNleName');if(name&&!name.dataset.enhanced){name.dataset.enhanced='1';name.placeholder='Nombre del proyecto';name.addEventListener('change',()=>{const b=bridge();b?.setProjectName?.(name.value.trim()||'Proyecto sin título');status('Nombre actualizado · guarda en Drive para sincronizarlo');});}
 const head=root.querySelector('.cf-nle-head');
 if(head&&!$('#cfNleNewProject')){const b=document.createElement('button');b.id='cfNleNewProject';b.textContent='＋ Nuevo proyecto';b.title='Crear un proyecto vacío';b.onclick=()=>{if(!confirm('¿Crear un proyecto nuevo? Guarda antes los cambios actuales.'))return;update(t=>t.forEach(x=>x.items=[]));if(name)name.value='Mi proyecto';bridge()?.setProjectName?.('Mi proyecto');status('Proyecto nuevo listo');};head.insertBefore(b,$('#cfNleSave'));}
 const tools=root.querySelector('.cf-nle-tools');
 if(tools&&!$('#cfNleAddAudio')){const b=document.createElement('button');b.id='cfNleAddAudio';b.textContent='＋ Importar audio';b.onclick=()=>{const i=document.createElement('input');i.type='file';i.accept='audio/*';i.onchange=()=>{const f=i.files?.[0];if(!f)return;const url=URL.createObjectURL(f),a=new Audio();a.onloadedmetadata=()=>{const d=a.duration||5;update(ts=>{let t=ts.find(x=>x.type==='audio');if(!t){t={id:uid(),type:'audio',name:'A2 · Música',items:[]};ts.push(t);}t.items.push({id:uid(),kind:'audio',title:f.name,url,assetName:f.name,start:Number($('#cfNleSeek')?.value)||0,end:(Number($('#cfNleSeek')?.value)||0)+d,sourceStart:0,volume:1});});status('Audio añadido a la línea de tiempo.');};a.src=url;};i.click();};tools.insertBefore(b,tools.querySelector('span'));}
 if(tools&&!$('#cfNleAddVideo')){const b=document.createElement('button');b.id='cfNleAddVideo';b.textContent='＋ Importar vídeo/imagen';b.onclick=()=>$('#cfNleImport')?.click();tools.insertBefore(b,tools.querySelector('span'));}
 if(!observer){observer=new MutationObserver(()=>{decorateTracks(root);decorateBlocks(root);});observer.observe(root,{childList:true,subtree:true});}
 decorateTracks(root);decorateBlocks(root);
}
function decorateTracks(root){
 root.querySelectorAll('.cf-nle-track').forEach((row,index)=>{
  const head=row.querySelector('.cf-nle-track-head');if(!head||head.dataset.enhanced)return;head.dataset.enhanced='1';
  const p=project(),t=(p.tracks||[])[index];if(!t)return;
  const controls=document.createElement('div');controls.className='cf-nle-track-controls';
  [['🔒','locked','Bloquear pista'],['♫','muted','Silenciar pista'],['◉','hidden','Ocultar pista']].forEach(([label,key,title])=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.title=title;b.className=t[key]?'is-on':'';b.onclick=e=>{e.stopPropagation();update(ts=>{const x=ts.find(z=>z.id===t.id);if(x)x[key]=!x[key];});};controls.append(b);});
  const up=document.createElement('button');up.textContent='↑';up.title='Subir pista';up.onclick=()=>update(ts=>{const n=ts.findIndex(x=>x.id===t.id);if(n>0)[ts[n-1],ts[n]]=[ts[n],ts[n-1]];});
  const down=document.createElement('button');down.textContent='↓';down.title='Bajar pista';down.onclick=()=>update(ts=>{const n=ts.findIndex(x=>x.id===t.id);if(n>=0&&n<ts.length-1)[ts[n+1],ts[n]]=[ts[n],ts[n+1]];});
  controls.append(up,down);head.append(controls);
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
  ['left','right'].forEach(edge=>{const h=document.createElement('i');h.className='cf-nle-trim '+edge;h.title=edge==='left'?'Recortar inicio':'Recortar final';block.append(h);h.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();if(t.locked)return;const start=item.start,end=item.end,x=e.clientX;h.setPointerCapture?.(e.pointerId);let delta=0;const move=ev=>{delta=(ev.clientX-x)/20;};const stop=()=>{window.removeEventListener('pointermove',move);update(ts=>{const target=ts.find(z=>z.id===t.id)?.items.find(z=>z.id===item.id);if(!target)return;if(edge==='left'){const next=Math.max(0,Math.min(end-.15,start+delta));const diff=next-start;target.start=next;target.sourceStart=Math.max(0,Number(target.sourceStart||0)+diff);}else target.end=Math.max(start+.15,end+delta);});window.removeEventListener('pointerup',stop);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop,{once:true});});});
 });
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
function init(){patchBridge();style();install();}
document.addEventListener('DOMContentLoaded',init);window.addEventListener('clipforge:editor-ready',init);window.addEventListener('clipforge:open-editor',()=>setTimeout(init,0));window.addEventListener('clipforge:clips-updated',()=>setTimeout(init,0));new MutationObserver(init).observe(document.body,{childList:true,subtree:true});
})();