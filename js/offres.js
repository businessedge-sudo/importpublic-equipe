// Articles disponibles à Lomé : bons plans négociés avec des grossistes locaux.
// Le client commande depuis le site : cela crée une demande liée à l'article (devis, paiement,
// colis et code de retrait exactement comme le sur mesure). Le fournisseur et le prix d'achat
// restent visibles par l'équipe seulement (table offres_sources).
window.IP_OFFRES = function (ctx) {
  const { sb, cfg, fcfa, date, esc, waLien, badge, msgErreur, toast, occupe, compresserImage, urlImageCampagne } = window.IA;
  const vue = ctx.vue;
  const I = window.ICO;

  const STATUTS = [
    ['brouillon', 'Brouillon', 'neutre'],
    ['active', 'En vente', 'ok'],
    ['epuisee', 'Épuisé', 'alerte'],
    ['archivee', 'Archivé', 'neutre']
  ];
  const pastille = (s) => { const x = STATUTS.find((t) => t[0] === s) || [s, s, 'info']; return `<span class="badge badge-${x[2]}">${esc(x[1])}</span>`; };
  const lienSite = (id) => `${cfg.urlSite}/#/article/${id}`;
  const n = (v) => (v === '' || v == null ? null : Number(v));

  // Marge nette par pièce : prix de vente - prix d'achat - coursier. Null tant que le prix d'achat n'est pas saisi.
  const marge = (prix, src) => (src && src.prix_achat != null ? Number(prix) - Number(src.prix_achat) - Number(src.frais_coursier || 0) : null);
  async function margeMin() {
    const { data } = await sb.from('parametres').select('valeur').eq('cle', 'marge_min_offre').maybeSingle();
    return data ? Number(data.valeur) : 3000;
  }
  const telDe = (contact) => { const d = String(contact || '').replace(/\D/g, ''); return d.length >= 8 ? (d.length === 8 ? '228' + d : d) : null; };

  const texteWhatsApp = (o) => [
    `⚡ Disponible tout de suite : ${o.titre}`,
    o.accroche || '',
    `Prix : ${fcfa(o.prix)} tout compris`,
    `Livré sous ${o.delai_heures || 48} h, ou à retirer à notre point de retrait.`,
    'Paiement par Mobile Money.',
    '',
    `Commandez ici : ${lienSite(o.id)}`
  ].filter((l, i, t) => l !== '' || (i > 0 && t[i - 1] !== '')).join('\n');

  // ------------------------------------------------------------------
  // Liste
  // ------------------------------------------------------------------
  async function vueOffres(_, params) {
    const f = params.get('f') || 'active';
    const [{ data, error }, srcR, cmdR, min] = await Promise.all([
      sb.from('offres').select('*').order('mise_en_avant', { ascending: false }).order('created_at', { ascending: false }).limit(300),
      ctx.estSupport() ? sb.from('offres_sources').select('offre_id,prix_achat,frais_coursier') : Promise.resolve({ data: [] }),
      sb.from('demandes').select('offre_id,statut').not('offre_id', 'is', null).limit(2000),
      margeMin()
    ]);
    if (error) throw error;
    const sources = Object.fromEntries((srcR.data || []).map((x) => [x.offre_id, x]));
    const cmd = {};
    (cmdR.data || []).forEach((x) => {
      const c = cmd[x.offre_id] || (cmd[x.offre_id] = { total: 0, aTraiter: 0 });
      if (!['annulee', 'refusee'].includes(x.statut)) c.total++;
      if (x.statut === 'nouvelle') c.aTraiter++;
    });
    const filtres = [['active', 'En vente'], ['brouillon', 'Brouillons'], ['epuisee', 'Épuisés'], ['archivee', 'Archivés'], ['toutes', 'Tous']];
    const liste = data.filter((o) => f === 'toutes' || o.statut === f);
    const visuel = (o) => o.image_url
      ? `<img class="dm-photo" src="${esc(urlImageCampagne(o.image_url))}" alt="" loading="lazy">`
      : `<span class="dm-photo dm-sans-photo"><span class="dm-cube">${I.colis}</span><small>Ajoutez des photos</small></span>`;
    const blocMarge = (o) => {
      if (!ctx.estSupport()) return '';
      const m = marge(o.prix, sources[o.id]);
      if (m == null) return '<span class="dm-puce dm-alerte">Prix d\'achat à saisir</span>';
      return `<span class="dm-puce${m < min ? ' dm-alerte' : ''}">Marge ${fcfa(m)} / pièce</span>`;
    };

    vue.innerHTML = `${ctx.ongletsCampagnes('offres')}
      <div class="dm-entete"><h1>Disponible tout de suite</h1>
        <a class="btn btn-petit" href="#/offre/nouvel">+ Nouvel article</a></div>
      <p class="discret">Les bons plans trouvés chez un grossiste ou un commerçant de Lomé, sans stock : le client commande, vous confirmez le stock avec le fournisseur, vous envoyez le devis, il paie, puis un coursier récupère l'article. Marge minimale conseillée : <b>${fcfa(min)}</b> nets par pièce, coursier déduit (modifiable dans Réglages).</p>
      <div class="filtres">${filtres.map(([k, l]) => `<button class="${k === f ? 'actif' : ''}" data-f="${k}">${l}<span class="dm-compte">${data.filter((o) => k === 'toutes' || o.statut === k).length}</span></button>`).join('')}</div>
      ${liste.length ? `<div class="dm-galerie">${liste.map((o) => `
        <a class="dm-carte" href="#/offre/${o.id}">
          <span class="dm-visuel">${visuel(o)}<span class="dm-badge">${pastille(o.statut)}</span></span>
          <span class="dm-corps">
            <b class="dm-titre">${o.mise_en_avant ? '⭐ ' : ''}${esc(o.titre)}</b>
            <span class="cp-prix"><b>${fcfa(o.prix)}</b></span>
            <span class="dm-puces">${blocMarge(o)}
              <span class="dm-puce">${I.panier || ''}${(cmd[o.id] || {}).total || 0} commande${((cmd[o.id] || {}).total || 0) > 1 ? 's' : ''}</span>
              ${(cmd[o.id] || {}).aTraiter ? `<span class="dm-puce dm-alerte">${cmd[o.id].aTraiter} à traiter</span>` : ''}
              <span class="dm-puce">⏱ ${o.delai_heures} h</span></span>
          </span></a>`).join('')}</div>`
        : `<div class="carte vide"><span class="dm-cube grand">${I.colis}</span><p>${data.length ? 'Aucun article dans ce filtre.' : 'Aucun article pour l\'instant. Ajoutez le premier bon plan négocié avec un grossiste.'}</p>
           <a class="btn" href="#/offre/nouvel">+ Nouvel article</a></div>`}`;
    vue.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/offres?f=' + b.dataset.f; }));
  }

  // ------------------------------------------------------------------
  // Fiche : création, modification, fournisseur, commandes
  // ------------------------------------------------------------------
  async function vueOffre(id) {
    const nouvel = !id || id === 'nouvel';
    let o = { titre: '', accroche: '', description: '', categorie: '', prix: '', prix_reference: '', delai_heures: 48, statut: 'brouillon', mise_en_avant: false, images: [] };
    let src = {};
    let commandes = [];
    if (!nouvel) {
      const r = await sb.from('offres').select('*').eq('id', id).maybeSingle();
      if (r.error) throw r.error;
      if (!r.data) { vue.innerHTML = '<div class="carte vide">Article introuvable.</div>'; return; }
      o = r.data;
      const [s, c] = await Promise.all([
        ctx.estSupport() ? sb.from('offres_sources').select('*, profils(nom_complet)').eq('offre_id', id).maybeSingle() : Promise.resolve({ data: null }),
        sb.from('demandes').select('id,statut,quantite,montant_devis,budget,created_at,profils(nom_complet,telephone)').eq('offre_id', id).order('created_at', { ascending: false })
      ]);
      src = s.data || {};
      commandes = c.data || [];
    }
    const min = await margeMin();
    const sel = (v, cur) => (String(v) === String(cur) ? ' selected' : '');

    vue.innerHTML = `
      <a class="retour" href="#/offres">← Disponible tout de suite</a>
      <div class="deux-colonnes"><div class="colonne">
      ${nouvel ? '' : `<div class="carte">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><h1>${esc(o.titre)}</h1>${pastille(o.statut)}</div>
        <p class="discret">Lien à partager : <a href="${esc(lienSite(o.id))}" target="_blank" rel="noopener">${esc(lienSite(o.id))}</a></p>
        <div class="boutons">
          <button type="button" class="btn btn-wa" id="partager-wa">Partager sur WhatsApp</button>
          <button type="button" class="btn btn-second" id="copier-texte">Copier le message</button>
        </div>
        <p class="aide">Message prêt pour le groupe clients ou votre statut : titre, prix, délai et lien de commande. Rien à réécrire.</p>
      </div>
      <div class="carte"><h2>Commandes (${commandes.length})</h2>
        ${commandes.length ? commandes.map((d) => `
          <a class="ligne" href="#/demande/${d.id}">
            <div style="flex:1;min-width:0"><div class="ligne-titre">${esc((d.profils && d.profils.nom_complet) || 'Client')}</div>
              <small>${d.quantite} pièce${d.quantite > 1 ? 's' : ''} · ${fcfa(d.montant_devis || d.budget)} · ${esc(date(d.created_at, true))}</small></div>
            ${badge(d.statut)}</a>`).join('') : '<p class="discret">Aucune commande pour le moment. Partagez l\'article pour lancer les ventes.</p>'}
      </div>`}
      ${ctx.estSupport() ? `<div class="carte carte-interne">
        <div class="interne-tete"><h2>🧮 Marge</h2><span class="badge-interne">Équipe seulement</span></div>
        <div id="zone-marge"></div>
      </div>` : ''}
      </div><div class="colonne">
      <form class="carte" id="form-o">
        <h2>${nouvel ? 'Nouvel article' : 'Modifier l\'article'}</h2>
        <label>Photos <small class="discret">(la première sert de couverture, touchez une photo pour la mettre en premier)</small></label>
        <div class="photos-edit" id="photos-edit"></div>
        <input id="img" type="file" accept="image/*" multiple hidden>
        <button type="button" class="btn btn-second" id="ajout-photos">📷 Ajouter des photos</button>
        <div class="aide">Prenez vos propres photos, sans logo, étiquette ni décor qui permettrait de reconnaître le fournisseur.</div>
        <label for="o-titre">Nom de l'article</label>
        <input id="o-titre" required minlength="2" maxlength="120" value="${esc(o.titre)}" placeholder="Ex. : Mixeur 2 vitesses 1,5 L">
        <label for="o-accroche">Accroche <small class="discret">(facultatif)</small></label>
        <input id="o-accroche" maxlength="140" value="${esc(o.accroche || '')}" placeholder="Ex. : Parfait pour vos jus et sauces, livré chez vous en 48 h">
        <label for="o-desc">Description</label>
        <textarea id="o-desc" rows="5" placeholder="Caractéristiques, dimensions, garantie, ce qui est inclus…">${esc(o.description || '')}</textarea>
        <div class="rangee">
          <div><label for="o-prix">Prix de vente (F CFA)</label><input id="o-prix" type="number" inputmode="numeric" min="1" required value="${esc(o.prix)}"></div>
          <div><label for="o-delai">Délai annoncé</label><select id="o-delai">${[24, 48, 72].map((h) => `<option value="${h}"${sel(h, o.delai_heures)}>Sous ${h} h</option>`).join('')}</select></div>
        </div>
        <div class="aide">Prix tout compris, hors livraison à domicile. Le délai doit être tenable avec ce fournisseur.</div>
        <label for="o-pref">Prix relevé ailleurs à Lomé (F, facultatif)</label>
        <input id="o-pref" type="number" inputmode="numeric" min="1" value="${esc(o.prix_reference || '')}" placeholder="Seulement un prix réellement relevé">
        <div class="aide">Affiché au client avec l'économie réalisée. Uniquement un prix que vous avez vraiment constaté (boutique, marché, page d'un vendeur), preuve à garder.</div>
        <label for="o-cat">Catégorie <small class="discret">(facultatif)</small></label>
        <input id="o-cat" maxlength="40" value="${esc(o.categorie || '')}" list="o-cats" placeholder="Électroménager, Maison, Beauté…">
        <datalist id="o-cats">${['Électroménager', 'Maison', 'Cuisine', 'Beauté', 'Téléphonie', 'Mode', 'Enfants'].map((c) => `<option value="${c}">`).join('')}</datalist>
        <div class="rangee">
          <div><label for="o-statut">Statut</label><select id="o-statut">${STATUTS.map(([k, l]) => `<option value="${k}"${sel(k, o.statut)}>${l}</option>`).join('')}</select></div>
          <div style="align-self:end"><label class="case-acceptation"><input type="checkbox" id="o-avant"${o.mise_en_avant ? ' checked' : ''}> Mettre en avant sur l'accueil</label></div>
        </div>
        <div class="aide">« En vente » : visible et commandable. « Épuisé » : visible mais plus commandable. « Archivé » : retiré du site.</div>
        ${ctx.estSupport() ? `<fieldset class="carte-interne fournisseur-interne">
          <legend>🔗 Fournisseur <span class="badge-interne">Équipe seulement</span></legend>
          <p class="discret" style="margin-top:0">À appeler à chaque commande, avant d'envoyer le coursier. Les clients ne voient jamais ces informations.</p>
          <div class="rangee">
            <div><label for="s-four">Grossiste / commerçant</label><input id="s-four" value="${esc(src.fournisseur || '')}" placeholder="Nom de la boutique ou du vendeur"></div>
            <div><label for="s-contact">Contact</label><input id="s-contact" value="${esc(src.contact || '')}" placeholder="Téléphone ou WhatsApp"></div>
          </div>
          <label for="s-adresse">Adresse / repère</label>
          <input id="s-adresse" value="${esc(src.adresse || '')}" placeholder="Ex. : Grand marché, allée des électroménagers">
          <div class="rangee">
            <div><label for="s-achat">Prix d'achat / pièce (F)</label><input id="s-achat" type="number" inputmode="numeric" min="0" value="${esc(src.prix_achat ?? '')}"></div>
            <div><label for="s-coursier">Coursier / pièce (F)</label><input id="s-coursier" type="number" inputmode="numeric" min="0" value="${esc(src.frais_coursier ?? '')}" placeholder="Récupération chez le fournisseur"></div>
          </div>
          <label for="s-note">Accord avec le fournisseur</label>
          <textarea id="s-note" rows="2" placeholder="Ex. : prix garanti jusqu'au 15/12, stock d'environ 20 pièces, il répond vite le matin…">${esc(src.note || '')}</textarea>
          ${src.maj_le ? `<p class="aide">Modifié le ${esc(date(src.maj_le, true))}${src.profils && src.profils.nom_complet ? ' par ' + esc(src.profils.nom_complet) : ''}.</p>` : ''}
        </fieldset>` : ''}
        <button class="btn btn-large" style="margin-top:16px">${nouvel ? 'Créer l\'article' : 'Enregistrer'}</button>
        ${!nouvel && !commandes.length ? '<button type="button" class="btn btn-lien btn-supprimer" id="supprimer-o">🗑 Supprimer l\'article</button>' : ''}
      </form>
      </div></div>`;

    // Marge en direct
    const majMarge = () => {
      const z = document.getElementById('zone-marge');
      if (!z) return;
      const prix = n(document.getElementById('o-prix').value);
      const achat = n(document.getElementById('s-achat').value);
      const coursier = n(document.getElementById('s-coursier').value) || 0;
      if (!prix || achat == null) { z.innerHTML = '<p class="discret" style="margin:0">Saisissez le prix de vente et le prix d\'achat pour voir la marge.</p>'; return; }
      const m = prix - achat - coursier;
      z.innerHTML = `<dl class="cle-valeur">
          <dt>Prix de vente</dt><dd>${fcfa(prix)}</dd>
          <dt>Prix d'achat</dt><dd>- ${fcfa(achat)}</dd>
          <dt>Coursier</dt><dd>- ${fcfa(coursier)}</dd>
          <dt><b>Marge nette / pièce</b></dt><dd><b>${fcfa(m)}</b> (${Math.round((100 * m) / prix)} %)</dd></dl>
        ${m < min ? `<div class="alerte alerte-ko" style="margin-top:8px">Sous la marge minimale de ${fcfa(min)}. Négociez le prix d'achat ou ne publiez pas cet article.</div>`
          : '<div class="alerte alerte-ok" style="margin-top:8px">Marge correcte.</div>'}`;
    };
    ['o-prix', 's-achat', 's-coursier'].forEach((k) => { const el = document.getElementById(k); if (el) el.addEventListener('input', majMarge); });
    majMarge();

    // Photos (même logique que les campagnes, même dossier de stockage public)
    const fichier = document.getElementById('img');
    let photos = (Array.isArray(o.images) && o.images.length ? o.images : (o.image_url ? [o.image_url] : [])).map((ch) => ({ chemin: ch, url: urlImageCampagne(ch) }));
    const dessinerPhotos = () => {
      const z = document.getElementById('photos-edit');
      z.innerHTML = photos.length ? photos.map((p, i) => `<div class="photo-edit${i === 0 ? ' couverture' : ''}" data-i="${i}">
          <img src="${esc(p.url)}" alt="">${i === 0 ? '<span class="photo-couv">Couverture</span>' : ''}
          <button type="button" class="photo-suppr" data-suppr="${i}" aria-label="Retirer la photo">✕</button></div>`).join('')
        : '<p class="discret" style="margin:0">Aucune photo pour l\'instant.</p>';
      z.querySelectorAll('[data-suppr]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); photos.splice(Number(b.dataset.suppr), 1); dessinerPhotos(); }));
      z.querySelectorAll('.photo-edit').forEach((el) => el.addEventListener('click', () => {
        const i = Number(el.dataset.i); if (!i) return;
        photos.unshift(photos.splice(i, 1)[0]); dessinerPhotos();
      }));
    };
    dessinerPhotos();
    document.getElementById('ajout-photos').addEventListener('click', () => fichier.click());
    fichier.addEventListener('change', async () => {
      const liste = [...fichier.files];
      fichier.value = '';
      for (let f of liste) {
        if (photos.length >= 8) { toast('8 photos au maximum'); break; }
        if (!(await window.IA.imageLisible(f))) {
          const j = window.IA.estHeic(f) ? await window.IA.convertirHeic(f).catch(() => null) : null;
          if (!j) { toast(`Photo illisible : ${f.name}. Enregistrez-la en JPG ou PNG, ou faites une capture d'écran.`, 'ko'); continue; }
          f = new File([j], (f.name || 'photo').replace(/\.(heic|heif)$/i, '') + '.jpg', { type: 'image/jpeg' });
        }
        photos.push({ fichier: f, url: URL.createObjectURL(f) });
      }
      dessinerPhotos();
    });

    // Partage
    const bWa = document.getElementById('partager-wa');
    if (bWa) bWa.addEventListener('click', () => {
      if (o.statut !== 'active' && !confirm('Cet article n\'est pas « En vente » : les clients ne pourront pas le commander. Partager quand même ?')) return;
      window.open('https://wa.me/?text=' + encodeURIComponent(texteWhatsApp(o)), '_blank', 'noopener');
    });
    const bCp = document.getElementById('copier-texte');
    if (bCp) bCp.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(texteWhatsApp(o)); toast('Message copié'); } catch { prompt('Copiez le message :', texteWhatsApp(o)); }
    });

    // Suppression (seulement sans commande)
    const bSup = document.getElementById('supprimer-o');
    if (bSup) bSup.addEventListener('click', () => {
      if (!confirm('Supprimer définitivement cet article ? (Pour le retirer du site sans le perdre, choisissez plutôt le statut « Archivé ».)')) return;
      occupe(bSup, async () => {
        const { error } = await sb.from('offres').delete().eq('id', o.id);
        if (error) { toast(msgErreur(error), 'ko'); return; }
        const chemins = (o.images || []).filter(Boolean);
        if (chemins.length) await sb.storage.from('campagnes').remove(chemins);
        toast('Article supprimé'); location.hash = '#/offres';
      });
    });

    // Enregistrement
    document.getElementById('form-o').addEventListener('submit', (ev) => {
      ev.preventDefault();
      occupe(ev.target.querySelector('button.btn-large'), async () => {
        const val = (k) => document.getElementById(k).value;
        const statut = val('o-statut');
        const prix = parseInt(val('o-prix'), 10);
        if (statut === 'active' && !photos.length) { toast('Ajoutez au moins une photo avant de mettre l\'article en vente', 'ko'); return; }
        if (ctx.estSupport() && statut === 'active') {
          const achat = n(val('s-achat'));
          const m = achat == null ? null : prix - achat - (n(val('s-coursier')) || 0);
          if (m == null && !confirm('Prix d\'achat non saisi : impossible de vérifier la marge. Mettre en vente quand même ?')) return;
          if (m != null && m < min && !confirm(`Marge de ${fcfa(m)} par pièce, sous le minimum de ${fcfa(min)}. Mettre en vente quand même ?`)) return;
        }
        const images = [];
        for (const [i, p] of photos.entries()) {
          if (p.chemin) { images.push(p.chemin); continue; }
          const blob = await compresserImage(p.fichier, 1400, 0.82);
          const type = blob.type || 'image/jpeg';
          const ext = { 'image/png': 'png', 'image/webp': 'webp' }[type] || 'jpg';
          const chemin = `offres/${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
          const up = await sb.storage.from('campagnes').upload(chemin, blob, { contentType: type });
          if (up.error) { toast('Photo ' + (i + 1) + ' non envoyée : ' + msgErreur(up.error), 'ko'); return; }
          p.chemin = chemin; images.push(chemin);
        }
        const ligne = {
          titre: val('o-titre').trim(), accroche: val('o-accroche').trim() || null, description: val('o-desc').trim() || null,
          categorie: val('o-cat').trim() || null, prix, prix_reference: n(val('o-pref')),
          delai_heures: Number(val('o-delai')), statut, mise_en_avant: document.getElementById('o-avant').checked,
          images, image_url: images[0] || null
        };
        const r = nouvel
          ? await sb.from('offres').insert({ ...ligne, groupeur_id: (ctx.etat.profil && ctx.etat.profil.groupeur_id) || (ctx.etat.groupeur && ctx.etat.groupeur.id) }).select('id').single()
          : await sb.from('offres').update(ligne).eq('id', o.id).select('id').single();
        if (r.error) { toast(msgErreur(r.error), 'ko'); return; }
        if (ctx.estSupport()) {
          const v2 = (k) => val(k).trim() || null;
          const fiche = { offre_id: r.data.id, fournisseur: v2('s-four'), contact: v2('s-contact'), adresse: v2('s-adresse'),
                          prix_achat: n(val('s-achat')), frais_coursier: n(val('s-coursier')), note: v2('s-note') };
          const { error: e } = await sb.from('offres_sources').upsert(fiche);
          if (e) { toast('Article enregistré, mais pas la fiche fournisseur : ' + msgErreur(e), 'ko'); }
        }
        // Photos retirées : on libère le stockage
        const retirees = (o.images || []).filter((ch) => ch && !images.includes(ch));
        if (retirees.length) await sb.storage.from('campagnes').remove(retirees);
        toast(nouvel ? 'Article créé' : 'Article enregistré');
        if (nouvel) location.hash = '#/offre/' + r.data.id; else ctx.router();
      });
    });
  }

  // ------------------------------------------------------------------
  // Encart dans une commande (demande liée à un article)
  // ------------------------------------------------------------------
  async function infosCommande(d) {
    const [{ data: o }, s, min] = await Promise.all([
      sb.from('offres').select('id,titre,prix,image_url,statut,delai_heures').eq('id', d.offre_id).maybeSingle(),
      ctx.estSupport() ? sb.from('offres_sources').select('*').eq('offre_id', d.offre_id).maybeSingle() : Promise.resolve({ data: null }),
      margeMin()
    ]);
    if (!o) return { html: '<div class="carte"><p class="discret">L\'article lié a été supprimé.</p></div>', brancher() {} };
    const src = s.data || {};
    const q = Number(d.quantite) || 1;
    const prixDevis = d.montant_devis ? Math.round(Number(d.montant_devis) / q) : o.prix;
    const m = marge(prixDevis, src);
    const tel = telDe(src.contact);
    const msgFour = `Bonjour, c'est Import Public. Avez-vous encore « ${o.titre} » en stock ? Il me faut ${q} pièce${q > 1 ? 's' : ''}, au prix convenu${src.prix_achat != null ? ' de ' + fcfa(src.prix_achat) + ' la pièce' : ''}. Merci !`;
    const html = `<div class="carte">
        <div style="display:flex;gap:12px;align-items:center">
          ${o.image_url ? `<img src="${esc(urlImageCampagne(o.image_url))}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:10px">` : ''}
          <div style="flex:1;min-width:0"><b>${esc(o.titre)}</b><br><small class="discret">Prix public ${fcfa(o.prix)} · délai annoncé ${o.delai_heures} h</small></div>
          ${pastille(o.statut)}</div>
        <a class="btn btn-second btn-petit" style="margin-top:10px" href="#/offre/${o.id}">Voir l'article</a>
      </div>
      ${ctx.estSupport() ? `<div class="carte carte-interne">
        <div class="interne-tete"><h2>📍 Fournisseur à Lomé</h2><span class="badge-interne">Équipe seulement</span></div>
        ${src.fournisseur || src.contact ? `<dl class="cle-valeur">
          ${src.fournisseur ? `<dt>Fournisseur</dt><dd>${esc(src.fournisseur)}</dd>` : ''}
          ${src.contact ? `<dt>Contact</dt><dd>${tel ? `<a href="tel:+${tel}">${esc(src.contact)}</a>` : esc(src.contact)}</dd>` : ''}
          ${src.adresse ? `<dt>Adresse</dt><dd>${esc(src.adresse)}</dd>` : ''}
          ${src.prix_achat != null ? `<dt>Prix d'achat</dt><dd>${fcfa(src.prix_achat)} / pièce</dd>` : ''}
          ${m != null ? `<dt>Marge nette</dt><dd><b>${fcfa(m)}</b> / pièce · <b>${fcfa(m * q)}</b> pour ${q}${m < min ? ' <span class="badge badge-ko">sous le minimum</span>' : ''}</dd>` : ''}
        </dl>
        ${src.note ? `<p class="discret" style="white-space:pre-line">${esc(src.note)}</p>` : ''}
        ${tel ? `<a class="btn btn-wa btn-petit" target="_blank" rel="noopener" href="${waLien(tel, msgFour)}">Vérifier le stock sur WhatsApp</a>` : ''}`
        : `<p class="discret">Aucune fiche fournisseur. <a href="#/offre/${o.id}">Ajoutez-la sur l'article</a>.</p>`}
        <ol class="etapes-paiement" style="margin-top:10px">
          <li><b>Confirmez le stock</b> avec le fournisseur, puis envoyez le devis.</li>
          <li><b>Après le paiement</b>, envoyez le coursier et cliquez « Article récupéré chez le fournisseur ».</li>
          <li><b>Remise</b> au point de retrait ou en livraison, avec le code du client.</li>
        </ol>
      </div>` : ''}`;
    return { html, brancher() {} };
  }

  return { vueOffres, vueOffre, infosCommande };
};
