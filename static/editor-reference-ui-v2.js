(()=>{'use strict';
const $=(s,r=document)=>r?.querySelector(s)||null;
const fmt=n=>{n=Math.max(0,Number(n)||0);const m=Math.floor(n/60),s=Math.floor(n%60);return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')};
let activeClip=null,observer=null;
function project(){return window.clipforgeEditorBridge?.getProject?.()||window.clipforgeEditor?.getProject?.()||{}}
function clips(){const p=project(),tracks=window.clipforgeNleGetTracks?.()||p.tracks||[];return tracks.filter(t=>t.type==='video').flatMap(t=>(t.items||[]).map(i=>({track:t,item:i}))).filter(x=>x.item.kind==='clip'||x.item.kind==='video'||x.item.assetId==='source')}
function makeNav(slot){if($('.cf-ref2-nav',slot))return;const nav=document.createElement('header');nav.className='cf-ref2-nav';nav.innerHTML='<a class="cf-ref2-brand" href="#cfCreate"><span class="mark">▶</span>ClipForge <small>PRO</small></a><nav class="cf-ref2-links"><a href="#cfCreate">Inicio</a><a href="#cfCreate">Nuevo proyecto</a><a class="active" href="#cfEditor">Editor</a><a href="#cfResults">Proyectos</a></nav><div class="cf-ref2-account"><span>4 / 12 clips hoy</span><i class="cf-ref2-meter"><i></i></i><button class="cf-ref2-theme" type="button" title="Cambiar tema">☾</button><b class="cf-ref2-avatar">H</b></div>';nav.querySelector('.cf-ref2-theme').addEventListener('click',()=>document.body.classList.toggle('cf-ref2-light'));slot.insertBefore(nav,slot.firstChild)}
function makePanel(work){let panel=$('.cf-ref2-clips',work);if(panel)return panel;panel=document.createElement('aside');panel.className='cf-ref2-clips';panel.innerHTML='<h2><span>✦</span> Clips generados (<b data-count>0</b>)</h2><div data-list></div><button class="cf-ref2-add" type="button">＋ Añadir clip</button>';const center=$('.cf-nle-center',work);work.insertBefore(panel,center);panel.querySelector('.cf-ref2-add').addEventListener('click',()=>{const p=project(),tracks=window.clipforgeNleGetTracks?.()||p.tracks||[],v=tracks.find(t=>t.type==='video');if(v&&v.items?.length){const last=v.items[v.items.length-1];window.clipforgeEditorCheckpoint?.();const copy=JSON.parse(JSON.stringify(last));copy.id='clip-'+Date.now();copy.title=(last.title||'Clip')+' (copia)';copy.start=Number(last.end)+.25;copy.end=copy.start+(Number(last.end)-Number(last.start));v.items.push(copy);window.clipforgeNleReplaceTracks?.(tracks);window.dispatchEvent(new CustomEvent('clipforge:nle-changed'));renderClips()}else{window.clipforgeNleReplaceTracks?.([{id:'v1',type:'video',name:'V1 · Vídeo',items:[]}]);renderClips()}});return panel}
function renderClips(){const root=$('#cfNle'),work=$('.cf-nle-work',root||document);if(!work)return;const panel=makePanel(work),list=$('[data-list]',panel),items=clips();$('[data-count]',panel).textContent=items.length;list.innerHTML='';items.forEach(({track,item},index)=>{const b=document.createElement('button');b.type='button';b.className='cf-ref2-clip'+(activeClip===item.id?' active':'');const title=item.title||item.name||('Clip '+(index+1));b.innerHTML='<span class="cf-ref2-thumb">▶</span><span><b></b><small></small></span><span>⋮</span>';b.querySelector('b').textContent=(index+1)+'  '+title;b.querySelector('small').textContent=fmt(item.start)+' – '+fmt(item.end)+' ('+Math.round(Math.max(0,item.end-item.start))+' s)';b.addEventListener('click',()=>{activeClip=item.id;const node=$('#cfNle')?.querySelector('[data-item-id="'+CSS.escape(item.id)+'"]');if(node)node.click();else window.clipforgeEditor?.select?.(track.id,item.id);renderClips()});list.append(b)});const media=$('.cf-nle-media',work);if(media&&!$('.cf-ref2-status',media)){const source=document.createElement('div');source.className='cf-ref2-source';source.innerHTML='<i>▶</i><span><b>Vídeo del proyecto</b><small>Fuente multimedia</small></span>';media.insertBefore(source,media.firstChild);const status=document.createElement('div');status.className='cf-ref2-status';status.innerHTML='<span>Transcripción y análisis</span><span>'+items.length+' clips en el proyecto</span><span>Editor multipista activo</span>';media.insertBefore(status,source.nextSibling)}}
/* Layout lock for final reference composition: panel areas follow the four-panel reference. */
function lockReferenceLayout(){
 const root=$('#cfNle'),work=$('.cf-nle-work',root);if(!root||!work)return;
 root.style.setProperty('display','grid','important');
 root.style.setProperty('grid-template-columns','minmax(0,1fr)','important');
 root.style.setProperty('grid-template-rows','minmax(0,1fr) 56px 42px minmax(210px,24vh)','important');
 root.style.setProperty('height','calc(100vh - 74px)','important');
 root.style.setProperty('min-height','0','important');
 work.style.setProperty('display','grid','important');
 work.style.setProperty('grid-template-columns','minmax(250px,16.5%) minmax(320px,21.5%) minmax(400px,1fr) minmax(380px,28%)','important');
 work.style.setProperty('grid-template-areas','"sidebar clips preview inspector"','important');
 work.style.setProperty('grid-template-rows','minmax(0,1fr)','important');
 const media=$('.cf-nle-media',work),center=$('.cf-nle-center',work),inspector=$('.cf-nle-inspector',work),panel=$('.cf-ref2-clips',work);
 if(media)media.style.setProperty('grid-area','sidebar','important');
 if(center)center.style.setProperty('grid-area','preview','important');
 if(inspector)inspector.style.setProperty('grid-area','inspector','important');
 if(panel){panel.style.setProperty('display','flex','important');panel.style.setProperty('grid-area','clips','important');panel.style.setProperty('flex-direction','column','important');}
 const timeline=$('.cf-nle-timeline',root);if(timeline)timeline.style.setProperty('min-height','0','important');
}
function mount(){const root=$('#cfNle');if(!root)return false;const slot=root.parentElement;if(!slot)return false;makeNav(slot);const work=$('.cf-nle-work',root);if(!work)return false;makePanel(work);work.style.gridTemplateColumns='minmax(250px,16.5%) minmax(320px,21.5%) minmax(400px,1fr) minmax(380px,28%)';work.style.gridTemplateAreas='"sidebar clips preview inspector"';renderClips();const back=$('#cfNleBack');if(back)back.style.display='none';return true}
function start(){if(!mount())return;window.addEventListener('clipforge:clips-updated',()=>{renderClips();lockReferenceLayout()});window.addEventListener('clipforge:nle-changed',renderClips);window.addEventListener('clipforge:editor-ready',renderClips);window.addEventListener('clipforge:open-editor',renderClips);renderClips()}
window.addEventListener('clipforge:editor-ready',start);window.addEventListener('clipforge:open-editor',start);window.addEventListener('clipforge:editor-visible',start);window.addEventListener('clipforge:clips-updated',start);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
/* Reference v3: left navigation, source/project cards and frame thumbnails. */
(()=>{'use strict';
 const $=(s,r=document)=>r?.querySelector(s)||null;
 const fmt=n=>{n=Math.max(0,Number(n)||0);return String(Math.floor(n/60)).padStart(2,'0')+':'+String(Math.floor(n%60)).padStart(2,'0')};
 function decorate(){
  const root=$('#cfNle'),media=$('.cf-nle-media',root),work=$('.cf-nle-work',root);if(!root||!media||!work)return false;
  if(!$('.cf-ref2-sidebar',media)){
   const side=document.createElement('div');side.className='cf-ref2-sidebar';
   side.innerHTML='<div class="cf-ref2-source-card"><div class="cf-ref2-source-thumb">▶</div><div class="cf-ref2-source-meta"><b>Vídeo del proyecto</b><small>Fuente original · 3:33</small></div></div><div class="cf-ref2-checks"><div><i>✓</i> Transcripción completa</div><div><i>✓</i> Momentos detectados</div><div><i>✓</i> Clips seleccionados</div></div><button class="cf-ref2-sidebar-active" type="button"><span>▣</span> Editor de clips</button><div class="cf-ref2-project-label">Proyecto</div><button class="cf-ref2-side-link" type="button"><span>▤</span> Subtítulos (SRT)</button><button class="cf-ref2-side-link" type="button"><span>⚙</span> Ajustes de formato</button><button class="cf-ref2-side-link" type="button"><span>⇧</span> Exportación</button><div class="cf-ref2-project-card"><b>Proyecto actual</b><strong>4 clips · 1080×1920</strong><span><i></i></span></div>';
   media.prepend(side);
   const file=$('#video'),name=$('#filename');if(file){file.addEventListener('change',()=>{const f=file.files?.[0];if(f){const b=$('.cf-ref2-source-meta b',side),sm=$('.cf-ref2-source-meta small',side);if(b)b.textContent=f.name;if(sm)sm.textContent='Vídeo original · '+(f.type||'vídeo');}})}
  }
  const nav=$('.cf-ref2-nav');if(nav){const brand=$('.cf-ref2-brand',nav);if(brand&&!brand.dataset.v3){brand.dataset.v3='1';brand.innerHTML='<span class="cf-ref2-brand-icon">▶</span><b>ClipForge</b><small>PRO</small>';}}
  const items=[...clips()];const list=$('[data-list]',work);if(list){items.forEach(({item},i)=>{const b=list.children[i];if(!b)return;const thumb=$('.cf-ref2-thumb',b);if(thumb&&!thumb.dataset.frame){thumb.dataset.frame='pending';thumb.textContent=String(i+1).padStart(2,'0');thumb.classList.add('cf-ref2-thumb-number');}})}
  return true;
 }
 function clips(){const p=window.clipforgeEditorBridge?.getProject?.()||window.clipforgeEditor?.getProject?.()||{},ts=window.clipforgeNleGetTracks?.()||p.tracks||[];return ts.filter(t=>t.type==='video').flatMap(t=>(t.items||[]).map(item=>({track:t,item}))).filter(x=>['clip','video'].includes(x.item.kind)||x.item.assetId==='source')}
 const run=()=>{decorate();lockReferenceLayout()};window.addEventListener('clipforge:editor-ready',run);window.addEventListener('clipforge:open-editor',run);window.addEventListener('clipforge:editor-visible',run);window.addEventListener('clipforge:clips-updated',run);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();
})();


/* Compact responsive layout rules: valid standalone stylesheet injection. */
(()=>{if(document.getElementById('cf-reference-final-layout'))return;const s=document.createElement('style');s.id='cf-reference-final-layout';s.textContent = `
:root{--cf-bg:#0c0e17;--cf-panel:#111522;--cf-line:#282d40;--cf-purple:#8b43f5}
html:has(#cfNle),body:has(#cfNle){height:100%!important;overflow:hidden!important;background:#0c0e17!important}
body:has(#cfNle) .cf-opus-editor-slot{height:100vh!important;display:grid!important;grid-template-rows:74px minmax(0,1fr)!important;overflow:hidden!important;gap:0!important}
body:has(#cfNle) .cf-ref2-nav{height:74px!important;min-height:74px!important;grid-template-columns:275px minmax(300px,1fr) 330px!important;padding:0 25px!important;background:#0b0e17!important;border-bottom:1px solid #282d40!important}
body:has(#cfNle) #cfNle{display:grid!important;grid-template-columns:minmax(0,1fr)!important;grid-template-rows:minmax(0,1fr) 46px 26px minmax(190px,28vh)!important;gap:0!important;width:100%!important;height:calc(100vh - 74px)!important;min-height:0!important;max-height:none!important;overflow:hidden!important;border:0!important;border-radius:0!important;background:#0c0e17!important;box-shadow:none!important}
body:has(#cfNle) #cfNle>.cf-nle-head{display:none!important}
body:has(#cfNle) #cfNle>.cf-nle-work{display:grid!important;grid-template-columns:154px 238px minmax(360px,1fr) 326px!important;grid-template-areas:"sidebar clips preview inspector"!important;grid-template-rows:minmax(0,1fr)!important;gap:0!important;min-height:0!important;overflow:hidden!important}
body:has(#cfNle) #cfNle .cf-nle-media{grid-area:sidebar!important;display:flex!important;min-width:0!important;overflow:auto!important;padding:9px!important;background:#0d111c!important}
body:has(#cfNle) #cfNle .cf-ref2-sidebar{width:100%!important;min-height:100%!important}
body:has(#cfNle) #cfNle .cf-ref2-source-card{min-height:45px!important;padding:6px!important;margin-bottom:8px!important}
body:has(#cfNle) #cfNle .cf-ref2-source-thumb{width:28px!important;height:28px!important;flex-basis:28px!important}
body:has(#cfNle) #cfNle .cf-ref2-checks{gap:7px!important;padding:4px 2px 9px!important;margin-bottom:8px!important;font-size:9px!important}
body:has(#cfNle) #cfNle .cf-ref2-sidebar-active{font-size:9px!important;padding:8px 6px!important;margin-bottom:10px!important}
body:has(#cfNle) #cfNle .cf-ref2-project-label{font-size:10px!important}
body:has(#cfNle) #cfNle .cf-ref2-side-link{font-size:9px!important;padding:7px 4px!important}
body:has(#cfNle) #cfNle .cf-ref2-project-card{padding:7px!important}
body:has(#cfNle) #cfNle .cf-ref2-clips{display:flex!important;grid-area:clips!important;flex-direction:column!important;min-width:0!important;max-height:none!important;overflow:auto!important;border-right:1px solid #282d40!important;padding:12px 10px!important;background:#0e121e!important}
body:has(#cfNle) #cfNle .cf-nle-center{grid-area:preview!important;display:grid!important;grid-template-columns:minmax(0,1fr)!important;grid-template-rows:minmax(0,1fr)!important;align-items:stretch!important;justify-items:stretch!important;gap:0!important;min-width:0!important;min-height:0!important;padding:0!important;background:#090c15!important;overflow:hidden!important}
body:has(#cfNle) #cfNle .cf-nle-monitor{grid-column:1!important;grid-row:1!important;align-self:center!important;justify-self:center!important;width:auto!important;height:min(60vh,460px)!important;max-height:460px!important;max-width:90%!important;aspect-ratio:9/16!important;border:2px solid #a84aff!important}
body:has(#cfNle) #cfNle .cf-nle-transport{grid-column:1!important;grid-row:1!important;align-self:end!important;justify-self:center!important;width:min(92%,490px)!important;margin-bottom:10px!important}
body:has(#cfNle) #cfNle .cf-nle-inspector{grid-area:inspector!important;min-width:0!important;max-height:none!important;overflow:auto!important;border-left:1px solid #292d40!important;padding:10px!important;background:#101421!important}
body:has(#cfNle) #cfNle .cf-inspector-tabs{grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:2px!important;padding:3px!important;margin-bottom:10px!important}
body:has(#cfNle) #cfNle .cf-inspector-tabs button{font-size:10px!important;padding:8px 1px!important}
body:has(#cfNle) #cfNle .cf-nle-tools{grid-row:2!important;height:38px!important;min-height:38px!important;padding:4px 10px!important;gap:5px!important}
body:has(#cfNle) #cfNle .cf-nle-tools button{font-size:10px!important;padding:5px 8px!important}
body:has(#cfNle) #cfNle .cf-nle-ruler{grid-row:3!important;height:22px!important;min-height:22px!important;margin-left:145px!important;font-size:9px!important}
body:has(#cfNle) #cfNle .cf-nle-timeline{grid-row:4!important;min-height:0!important;max-height:none!important;overflow:auto!important;padding:5px 8px!important;gap:5px!important}
body:has(#cfNle) #cfNle .cf-nle-track{min-height:34px!important}
body:has(#cfNle) #cfNle .cf-nle-track-head{min-width:145px!important;font-size:10px!important;padding:5px 8px!important}
body:has(#cfNle) #cfNle .cf-nle-lane{min-height:32px!important}
body:has(#cfNle) #cfNle .cf-nle-block{height:25px!important;top:3px!important;font-size:10px!important}
@media(max-width:1250px){body:has(#cfNle) #cfNle>.cf-nle-work{grid-template-columns:130px 205px minmax(300px,1fr) 300px!important}}\n@media(max-width:1050px){body:has(#cfNle) #cfNle>.cf-nle-work{grid-template-columns:120px minmax(0,1fr) 285px!important;grid-template-areas:"sidebar preview inspector" "clips clips clips"!important}body:has(#cfNle) #cfNle .cf-nle-center{grid-template-columns:minmax(0,1fr)!important}body:has(#cfNle) #cfNle .cf-nle-monitor{height:min(53vh,390px)!important}}
@media(max-width:760px){body:has(#cfNle) .cf-ref2-nav{grid-template-columns:1fr auto!important}body:has(#cfNle) .cf-ref2-links{display:none!important}body:has(#cfNle) #cfNle>.cf-nle-work{grid-template-columns:minmax(0,1fr)!important;grid-template-rows:auto minmax(300px,1fr) 230px!important;grid-template-areas:"sidebar" "preview" "inspector"!important;overflow:auto!important}body:has(#cfNle) #cfNle .cf-nle-media{max-height:130px!important}body:has(#cfNle) #cfNle .cf-nle-center{min-height:310px!important}body:has(#cfNle) #cfNle .cf-nle-inspector{min-height:220px!important}}
`;document.head.append(s)})();
