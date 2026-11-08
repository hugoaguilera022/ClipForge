const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function loadHealth(){
 try{
  const r=await fetch('/api/health');const d=await r.json();
  $('#health').textContent=d.ffmpeg&&d.ffprobe?(d.faster_whisper?'Faster-Whisper local disponible':(d.whisper_cpp?'whisper.cpp local disponible':(d.native_speech?'Apple Speech disponible como alternativa local':(d.whisper?'Whisper clásico disponible':'Se instalará whisper.cpp como alternativa local'))))+(d.yt_dlp?' · URL YouTube activa':' · falta yt-dlp para URLs'):'Falta FFmpeg/FFprobe';
  $('#health').classList.toggle('ok',d.ffmpeg&&d.ffprobe);
 }catch{
  $('#health').textContent='Modo navegador · gratuito';
  document.body.dataset.browserOnly='true';
  const upload=document.querySelector('.upload');
  if(upload){
   upload.querySelector('h2').textContent='Vídeo de origen';
   upload.querySelector('.tag').textContent='Procesamiento en tu navegador';
   const note=document.createElement('p');note.className='browser-only-note';note.textContent='Selecciona aquí el vídeo que quieres analizar. Después, baja al Motor 01 para transcribirlo, elegir cuatro momentos y exportarlos en vertical. No se necesita instalar nada ni subir el vídeo a un servidor.';
   upload.querySelector('.section-head').after(note);
   // This Render deployment is intentionally browser-only. Do not leave a
   // YouTube-page URL form visible when no server-side yt-dlp resolver exists.
   const youtubeField=upload.querySelector('.url-source');
   if(youtubeField)youtubeField.hidden=true;
   const serverSubmit=upload.querySelector('#submit');
   if(serverSubmit)serverSubmit.hidden=true;
   const directUrl=document.querySelector('.browser-url-import');
   if(directUrl)directUrl.hidden=false;
  }
  window.clipforgeModeReady=true;
  window.dispatchEvent(new Event('clipforge:mode-ready'));
 }
}
async function loadPlatforms(){
 try{
  const r=await fetch('/api/platforms');const {platforms}=await r.json();
  $('#platforms').innerHTML=platforms.map(p=>`<div class="platform"><span class="ico">${({youtube:'▶',instagram:'◎',facebook:'f',tiktok:'♪',x:'X'})[p.id]}</span><div><b>${esc(p.name)}</b><small>${esc(p.free)}</small></div><span class="state">Pendiente</span></div>`).join('');
 }catch{$('#platforms').textContent='No se pudo cargar el estado de las plataformas.'}
}
$('#video').addEventListener('change',e=>$('#filename').textContent=e.target.files[0]?.name||'MP4, MOV, MKV o WEBM · máximo 512 MB');
$('#transcript').addEventListener('change',e=>$('#transcriptname').textContent=e.target.files[0]?.name||'SRT o VTT · permite trabajar sin instalar Whisper');
$('#jobForm').addEventListener('submit',async e=>{
 e.preventDefault();if(document.body.dataset.browserOnly==='true'){const out=$('#jobResult');out.classList.remove('hidden');out.textContent='Estás usando ClipForge en modo navegador independiente. No se necesita el servidor Python: utiliza “Transcribir archivo seleccionado” y después “Exportar clips MP4 en este navegador”.';document.querySelector('#browserEngine')?.scrollIntoView({behavior:'smooth',block:'start'});return;}const form=e.currentTarget;const file=$('#video').files[0];const url=$('#video_url').value.trim();if(!file&&!url){alert('Pega una URL de YouTube o selecciona un vídeo.');return;}
 if(file&&file.size>512*1024*1024){alert('El vídeo supera el límite de 512 MB.');return;}const button=$('#submit'),out=$('#jobResult');button.disabled=true;button.textContent=url?'Analizando URL…':'Subiendo vídeo…';out.classList.remove('hidden');out.textContent='Preparando trabajo…';
 const data=new FormData(form);
 try{
  const r=await fetch('/api/jobs',{method:'POST',body:data});const d=await r.json();if(!r.ok)throw Error(d.error||'No se pudo crear el trabajo');
  window.currentJobId=d.id;out.textContent=`Trabajo ${d.id}: ${d.status}. Consultando progreso…`;loadJobHistory();
  const poll=async()=>{
   try{
    const status=await fetch(d.status_url);if(!status.ok)throw Error('No se pudo consultar el trabajo');
    const job=await status.json();
    if(job.status==='queued'||job.status==='processing'){
     out.textContent=`Estado: ${job.status}\n${job.log||'Procesando vídeo, transcripción y render…'}`;
     setTimeout(poll,2500);return;
    }
    if(job.status==='failed'){
     out.textContent='No se pudo generar el lote.\n'+(job.log||'Comprueba el permiso de Reconocimiento de voz y la disponibilidad del idioma; como alternativa instala Whisper localmente o aporta un SRT/VTT.');
     for(const clip of (job.clips||[])){
      const srtName=clip.file.replace(/\\.mp4$/i,'.srt');
      fetch(`/api/preview/${d.id}/${encodeURIComponent(srtName)}`).then(x=>x.ok?x.text():Promise.reject()).then(t=>{const editor=document.querySelector(`.caption-editor[data-clip="${clip.file}"]`);if(editor)editor.value=t;}).catch(()=>{const editor=document.querySelector(`.caption-editor[data-clip="${clip.file}"]`);if(editor)editor.value='No se pudieron cargar los subtítulos.';});
     }
     button.disabled=false;button.innerHTML='Analizar y generar clips <span>→</span>';loadJobHistory();return;
    }
    if(job.status==='completed'){
     out.innerHTML=`<b>Producción terminada.</b>${job.story_profile?`<p class="source-stats"><b>Panorama narrativo:</b> temas ${esc((job.story_profile.themes||[]).join(', ')||'sin temas destacados')} · señales globales ${(job.story_profile.arc_signals||[]).join(', ')||'sin secuencia clara'} · ${(job.story_profile.question_answer_links||[]).length} posibles conexiones pregunta-respuesta<br><small>Perfil léxico de la transcripción completa; no es comprensión semántica.</small></p>`:''}${job.youtube_metadata?`<p class="source-stats">Vídeo: ${esc(job.youtube_metadata.title||'')} · Canal: ${esc(job.youtube_metadata.channel||job.youtube_metadata.uploader||'')} · ${job.youtube_metadata.view_count!=null?Number(job.youtube_metadata.view_count).toLocaleString('es-ES')+' visualizaciones':''}${job.youtube_metadata.public_audience_signals?.like_to_view_ratio!=null?' · '+(job.youtube_metadata.public_audience_signals.like_to_view_ratio*100).toFixed(2)+'% likes/vistas':''}${job.youtube_metadata.public_audience_signals?.views_per_day_estimate!=null?' · '+Math.round(job.youtube_metadata.public_audience_signals.views_per_day_estimate).toLocaleString('es-ES')+' vistas/día aprox.':''}<br><small>Datos del vídeo completo; no son métricas de retención de estos clips.</small></p>`:''}<p><a class="download" href="${job.download_url}">Descargar todos los clips (.zip)</a> <a class="download" href="/api/review/${d.id}" target="_blank" rel="noopener">Abrir revisión y puntuaciones</a></p><div class="clip-grid">${(job.clips||[]).map(c=>`<article class="clip-card"><video controls preload="metadata" src="${c.preview_url}"></video><small>${esc(c.file)} · índice editorial ${Number(c.editorial_potential_score??0).toFixed(1)}/100 · ${esc(c.story_phase||"")}</small><p><a class="download" href="/api/preview/${d.id}/${esc(c.file.replace(/\\.mp4$/i,'.srt'))}" download>Descargar SRT</a></p><label>Editar subtítulos (SRT)<textarea class="caption-editor" data-clip="${esc(c.file)}" rows="7" spellcheck="false">Cargando subtítulos…</textarea></label><button type="button" class="secondary rerender" data-clip="${esc(c.file)}">Guardar cambios y volver a renderizar</button><small class="edit-status" data-status="${esc(c.file)}">Los tiempos deben estar dentro de la duración del clip.</small></article>`).join('')}</div>`;
     button.disabled=false;button.innerHTML='Analizar y generar clips <span>→</span>';loadJobHistory();
    }
   }catch(err){out.textContent='Error consultando el trabajo: '+err.message;button.disabled=false;button.innerHTML='Analizar y generar clips <span>→</span>'}
  };
  poll();
 }catch(err){out.textContent='Error: '+err.message;button.disabled=false;button.innerHTML='Analizar y generar clips <span>→</span>'}
});

$('#jobResult').addEventListener('click',async e=>{
 const button=e.target.closest('.rerender');if(!button)return;
 const clip=button.dataset.clip;const editor=document.querySelector(`.caption-editor[data-clip="${clip}"]`);
 const status=document.querySelector(`.edit-status[data-status="${clip}"]`);
 if(!editor||!editor.value.trim())return;
 button.disabled=true;status.textContent='Renderizando de nuevo…';
 try{
  const data=new FormData();data.append('transcript',new Blob([editor.value],{type:'application/x-subrip'}),clip.replace(/\\.mp4$/i,'.srt'));
  const response=await fetch(`/api/re-render/${encodeURIComponent(window.currentJobId||'')}/${encodeURIComponent(clip)}`,{method:'POST',body:data});
  const result=await response.json();if(!response.ok)throw Error(result.message||result.error||'No se pudo renderizar');
  const video=button.closest('.clip-card').querySelector('video');if(video){video.src=video.src.split('?')[0]+'?v='+Date.now();video.load();}
  status.textContent='Cambios guardados. MP4 actualizado y auditado.';
 }catch(err){status.textContent='Error: '+err.message;}
 finally{button.disabled=false;}
});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));

async function loadJobHistory(){
 const box=$('#jobHistory'); if(!box)return;
 try{
  const r=await fetch('/api/jobs');const d=await r.json();if(!r.ok)throw Error(d.error||'No se pudo cargar el historial');
  box.innerHTML=(d.jobs||[]).map(j=>`<article class="history-item"><div><b>${esc(j.source||'Vídeo')}</b><small>${esc(j.id)} · ${new Date(Number(j.created||0)*1000).toLocaleString('es-ES')}</small><small class="history-log">${esc(j.log||j.status)}</small></div><div><span class="state ${j.status==='completed'?'done':j.status==='failed'?'error':''}">${esc(j.status)}</span>${j.download_url?`<a class="download" href="${esc(j.download_url)}">Descargar ZIP</a>`:''}${j.status==='failed'?`<button type="button" class="secondary retry-job" data-id="${esc(j.id)}">Reintentar</button>`:''}</div></article>`).join('')||'<small class="muted">Todavía no hay trabajos guardados.</small>';
 }catch(e){box.textContent='No se pudo cargar el historial: '+e.message;}
}
$('#refreshJobs')?.addEventListener('click',loadJobHistory);

loadHealth().then(()=>{
 if(document.body.dataset.browserOnly!=='true'){
  loadPlatforms();loadJobHistory();loadChannels();loadInbox();
  setInterval(loadInbox,20000);
 }
});

async function loadChannels(){
 const list=$('#channelList'); if(!list)return;
 try{
  const r=await fetch('/api/channels');const d=await r.json();
  list.innerHTML=(d.channels||[]).map(ch=>`<article class="channel-card"><div><b>${esc(ch.label||ch.channel_id)}</b><small>${esc(ch.channel_id)} · ${ch.last_checked?'Revisado '+new Date(ch.last_checked*1000).toLocaleString('es-ES'):'Aún sin revisar'}</small>${ch.last_error?`<small class="error">${esc(ch.last_error)}</small>`:''}<div class="channel-videos">${(ch.videos||[]).map(v=>`<p>${v.is_new?'<b class="new-video">NUEVO · </b>':''}<a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.title||v.video_id)}</a> <small>${esc(v.published||'')}</small>${v.is_new?` <button type="button" class="seen-video secondary" data-channel="${esc(ch.channel_id)}" data-video="${esc(v.video_id)}">Marcar revisado</button>`:''}</p>`).join('')||'<small>Sin publicaciones detectadas todavía.</small>'}</div></div><button type="button" class="remove-channel secondary" data-id="${esc(ch.channel_id)}">Eliminar</button></article>`).join('')||'<p class="muted">Todavía no has añadido canales.</p>';
  $('#channelStatus').textContent=`${d.channels.length} canales · comprobación cada 24 h (con ClipForge abierto)`;
 }catch(e){$('#channelStatus').textContent='No se pudieron cargar los canales: '+e.message;}
}
$('#channelForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const status=$('#channelStatus');status.textContent='Añadiendo canal…';
 try{const r=await fetch('/api/channels',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:$('#channelUrl').value.trim(),label:$('#channelLabel').value.trim()})});const d=await r.json();if(!r.ok)throw Error(d.message||d.error);$('#channelUrl').value='';$('#channelLabel').value='';await loadChannels();status.textContent='Canal añadido. Pulsa “Comprobar ahora” para obtener sus publicaciones.';}
 catch(err){status.textContent='No se pudo añadir: '+err.message;}
});
$('#refreshChannels')?.addEventListener('click',async()=>{
 const button=$('#refreshChannels'),status=$('#channelStatus');button.disabled=true;status.textContent='Consultando feeds públicos de YouTube…';
 try{const r=await fetch('/api/channels/refresh',{method:'POST'});const d=await r.json();if(!r.ok)throw Error(d.message||d.error);await loadChannels();status.textContent=`Revisión terminada: ${d.channels} canales, ${d.new_videos} publicaciones nuevas.${d.errors?.length?' Algunos canales dieron error.':''}`;}
 catch(err){status.textContent='Error al revisar: '+err.message;}
 finally{button.disabled=false;}
});
$('#channelList')?.addEventListener('click',async e=>{
 const seen=e.target.closest('.seen-video');
 if(seen){seen.disabled=true;try{const r=await fetch(`/api/channels/${encodeURIComponent(seen.dataset.channel)}/${encodeURIComponent(seen.dataset.video)}/seen`,{method:'POST'});const d=await r.json();if(!r.ok||!d.ok)throw Error('No se pudo marcar como revisado');await loadChannels();}catch(err){$('#channelStatus').textContent=err.message;seen.disabled=false;}return;}
 const button=e.target.closest('.remove-channel');if(!button)return;button.disabled=true;
 try{const r=await fetch('/api/channels/'+encodeURIComponent(button.dataset.id),{method:'DELETE'});if(!r.ok)throw Error('No se pudo eliminar');await loadChannels();}catch(err){$('#channelStatus').textContent=err.message;button.disabled=false;}
});

$('#jobHistory')?.addEventListener('click',async e=>{
 const button=e.target.closest('.retry-job');if(!button)return;
 button.disabled=true;button.textContent='Reintentando…';
 try{const r=await fetch(`/api/jobs/${encodeURIComponent(button.dataset.id)}/retry`,{method:'POST'});const d=await r.json();if(!r.ok)throw Error(d.message||d.error||'No se pudo reintentar');await loadJobHistory();}
 catch(err){button.disabled=false;button.textContent='Reintentar';button.title=err.message;}
});


async function loadInbox(){
 const box=$('#inboxList');if(!box)return;
 try{
  const r=await fetch('/api/inbox');const d=await r.json();if(!r.ok)throw Error(d.error||'No se pudo consultar la carpeta');
  box.innerHTML=`<small class="muted">Carpeta local: <code>${esc(d.folder)}</code></small>`+((d.items||[]).map(x=>`<article class="history-item"><div><b>${esc(x.filename)}</b><small>${(x.size_bytes/1024/1024).toFixed(1)} MB · ${esc(x.status)}</small></div><span class="state">${x.manifest_present?'Permiso adjunto':'Falta manifiesto'}</span></article>`).join('')||'<small class="muted">No hay vídeos pendientes de entrada.</small>');
 }catch(e){box.textContent='No se pudo consultar la entrada: '+e.message;}
}
$('#scanInbox')?.addEventListener('click',async()=>{
 const b=$('#scanInbox'),s=$('#inboxStatus');b.disabled=true;s.textContent='Comprobando archivos…';
 try{const r=await fetch('/api/inbox/scan',{method:'POST'});const d=await r.json();if(!r.ok)throw Error(d.error||'Error de entrada');s.textContent=`Importados: ${d.imported?.length||0} · esperando: ${d.waiting||0} · errores: ${d.errors?.length||0}`;await loadInbox();await loadJobHistory();}
 catch(e){s.textContent=e.message;}finally{b.disabled=false;}
});
