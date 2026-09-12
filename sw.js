/* sw.js — cache-first para o app, stale-while-revalidate para os dados. */

const VERSAO = 'v3';
const ESTATICO = `estatico-${VERSAO}`;
const DADOS = `dados-${VERSAO}`;

const ESSENCIAIS = [
  './', './index.html', './manifest.json',
  './css/app.css',
  './js/app.js', './js/tri.js', './js/motor.js', './js/srs.js',
  './js/dados.js', './js/estado.js', './js/nuvem.js', './js/ia.js', './js/config.js',
  './dados/cursos.json', './dados/vocabulario.json',
  './favicon.svg', './icone-192.png', './apple-touch-icon.png',
  './fontes/space-grotesk-latin-wght-normal.woff2',
  './fontes/manrope-latin-wght-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(ESTATICO).then((c) => c.addAll(ESSENCIAIS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => !k.endsWith(VERSAO)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Nunca intercepta a IA nem o Firebase.
  if (url.pathname.includes('/explicar') || url.hostname.includes('googleapis') || url.hostname.includes('gstatic')) return;

  // Questões: serve do cache e atualiza em segundo plano.
  if (url.pathname.includes('/dados/questoes-')) {
    e.respondWith(
      caches.open(DADOS).then(async (cache) => {
        const guardada = await cache.match(e.request);
        const rede = fetch(e.request).then((r) => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => guardada);
        return guardada || rede;
      })
    );
    return;
  }

  // Imagens das questões: cache permanente, são imutáveis.
  if (/\.(png|jpg|jpeg|svg|webp)$/i.test(url.pathname)) {
    e.respondWith(
      caches.open(DADOS).then(async (cache) => {
        const guardada = await cache.match(e.request);
        if (guardada) return guardada;
        try {
          const r = await fetch(e.request);
          if (r.ok) cache.put(e.request, r.clone());
          return r;
        } catch { return new Response('', { status: 504 }); }
      })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((c) => c || fetch(e.request).catch(() => caches.match('./index.html')))
  );
});
