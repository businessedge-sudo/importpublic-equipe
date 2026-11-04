// Import Public : service worker (alertes du téléphone + page hors connexion).
// Pas de cache des pages : on sert toujours la dernière version du site.
const VERSION = 'v11-1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Alerte reçue (envoyée par l'Edge Function « envoyer-push »)
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titre: 'Import Public', corps: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titre || 'Import Public', {
    body: d.corps || '',
    icon: 'icones/icone-192.png',
    badge: 'icones/badge-96.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || self.registration.scope }
  }));
});

// Clic sur l'alerte : on rouvre l'appli (ou l'onglet déjà ouvert) à la bonne page
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of fenetres) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        c.postMessage({ type: 'aller', url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

// Hors connexion : une page simple au lieu de l'erreur du navigateur
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Import Public · Hors connexion</title>
     <body style="font-family:system-ui,sans-serif;background:#f6f3ee;color:#1d1b18;display:grid;place-items:center;min-height:90vh;margin:0;padding:16px;text-align:center">
     <div><div style="width:64px;height:64px;border-radius:16px;background:#d9480f;color:#fff;font-weight:800;font-size:26px;display:grid;place-items:center;margin:0 auto 16px">IP</div>
     <h1 style="font-size:1.3rem">Pas de connexion</h1><p>Vérifiez votre connexion Internet, puis réessayez.</p>
     <button onclick="location.reload()" style="background:#d9480f;color:#fff;border:0;border-radius:12px;padding:12px 20px;font-weight:700;font-size:1rem">Réessayer</button></div>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
