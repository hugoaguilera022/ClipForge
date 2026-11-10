(() => {
  const main = document.querySelector('main');
  if (!main || document.getElementById('cfWorkspace')) return;
  const by = s => document.querySelector(s);
  const hero = by('.hero'), grid = by('.grid'), engine = by('#browserEngine');
  const editor = by('#projectEditor'), channels = by('.channel-panel');
  const inbox = by('.inbox-panel'), history = by('.history-panel');
  const workflow = by('.workflow'), publish = by('.publish');
  const pages = [
    {id:'create',label:'Crear clips',icon:'＋',desc:'Importa y analiza tu vídeo'},
    {id:'edit',label:'Editor',icon:'▤',desc:'Ajusta y exporta tus clips'},
    {id:'library',label:'Biblioteca',icon:'▣',desc:'Proyectos y trabajos'},
    {id:'channels',label:'Canales',icon:'◎',desc:'Fuentes y novedades'},
    {id:'settings',label:'Ajustes',icon:'⚙',desc:'Preferencias y conexiones'}
  ];
  const shell = document.createElement('div'); shell.id='cfWorkspace'; shell.className='cf-workspace';
  const side = document.createElement('aside'); side.className='cf-sidebar';
  side.innerHTML = '<div class="cf-side-brand"><span class="cf-logo">CF</span><div><b>ClipForge</b><small>CREATOR STUDIO</small></div></div><div class="cf-nav-label">WORKSPACE</div><nav class="cf-nav" aria-label="Navegación principal"></nav><div class="cf-side-bottom"><span class="cf-status-dot"></span><span>Motor local</span><small id="cfVersion">AI STUDIO</small></div>';
  const nav=side.querySelector('nav');
  const content=document.createElement('div');content.className='cf-content';
  const top=document.createElement('div');top.className='cf-topbar';
  top.innerHTML='<div><div class="cf-breadcrumb">CLIPFORGE <span>/</span> <b id="cfCurrentPage">Crear clips</b></div><div class="cf-page-subtitle" id="cfPageSubtitle">Convierte vídeos largos en clips que merecen ser vistos.</div></div><div class="cf-top-actions"><span id="health" class="pill">Comprobando motor…</span></div>';
  content.appendChild(top);
  const host=document.createElement('div');host.className='cf-page-host';content.appendChild(host);
  const panes={};
  pages.forEach((p,i)=>{
    const pane=document.createElement('section');pane.className='cf-page';pane.dataset.page=p.id;pane.hidden=i!==0;
    pane.setAttribute('aria-label',p.label);panes[p.id]=pane;host.appendChild(pane);
    const b=document.createElement('button');b.type='button';b.className='cf-nav-item'+(i===0?' active':'');b.dataset.target=p.id;
    b.innerHTML='<span class="cf-nav-icon">'+p.icon+'</span><span>'+p.label+'</span>'+(i===0?'<span class="cf-nav-active"></span>':'');
    b.addEventListener('click',()=>activate(p.id));nav.appendChild(b);
  });
  function move(node,target){if(node)panes[target].appendChild(node)}
  move(hero,'create');move(grid,'create');move(engine,'create');move(workflow,'create');
  move(editor,'edit');move(history,'library');move(inbox,'library');move(channels,'channels');move(publish,'settings');
  main.replaceWith(shell);shell.append(side,content);
  function activate(id){
    pages.forEach(p=>{panes[p.id].hidden=p.id!==id;const b=nav.querySelector('[data-target="'+p.id+'"]');b.classList.toggle('active',p.id===id);b.innerHTML='<span class="cf-nav-icon">'+p.icon+'</span><span>'+p.label+'</span>'+(p.id===id?'<span class="cf-nav-active"></span>':'');});
    const p=pages.find(x=>x.id===id);document.getElementById('cfCurrentPage').textContent=p.label;document.getElementById('cfPageSubtitle').textContent=p.desc;
    shell.dataset.activePage=id;window.scrollTo({top:0,behavior:'smooth'});
  }
  shell.dataset.activePage='create';
  const footer=document.querySelector('footer');if(footer)content.appendChild(footer);
  const mobile=document.createElement('button');mobile.type='button';mobile.className='cf-mobile-menu';mobile.textContent='☰';mobile.setAttribute('aria-label','Mostrar navegación');
  top.querySelector('.cf-top-actions').prepend(mobile);
  mobile.addEventListener('click',()=>side.classList.toggle('mobile-open'));
  nav.addEventListener('click',()=>side.classList.remove('mobile-open'));
  window.addEventListener('keydown',e=>{if(e.altKey&&e.key>='1'&&e.key<='5'){activate(pages[Number(e.key)-1].id)}});
})();
