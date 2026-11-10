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
    <div class="cf-opus-announcement">ClipForge AI Studio <span>Convierte un vídeo largo en clips listos para publicar</span><a href="#cfShowcase">Descubre cómo funciona ↓</a></div>
    <header class="cf-opus-nav">
      <a class="cf-opus-brand" href="#" aria-label="ClipForge"><span class="cf-opus-mark">C</span>ClipForge</a>
      <nav><a href="#cfCreate">Crear clips</a><a href="#cfShowcase">Cómo funciona</a><a href="#cfResults">Mis clips</a></nav>
      <div class="cf-opus-nav-right"><span class="cf-opus-free">● GRATIS · SIN API DE PAGO</span><span id="cfHealthSlot"></span></div>
    </header>
    <main class="cf-opus-main">
      <section class="cf-opus-hero" id="cfCreate">
        <span class="cf-opus-eyebrow">AI CLIP GENERATOR</span>
        <h1>1 vídeo largo, 4 clips virales.<br><em>Crea contenido mucho más rápido.</em></h1>
        <p>ClipForge analiza tu vídeo, encuentra los momentos con más potencial y los transforma en clips verticales con subtítulos.</p>
        <div class="cf-opus-upload-row"><div class="cf-opus-drop-slot"></div><div class="cf-opus-primary-action"></div><button type="button" class="cf-opus-auto">Auto-edit <span>✦</span></button></div>
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
      <footer class="cf-opus-footer"><b>ClipForge</b><span>Un vídeo. Cuatro oportunidades de viralizar.</span><span>Procesamiento local · Gratis</span></footer>
    </main>`;
  document.body.classList.add('cf-opus-body');
  if(existing)existing.replaceWith(app);else main.replaceWith(app);
  const health=header?.querySelector('#health');if(health)app.querySelector('#cfHealthSlot').append(health);header?.remove();
  if(drop)app.querySelector('.cf-opus-drop-slot').append(drop);
  if(transcribe){transcribe.textContent='Get free clips';app.querySelector('.cf-opus-primary-action').append(transcribe);}
  if(engine){const status=$('#browserWhisperStatus');if(status){status.classList.add('cf-opus-internal');app.querySelector('.cf-opus-hero').append(status);}engine.hidden=true;engine.setAttribute('aria-hidden','true');}
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
  });
  const auto=app.querySelector('.cf-opus-auto');auto?.addEventListener('click',()=>transcribe?.click());
  let stage=0;
  function setStage(n){stage=n;app.querySelectorAll('.cf-opus-demo-clip').forEach((el,i)=>el.classList.toggle('active',i<Math.max(0,n-1)));}
  function reveal(){
    $('#cfResults').hidden=false;$('#cfEditor').hidden=false;app.querySelector('.cf-opus-export-slot').hidden=false;
    const real=app.querySelector('.cf-opus-real-results');if(candidates&&real&&!real.contains(candidates))real.append(candidates);
    setStage(3);
  }
  window.addEventListener('clipforge:transcription-progress',e=>{
    const msg=String(e.detail?.message||'');const p=$('#cfProductionStatus');if(p&&msg)p.textContent=msg;
    if(/transcrib|extrayendo|cargando whisper|analizando|ffmpeg/i.test(msg))setStage(1);
    if(/selecci|candidato|generando clips|juez|editorial/i.test(msg))setStage(2);
    if(/export/i.test(msg))setStage(4);
  });
  window.addEventListener('clipforge:clips-updated',reveal);
  window.addEventListener('clipforge:editor-ready',reveal);
  $('#browserExportClips')?.addEventListener('click',()=>setStage(4));
  if($('#browserCandidateList')?.children.length)reveal();
})();