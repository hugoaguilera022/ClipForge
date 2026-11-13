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
  function syncOriginalVideoAudio(card){
    const {store}=getApi();if(!store?.ready)return;
    const film=videoFor(card);if(!film)return;
    const lane=store.project.tracks.find(t=>t.type==='audio'&&(t.id==='track-a1'||t.items.some(item=>item.sourceType==='primary')));
    const active=window.__cfTimelineActiveClip;
    const item=lane?.items.find(x=>x.sourceType==='primary'&&String(x.clipId||'')===String(active?.id))
      ||lane?.items.find(x=>x.sourceType==='primary'&&active&&Math.abs(Number(x.start)-Number(active.start))<.05&&Math.abs(Number(x.end)-Number(active.end))<.05);
    const gain=item?Number(item.gain??.8):.8;
    film.volume=Math.max(0,Math.min(1,gain*Number(lane?.volume??1)));
    film.muted=Boolean(lane?.muted)||gain<=0;
  }

  function setupAudioPreview(card){
    cleanupAudio();
    const {store}=getApi();if(!store?.ready)return;
    const film=videoFor(card);if(!film)return;
    syncOriginalVideoAudio(card);
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
      sources.forEach(({audio,item,track})=>{
        const active=!item.disabled&&t>=item.start&&t<item.end;
        if(active){
          const expected=Math.max(0,Number(item.sourceStart||0)+(t-Number(item.start||0)));
          if(Math.abs(audio.currentTime-expected)>.35){try{audio.currentTime=expected;}catch{}}
          audio.volume=Math.max(0,Math.min(1,Number(track.volume??1)*Number(item.gain??1)));
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
    const previousPanel=editorSlot.querySelector('#cfMultiTrackTimeline');previousPanel?.__cfDestroy?.();previousPanel?.remove();
    const panel=document.createElement('section');
    panel.id='cfMultiTrackTimeline';panel.className='cf-mt-panel';
    panel.innerHTML=`
      <div class="cf-mt-head">
        <div><small>EDICIÓN MULTIPISTA</small><strong>Línea de tiempo</strong><span class="cf-mt-project-state" aria-live="polite">Guardado automático local</span></div>
        <div class="cf-mt-actions">
          <button type="button" data-act="play">▶ Reproducir</button>
          <button type="button" data-act="add-audio">+ Pista audio</button>
          <button type="button" data-act="add-text">+ Pista texto</button>
          <button type="button" data-act="split" title="Dividir elemento seleccionado en el cabezal">Dividir</button>
          <button type="button" data-act="duplicate" title="Duplicar elemento seleccionado">Duplicar</button>
          <button type="button" data-act="copy" title="Copiar elementos seleccionados">Copiar</button>
          <button type="button" data-act="paste" title="Pegar en la posición del cabezal">Pegar</button>
          <button type="button" data-act="delete" title="Eliminar elementos seleccionados">Eliminar</button>
          <button type="button" data-act="undo" title="Deshacer">↶</button>
          <button type="button" data-act="redo" title="Rehacer">↷</button>
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
      <div class="cf-mt-foot"><span class="cf-mt-playhead-readout">00:00</span><span>Las pistas se guardan en este navegador.</span><span class="cf-mt-selection">Sin selección</span><label class="cf-mt-volume" hidden>Volumen <input type="range" min="0" max="200" value="100"><b>100%</b></label></div>`;
    // The inspector/preview card must stay above the timeline in the editor
    // flex column. Inserting the timeline before the card lets it intercept clicks.
    const editingCard=editorSlot.querySelector('.cf-opus-editing-card')||editorSlot.querySelector('.candidate-card');
    if(editingCard)editingCard.after(panel);else editorSlot.append(panel);
    panel.style.setProperty('position','relative','important');
    panel.style.setProperty('z-index','0','important');
    panel.style.setProperty('flex','0 0 auto','important');
    const scroll=panel.querySelector('.cf-mt-scroll'),board=panel.querySelector('.cf-mt-board'),ruler=panel.querySelector('.cf-mt-ruler'),lanes=panel.querySelector('.cf-mt-lanes');
    const zoomControl=panel.querySelector('.cf-mt-zoom input'),zoomLabel=panel.querySelector('.cf-mt-zoom b'),state=panel.querySelector('.cf-mt-project-state'),readout=panel.querySelector('.cf-mt-playhead-readout'),selectionLabel=panel.querySelector('.cf-mt-selection'),volumeControl=panel.querySelector('.cf-mt-volume'),volumeInput=volumeControl.querySelector('input'),volumeLabel=volumeControl.querySelector('b');
    const detach=[];const listen=(target,type,handler,options)=>{target.addEventListener(type,handler,options);detach.push(()=>target.removeEventListener(type,handler,options));};
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
      if(found?.track.type==='audio'){volumeControl.hidden=false;const value=Math.round(Math.max(0,Math.min(2,Number(found.item.gain??1)))*100);volumeInput.value=String(value);volumeLabel.textContent=value+'%';}else volumeControl.hidden=true;
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
    volumeInput.addEventListener('input',()=>{
      const id=store.project.selection?.[0];if(!id)return;
      const found=commands.item(id);
      if(found?.track.type==='audio'){
        const gain=Number(volumeInput.value)/100;
        commands.setItemVolume(id,gain);volumeLabel.textContent=Math.round(gain*100)+'%';
      }
    });
    panel.querySelector('[data-act="play"]').addEventListener('click',()=>{
      const v=videoFor(card);if(!v){setStatus('No hay vídeo de previsualización.');return;}
      if(v.paused){v.play().then(()=>{panel.querySelector('[data-act="play"]').textContent='Ⅱ Pausar';}).catch(()=>setStatus('Pulsa reproducir en el visor para iniciar.'));}
      else{v.pause();panel.querySelector('[data-act="play"]').textContent='▶ Reproducir';}
    });
    panel.querySelector('[data-act="add-audio"]').addEventListener('click',()=>{
      commands.addTrack('audio','A'+(store.project.tracks.filter(t=>t.type==='audio').length+1)+' · Audio');setStatus('Pista de audio añadida.');
    });
    panel.querySelector('[data-act="add-text"]').addEventListener('click',()=>{
      commands.addTrack('text','T'+(store.project.tracks.filter(t=>t.type==='text').length+1)+' · Texto');setStatus('Pista de texto añadida.');
    });
    const selectedIds=()=>[...(store.project.selection||[])];
    const runSelected=(label,action)=>{
      const ids=selectedIds();if(!ids.length){setStatus('Selecciona primero un elemento de la línea de tiempo.');return;}
      try{action(ids);setStatus(label+' · guardado automático');}catch(error){setStatus(error.message);}
    };
    panel.querySelector('[data-act="split"]').addEventListener('click',()=>runSelected('Elemento dividido',ids=>{
      if(ids.length!==1)throw new Error('Selecciona un solo elemento para dividir.');
      commands.splitItem(ids[0],store.project.playhead);
    }));
    panel.querySelector('[data-act="duplicate"]').addEventListener('click',()=>runSelected('Elemento duplicado',ids=>{
      const copies=ids.map(id=>commands.duplicate(id));store.select(copies);
    }));
    panel.querySelector('[data-act="copy"]').addEventListener('click',()=>runSelected('Elementos copiados',ids=>{
      const count=commands.copy(ids);if(!count)throw new Error('No hay elementos que copiar.');
    }));
    panel.querySelector('[data-act="paste"]').addEventListener('click',()=>{
      const ids=commands.paste(store.project.playhead);if(ids.length)store.select(ids);
      setStatus(ids.length?ids.length+' elemento(s) pegado(s) · guardado automático':'No hay elementos copiados o no existe una pista compatible.');
    });
    panel.querySelector('[data-act="delete"]').addEventListener('click',()=>runSelected('Elementos eliminados',ids=>{
      commands.remove(ids);store.select([]);
    }));
    panel.querySelector('[data-act="undo"]').addEventListener('click',()=>setStatus(store.undo()?'Cambio deshecho.':'No hay cambios que deshacer.'));
    panel.querySelector('[data-act="redo"]').addEventListener('click',()=>setStatus(store.redo()?'Cambio rehecho.':'No hay cambios que rehacer.'));
    panel.querySelector('.cf-mt-import input').addEventListener('change',async event=>{
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
    listen(store,'change',requestRender);
    listen(store,'change',()=>{if(store.project.selection?.length)panel.classList.add('has-selection');else panel.classList.remove('has-selection');});
    const v=videoFor(card);
    if(v){
      listen(v,'timeupdate',()=>{store.project.playhead=Number(v.currentTime)||0;updateHead();});
      listen(v,'pause',()=>{panel.querySelector('[data-act="play"]').textContent='▶ Reproducir';});
      listen(v,'play',()=>{panel.querySelector('[data-act="play"]').textContent='Ⅱ Pausar';});
    }
    listen(store,'change',()=>{syncOriginalVideoAudio(card);setupAudioPreview(card);});
    listen(store,'storage-error',event=>setStatus('No se pudo guardar: '+(event.detail?.message||'error de almacenamiento')));
    zoom=4;zoomControl.value='4';
    const activeClip=window.__cfTimelineActiveClip;
    if(activeClip){const videoTrack=store.project.tracks.find(t=>t.type==='video');const match=videoTrack?.items.find(item=>item.id===String(activeClip.id)||(Math.abs(Number(item.start)-Number(activeClip.start))<.05&&Math.abs(Number(item.end)-Number(activeClip.end))<.05));if(match){store.select([match.id]);store.project.playhead=Number(match.start)||0;}}
    render();setupAudioPreview(card);
    window.__cfTimelineSeek=seek;
    panel.__cfDestroy=()=>{cleanupAudio();detach.forEach(remove=>remove());};
    return panel;
  }

  window.addEventListener('clipforge:open-editor',event=>{
    const card=event.detail?.card;if(!card)return;
    window.__cfTimelineActiveClip=event.detail?.clip||null;
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
