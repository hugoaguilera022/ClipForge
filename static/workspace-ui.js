(() => {
  const main=document.querySelector('main'),oldHeader=document.querySelector('body > header');
  if(!main||document.getElementById('cfWorkspace'))return;
  const by=s=>document.querySelector(s);
  const hero=by('.hero'),grid=by('.grid'),engine=by('#browserEngine'),editor=by('#projectEditor');
  const candidates=by('#browserCandidates'),exportPanel=by('.browser-export');
  const drop=by('.drop'),urlImport=by('.browser-url-import'),transcribe=by('#browserTranscribe');
  const shell=document.createElement('div');shell.id='cfWorkspace';shell.className='cf-workspace cf-single-page';
  const content=document.createElement('div');content.className='cf-content';
  const top=document.createElement('div');top.className='cf-topbar';
  top.innerHTML='<div><div class="cf-breadcrumb">CLIPFORGE <span>/</span> <b>Crear clips</b></div><div class="cf-page-subtitle">Producción y edición en un mismo espacio</div></div><div class="cf-top-actions"></div>';
  const health=oldHeader?.querySelector('#health');if(health)top.querySelector('.cf-top-actions').append(health);
  content.append(top);
  const host=document.createElement('div');host.className='cf-page-host';content.append(host);
  const production=document.createElement('section');production.className='panel cf-production';
  production.innerHTML='<div class="section-head"><div><span class="step">01 / PRODUCCIÓN</span><h2>Crear clips</h2></div></div><p class="cf-source-label">Añade el vídeo</p>';
  if(drop)production.append(drop);
  if(urlImport)production.append(urlImport);
  if(transcribe){transcribe.textContent='Generar cuatro clips';production.append(transcribe);}
  const progress=document.createElement('div');progress.id='cfProductionStatus';progress.className='engine-progress';progress.setAttribute('role','status');progress.textContent='Selecciona un vídeo o pega un enlace para empezar.';production.append(progress);
  host.append(production);
  const editing=document.createElement('section');editing.id='cfEditingWorkspace';editing.className='cf-editing-workspace';editing.hidden=true;
  const heading=document.createElement('div');heading.className='cf-editor-heading';heading.innerHTML='<span class="step">02 / EDICIÓN</span><h2>Editor</h2>';editing.append(heading);
  if(candidates)editing.append(candidates);
  if(editor){
    const oldHead=editor.querySelector('.section-head');if(oldHead){oldHead.remove();}
    editor.querySelector(':scope > p.muted')?.remove();
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
    if(status){status.id='browserWhisperStatus';status.classList.add('cf-internal-status');production.append(status);}
    engine.hidden=true;engine.setAttribute('aria-hidden','true');
  }
  if(hero)hero.remove();if(grid)grid.remove();
  main.replaceWith(shell);shell.append(content);if(oldHeader)oldHeader.remove();
  const footer=document.querySelector('footer');if(footer)content.append(footer);
  function revealEditor(){
    if(!editing.hidden)return;
    editing.hidden=false;
    requestAnimationFrame(()=>editing.scrollIntoView({behavior:'smooth',block:'start'}));
  }
  window.addEventListener('clipforge:clips-updated',revealEditor);
  window.addEventListener('clipforge:editor-ready',()=>{if((by('#browserCandidateList')?.children.length||0)>0)revealEditor();});
  window.clipforgeShowEditor=revealEditor;
})();