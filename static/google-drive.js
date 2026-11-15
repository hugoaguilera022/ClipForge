(() => {
'use strict';
const CLIENT_ID='722967122444-4d8mc4dmiq5rm77n74j2j5aicnfehas5.apps.googleusercontent.com';
const SCOPE='https://www.googleapis.com/auth/drive.appdata';
let token='',expires=0,client=null,activeId=localStorage.getItem('clipforge.drive.lastProjectId')||'';const remembered=()=>localStorage.getItem('clipforge.drive.accountRemembered')==='1';
const $=s=>document.querySelector(s),status=()=>$('#cfDriveStatus'),say=m=>{if(status())status().textContent=m;};
const bridge=()=>window.clipforgeEditorBridge;
function auth(){return new Promise((resolve,reject)=>{if(token&&Date.now()<expires-60000)return resolve(token);if(!window.google?.accounts?.oauth2)return reject(Error('Google Identity Services no ha cargado. Recarga e inténtalo de nuevo.'));if(!client)client=google.accounts.oauth2.initTokenClient({client_id:CLIENT_ID,scope:SCOPE,include_granted_scopes:true,callback:r=>{if(r.error)return reject(Error(r.error_description||r.error));token=r.access_token||'';expires=Date.now()+Math.max(60,Number(r.expires_in)||3600)*1000;resolve(token);},error_callback:e=>reject(Error(e?.message||'No se pudo abrir Google.'))});client.requestAccessToken({prompt:remembered()?'':'select_account'});});}
async function api(url,opts={}){const t=await auth(),r=await fetch(url,{...opts,headers:{...(opts.headers||{}),Authorization:'Bearer '+t}});if(!r.ok){let m='Google Drive HTTP '+r.status;try{m=(await r.json()).error?.message||m;}catch{}throw Error(m);}return r;}
function snapshot(){const p=bridge()?.getProject?.();if(!p||!Array.isArray(p.clips)||!p.clips.length)throw Error('Primero genera los clips para guardar el proyecto.');return {schema:'clipforge-cloud-project-v1',app:'ClipForge',projectName:p.projectName||'Mi proyecto',savedAt:new Date().toISOString(),project:p};}
function mount(){if($('#cfDriveControls'))return;const navRight=$('.cf-opus-nav-right');if(!navRight)return;const details=document.createElement('details');details.id='cfDriveControls';details.className='cf-drive-menu';details.innerHTML='<summary>☁️ Proyectos</summary><div class="cf-drive-popover"><div class="cf-drive-actions"><button type="button" id="cfDriveConnect">Conectar Drive</button><button type="button" id="cfDriveSave">Guardar proyecto</button></div><div class="cf-drive-actions"><select id="cfDriveList" aria-label="Proyectos guardados en Google Drive"><option value="">Conecta Drive para ver tus proyectos</option></select><button type="button" id="cfDriveOpen">Abrir</button></div><button type="button" id="cfDriveOpenLast">Abrir último proyecto</button><span id="cfDriveStatus" role="status">Drive aún no está conectado. La sesión de ClipForge y el permiso de Drive son independientes.</span></div>';navRight.prepend(details);
$('#cfDriveConnect').addEventListener('click',connect);if(remembered())$('#cfDriveConnect').textContent='Usar cuenta guardada';$('#cfDriveSave').addEventListener('click',save);$('#cfDriveOpen').addEventListener('click',load);$('#cfDriveOpenLast').addEventListener('click',()=>{
 const sel=$('#cfDriveList'),last=localStorage.getItem('clipforge.drive.lastProjectId')||activeId;
 if(last&&[...sel.options].some(o=>o.value===last))sel.value=last;
 else if(!sel.value&&sel.options.length>1)sel.selectedIndex=1;
 if(!sel.value)return say('No hay proyectos disponibles. Conecta Drive y actualiza la lista.');
 load();
})
details.addEventListener('toggle',()=>{if(details.open){if(token&&Date.now()<expires-60000)list().catch(e=>say('No se pudo actualizar la lista: '+e.message));else if(!token)say('Conecta Google Drive para mostrar tus proyectos guardados.');}});
const st=document.createElement('style');st.textContent='.cf-drive-menu{position:relative;margin-left:12px;z-index:50}.cf-drive-menu>summary{list-style:none;cursor:pointer;border:1px solid var(--line,#303744);border-radius:999px;padding:9px 13px;color:var(--text,#fff);font-size:12px;font-weight:700;white-space:nowrap}.cf-drive-menu>summary::-webkit-details-marker{display:none}.cf-drive-menu:not([open])>.cf-drive-popover{display:none!important}.cf-drive-menu[open]>.cf-drive-popover{display:grid!important}.cf-drive-popover{position:absolute;right:0;top:calc(100% + 10px);width:min(340px,calc(100vw - 32px));padding:14px;background:#111923;border:1px solid #303b4b;border-radius:14px;box-shadow:0 18px 50px #0009;display:grid;gap:10px}.cf-drive-actions{display:flex;gap:8px;align-items:center}.cf-drive-actions button{border:1px solid #3a4658;border-radius:9px;background:#202b3a;color:#f7f9fc;padding:9px 11px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}.cf-drive-actions select{min-width:0;flex:1;background:#0c121b;color:#f7f9fc;border:1px solid #3a4658;border-radius:9px;padding:9px;font-size:12px}.cf-drive-popover #cfDriveStatus{font-size:11px;line-height:1.4;color:#aab6c8}.cf-drive-popover #cfDriveOpenLast{width:100%;border:1px solid #6d3ab0;border-radius:9px;background:#27183a;color:#f7f1ff;padding:10px;font-size:12px;font-weight:750;cursor:pointer}.cf-editor-cloud-save{margin-right:8px}@media(max-width:760px){.cf-drive-menu{margin-left:4px}.cf-drive-menu>summary{padding:8px 10px}.cf-drive-popover{right:-8px}}';
document.head.append(st);}
async function list(){
 const q="'appDataFolder' in parents and trashed=false and name contains 'clipforge-project-'";
 const d=await (await api('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&pageSize=100&orderBy=modifiedTime%20desc&fields=files(id,name,modifiedTime)&q='+encodeURIComponent(q))).json();
 const sel=$('#cfDriveList');sel.replaceChildren(new Option('Proyectos en la nube',''));
 const files=Array.isArray(d.files)?d.files:[];
 files.forEach(f=>sel.add(new Option((f.name||'Proyecto sin nombre').replace(/^clipforge-project-/,'').replace(/\.json$/,'')+' · '+new Date(f.modifiedTime).toLocaleString('es-ES'),f.id)));
 const last=localStorage.getItem('clipforge.drive.lastProjectId')||activeId;
 const match=files.find(f=>f.id===last);
 if(match){activeId=match.id;sel.value=match.id;}
 else{
  activeId=files[0]?.id||'';
  if(activeId){sel.value=activeId;localStorage.setItem('clipforge.drive.lastProjectId',activeId);}
  else{localStorage.removeItem('clipforge.drive.lastProjectId');}
 }
 const count=files.length;
 say(count?'Google Drive conectado · '+count+' proyectos. Proyecto más reciente seleccionado.':'Drive conectado · todavía no hay proyectos guardados.');
}
async function connect(){try{say('Esperando autorización de Google…');await auth();localStorage.setItem('clipforge.drive.accountRemembered','1');await list();$('#cfDriveConnect').textContent='Cuenta Google recordada';}catch(e){say('No se pudo conectar: '+e.message);}}
async function save(){const b=$('#cfDriveSave');b.disabled=true;try{const project=snapshot(),clean=String(project.projectName||'Mi proyecto').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48)||'proyecto',name='clipforge-project-'+clean+'.json',boundary='clipforge_'+Date.now(),metadata={name,mimeType:'application/json',...(activeId?{}:{parents:['appDataFolder']})},body='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(metadata)+'\r\n--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(project)+'\r\n--'+boundary+'--',url=activeId?'https://www.googleapis.com/upload/drive/v3/files/'+encodeURIComponent(activeId)+'?uploadType=multipart&fields=id,name,modifiedTime':'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime',saved=await (await api(url,{method:activeId?'PATCH':'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body})).json();activeId=saved.id;localStorage.setItem('clipforge.drive.lastProjectId',saved.id);await list();$('#cfDriveList').value=saved.id;say('Proyecto «'+project.projectName+'» guardado en Google Drive.');window.dispatchEvent(new CustomEvent('clipforge:cloud-saved',{detail:{name:project.projectName}}));}catch(e){say('No se ha guardado: '+e.message);}finally{b.disabled=false;}}
async function load(){
 const sel=$('#cfDriveList'),id=sel?.value;
 if(!id)return say('Selecciona un proyecto de la lista de Google Drive.');
 const openButton=$('#cfDriveOpen');if(openButton)openButton.disabled=true;
 const lastButton=$('#cfDriveOpenLast');if(lastButton)lastButton.disabled=true;
 say('Comprobando el proyecto guardado…');
 try{
  const meta=await (await api('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?fields=id,name,mimeType,trashed')).json();
  if(meta.trashed)throw Error('Este proyecto está en la papelera de Google Drive.');
  say('Descargando «'+(meta.name||'proyecto')+'»…');
  const response=await api('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?alt=media');
  const raw=await response.text();let p;
  try{p=JSON.parse(raw);}catch{throw Error('El archivo de Drive no contiene un proyecto JSON válido.');}
  if(p?.schema!=='clipforge-cloud-project-v1'||!p.project)throw Error('El archivo existe, pero no tiene el formato de proyecto ClipForge.');
  const project=p.project,clips=Array.isArray(project.clips)?project.clips:[],tracks=Array.isArray(project.tracks)?project.tracks:[];
  if(!clips.length)throw Error('El proyecto se ha descargado, pero no contiene clips guardados.');
  const b=bridge();
  if(!b?.setClips||!b?.setTracks)throw Error('El editor todavía está cargando. Recarga la página e inténtalo de nuevo.');
  const name=String(p.projectName||project.projectName||meta.name||'Mi proyecto').replace(/^clipforge-project-/,'').replace(/\.json$/,'');
  b.setProjectName?.(name);
  b.setClips(clips);
  if(project.transcript)b.setTranscript(project.transcript);
  b.setTracks(tracks);
  activeId=id;localStorage.setItem('clipforge.drive.lastProjectId',id);
  window.dispatchEvent(new CustomEvent('clipforge:clips-updated'));
  say('Proyecto descargado · preparando el editor multipista…');
  const visible=new Promise((resolve,reject)=>{
   const done=()=>{cleanup();resolve(true);};
   const fail=e=>{cleanup();reject(Error(e.detail?.message||'No se pudo iniciar el editor multipista.'));};
   const timer=setTimeout(()=>{cleanup();reject(Error('El proyecto se descargó, pero el editor no confirmó que se hubiera abierto.'));},9000);
   const cleanup=()=>{clearTimeout(timer);window.removeEventListener('clipforge:editor-visible',done);window.removeEventListener('clipforge:editor-error',fail);};
   window.addEventListener('clipforge:editor-visible',done,{once:true});
   window.addEventListener('clipforge:editor-error',fail,{once:true});
  });
  window.dispatchEvent(new CustomEvent('clipforge:open-editor',{detail:{clip:clips[0],index:0,source:'google-drive',allClips:true,projectName:name}}));
  await visible;
  say('Proyecto «'+name+'» abierto · '+clips.length+' clips cargados.');
  window.dispatchEvent(new CustomEvent('clipforge:cloud-loaded-complete',{detail:{name,clips:clips.length}}));
 }catch(e){say('No se pudo abrir el proyecto: '+(e?.message||String(e)));}
 finally{if(openButton)openButton.disabled=false;if(lastButton)lastButton.disabled=false;}
}
function editorButton(){document.querySelectorAll('.cf-editor-topbar').forEach(bar=>{if(bar.querySelector('.cf-editor-cloud-save'))return;const b=document.createElement('button');b.type='button';b.className='secondary cf-editor-cloud-save';b.textContent='Guardar en Drive';b.addEventListener('click',()=>$('#cfDriveSave')?.click());const exp=bar.querySelector('.cf-editor-export-top');bar.insertBefore(b,exp||null);});}
window.addEventListener('clipforge:new-project',()=>{activeId='';});
function init(){mount();editorButton();const dl=$('#downloadBrowserTranscript');if(dl){dl.hidden=true;dl.disabled=true;}const legacy=$('#saveBrowserProject');if(legacy){legacy.hidden=true;legacy.disabled=true;}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
new MutationObserver(init).observe(document.body,{childList:true,subtree:true});
})();