// Import Public · espace équipe : produits à l'étude (de l'idée au lancement),
// suivi détaillé des opérations d'une campagne, coûts réels, gestion des utilisateurs.
window.IP_OPS = function (ctx) {
  const { sb, fcfa, date, esc, normTel, lib, badge, msgErreur, toast, occupe, compresserImage, urlImageCampagne } = window.IA;
  const { etat, vue } = ctx;
  const I = window.ICO;

  // ==================================================================
  // Produits à l'étude
  // ==================================================================
  const ETAPES_PISTE = [
    ['idee', 'Idée', 'Un produit repéré, à creuser.'],
    ['recherche', 'Recherche', 'Fournisseurs, prix, MOQ, photos, échantillons.'],
    ['analyse', 'Analyse', 'Demande à Lomé, concurrence, saison, risques.'],
    ['estimation', 'Estimation des coûts', 'Achat, transport, douane, frais : la marge tient-elle ?'],
    ['validee', 'Validée', 'Décision prise : prêt à lancer.'],
    ['lancee', 'Lancée', 'La campagne existe.']
  ];
  const MARGE_CIBLE = 1500;

  // Calcul du coût de revient et de la marge (tout en F CFA, par unité)
  function calculer(p) {
    const n = (x) => (x === '' || x == null || isNaN(Number(x)) ? 0 : Number(x));
    const taux = p.devise === 'XOF' ? 1 : n(p.taux_change);
    const achat = n(p.prix_fournisseur) * taux;
    const transport = p.mode_transport === 'maritime' ? n(p.volume_cbm) * n(p.cout_cbm) : n(p.poids_kg) * n(p.cout_kg);
    const douane = (achat + transport) * n(p.douane_pct);
    const quota = n(p.quota_prevu);
    const fixes = quota ? n(p.frais_fixes) / quota : n(p.frais_fixes);
    const autres = n(p.autres_frais_unite);
    const reseau = n(p.frais_reseau_unite);
    const revient = achat + transport + douane + fixes + autres + reseau;
    const vente = n(p.prix_vente);
    const marge = vente - revient;
    return {
      achat, transport, douane, fixes, autres, reseau, revient, vente, marge, quota,
      margePct: vente ? marge / vente : 0,
      margeTotale: marge * quota,
      investissement: (achat + transport + douane) * quota + n(p.frais_fixes),
      remiseMarche: n(p.prix_marche) && vente ? 1 - vente / n(p.prix_marche) : null,
      prixConseille: revient + MARGE_CIBLE,
      complet: !!(achat && vente && (transport || p.mode_transport === 'maritime' ? true : true))
    };
  }
  const tonMarge = (m) => (m >= MARGE_CIBLE ? 'ok' : m >= MARGE_CIBLE / 2 ? 'alerte' : 'ko');
  const pct = (x) => (x == null ? '—' : Math.round(x * 1000) / 10 + ' %');

  async function vuePistes(_, params) {
    const f = params.get('f') || 'en_cours';
    const { data, error } = await sb.from('pistes').select('*').order('updated_at', { ascending: false }).limit(300);
    if (error) throw error;
    const filtres = [['en_cours', 'En cours', (p) => !['lancee', 'abandonnee'].includes(p.statut)],
      ...ETAPES_PISTE.map(([k, l]) => [k, l, (p) => p.statut === k]), ['abandonnee', 'Abandonnées', (p) => p.statut === 'abandonnee']];
    const [, , test] = filtres.find((x) => x[0] === f) || filtres[0];
    const liste = data.filter(test);
    vue.innerHTML = `
      ${ongletsCampagnes('pistes')}
      <div class="titre-section" style="margin-top:0"><h1 style="margin:0">Produits à l'étude</h1>
        ${ctx.estFinance() ? `<a class="btn btn-petit" href="#/piste/nouvelle">${I.plus}Nouveau produit</a>` : ''}</div>
      <p class="discret">De l'idée au lancement : recherche, analyse, estimation des coûts, décision. Une campagne ne se lance qu'à partir d'une étude validée.</p>
      <div class="filtres">${filtres.map(([k, l, t]) => `<button class="${k === f ? 'actif' : ''}" data-f="${k}">${l} (${data.filter(t).length})</button>`).join('')}</div>
      ${liste.length ? `<div class="grille-pistes">${liste.map(cartePiste).join('')}</div>`
        : `<div class="carte vide"><p><b>Rien ici.</b></p>${ctx.estFinance() ? '<a class="btn" href="#/piste/nouvelle">Étudier un nouveau produit</a>' : ''}</div>`}`;
    vue.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/pistes?f=' + b.dataset.f; }));
  }

  function cartePiste(p) {
    const c = calculer(p);
    const i = ETAPES_PISTE.findIndex(([k]) => k === p.statut);
    return `<a class="carte carte-piste" href="#/piste/${p.id}">
      <div class="piste-tete">
        ${p.photo_url ? `<span class="piste-vignette" style="background-image:url('${esc(urlImageCampagne(p.photo_url))}')"></span>` : `<span class="piste-vignette vide">${I.loupe}</span>`}
        <div style="flex:1;min-width:0"><b class="ligne-titre">${esc(p.titre)}</b><small>${esc(p.categorie || '')}${p.categorie ? ' · ' : ''}modifié le ${date(p.updated_at)}</small></div>
        ${badge(p.statut)}
      </div>
      ${p.statut !== 'abandonnee' ? `<div class="piste-progression">${ETAPES_PISTE.map((_, j) => `<span class="${j <= i ? 'fait' : ''}"></span>`).join('')}</div>` : ''}
      <div class="piste-chiffres">
        <div><small>Prix de vente</small><b>${c.vente ? fcfa(Math.round(c.vente)) : '—'}</b></div>
        <div><small>Coût de revient</small><b>${c.achat ? fcfa(Math.round(c.revient)) : '—'}</b></div>
        <div><small>Marge / unité</small><b class="marge-${c.vente && c.achat ? tonMarge(c.marge) : 'neutre'}">${c.vente && c.achat ? fcfa(Math.round(c.marge)) : '—'}</b></div>
      </div></a>`;
  }

  async function vuePiste(id) {
    const nouvelle = id === 'nouvelle';
    let p = { titre: '', devise: 'CNY', taux_change: 85, mode_transport: 'aerien', douane_pct: 0, frais_fixes: 0, autres_frais_unite: 0,
              frais_reseau_unite: 60, statut: 'idee' };
    let historique = [];
    if (!nouvelle) {
      const [r, h] = await Promise.all([sb.from('pistes').select('*').eq('id', id).maybeSingle(),
        sb.from('historique_pistes').select('statut,cree_le').eq('piste_id', id).order('cree_le')]);
      if (r.error) throw r.error;
      if (!r.data) { vue.innerHTML = '<div class="carte vide">Produit introuvable.</div>'; return; }
      p = r.data; historique = h.data || [];
    }
    const lectureSeule = !ctx.estFinance() || ['lancee'].includes(p.statut);
    const ro = lectureSeule ? 'disabled' : '';
    const v = (k) => esc(p[k] == null ? '' : p[k]);
    const i = ETAPES_PISTE.findIndex(([k]) => k === p.statut);
    const suivant = i >= 0 && i < 4 ? ETAPES_PISTE[i + 1] : null;
    const dates = {}; historique.forEach((h) => { if (!dates[h.statut]) dates[h.statut] = h.cree_le; });

    vue.innerHTML = `
      <a class="retour" href="#/pistes">← Produits à l'étude</a>
      <div class="deux-colonnes"><div class="colonne">
      <form class="carte" id="form-piste">
        <div style="display:flex;justify-content:space-between;gap:10px"><h1>${nouvelle ? 'Nouveau produit à étudier' : esc(p.titre)}</h1>${nouvelle ? '' : badge(p.statut)}</div>

        <h2 class="sous-titre-form">1. Le produit</h2>
        <label for="pi-titre">Nom du produit</label><input id="pi-titre" required value="${v('titre')}" ${ro} placeholder="Ex. : Montre connectée T800 Ultra">
        <div class="rangee"><div><label for="pi-cat">Catégorie</label><input id="pi-cat" value="${v('categorie')}" ${ro} placeholder="Ex. : Électronique"></div>
          <div><label for="pi-moq">MOQ fournisseur</label><input id="pi-moq" type="number" min="1" value="${v('moq')}" ${ro}></div></div>
        <label for="pi-photo">Photo</label>
        <img class="photo-apercu" id="pi-apercu" ${p.photo_url ? `src="${esc(urlImageCampagne(p.photo_url))}"` : 'hidden'} alt="">
        ${lectureSeule ? '' : '<input id="pi-photo" type="file" accept="image/*">'}

        <h2 class="sous-titre-form">2. Recherche fournisseur</h2>
        <label for="pi-fourn">Fournisseur retenu</label><input id="pi-fourn" value="${v('fournisseur')}" ${ro} placeholder="Nom, ville, contact">
        <label for="pi-liens">Liens (un par ligne)</label><textarea id="pi-liens" rows="3" ${ro} placeholder="https://www.alibaba.com/…">${v('liens')}</textarea>
        ${p.liens ? `<div class="liens-piste">${p.liens.split('\n').filter((l) => /^https?:\/\//.test(l.trim())).map((l, k) =>
          `<a href="${esc(l.trim())}" target="_blank" rel="noopener">Lien ${k + 1}</a>`).join('')}</div>` : ''}

        <h2 class="sous-titre-form">3. Coût d'achat (par unité)</h2>
        <div class="rangee"><div><label for="pi-prix-f">Prix fournisseur</label><input id="pi-prix-f" class="calc" type="number" step="any" min="0" value="${v('prix_fournisseur')}" ${ro}></div>
          <div><label for="pi-devise">Devise</label><select id="pi-devise" class="calc" ${ro}>${['CNY', 'USD', 'XOF'].map((d) => `<option ${p.devise === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div></div>
        <label for="pi-taux">Taux de change (F CFA pour 1 ${esc(p.devise)})</label><input id="pi-taux" class="calc" type="number" step="any" min="0" value="${v('taux_change')}" ${ro}>
        <div class="aide">À vérifier le jour de l'achat (ou le taux de votre agent de paiement).</div>

        <h2 class="sous-titre-form">4. Transport (par unité)</h2>
        <label for="pi-mode">Mode</label><select id="pi-mode" class="calc" ${ro}><option value="aerien" ${p.mode_transport === 'aerien' ? 'selected' : ''}>Aérien (au kg)</option>
          <option value="maritime" ${p.mode_transport === 'maritime' ? 'selected' : ''}>Maritime (au m³)</option></select>
        <div class="rangee" id="bloc-aerien"><div><label for="pi-kg">Poids par unité (kg)</label><input id="pi-kg" class="calc" type="number" step="any" min="0" value="${v('poids_kg')}" ${ro}></div>
          <div><label for="pi-cout-kg">Tarif transitaire (F/kg)</label><input id="pi-cout-kg" class="calc" type="number" step="any" min="0" value="${v('cout_kg')}" ${ro}></div></div>
        <div class="rangee" id="bloc-maritime"><div><label for="pi-cbm">Volume par unité (m³)</label><input id="pi-cbm" class="calc" type="number" step="any" min="0" value="${v('volume_cbm')}" ${ro}></div>
          <div><label for="pi-cout-cbm">Tarif transitaire (F/m³)</label><input id="pi-cout-cbm" class="calc" type="number" step="any" min="0" value="${v('cout_cbm')}" ${ro}></div></div>

        <h2 class="sous-titre-form">5. Frais</h2>
        <div class="rangee"><div><label for="pi-douane">Douane et taxes (%)</label><input id="pi-douane" class="calc" type="number" step="any" min="0" value="${p.douane_pct ? Math.round(Number(p.douane_pct) * 1000) / 10 : ''}" ${ro} placeholder="Ex. : 20"></div>
          <div><label for="pi-fixes">Frais fixes de la campagne (F)</label><input id="pi-fixes" class="calc" type="number" step="any" min="0" value="${v('frais_fixes')}" ${ro}></div></div>
        <div class="aide">Frais fixes : inspection, transfert d'argent, emballage, livraison à l'entrepôt… Répartis sur le quota.</div>
        <div class="rangee"><div><label for="pi-autres">Autres frais par unité (F)</label><input id="pi-autres" class="calc" type="number" step="any" min="0" value="${v('autres_frais_unite')}" ${ro}></div>
          <div><label for="pi-reseau">Commissions et points de retrait par unité (F)</label><input id="pi-reseau" class="calc" type="number" step="any" min="0" value="${v('frais_reseau_unite')}" ${ro}></div></div>

        <h2 class="sous-titre-form">6. Vente</h2>
        <div class="rangee"><div><label for="pi-vente">Prix de vente prévu (F)</label><input id="pi-vente" class="calc" type="number" step="any" min="0" value="${v('prix_vente')}" ${ro}></div>
          <div><label for="pi-marche">Prix constaté à Lomé (F)</label><input id="pi-marche" class="calc" type="number" step="any" min="0" value="${v('prix_marche')}" ${ro}></div></div>
        <label for="pi-quota">Quota prévu (unités)</label><input id="pi-quota" class="calc" type="number" min="1" value="${v('quota_prevu')}" ${ro}>

        <h2 class="sous-titre-form">7. Analyse et décision</h2>
        <label for="pi-etude">Analyse</label><textarea id="pi-etude" rows="5" ${ro} placeholder="Demande à Lomé, concurrence et prix pratiqués, saison, risques (casse, contrefaçon, douane), avis de clients test…">${v('etude')}</textarea>
        <label for="pi-decision">Décision et justification</label><textarea id="pi-decision" rows="3" ${ro}>${v('decision')}</textarea>
        ${lectureSeule ? '' : `<button class="btn btn-large" style="margin-top:16px">${nouvelle ? 'Créer la fiche' : 'Enregistrer'}</button>`}
      </form>
      </div><div class="colonne colonne-collante">
        <div class="carte" id="calcul"></div>
        ${nouvelle ? '' : `<div class="carte"><h2>Étapes</h2>
          <ol class="frise">${ETAPES_PISTE.map(([k, l, d], j) => `<li class="${p.statut === 'abandonnee' ? 'avenir' : j < i ? 'fait' : j === i ? 'courant' : 'avenir'}"><span class="pastille"></span>
            <div><b>${l}</b><small>${dates[k] ? date(dates[k], true) : esc(d)}</small></div></li>`).join('')}</ol>
          ${ctx.estFinance() ? `<div class="boutons">
            ${suivant ? `<button class="btn" id="etape-suivante" data-s="${suivant[0]}">Passer à : ${esc(suivant[1])}</button>` : ''}
            ${p.statut === 'validee' ? `<div style="width:100%"><label for="pi-cloture">Clôture des commandes</label>
                <input id="pi-cloture" type="datetime-local" value="${new Date(Date.now() + 7 * 864e5 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16)}">
                <button class="btn btn-ok btn-large" id="lancer" style="margin-top:8px">${I.fusee}Lancer la campagne</button>
                <p class="aide">Crée la campagne en brouillon avec le prix, le prix barré, le quota et le transport de l'étude. Vous la relisez puis la publiez.</p></div>` : ''}
            ${p.statut === 'abandonnee' ? '<button class="btn btn-second" id="reprendre">Reprendre l\'étude</button>'
              : !['lancee'].includes(p.statut) ? '<button class="btn btn-ko" id="abandonner">Abandonner</button>' : ''}
            ${p.campagne_id ? `<a class="btn btn-second" href="#/campagne/${p.campagne_id}">Voir la campagne</a>` : ''}
          </div>` : ''}</div>`}
      </div></div>`;

    const val = (x) => { const el = document.getElementById(x); return el ? el.value : ''; };
    const lireForm = () => ({
      titre: val('pi-titre').trim(), categorie: val('pi-cat').trim() || null, moq: val('pi-moq') ? parseInt(val('pi-moq'), 10) : null,
      fournisseur: val('pi-fourn').trim() || null, liens: val('pi-liens').trim() || null,
      prix_fournisseur: val('pi-prix-f') === '' ? null : Number(val('pi-prix-f')), devise: val('pi-devise'),
      taux_change: val('pi-taux') === '' ? null : Number(val('pi-taux')), mode_transport: val('pi-mode'),
      poids_kg: val('pi-kg') === '' ? null : Number(val('pi-kg')), cout_kg: val('pi-cout-kg') === '' ? null : Number(val('pi-cout-kg')),
      volume_cbm: val('pi-cbm') === '' ? null : Number(val('pi-cbm')), cout_cbm: val('pi-cout-cbm') === '' ? null : Number(val('pi-cout-cbm')),
      douane_pct: val('pi-douane') === '' ? 0 : Number(val('pi-douane')) / 100, frais_fixes: Number(val('pi-fixes') || 0),
      autres_frais_unite: Number(val('pi-autres') || 0), frais_reseau_unite: Number(val('pi-reseau') || 0),
      prix_vente: val('pi-vente') === '' ? null : Number(val('pi-vente')), prix_marche: val('pi-marche') === '' ? null : Number(val('pi-marche')),
      quota_prevu: val('pi-quota') ? parseInt(val('pi-quota'), 10) : null,
      etude: val('pi-etude').trim() || null, decision: val('pi-decision').trim() || null
    });

    const majCalcul = () => {
      const f = lireForm();
      document.getElementById('bloc-aerien').hidden = f.mode_transport !== 'aerien';
      document.getElementById('bloc-maritime').hidden = f.mode_transport !== 'maritime';
      const c = calculer(f);
      const ligne = (l, x, gras) => `<tr${gras ? ' class="total-ligne"' : ''}><td>${l}</td><td>${fcfa(Math.round(x))}</td></tr>`;
      document.getElementById('calcul').innerHTML = `
        <h2>Calcul de la marge</h2>
        <div class="marge-principale marge-fond-${c.vente && c.achat ? tonMarge(c.marge) : 'neutre'}">
          <small>Marge par unité</small><b>${c.vente && c.achat ? fcfa(Math.round(c.marge)) : '—'}</b>
          <span>${c.vente && c.achat ? pct(c.margePct) + ' du prix de vente · objectif ' + fcfa(MARGE_CIBLE) : 'Renseignez au moins le prix fournisseur et le prix de vente'}</span>
        </div>
        <table class="tableau-calcul"><tbody>
          ${ligne('Achat', c.achat)}${ligne('Transport', c.transport)}${ligne('Douane et taxes', c.douane)}
          ${ligne('Frais fixes répartis', c.fixes)}${ligne('Autres frais', c.autres)}${ligne('Commissions et points', c.reseau)}
          ${ligne('Coût de revient', c.revient, true)}${ligne('Prix de vente', c.vente)}
        </tbody></table>
        <dl class="cle-valeur">
          <dt>Prix conseillé (marge ${fcfa(MARGE_CIBLE)})</dt><dd><b>${c.achat ? fcfa(Math.ceil(c.prixConseille / 100) * 100) : '—'}</b></dd>
          <dt>Économie pour le client</dt><dd>${c.remiseMarche == null ? '—' : c.remiseMarche > 0 ? pct(c.remiseMarche) + ' moins cher qu\'à Lomé' : '<span class="motif">Plus cher qu\'à Lomé</span>'}</dd>
          <dt>Marge totale au quota</dt><dd><b>${c.quota ? fcfa(Math.round(c.margeTotale)) : '—'}</b></dd>
          <dt>Argent à avancer</dt><dd>${c.quota ? fcfa(Math.round(c.investissement)) : '—'}</dd>
          ${f.moq && c.quota && c.quota < f.moq ? `<dt>Attention</dt><dd class="motif">Quota inférieur au MOQ (${f.moq})</dd>` : ''}
        </dl>`;
    };
    vue.querySelectorAll('.calc').forEach((el) => el.addEventListener('input', majCalcul));
    majCalcul();

    const photo = document.getElementById('pi-photo');
    if (photo) photo.addEventListener('change', () => {
      const a = document.getElementById('pi-apercu');
      if (photo.files[0]) { a.src = URL.createObjectURL(photo.files[0]); a.hidden = false; }
    });
    const enregistrer = async (extra) => {
      const ligne = Object.assign(lireForm(), extra || {});
      if (photo && photo.files[0]) {
        const blob = await compresserImage(photo.files[0], 1400, 0.82);
        const chemin = `pistes/${Date.now()}.jpg`;
        const up = await sb.storage.from('campagnes').upload(chemin, blob, { contentType: 'image/jpeg' });
        if (up.error) { toast(msgErreur(up.error), 'ko'); return null; }
        ligne.photo_url = chemin;
      }
      const r = nouvelle ? await sb.from('pistes').insert(ligne).select('id').single()
        : await sb.from('pistes').update(ligne).eq('id', p.id).select('id').single();
      if (r.error) { toast(msgErreur(r.error), 'ko'); return null; }
      return r.data.id;
    };
    const form = document.getElementById('form-piste');
    if (!lectureSeule) form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      occupe(form.querySelector('button:not([type=button])'), async () => {
        const nid = await enregistrer();
        if (!nid) return;
        toast('Enregistré');
        if (nouvelle) location.hash = '#/piste/' + nid; else ctx.router();
      });
    });
    const changerStatut = (s, msg) => (ev) => occupe(ev.currentTarget, async () => {
      if (!form.reportValidity()) return;
      const nid = await enregistrer({ statut: s });
      if (nid) { toast(msg); ctx.router(); }
    });
    const bs = document.getElementById('etape-suivante');
    if (bs) bs.addEventListener('click', changerStatut(bs.dataset.s, 'Étape suivante'));
    const ab = document.getElementById('abandonner');
    if (ab) ab.addEventListener('click', (ev) => {
      if (!confirm('Abandonner l\'étude de ce produit ? Notez la raison dans « Décision » avant.')) return;
      changerStatut('abandonnee', 'Étude abandonnée')(ev);
    });
    const rp = document.getElementById('reprendre');
    if (rp) rp.addEventListener('click', changerStatut('analyse', 'Étude reprise'));
    const la = document.getElementById('lancer');
    if (la) la.addEventListener('click', (ev) => occupe(ev.currentTarget, async () => {
      if (!(await enregistrer())) return;
      const { data: cid, error } = await sb.rpc('lancer_piste', { p_piste: p.id, p_cloture: new Date(val('pi-cloture')).toISOString() });
      if (error) { toast(msgErreur(error), 'ko'); return; }
      toast('Campagne créée en brouillon : relisez-la puis publiez');
      location.hash = '#/campagne/' + cid;
    }));
  }

  const ongletsCampagnes = (actif) => `<div class="filtres onglets-campagnes">
      <a class="${actif === 'pistes' ? 'actif' : ''}" href="#/pistes">${I.loupe}Produits à l'étude</a>
      <a class="${actif === 'campagnes' ? 'actif' : ''}" href="#/campagnes">${I.colis}Campagnes</a></div>`;

  // ==================================================================
  // Campagne : suivi détaillé des opérations + coûts réels
  // ==================================================================
  const OPERATIONS = [
    ['fournisseur_paye', 'Fournisseur payé', 'commandee'],
    ['production', 'Production / préparation chez le fournisseur', 'commandee'],
    ['expedie_entrepot', 'Expédié vers notre entrepôt en Chine', 'commandee'],
    ['recu_entrepot', 'Reçu et contrôlé à l\'entrepôt (quantités, état)', 'entrepot_chine'],
    ['consolide', 'Remis au transitaire, consolidé', 'entrepot_chine'],
    ['depart', 'Départ (vol ou navire)', 'en_transit'],
    ['arrive_port', 'Arrivé à l\'aéroport / au port de Lomé', 'en_transit'],
    ['dedouanement', 'Dédouanement terminé', 'en_transit'],
    ['retire', 'Retiré, à notre entrepôt de Lomé', 'arrivee'],
    ['distribue', 'Colis répartis vers les points de retrait', 'arrivee']
  ];
  const CATEGORIES_COUTS = ['fournisseur', 'transport', 'douane', 'local', 'autre'];

  async function sectionsCampagne(c, payees) {
    if (['brouillon', 'ouverte', 'echec_quota'].includes(c.statut) && !ctx.estFinance()) return { html: '', brancher() {} };
    const [ops, couts, piste] = await Promise.all([
      sb.from('operations_campagne').select('*').eq('campagne_id', c.id),
      ctx.estFinance() ? sb.from('couts_campagne').select('*').eq('campagne_id', c.id).order('paye_le') : Promise.resolve({ data: [] }),
      sb.from('pistes').select('*').eq('campagne_id', c.id).maybeSingle()
    ]);
    const faites = Object.fromEntries((ops.data || []).map((o) => [o.etape, o]));
    const encaisse = payees.reduce((s, o) => s + Number(o.montant_total), 0);
    const totalCouts = (couts.data || []).reduce((s, x) => s + Number(x.montant), 0);
    const unites = payees.reduce((s, o) => s + Number(o.quantite), 0);
    const estim = piste.data ? calculer(piste.data) : null;
    const actif = !['brouillon', 'ouverte', 'echec_quota'].includes(c.statut);

    const html = `
      ${actif ? `<div class="carte"><h2>Suivi des opérations</h2>
        <p class="discret">Étapes internes, plus fines que celles vues par les clients. Cochez au fur et à mesure ; la date est enregistrée.</p>
        <div class="checklist-ops">${OPERATIONS.map(([k, l, etapeClient]) => {
          const o = faites[k];
          return `<div class="op${o ? ' faite' : ''}">
            <button type="button" class="op-case" data-op="${k}" aria-pressed="${o ? 'true' : 'false'}" aria-label="${esc(l)}">${o ? I.coche : ''}</button>
            <div style="flex:1;min-width:0"><b>${esc(l)}</b>
              <small>${o ? 'Fait le ' + date(o.fait_le, true) + (o.note ? ' · ' + esc(o.note) : '') : 'Étape client : ' + esc(lib(etapeClient))}</small></div></div>`;
        }).join('')}</div></div>` : ''}
      ${ctx.estFinance() ? `<div class="carte"><h2>Coûts réels et marge</h2>
        <table class="tableau-calcul"><tbody>
          <tr><td>Encaissé (${unites} unité${unites > 1 ? 's' : ''} payée${unites > 1 ? 's' : ''})</td><td><b>${fcfa(encaisse)}</b></td></tr>
          <tr><td>Coûts payés</td><td><b>${fcfa(totalCouts)}</b></td></tr>
          <tr class="total-ligne"><td>Marge réelle</td><td><span class="marge-${totalCouts ? tonMarge(unites ? (encaisse - totalCouts) / unites : 0) : 'neutre'}">${totalCouts ? fcfa(encaisse - totalCouts) : '—'}</span></td></tr>
          ${totalCouts && unites ? `<tr><td>Marge réelle par unité</td><td>${fcfa(Math.round((encaisse - totalCouts) / unites))}</td></tr>` : ''}
          ${estim ? `<tr><td>Marge estimée par unité (<a href="#/piste/${piste.data.id}">étude</a>)</td><td>${fcfa(Math.round(estim.marge))}</td></tr>` : ''}
        </tbody></table>
        <div class="grille-lignes">${(couts.data || []).map((x) => `<div class="ligne"><div style="flex:1;min-width:0">
            <div class="ligne-titre">${esc(x.libelle)}</div><small>${esc(lib(x.categorie))} · ${date(x.paye_le)}</small></div>
            <span class="montant-ligne">${fcfa(x.montant)}</span><button class="btn btn-second btn-petit" data-suppr-cout="${x.id}" aria-label="Supprimer">✕</button></div>`).join('')}</div>
        <form id="form-cout" class="form-cout">
          <div class="rangee"><div><label for="ct-cat">Catégorie</label><select id="ct-cat">${CATEGORIES_COUTS.map((k) => `<option value="${k}">${esc(lib(k))}</option>`).join('')}</select></div>
            <div><label for="ct-montant">Montant (F)</label><input id="ct-montant" type="number" min="0" required></div></div>
          <label for="ct-lib">Libellé</label><input id="ct-lib" required placeholder="Ex. : Paiement fournisseur via agent, transitaire aérien 42 kg…">
          <button class="btn btn-second" style="margin-top:10px">Ajouter le coût</button>
        </form></div>` : ''}`;

    return {
      html,
      brancher() {
        vue.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', () => {
          const k = b.dataset.op;
          if (faites[k]) {
            if (!confirm('Décocher cette étape ?')) return;
            occupe(b, async () => {
              const { error } = await sb.from('operations_campagne').delete().eq('campagne_id', c.id).eq('etape', k);
              if (error) toast(msgErreur(error), 'ko'); else ctx.router();
            });
          } else {
            const note = prompt('Note (facultatif) : n° de suivi, poids, remarque…');
            if (note === null) return;
            occupe(b, async () => {
              const { error } = await sb.from('operations_campagne').insert({ campagne_id: c.id, etape: k, note: note.trim() || null });
              if (error) toast(msgErreur(error), 'ko'); else { toast('Étape cochée'); ctx.router(); }
            });
          }
        }));
        const fc = document.getElementById('form-cout');
        if (fc) fc.addEventListener('submit', (ev) => {
          ev.preventDefault();
          occupe(fc.querySelector('button'), async () => {
            const { error } = await sb.from('couts_campagne').insert({ campagne_id: c.id, categorie: val2('ct-cat'),
              libelle: val2('ct-lib').trim(), montant: parseInt(val2('ct-montant'), 10) });
            if (error) toast(msgErreur(error), 'ko'); else { toast('Coût ajouté'); ctx.router(); }
          });
        });
        vue.querySelectorAll('[data-suppr-cout]').forEach((b) => b.addEventListener('click', () => {
          if (!confirm('Supprimer ce coût ?')) return;
          occupe(b, async () => {
            const { error } = await sb.from('couts_campagne').delete().eq('id', b.dataset.supprCout);
            if (error) toast(msgErreur(error), 'ko'); else ctx.router();
          });
        }));
      }
    };
  }
  const val2 = (x) => document.getElementById(x).value;

  // ==================================================================
  // Utilisateurs (admin) : tous les comptes, attribution des rôles
  // ==================================================================
  const ROLES = [['client', 'Client'], ['assistant', 'Assistant'], ['representant', 'Représentant'], ['partenaire', 'Point de retrait'], ['admin', 'Admin']];

  async function vueUtilisateurs(_, params) {
    const q = (params.get('q') || '').trim();
    const f = params.get('f') || 'tous';
    let req = sb.from('profils').select('id,nom_complet,email,telephone,role,region,reference,created_at').order('created_at', { ascending: false }).limit(200);
    if (f === 'equipe') req = req.in('role', ['admin', 'assistant', 'representant', 'groupeur']);
    if (f === 'partenaires') req = req.eq('role', 'partenaire');
    if (f === 'clients') req = req.eq('role', 'client');
    if (q) {
      const s = q.replace(/[%,()]/g, ' ').trim();
      req = req.or(`nom_complet.ilike.%${s}%,email.ilike.%${s}%,telephone.ilike.%${s}%,reference.ilike.%${s}%`);
    }
    const [{ data, error }, { data: acs }, { count: total }] = await Promise.all([req,
      sb.from('ambassadeurs').select('id,code,statut'),
      sb.from('profils').select('id', { count: 'exact', head: true })]);
    if (error) throw error;
    const ac = Object.fromEntries((acs || []).map((a) => [a.id, a]));
    let liste = data;
    if (f === 'ambassadeurs') liste = data.filter((u) => ac[u.id]);

    vue.innerHTML = `
      <a class="retour" href="#/reglages">← Réglages</a>
      <h1>Utilisateurs <small class="discret">${total || 0} compte(s)</small></h1>
      <form class="carte" id="form-recherche-u">
        <div class="lien-copie"><input id="q-u" value="${esc(q)}" placeholder="Nom, email, numéro ou référence client" aria-label="Rechercher un utilisateur">
          <button class="btn btn-petit">${I.loupe}Chercher</button></div>
      </form>
      <div class="filtres">${[['tous', 'Tous'], ['equipe', 'Équipe'], ['ambassadeurs', 'Ambassadeurs'], ['partenaires', 'Points de retrait'], ['clients', 'Clients']].map(([k, l]) =>
        `<button class="${k === f ? 'actif' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
      <div class="carte grille-lignes">${liste.length ? liste.map((u) => `
        <div class="ligne">
          <div style="flex:1;min-width:0"><div class="ligne-titre">${esc(u.nom_complet || 'Sans nom')} <small class="discret">${esc(u.reference || '')}</small></div>
            <small>${esc(u.email || '')}${u.telephone ? ' · ' + esc(u.telephone) : ''}${u.region ? ' · ' + esc(u.region) : ''} · inscrit le ${date(u.created_at)}</small>
            ${ac[u.id] ? `<small>Ambassadeur ${esc(ac[u.id].code)} · ${esc(lib(ac[u.id].statut))}</small>` : ''}</div>
          <div class="actions-ligne">
            ${u.id === etat.profil.id ? badge(u.role)
              : `<select class="choix-role" data-profil="${u.id}" aria-label="Rôle de ${esc(u.nom_complet || u.email)}">${ROLES.map(([k, l]) =>
                  `<option value="${k}"${(u.role === k || (k === 'assistant' && u.role === 'groupeur')) ? ' selected' : ''}>${l}</option>`).join('')}</select>`}
          </div></div>`).join('') : '<p class="discret">Aucun compte trouvé.</p>'}</div>
      <details class="roles-aide" open><summary>Qui voit quoi ?</summary>
        <ul><li><b>Client</b> : le site client uniquement. Il peut devenir <b>Ambassadeur</b> lui-même depuis son compte (vous pouvez le suspendre dans Réseau).</li>
        <li><b>Assistant</b> : accueil, paiements, campagnes et produits à l'étude, sur mesure, colis, réseau.</li>
        <li><b>Représentant</b> : accueil, campagnes, sur mesure, colis. Pas les paiements ni les coûts.</li>
        <li><b>Point de retrait</b> : l'onglet Colis de son point uniquement (à rattacher dans Réseau > Points de retrait).</li>
        <li><b>Admin</b> : tout, y compris ces réglages.</li></ul></details>`;

    document.getElementById('form-recherche-u').addEventListener('submit', (ev) => {
      ev.preventDefault();
      location.hash = '#/utilisateurs?' + new URLSearchParams({ q: document.getElementById('q-u').value.trim(), f });
    });
    vue.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
      location.hash = '#/utilisateurs?' + new URLSearchParams({ q, f: b.dataset.f });
    }));
    vue.querySelectorAll('.choix-role').forEach((sel) => {
      const avant = sel.value;
      sel.addEventListener('change', async () => {
        const libelle = sel.options[sel.selectedIndex].text;
        if (!confirm(`Donner le rôle « ${libelle} » à ce compte ?`)) { sel.value = avant; return; }
        const { error } = await sb.rpc('definir_role', { p_profil: sel.dataset.profil, p_role: sel.value });
        if (error) { toast(msgErreur(error), 'ko'); sel.value = avant; return; }
        toast('Rôle mis à jour');
      });
    });
  }

  return { vuePistes, vuePiste, vueUtilisateurs, sectionsCampagne, ongletsCampagnes };
};
