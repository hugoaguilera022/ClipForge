(() => {
  const existing=document.getElementById('cfWorkspace');
  const main=existing?.querySelector('main')||document.querySelector('main');
  const header=document.querySelector('body > header');
  if(!main)return;
  const $=s=>document.querySelector(s);
  const engine=$('#browserEngine'),drop=$('.drop'),urlImport=$('.browser-url-import');
  const controls=engine?.querySelector('.browser-transcribe-controls');
  const transcribe=$('#browserTranscribe'),candidates=$('#browserCandidates');
  const editor=$('#projectEditor'),exportPanel=$('.browser-export');
  const language=$('#browserWhisperLanguage'),model=$('#browserWhisperModel');
  if(language)language.value='auto';
  if(model)model.value='whisper-base';
  if(urlImport){urlImport.hidden=true;urlImport.setAttribute('aria-hidden','true');}
  if(controls){controls.hidden=true;controls.setAttribute('aria-hidden','true');}
  $('#videoCapacity')?.setAttribute('hidden','');
  const app=document.createElement('div');app.id='cfWorkspace';app.className='cf-opus-workspace';
  app.innerHTML=`
    <div class="cf-opus-announcement">Estudio de ClipForge con IA <span>Convierte un vídeo largo en clips listos para publicar</span><a href="#cfShowcase">Descubre cómo funciona ↓</a></div>
    <header class="cf-opus-nav">
      <a class="cf-opus-brand" href="#" aria-label="ClipForge"><span class="cf-opus-mark">C</span>ClipForge</a>
      <nav><a href="#cfCreate">Crear clips</a><a href="#cfShowcase">Cómo funciona</a><a href="#cfResults">Mis clips</a></nav>
      <div class="cf-opus-nav-right"><span class="cf-opus-free">● GRATIS · SIN API DE PAGO</span><span id="cfHealthSlot"></span></div>
    </header>
    <main class="cf-opus-main">
      <section class="cf-opus-hero" id="cfCreate">
        <span class="cf-opus-eyebrow">GENERADOR DE CLIPS CON IA</span>
        <h1>De un vídeo largo a 4 clips destacados.<br><em>Crea contenido mucho más rápido.</em></h1>
        <p>ClipForge analiza tu vídeo, encuentra los momentos con más potencial y los transforma en clips verticales con subtítulos.</p>
        <div class="cf-opus-upload-row"><div class="cf-opus-drop-slot"></div><div class="cf-opus-primary-action"></div><button type="button" class="cf-opus-auto">Edición automática <span>✦</span></button></div>
        <div class="cf-opus-trust"><span>✓ Español e inglés</span><span>✓ Sin subir el vídeo a un servidor</span><span>✓ Sin suscripciones</span></div>
        <div id="cfProductionStatus" class="cf-opus-progress" role="status">Sube un vídeo para generar automáticamente tus cuatro clips.</div>
      </section>
      <section class="cf-opus-showcase" id="cfShowcase">
        <div class="cf-opus-showcase-glow"></div>
        <div class="cf-opus-demo-source"><div class="cf-opus-demo-frame"><video id="cfSourcePreview" muted playsinline controls></video><div class="cf-opus-demo-empty"><span>▶</span><b>Tu vídeo original</b><small>La vista previa aparecerá al seleccionar el archivo</small></div></div><span class="cf-opus-demo-duration">VÍDEO ORIGINAL</span></div>
        <div class="cf-opus-demo-prompt"><span>↗</span><b>De un vídeo largo a momentos destacados</b><small>ClipForge analiza el contenido y prepara tus clips</small></div>
        <div class="cf-opus-socials"><span class="yt">▶</span><span class="ig">◎</span><span class="in">in</span><span class="tt">♪</span><span class="fb">f</span><span class="xx">𝕏</span></div>
        <div class="cf-opus-demo-clips"><div class="cf-opus-demo-clip"><i>01</i><b>Momento destacado</b><small>9:16 · Subtítulos</small></div><div class="cf-opus-demo-clip"><i>02</i><b>Historia / anécdota</b><small>9:16 · Subtítulos</small></div><div class="cf-opus-demo-clip"><i>03</i><b>Reacción / respuesta</b><small>9:16 · Subtítulos</small></div><div class="cf-opus-demo-clip"><i>04</i><b>Mejor momento</b><small>9:16 · Subtítulos</small></div></div>
        <div class="cf-opus-real-results"></div>
      </section>
      <section class="cf-opus-results" id="cfResults" hidden><div class="cf-opus-section-head"><div><span class="cf-opus-kicker">TUS RESULTADOS</span><h2>Clips generados</h2><p>Previsualiza los cuatro momentos y ajusta cada corte.</p></div><span class="cf-opus-result-pill">4 clips · 9:16</span></div><div class="cf-opus-candidates-slot"></div></section>
      <section class="cf-opus-editor" id="cfEditor" hidden><div class="cf-opus-section-head"><div><span class="cf-opus-kicker">EDITOR DE VÍDEO</span><h2>Perfecciona tus clips</h2></div></div><div class="cf-opus-editor-slot"></div></section>
      <section class="cf-opus-export-slot" hidden></section>
      <footer class="cf-opus-footer"><b>ClipForge</b><span>Un vídeo. Cuatro oportunidades de destacar.</span><span>Procesamiento local · Gratis</span></footer>
    </main>`;
  document.body.classList.add('cf-opus-body');
  if(existing)existing.replaceWith(app);else main.replaceWith(app);
  const health=header?.querySelector('#health');if(health)app.querySelector('#cfHealthSlot').append(health);header?.remove();
  if(drop)app.querySelector('.cf-opus-drop-slot').append(drop);
  if(transcribe){transcribe.textContent='Generar mis 4 clips';app.querySelector('.cf-opus-primary-action').append(transcribe);}
  if(engine){const status=$('#browserWhisperStatus');if(status){status.classList.remove('cf-opus-internal');status.setAttribute('aria-live','polite');app.querySelector('.cf-opus-hero').append(status);}engine.hidden=true;engine.setAttribute('aria-hidden','true');}
  if(candidates)app.querySelector('.cf-opus-candidates-slot').append(candidates);
  if(editor){
    editor.querySelector('.section-head')?.remove();editor.querySelector(':scope > p.muted')?.remove();
    const preview=editor.querySelector('.editor-preview'),settings=exportPanel?.querySelector('.export-settings');
    if(preview&&settings){const aside=document.createElement('aside');aside.className='cf-opus-inspector';aside.innerHTML='<span class="cf-opus-kicker">AJUSTES</span><b>Estilo y formato</b>';aside.append(settings);preview.append(aside);}
    app.querySelector('.cf-opus-editor-slot').append(editor);
  }
  if(exportPanel){const h=exportPanel.querySelector('h3');if(h)h.textContent='Exportar clips';exportPanel.querySelector(':scope > p.hint')?.remove();if($('#browserExportClips'))$('#browserExportClips').textContent='Exportar los 4 clips';app.querySelector('.cf-opus-export-slot').append(exportPanel);}
  const fileInput=$('#video'),sourceVideo=$('#cfSourcePreview'),empty=app.querySelector('.cf-opus-demo-empty');
  fileInput?.addEventListener('change',()=>{
    const file=fileInput.files?.[0];if(!file)return;
    if(sourceVideo){sourceVideo.src=URL.createObjectURL(file);sourceVideo.hidden=false;sourceVideo.load();sourceVideo.play().catch(()=>{});}
    if(empty)empty.hidden=true;
    const filename=$('#filename');if(filename)filename.textContent=file.name;
    // Selecting a source is the primary action in this one-screen workflow:
    // start the local transcription/editorial pass automatically.
    const progress=$('#cfProductionStatus');
    if(progress)progress.textContent='Vídeo cargado. Preparando análisis local y selección de cuatro momentos…';
    if(transcribe&&!fileInput.dataset.autoRunStarted){
      fileInput.dataset.autoRunStarted='1';
      window.setTimeout(()=>transcribe.click(),250);
    }
  });
  const auto=app.querySelector('.cf-opus-auto');auto?.addEventListener('click',()=>transcribe?.click());
  let activeCard=null,activeIndex=-1;const originalCardNodes=new WeakMap();
  const results=$('#cfResults'),editorScreen=$('#cfEditor'),resultSlot=app.querySelector('.cf-opus-candidates-slot'),editorSlot=app.querySelector('.cf-opus-editor-slot');
  const exportSlot=app.querySelector('.cf-opus-export-slot');
  if(exportPanel){exportPanel.hidden=true;exportPanel.setAttribute('aria-hidden','true');}
  function setStage(stage){
    document.body.classList.toggle('cf-opus-stage-results',stage==='results');
    document.body.classList.toggle('cf-opus-stage-editor',stage==='editor');
    if(stage==='results'){
      results.hidden=false;editorScreen.hidden=true;exportSlot.hidden=true;
      app.querySelector('.cf-opus-hero').hidden=true;app.querySelector('.cf-opus-showcase').hidden=true;
      app.querySelector('.cf-opus-footer').hidden=true;
    }else if(stage==='editor'){
      results.hidden=true;editorScreen.hidden=false;exportSlot.hidden=true;
      app.querySelector('.cf-opus-hero').hidden=true;app.querySelector('.cf-opus-showcase').hidden=true;
      app.querySelector('.cf-opus-footer').hidden=true;
    }else{
      results.hidden=true;editorScreen.hidden=true;exportSlot.hidden=true;
      app.querySelector('.cf-opus-hero').hidden=false;app.querySelector('.cf-opus-showcase').hidden=false;
      app.querySelector('.cf-opus-footer').hidden=false;
    }
    window.scrollTo({top:0,behavior:'instant'});
  }
  function restoreCard(card){
    const original=originalCardNodes.get(card);if(!original)return;
    card.replaceChildren(...original);card.classList.remove('cf-opus-editing-card');
    originalCardNodes.delete(card);
  }
  function addInspector(card,clip){
    const original=[...card.childNodes];originalCardNodes.set(card,original);
    const player=card.querySelector('.cf-inline-player'),timeline=card.querySelector('.cf-clip-timeline'),captions=card.querySelector('.cf-inline-subtitles');
    const heading=card.querySelector(':scope > strong');
    const exportOne=card.querySelector('.candidate-export-one'),select=card.querySelector('.candidate-select');
    const layout=document.createElement('div');layout.className='cf-opus-editor-layout';
    const preview=document.createElement('section');preview.className='cf-opus-player-column';
    const inspector=document.createElement('aside');inspector.className='cf-opus-inspector';
    const tabs=document.createElement('div');tabs.className='cf-opus-inspector-tabs';tabs.setAttribute('role','tablist');
    const panes=document.createElement('div');panes.className='cf-opus-inspector-panes';
    const captionsPane=document.createElement('section');captionsPane.className='cf-opus-pane is-active';captionsPane.dataset.pane='captions';if(captions)captionsPane.append(captions);
    const textPane=document.createElement('section');textPane.className='cf-opus-pane';textPane.dataset.pane='text';
    textPane.innerHTML='<div class="cf-opus-pane-title">Añadir texto al vídeo</div><label>Texto<textarea class="cf-overlay-copy" rows="3" placeholder="Escribe un título o llamada…"></textarea></label><div class="cf-opus-text-times"><label>Inicio (s)<input class="cf-overlay-start" type="number" step="0.01"></label><label>Final (s)<input class="cf-overlay-end" type="number" step="0.01"></label></div><button type="button" class="cf-opus-add-overlay">Añadir texto a la pista</button><div class="cf-opus-overlay-list"></div>';
    textPane.querySelector('.cf-overlay-start').value=Number(clip.start).toFixed(2);textPane.querySelector('.cf-overlay-end').value=Number(clip.end).toFixed(2);
    const addOverlay=textPane.querySelector('.cf-opus-add-overlay');
    addOverlay.addEventListener('click',()=>{
      const copy=textPane.querySelector('.cf-overlay-copy').value.trim(),start=Number(textPane.querySelector('.cf-overlay-start').value),end=Number(textPane.querySelector('.cf-overlay-end').value);
      if(!copy||!Number.isFinite(start)||!Number.isFinite(end)||start<Number(clip.start)||end>Number(clip.end)||end<=start){textPane.querySelector('.cf-overlay-copy').focus();return;}
      const project=window.clipforgeEditorBridge?.getProject?.()||{tracks:[]},tracks=project.tracks||[];
      let track=tracks.find(t=>t.type==='text');if(!track){track={id:'text-overlays',type:'text',name:'Texto',items:[]};tracks.push(track);}
      track.items.push({id:'text-'+Date.now(),start,end,text:copy});
      window.clipforgeEditorBridge?.setTracks?.(tracks);
      const list=textPane.querySelector('.cf-opus-overlay-list'),item=document.createElement('div');item.className='cf-opus-overlay-item';item.textContent=copy+' · '+start.toFixed(2)+'–'+end.toFixed(2)+' s';list.append(item);
      textPane.querySelector('.cf-overlay-copy').value='';
    });
    const trackingPane=document.createElement('section');trackingPane.className='cf-opus-pane';trackingPane.dataset.pane='tracking';
    trackingPane.innerHTML='<div class="cf-opus-pane-title">Encuadre y seguimiento</div><p>Elige cómo adaptar el vídeo al formato vertical 9:16. El seguimiento facial utiliza el detector disponible en el navegador y puede recurrir a un encuadre seguro si no detecta una persona.</p>';
    const cropSelect=$('#browserCropMode');if(cropSelect){const label=cropSelect.closest('label');if(label)trackingPane.append(label);}
    const tabDefs=[['captions','Subtítulos'],['text','Texto'],['tracking','Seguimiento']];
    tabDefs.forEach(([key,label],i)=>{const button=document.createElement('button');button.type='button';button.className='cf-opus-tab'+(i===0?' is-active':'');button.textContent=label;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(i===0));button.addEventListener('click',()=>{tabs.querySelectorAll('button').forEach(b=>{b.classList.toggle('is-active',b===button);b.setAttribute('aria-selected',String(b===button));});panes.querySelectorAll('.cf-opus-pane').forEach(p=>p.classList.toggle('is-active',p.dataset.pane===key));});tabs.append(button);});
    panes.append(captionsPane,textPane,trackingPane);inspector.append(tabs,panes);
    if(player)preview.append(player);
    layout.append(preview,inspector);
    card.classList.add('cf-opus-editing-card');
    if(heading)card.append(heading);
    card.append(layout);
    if(timeline)card.append(timeline);
    const actions=document.createElement('div');actions.className='cf-opus-editor-actions';
    if(exportOne){exportOne.textContent='Exportar este clip MP4';actions.append(exportOne);}
    if(select)actions.append(select);
    card.append(actions);
  }
  function reveal(){
    if(!candidates||!resultSlot||!candidates.querySelector('.candidate-card'))return;
    if(!resultSlot.contains(candidates))resultSlot.append(candidates);
    const count=candidates.querySelectorAll('.candidate-card').length;
    const pill=results.querySelector('.cf-opus-result-pill');if(pill)pill.textContent=count+' clips · 9:16';
    setStage('results');
    const progress=$('#cfProductionStatus');if(progress)progress.textContent='Tus cuatro clips están listos. Abre cualquiera para ajustar el montaje y los subtítulos.';
  }
  window.addEventListener('clipforge:transcription-progress',e=>{
    const msg=String(e.detail?.message||'');const p=$('#cfProductionStatus');if(p&&msg)p.textContent=msg;
  });
  window.addEventListener('clipforge:clips-updated',reveal);
  window.addEventListener('clipforge:open-editor',e=>{
    const card=e.detail?.card;if(!card)return;
    activeCard=card;activeIndex=Number(e.detail?.index)||0;
    const title=editorScreen.querySelector('.cf-opus-section-head h2');if(title)title.textContent=card.querySelector(':scope > strong')?.textContent||'Editar clip';
    const backHolder=editorScreen.querySelector('.cf-opus-section-head');
    const oldBack=backHolder.querySelector('.cf-opus-back');oldBack?.remove();
    const topBack=document.createElement('button');topBack.type='button';topBack.className='cf-opus-back';topBack.textContent='← Todos los clips';topBack.addEventListener('click',()=>{const list=$('#browserCandidateList');restoreCard(card);const nodes=[...list.children];const next=nodes[Math.min(activeIndex,nodes.length)]||null;list.insertBefore(card,next);activeCard=null;setStage('results');});
    backHolder.prepend(topBack);
    editorSlot.replaceChildren(card);
    addInspector(card,e.detail?.clip||{start:0,end:1});
    setStage('editor');
  });
  if(candidates?.querySelector('.candidate-card'))reveal();
  $('#browserExportClips')?.addEventListener('click',()=>{const p=$('#cfProductionStatus');if(p)p.textContent='Preparando la exportación de tus clips…';});
  if($('#browserCandidateList')?.children.length)reveal();
})();