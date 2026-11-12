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
  // Capture nodes that live inside the original <main> before replacing it.
  // Querying them afterwards returned null and silently detached the ASR output.
  const whisperStatus=$('#browserWhisperStatus');
  const transcriptOutput=$('#browserTranscript');
  const downloadTranscript=$('#downloadBrowserTranscript');
  const saveTranscript=$('#saveBrowserProject');
  const capacityPanel=$('#videoCapacity');
  if(language)language.value='es';
  // Respect the HTML default and any user choice; never silently downgrade a selected model.
  if(model && !model.value) model.value='whisper-large-v3-turbo';
  if(urlImport){urlImport.hidden=true;urlImport.setAttribute('aria-hidden','true');}
  if(controls){controls.hidden=true;controls.setAttribute('aria-hidden','true');}
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
  const trustRow=app.querySelector('.cf-opus-trust');
  if(capacityPanel&&trustRow){capacityPanel.hidden=false;capacityPanel.removeAttribute('aria-hidden');trustRow.after(capacityPanel);}
  // Keep ASR output attached after replacing the original main container.
  const transcriptPanel=document.createElement('section');transcriptPanel.id='cfTranscriptPanel';transcriptPanel.className='cf-transcript-panel';transcriptPanel.hidden=true;
  transcriptPanel.innerHTML='<div class="cf-transcript-panel-head"><div><strong>Transcripción completa</strong><small>Texto reconocido por Whisper con marcas de tiempo. Puedes corregirlo antes de editar los subtítulos.</small></div><span class="cf-transcript-count">Pendiente</span></div>';
  if(transcriptOutput){transcriptOutput.setAttribute('aria-label','Transcripción completa con marcas de tiempo');transcriptPanel.append(transcriptOutput);}
  const transcriptActions=document.createElement('div');transcriptActions.className='cf-transcript-actions';
  if(downloadTranscript)transcriptActions.append(downloadTranscript);if(saveTranscript)transcriptActions.append(saveTranscript);
  transcriptPanel.append(transcriptActions);app.querySelector('.cf-opus-hero').append(transcriptPanel);
  window.addEventListener('clipforge:transcript-ready',event=>{transcriptPanel.hidden=false;const d=event.detail||{};const count=transcriptPanel.querySelector('.cf-transcript-count');if(count)count.textContent=(d.words||0)+' palabras · '+(d.segments||0)+' segmentos temporizados';});
  if(engine){if(whisperStatus){whisperStatus.classList.remove('cf-opus-internal');whisperStatus.setAttribute('aria-live','polite');app.querySelector('.cf-opus-hero').append(whisperStatus);}engine.hidden=true;engine.setAttribute('aria-hidden','true');}
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
    // The Whisper module owns auto-start; this handler only updates the workspace preview.
    delete fileInput.dataset.autoRunStarted;
    const restored=Boolean(window.clipforgeEditorBridge?.getProject?.().transcript?.segments?.length);
    if(restored){
      fileInput.dataset.autoRunStarted='1';
      if(progress)progress.textContent='Vídeo original vinculado al proyecto. Transcripción conservada; abre el proyecto para continuar sin repetir el análisis.';
    } else if(progress) {
      progress.textContent='Vídeo cargado. Inicializando motor Whisper local…';
    }
  });
  // The language/model controls must remain in the live DOM; the original engine
  // container is replaced, so detached selects silently forced Whisper to auto/base.
  const asrOptions=document.createElement('div');asrOptions.className='cf-opus-asr-options';
  const languageLabel=language?.closest('label'),modelLabel=model?.closest('label');
  if(languageLabel)asrOptions.append(languageLabel);if(modelLabel)asrOptions.append(modelLabel);
  asrOptions.setAttribute('aria-label','Ajustes de transcripción');
  const uploadRow=app.querySelector('.cf-opus-upload-row');if(uploadRow)uploadRow.after(asrOptions);
  const auto=app.querySelector('.cf-opus-auto');auto?.addEventListener('click',()=>transcribe?.click());
  let activeCard=null,activeIndex=-1;const originalCardNodes=new WeakMap();
  const results=$('#cfResults'),editorScreen=$('#cfEditor'),resultSlot=app.querySelector('.cf-opus-candidates-slot'),editorSlot=app.querySelector('.cf-opus-editor-slot');
  // Keep batch export reachable from the results screen; the legacy export panel
  // remains visually hidden inside the workspace shell, so expose its action here.
  const batchExportButton=document.createElement('button');
  batchExportButton.type='button';
  batchExportButton.className='cf-opus-export-all';
  batchExportButton.textContent='Exportar los 4 clips juntos';
  batchExportButton.disabled=true;
  batchExportButton.style.setProperty('width',window.innerWidth<=650?'100%':'auto','important');
  batchExportButton.style.setProperty('flex','0 0 auto','important');
  batchExportButton.style.setProperty('white-space','nowrap','important');
  batchExportButton.addEventListener('click',()=>$('#browserExportClips')?.click());
  results?.querySelector('.cf-opus-section-head')?.append(batchExportButton);
  function syncBatchExportButton(){
    const selected=candidates?.querySelectorAll('.candidate-select input:checked').length||0;
    batchExportButton.textContent=selected===4?'Exportar los 4 clips juntos':`Exportar ${selected} clips juntos`;
    batchExportButton.disabled=selected===0;
  }
  window.addEventListener('clipforge:candidate-edited',syncBatchExportButton);
  if(saveTranscript){saveTranscript.textContent='Guardar proyecto editable';saveTranscript.style.setProperty('width',window.innerWidth<=650?'100%':'auto','important');saveTranscript.style.setProperty('flex','0 0 auto','important');saveTranscript.style.setProperty('white-space','nowrap','important');results?.querySelector('.cf-opus-section-head')?.append(saveTranscript);}
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
    const toolRail=document.createElement('nav');toolRail.className='cf-editor-tool-rail';toolRail.setAttribute('aria-label','Herramientas del editor');
    const toolDefs=[['▧','Medios','captions'],['T','Texto','text'],['CC','Subtítulos','captions'],['✧','Efectos','animation'],['⇄','Transiciones','animation'],['♫','Audio','tts'],['⚙','Ajustes','tracking']];
    toolDefs.forEach(([glyph,label,target],i)=>{const button=document.createElement('button');button.type='button';button.className='cf-editor-tool'+(i===0?' is-active':'');button.innerHTML='<span>'+glyph+'</span><small>'+label+'</small>';button.title=label;button.addEventListener('click',()=>{const tab=tabs.querySelector('[data-tab="'+target+'"]');tab?.click();toolRail.querySelectorAll('button').forEach(x=>x.classList.toggle('is-active',x===button));});toolRail.append(button);});
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
    const animationPane=document.createElement('section');animationPane.className='cf-opus-pane';animationPane.dataset.pane='animation';animationPane.innerHTML='<div class="cf-opus-pane-title">Animación de subtítulos</div><label>Entrada<select class="cf-caption-in"><option value="none">Sin animación</option><option value="fade">Fundido</option><option value="pop">Aparecer con énfasis</option><option value="slide">Deslizar</option></select></label><label>Estilo de palabra<select class="cf-caption-word"><option value="line">Línea completa</option><option value="highlight">Resaltar palabra activa</option></select></label><p>La vista previa aplica el estilo seleccionado a los subtítulos del clip.</p>';
    const ttsPane=document.createElement('section');ttsPane.className='cf-opus-pane';ttsPane.dataset.pane='tts';ttsPane.innerHTML='<div class="cf-opus-pane-title">Texto a voz</div><label>Texto para escuchar<textarea class="cf-tts-copy" rows="4" placeholder="Escribe el texto que quieras escuchar…"></textarea></label><label>Voz<select class="cf-tts-voice"></select></label><button type="button" class="cf-opus-add-overlay cf-tts-play">Escuchar texto</button><p>Utiliza las voces disponibles en tu navegador.</p>';
    const voiceSelect=ttsPane.querySelector('.cf-tts-voice');const voices=window.speechSynthesis?.getVoices?.()||[];voices.forEach(v=>{const o=document.createElement('option');o.value=v.name;o.textContent=v.name+' · '+v.lang;voiceSelect.append(o);});
    ttsPane.querySelector('.cf-tts-play').addEventListener('click',()=>{const text=ttsPane.querySelector('.cf-tts-copy').value.trim();if(!text||!window.speechSynthesis)return;window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);const voice=window.speechSynthesis.getVoices().find(v=>v.name===voiceSelect.value);if(voice)utterance.voice=voice;window.speechSynthesis.speak(utterance);});
    const tabDefs=[['captions','Subtítulos'],['text','Texto'],['animation','Animación'],['tracking','Tracking'],['tts','Texto a voz']];
    tabDefs.forEach(([key,label],i)=>{const button=document.createElement('button');button.type='button';button.className='cf-opus-tab'+(i===0?' is-active':'');button.textContent=label;button.dataset.tab=key;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(i===0));button.addEventListener('click',()=>{tabs.querySelectorAll('button').forEach(b=>{b.classList.toggle('is-active',b===button);b.setAttribute('aria-selected',String(b===button));});panes.querySelectorAll('.cf-opus-pane').forEach(p=>p.classList.toggle('is-active',p.dataset.pane===key));});tabs.append(button);});
    panes.append(captionsPane,textPane,animationPane,trackingPane,ttsPane);inspector.append(tabs,panes);
    if(player)preview.append(player);
    preview.prepend(toolRail);
    layout.append(preview,inspector);
    // Apply the core editor geometry inline: it must not depend on a stale
    // cached stylesheet or on the browser resolving a cascade of old rules.
    const syncEditorGeometry=()=>{
      const width=window.innerWidth;
      card.style.setProperty('display','flex','important');
      card.style.setProperty('flex-direction','column','important');
      card.style.setProperty('align-items','stretch','important');
      card.style.setProperty('width','100%','important');
      card.style.setProperty('min-width','0','important');
      layout.style.setProperty('display','grid','important');
      layout.style.setProperty('grid-template-columns',width>=1100?'minmax(0,1.05fr) minmax(0,.95fr)':'minmax(0,1fr)','important');
      layout.style.setProperty('align-items','start','important');
      layout.style.setProperty('gap',width<=650?'12px':'16px','important');
      layout.style.setProperty('width','100%','important');
      layout.style.setProperty('min-width','0','important');
      preview.style.setProperty('display','grid','important');
      preview.style.setProperty('grid-template-columns',width<=650?'minmax(0,1fr)':width<=1100?'48px minmax(0,1fr)':'58px minmax(0,1fr)','important');
      preview.style.setProperty('align-content','start','important');
      preview.style.setProperty('align-items','start','important');
      preview.style.setProperty('justify-items','stretch','important');
      preview.style.setProperty('min-height','0','important');
      preview.style.setProperty('height','auto','important');
      const playerEl=preview.querySelector('.cf-inline-player');
      if(playerEl){
        playerEl.style.setProperty('display','flex','important');
        playerEl.style.setProperty('flex-direction','column','important');
        playerEl.style.setProperty('align-items','center','important');
        playerEl.style.setProperty('justify-self','center','important');
        playerEl.style.setProperty('align-self','start','important');
        playerEl.style.setProperty('width','min(100%,'+(width<=650?'360px':'420px')+')','important');
        playerEl.style.setProperty('min-width','0','important');
        playerEl.style.setProperty('margin','0','important');
        const video=playerEl.querySelector('video');
        if(video){video.style.setProperty('display','block','important');video.style.setProperty('width','100%','important');video.style.setProperty('max-width','100%','important');video.style.setProperty('height','auto','important');video.style.setProperty('max-height','72vh','important');video.style.setProperty('aspect-ratio','9 / 16','important');video.style.setProperty('object-fit','contain','important');video.style.setProperty('box-sizing','border-box','important');}
      }
      inspector.style.setProperty('width','100%','important');
      inspector.style.setProperty('min-width','0','important');
      inspector.style.setProperty('align-self','start','important');
      if(timeline){timeline.style.setProperty('width','100%','important');timeline.style.setProperty('max-width','100%','important');timeline.style.setProperty('min-width','0','important');timeline.style.setProperty('box-sizing','border-box','important');}
    };
    card.classList.add('cf-opus-editing-card');
    if(heading)card.append(heading);
    card.append(layout);
    if(timeline)card.append(timeline);
    syncEditorGeometry();
    window.addEventListener('resize',syncEditorGeometry,{passive:true});
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
    syncBatchExportButton();
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
    editorSlot.replaceChildren();
    const editorBar=document.createElement('div');editorBar.className='cf-editor-topbar';editorBar.innerHTML='<div class="cf-editor-project"><strong>ClipForge</strong><span>Proyecto editable</span><i>Cambios en esta sesión</i></div><div class="cf-editor-format"><span>Formato</span><b>9:16</b></div><button type="button" class="cf-editor-export-top">Exportar MP4 ↗</button>';editorBar.querySelector('.cf-editor-export-top').addEventListener('click',()=>card.querySelector('.candidate-export-one')?.click());const saveProjectAction=document.createElement('button');saveProjectAction.type='button';saveProjectAction.className='secondary cf-editor-save-project';saveProjectAction.textContent='Guardar proyecto';saveProjectAction.addEventListener('click',()=>saveTranscript?.click());saveProjectAction.style.setProperty('width',window.innerWidth<=650?'100%':'auto','important');saveProjectAction.style.setProperty('flex','0 0 auto','important');saveProjectAction.style.setProperty('white-space','nowrap','important');saveProjectAction.style.setProperty('max-width','100%','important');editorBar.insertBefore(saveProjectAction,editorBar.querySelector('.cf-editor-export-top'));
    editorSlot.append(editorBar,card);
    addInspector(card,e.detail?.clip||{start:0,end:1});
    setStage('editor');
  });
  if(candidates?.querySelector('.candidate-card'))reveal();
  $('#browserExportClips')?.addEventListener('click',()=>{const p=$('#cfProductionStatus');if(p)p.textContent='Preparando la exportación de tus clips…';});
  if($('#browserCandidateList')?.children.length)reveal();
})();