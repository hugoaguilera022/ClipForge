const urlInput=document.querySelector('#browserVideoUrl');
const loadButton=document.querySelector('#loadBrowserVideoUrl');
const urlStatus=document.querySelector('#browserWhisperStatus');
loadButton?.addEventListener('click',async()=>{
  const raw=urlInput?.value.trim();
  if(!raw){if(urlStatus)urlStatus.textContent='Introduce una URL directa al archivo de vídeo.';return;}
  let url;
  try{url=new URL(raw);if(!['https:','http:'].includes(url.protocol))throw new Error('Solo se admiten enlaces HTTP o HTTPS.');}
  catch(e){if(urlStatus)urlStatus.textContent='URL no válida: '+e.message;return;}
  const extension=(url.pathname.match(/\.([a-z0-9]{2,5})$/i)||[])[1]?.toLowerCase();
  if(!['mp4','mov','m4v','webm','mkv'].includes(extension)){if(urlStatus)urlStatus.textContent='El enlace debe apuntar directamente a un MP4, MOV, M4V, WEBM o MKV.';return;}
  loadButton.disabled=true;
  if(urlStatus)urlStatus.textContent='Descargando el vídeo desde el enlace compatible…';
  try{
    const response=await fetch(url.href,{mode:'cors',credentials:'omit'});
    if(!response.ok)throw new Error(`El servidor respondió HTTP ${response.status}.`);
    const length=Number(response.headers.get('content-length')||0);
    if(length>512*1024*1024)throw new Error('El archivo supera el límite de 512 MB.');
    const blob=await response.blob();
    if(!blob.size)throw new Error('El enlace devolvió un archivo vacío.');
    if(blob.size>512*1024*1024)throw new Error('El archivo supera el límite de 512 MB.');
    const type=blob.type.startsWith('video/')?blob.type:({mp4:'video/mp4',mov:'video/quicktime',m4v:'video/mp4',webm:'video/webm',mkv:'video/x-matroska'})[extension];
    const filename=decodeURIComponent(url.pathname.split('/').pop()||`clipforge-video.${extension}`).replace(/[^a-zA-Z0-9._-]/g,'_');
    const file=new File([blob],filename,{type});
    const input=document.querySelector('#video');
    const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    const label=document.querySelector('#filename');if(label)label.textContent=`${filename} · ${(file.size/1024/1024).toFixed(1)} MB · cargado desde URL`;
    if(urlStatus)urlStatus.textContent=`Vídeo cargado desde URL: ${filename}. Ya puedes transcribirlo sin subirlo a un servidor de ClipForge.`;
    document.querySelector('#browserEngine')?.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){
    console.error(error);
    if(urlStatus)urlStatus.textContent=`No se pudo cargar la URL: ${error.message} Comprueba que sea un enlace directo y que el servidor permita CORS.`;
  }finally{loadButton.disabled=false;}
});
