(() => {
  const main = document.querySelector('main');
  const header = document.querySelector('body > header');
  if (!main || document.getElementById('cfWorkspace')) return;
  const $ = selector => document.querySelector(selector);
  const engine = $('#browserEngine');
  const drop = $('.drop');
  const urlImport = $('.browser-url-import');
  const engineControls = engine?.querySelector('.browser-transcribe-controls');
  const transcribe = $('#browserTranscribe');
  const candidates = $('#browserCandidates');
  const editor = $('#projectEditor');
  const exportPanel = $('.browser-export');
  const capacity = $('#videoCapacity');
  const language = $('#browserWhisperLanguage');
  const model = $('#browserWhisperModel');

  // Keep the existing processing engines and IDs intact; only rebuild the presentation.
  if (language) language.value = 'auto';
  if (model) model.value = 'whisper-base';
  if (urlImport) { urlImport.hidden = true; urlImport.setAttribute('aria-hidden','true'); }
  if (engineControls) { engineControls.hidden = true; engineControls.setAttribute('aria-hidden','true'); }
  if (capacity) { capacity.hidden = true; capacity.setAttribute('aria-hidden','true'); }

  const app = document.createElement('div');
  app.id = 'cfWorkspace';
  app.className = 'cf-opus-workspace';
  app.innerHTML = `
    <header class="cf-opus-nav">
      <a class="cf-opus-brand" href="#" aria-label="ClipForge inicio"><span class="cf-opus-mark">c</span><span>clipforge</span></a>
      <nav class="cf-opus-nav-links"><a href="#cfCreate">Crear clips</a><a href="#cfFeatures">Funciones</a><a href="#cfEditor">Editor</a></nav>
      <div class="cf-opus-nav-right"><span class="cf-opus-free"><i></i> Gratis · procesamiento local</span><span id="cfHealthSlot"></span></div>
    </header>
    <main class="cf-opus-main">
      <section class="cf-opus-hero" id="cfCreate">
        <div class="cf-opus-hero-copy">
          <span class="cf-opus-eyebrow"><i></i> AI VIDEO REPURPOSING STUDIO</span>
          <h1>Un vídeo largo.<br><em>Cuatro clips que merecen verse.</em></h1>
          <p>Convierte automáticamente tu vídeo en clips verticales con los mejores momentos, subtítulos dinámicos y encuadre inteligente.</p>
          <div class="cf-opus-trust"><span>✦ Sin API de pago</span><span>✦ Español e inglés</span><span>✦ Tu vídeo permanece en tu dispositivo</span></div>
        </div>
        <section class="cf-opus-upload-card" aria-label="Subir vídeo">
          <div class="cf-opus-upload-top"><div><span class="cf-opus-step">01</span><b>Empieza con tu vídeo</b></div><span class="cf-opus-format">MP4 · MOV · WEBM</span></div>
          <div class="cf-opus-drop-slot"></div>
          <div class="cf-opus-upload-bottom"><span id="cfUploadHint">Sube un vídeo y nosotros hacemos el resto.</span><span class="cf-opus-private">🔒 Procesamiento en tu navegador</span></div>
          <div class="cf-opus-primary-action"></div>
          <div id="cfProductionStatus" class="cf-opus-progress" role="status">Esperando tu vídeo para empezar.</div>
        </section>
      </section>
      <section class="cf-opus-process" aria-label="Proceso automático">
        <div class="cf-opus-process-head"><span>DEL ORIGINAL AL RESULTADO</span><span>Un solo paso para empezar</span></div>
        <div class="cf-opus-steps">
          <div class="cf-opus-step active"><i>1</i><span><b>Analizar</b><small>Audio, imagen y contexto</small></span></div>
          <div class="cf-opus-step"><i>2</i><span><b>Seleccionar</b><small>Los cuatro mejores momentos</small></span></div>
          <div class="cf-opus-step"><i>3</i><span><b>Editar</b><small>Vertical y subtítulos</small></span></div>
          <div class="cf-opus-step"><i>4</i><span><b>Exportar</b><small>MP4 listo para publicar</small></span></div>
        </div>
      </section>
      <section class="cf-opus-feature-strip" id="cfFeatures">
        <article><span class="cf-opus-feature-icon">✦</span><div><b>Selección con contexto</b><small>Detecta historias, reacciones y momentos destacados.</small></div></article>
        <article><span class="cf-opus-feature-icon">▤</span><div><b>Subtítulos dinámicos</b><small>Transcripción sincronizada en español e inglés.</small></div></article>
        <article><span class="cf-opus-feature-icon">▣</span><div><b>Reencuadre inteligente</b><small>Formato 9:16 con seguimiento del sujeto.</small></div></article>
      </section>
      <section class="cf-opus-results" id="cfResults" hidden>
        <div class="cf-opus-section-head"><div><span class="cf-opus-kicker">02 / TUS RESULTADOS</span><h2>Los momentos destacados</h2><p>Cuatro propuestas extraídas del vídeo original. Previsualiza y ajusta cada corte antes de exportar.</p></div><span class="cf-opus-result-pill">4 clips verticales</span></div>
        <div class="cf-opus-candidates-slot"></div>
      </section>
      <section class="cf-opus-editor" id="cfEditor" hidden>
        <div class="cf-opus-section-head"><div><span class="cf-opus-kicker">03 / ESTUDIO DE EDICIÓN</span><h2>Perfecciona tus clips</h2><p>Ajusta el corte, revisa el encuadre y prepara la versión final.</p></div></div>
        <div class="cf-opus-editor-slot"></div>
      </section>
      <section class="cf-opus-export-slot" hidden></section>
      <footer class="cf-opus-footer"><span class="cf-opus-brand-small">clipforge</span><span>Hecho para convertir vídeos en historias que se comparten.</span><span>Procesamiento local · Gratis</span></footer>
    </main>`;
  document.body.classList.add('cf-opus-body');
  main.replaceWith(app);
  const health = header?.querySelector('#health');
  if (health) app.querySelector('#cfHealthSlot').append(health);
  if (header) header.remove();
  const dropSlot = app.querySelector('.cf-opus-drop-slot');
  if (drop) dropSlot.append(drop);
  const actionSlot = app.querySelector('.cf-opus-primary-action');
  if (transcribe) { transcribe.textContent = 'Generar mis 4 clips'; actionSlot.append(transcribe); }
  if (engine) {
    const status = $('#browserWhisperStatus');
    if (status) { status.classList.add('cf-opus-internal'); app.querySelector('.cf-opus-upload-card').append(status); }
    engine.hidden = true;
    engine.setAttribute('aria-hidden','true');
  }
  if (candidates) app.querySelector('.cf-opus-candidates-slot').append(candidates);
  if (editor) {
    const heading = editor.querySelector('.section-head');
    if (heading) heading.remove();
    editor.querySelector(':scope > p.muted')?.remove();
    const preview = editor.querySelector('.editor-preview');
    const settings = exportPanel?.querySelector('.export-settings');
    if (preview && settings) {
      const inspector = document.createElement('aside');
      inspector.className = 'cf-opus-inspector';
      inspector.innerHTML = '<span class="cf-opus-kicker">AJUSTES DEL CLIP</span><b>Estilo y formato</b><p>Personaliza el aspecto de tus subtítulos y el encuadre vertical.</p>';
      inspector.append(settings);
      preview.append(inspector);
    }
    app.querySelector('.cf-opus-editor-slot').append(editor);
  }
  if (exportPanel) {
    const title = exportPanel.querySelector('h3');
    if (title) title.textContent = 'Exportar tus clips';
    exportPanel.querySelector(':scope > p.hint')?.remove();
    const button = $('#browserExportClips');
    if (button) button.textContent = 'Exportar todos los clips';
    app.querySelector('.cf-opus-export-slot').append(exportPanel);
  }

  const progress = $('#cfProductionStatus');
  let started = false;
  let stage = 0;
  function setStage(next) {
    stage = Math.max(0,Math.min(4,next));
    app.querySelectorAll('.cf-opus-step').forEach((item,index)=>{
      item.classList.toggle('active',index===stage-1);
      item.classList.toggle('done',index<stage-1);
    });
  }
  function showResults() {
    const results = app.querySelector('#cfResults');
    const editing = app.querySelector('#cfEditor');
    if (results) results.hidden = false;
    if (editing) editing.hidden = false;
    app.querySelector('.cf-opus-export-slot').hidden = false;
    setStage(3);
  }
  $('#video')?.addEventListener('change',()=>{
    const file=$('#video')?.files?.[0];
    if(!file||started)return;
    started=true;
    const hint=$('#cfUploadHint');
    if(hint)hint.textContent=file.name+' · '+(file.size/1024/1024).toFixed(1)+' MB';
    if(progress)progress.textContent='Vídeo recibido. Preparando análisis automático…';
    setStage(1);
    requestAnimationFrame(()=>setTimeout(()=>{
      if($('#video')?.files?.[0]===file && transcribe && !transcribe.disabled) transcribe.click();
      else started=false;
    },300));
  });
  window.addEventListener('clipforge:transcription-progress',event=>{
    const message=String(event.detail?.message||'');
    if(progress&&message)progress.textContent=message;
    if(/transcrib|extrayendo|cargando whisper|analizando|ffmpeg/i.test(message))setStage(1);
    if(/selecci|candidato|generando clips|juez|editorial/i.test(message))setStage(2);
    if(/export/i.test(message))setStage(4);
  });
  window.addEventListener('clipforge:clips-updated',showResults);
  window.addEventListener('clipforge:editor-ready',showResults);
  $('#browserExportClips')?.addEventListener('click',()=>setStage(4));
  // If a project is restored, reveal its editing workspace as well.
  if($('#browserCandidateList')?.children.length){showResults();}
})();