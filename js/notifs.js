// Import Public : notifications (cloche + alertes du téléphone) et application installable.
// Utilisé par le site client (origine 'site') et l'espace équipe (origine 'equipe').
//  - Android / ordinateur : les alertes marchent dans le navigateur, SANS installer l'application.
//  - iPhone : Apple n'autorise les alertes qu'après « Sur l'écran d'accueil » (iOS 16.4 et plus).
(function () {
  window.IP_NOTIFS = function ({ origine, getSession, surNotif }) {
    const { sb, esc, date, toast, msgErreur } = window.IA;
    const I = window.ICO;
    const memo = {
      lire(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
      ecrire(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* navigation privée */ } }
    };
    let invitationInstall = null;   // événement Android « beforeinstallprompt »
    let canal = null;
    let nonLues = 0;
    let liste = [];

    const ua = navigator.userAgent || '';
    const estIOS = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const estInstallee = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    const pushPossible = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

    // ---------------------------------------------------------------- service worker
    let enregistrement = null;
    async function sw() {
      if (!('serviceWorker' in navigator)) return null;
      if (!enregistrement) {
        try { enregistrement = await navigator.serviceWorker.register('sw.js'); } catch { return null; }
      }
      return navigator.serviceWorker.ready;
    }
    if ('serviceWorker' in navigator) {
      sw();
      // Le service worker demande d'ouvrir une page (clic sur une alerte)
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'aller' && e.data.url) {
          const u = new URL(e.data.url, location.href);
          if (u.origin === location.origin) location.hash = u.hash || '#/'; else location.href = u.href;
        }
      });
    }
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); invitationInstall = e; majZonesInstall(); });
    window.addEventListener('appinstalled', () => { invitationInstall = null; majZonesInstall(); toast('Application installée'); });

    // ---------------------------------------------------------------- alertes push
    const b64VersOctets = (b) => {
      const p = '='.repeat((4 - (b.length % 4)) % 4);
      const s = atob((b + p).replace(/-/g, '+').replace(/_/g, '/'));
      return Uint8Array.from(s, (c) => c.charCodeAt(0));
    };

    async function etatPush() {
      if (!pushPossible()) return estIOS && !estInstallee() ? 'ios_installer' : 'indisponible';
      if (Notification.permission === 'denied') return 'refuse';
      if (Notification.permission === 'granted') {
        const r = await sw();
        const s = r && await r.pushManager.getSubscription();
        if (s) return 'actif';
      }
      return 'a_activer';
    }

    async function enregistrer(abonnement) {
      const j = abonnement.toJSON();
      const { error } = await sb.rpc('enregistrer_abonnement', {
        p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_origine: origine, p_ua: ua.slice(0, 300) });
      if (error) throw error;
    }

    async function activer() {
      if (!getSession()) throw new Error('Connectez-vous d\'abord');
      const ok = await Notification.requestPermission();
      if (ok !== 'granted') throw new Error(ok === 'denied'
        ? 'Les alertes sont bloquées pour ce site. Autorisez-les dans les réglages du navigateur (icône à gauche de l\'adresse).'
        : 'Alertes non autorisées');
      const r = await sw();
      if (!r) throw new Error('Votre navigateur ne permet pas les alertes');
      let s = await r.pushManager.getSubscription();
      if (!s) {
        const { data: cle, error } = await sb.rpc('cle_push_publique');
        if (error || !cle) throw new Error('Service d\'alertes indisponible, réessayez plus tard');
        s = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64VersOctets(cle) });
      }
      await enregistrer(s);
      memo.ecrire('ip_push_ok', Date.now());
    }

    async function desactiver() {
      const r = await sw();
      const s = r && await r.pushManager.getSubscription();
      if (s) {
        await sb.from('push_abonnements').delete().eq('endpoint', s.endpoint);
        await s.unsubscribe();
      }
    }

    // Au démarrage : rattache l'abonnement de ce navigateur au compte connecté
    async function resynchroniser() {
      try {
        if (!getSession() || !pushPossible() || Notification.permission !== 'granted') return;
        const r = await sw();
        const s = r && await r.pushManager.getSubscription();
        if (s) await enregistrer(s);
      } catch { /* silencieux */ }
    }

    // ---------------------------------------------------------------- installation
    async function installer() {
      if (invitationInstall) {
        invitationInstall.prompt();
        const { outcome } = await invitationInstall.userChoice;
        invitationInstall = null;
        majZonesInstall();
        return outcome === 'accepted';
      }
      return false;
    }
    const aideIOS = `<ol class="etapes-ios">
        <li>Ouvrez ce site dans <b>Safari</b>.</li>
        <li>Touchez <b>Partager</b> <span class="ico-partage" aria-hidden="true">⬆︎</span> en bas de l'écran.</li>
        <li>Choisissez <b>« Sur l'écran d'accueil »</b>, puis <b>Ajouter</b>.</li>
        <li>Ouvrez Import Public depuis l'icône, puis activez les alertes ici.</li></ol>`;
    const aideInstallManuelle = `<p class="discret">Dans le menu du navigateur (⋮), choisissez <b>« Installer l'application »</b> ou <b>« Ajouter à l'écran d'accueil »</b>.</p>`;

    function majZonesInstall() {
      document.querySelectorAll('[data-zone-notifs]').forEach((z) => remplirCarte(z));
    }

    // ---------------------------------------------------------------- carte « Alertes et application »
    async function remplirCarte(zone) {
      const e = await etatPush();
      const installee = estInstallee();
      const nomApp = origine === 'equipe' ? 'Import Public Équipe' : 'Import Public';
      const txtAlertes = origine === 'equipe'
        ? 'Soyez prévenu dès qu\'un client écrit, qu\'un paiement est déclaré ou qu\'une demande arrive.'
        : 'Soyez prévenu dès que votre colis avance, que votre paiement est confirmé ou qu\'une nouvelle campagne ouvre.';
      let alertes;
      if (e === 'actif') alertes = `<p class="ok-ligne">${I.coche}<span>Alertes activées sur cet appareil.</span></p>
          <button type="button" class="lien-texte" data-act="desactiver">Désactiver sur cet appareil</button>`;
      else if (e === 'refuse') alertes = `<div class="alerte alerte-alerte">Les alertes sont bloquées pour ce site. Ouvrez les réglages du navigateur
          (icône à gauche de l'adresse → Autorisations → Notifications) et choisissez « Autoriser ».</div>`;
      else if (e === 'ios_installer') alertes = `<p>Sur iPhone, Apple n'envoie les alertes qu'aux sites ajoutés à l'écran d'accueil :</p>${aideIOS}`;
      else if (e === 'indisponible') alertes = `<p class="discret">Ce navigateur ne permet pas les alertes. Essayez Chrome. Vous verrez quand même vos notifications dans la cloche ${I.cloche}.</p>`;
      else alertes = `<p>${txtAlertes}</p><button type="button" class="btn" data-act="activer">${I.cloche}Activer les alertes</button>`;

      let install = '';
      if (!installee) {
        if (invitationInstall) install = `<button type="button" class="btn btn-second" data-act="installer">${I.telecharger}Installer l'application</button>`;
        else if (estIOS && e !== 'ios_installer') install = `<details><summary class="lien-texte">Ajouter l'application sur l'iPhone</summary>${aideIOS}</details>`;
        else if (!estIOS) install = `<details><summary class="lien-texte">Installer l'application</summary>${aideInstallManuelle}</details>`;
      }
      zone.innerHTML = `<div class="carte carte-notifs">
          <h2>${I.cloche}Alertes et application</h2>
          ${alertes}
          ${install ? `<div class="sep-install"><p class="discret">L'application « ${esc(nomApp)} » s'ouvre depuis l'écran d'accueil, sans passer par le Play Store. Elle pèse moins de 1 Mo.</p>${install}</div>` : ''}
          ${installee ? `<p class="discret">${I.coche} Vous utilisez l'application ${esc(nomApp)}.</p>` : ''}
        </div>`;
      brancherActions(zone, () => remplirCarte(zone));
    }

    function brancherActions(zone, apres) {
      zone.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          if (b.dataset.act === 'activer') { await activer(); toast('Alertes activées'); }
          if (b.dataset.act === 'desactiver') { await desactiver(); toast('Alertes désactivées sur cet appareil'); }
          if (b.dataset.act === 'installer') await installer();
          if (b.dataset.act === 'plus-tard') memo.ecrire('ip_invite_vue', Date.now());
        } catch (err) { toast(msgErreur(err), 'ko'); }
        b.disabled = false;
        apres();
      }));
    }

    // Petite invitation en bas d'écran, une fois par semaine au plus, après connexion
    async function inviter() {
      if (!getSession() || document.getElementById('invite-notifs')) return;
      const vue = memo.lire('ip_invite_vue');
      if (vue && Date.now() - vue < 7 * 86400000) return;
      const e = await etatPush();
      if (e !== 'a_activer' && !(e === 'ios_installer')) return;
      const d = document.createElement('div');
      d.id = 'invite-notifs';
      d.className = 'invite-notifs';
      d.innerHTML = e === 'ios_installer'
        ? `<div>${I.cloche}<p><b>Suivez vos colis en temps réel</b><br>Ajoutez Import Public à votre écran d'accueil pour recevoir les alertes.</p></div>
           <div class="invite-actions"><a class="btn btn-petit" href="#/compte?alertes=1" data-act="plus-tard">Comment faire</a>
           <button type="button" class="lien-texte" data-act="plus-tard">Plus tard</button></div>`
        : `<div>${I.cloche}<p><b>${origine === 'equipe' ? 'Ne ratez aucun message client' : 'Suivez vos colis en temps réel'}</b><br>
           ${origine === 'equipe' ? 'Recevez une alerte à chaque message, paiement ou demande.' : 'Recevez une alerte à chaque étape, sans installer d\'application.'}</p></div>
           <div class="invite-actions"><button type="button" class="btn btn-petit" data-act="activer">Activer</button>
           <button type="button" class="lien-texte" data-act="plus-tard">Plus tard</button></div>`;
      document.body.appendChild(d);
      requestAnimationFrame(() => d.classList.add('visible'));
      brancherActions(d, () => { memo.ecrire('ip_invite_vue', Date.now()); d.remove(); majZonesInstall(); });
    }

    // ---------------------------------------------------------------- cloche
    async function charger() {
      const s = getSession();
      if (!s) { liste = []; nonLues = 0; return; }
      const { data } = await sb.from('notifications').select('id,titre,corps,lien,lu,cree_le')
        .eq('profil_id', s.user.id).eq('cible', origine).order('cree_le', { ascending: false }).limit(30);
      liste = data || [];
      nonLues = liste.filter((n) => !n.lu).length;
    }

    function dessinerCloche() {
      const el = document.getElementById('cloche');
      if (!el) return;
      if (!getSession()) { el.innerHTML = ''; return; }
      el.innerHTML = `<button type="button" class="btn-cloche" aria-label="Notifications${nonLues ? ' (' + nonLues + ' non lues)' : ''}" aria-haspopup="true">
          ${I.cloche}${nonLues ? `<b class="compte-badge">${nonLues > 9 ? '9+' : nonLues}</b>` : ''}</button>`;
      el.querySelector('button').addEventListener('click', (ev) => { ev.stopPropagation(); basculerPanneau(); });
    }

    function fermerPanneau() { const p = document.getElementById('panneau-notifs'); if (p) p.remove(); }
    function basculerPanneau() {
      if (document.getElementById('panneau-notifs')) return fermerPanneau();
      const p = document.createElement('div');
      p.id = 'panneau-notifs';
      p.className = 'panneau-notifs';
      p.innerHTML = `<div class="panneau-tete"><b>Notifications</b>
          ${nonLues ? '<button type="button" class="lien-texte" id="tout-lu">Tout marquer comme lu</button>' : ''}</div>
        <div class="panneau-liste">${liste.length ? liste.map((n) => `
          <a class="notif${n.lu ? '' : ' non-lue'}" href="${esc(n.lien || '#/')}" data-id="${n.id}">
            <b>${esc(n.titre)}</b>${n.corps ? `<span>${esc(n.corps)}</span>` : ''}<small>${esc(date(n.cree_le, true))}</small></a>`).join('')
          : `<p class="discret" style="padding:14px">Aucune notification pour l'instant.</p>`}</div>
        <div class="panneau-pied"><a href="${origine === 'equipe' ? '#/alertes' : '#/compte?alertes=1'}">${I.engrenage}Alertes sur ce téléphone</a></div>`;
      document.body.appendChild(p);
      p.addEventListener('click', (e) => e.stopPropagation());
      p.querySelectorAll('.notif').forEach((a) => a.addEventListener('click', () => {
        const id = Number(a.dataset.id);
        const n = liste.find((x) => x.id === id);
        if (n && !n.lu) { n.lu = true; nonLues--; sb.rpc('marquer_notifications_lues', { p_cible: origine, p_ids: [id] }).then(() => {}, () => {}); }
        fermerPanneau(); dessinerCloche();
      }));
      const t = p.querySelector('#tout-lu');
      if (t) t.addEventListener('click', async () => {
        await sb.rpc('marquer_notifications_lues', { p_cible: origine, p_ids: null });
        liste.forEach((n) => { n.lu = true; }); nonLues = 0; fermerPanneau(); dessinerCloche();
      });
    }
    document.addEventListener('click', fermerPanneau);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermerPanneau(); });

    // Temps réel : nouvelle notification → cloche + petit message si la page est ouverte
    function ecouter() {
      if (canal) { sb.removeChannel(canal); canal = null; }
      const s = getSession();
      if (!s) return;
      canal = sb.channel('notifs-' + origine)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'profil_id=eq.' + s.user.id }, (pl) => {
          const n = pl.new;
          if (n.cible !== origine) return;
          liste.unshift(n); liste = liste.slice(0, 30); nonLues++;
          dessinerCloche();
          if (surNotif) try { surNotif(n); } catch { /* rien */ }
          // Inutile d'annoncer un message quand on est déjà dans la conversation
          if (n.lien && location.hash.startsWith(n.lien) && n.lien.startsWith('#/messages')) return;
          if (document.visibilityState === 'visible') toast(n.titre + (n.corps ? ' · ' + n.corps.slice(0, 60) : ''));
        })
        .subscribe();
    }

    // À appeler au démarrage et après chaque connexion / déconnexion
    async function demarrer() {
      await charger();
      dessinerCloche();
      ecouter();
      resynchroniser();
      setTimeout(inviter, 4000);
    }

    return { demarrer, dessinerCloche, remplirCarte, inviter, etatPush, activer, estInstallee, estIOS,
             recharger: async () => { await charger(); dessinerCloche(); } };
  };
})();
