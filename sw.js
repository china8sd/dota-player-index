const C='dpi-10';const SHELL=['./','index.html','css/style.css','css/theme.css','css/light.css','css/v6.css','css/v7.css','css/v8.css','css/train.css','css/v12.css','js/app.js','js/enhance.js','js/v6.js','js/v7.js','js/v8.js','js/train.js','js/v10.js','js/v12.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(C).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request)))});
