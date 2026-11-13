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
    } else {
      if(progress)progress.textContent='Vídeo cargado. Iniciando extracción de audio y transcripción Whisper…';
      fileInput.dataset.whisperAutoStarted='1';
      window.clipforgeUpdateVideoCapacity?.(file).catch(error=>console.warn('No se pudo calcular la capacidad del vídeo:',error));
      window.setTimeout(()=>{
        if(!transcribe || !document.contains(transcribe)){
          if(progress)progress.textContent='Error: el botón Generar mis 4 clips no está conectado.';
          return;
        }
        if(transcribe.disabled){
          if(progress)progress.textContent='Whisper ya está trabajando. Espera a que termine el análisis actual.';
          return;
        }
        transcribe.click();
      },500);
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
    const player=card.querySelector('.cf-inline-player'),film=player?.querySelector('video'),persistClipEdit=patch=>{Object.assign(clip,patch||{});const index=Number(card.dataset.candidateIndex);if(window.__cfUpdateCandidateClip?.(index,patch||{}))return;const field=document.querySelector('[name=\"selected_clip_ranges\"]');if(field){try{const items=JSON.parse(field.value||'[]');if(items[index]){items[index]={...items[index],...(patch||{})};field.value=JSON.stringify(items);window.dispatchEvent(new CustomEvent('clipforge:candidate-edited'));}}catch(error){console.warn('No se pudo guardar el ajuste del clip:',error);}}},timeline=card.querySelector('.cf-clip-timeline'),captions=card.querySelector('.cf-inline-subtitles');
    const heading=card.querySelector(':scope > strong');
    const exportOne=card.querySelector('.candidate-export-one'),select=card.querySelector('.candidate-select');
    const layout=document.createElement('div');layout.className='cf-opus-editor-layout';
    const sidebar=document.createElement('aside');sidebar.className='cf-opus-left-sidebar';
    const sidebarTitle=document.createElement('div');sidebarTitle.className='cf-opus-sidebar-title';sidebarTitle.textContent='PROYECTO';sidebar.append(sidebarTitle);
    const projectSource=document.createElement('div');projectSource.className='cf-opus-project-source';
    const sourceName=document.createElement('strong');sourceName.textContent=$('#filename')?.textContent||'Vídeo del proyecto';
    const sourceDuration=document.createElement('small');sourceDuration.textContent='Vídeo original · 9:16';
    projectSource.append(sourceName,sourceDuration);sidebar.append(projectSource);
    const projectStatus=document.createElement('div');projectStatus.className='cf-opus-project-status';projectStatus.innerHTML='<span>✓</span> Transcripción completa<br><span>✓</span> Momentos detectados<br><span>✓</span> Clips seleccionados';sidebar.append(projectStatus);
    const sidebarToolsTitle=document.createElement('div');sidebarToolsTitle.className='cf-opus-sidebar-title';sidebarToolsTitle.textContent='HERRAMIENTAS';sidebar.append(sidebarToolsTitle);
    const preview=document.createElement('section');preview.className='cf-opus-preview-column';
    const clipPanel=document.createElement('aside');clipPanel.className='cf-opus-clips-panel';
    const clipPanelHead=document.createElement('div');clipPanelHead.className='cf-opus-clips-head';clipPanelHead.innerHTML='<span>✦</span><strong>Clips generados</strong>';clipPanel.append(clipPanelHead);
    const liveCandidateList=$('#browserCandidateList');if(liveCandidateList){liveCandidateList.classList.add('cf-opus-live-clip-list');clipPanel.append(liveCandidateList);}
    const clipAdd=document.createElement('button');clipAdd.type='button';clipAdd.className='cf-opus-add-clip';clipAdd.textContent='+ Añadir clip';clipAdd.addEventListener('click',()=>window.dispatchEvent(new CustomEvent('clipforge:add-clip-request')));clipPanel.append(clipAdd);
    const toolRail=document.createElement('nav');toolRail.className='cf-editor-tool-rail';toolRail.setAttribute('aria-label','Herramientas del editor');
    const toolDefs=[['▧','Medios','media'],['T','Texto','text'],['CC','Subtítulos','captions'],['✧','Filtros','effects'],['⇄','Transiciones','transitions'],['♫','Audio','audio'],['⚙','Ajustes','tracking']];
    toolDefs.forEach(([glyph,label,target],i)=>{const button=document.createElement('button');button.type='button';button.className='cf-editor-tool'+(i===0?' is-active':'');button.innerHTML='<span>'+glyph+'</span><small>'+label+'</small>';button.title=label;button.addEventListener('click',()=>{const tab=tabs.querySelector('[data-tab="'+target+'"]');tab?.click();toolRail.querySelectorAll('button').forEach(x=>x.classList.toggle('is-active',x===button));});toolRail.append(button);});
    const inspector=document.createElement('aside');inspector.className='cf-opus-inspector';
    const tabs=document.createElement('div');tabs.className='cf-opus-inspector-tabs';tabs.setAttribute('role','tablist');
    const panes=document.createElement('div');panes.className='cf-opus-inspector-panes';
    const captionsPane=document.createElement('section');captionsPane.className='cf-opus-pane is-active';captionsPane.dataset.pane='captions';if(captions)captionsPane.append(captions);
    const textPane=document.createElement('section');textPane.className='cf-opus-pane';textPane.dataset.pane='text';
    textPane.innerHTML='<div class="cf-opus-pane-title">Añadir texto al vídeo</div><label>Texto<textarea class="cf-overlay-copy" rows="3" placeholder="Escribe un título o llamada…"></textarea></label><div class="cf-opus-text-times"><label>Inicio (s)<input class="cf-overlay-start" type="number" step="0.01"></label><label>Final (s)<input class="cf-overlay-end" type="number" step="0.01"></label></div><button type="button" class="cf-opus-add-overlay">Añadir texto a la pista</button><div class="cf-opus-overlay-list"></div>';
    const textTemplates=document.createElement('div');textTemplates.className='cf-opus-text-templates';textTemplates.innerHTML='<div class="cf-opus-pane-title">Plantillas de texto</div><p>Elige un diseño para aplicarlo a todos los subtítulos del proyecto.</p>';
    [['capcut-bold','Impacto'],['minimal','Minimal'],['outline','Contorno'],['creator','Amarillo'],['neon-pink','Neón rosa'],['neon-cyan','Neón azul'],['red-outline','Borde rojo'],['yellow-bold','Amarillo pro'],['green-pop','Verde'],['violet-glow','Violeta'],['blue-shadow','Azul'],['classic-white','Clásico']].forEach(([key,label])=>{const b=document.createElement('button');b.type='button';b.className='cf-opus-text-template';b.textContent='Aa';b.title=label;b.setAttribute('aria-label','Aplicar estilo '+label);b.addEventListener('click',()=>{const target=captionsPane.querySelector('.cf-caption-style-card[title="'+key+'"]');target?.click();});textTemplates.append(b);});
    textPane.prepend(textTemplates);
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
    const mediaPane=document.createElement('section');mediaPane.className='cf-opus-pane';mediaPane.dataset.pane='media';
    mediaPane.innerHTML='<div class="cf-opus-pane-title">Medios del proyecto</div><p>El vídeo original está vinculado a este clip. Puedes añadir capas de texto desde la pestaña Texto y audio desde la pista de audio.</p><button type="button" class="cf-media-replace">Reemplazar vídeo fuente</button><input class="cf-media-file" type="file" accept="video/*" hidden><div class="cf-media-info"></div>';
    const mediaFile=mediaPane.querySelector('.cf-media-file');mediaPane.querySelector('.cf-media-replace').addEventListener('click',()=>mediaFile.click());mediaFile.addEventListener('change',()=>{const file=mediaFile.files?.[0];if(!file)return;const url=URL.createObjectURL(file);film.src=url;film.load();window.__cfReplacementSource=file;mediaPane.querySelector('.cf-media-info').textContent='Fuente cargada: '+file.name;});
    const effectsPane=document.createElement('section');effectsPane.className='cf-opus-pane';effectsPane.dataset.pane='effects';
    effectsPane.innerHTML='<div class="cf-opus-pane-title">Filtros y corrección</div><label>Filtro<select class="cf-video-filter"><option value="none">Original</option><option value="cinematic">Cinemático</option><option value="warm">Cálido</option><option value="cool">Frío</option><option value="bw">Blanco y negro</option><option value="vintage">Vintage</option><option value="vivid">Intenso</option></select></label><label>Brillo<input class="cf-video-brightness" type="range" min="50" max="160" value="100"></label><label>Contraste<input class="cf-video-contrast" type="range" min="50" max="180" value="100"></label><label>Saturación<input class="cf-video-saturation" type="range" min="0" max="200" value="100"></label><button type="button" class="cf-video-filter-reset">Restablecer filtro</button>';
    const filterSelect=effectsPane.querySelector('.cf-video-filter'),brightness=effectsPane.querySelector('.cf-video-brightness'),contrast=effectsPane.querySelector('.cf-video-contrast'),saturation=effectsPane.querySelector('.cf-video-saturation');
    const filterPresets={none:'',cinematic:'contrast(1.14) saturate(.82)',warm:'sepia(.16) saturate(1.2)',cool:'hue-rotate(12deg) saturate(.9)',bw:'grayscale(1) contrast(1.08)',vintage:'sepia(.32) contrast(.92) saturate(.78)',vivid:'saturate(1.45) contrast(1.08)'};
    const applyVideoFilter=()=>{const fx={preset:filterSelect.value,brightness:Number(brightness.value),contrast:Number(contrast.value),saturation:Number(saturation.value)};persistClipEdit({visualEffects:fx});const base=filterPresets[fx.preset]||'';film.style.filter=[base,'brightness('+fx.brightness+'%)','contrast('+fx.contrast+'%)','saturate('+fx.saturation+'%)'].filter(Boolean).join(' ');};
    [filterSelect,brightness,contrast,saturation].forEach(el=>el.addEventListener('input',applyVideoFilter));effectsPane.querySelector('.cf-video-filter-reset').addEventListener('click',()=>{filterSelect.value='none';brightness.value=contrast.value=saturation.value='100';applyVideoFilter();});
    const transitionsPane=document.createElement('section');transitionsPane.className='cf-opus-pane';transitionsPane.dataset.pane='transitions';
    transitionsPane.innerHTML='<div class="cf-opus-pane-title">Transiciones del clip</div><label>Entrada<select class="cf-transition-in"><option value="none">Ninguna</option><option value="fade">Fundido</option><option value="zoom">Zoom suave</option></select></label><label>Salida<select class="cf-transition-out"><option value="none">Ninguna</option><option value="fade">Fundido</option><option value="zoom">Zoom suave</option></select></label><label>Duración (s)<input class="cf-transition-duration" type="number" min="0.1" max="2" step="0.1" value="0.5"></label><p>Las transiciones se guardan como ajustes del clip. La previsualización y exportación se sincronizarán en el siguiente paso del motor de render.</p>';
    const applyTransitions=()=>{persistClipEdit({transitions:{in:transitionsPane.querySelector('.cf-transition-in').value,out:transitionsPane.querySelector('.cf-transition-out').value,duration:Math.max(.1,Math.min(2,Number(transitionsPane.querySelector('.cf-transition-duration').value)||.5))}});const t=Math.max(0,film.currentTime-Number(clip.start)),d=clip.transitions.duration;let opacity=1;if(clip.transitions.in==='fade')opacity=Math.min(opacity,t/d);if(clip.transitions.out==='fade')opacity=Math.min(opacity,Math.max(0,(Number(clip.end)-film.currentTime)/d));film.style.opacity=String(Math.max(0,Math.min(1,opacity)));film.style.transition='opacity 80ms linear';};
    transitionsPane.querySelectorAll('select,input').forEach(el=>el.addEventListener('change',applyTransitions));film.addEventListener('timeupdate',applyTransitions);
    const audioPane=document.createElement('section');audioPane.className='cf-opus-pane';audioPane.dataset.pane='audio';audioPane.innerHTML='<div class="cf-opus-pane-title">Audio</div><label>Volumen del vídeo<input class="cf-audio-volume" type="range" min="0" max="100" value="80"></label><label>Silenciar vídeo<input class="cf-audio-mute" type="checkbox"></label><p>La pista de forma de onda muestra el audio original. La mezcla multipista se prepara desde el audio del proyecto.</p>';
    audioPane.querySelector('.cf-audio-volume').addEventListener('input',event=>{film.volume=Number(event.target.value)/100;film.muted=film.volume===0;});audioPane.querySelector('.cf-audio-mute').addEventListener('change',event=>{film.muted=event.target.checked;});
    const trackingPane=document.createElement('section');trackingPane.className='cf-opus-pane';trackingPane.dataset.pane='tracking';
    trackingPane.innerHTML='<div class="cf-opus-pane-title">Encuadre y seguimiento</div><p>Elige cómo adaptar el vídeo al formato vertical 9:16. El seguimiento facial utiliza el detector disponible en el navegador y puede recurrir a un encuadre seguro si no detecta una persona.</p>';
    const cropSelect=$('#browserCropMode');if(cropSelect){const label=cropSelect.closest('label');if(label)trackingPane.append(label);}
    const animationPane=document.createElement('section');animationPane.className='cf-opus-pane';animationPane.dataset.pane='animation';animationPane.innerHTML='<div class="cf-opus-pane-title">Animación de subtítulos</div><label>Entrada<select class="cf-caption-in"><option value="none">Sin animación</option><option value="fade">Fundido</option><option value="pop">Aparecer con énfasis</option><option value="slide">Deslizar</option></select></label><label>Estilo de palabra<select class="cf-caption-word"><option value="line">Línea completa</option><option value="highlight">Resaltar palabra activa</option></select></label><p>La vista previa aplica el estilo seleccionado a los subtítulos del clip.</p>';
    const captionAnimation=animationPane.querySelector('.cf-caption-in'),captionWordMode=animationPane.querySelector('.cf-caption-word');
    captionAnimation.addEventListener('change',()=>{const control=inspector.querySelector('.cf-subtitle-animation');if(control){control.value=captionAnimation.value;control.dispatchEvent(new Event('input',{bubbles:true}));}else window.__cfApplySubtitlePatch?.({animation:captionAnimation.value});});
    captionWordMode.addEventListener('change',()=>window.__cfApplySubtitlePatch?.({wordMode:captionWordMode.value}));
    window.addEventListener('clipforge:subtitle-style-updated',event=>{const value=event.detail?.style;if(!value)return;captionAnimation.value=value.animation||'none';captionWordMode.value=value.wordMode||'line';});

    const ttsPane=document.createElement('section');ttsPane.className='cf-opus-pane';ttsPane.dataset.pane='tts';ttsPane.innerHTML='<div class="cf-opus-pane-title">Texto a voz</div><label>Texto para escuchar<textarea class="cf-tts-copy" rows="4" placeholder="Escribe el texto que quieras escuchar…"></textarea></label><label>Voz<select class="cf-tts-voice"></select></label><button type="button" class="cf-opus-add-overlay cf-tts-play">Escuchar texto</button><p>Utiliza las voces disponibles en tu navegador.</p>';
    const voiceSelect=ttsPane.querySelector('.cf-tts-voice');const voices=window.speechSynthesis?.getVoices?.()||[];voices.forEach(v=>{const o=document.createElement('option');o.value=v.name;o.textContent=v.name+' · '+v.lang;voiceSelect.append(o);});
    ttsPane.querySelector('.cf-tts-play').addEventListener('click',()=>{const text=ttsPane.querySelector('.cf-tts-copy').value.trim();if(!text||!window.speechSynthesis)return;window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);const voice=window.speechSynthesis.getVoices().find(v=>v.name===voiceSelect.value);if(voice)utterance.voice=voice;window.speechSynthesis.speak(utterance);});
    const tabDefs=[['media','Medios'],['captions','Subtítulos'],['text','Texto'],['effects','Filtros'],['transitions','Transiciones'],['audio','Audio'],['animation','Animación'],['tracking','Tracking'],['tts','Texto a voz']];
    tabDefs.forEach(([key,label],i)=>{const button=document.createElement('button');button.type='button';button.className='cf-opus-tab'+(i===0?' is-active':'');button.textContent=label;button.dataset.tab=key;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(i===0));button.addEventListener('click',()=>{tabs.querySelectorAll('button').forEach(b=>{b.classList.toggle('is-active',b===button);b.setAttribute('aria-selected',String(b===button));});panes.querySelectorAll('.cf-opus-pane').forEach(p=>p.classList.toggle('is-active',p.dataset.pane===key));});tabs.append(button);});
    panes.append(mediaPane,captionsPane,textPane,effectsPane,transitionsPane,audioPane,animationPane,trackingPane,ttsPane);inspector.append(tabs,panes);
    sidebar.append(toolRail);
    if(player)preview.append(player);
    layout.append(sidebar,clipPanel,preview,inspector);
    // Apply the core editor geometry inline: it must not depend on a stale
    // cached stylesheet or on the browser resolving a cascade of old rules.
    const syncEditorGeometry=()=>{
      const width=window.innerWidth;const height=window.visualViewport?.height||window.innerHeight;
      card.style.setProperty('display','flex','important');
      card.style.setProperty('flex-direction','column','important');
      card.style.setProperty('align-items','stretch','important');
      card.style.setProperty('width','100%','important');
      card.style.setProperty('min-width','0','important');
      layout.style.setProperty('display','grid','important');
      layout.style.setProperty('grid-template-columns',width>=1400?'164px minmax(190px,220px) minmax(300px,1fr) minmax(330px,360px)':width>=1200?'150px minmax(165px,195px) minmax(270px,1fr) minmax(300px,330px)':width>=900?'132px minmax(245px,1fr) minmax(270px,310px)':'minmax(0,1fr)','important');
      const timelineHeight=Math.max(190,Math.min(230,Math.round(height*.24)));
      card.style.setProperty('flex','1 1 auto','important');card.style.setProperty('height','100%','important');card.style.setProperty('max-height','100%','important');card.style.setProperty('min-height','0','important');
      layout.style.setProperty('align-items','stretch','important');layout.style.setProperty('flex','1 1 auto','important');layout.style.setProperty('height','0','important');layout.style.setProperty('min-height','0','important');layout.style.setProperty('max-height','none','important');layout.style.setProperty('overflow','hidden','important');
      layout.style.setProperty('gap',width<=650?'12px':'16px','important');
      layout.style.setProperty('width','100%','important');
      layout.style.setProperty('min-width','0','important');
      sidebar.style.setProperty('display','flex','important');
      sidebar.style.setProperty('flex-direction','column','important');
      sidebar.style.setProperty('gap','8px','important');
      sidebar.style.setProperty('min-width','0','important');
      clipPanel.style.setProperty('display','flex','important');
      clipPanel.style.setProperty('flex-direction','column','important');
      clipPanel.style.setProperty('min-width','0','important');
      clipPanel.style.setProperty('max-height','100%','important');
      clipPanel.style.setProperty('overflow','hidden','important');
      toolRail.style.setProperty('display','flex','important');
      toolRail.style.setProperty('flex-direction',width>=1200?'column':'row','important');
      toolRail.style.setProperty('flex-wrap',width>=1200?'nowrap':'wrap','important');
      preview.style.setProperty('display','flex','important');
      preview.style.setProperty('align-items','center','important');
      preview.style.setProperty('justify-content','center','important');
      preview.style.setProperty('min-width','0','important');
      preview.style.setProperty('min-height','0','important');preview.style.setProperty('height','100%','important');preview.style.setProperty('max-height','100%','important');preview.style.setProperty('overflow','hidden','important');
      preview.style.setProperty('padding','8px','important');
      const playerEl=preview.querySelector('.cf-inline-player');
      if(playerEl){
        playerEl.style.setProperty('display','flex','important');
        playerEl.style.setProperty('flex-direction','column','important');
        playerEl.style.setProperty('align-items','center','important');
        playerEl.style.setProperty('justify-self','center','important');
        playerEl.style.setProperty('align-self','center','important');
        playerEl.style.setProperty('width','min(100%,'+(width<=650?'280px':width<1200?'300px':'340px')+')','important');
        playerEl.style.setProperty('min-width','0','important');
        playerEl.style.setProperty('margin','0','important');
        const video=playerEl.querySelector('video');
        if(video){video.style.setProperty('display','block','important');video.style.setProperty('width','100%','important');video.style.setProperty('max-width','100%','important');video.style.setProperty('height','auto','important');video.style.setProperty('max-height','min(40vh,360px)','important');video.style.setProperty('min-height','0','important');video.style.setProperty('aspect-ratio','9 / 16','important');video.style.setProperty('object-fit','contain','important');video.style.setProperty('box-sizing','border-box','important');}
      }
      inspector.style.setProperty('width','100%','important');
      inspector.style.setProperty('min-width','0','important');
      inspector.style.setProperty('align-self','stretch','important');inspector.style.setProperty('max-height','100%','important');inspector.style.setProperty('overflow','hidden','important');
      if(timeline){timeline.style.setProperty('width','100%','important');timeline.style.setProperty('height',timelineHeight+'px','important');timeline.style.setProperty('flex','0 0 '+timelineHeight+'px','important');timeline.style.setProperty('min-height','0','important');timeline.style.setProperty('max-height',timelineHeight+'px','important');timeline.style.setProperty('overflow','hidden','important');timeline.style.setProperty('max-width','100%','important');timeline.style.setProperty('min-width','0','important');timeline.style.setProperty('box-sizing','border-box','important');}
    };
    card.classList.add('cf-opus-editing-card');
    if(heading)card.append(heading);
    card.append(layout);
    if(timeline)card.append(timeline);
    syncEditorGeometry();
    window.addEventListener('resize',syncEditorGeometry,{passive:true});window.visualViewport?.addEventListener('resize',syncEditorGeometry,{passive:true});requestAnimationFrame(syncEditorGeometry);
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
    const candidateList=$('#browserCandidateList');
    if(activeCard===card)return;
    if(activeCard){
      const previous=activeCard,previousIndex=activeIndex;
      restoreCard(previous);
      const anchor=candidateList?.children?.[previousIndex]||null;
      candidateList?.insertBefore(previous,anchor);
    }
    activeCard=card;activeIndex=Number(e.detail?.index)||0;
    window.__cfActiveClipVideo=card.querySelector('video');
    const title=editorScreen.querySelector('.cf-opus-section-head h2');if(title)title.textContent=card.querySelector(':scope > strong')?.textContent||'Editar clip';
    const backHolder=editorScreen.querySelector('.cf-opus-section-head');
    const oldBack=backHolder.querySelector('.cf-opus-back');oldBack?.remove();
    const topBack=document.createElement('button');topBack.type='button';topBack.className='cf-opus-back';topBack.textContent='← Todos los clips';topBack.addEventListener('click',()=>{const list=$('#browserCandidateList');restoreCard(card);const nodes=[...list.children];const next=nodes[Math.min(activeIndex,nodes.length)]||null;list.insertBefore(card,next);activeCard=null;setStage('results');});
    editorSlot.replaceChildren();
    const appNav=document.createElement('div');appNav.className='cf-editor-appnav';appNav.innerHTML='<a class="cf-editor-logo" href="#cfCreate"><span>▶</span> ClipForge <b>PRO</b></a><nav><a href="#cfCreate">Inicio</a><a href="#cfCreate">Nuevo proyecto</a><a class="active" href="#cfEditor">Editor</a><a href="#cfResults">Proyectos</a></nav><div class="cf-editor-account"><span>PROYECTO EN CURSO</span><b>9:16</b></div>';
    const editorBar=document.createElement('div');editorBar.className='cf-editor-topbar';editorBar.innerHTML='<div class="cf-editor-project"><strong>ClipForge</strong><span>Proyecto editable</span><i>Cambios en esta sesión</i></div><div class="cf-editor-format"><span>Formato</span><b>9:16</b></div><button type="button" class="cf-editor-export-top">Exportar MP4 ↗</button>';editorBar.querySelector('.cf-editor-export-top').addEventListener('click',()=>card.querySelector('.candidate-export-one')?.click());const saveProjectAction=document.createElement('button');saveProjectAction.type='button';saveProjectAction.className='secondary cf-editor-save-project';saveProjectAction.textContent='Guardar proyecto';saveProjectAction.addEventListener('click',()=>saveTranscript?.click());saveProjectAction.style.setProperty('width',window.innerWidth<=650?'100%':'auto','important');saveProjectAction.style.setProperty('flex','0 0 auto','important');saveProjectAction.style.setProperty('white-space','nowrap','important');saveProjectAction.style.setProperty('max-width','100%','important');editorBar.insertBefore(saveProjectAction,editorBar.querySelector('.cf-editor-export-top'));
    editorBar.prepend(topBack);
    editorSlot.append(editorBar);
    setStage('editor');
    const legacyCard=card;
    if(window.ClipForgeStudio?.open){
      const bridgeProject=window.clipforgeEditorBridge?.getProject?.()||{};
      window.ClipForgeStudio.open({
        card:legacyCard,
        clip:e.detail?.clip||{start:0,end:1},
        index:activeIndex,
        allClips:bridgeProject.clips||[],
        transcript:bridgeProject.transcript||null,
        onBack:()=>{activeCard=null;setStage('results');},
        onSave:project=>{
          // Studio already persists its canonical project and synchronizes tracks/candidate edits.
          // Rebuilding all result cards here would detach the active editor and lose card state.
          const button=editorSlot.querySelector('.cf-studio-topbar [data-action="save"]');
          if(button)button.title='Proyecto guardado localmente';
        },
        onExport:()=>$('#browserExportClips')?.click()
      });
    }else{
      editorSlot.append(legacyCard);
      addInspector(legacyCard,e.detail?.clip||{start:0,end:1});
    }
  });
  if(candidates?.querySelector('.candidate-card'))reveal();
  $('#browserExportClips')?.addEventListener('click',()=>{const p=$('#cfProductionStatus');if(p)p.textContent='Preparando la exportación de tus clips…';});
  // Notify the Whisper module after the redesigned workspace has moved the
  // original file input and action button into their final live DOM positions.
  window.dispatchEvent(new CustomEvent('clipforge:workspace-ready'));
  if($('#browserCandidateList')?.children.length)reveal();
})();