// Import Public : espace équipe (back-office)
(function () {
  const { sb, cfg, fcfa, date, joursRestants, esc, normTel, waLien, lib, badge, jauge, msgErreur, toast, nomPays,
          compresserImage, urlImageCampagne, occupe, txtVariante } = window.IA;

  const vue = document.getElementById('vue');
  const etat = { session: null, profil: null, groupeur: null };

  // Ordre de la chaîne logistique d'une campagne
  const SUITE_CAMPAGNE = ['brouillon', 'ouverte', 'quota_atteint', 'commandee', 'entrepot_chine', 'en_transit', 'arrivee', 'terminee'];
  const SUITE_DEMANDE = ['payee', 'commandee', 'entrepot_chine', 'en_transit', 'arrivee', 'livree'];
  const ACTION = {
    ouverte: 'Publier la campagne', quota_atteint: 'Marquer quota atteint', commandee: 'Commandé au fournisseur',
    entrepot_chine: 'Reçu à l\'entrepôt Chine', en_transit: 'Chargé, en route', arrivee: 'Arrivé à Lomé', terminee: 'Terminer la campagne',
    livree: 'Livré au client'
  };
  // Messages WhatsApp proposés à chaque étape
  const MSG = {
    quota_atteint: (t) => `Bonne nouvelle : la campagne « ${t} » a atteint son quota. Nous passons la commande.`,
    commandee: (t) => `Votre commande « ${t} » a été passée au fournisseur.`,
    entrepot_chine: (t) => `Votre colis « ${t} » est arrivé à notre entrepôt en Chine.`,
    en_transit: (t) => `Votre colis « ${t} » est chargé et en route vers Lomé.`,
    arrivee: (t) => `Votre colis « ${t} » est arrivé à Lomé. Il est prêt au retrait.`,
    livree: (t) => `Votre colis « ${t} » vous a été remis. Merci de votre confiance !`,
    echec_quota: (t) => `La campagne « ${t} » n'a pas atteint son quota. Nous vous remboursons sous peu.`
  };

  async function demarrer() {
    const { data } = await sb.auth.getSession();
    etat.session = data.session;
    await chargerProfil();
    sb.auth.onAuthStateChange((evt, session) => {
      if (evt === 'SIGNED_IN' || evt === 'SIGNED_OUT') { etat.session = session; setTimeout(async () => { await chargerProfil(); router(); }, 0); }
    });
    window.addEventListener('hashchange', router);
    router();
  }

  async function chargerProfil() {
    etat.profil = null;
    if (etat.session) {
      const { data } = await sb.from('profils').select('*').eq('id', etat.session.user.id).maybeSingle();
      etat.profil = data;
    }
    const g = await sb.from('groupeurs').select('*').order('created_at').limit(1).maybeSingle();
    etat.groupeur = g.data;
    etat.niveauData = null;
    if (etat.session) {
      const n = await sb.rpc('niveau_data');
      etat.niveauData = n.data || null;
    }
  }
  // Pastilles de comptage dans le menu (paiements à vérifier, demandes à chiffrer)
  async function majBadges() {
    const [p, d] = await Promise.all([
      estFinance() ? sb.from('paiements').select('id', { count: 'exact', head: true }).eq('statut', 'initie') : Promise.resolve({ count: 0 }),
      sb.from('demandes').select('id', { count: 'exact', head: true }).eq('statut', 'nouvelle')
    ]);
    [['badge-paiements', p.count], ['badge-demandes', d.count]].forEach(([id, n]) => {
      const el = document.getElementById(id); if (!el) return;
      el.textContent = n || ''; el.hidden = !n;
    });
  }
  const estStaff = () => etat.profil && ['admin', 'assistant', 'representant', 'groupeur'].includes(etat.profil.role);
  const estAdmin = () => etat.profil && etat.profil.role === 'admin';
  // Paiements et chiffrage des devis : admin et assistants
  const estFinance = () => etat.profil && ['admin', 'assistant', 'groupeur'].includes(etat.profil.role);
  // Point de retrait partenaire : uniquement l'onglet Colis
  const estPartenaire = () => etat.profil && etat.profil.role === 'partenaire';
  // Ce que chaque rôle peut ouvrir
  const peut = (onglet) => ({ accueil: estStaff(), campagnes: estStaff(), demandes: estStaff(),
                              paiements: estFinance(), colis: estStaff() || estPartenaire(),
                              reseau: estFinance(), reglages: estAdmin() }[onglet] || false);
  const tel = (p) => (p && p.telephone) || '';

  function router() {
    const brut = location.hash.replace(/^#\/?/, '');
    const [chemin, qs] = brut.split('?');
    const m = chemin.split('/').filter(Boolean);
    const params = new URLSearchParams(qs || '');

    const accesEquipe = estStaff() || estPartenaire();
    document.getElementById('nav').hidden = !accesEquipe;
    document.getElementById('nav-haut').hidden = !accesEquipe;
    const I = window.ICO;
    document.getElementById('entete-compte').innerHTML = etat.session
      ? `${estStaff() && etat.niveauData ? `<a class="lien-data" href="${cfg.urlData}" target="_blank" rel="noopener">${I.graphique}<span>Analyses</span></a>` : ''}
         <span class="lien-compte">${I.utilisateur}<span>${esc(((etat.profil && etat.profil.nom_complet) || etat.session.user.email).split(' ')[0])}</span></span>
         <button class="btn btn-second btn-petit" id="sortir" aria-label="Se déconnecter">${I.sortie}<span class="txt-sortir">Sortir</span></button>` : '';
    if (estStaff()) majBadges();
    document.querySelector('.puce-equipe').textContent = estPartenaire() ? 'Point de retrait' : 'Équipe';
    const s = document.getElementById('sortir');
    if (s) s.addEventListener('click', () => sb.auth.signOut());

    if (!accesEquipe) return vueConnexion();

    // Menus visibles selon le rôle
    document.querySelectorAll('.nav-bas a, .nav-haut a').forEach((a) => { a.hidden = !peut(a.dataset.onglet); });
    const nb = document.querySelectorAll('.nav-bas a:not([hidden])').length;
    document.getElementById('nav').style.gridTemplateColumns = `repeat(${nb}, minmax(56px, 1fr))`;

    const onglet = { '': 'accueil', paiements: 'paiements', campagnes: 'campagnes', campagne: 'campagnes', pistes: 'campagnes', piste: 'campagnes',
                     demandes: 'demandes', demande: 'demandes', colis: 'colis', reseau: 'reseau', reglages: 'reglages', utilisateurs: 'reglages' }[m[0] || ''];
    if (estPartenaire() && onglet !== 'colis') { location.hash = '#/colis'; return; }
    document.querySelectorAll('.nav-bas a, .nav-haut a').forEach((a) => a.classList.toggle('actif', a.dataset.onglet === onglet));
    window.scrollTo(0, 0);
    if (onglet && !peut(onglet)) { location.hash = '#/'; return; }
    const routes = { '': vueAccueil, paiements: vuePaiements, campagnes: vueCampagnes, campagne: vueCampagne,
                     demandes: vueDemandes, demande: vueDemande, colis: vueColis, reseau: vueReseau, reglages: vueReglages,
                     pistes: ops.vuePistes, piste: ops.vuePiste, utilisateurs: ops.vueUtilisateurs };
    vue.innerHTML = '<div class="chargement">Chargement…</div>';
    Promise.resolve((routes[m[0] || ''] || vueAccueil)(m[1], params)).catch((e) => {
      vue.innerHTML = `<div class="carte"><div class="alerte alerte-ko">${esc(msgErreur(e))}</div>
        <button class="btn btn-second" onclick="location.reload()">Réessayer</button></div>`;
    });
  }

  // ------------------------------------------------------------------
  // Connexion
  // ------------------------------------------------------------------
  function vueConnexion() {
    if (etat.session) {
      vue.innerHTML = `<div class="carte"><h1>Accès réservé</h1>
        <p>Le compte <b>${esc(etat.session.user.email)}</b> n'a pas encore les droits équipe.
        Demandez à l'admin de vous ajouter dans Réglages.</p></div>`;
      return;
    }
    vue.innerHTML = `<div class="carte" style="max-width:420px;margin:24px auto">
      <h1>Espace équipe</h1>
      <p class="discret">Connectez-vous avec le compte créé sur le site client.</p>
      <form id="f"><label for="e">Email</label><input id="e" type="email" autocomplete="email" required>
        <label for="p">Mot de passe</label><input id="p" type="password" autocomplete="current-password" required>
        <button class="btn btn-large" style="margin-top:14px">Se connecter</button></form>
      <div id="msg"></div></div>`;
    document.getElementById('f').addEventListener('submit', (ev) => {
      ev.preventDefault();
      occupe(ev.target.querySelector('button'), async () => {
        const { error } = await sb.auth.signInWithPassword({
          email: document.getElementById('e').value.trim(), password: document.getElementById('p').value });
        if (error) document.getElementById('msg').innerHTML = `<div class="alerte alerte-ko">${esc(msgErreur(error))}</div>`;
      });
    });
  }

  // ------------------------------------------------------------------
  // Accueil : ce qui attend une action
  // ------------------------------------------------------------------
  async function vueAccueil() {
    const compte = (q) => q.then((r) => r.count || 0);
    const [aVerifier, nouvelles, acceptees, ouvertes, aRembourser, campagnes, enCours, etudes] = await Promise.all([
      compte(sb.from('paiements').select('id', { count: 'exact', head: true }).eq('statut', 'initie')),
      compte(sb.from('demandes').select('id', { count: 'exact', head: true }).eq('statut', 'nouvelle')),
      compte(sb.from('demandes').select('id', { count: 'exact', head: true }).eq('statut', 'acceptee')),
      compte(sb.from('campagnes').select('id', { count: 'exact', head: true }).eq('statut', 'ouverte')),
      compte(sb.from('commandes').select('id', { count: 'exact', head: true }).eq('statut', 'a_rembourser')),
      sb.from('campagnes').select('id,titre,statut,quota,quantite_payee,nb_clients,date_cloture,image_url,prix_unitaire')
        .not('statut', 'in', '(terminee,echec_quota)').order('date_cloture').limit(24),
      compte(sb.from('campagnes').select('id', { count: 'exact', head: true }).in('statut', ['commandee', 'entrepot_chine', 'en_transit', 'arrivee'])),
      compte(sb.from('pistes').select('id', { count: 'exact', head: true }).not('statut', 'in', '(lancee,abandonnee)'))
    ]);
    const g = etat.groupeur || {};
    const I = window.ICO;
    const aFaire = [
      estFinance() && aVerifier && `${aVerifier} paiement${aVerifier > 1 ? 's' : ''} à vérifier`,
      nouvelles && `${nouvelles} demande${nouvelles > 1 ? 's' : ''} à chiffrer`,
      aRembourser && `${aRembourser} remboursement${aRembourser > 1 ? 's' : ''} à faire`
    ].filter(Boolean);
    const aujourdhui = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

    vue.innerHTML = `
      <section class="hero-equipe">
        <div>
          <p class="hero-equipe-date">${esc(aujourdhui)}</p>
          <h1>Bonjour ${esc((etat.profil.nom_complet || '').split(' ')[0])}&nbsp;!</h1>
          <p class="hero-equipe-resume">${aFaire.length ? 'Aujourd\'hui : ' + esc(aFaire.join(', ')) + '.' : 'Tout est à jour. Rien n\'attend une action.'}</p>
        </div>
        <div class="boutons">
          ${estFinance() ? `<a class="btn btn-blanc" href="#/piste/nouvelle">${I.loupe}Étudier un produit</a>` : ''}
          ${estFinance() && aVerifier ? `<a class="btn btn-hero-second" href="#/paiements">${I.carte}Vérifier les paiements</a>` : ''}
        </div>
      </section>
      ${estAdmin() && !g.numero_marchand_tmoney && !g.numero_marchand_flooz ? `<div class="alerte alerte-alerte">${I.alerte} Aucun numéro marchand n'est configuré : les clients ne peuvent pas payer en ligne.
        <a href="#/reglages">Le configurer</a></div>` : ''}
      <div class="tuiles">
        ${estFinance() ? `<a class="tuile orange" href="#/paiements"><span class="tuile-ico">${I.carte}</span><b>${aVerifier}</b><span>Paiements à vérifier</span></a>` : ''}
        <a class="tuile bleu" href="#/demandes?statut=nouvelle"><span class="tuile-ico">${I.crayon}</span><b>${nouvelles}</b><span>Demandes à chiffrer</span></a>
        <a class="tuile bleu" href="#/pistes"><span class="tuile-ico">${I.loupe}</span><b>${etudes}</b><span>Produits à l'étude</span></a>
        <a class="tuile vert" href="#/campagnes"><span class="tuile-ico">${I.colis}</span><b>${ouvertes}</b><span>Campagnes ouvertes</span></a>
        <a class="tuile violet" href="#/campagnes"><span class="tuile-ico">${I.avion}</span><b>${enCours}</b><span>Commandes en route</span></a>
        <a class="tuile rouge" href="#/campagnes"><span class="tuile-ico">${I.alerte}</span><b>${aRembourser}</b><span>À rembourser</span></a>
        ${estFinance() ? `<a class="tuile jaune" href="#/demandes?statut=acceptee"><span class="tuile-ico">${I.horloge}</span><b>${acceptees}</b><span>Devis acceptés, à payer</span></a>` : ''}
      </div>
      <div class="titre-section"><h2><span class="ico-titre flamme">${I.flamme}</span>Campagnes actives</h2>
        ${estFinance() ? `<a class="btn btn-petit" href="#/campagne/nouvelle">${I.plus}Nouvelle</a>` : ''}</div>
      ${campagnes.data && campagnes.data.length ? `<div class="liste-campagnes">${campagnes.data.map(carteAdmin).join('')}</div>`
        : `<div class="carte vide"><p><b>Aucune campagne active.</b></p><a class="btn" href="#/campagne/nouvelle">Créer la première campagne</a></div>`}`;
  }

  // Carte campagne côté équipe : même style que la boutique, avec les chiffres utiles
  function carteAdmin(c) {
    const I = window.ICO;
    const p = Math.min(100, Math.round((100 * (c.quantite_payee || 0)) / (c.quota || 1)));
    return `<article class="campagne">
      <a class="campagne-image" href="#/campagne/${c.id}" aria-label="${esc(c.titre)}">
        <img src="${esc(urlImageCampagne(c.image_url))}" alt="" loading="lazy">
        <span class="pastille-statut">${badge(c.statut)}</span>
        ${c.statut === 'ouverte' ? `<span class="pastille-delai">${esc(joursRestants(c.date_cloture))}</span>` : ''}</a>
      <div class="campagne-corps">
        <a class="campagne-titre" href="#/campagne/${c.id}">${esc(c.titre)}</a>
        <div class="prix">${fcfa(c.prix_unitaire)}</div>
        <div class="social">${I.personnes}<span>${c.nb_clients || 0} client${(c.nb_clients || 0) > 1 ? 's' : ''} · ${c.quantite_payee}/${c.quota} unités</span></div>
        <div class="jauge-ligne"><div class="jauge"><div class="jauge-barre" style="width:${p}%"></div></div><b>${p}%</b></div>
        <a class="btn btn-second btn-large btn-reserver" href="#/campagne/${c.id}">Gérer<span class="txt-long">&nbsp;la campagne</span></a>
      </div></article>`;
  }

  const colisDe = (o) => (Array.isArray(o.colis) ? o.colis[0] : o.colis) || null;
  // « Pointure : 40, 41 » (une ligne par caractéristique) -> [{ nom: 'Pointure', options: ['40', '41'] }]
  const lireVariantes = (texte) => String(texte || '').split('\n').map((l) => {
    const [nom, reste] = l.split(/:(.*)/s);
    const options = [...new Set(String(reste || '').split(',').map((x) => x.trim()).filter(Boolean))];
    return nom && nom.trim() && options.length ? { nom: nom.trim(), options } : null;
  }).filter(Boolean);

  const ligneCampagne = (c) => `<a class="ligne" href="#/campagne/${c.id}">
      <div class="vignette" style="background-image:url('${esc(urlImageCampagne(c.image_url))}')"></div>
      <div style="flex:1;min-width:0"><div class="ligne-titre">${esc(c.titre)}</div>
        <small>${c.quantite_payee}/${c.quota} payés · ${c.statut === 'ouverte' ? esc(joursRestants(c.date_cloture)) : 'clôture ' + date(c.date_cloture)}</small></div>
      ${badge(c.statut)}</a>`;

  // ------------------------------------------------------------------
  // Paiements à vérifier
  // ------------------------------------------------------------------
  async function vuePaiements(_, params) {
    const statut = params.get('statut') || 'initie';
    const { data, error } = await sb.from('paiements')
      .select('*, commandes(id,quantite,campagnes(titre),profils(nom_complet,telephone)), demandes(id,description,profils(nom_complet,telephone))')
      .eq('statut', statut).order('created_at', { ascending: statut !== 'initie' }).limit(100);
    if (error) throw error;

    vue.innerHTML = `
      <h1>Paiements</h1>
      <div class="filtres">${['initie', 'confirme', 'echoue'].map((s) =>
        `<button class="${s === statut ? 'actif' : ''}" data-s="${s}">${esc(lib(s))}</button>`).join('')}</div>
      ${statut === 'initie' ? `<p class="discret">Vérifiez chaque référence dans l'historique de votre compte marchand avant de valider.</p>` : ''}
      ${data.length ? '<div class="grille-cartes">' + data.map((p) => {
        const client = (p.commandes && p.commandes.profils) || (p.demandes && p.demandes.profils) || {};
        const objet = p.commandes ? `${esc(p.commandes.campagnes.titre)} × ${p.commandes.quantite}`
          : `Sur mesure : ${esc((p.demandes.description || '').slice(0, 60))}`;
        const lienObjet = p.commandes ? '' : `#/demande/${p.demandes.id}`;
        return `<div class="bloc-paiement">
          <div style="display:flex;justify-content:space-between;gap:8px"><b>${fcfa(p.montant)}</b>${badge(p.statut)}</div>
          <div class="ref">${esc(p.reference_externe)}</div>
          <small>${esc(lib(p.operateur))} · payé par ${esc(p.numero_payeur || '—')} · ${date(p.created_at, true)}</small>
          <p style="margin:8px 0 0">${lienObjet ? `<a href="${lienObjet}">${objet}</a>` : objet}<br>
            <small>${esc(client.nom_complet || '')} · ${client.telephone ? `<a href="${waLien(client.telephone)}" target="_blank" rel="noopener">${esc(client.telephone)}</a>` : ''}</small></p>
          ${p.statut === 'initie' ? `<div class="boutons">
            <button class="btn btn-ok btn-petit" data-valider="${p.id}">Valider</button>
            <button class="btn btn-ko btn-petit" data-rejeter="${p.id}">Introuvable</button></div>` : ''}
        </div>`;
      }).join('') + '</div>' : '<div class="carte vide">Rien ici.</div>'}`;

    vue.querySelectorAll('.filtres button').forEach((b) => b.addEventListener('click', () => { location.hash = '#/paiements?statut=' + b.dataset.s; }));
    const changer = (id, s, bouton) => occupe(bouton, async () => {
      const { error } = await sb.from('paiements').update({ statut: s }).eq('id', id);
      if (error) { toast(msgErreur(error), 'ko'); return; }
      toast(s === 'confirme' ? 'Paiement validé' : 'Paiement rejeté'); router();
    });
    vue.querySelectorAll('[data-valider]').forEach((b) => b.addEventListener('click', () => changer(b.dataset.valider, 'confirme', b)));
    vue.querySelectorAll('[data-rejeter]').forEach((b) => b.addEventListener('click', () => {
      if (confirm('Rejeter ce paiement ? Le client sera invité à vérifier sa référence.')) changer(b.dataset.rejeter, 'echoue', b);
    }));
  }

  // ------------------------------------------------------------------
  // Campagnes
  // ------------------------------------------------------------------
  async function vueCampagnes() {
    const { data, error } = await sb.from('campagnes')
      .select('id,titre,statut,quota,quantite_payee,date_cloture,image_url').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    vue.innerHTML = `${ops.ongletsCampagnes('campagnes')}<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h1 style="margin:0">Campagnes</h1><a class="btn btn-petit" href="#/campagne/nouvelle">+ Nouvelle</a></div>
      <div class="carte grille-lignes">${data.length ? data.map(ligneCampagne).join('') : '<p class="discret">Aucune campagne. Créez la première.</p>'}</div>`;
  }

  async function vueCampagne(id) {
    let c = { titre: '', description: '', prix_unitaire: '', prix_reference: '', type_prix: 'TTC', frais_transport_unitaire: '', quota: '',
              date_cloture: new Date(Date.now() + 7 * 86400000).toISOString(), mode_transport: 'aerien', statut: 'brouillon', image_url: '' };
    let commandes = [];
    if (id !== 'nouvelle') {
      const r = await sb.from('campagnes').select('*').eq('id', id).maybeSingle();
      if (r.error) throw r.error;
      if (!r.data) { vue.innerHTML = '<div class="carte vide">Campagne introuvable.</div>'; return; }
      c = r.data;
      const o = await sb.from('commandes').select('*, profils(nom_complet,telephone,pays,region), colis(reference,statut)').eq('campagne_id', id).order('created_at');
      if (o.error) throw o.error;
      commandes = o.data;
    }
    const nouvelle = id === 'nouvelle';
    const local = (iso) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
    const i = SUITE_CAMPAGNE.indexOf(c.statut);
    const suivant = i >= 0 && i < SUITE_CAMPAGNE.length - 1 ? SUITE_CAMPAGNE[i + 1] : null;
    const payees = commandes.filter((o) => ['payee', 'livree'].includes(o.statut));
    const sections = id !== 'nouvelle' ? await ops.sectionsCampagne(c, payees) : { html: '', brancher() {} };

    vue.innerHTML = `
      <a class="retour" href="#/campagnes">← Campagnes</a>
      <div class="deux-colonnes">
      ${nouvelle ? '' : `<div class="colonne"><div class="carte">
        <div style="display:flex;justify-content:space-between;gap:10px"><h1>${esc(c.titre)}</h1>${badge(c.statut)}</div>
        ${jauge(c.quantite_payee, c.quota)}
        <p class="discret" style="margin-top:8px">${commandes.length} commande(s), dont ${payees.length} payée(s) · encaissé ${fcfa(payees.reduce((s, o) => s + Number(o.montant_total), 0))}</p>
        <div class="boutons">
          ${suivant ? `<button class="btn" id="avancer">${esc(ACTION[suivant])}</button>` : ''}
          ${c.statut === 'ouverte' ? `<button class="btn btn-ko" id="echec">Clôturer en échec</button>` : ''}
          ${['arrivee', 'terminee'].includes(c.statut) && payees.some((o) => o.statut === 'payee' && !colisDe(o))
            ? `<button class="btn btn-second" id="gen-colis">Créer les colis manquants</button>` : ''}
        </div>
        ${c.statut === 'arrivee' ? `<p class="aide">Un colis avec code de retrait est créé pour chaque commande payée. Les points de retrait l'enregistrent puis le remettent dans l'onglet <a href="#/colis">Colis</a>.</p>` : ''}
        <div id="zone-wa"></div>
      </div>
      <div class="carte"><h2>Commandes</h2>
        ${commandes.length ? commandes.map((o) => `
          <div class="ligne">
            <div style="flex:1;min-width:0"><div class="ligne-titre">${esc(o.profils.nom_complet || 'Client')}</div>
              <small>${o.quantite} ×${txtVariante(o.variante) ? ' ' + esc(txtVariante(o.variante)) : ''} · ${fcfa(o.montant_total)} · ${esc(o.profils.region || nomPays(o.profils.pays))} · ${o.profils.telephone ? `<a href="${waLien(o.profils.telephone)}" target="_blank" rel="noopener">${esc(o.profils.telephone)}</a>` : ''}</small>
              ${o.assistant_id || o.referent_id || colisDe(o) ? `<small class="discret">${o.assistant_id ? 'Commande assistée par un AC' : ''}${o.assistant_id && o.referent_id ? ' · ' : ''}${o.referent_id ? 'Client parrainé' : ''}${colisDe(o) ? ` · colis ${esc(colisDe(o).reference)} (${esc(lib(colisDe(o).statut))})` : ''}</small>` : ''}</div>
            <div class="actions-ligne">${badge(o.confirmation === 'en_attente_client' && o.statut === 'en_attente_paiement' ? 'en_attente_client' : o.statut)}
              ${o.statut === 'payee' && ['arrivee', 'terminee'].includes(c.statut) && !colisDe(o) ? `<button class="btn btn-ok btn-petit" data-livrer="${o.id}">Livré</button>` : ''}
              ${o.statut === 'a_rembourser' && estFinance() ? `<button class="btn btn-second btn-petit" data-rembourser="${o.id}">Remboursé</button>` : ''}
              ${o.statut === 'en_attente_paiement' ? `<button class="btn btn-ko btn-petit" data-annuler="${o.id}">Annuler</button>` : ''}
              ${o.statut === 'payee' && estFinance() ? `<button class="btn btn-ko btn-petit" data-retirer-cmd="${o.id}">Retirer</button>` : ''}
            </div></div>`).join('') : '<p class="discret">Aucune commande pour le moment.</p>'}</div>
      ${sections.html}
      </div>`}
      <div class="colonne">
      <form class="carte" id="form-c">
        <h2>${nouvelle ? 'Nouvelle campagne' : 'Modifier'}</h2>
        <label for="titre">Produit</label><input id="titre" required value="${esc(c.titre)}" placeholder="Ex. : Montre connectée T800 Ultra">
        <label for="desc">Description</label><textarea id="desc" placeholder="Caractéristiques, couleurs, garantie…">${esc(c.description || '')}</textarea>
        <label for="img">Photo</label>
        ${c.image_url ? `<img class="photo-apercu" id="apercu" src="${esc(urlImageCampagne(c.image_url))}" alt="">` : '<img class="photo-apercu" id="apercu" hidden alt="">'}
        <input id="img" type="file" accept="image/*">
        <div class="rangee">
          <div><label for="prix">Prix unitaire (F)</label><input id="prix" type="number" inputmode="numeric" min="1" required value="${esc(c.prix_unitaire)}"></div>
          <div><label for="tp">Prix</label><select id="tp"><option value="TTC" ${c.type_prix === 'TTC' ? 'selected' : ''}>TTC (tout compris)</option>
            <option value="HT" ${c.type_prix === 'HT' ? 'selected' : ''}>HT (transport à l'arrivée)</option></select></div>
        </div>
        <div class="rangee">
          <div><label for="quota">Quota (unités)</label><input id="quota" type="number" inputmode="numeric" min="1" required value="${esc(c.quota)}"></div>
          <div><label for="ft">Transport/unité si HT</label><input id="ft" type="number" inputmode="numeric" min="0" value="${esc(c.frais_transport_unitaire || '')}"></div>
        </div>
        <label for="variantes">Variantes (facultatif)</label>
        <textarea id="variantes" rows="3" placeholder="Une caractéristique par ligne, options séparées par des virgules&#10;Pointure : 40, 41, 42, 43&#10;Couleur : Noir, Blanc">${esc((c.variantes || []).map((v) => `${v.nom} : ${(v.options || []).join(', ')}`).join('\n'))}</textarea>
        <div class="aide">Le client devra choisir une option pour chaque ligne. Évitez de les modifier une fois des commandes passées.</div>
        <label for="pref">Prix habituel à Lomé (F, facultatif)</label>
        <input id="pref" type="number" inputmode="numeric" min="1" value="${esc(c.prix_reference || '')}" placeholder="Ex. : 29990">
        <div class="aide">S'il est renseigné, il s'affiche barré à côté de votre prix, avec le pourcentage d'économie. Indiquez un prix réellement constaté.</div>
        <div class="rangee">
          <div><label for="cloture">Clôture</label><input id="cloture" type="datetime-local" required value="${local(c.date_cloture)}"></div>
          <div><label for="mode">Transport</label><select id="mode"><option value="aerien" ${c.mode_transport === 'aerien' ? 'selected' : ''}>Aérien</option>
            <option value="maritime" ${c.mode_transport === 'maritime' ? 'selected' : ''}>Maritime</option></select></div>
        </div>
        ${nouvelle ? `<label for="pub">Publication</label><select id="pub"><option value="brouillon">Enregistrer en brouillon</option>
          <option value="ouverte">Publier tout de suite</option></select>` : ''}
        <button class="btn btn-large" style="margin-top:16px">${nouvelle ? 'Créer la campagne' : 'Enregistrer'}</button>
      </form>
      </div></div>`;

    // Photo
    const fichier = document.getElementById('img');
    fichier.addEventListener('change', () => {
      const a = document.getElementById('apercu');
      if (fichier.files[0]) { a.src = URL.createObjectURL(fichier.files[0]); a.hidden = false; }
    });

    // Enregistrement
    document.getElementById('form-c').addEventListener('submit', (ev) => {
      ev.preventDefault();
      occupe(ev.target.querySelector('button'), async () => {
        let image_url = c.image_url || null;
        if (fichier.files[0]) {
          const blob = await compresserImage(fichier.files[0], 1400, 0.82);
          const chemin = `${Date.now()}.jpg`;
          const up = await sb.storage.from('campagnes').upload(chemin, blob, { contentType: 'image/jpeg' });
          if (up.error) { toast(msgErreur(up.error), 'ko'); return; }
          image_url = chemin;
        }
        const val = (x) => document.getElementById(x).value;
        const ligne = {
          titre: val('titre').trim(), description: val('desc').trim() || null, image_url,
          prix_unitaire: parseInt(val('prix'), 10), type_prix: val('tp'),
          frais_transport_unitaire: val('ft') ? parseInt(val('ft'), 10) : null,
          prix_reference: val('pref') ? parseInt(val('pref'), 10) : null,
          quota: parseInt(val('quota'), 10), date_cloture: new Date(val('cloture')).toISOString(), mode_transport: val('mode'),
          variantes: lireVariantes(val('variantes'))
        };
        let r;
        if (nouvelle) {
          ligne.statut = val('pub');
          ligne.groupeur_id = etat.profil.groupeur_id || etat.groupeur.id;
          r = await sb.from('campagnes').insert(ligne).select('id').single();
        } else {
          r = await sb.from('campagnes').update(ligne).eq('id', c.id).select('id').single();
        }
        if (r.error) { toast(msgErreur(r.error), 'ko'); return; }
        toast('Enregistré');
        if (nouvelle) location.hash = '#/campagne/' + r.data.id; else router();
      });
    });

    if (nouvelle) return;
    sections.brancher();

    // Liens WhatsApp vers les clients payés, après un changement d'étape
    const proposerWa = (statut) => {
      const f = MSG[statut];
      const cibles = statut === 'echec_quota' ? commandes.filter((o) => o.statut === 'payee') : payees;
      if (!f || !cibles.length) return;
      document.getElementById('zone-wa').innerHTML = `<hr><b>Prévenir les clients sur WhatsApp</b>
        <p class="discret">Un bouton par client, le message est déjà écrit.</p>
        <div class="liste-wa">${cibles.filter((o) => o.profils.telephone).map((o) =>
          `<a class="btn btn-wa btn-petit" target="_blank" rel="noopener" href="${waLien(o.profils.telephone,
            `Bonjour ${(o.profils.nom_complet || '').split(' ')[0]}, ${f(c.titre)} Suivi : ${cfg.urlSite}/#/commande/${o.id}`)}">
            ${esc(o.profils.nom_complet || o.profils.telephone)}</a>`).join('')}</div>`;
    };

    const avancer = document.getElementById('avancer');
    if (avancer) avancer.addEventListener('click', () => occupe(avancer, async () => {
      if (suivant === 'terminee' && !confirm('Terminer la campagne ? Les colis pas encore remis restent à remettre (avec le code de retrait) : les commissions ne sont validées qu\'à la remise.')) return;
      const { error } = await sb.from('campagnes').update({ statut: suivant }).eq('id', c.id);
      if (error) { toast(msgErreur(error), 'ko'); return; }
      toast('Étape mise à jour');
      await vueCampagne(c.id);
      proposerWa(suivant);
    }));

    const echec = document.getElementById('echec');
    if (echec) echec.addEventListener('click', () => {
      if (!confirm('Clôturer en échec ? Les commandes payées passeront « à rembourser », les autres seront annulées.')) return;
      occupe(echec, async () => {
        const { error } = await sb.from('campagnes').update({ statut: 'echec_quota' }).eq('id', c.id);
        if (error) { toast(msgErreur(error), 'ko'); return; }
        await sb.from('commandes').update({ statut: 'a_rembourser' }).eq('campagne_id', c.id).eq('statut', 'payee');
        await sb.from('commandes').update({ statut: 'annulee' }).eq('campagne_id', c.id).eq('statut', 'en_attente_paiement');
        await vueCampagne(c.id);
        proposerWa('echec_quota');
      });
    });

    const gen = document.getElementById('gen-colis');
    if (gen) gen.addEventListener('click', () => occupe(gen, async () => {
      const { data: n, error } = await sb.rpc('generer_colis_campagne', { p_campagne: c.id });
      if (error) { toast(msgErreur(error), 'ko'); return; }
      toast(`${n} colis créé(s)`); router();
    }));

    vue.querySelectorAll('[data-livrer]').forEach((b) => b.addEventListener('click', () => occupe(b, async () => {
      const { error } = await sb.from('commandes').update({ statut: 'livree' }).eq('id', b.dataset.livrer);
      if (error) toast(msgErreur(error), 'ko'); else router();
    })));
    vue.querySelectorAll('[data-annuler]').forEach((b) => b.addEventListener('click', () => {
      if (!confirm('Annuler cette commande non payée ?')) return;
      occupe(b, async () => {
        const { error } = await sb.from('commandes').update({ statut: 'annulee' }).eq('id', b.dataset.annuler);
        if (error) toast(msgErreur(error), 'ko'); else { toast('Commande annulée'); router(); }
      });
    }));
    vue.querySelectorAll('[data-retirer-cmd]').forEach((b) => b.addEventListener('click', () => {
      if (!confirm('Retirer cette commande payée ? Elle passera « à rembourser ».')) return;
      occupe(b, async () => {
        const { error } = await sb.from('commandes').update({ statut: 'a_rembourser' }).eq('id', b.dataset.retirerCmd);
        if (error) toast(msgErreur(error), 'ko'); else { toast('Commande retirée, à rembourser'); router(); }
      });
    }));
    vue.querySelectorAll('[data-rembourser]').forEach((b) => b.addEventListener('click', () => {
      if (!confirm('Confirmer que ce client a bien été remboursé ?')) return;
      occupe(b, async () => {
        const { error } = await sb.from('commandes').update({ statut: 'remboursee' }).eq('id', b.dataset.rembourser);
        if (error) { toast(msgErreur(error), 'ko'); return; }
        await sb.from('paiements').update({ statut: 'rembourse' }).eq('commande_id', b.dataset.rembourser).eq('statut', 'confirme');
        router();
      });
    }));
  }

  // ------------------------------------------------------------------
  // Demandes sur mesure
  // ------------------------------------------------------------------
  async function vueDemandes(_, params) {
    const statut = params.get('statut') || 'nouvelle';
    let q = sb.from('demandes').select('id,description,statut,quantite,budget,montant_devis,created_at,profils(nom_complet)')
      .order('created_at', { ascending: false }).limit(100);
    if (statut === 'en_cours') q = q.in('statut', ['payee', 'commandee', 'entrepot_chine', 'en_transit', 'arrivee']);
    else if (statut !== 'toutes') q = q.eq('statut', statut);
    const { data, error } = await q;
    if (error) throw error;
    const filtres = [['nouvelle', 'À chiffrer'], ['devis_envoye', 'Devis envoyés'], ['acceptee', 'À payer'], ['en_cours', 'En cours'], ['toutes', 'Toutes']];
    vue.innerHTML = `<h1>Sur mesure</h1>
      <div class="filtres">${filtres.map(([k, l]) => `<button class="${k === statut ? 'actif' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
      <div class="carte grille-lignes">${data.length ? data.map((d) => `
        <a class="ligne" href="#/demande/${d.id}">
          <div style="flex:1;min-width:0"><div class="ligne-titre" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.description)}</div>
            <small>${esc(d.profils.nom_complet || '')} · ${d.quantite} × · ${date(d.created_at)}${d.budget ? ' · budget ' + fcfa(d.budget) : ''}</small></div>
          ${badge(d.statut)}</a>`).join('') : '<p class="discret">Rien ici.</p>'}</div>`;
    vue.querySelectorAll('.filtres button').forEach((b) => b.addEventListener('click', () => { location.hash = '#/demandes?statut=' + b.dataset.s; }));
  }

  async function vueDemande(id) {
    const { data: d, error } = await sb.from('demandes').select('*, profils(nom_complet,telephone,email,pays,region)').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!d) { vue.innerHTML = '<div class="carte vide">Demande introuvable.</div>'; return; }
    const photo = d.photo_path ? (await sb.storage.from('demandes').createSignedUrl(d.photo_path, 3600)).data : null;
    const cl = d.profils || {};
    const i = SUITE_DEMANDE.indexOf(d.statut);
    const suivant = i >= 0 && i < SUITE_DEMANDE.length - 1 ? SUITE_DEMANDE[i + 1] : null;
    const peutChiffrer = estFinance() && ['nouvelle', 'devis_envoye'].includes(d.statut);
    const lienSuivi = `${cfg.urlSite}/#/demande/${d.id}`;
    const opsDemande = await ops.sectionDemande(d);
    const chiffrage = ops.aideChiffrage(d);

    vue.innerHTML = `
      <a class="retour" href="#/demandes">← Sur mesure</a>
      <div class="deux-colonnes"><div class="colonne">
      <div class="carte">
        <div style="display:flex;justify-content:space-between;gap:10px"><h1>Demande</h1>${badge(d.statut)}</div>
        <p style="white-space:pre-line">${esc(d.description)}</p>
        ${photo ? `<a href="${esc(photo.signedUrl)}" target="_blank" rel="noopener"><img class="photo-apercu" src="${esc(photo.signedUrl)}" alt="Photo du client"></a>` : ''}
        <dl class="cle-valeur" style="margin-top:12px">
          <dt>Quantité</dt><dd>${d.quantite}</dd>
          <dt>Budget</dt><dd>${d.budget ? fcfa(d.budget) : '—'}</dd>
          <dt>Transport</dt><dd>${d.mode_transport ? esc(lib(d.mode_transport)) : 'Pas de préférence'}</dd>
          ${d.lien ? `<dt>Lien</dt><dd><a href="${esc(d.lien)}" target="_blank" rel="noopener">Ouvrir le produit</a></dd>` : ''}
          <dt>Client</dt><dd>${esc(cl.nom_complet || '—')}</dd>
          <dt>Livraison</dt><dd>${esc(nomPays(cl.pays))}${cl.region ? ' · ' + esc(cl.region) : ''}</dd>
          <dt>Contact</dt><dd>${cl.telephone ? `<a href="${waLien(cl.telephone)}" target="_blank" rel="noopener">${esc(cl.telephone)}</a>` : '—'} · ${esc(cl.email || '')}</dd>
          <dt>Reçue le</dt><dd>${date(d.created_at, true)}</dd>
        </dl>
      </div>
      </div><div class="colonne">
      ${peutChiffrer ? `<form class="carte" id="form-devis">
        <h2>${d.statut === 'nouvelle' ? 'Envoyer un prix' : 'Modifier le devis'}</h2>
        ${chiffrage.html}
        <label for="montant">Prix total livré à Lomé (F CFA)</label>
        <input id="montant" type="number" inputmode="numeric" min="1" required value="${esc(d.montant_devis || '')}">
        <label for="note">Message au client</label>
        <textarea id="note" placeholder="Ex. : Modèle disponible en noir, livraison aérien sous 3 semaines.">${esc(d.note_devis || '')}</textarea>
        <button class="btn btn-large" style="margin-top:14px">Envoyer le devis</button>
      </form>` : ''}
      ${d.montant_devis && !peutChiffrer ? `<div class="carte"><b>Devis : ${fcfa(d.montant_devis)}</b>${d.note_devis ? `<p class="discret" style="white-space:pre-line;margin-top:6px">${esc(d.note_devis)}</p>` : ''}</div>` : ''}
      <div class="carte">
        <h2>Étape</h2>
        ${d.statut === 'acceptee' ? '<p class="discret">En attente du paiement du client. Il apparaîtra dans Paiements.</p>' : ''}
        <div class="boutons">
          ${suivant ? `<button class="btn" id="avancer">${esc(ACTION[suivant])}</button>` : ''}
          ${!['livree', 'annulee', 'refusee'].includes(d.statut) ? `<button class="btn btn-ko" id="annuler">Annuler la demande</button>` : ''}
        </div>
        <div id="zone-wa"></div>
      </div>
      ${opsDemande.html}
      </div></div>`;

    const proposerWa = (texte) => {
      if (!cl.telephone) return;
      document.getElementById('zone-wa').innerHTML = `<hr><a class="btn btn-wa btn-large" target="_blank" rel="noopener"
        href="${waLien(cl.telephone, `Bonjour ${(cl.nom_complet || '').split(' ')[0]}, ${texte} Détails : ${lienSuivi}`)}">Prévenir ${esc(cl.nom_complet || 'le client')} sur WhatsApp</a>`;
    };

    opsDemande.brancher();
    const fd = document.getElementById('form-devis');
    if (fd) chiffrage.brancher(document.getElementById('montant'));
    if (fd) fd.addEventListener('submit', (ev) => {
      ev.preventDefault();
      occupe(ev.target.querySelector('button'), async () => {
        const montant = parseInt(document.getElementById('montant').value, 10);
        const { error } = await sb.from('demandes').update({
          montant_devis: montant, note_devis: document.getElementById('note').value.trim() || null, statut: 'devis_envoye',
          chiffrage: chiffrage.lire()
        }).eq('id', d.id);
        if (error) { toast(msgErreur(error), 'ko'); return; }
        toast('Devis envoyé');
        await vueDemande(d.id);
        proposerWa(`votre prix pour votre demande sur mesure est prêt : ${fcfa(montant)} livré à Lomé. Vous pouvez l'accepter et payer en ligne.`);
      });
    });

    const av = document.getElementById('avancer');
    if (av) av.addEventListener('click', () => occupe(av, async () => {
      const { error } = await sb.from('demandes').update({ statut: suivant }).eq('id', d.id);
      if (error) { toast(msgErreur(error), 'ko'); return; }
      toast('Étape mise à jour');
      await vueDemande(d.id);
      if (MSG[suivant]) proposerWa(MSG[suivant]('sur mesure'));
    }));

    const an = document.getElementById('annuler');
    if (an) an.addEventListener('click', () => {
      if (!confirm('Annuler cette demande ?' + (['payee', 'commandee', 'entrepot_chine', 'en_transit', 'arrivee'].includes(d.statut) ? ' Le client a déjà payé : pensez à le rembourser.' : ''))) return;
      occupe(an, async () => {
        const { error } = await sb.from('demandes').update({ statut: 'annulee' }).eq('id', d.id);
        if (error) toast(msgErreur(error), 'ko'); else router();
      });
    });
  }

  // ------------------------------------------------------------------
  // Réglages : numéros marchands + équipe
  // ------------------------------------------------------------------
  async function vueReglages() {
    const g = etat.groupeur || {};
    const membres = estAdmin()
      ? (await sb.from('profils').select('id,nom_complet,telephone,email,role').in('role', ['admin', 'assistant', 'representant', 'groupeur']).order('nom_complet')).data || []
      : [];
    vue.innerHTML = `
      <h1>Réglages</h1>
      <div class="deux-colonnes egales">
      <form class="carte" id="form-g">
        <h2>Paiement Mobile Money</h2>
        <p class="discret">Ces numéros s'affichent aux clients au moment de payer.</p>
        <label for="nm">Nom affiché du marchand</label><input id="nm" value="${esc(g.nom_marchand || '')}" placeholder="Ex. : IMPORT PUBLIC">
        <label for="tm">Numéro marchand T-Money</label><input id="tm" inputmode="tel" value="${esc(g.numero_marchand_tmoney || '')}">
        <label for="fl">Numéro marchand Flooz</label><input id="fl" inputmode="tel" value="${esc(g.numero_marchand_flooz || '')}">
        <label for="wa">WhatsApp de contact</label><input id="wa" type="tel" inputmode="tel" value="${esc(g.whatsapp || '')}">
        <button class="btn btn-large" style="margin-top:14px">Enregistrer</button>
      </form>
      ${estAdmin() ? `<div class="carte">
        <h2>Équipe</h2>
        ${membres.map((p) => `<div class="ligne"><div style="flex:1;min-width:0"><div class="ligne-titre">${esc(p.nom_complet || p.email)}</div>
          <small>${esc(p.email || '')} · ${esc(p.telephone || '')}</small></div>
          <div class="actions-ligne">${p.id !== etat.profil.id ? `<select class="choix-role" data-profil="${p.id}" aria-label="Rôle de ${esc(p.nom_complet || p.email)}">
              ${[['assistant', 'Assistant'], ['representant', 'Représentant'], ['admin', 'Admin']].map(([v, l]) =>
                `<option value="${v}"${(p.role === v || (v === 'assistant' && p.role === 'groupeur')) ? ' selected' : ''}>${l}</option>`).join('')}
            </select><button class="btn btn-second btn-petit" data-retirer="${p.id}">Retirer</button>` : badge(p.role)}</div></div>`).join('')}
        <details class="roles-aide"><summary>Qui voit quoi ?</summary>
          <ul><li><b>Admin</b> : tout, y compris les réglages, l'équipe et les analyses.</li>
          <li><b>Assistant</b> : accueil, paiements (vérifier, valider), campagnes, sur mesure (chiffrer les devis).</li>
          <li><b>Représentant</b> : accueil, campagnes, sur mesure (suivi et remise des colis). Pas les paiements.</li>
          <li>Les <b>analyses</b> se partagent à part, depuis le site data (bouton Partager).</li></ul></details>
        <a class="btn btn-second btn-large" href="#/utilisateurs" style="margin-top:12px">${window.ICO.personnes}Voir tous les utilisateurs et gérer les rôles</a>
        <hr>
        <form id="form-ajout">
          <label for="cherche">Ajouter un membre</label>
          <input id="cherche" required placeholder="Email ou numéro WhatsApp de son compte">
          <div class="aide">La personne doit d'abord créer un compte sur le site client.</div>
          <select id="role-ajout" style="margin-top:8px"><option value="assistant">Assistant</option><option value="representant">Représentant</option><option value="admin">Admin</option></select>
          <button class="btn btn-second btn-large" style="margin-top:10px">Ajouter</button>
        </form>
      </div>` : ''}
      </div>`;

    document.getElementById('form-g').addEventListener('submit', (ev) => {
      ev.preventDefault();
      occupe(ev.target.querySelector('button'), async () => {
        const v = (x) => document.getElementById(x).value.trim();
        const { error } = await sb.from('groupeurs').update({
          nom_marchand: v('nm') || null, numero_marchand_tmoney: v('tm') || null,
          numero_marchand_flooz: v('fl') || null, whatsapp: normTel(v('wa')) || null
        }).eq('id', g.id);
        if (error) { toast(msgErreur(error), 'ko'); return; }
        await chargerProfil(); toast('Enregistré');
      });
    });

    if (!estAdmin()) return;
    const definir = async (profil, role) => {
      const { error } = await sb.rpc('definir_role', { p_profil: profil, p_role: role });
      if (error) { toast(msgErreur(error), 'ko'); return false; }
      return true;
    };
    vue.querySelectorAll('.choix-role').forEach((sel) => sel.addEventListener('change', async () => {
      if (await definir(sel.dataset.profil, sel.value)) toast('Rôle mis à jour');
    }));
    vue.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => {
      if (!confirm('Retirer ce membre de l\'équipe ?')) return;
      occupe(b, async () => { if (await definir(b.dataset.retirer, 'client')) router(); });
    }));
    document.getElementById('form-ajout').addEventListener('submit', (ev) => {
      ev.preventDefault();
      occupe(ev.target.querySelector('button'), async () => {
        const saisie = document.getElementById('cherche').value.trim();
        const col = saisie.includes('@') ? 'email' : 'telephone';
        const valeur = col === 'email' ? saisie.toLowerCase() : normTel(saisie);
        const { data } = await sb.from('profils').select('id,nom_complet').ilike(col, valeur).maybeSingle();
        if (!data) { toast('Aucun compte trouvé avec cette information', 'ko'); return; }
        if (await definir(data.id, document.getElementById('role-ajout').value)) { toast((data.nom_complet || 'Membre') + ' ajouté'); router(); }
      });
    });
  }

  // ------------------------------------------------------------------
  // Colis : points de retrait (réception +50 F, remise contre code +50 F)
  // ------------------------------------------------------------------
  async function vueColis(_, params) {
    const I = window.ICO;
    // Points accessibles : tous pour l'équipe, les siens pour un partenaire
    let q = sb.from('points_retrait').select('*').order('principal', { ascending: false }).order('nom');
    if (estPartenaire()) q = q.eq('responsable_id', etat.profil.id);
    const { data: points, error } = await q;
    if (error) throw error;
    if (!points.length) {
      vue.innerHTML = `<div class="carte vide"><h1>Colis</h1><p>Aucun point de retrait ne vous est attribué. Contactez Import Public.</p></div>`;
      return;
    }
    const pointId = params.get('point') || points[0].id;
    const point = points.find((p) => p.id === pointId) || points[0];
    const statut = params.get('statut') || '';
    const [t, liste] = await Promise.all([
      sb.rpc('tableau_point', { p_point: point.id }),
      sb.rpc('liste_colis_point', { p_point: point.id, p_statut: statut || null })
    ]);
    if (t.error) throw t.error;
    if (liste.error) throw liste.error;
    const tb = t.data;
    const filtres = [['', 'Tous'], ['attendu', 'Attendus'], ['recu', 'En attente de retrait'], ['remis', 'Remis'], ['non_recupere', 'Non récupérés'], ['litige', 'Litiges']];

    vue.innerHTML = `
      <div class="titre-section" style="margin-top:0"><h1 style="margin:0">Colis</h1>
        ${points.length > 1 ? `<select id="choix-point" style="width:auto">${points.map((p) => `<option value="${p.id}"${p.id === point.id ? ' selected' : ''}>${esc(p.nom)}</option>`).join('')}</select>`
          : `<span class="discret">${esc(point.nom)}</span>`}</div>
      <div class="tuiles">
        <div class="tuile bleu"><span class="tuile-ico">${I.camion}</span><b>${tb.attendus}</b><span>Attendus</span></div>
        <div class="tuile orange"><span class="tuile-ico">${I.horloge}</span><b>${tb.en_attente}</b><span>En attente de retrait</span></div>
        <div class="tuile vert"><span class="tuile-ico">${I.coche}</span><b>${tb.remis}</b><span>Remis</span></div>
        <div class="tuile rouge"><span class="tuile-ico">${I.alerte}</span><b>${tb.non_recuperes + tb.litiges}</b><span>Non récupérés ou litiges</span></div>
        <div class="tuile jaune"><span class="tuile-ico">${I.carte}</span><b>${fcfa(tb.remu_due)}</b><span>Rémunération à payer</span></div>
        <div class="tuile violet"><span class="tuile-ico">${I.graphique}</span><b>${fcfa(tb.remu_payee)}</b><span>Rémunération payée</span></div>
      </div>
      <div class="deux-colonnes"><div class="colonne">
        <form class="carte saisie-colis" id="form-colis">
          <h2>Scanner ou saisir un colis</h2>
          <label for="ref-colis">Référence du colis</label>
          <input id="ref-colis" class="reference" required placeholder="C7K2M9Q" autocomplete="off" autocapitalize="characters">
          <div class="boutons">
            <button type="button" class="btn" id="recu-bon">${I.colis}Reçu en bon état</button>
            <button type="button" class="btn btn-second" id="recu-abime">Reçu endommagé</button>
          </div>
          <hr>
          <label for="code-retrait">Code de retrait donné par le client</label>
          <input id="code-retrait" inputmode="numeric" maxlength="7" placeholder="482 913" autocomplete="off">
          <button type="button" class="btn btn-ok btn-large" id="remettre">${I.coche}Remettre le colis</button>
          <div class="resultat-colis" id="resultat-colis"></div>
          <p class="aide">Rémunération : ${fcfa(50)} à l'enregistrement d'un colis reçu, ${fcfa(50)} à la remise au client (barème en vigueur).
            Ne remettez jamais un colis sans le bon code.</p>
        </form>
      </div><div class="colonne">
        <div class="carte">
          <div class="filtres">${filtres.map(([k, l]) => `<button class="${k === statut ? 'actif' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
          <div class="grille-lignes">${liste.data.length ? liste.data.map((c) => `
            <div class="ligne">
              <div style="flex:1;min-width:0"><div class="ligne-titre">${esc(c.reference)} · ${esc(c.client || 'Client')}</div>
                <small>${esc(c.objet || '')}${c.etat === 'endommage' ? ' · endommagé' : ''} · ${c.remis_le ? 'remis le ' + date(c.remis_le, true) : c.recu_le ? 'reçu le ' + date(c.recu_le, true) : 'créé le ' + date(c.created_at)}</small></div>
              <div class="actions-ligne">${badge(c.statut)}
                ${c.telephone && ['recu', 'non_recupere'].includes(c.statut) ? `<a class="btn btn-wa btn-petit" target="_blank" rel="noopener" href="${waLien(c.telephone,
                  `Bonjour ${(c.client || '').split(' ')[0]}, votre colis Import Public (réf. ${c.reference}) vous attend au point de retrait ${point.nom}${point.adresse ? ', ' + point.adresse : ''}${point.horaires ? ' (' + point.horaires + ')' : ''}. Présentez votre code de retrait, visible dans votre compte sur ${cfg.urlSite}`)}">Prévenir</a>` : ''}
                ${c.statut === 'recu' ? `<button class="btn btn-second btn-petit" data-non-recupere="${esc(c.reference)}">Non récupéré</button>` : ''}
                ${['recu', 'non_recupere'].includes(c.statut) ? `<button class="btn btn-ko btn-petit" data-litige="${esc(c.reference)}">Litige</button>` : ''}
              </div></div>`).join('') : '<p class="discret">Aucun colis.</p>'}</div>
        </div>
        ${estFinance() && tb.remu_due > 0 ? `<form class="carte" id="form-payer-point">
          <h2>Payer ce point : ${fcfa(tb.remu_due)}</h2>
          <div class="rangee"><div><label for="pp-moyen">Moyen</label><select id="pp-moyen"><option value="tmoney">T-Money</option><option value="flooz">Flooz</option><option value="especes">Espèces</option><option value="virement">Virement</option></select></div>
            <div><label for="pp-ref">Référence du paiement</label><input id="pp-ref" required placeholder="Réf. de la transaction"></div></div>
          <button class="btn btn-large" style="margin-top:12px">Enregistrer le versement</button>
        </form>` : ''}
      </div></div>`;

    const aller = (p) => { const u = new URLSearchParams({ point: point.id, statut, ...p }); location.hash = '#/colis?' + u; };
    const cp = document.getElementById('choix-point');
    if (cp) cp.addEventListener('change', () => aller({ point: cp.value, statut: '' }));
    vue.querySelectorAll('.filtres button').forEach((b) => b.addEventListener('click', () => aller({ statut: b.dataset.s })));
    const ref = () => document.getElementById('ref-colis').value.trim().toUpperCase();
    const resultat = (html) => { document.getElementById('resultat-colis').innerHTML = html; };

    const recevoir = (etatColis) => (ev) => {
      if (!ref()) { toast('Saisissez la référence du colis', 'ko'); return; }
      occupe(ev.currentTarget, async () => {
        const { data, error: e } = await sb.rpc('recevoir_colis', { p_reference: ref(), p_etat: etatColis, p_note: null });
        if (e) { resultat(`<div class="alerte alerte-ko">${esc(msgErreur(e))}</div>`); return; }
        resultat(`<div class="alerte alerte-ok">Colis ${esc(data.reference)} enregistré${etatColis === 'endommage' ? ' (endommagé, signalé en litige)' : ''}.
          ${data.telephone ? `<div class="boutons"><a class="btn btn-wa btn-petit" target="_blank" rel="noopener" href="${waLien(data.telephone,
            `Bonjour ${(data.client || '').split(' ')[0]}, votre colis Import Public (réf. ${data.reference}) est arrivé au point de retrait ${data.point}${data.adresse ? ', ' + data.adresse : ''}${data.horaires ? ' (' + data.horaires + ')' : ''}. Présentez votre code de retrait, visible dans votre compte sur ${cfg.urlSite}`)}">Prévenir ${esc((data.client || 'le client').split(' ')[0])}</a></div>` : ''}</div>`);
        document.getElementById('ref-colis').value = '';
      });
    };
    document.getElementById('recu-bon').addEventListener('click', recevoir('bon'));
    document.getElementById('recu-abime').addEventListener('click', recevoir('endommage'));
    document.getElementById('remettre').addEventListener('click', (ev) => {
      const code = document.getElementById('code-retrait').value.replace(/\D/g, '');
      if (!ref() || code.length !== 6) { toast('Référence et code à 6 chiffres requis', 'ko'); return; }
      occupe(ev.currentTarget, async () => {
        const { data, error: e } = await sb.rpc('remettre_colis', { p_reference: ref(), p_code: code });
        if (e) { resultat(`<div class="alerte alerte-ko">${esc(msgErreur(e))}</div>`); return; }
        resultat(`<div class="alerte alerte-${data.ok ? 'ok' : 'ko'}">${esc(data.message)}</div>`);
        if (data.ok) { document.getElementById('ref-colis').value = ''; document.getElementById('code-retrait').value = ''; }
      });
    });
    const signaler = (s, libelle) => (b) => b.addEventListener('click', () => {
      const note = prompt(libelle + ' : précisez (facultatif)') ;
      if (note === null) return;
      occupe(b, async () => {
        const { error: e } = await sb.rpc('signaler_colis', { p_reference: b.dataset.nonRecupere || b.dataset.litige, p_statut: s, p_note: note || null });
        if (e) toast(msgErreur(e), 'ko'); else { toast('Colis signalé'); router(); }
      });
    });
    vue.querySelectorAll('[data-non-recupere]').forEach(signaler('non_recupere', 'Colis non récupéré'));
    vue.querySelectorAll('[data-litige]').forEach(signaler('litige', 'Litige'));
    const fp = document.getElementById('form-payer-point');
    if (fp) fp.addEventListener('submit', (ev) => {
      ev.preventDefault();
      occupe(fp.querySelector('button'), async () => {
        const { error: e } = await sb.rpc('payer_point', { p_point: point.id, p_moyen: document.getElementById('pp-moyen').value,
          p_reference: document.getElementById('pp-ref').value.trim(), p_note: null });
        if (e) { toast(msgErreur(e), 'ko'); return; }
        toast('Versement enregistré'); router();
      });
    });
  }

  // ------------------------------------------------------------------
  // Réseau : ambassadeurs, commissions, points de retrait, barème
  // ------------------------------------------------------------------
  async function vueReseau(rub, params) {
    const r = rub || 'ambassadeurs';
    const onglets = [['ambassadeurs', 'Ambassadeurs'], ['commissions', 'Commissions'], ['points', 'Points de retrait'], ['bareme', 'Barème et versements']];
    const corps = await ({ ambassadeurs: reseauAmbassadeurs, commissions: reseauCommissions, points: reseauPoints, bareme: reseauBareme }[r] || reseauAmbassadeurs)(params);
    vue.innerHTML = `<h1>Réseau</h1>
      <div class="filtres">${onglets.map(([k, l]) => `<button class="${k === r ? 'actif' : ''}" data-r="${k}">${l}</button>`).join('')}</div>
      ${corps.html}`;
    vue.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/reseau/' + b.dataset.r; }));
    if (corps.brancher) corps.brancher();
  }

  async function reseauAmbassadeurs() {
    const { data, error } = await sb.rpc('liste_ambassadeurs');
    if (error) throw error;
    const tot = (k) => data.reduce((s, a) => s + Number(a[k] || 0), 0);
    return {
      html: `
      <div class="tuiles">
        <div class="tuile vert"><span class="tuile-ico">${window.ICO.personnes}</span><b>${data.filter((a) => a.statut === 'actif').length}</b><span>Ambassadeurs actifs</span></div>
        <div class="tuile bleu"><span class="tuile-ico">${window.ICO.utilisateur}</span><b>${tot('clients')}</b><span>Clients apportés</span></div>
        <div class="tuile orange"><span class="tuile-ico">${window.ICO.panier}</span><b>${tot('assistees')}</b><span>Commandes assistées</span></div>
        <div class="tuile jaune"><span class="tuile-ico">${window.ICO.horloge}</span><b>${fcfa(tot('en_attente'))}</b><span>En attente de livraison</span></div>
        <div class="tuile rouge"><span class="tuile-ico">${window.ICO.carte}</span><b>${fcfa(tot('validees'))}</b><span>À payer</span></div>
        <div class="tuile violet"><span class="tuile-ico">${window.ICO.coche}</span><b>${fcfa(tot('payees'))}</b><span>Déjà payé</span></div>
      </div>
      <div class="carte grille-lignes">${data.length ? data.map((a) => `
        <div class="ligne">
          <div style="flex:1;min-width:0"><div class="ligne-titre">${esc(a.nom || a.email)} <small class="discret">${esc(a.code)}</small></div>
            <small>${esc(a.region || '—')} · ${a.telephone ? `<a href="${waLien(a.telephone)}" target="_blank" rel="noopener">${esc(a.telephone)}</a>` : ''} · depuis le ${date(a.adhere_le)} · conditions ${esc(a.conditions_version)}</small>
            <small>${a.clients} client(s) apporté(s) · ${a.assistees} commande(s) assistée(s) · en attente ${fcfa(a.en_attente)} · <b>à payer ${fcfa(a.validees)}</b> · payé ${fcfa(a.payees)}</small>
            <div id="payer-${a.id}"></div></div>
          <div class="actions-ligne">${badge(a.statut)}
            ${Number(a.validees) > 0 ? `<button class="btn btn-ok btn-petit" data-payer="${a.id}" data-montant="${a.validees}">Payer</button>` : ''}
            ${estAdmin() ? (a.statut === 'actif' ? `<button class="btn btn-ko btn-petit" data-suspendre="${a.id}">Suspendre</button>`
              : `<button class="btn btn-second btn-petit" data-reactiver="${a.id}">Réactiver</button>`) : ''}</div>
        </div>`).join('') : '<p class="discret">Aucun ambassadeur pour le moment. Les clients deviennent ambassadeurs depuis leur compte sur le site.</p>'}</div>`,
      brancher() {
        vue.querySelectorAll('[data-payer]').forEach((b) => b.addEventListener('click', () => {
          const zone = document.getElementById('payer-' + b.dataset.payer);
          zone.innerHTML = `<form class="rangee" style="margin-top:8px">
            <div><select class="pa-moyen"><option value="tmoney">T-Money</option><option value="flooz">Flooz</option><option value="especes">Espèces</option></select></div>
            <div><input class="pa-ref" required placeholder="Référence du transfert"></div>
            <div><button class="btn btn-ok btn-petit">Confirmer ${fcfa(b.dataset.montant)}</button></div></form>`;
          zone.querySelector('form').addEventListener('submit', (ev) => {
            ev.preventDefault();
            occupe(zone.querySelector('button'), async () => {
              const { error } = await sb.rpc('payer_ambassadeur', { p_ambassadeur: b.dataset.payer, p_moyen: zone.querySelector('.pa-moyen').value,
                p_reference: zone.querySelector('.pa-ref').value.trim(), p_note: null });
              if (error) { toast(msgErreur(error), 'ko'); return; }
              toast('Versement enregistré, commissions marquées payées'); router();
            });
          });
        }));
        const statutAC = (id, s) => occupe(document.querySelector(`[data-suspendre="${id}"],[data-reactiver="${id}"]`), async () => {
          const motif = s === 'suspendu' ? prompt('Motif de la suspension (visible par l\'ambassadeur) :') : null;
          if (s === 'suspendu' && !motif) return;
          const { error } = await sb.rpc('definir_statut_ambassadeur', { p_ambassadeur: id, p_statut: s, p_motif: motif });
          if (error) { toast(msgErreur(error), 'ko'); return; }
          toast(s === 'suspendu' ? 'Ambassadeur suspendu' : 'Ambassadeur réactivé'); router();
        });
        vue.querySelectorAll('[data-suspendre]').forEach((b) => b.addEventListener('click', () => statutAC(b.dataset.suspendre, 'suspendu')));
        vue.querySelectorAll('[data-reactiver]').forEach((b) => b.addEventListener('click', () => statutAC(b.dataset.reactiver, 'actif')));
      }
    };
  }

  async function reseauCommissions(params) {
    const s = params.get('statut') || 'validee';
    let q = sb.from('commissions').select('*, ambassadeurs(code, profils(nom_complet)), profils(nom_complet), commandes(campagnes(titre))')
      .order('cree_le', { ascending: false }).limit(200);
    if (s !== 'toutes') q = q.eq('statut', s);
    const { data, error } = await q;
    if (error) throw error;
    const nomAC = (c) => (c.ambassadeurs && c.ambassadeurs.profils && c.ambassadeurs.profils.nom_complet) || (c.profils_amb || {}).nom_complet || 'Ambassadeur';
    return {
      html: `
      <div class="filtres">${[['en_attente', 'En attente'], ['validee', 'Validées (à payer)'], ['payee', 'Payées'], ['annulee', 'Annulées'], ['toutes', 'Toutes']].map(([k, l]) =>
        `<button class="${k === s ? 'actif' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
      <div class="carte grille-lignes">${data.length ? data.map((c) => `
        <div class="ligne">
          <div style="flex:1;min-width:0"><div class="ligne-titre">${fcfa(c.montant)} · ${esc(lib(c.type))} · ${esc(nomAC(c))}</div>
            <small>${esc((c.commandes && c.commandes.campagnes && c.commandes.campagnes.titre) || '')} · client ${esc((c.profils && c.profils.nom_complet) || '')} · ${date(c.cree_le)}</small>
            ${c.motif ? `<small class="motif">${esc(c.motif)}</small>` : ''}</div>
          <div class="actions-ligne">${badge(c.statut)}
            ${['en_attente', 'validee'].includes(c.statut) ? `<button class="btn btn-ko btn-petit" data-annuler-com="${c.id}">Annuler</button>` : ''}</div>
        </div>`).join('') : '<p class="discret">Rien ici.</p>'}</div>
      <p class="aide">Les commissions sont créées automatiquement au paiement, validées à la remise du colis et payées depuis l'onglet Ambassadeurs.</p>`,
      brancher() {
        vue.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/reseau/commissions?statut=' + b.dataset.s; }));
        vue.querySelectorAll('[data-annuler-com]').forEach((b) => b.addEventListener('click', () => {
          const motif = prompt('Motif de l\'annulation (visible par l\'ambassadeur) :');
          if (!motif) return;
          occupe(b, async () => {
            const { error } = await sb.rpc('annuler_commission', { p_commission: b.dataset.annulerCom, p_motif: motif });
            if (error) toast(msgErreur(error), 'ko'); else { toast('Commission annulée'); router(); }
          });
        }));
      }
    };
  }

  async function reseauPoints() {
    const { data, error } = await sb.from('points_retrait').select('*, profils(nom_complet,telephone,email)').order('principal', { ascending: false }).order('nom');
    if (error) throw error;
    const formPoint = (p) => `
      <form class="form-point" data-id="${p ? p.id : ''}">
        <div class="rangee"><div><label>Nom</label><input name="nom" required value="${esc(p ? p.nom : '')}" placeholder="Ex. : Point Kara Centre"></div>
          <div><label>Région</label><input name="region" value="${esc(p ? p.region || '' : '')}" placeholder="Ex. : Kara"></div></div>
        <div class="rangee"><div><label>Ville</label><input name="ville" value="${esc(p ? p.ville || '' : '')}"></div>
          <div><label>Téléphone du point</label><input name="telephone" type="tel" value="${esc(p ? p.telephone || '' : '')}"></div></div>
        <label>Adresse / repère</label><input name="adresse" value="${esc(p ? p.adresse || '' : '')}" placeholder="Ex. : Grand marché, à côté de la pharmacie">
        <label>Horaires</label><input name="horaires" value="${esc(p ? p.horaires || '' : '')}" placeholder="Ex. : Lun-Sam 8h-18h">
        <label>Responsable (email ou numéro WhatsApp de son compte)</label>
        <input name="responsable" value="${esc(p && p.profils ? p.profils.email || p.profils.telephone || '' : '')}" placeholder="La personne doit avoir un compte sur le site">
        <label class="case-acceptation"><input type="checkbox" name="actif" ${!p || p.actif ? 'checked' : ''}> Point actif (proposé aux clients)</label>
        <button class="btn btn-petit">${p ? 'Enregistrer' : 'Créer le point'}</button>
      </form>`;
    return {
      html: `
      <div class="deux-colonnes"><div class="colonne">
        ${data.map((p) => `<div class="carte">
          <div style="display:flex;justify-content:space-between;gap:10px"><h2>${esc(p.nom)}</h2>${p.actif ? badge('actif') : '<span class="badge badge-neutre">Inactif</span>'}</div>
          <p class="discret">${esc([p.adresse, p.ville, p.region].filter(Boolean).join(' · ') || 'Adresse à compléter')}${p.horaires ? ' · ' + esc(p.horaires) : ''}</p>
          <p class="discret">Responsable : ${p.profils ? esc(p.profils.nom_complet || p.profils.email) : 'aucun (géré par l\'équipe)'}</p>
          ${estAdmin() ? `<details><summary class="lien-texte">Modifier</summary>${formPoint(p)}</details>` : ''}
          <a class="btn btn-second btn-petit" href="#/colis?point=${p.id}">Voir les colis</a>
        </div>`).join('')}
      </div><div class="colonne">
        ${estAdmin() ? `<div class="carte"><h2>Nouveau point de retrait</h2>${formPoint(null)}
          <p class="aide">Le responsable reçoit le rôle « Point de retrait » : il se connecte à l'espace équipe et ne voit que l'onglet Colis de son point.</p></div>` : ''}
      </div></div>`,
      brancher() {
        vue.querySelectorAll('.form-point').forEach((f) => f.addEventListener('submit', (ev) => {
          ev.preventDefault();
          occupe(f.querySelector('button'), async () => {
            const v = (n) => f.elements[n].value.trim();
            let responsable_id = null;
            if (v('responsable')) {
              const col = v('responsable').includes('@') ? 'email' : 'telephone';
              const val = col === 'email' ? v('responsable').toLowerCase() : normTel(v('responsable'));
              const { data: pr } = await sb.from('profils').select('id,role').ilike(col, val).maybeSingle();
              if (!pr) { toast('Aucun compte trouvé pour le responsable', 'ko'); return; }
              responsable_id = pr.id;
              if (pr.role === 'client') {
                const { error: er } = await sb.rpc('definir_role', { p_profil: pr.id, p_role: 'partenaire' });
                if (er) { toast(msgErreur(er), 'ko'); return; }
              }
            }
            const ligne = { nom: v('nom'), region: v('region') || null, ville: v('ville') || null, telephone: v('telephone') ? normTel(v('telephone')) : null,
                            adresse: v('adresse') || null, horaires: v('horaires') || null, responsable_id, actif: f.elements.actif.checked };
            const r = f.dataset.id ? await sb.from('points_retrait').update(ligne).eq('id', f.dataset.id) : await sb.from('points_retrait').insert(ligne);
            if (r.error) { toast(msgErreur(r.error), 'ko'); return; }
            toast('Point enregistré'); router();
          });
        }));
      }
    };
  }

  async function reseauBareme() {
    const [{ data: params, error }, { data: versements }, { count: nbModules }, { data: cond }] = await Promise.all([
      sb.from('parametres').select('*').order('cle'),
      sb.from('versements').select('*, ambassadeurs(code, profils(nom_complet)), points_retrait(nom)').order('paye_le', { ascending: false }).limit(50),
      sb.from('formation_modules').select('id', { count: 'exact', head: true }).eq('actif', true),
      sb.from('conditions_ac').select('version,publie_le').eq('en_vigueur', true).maybeSingle()
    ]);
    if (error) throw error;
    return {
      html: `
      <div class="deux-colonnes"><div class="colonne">
        <form class="carte" id="form-bareme"><h2>Barème</h2>
          <table class="tableau-bareme" style="width:100%"><tbody>${params.map((p) => `
            <tr><td>${esc(p.libelle)}</td><td><input type="number" min="0" step="1" data-cle="${esc(p.cle)}" value="${Number(p.valeur)}" ${estAdmin() ? '' : 'disabled'}></td></tr>`).join('')}</tbody></table>
          ${estAdmin() ? '<button class="btn" style="margin-top:12px">Enregistrer le barème</button>' : ''}
          <p class="aide">Un changement s'applique aux commissions créées après. Les commissions déjà enregistrées gardent leur montant.</p>
        </form>
        <div class="carte"><h2>Programme</h2>
          <p>${nbModules || 0} modules de formation actifs · conditions en vigueur : <b>${esc(cond ? cond.version : '—')}</b>${cond ? ' (publiées le ' + date(cond.publie_le) + ')' : ''}.</p>
          <p class="aide">Pour modifier un module ou publier une nouvelle version des conditions (les ambassadeurs devront la réaccepter), demandez-le à Claude ou modifiez les tables formation_modules et conditions_ac dans Supabase.</p></div>
      </div><div class="colonne">
        <div class="carte"><h2>Derniers versements</h2>
          <div class="grille-lignes">${(versements || []).length ? versements.map((v) => `
            <div class="ligne"><div style="flex:1;min-width:0"><div class="ligne-titre">${fcfa(v.montant)} · ${esc(v.ambassadeurs ? 'AC ' + ((v.ambassadeurs.profils && v.ambassadeurs.profils.nom_complet) || v.ambassadeurs.code) : 'Point ' + ((v.points_retrait && v.points_retrait.nom) || ''))}</div>
              <small>${date(v.paye_le, true)} · ${esc(lib(v.moyen))}${v.reference ? ' · réf. ' + esc(v.reference) : ''}</small></div></div>`).join('') : '<p class="discret">Aucun versement.</p>'}</div></div>
      </div></div>`,
      brancher() {
        const f = document.getElementById('form-bareme');
        if (f && estAdmin()) f.addEventListener('submit', (ev) => {
          ev.preventDefault();
          occupe(f.querySelector('button'), async () => {
            for (const i of f.querySelectorAll('[data-cle]')) {
              const { error: e } = await sb.from('parametres').update({ valeur: Number(i.value) }).eq('cle', i.dataset.cle);
              if (e) { toast(msgErreur(e), 'ko'); return; }
            }
            toast('Barème enregistré');
          });
        });
      }
    };
  }

  // Produits à l'étude, opérations, coûts, utilisateurs (operations.js)
  const ops = window.IP_OPS({ etat, vue, router: () => router(), estFinance, estAdmin, estStaff });

  demarrer();
})();
