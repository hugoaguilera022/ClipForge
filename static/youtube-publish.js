(() => {
  const $ = (selector) => document.querySelector(selector);
  const status = $('#youtubeConnectionStatus');
  const connect = $('#connectYouTube');
  const form = $('#youtubeUploadForm');
  const result = $('#youtubePublishResult');
  if (!status || !connect || !form) return;

  let popup = null;
  let poller = null;
  let connected = false;

  async function refreshProfile() {
    try {
      const response = await fetch('/api/youtube/profile', {cache:'no-store'});
      const data = await response.json();
      connected = response.ok && data.connected === true;
      status.textContent = connected
        ? 'YouTube conectado: ' + (data.title || data.handle || 'canal autorizado')
        : 'YouTube todavía no está conectado.';
      connect.textContent = connected ? 'Actualizar conexión de YouTube' : 'Conectar YouTube';
      connect.dataset.connected = connected ? 'true' : 'false';
      form.hidden = !connected;
      return connected;
    } catch (_) {
      connected = false;
      status.textContent = 'No se pudo consultar la conexión de YouTube.';
      form.hidden = true;
      return false;
    }
  }

  function stopPolling() {
    if (poller) clearInterval(poller);
    poller = null;
  }

  connect.addEventListener('click', async () => {
    if (connected) {
      await refreshProfile();
      return;
    }
    popup = window.open('/api/youtube/auth', 'clipforge-youtube-oauth', 'popup,width=620,height=760');
    if (!popup) {
      status.textContent = 'El navegador ha bloqueado la ventana. Permite las ventanas emergentes para ClipForge.';
      return;
    }
    status.textContent = 'Completa la autorización de Google en la ventana emergente…';
    stopPolling();
    let attempts = 0;
    poller = setInterval(async () => {
      attempts += 1;
      if (await refreshProfile()) {
        stopPolling();
        status.textContent = 'YouTube conectado correctamente.';
        try { popup.close(); } catch (_) {}
      } else if (attempts >= 45 || (popup && popup.closed && attempts > 4)) {
        stopPolling();
        status.textContent = 'No se ha confirmado la conexión. Comprueba la autorización de Google e inténtalo de nuevo.';
      }
    }, 2000);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = $('#youtubeVideoFile')?.files?.[0];
    if (!file) { result.textContent = 'Selecciona un MP4 exportado.'; return; }
    if (file.size > 120 * 1024 * 1024) { result.textContent = 'El MP4 supera el límite de 120 MB.'; return; }
    if (!$('#youtubeRights')?.checked) { result.textContent = 'Confirma que tienes derechos para publicar este vídeo.'; return; }

    const button = $('#youtubePublishButton');
    button.disabled = true;
    result.textContent = 'Subiendo el vídeo a YouTube… No cierres esta página.';
    const body = new FormData();
    body.append('video', file, file.name);
    body.append('title', $('#youtubeTitle').value.trim());
    body.append('description', $('#youtubeDescription').value.trim());
    body.append('visibility', $('#youtubeVisibility').value);
    try {
      const response = await fetch('/api/youtube/upload', {method:'POST', body});
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo publicar el vídeo.');
      result.textContent = 'Vídeo publicado correctamente: ' + (data.watchUrl || data.videoId);
      if (data.watchUrl) {
        const link = document.createElement('a');
        link.href = data.watchUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'Abrir vídeo en YouTube';
        result.append(document.createTextNode(' '), link);
      }
      form.reset();
      await refreshProfile();
    } catch (error) {
      result.textContent = 'Error de publicación: ' + error.message;
      if (/no está conectado|caducado|401/i.test(error.message)) await refreshProfile();
    } finally {
      button.disabled = false;
    }
  });

  refreshProfile();
})();
