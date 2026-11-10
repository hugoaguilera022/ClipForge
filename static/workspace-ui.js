(() => {
  const main=document.querySelector('main'),oldHeader=document.querySelector('body > header');
  if(!main||document.getElementById('cfWorkspace'))return;
  const by=s=>document.querySelector(s);
  const hero=by('.hero'),grid=by('.grid'),engine=by('#browserEngine'),editor=by('#projectEditor');
  const candidates=by('#browserCandidates'),exportPanel=by('.browser-export');
  const upload=by('.upload'),drop=by('.drop'),urlImport=by('.browser-url-import'),transcribe=by('#browserTranscribe');
  const pages=[{id:'create',label:'Producción',desc:'Añade un vídeo para generar cuatro clips'},{id:'edit',label:'Editor',desc:'Revisa, ajusta y exporta tus cuatro clips'}];
  const shell=document.createElement('div');shell.id='cfWorkspace';shell.className='cf-workspace';
  const side=document.createElement('aside');side.className='cf-sidebar';
  side.innerHTML='<div class="cf-side-brand"><span class="cf-logo">CF</span><div><b>ClipForge</b><small>CREATOR STUDIO</small></div></div><div class="cf-nav-label">CLIPFORGE</div><nav class="cf-nav" aria-label="Navegación principal"></nav><div class="cf-side-bottom"><span class="cf-status-dot"></span><span>Procesamiento local</span></div>';
  const content=document.createElement('div');content.className='cf-content';
  const top=document.createElement('div');top.className='cf-topbar';
  top.innerHTML='<div><div class="cf-breadcrumb">CLIPFORGE <span>/</span> <b id="cfCurrentPage">Producción</b></div><div class="cf-page-subtitle" id="cfPageSubtitle">'+pages[0].desc+'</div></div><div class="cf-top-actions"></div>';
  const health=oldHeader?.querySelector('#health');if(health)top.querySelector('.cf-top-actions').append(health);
  content.append(top);
  const host=document.createElement('div');host.className='cf-page-host';content.append(host);
  const panes={};
  pages.forEach((p,i)=>{
    const pane=document.createElement('section');pane.className='cf-page';pane.dataset.page=p.id;pane.hidden=i!==0;panes[p.id]=pane;host.append(pane);
    const btn=document.createElement('button');btn.type='button';btn.className='cf-nav-item'+(i===0?' active':'');btn.dataset.target=p.id;btn.innerHTML='<span class="cf-nav-icon">'+(i===0?'＋':'▤')+'</span><span>'+p.label+'</span>';btn.addEventListener('click',()=>activate(p.id));side.querySelector('nav').append(btn);
  });
  const production=document.createElement('section');production.className='panel cf-production';
  production.innerHTML='<div class="section-head"><div><span class="step">01 / PRODUCCIÓN</span><h2>Crear clips</h2></div></div><p class="cf-source-label">Añade el vídeo</p>';
  if(drop)production.append(drop);
  if(urlImport)production.append(urlImport);
  if(transcribe){transcribe.textContent='Generar cuatro clips';production.append(transcribe);}
  const progress=document.createElement('div');progress.id='cfProductionStatus';progress.className='engine-progress';progress.setAttribute('role','status');progress.textContent='Selecciona un vídeo o pega un enlace para empezar.';production.append(progress);
  panes.create.append(production);
  if(engine){
    const status=by('#browserWhisperStatus');if(status){status.id='browserWhisperStatus';status.classList.add('cf-internal-status');production.append(status);}
    // Keep analysis and candidate state alive, but remove technical controls from the visible workflow.
    engine.hidden=true;engine.setAttribute('aria-hidden','true');
  }
  if(hero)hero.remove();if(grid)grid.remove();
  if(editor)panes.edit.append(editor);
  if(candidates)panes.edit.append(candidates);
  if(exportPanel)panes.edit.append(exportPanel);
  if(editor){
    const oldHead=editor.querySelector('.section-head');if(oldHead){oldHead.querySelector('.step')?.remove();oldHead.querySelector('.tag')?.remove();const h=oldHead.querySelector('h2');if(h)h.textContent='Editor';}
    editor.querySelector(':scope > p.muted')?.remove();
  }
  if(candidates){const h=candidates.querySelector('.section-head h3');if(h)h.textContent='Tus cuatro clips';candidates.querySelector(':scope > p.muted')?.remove();candidates.querySelector('.project-transfer')?.remove();}
  if(exportPanel){const h=exportPanel.querySelector('h3');if(h)h.textContent='Exportar';exportPanel.querySelector(':scope > p.hint')?.remove();const btn=exportPanel.querySelector('#browserExportClips');if(btn)btn.textContent='Exportar todos los clips';}
  main.replaceWith(shell);shell.append(side,content);if(oldHeader)oldHeader.remove();
  function activate(id){
    pages.forEach(p=>{panes[p.id].hidden=p.id!==id;const b=side.querySelector('[data-target="'+p.id+'"]');b.classList.toggle('active',p.id===id);});
    const p=pages.find(x=>x.id===id);by('#cfCurrentPage').textContent=p.label;by('#cfPageSubtitle').textContent=p.desc;shell.dataset.activePage=id;window.scrollTo({top:0,behavior:'smooth'});
  }
  shell.dataset.activePage='create';
  const footer=document.querySelector('footer');if(footer)content.append(footer);
  window.addEventListener('clipforge:clips-updated',()=>activate('edit'));
  window.addEventListener('clipforge:editor-ready',()=>{if(document.querySelector('#browserCandidateList')?.children.length)activate('edit');});
})();