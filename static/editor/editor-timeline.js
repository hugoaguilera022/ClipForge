import { uid } from './editor-store.js';

(() => {
  let mountedCard=null, zoom=4, raf=0, urls=new Map(), audioPreviews=[],audioSyncCleanup=null;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const getApi=()=>({store:window.clipforgeProjectStore,commands:window.clipforgeEditorCommands});
  const videoFor=card=>card?.querySelector('.cf-inline-player video')||card?.querySelector('video')||window.__cfActiveClipVideo;
  const niceTime=value=>{const n=Math.max(0,Number(value)||0);return n>=3600?new Date(n*1000).toISOString().slice(11,19):new Date(n*1000).toISOString().slice(14,19);};

  function cleanupAudio(){
    audioSyncCleanup?.();audioSyncCleanup=null;
    audioPreviews.forEach(audio=>{audio.pause();audio.src='';});
    audioPreviews=[];
    for(const url of urls.values())URL.revokeObjectURL(url);
    urls.clear();
  }
  function setupAudioPreview(card){
    cleanupAudio();
    const {store}=getApi();if(!store?.ready)return;
    const film=videoFor(card);if(!film)return;
    const sources=[];
    for(const track of store.project.tracks.filter(t=>t.type==='audio'&&!t.muted)){
      for(const item of track.items||[]){
        if(!item.mediaId)continue;
        const asset=(store.project.media||[]).find(x=>x.id===item.mediaId);
        if(!asset?.blob)continue;
        const url=URL.createObjectURL(asset.blob);urls.set(asset.id,url);
        const audio=new Audio(url);audio.preload='auto';audio.volume=Math.max(0,Math.min(1,(Number(track.volume??1)*Number(item.gain??1))));
        audioPreviews.push(audio);sources.push({audio,item,track});
      }
    }
    const sync=()=>{
      const t=Number(film.currentTime)||0;
      sources.forEach(({audio,item})=>{
        const active=!item.disabled&&t>=item.start&&t<item.end;
        if(active){
          const expected=Math.max(0,Number(item.sourceStart||0)+(t-Number(item.start||0)));
          if(Math.abs(audio.currentTime-expected)>.35){try{audio.currentTime=expected;}catch{}}
          audio.volume=Math.max(0,Math.min(1,Number(item.gain??1)));
          if(!film.paused&&audio.paused)audio.play().catch(()=>{});
        }else if(!audio.paused)audio.pause();
      });
    };
    const pause=()=>sources.forEach(x=>x.audio.pause());
    film.addEventListener('play',sync);film.addEventListener('timeupdate',sync);film.addEventListener('pause',pause);film.addEventListener('seeked',sync);
    audioSyncCleanup=()=>{film.removeEventListener('play',sync);film.removeEventListener('timeupdate',sync);film.removeEventListener('pause',pause);film.removeEventListener('seeked',sync);};
  }

  function buildTimeline(card){
    const {store,commands}=getApi();
    if(!store?.ready||!commands)return;
    const editorSlot=document.querySelector('.cf-opus-editor-slot');
    if(!editorSlot)return;
    editorSlot.querySelector('#cfMultiTrackTimeline')?.remove();
    const panel=document.createElement('section');
    panel.id='cfMultiTrackTimeline';panel.className='cf-mt-panel';
    panel.innerHTML=`
      <div class="cf-mt-head">
        <div><small>EDICIÓN MULTIPISTA</small><strong>Línea de tiempo</strong><span class="cf-mt-project-state" aria-live="polite">Guardado automático local</span></div>
        <div class="cf-mt-actions">
          <button type="button" data-act="play">▶ Reproducir</button>
          <button type="button" data-act="add-audio">+ Pista audio</button>
          <button type="button" data-act="add-text">+ Pista texto</button>
          <label class="cf-mt-import">Importar audio<input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"></label>
          <label class="cf-mt-zoom">Zoom <input type="range" min="2" max="24" value="4" step="1"><b>4 px/s</b></label>
        </div>
      </div>
      <div class="cf-mt-help">Arrastra un bloque para moverlo. Arrastra sus bordes para recortarlo. Pulsa una pista para situar el cabezal. Deshacer: ⌘Z · Rehacer: ⇧⌘Z.</div>
      <div class="cf-mt-scroll" tabindex="0" aria-label="Línea de tiempo horizontal">
        <div class="cf-mt-board">
          <div class="cf-mt-ruler-row"><div class="cf-mt-label cf-mt-ruler-label">TIEMPO</div><div class="cf-mt-ruler"></div></div>
          <div class="cf-mt-lanes"></div>
        </div>
      </div>
      <div class="cf-mt-foot"><span class="cf-mt-playhead-readout">00:00</span><span>Las pistas se guardan en este navegador.</span><span class="cf-mt-selection">Sin selección</span></div>`;
    const anchor=editorSlot.querySelector('.cf-editor-commandbar')||editorSlot.querySelector('.cf-editor-topbar');
    if(anchor)anchor.after(panel);else editorSlot.append(panel);
    const scroll=panel.querySelector('.cf-mt-scroll'),board=panel.querySelector('.cf-mt-board'),ruler=panel.querySelector('.cf-mt-ruler'),lanes=panel.querySelector('.cf-mt-lanes');
    const zoomControl=panel.querySelector('.cf-mt-zoom input'),zoomLabel=panel.querySelector('.cf-mt-zoom b'),state=panel.querySelector('.cf-mt-project-state'),readout=panel.querySelector('.cf-mt-playhead-readout'),selectionLabel=panel.querySelector('.cf-mt-selection');
    let dragging=null,renderQueued=false;
    const timelineDuration=()=>Math.max(30,store.project.duration+5,Number(videoFor(card)?.duration)||0,Number(card.dataset.sourceDuration)||0);
    const setStatus=msg=>{state.textContent=msg;};
    const updateHead=()=>{
      const pps=zoom,duration=timelineDuration(),x=Math.max(0,Math.min(duration,Number(store.project.playhead)||0))*pps;
      panel.style.setProperty('--mt-playhead-x',x+'px');
      readout.textContent=niceTime(store.project.playhead);
      const selected=store.project.selection?.[0];
      const found=selected&&commands.item(selected);
      selectionLabel.textContent=found?found.item.name||found.item.text||found.track.name:'Sin selección';
    };
    function render(){
      renderQueued=false;
      const project=store.project,pps=zoom,duration=timelineDuration(),width=Math.max(700,Math.ceil(duration*pps));
      board.style.setProperty('--mt-content-width',width+'px');
      ruler.replaceChildren();lanes.replaceChildren();
      const tick=pps>=12?5:pps>=5?10:pps>=3?20:30;
      for(let t=0;t<=duration;t+=tick){
        const mark=document.createElement('button');mark.type='button';mark.className='cf-mt-tick';mark.style.left=(t*pps)+'px';mark.textContent=niceTime(t);
        mark.addEventListener('click',()=>seek(t));ruler.append(mark);
      }
      const source=videoFor(card);
      for(const track of project.tracks){
        const row=document.createElement('div');row.className='cf-mt-track-row'+(track.hidden?' is-hidden':'');row.dataset.trackId=track.id;
        const label=document.createElement('div');label.className='cf-mt-track-label';
        const title=document.createElement('b');title.textContent=track.name||track.type;title.title=track.name||track.type;
        const controls=document.createElement('div');controls.className='cf-mt-track-controls';
        const button=(text,act,active)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.title=act;b.classList.toggle('is-active',!!active);b.addEventListener('click',e=>{e.stopPropagation();const patch=act==='Silenciar'?{muted:!track.muted}:act==='Ocultar'?{hidden:!track.hidden}:{locked:!track.locked};commands.setTrackState(track.id,patch);});return b;};
        if(track.type==='audio')controls.append(button(track.muted?'M':'♫','Silenciar',track.muted));
        if(track.type!=='audio'&&track.type!=='effects')controls.append(button(track.hidden?'◉':'◌','Ocultar',track.hidden));
        controls.append(button(track.locked?'🔒':'🔓','Bloquear',track.locked));
        label.append(title,controls);
        const lane=document.createElement('div');lane.className='cf-mt-lane';lane.style.width=width+'px';lane.dataset.trackId=track.id;
        lane.addEventListener('click',event=>{
          if(event.target.closest('.cf-mt-clip'))return;
          const rect=lane.getBoundingClientRect();seek(Math.max(0,Math.min(duration,(event.clientX-rect.left)/pps)));
        });
        for(const item of track.items||[]){
          if(!Number.isFinite(Number(item.start))||!Number.isFinite(Number(item.end))||item.end<=item.start)continue;
          const block=document.createElement('div');block.className='cf-mt-clip type-'+track.type;
          if(project.selection?.includes(item.id))block.classList.add('selected');
          block.dataset.itemId=item.id;block.style.left=(item.start*pps)+'px';block.style.width=Math.max(18,(item.end-item.start)*pps)+'px';
          const name=document.createElement('span');name.className='cf-mt-clip-name';name.textContent=item.name||item.title||item.text||track.type;
          block.append(name);
          if(!track.locked){
            for(const edge of ['left','right']){const handle=document.createElement('i');handle.className='cf-mt-handle '+edge;handle.dataset.edge=edge;handle.title=edge==='left'?'Recortar inicio':'Recortar final';block.append(handle);}
          }
          block.addEventListener('pointerdown',event=>{
            if(event.button!==0||track.locked)return;
            event.preventDefault();event.stopPropagation();
            store.select([item.id]);
            dragging={id:item.id,trackId:track.id,startX:event.clientX,originalStart:item.start,originalEnd:item.end,edge:event.target.closest('.cf-mt-handle')?.dataset.edge||'move'};
            block.setPointerCapture(event.pointerId);block.classList.add('dragging');
          });
          block.addEventListener('pointermove',event=>{
            if(!dragging||dragging.id!==item.id)return;
            const delta=(event.clientX-dragging.startX)/pps;
            const a=dragging.edge==='left'?Math.max(0,Math.min(dragging.originalEnd-.1,dragging.originalStart+delta)):dragging.edge==='right'?dragging.originalStart:Math.max(0,dragging.originalStart+delta);
            const b=dragging.edge==='right'?Math.max(dragging.originalStart+.1,dragging.originalEnd+delta):dragging.edge==='left'?dragging.originalEnd:dragging.originalEnd+delta;
            block.style.left=(a*pps)+'px';block.style.width=Math.max(18,(b-a)*pps)+'px';
          });
          const finish=event=>{
            if(!dragging||dragging.id!==item.id)return;
            const d=dragging,delta=(event.clientX-d.startX)/pps;dragging=null;block.classList.remove('dragging');
            try{
              if(d.edge==='move')commands.moveItem(d.id,Math.max(0,d.originalStart+delta));
              else if(d.edge==='left')commands.trimItem(d.id,Math.max(0,Math.min(d.originalEnd-.1,d.originalStart+delta)),d.originalEnd);
              else commands.trimItem(d.id,d.originalStart,Math.max(d.originalStart+.1,d.originalEnd+delta));
              setStatus('Cambio aplicado · guardado automático');
            }catch(error){setStatus(error.message);}
          };
          block.addEventListener('pointerup',finish);block.addEventListener('pointercancel',finish);
          block.addEventListener('click',event=>{event.stopPropagation();store.select([item.id]);seek(item.start);});
          lane.append(block);
        }
        row.append(label,lane);lanes.append(row);
      }
      updateHead();
    }
    function requestRender(){if(renderQueued)return;renderQueued=true;requestAnimationFrame(render);}
    function seek(seconds){
      store.setPlayhead(seconds);
      const v=videoFor(card);if(v){if(v.readyState>=1){try{v.currentTime=seconds;}catch{}}else v.addEventListener('loadedmetadata',()=>{try{v.currentTime=seconds;}catch{}},{once:true});}
      updateHead();scrollToHead();
    }
    function scrollToHead(){
      const x=(Number(store.project.playhead)||0)*zoom,view=scroll.clientWidth;
      if(x>scroll.scrollLeft+view-80||x<scroll.scrollLeft)scroll.scrollTo({left:Math.max(0,x-view/2),behavior:'smooth'});
    }
    panel.querySelector('[data-act="play"]').addEventListener('click',()=>{
      const v=videoFor(card);if(!v){setStatus('No hay vídeo de previsualización.');return;}
      if(v.paused){v.play().then(()=>{panel.querySelector('[data-act="play"]').textContent='Ⅱ Pausar';}).catch(()=>setStatus('Pulsa reproducir en el visor para iniciar.'));}
      else{v.pause();panel.querySelector('[data-act="play"]').textContent='▶ Reproducir';}
    });
    panel.querySelector('[data-act="add-audio"]').addEventListener('click',()=>{
      commands.addTrack('audio','A'+(project.tracks.filter(t=>t.type==='audio').length+1)+' · Audio');setStatus('Pista de audio añadida.');
    });
    panel.querySelector('[data-act="add-text"]').addEventListener('click',()=>{
      commands.addTrack('text','T'+(project.tracks.filter(t=>t.type==='text').length+1)+' · Texto');setStatus('Pista de texto añadida.');
    });
    panel.querySelector('.cf-mt-import input').addEventListener('change',event=>{
      const file=event.target.files?.[0];if(!file)return;
      try{
        let track=store.project.tracks.find(t=>t.type==='audio'&&!t.locked&&!t.name.includes('original'));
        if(!track){const newTrackId=commands.addTrack('audio','A'+(store.project.tracks.filter(t=>t.type==='audio').length+1)+' · Música');track=commands.track(newTrackId);}
        const trackId=track?.id;
        const AudioContextClass=window.AudioContext||window.webkitAudioContext;
        if(!AudioContextClass)throw new Error('Este navegador no permite leer la duración del audio.');
        const audioContext=new AudioContextClass();
        let decoded;try{decoded=await audioContext.decodeAudioData(await file.arrayBuffer());}finally{await audioContext.close().catch(()=>{});}
        commands.importAudioFile(file,trackId,store.project.playhead,decoded.duration);
        setStatus('Audio importado: '+file.name+' · '+niceTime(decoded.duration));
        setupAudioPreview(card);
      }catch(error){setStatus(error.message);}
      event.target.value='';
    });
    zoomControl.addEventListener('input',()=>{zoom=Number(zoomControl.value)||4;zoomLabel.textContent=zoom+' px/s';requestRender();});
    store.addEventListener('change',requestRender);
    store.addEventListener('change',()=>{if(store.project.selection?.length)panel.classList.add('has-selection');else panel.classList.remove('has-selection');});
    const v=videoFor(card);
    if(v){
      v.addEventListener('timeupdate',()=>{
        store.project.playhead=Number(v.currentTime)||0;updateHead();
      });
      v.addEventListener('pause',()=>{panel.querySelector('[data-act="play"]').textContent='▶ Reproducir';});
      v.addEventListener('play',()=>{panel.querySelector('[data-act="play"]').textContent='Ⅱ Pausar';});
    }
    store.addEventListener('change',()=>{setupAudioPreview(card);});
    store.addEventListener('storage-error',event=>setStatus('No se pudo guardar: '+(event.detail?.message||'error de almacenamiento')));
    zoom=4;zoomControl.value='4';render();setupAudioPreview(card);
    window.__cfTimelineSeek=seek;
    panel.__cfDestroy=()=>{cleanupAudio();window.removeEventListener('resize',requestRender);};
    return panel;
  }

  window.addEventListener('clipforge:open-editor',event=>{
    const card=event.detail?.card;if(!card)return;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(mountedCard===card&&document.querySelector('#cfMultiTrackTimeline'))return;
      mountedCard=card;
      buildTimeline(card);
    }));
  });
  window.addEventListener('clipforge:timeline-refresh',()=>{document.querySelector('#cfMultiTrackTimeline')?.dispatchEvent(new Event('cf-refresh'));});
  window.addEventListener('clipforge:editor-status',event=>{
    const status=document.querySelector('#cfMultiTrackTimeline .cf-mt-project-state');
    if(status&&event.detail?.message)status.textContent=event.detail.message;
  });
})();
