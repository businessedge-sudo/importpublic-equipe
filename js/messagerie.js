// Import Public : messagerie client ↔ équipe (texte, émojis, photos, fichiers ; pas de messages vocaux).
// Le client ne peut ni modifier ni supprimer ses messages (la base le refuse).
// Un membre de l'équipe peut modifier ou supprimer SES messages : ils restent marqués « modifié » / « supprimé ».
(function () {
  const EMOJIS = ['😀', '😊', '😂', '🥰', '😍', '😎', '🤔', '😅', '😢', '😡', '🙏', '👍', '👎', '👌', '👏', '💪',
                  '🤝', '🙌', '❤️', '🔥', '✅', '❌', '⚠️', '⏳', '📦', '🚚', '✈️', '🚢', '🛍️', '💰', '💵', '📱',
                  '📷', '📍', '🏠', '🎉', '🎁', '⭐', '👀', '🙂', '😉', '🤗', '😴', '🤷', '👋', '💯', '❓', '‼️'];
  const ACCEPTE = 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,video/mp4,video/quicktime';
  const MAX = 10 * 1024 * 1024;

  window.IP_CHAT = function ({ equipe }) {
    const { sb, esc, toast, msgErreur, compresserImage } = window.IA;
    const I = window.ICO;

    const taille = (o) => (o > 1048576 ? (o / 1048576).toFixed(1).replace('.', ',') + ' Mo' : Math.max(1, Math.round(o / 1024)) + ' Ko');
    const heure = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const jour = (d) => {
      const x = new Date(d); const a = new Date(); const h = new Date(Date.now() - 86400000);
      const meme = (p, q) => p.toDateString() === q.toDateString();
      return meme(x, a) ? 'Aujourd\'hui' : meme(x, h) ? 'Hier' : x.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    };
    // Texte → HTML sûr, liens cliquables, retours à la ligne
    // Les liens WhatsApp (wa.me) deviennent un bouton lisible au lieu d'une longue adresse
    const enrichir = (t) => esc(t)
      .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, (u) => /^https:\/\/wa\.me\//.test(u)
        ? `<a class="chat-wa" href="${u}" target="_blank" rel="noopener nofollow">💬 Écrire sur WhatsApp</a>`
        : `<a href="${u}" target="_blank" rel="noopener nofollow">${u}</a>`)
      .replace(/\n/g, '<br>');

    // Monte une conversation dans `zone`. Renvoie le canal temps réel (à retirer en quittant la page).
    async function monter(zone, clientId, monId, { noms = {}, vide = '' } = {}) {
      zone.innerHTML = `<div class="chat">
          <div class="chat-fil" aria-live="polite"><div class="chargement">Chargement…</div></div>
          <div class="chat-emojis" hidden>${EMOJIS.map((e) => `<button type="button">${e}</button>`).join('')}</div>
          <div class="chat-apercu" hidden></div>
          <form class="chat-saisie" autocomplete="off">
            <button type="button" class="chat-btn" data-emo aria-label="Émojis">${I.sourire}</button>
            <button type="button" class="chat-btn" data-pj aria-label="Joindre une photo ou un fichier">${I.trombone}</button>
            <input type="file" accept="${ACCEPTE}" hidden>
            <textarea rows="1" maxlength="4000" placeholder="Écrire un message…" aria-label="Message"></textarea>
            <button class="chat-envoyer" aria-label="Envoyer">${I.envoyer}</button>
          </form></div>`;
      const fil = zone.querySelector('.chat-fil');
      // La conversation occupe exactement la hauteur visible (au-dessus de la barre du bas sur mobile)
      const boite = zone.querySelector('.chat');
      const ajusterHauteur = () => {
        const nav = document.querySelector('.nav-bas');
        const basNav = nav && getComputedStyle(nav).display !== 'none' ? nav.offsetHeight : 0;
        const haut = boite.getBoundingClientRect().top + window.scrollY;
        boite.style.height = Math.max(360, window.innerHeight - haut - basNav - 12) + 'px';
      };
      ajusterHauteur();
      window.addEventListener('resize', ajusterHauteur);
      const f = zone.querySelector('form');
      const champ = f.querySelector('textarea');
      const fichierInput = f.querySelector('input[type=file]');
      const panneauEmo = zone.querySelector('.chat-emojis');
      const apercu = zone.querySelector('.chat-apercu');
      const msgs = new Map();
      const urls = new Map();
      let piece = null;

      const cote = (m) => (equipe ? m.de_equipe : !m.de_equipe) ? 'moi' : 'eux';
      const auteur = (m) => {
        if (!m.de_equipe) return equipe ? (noms.client || 'Client') : '';
        if (!equipe) return 'Import Public';
        if (!m.auteur_id) return 'Message automatique';
        return m.auteur_id === monId ? 'Vous' : (noms[m.auteur_id] || 'Équipe');
      };
      // Documents joints aux messages (devis, reçu, avis…)
      const docs = new Map();
      async function chargerDocs(ids) {
        const manquants = [...new Set(ids.filter((x) => x && !docs.has(x)))];
        if (!manquants.length) return;
        const { data: dd } = await sb.from('documents').select('id,numero,type,total,remplace').in('id', manquants);
        (dd || []).forEach((d) => docs.set(d.id, d));
      }
      const carteDoc = (id) => {
        const d = docs.get(id);
        if (!d) return '';
        const nom = window.IP_DOCS ? window.IP_DOCS.libelle(d.type) : 'Document';
        return `<a class="msg-doc" href="#/document/${d.id}">${I.fichier}<span><b>${esc(nom)} n° ${esc(d.numero)}</b>
          <small>${d.remplace ? 'Remplacé par un devis plus récent' : (d.type === 'bon_retrait' ? 'À présenter au point de retrait' : 'Voir, enregistrer en PDF') + (d.type === 'devis' ? ', accepter' : '')}</small></span>
          <em>${d.type === 'bon_retrait' ? 'Code inclus' : window.IA.fcfa(d.total)}</em></a>`;
      };

      async function urlPiece(path) {
        if (urls.has(path)) return urls.get(path);
        const { data } = await sb.storage.from('messages').createSignedUrl(path, 3600);
        const u = data && data.signedUrl;
        if (u) urls.set(path, u);
        return u;
      }

      function htmlMessage(m) {
        const modifiable = equipe && m.de_equipe && m.auteur_id === monId && !m.supprime;
        let corps;
        if (m.supprime) corps = `<p class="msg-supprime">Message supprimé</p>`;
        else {
          let pj = '';
          if (m.piece_path) {
            pj = /^image\//.test(m.piece_type || '')
              ? `<a class="msg-image" data-pj="${esc(m.piece_path)}" target="_blank" rel="noopener"><span class="msg-image-attente">Photo…</span></a>`
              : `<a class="msg-fichier" data-pj="${esc(m.piece_path)}" target="_blank" rel="noopener" download="${esc(m.piece_nom || 'fichier')}">
                   ${I.fichier}<span><b>${esc(m.piece_nom || 'Fichier')}</b><small>${m.piece_taille ? taille(m.piece_taille) : ''}</small></span>${I.telecharger}</a>`;
          }
          corps = pj + (m.texte ? `<p>${enrichir(m.texte)}</p>` : '') + (m.document_id ? carteDoc(m.document_id) : '');
        }
        const a = auteur(m);
        return `<div class="msg msg-${cote(m)}" data-id="${m.id}">
            <div class="msg-bulle">${a && cote(m) === 'eux' ? `<span class="msg-auteur">${esc(a)}</span>` : ''}${corps}
              <span class="msg-meta">${m.modifie_le && !m.supprime ? 'modifié · ' : ''}${heure(m.cree_le)}${equipe && m.de_equipe && cote(m) === 'moi' && a !== 'Vous' ? ' · ' + esc(a) : ''}</span>
            </div>
            ${modifiable ? `<div class="msg-actions"><button type="button" data-modifier="${m.id}">Modifier</button><button type="button" data-supprimer="${m.id}">Supprimer</button></div>` : ''}
          </div>`;
      }

      function dessiner(defiler) {
        const tri = [...msgs.values()].sort((a, b) => new Date(a.cree_le) - new Date(b.cree_le) || a.id - b.id);
        if (!tri.length) { fil.innerHTML = `<div class="chat-vide">${vide}</div>`; return; }
        const enBas = fil.scrollHeight - fil.scrollTop - fil.clientHeight < 80;
        let j = '';
        fil.innerHTML = tri.map((m) => {
          const jj = jour(m.cree_le);
          const sep = jj !== j ? `<div class="chat-jour"><span>${esc(jj)}</span></div>` : '';
          j = jj;
          return sep + htmlMessage(m);
        }).join('');
        fil.querySelectorAll('[data-pj]').forEach(async (a) => {
          const u = await urlPiece(a.dataset.pj);
          if (!u) return;
          a.href = u;
          if (a.classList.contains('msg-image')) a.innerHTML = `<img src="${esc(u)}" alt="Photo envoyée" loading="lazy">`;
        });
        fil.querySelectorAll('[data-modifier]').forEach((b) => b.addEventListener('click', () => editer(Number(b.dataset.modifier))));
        fil.querySelectorAll('[data-supprimer]').forEach((b) => b.addEventListener('click', async () => {
          if (!confirm('Supprimer ce message ? Le client verra « Message supprimé ».')) return;
          const { data, error } = await sb.rpc('supprimer_message', { p_id: Number(b.dataset.supprimer) });
          if (error) return toast(msgErreur(error), 'ko');
          msgs.set(data.id, data); dessiner();
        }));
        if (defiler || enBas) fil.scrollTop = fil.scrollHeight;
        // Les photos se chargent après : on reste en bas
        fil.querySelectorAll('img').forEach((im) => im.addEventListener('load', () => { if (defiler || enBas) fil.scrollTop = fil.scrollHeight; }));
      }

      function editer(id) {
        const m = msgs.get(id);
        const bloc = fil.querySelector(`.msg[data-id="${id}"] .msg-bulle`);
        if (!m || !bloc) return;
        bloc.innerHTML = `<textarea class="msg-edition" rows="3" maxlength="4000">${esc(m.texte || '')}</textarea>
          <div class="msg-edition-actions"><button type="button" class="btn btn-petit" data-ok>Enregistrer</button>
          <button type="button" class="btn btn-second btn-petit" data-annuler>Annuler</button></div>`;
        const ta = bloc.querySelector('textarea');
        ta.focus();
        bloc.querySelector('[data-annuler]').addEventListener('click', () => dessiner());
        bloc.querySelector('[data-ok]').addEventListener('click', async () => {
          const { data, error } = await sb.rpc('modifier_message', { p_id: id, p_texte: ta.value });
          if (error) return toast(msgErreur(error), 'ko');
          msgs.set(data.id, data); dessiner();
        });
      }

      // Chargement initial : 200 derniers messages
      const { data, error } = await sb.from('messages').select('*').eq('client_id', clientId)
        .order('cree_le', { ascending: false }).limit(200);
      if (error) throw error;
      (data || []).forEach((m) => msgs.set(m.id, m));
      await chargerDocs((data || []).map((m) => m.document_id));
      dessiner(true);
      const marquerLu = () => sb.rpc('marquer_conversation_lue', { p_client: clientId }).then(() => {}, () => {});
      marquerLu();

      // Saisie
      const ajuster = () => { champ.style.height = 'auto'; champ.style.height = Math.min(champ.scrollHeight, 140) + 'px'; };
      champ.addEventListener('input', ajuster);
      const ecranLarge = () => matchMedia('(min-width: 900px)').matches;
      champ.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && (ecranLarge() || e.ctrlKey || e.metaKey)) { e.preventDefault(); f.requestSubmit(); }
      });
      zone.querySelector('[data-emo]').addEventListener('click', () => { panneauEmo.hidden = !panneauEmo.hidden; });
      panneauEmo.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const d = champ.selectionStart ?? champ.value.length, fin = champ.selectionEnd ?? d;
        champ.value = champ.value.slice(0, d) + b.textContent + champ.value.slice(fin);
        champ.selectionStart = champ.selectionEnd = d + b.textContent.length;
        champ.focus(); ajuster();
      }));
      zone.querySelector('[data-pj]').addEventListener('click', () => fichierInput.click());
      const viderPiece = () => { piece = null; apercu.hidden = true; apercu.innerHTML = ''; fichierInput.value = ''; };
      fichierInput.addEventListener('change', async () => {
        const fi = fichierInput.files[0];
        if (!fi) return;
        if (/^audio\//.test(fi.type)) { toast('Les messages vocaux ne sont pas pris en charge. Appelez-nous si besoin.', 'ko'); return viderPiece(); }
        let blob = fi, nom = fi.name, type = fi.type || 'application/octet-stream';
        if (/^image\/(jpeg|png|webp|heic|heif)$/.test(type)) {
          try { blob = await compresserImage(fi, 1600, 0.82); type = 'image/jpeg'; nom = nom.replace(/\.[^.]+$/, '') + '.jpg'; } catch { /* on garde l'original */ }
        }
        if (blob.size > MAX) { toast('Fichier trop lourd (10 Mo maximum)', 'ko'); return viderPiece(); }
        piece = { blob, nom, type };
        const estImg = /^image\//.test(type);
        apercu.innerHTML = `${estImg ? `<img src="${URL.createObjectURL(blob)}" alt="">` : I.fichier}
          <span><b>${esc(nom)}</b><small>${taille(blob.size)}</small></span>
          <button type="button" aria-label="Retirer la pièce jointe">✕</button>`;
        apercu.hidden = false;
        apercu.querySelector('button').addEventListener('click', viderPiece);
      });

      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const texte = champ.value.trim();
        if (!texte && !piece) return;
        const bouton = f.querySelector('.chat-envoyer');
        bouton.disabled = true;
        try {
          let p = {};
          if (piece) {
            const ext = (piece.nom.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'bin';
            const chemin = `${clientId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
            const up = await sb.storage.from('messages').upload(chemin, piece.blob, { contentType: piece.type, upsert: false });
            if (up.error) throw up.error;
            p = { p_piece_path: chemin, p_piece_type: piece.type, p_piece_nom: piece.nom, p_piece_taille: piece.blob.size };
          }
          const { data: m, error: e } = await sb.rpc('envoyer_message', { p_client: clientId, p_texte: texte || null, ...p });
          if (e) throw e;
          msgs.set(m.id, m);
          champ.value = ''; ajuster(); viderPiece(); panneauEmo.hidden = true;
          dessiner(true);
        } catch (err) {
          toast(msgErreur(err), 'ko');
        } finally { bouton.disabled = false; }
      });

      // Temps réel
      const canal = sb.channel('chat-' + clientId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: 'client_id=eq.' + clientId }, (pl) => {
          const m = pl.new;
          if (!m || !m.id) return;
          const nouveau = !msgs.has(m.id);
          msgs.set(m.id, m);
          if (m.document_id && !docs.has(m.document_id)) chargerDocs([m.document_id]).then(() => dessiner(nouveau));
          else dessiner(nouveau);
          if (nouveau && document.visibilityState === 'visible') marquerLu();
        })
        .subscribe();
      return canal;
    }

    return { monter };
  };
})();
