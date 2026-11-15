// Invalidates legacy caches including clipforge-web-v144 and older app/editor bundles.
const CACHE='clipforge-web-v173';
const FILES=[
 '/',
 '/styles.css','/styles-clip-editor-final-v2.css',
 '/app.js','/browser-whisper.js','/browser-whisper-inline-v3.js',
 '/browser-export.js','/browser-url.js','/editor.js',
 '/workspace-ui-v4.js','/timeline-core.js','/capcut-editor.js','/capcut-editor-enhancements.js',
 '/auth.js','/google-drive.js','/manifest.webmanifest'
];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(
    keys.filter(key=>key.startsWith('clipforge-web-')&&key!==CACHE).map(key=>caches.delete(key))
  )).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin) return;
  // Always prefer fresh app/API responses; use the precache only when offline.
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok && FILES.includes(url.pathname)){
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put(event.request,copy));
    }
    return response;
  }).catch(()=>caches.match(event.request).then(cached=>cached||Response.error())));
});
