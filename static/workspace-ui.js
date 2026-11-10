(() => {
  const main=document.querySelector('main'),oldHeader=document.querySelector('body > header');
  if(!main||document.getElementById('cfWorkspace'))return;
  const by=s=>document.querySelector(s);
  const hero=by('.hero'),grid=by('.grid'),engine=by('#browserEngine'),editor=by('#projectEditor');
  const candidates=by('#browserCandidates'),exportPanel=by('.browser-export');
  const drop=by('.drop'),urlImport=by('.browser-url-import'),transcribe=by('#browserTranscribe');
  const engineControls=engine?.querySelector('.browser-transcribe-controls');
  const optionLabels=engineControls?[...engineControls.querySelectorAll('label')]:[];
  const languageControl=by('#browserWhisperLanguage');
  const modelControl=by('#browserWhisperModel');
  if(languageControl)languageControl.value='auto';
  if(modelControl)modelControl.value='whisper-base';
  const capacity=by('#videoCapacity');
  const shell=document.createElement('div');shell.id='cfWorkspace';shell.className='cf-workspace cf-single-page';
  const content=document.createElement('div');content.className='cf-content';
  const top=document.createElement('div');top.className='cf-topbar';
  top.innerHTML='<div><div class="cf-breadcrumb">CLIPFORGE <span>/</span> <b>Crear clips</b></div><div class="cf-page-subtitle">Producción y edición en un mismo espacio</div></div><div class="cf-top-actions"></div>';
  const health=oldHeader?.querySelector('#health');if(health)top.querySelector('.cf-top-actions').append(health);
  content.append(top);
  const host=document.createElement('div');host.className='cf-page-host';content.append(host);
  const production=document.createElement('section');production.className='panel cf-production';
  production.innerHTML='<div class="section-head"><div><span class="step">01 / PRODUCCIÓN</span><h2>Crear clips automáticamente</h2><p class="cf-panel-subtitle">Un único vídeo. Detectamos idioma, transcribimos, seleccionamos los cuatro mejores momentos y preparamos la edición vertical.</p></div><span class="tag">Procesamiento local</span></div><nav class="cf-workflow-steps" aria-label="Proceso de creación"><span class="active"><i>1</i> Vídeo</span><span><i>2</i> Analizar</span><span><i>3</i> Seleccionar</span><span><i>4</i> Editar</span><span><i>5</i> Exportar</span></nav><p class="cf-source-label">Selecciona el vídeo original</p>
  if(drop)production.append(drop);
  if(urlImport){urlImport.hidden=true;urlImport.setAttribute('aria-hidden','true');}
  // Keep engine controls available internally, but remove manual setup from the user flow.
  if(engineControls){engineControls.hidden=true;engineControls.setAttribute('aria-hidden','true');}
  if(transcribe){transcribe.textContent='Procesando automáticamente…';production.append(transcribe);}
  if(capacity){capacity.hidden=true;capacity.setAttribute('aria-hidden','true');}
  const progress=document.createElement('div');progress.id='cfProductionStatus';progress.className='engine-progress';progress.setAttribute('role','status');progress.textContent='Selecciona un vídeo. ClipForge hará el resto automáticamente.';production.append(progress);
  host.append(production);
  const editing=document.createElement('section');editing.id='cfEditingWorkspace';editing.className='cf-editing-workspace';editing.hidden=true;
  const heading=document.createElement('div');heading.className='cf-editor-heading';heading.innerHTML='<div><span class="step">02 / RESULTADOS Y EDICIÓN</span><h2>Tus cuatro clips</h2><p>Revisa las propuestas, ajusta los cortes y abre el editor para afinar cada detalle.</p></div><span class="tag">4 clips · vertical 9:16</span>';editing.append(heading);
  if(candidates)editing.append(candidates);
  if(editor){
    const oldHead=editor.querySelector('.section-head');if(oldHead){oldHead.remove();}
    editor.querySelector(':scope > p.muted')?.remove();
    const preview=editor.querySelector('.editor-preview');
    const inspector=document.createElement('aside');inspector.className='cf-editor-inspector';
    inspector.innerHTML='<div class="cf-inspector-heading"><span>AJUSTES DEL CLIP</span><b>Estilo y formato</b></div><p>Personaliza los subtítulos y el encuadre antes de exportar.</p>';
    const exportSettings=exportPanel?.querySelector('.export-settings');
    if(exportSettings)inspector.append(exportSettings);
    if(preview)preview.append(inspector);
    editing.append(editor);
  }
  if(exportPanel){
    const h=exportPanel.querySelector('h3');if(h)h.textContent='Exportar';
    exportPanel.querySelector(':scope > p.hint')?.remove();
    const btn=exportPanel.querySelector('#browserExportClips');if(btn)btn.textContent='Exportar todos los clips';
    editing.append(exportPanel);
  }
  host.append(editing);
  if(engine){
    const status=by('#browserWhisperStatus');
    if(status){status.classList.add('cf-internal-status');production.append(status);}
    engine.hidden=true;engine.setAttribute('aria-hidden','true');
  }
  if(hero)hero.remove();if(grid)grid.remove();
  main.replaceWith(shell);shell.append(content);if(oldHeader)oldHeader.remove();
  const footer=document.querySelector('footer');if(footer)content.append(footer);
  const workflow=production.querySelector('.cf-workflow-steps');
  const sourceTabs=production.querySelector('.cf-source-tabs');
  function selectSource(source){
    const fileMode=source==='file';
    if(drop)drop.hidden=!fileMode;
    if(urlImport)urlImport.hidden=fileMode;
    sourceTabs?.querySelectorAll('button').forEach(button=>{
      const active=button.dataset.source===source;
      button.classList.toggle('active',active);
      button.setAttribute('aria-selected',String(active));
    });
  }
  sourceTabs?.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>selectSource(button.dataset.source)));
  selectSource('file');
  if(sourceTabs)sourceTabs.hidden=true;
  function setStage(stage){
    workflow?.querySelectorAll('span').forEach((item,index)=>{item.classList.toggle('active',index===stage);item.classList.toggle('done',index<stage);});
  }
  function revealEditor(){
    editing.hidden=false;
    setStage(3);
    const title=editing.querySelector('.cf-editor-heading h2');if(title)title.textContent='Tus cuatro clips · Editor';
    requestAnimationFrame(()=>editing.scrollIntoView({behavior:'smooth',block:'start'}));
  }
  window.addEventListener('clipforge:transcription-progress',event=>{
    const message=String(event.detail?.message||'');
    const progress=by('#cfProductionStatus');if(progress&&message)progress.textContent=message;
    if(/transcrib|extrayendo|cargando whisper|analizando/i.test(message))setStage(1);
    if(/selecci|candidato|generando clips|juez|editorial/i.test(message))setStage(2);
  });
  let autoStartPending=false;
  by('#video')?.addEventListener('change',()=>{
    const file=by('#video')?.files?.[0];
    const p=by('#cfProductionStatus');
    if(!file||autoStartPending)return;
    if(p)p.textContent='Vídeo recibido: '+file.name+' · ClipForge está iniciando el análisis automático…';
    autoStartPending=true;
    setStage(1);
    // Start the complete browser pipeline after the file picker has closed.
    requestAnimationFrame(()=>setTimeout(()=>{
      autoStartPending=false;
      if(by('#video')?.files?.[0]===file && transcribe && !transcribe.disabled)transcribe.click();
    },250));
  });
  by('#browserVideoUrl')?.addEventListener('change',()=>setStage(0));
  by('#browserTranscribe')?.addEventListener('click',()=>setStage(1));
  window.addEventListener('clipforge:clips-updated',()=>{setStage(3);revealEditor();});
  by('#browserExportClips')?.addEventListener('click',()=>setStage(4));
  window.addEventListener('clipforge:editor-ready',()=>{if((by('#browserCandidateList')?.children.length||0)>0)revealEditor();});
  window.clipforgeShowEditor=revealEditor;
})();