const CACHE='super-cal-static-v20260909';
const ASSETS=['./','./index.html','./styles.css?v=20260909','./core.js?v=20260909','./app.js?v=20260909','./manifest.webmanifest?v=20260909','./icon.svg?v=20260909'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{if(new URL(event.request.url).origin===location.origin){const copy=response.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));}return response}).catch(()=>caches.match('./index.html'))));});
