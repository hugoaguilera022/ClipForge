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


// YouTube pages are not directly readable by browser fetch because of CORS.
// A tiny, temporary importer downloads only an explicitly authorized video;
// transcription, selection, editing and MP4 export remain local in this browser.
const YOUTUBE_INGEST_API = 'https://clipforge-youtube-ingest.onrender.com';
const youtubeInput = document.querySelector('#browserYoutubeUrl');
const youtubeButton = document.querySelector('#loadBrowserYoutube');
const youtubeRights = document.querySelector('#browserYoutubeRights');
const youtubeStatus = document.querySelector('#browserYoutubeStatus');
youtubeButton?.addEventListener('click', async () => {
  const url = youtubeInput?.value.trim();
  if (!url) { if (youtubeStatus) youtubeStatus.textContent = 'Pega primero un enlace de YouTube.'; return; }
  if (!youtubeRights?.checked) { if (youtubeStatus) youtubeStatus.textContent = 'Confirma que tienes autorización para descargar y editar este vídeo.'; return; }
  youtubeButton.disabled = true;
  if (youtubeStatus) youtubeStatus.textContent = 'Conectando con el importador gratuito de YouTube…';
  try {
    const response = await fetch(`${YOUTUBE_INGEST_API}/api/youtube/download`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({url, rights_confirmed: true})
    });
    if (!response.ok) {
      let message = `El importador respondió HTTP ${response.status}.`;
      try { message = (await response.json()).error || message; } catch {}
      throw new Error(message);
    }
    const expected = Number(response.headers.get('content-length') || 0);
    if (expected > 512 * 1024 * 1024) throw new Error('El vídeo supera el límite de 512 MB.');
    const chunks = [];
    let received = 0;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > 512 * 1024 * 1024) { await reader.cancel(); throw new Error('El vídeo supera el límite de 512 MB.'); }
        chunks.push(value);
        if (youtubeStatus) youtubeStatus.textContent = `Descargando vídeo autorizado: ${(received / 1048576).toFixed(1)} MB${expected ? ` / ${(expected / 1048576).toFixed(1)} MB` : ''}…`;
      }
    } else {
      const blob = await response.blob();
      received = blob.size;
      chunks.push(blob);
    }
    if (!received) throw new Error('YouTube devolvió un archivo vacío.');
    const disposition = response.headers.get('content-disposition') || '';
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const filename = encodedName ? decodeURIComponent(encodedName) : 'clipforge-youtube.mp4';
    const file = new File([new Blob(chunks, {type: 'video/mp4'})], filename, {type: 'video/mp4'});
    const input = document.querySelector('#video');
    if (!input) throw new Error('No se encontró el selector de vídeo.');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles: true}));
    const label = document.querySelector('#filename');
    if (label) label.textContent = `${filename} · ${(file.size / 1048576).toFixed(1)} MB · importado desde YouTube`;
    if (youtubeStatus) youtubeStatus.textContent = 'Vídeo importado. La transcripción, selección de cuatro momentos y exportación se ejecutarán localmente en tu navegador.';
    document.querySelector('#browserEngine')?.scrollIntoView({behavior:'smooth',block:'start'});
  } catch (error) {
    console.error(error);
    if (youtubeStatus) youtubeStatus.textContent = `No se pudo importar el vídeo: ${error.message}`;
  } finally {
    youtubeButton.disabled = false;
  }
});
