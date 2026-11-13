// Import Public : espace équipe (back-office)
(function () {
  const { sb, cfg, fcfa, date, joursRestants, esc, normTel, waLien, lib, badge, jauge, msgErreur, toast, nomPays,
          compresserImage, urlImageCampagne, occupe, txtVariante } = window.IA;

  const vue = document.getElementById('vue');
  const etat = { session: null, profil: null, groupeur: null, canal: null };
  const notifs = window.IP_NOTIFS({ origine: 'equipe', getSession: () => etat.session,
    surNotif: (n) => { if (n.lien && n.lien.startsWith('#/messages')) majBadges(); } });
  const chat = window.IP_CHAT({ equipe: true });

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
      if (evt === 'SIGNED_IN' || evt === 'SIGNED_OUT') { etat.session = session; setTimeout(async () => { await chargerProfil(); router(); notifs.demarrer(); }, 0); }
    });
    notifs.demarrer();
    // Pastille « Messages » tenue à jour en direct
    if (etat.session) sb.channel('conv-equipe').on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => majBadges()).subscribe();
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
    const [p, d, c] = await Promise.all([
      estFinance() ? sb.from('paiements').select('id', { count: 'exact', head: true }).eq('statut', 'initie').or('agregateur.is.null,agregateur.neq.paygate') : Promise.resolve({ count: 0 }),
      sb.from('demandes').select('id', { count: 'exact', head: true }).eq('statut', 'nouvelle'),
      estSupport() ? sb.from('conversations').select('dernier_msg_le,lu_equipe_le').eq('dernier_de_equipe', false) : Promise.resolve({ data: [] })
    ]);
    const nonLus = (c.data || []).filter((x) => new Date(x.dernier_msg_le) > new Date(x.lu_equipe_le)).length;
    [['badge-paiements', p.count], ['badge-demandes', d.count], ['badge-messages', nonLus], ['badge-messages-bas', nonLus]].forEach(([id, n]) => {
      const el = document.getElementById(id); if (!el) return;
      el.textContent = n || ''; el.hidden = !n;
    });
  }
  const estStaff = () => etat.profil && ['admin', 'assistant', 'groupeur'].includes(etat.profil.role);
  const estAdmin = () => etat.profil && etat.profil.role === 'admin';
  // Paiements et chiffrage des devis : admin et assistants
  const estFinance = () => etat.profil && ['admin', 'assistant', 'groupeur'].includes(etat.profil.role);
  // Représentant = point de retrait : uniquement l'onglet Colis de son point (+ ses alertes)
  const estPartenaire = () => etat.profil && ['representant', 'partenaire'].includes(etat.profil.role);
  // Messagerie clients : admin et assistants (même règle que la base, est_support)
  const estSupport = () => etat.profil && ['admin', 'assistant'].includes(etat.profil.role);
  // Ce que chaque rôle peut ouvrir
  const peut = (onglet) => ({ accueil: estStaff(), campagnes: estStaff(), demandes: estStaff(),
                              paiements: estFinance(), colis: estStaff() || estPartenaire(),
                              reseau: estFinance(), reglages: estAdmin(), messages: estSupport(),
                              alertes: estStaff() || estPartenaire() }[onglet] || false);
  const tel = (p) => (p && p.telephone) || '';

  function router() {
    if (etat.canal) { sb.removeChannel(etat.canal); etat.canal = null; }
    const brut = location.hash.replace(/^#\/?/, '');
    const [chemin, qs] = brut.split('?');
    const m = chemin.split('/').filter(Boolean);
    const params = new URLSearchParams(qs || '');

    const accesEquipe = estStaff() || estPartenaire();
    document.getElementById('nav').hidden = !accesEquipe;
    document.getElementById('nav-haut').hidden = !accesEquipe;
    const I = window.ICO;
    document.getElementById('entete-compte').innerHTML = etat.session
      ? `<span id="cloche"></span>${estStaff() && etat.niveauData ? `<a class="lien-data" href="${cfg.urlData}" target="_blank" rel="noopener">${I.graphique}<span>Analyses</span></a>` : ''}
         <span class="lien-compte">${I.utilisateur}<span>${esc(((etat.profil && etat.profil.nom_complet) || etat.session.user.email).split(' ')[0])}</span></span>
         <button class="btn btn-second btn-petit" id="sortir" aria-label="Se déconnecter">${I.sortie}<span class="txt-sortir">Sortir</span></button>` : '';
    notifs.dessinerCloche();
    if (estStaff()) majBadges();
    document.querySelector('.puce-equipe').textContent = estPartenaire() ? 'Représentant' : 'Équipe';
    const s = document.getElementById('sortir');
    if (s) s.addEventListener('click', () => sb.auth.signOut());

    if (!accesEquipe) return vueConnexion();

    // Menus visibles selon le rôle
    document.querySelectorAll('.nav-bas a, .nav-haut a').forEach((a) => { a.hidden = !peut(a.dataset.onglet); });
    const nb = document.querySelectorAll('.nav-bas a:not([hidden])').length;
    document.getElementById('nav').style.gridTemplateColumns = `repeat(${nb}, minmax(64px, 1fr))`;

    const onglet = { '': 'accueil', paiements: 'paiements', campagnes: 'campagnes', campagne: 'campagnes', 'bon-commande': 'campagnes', pistes: 'campagnes', piste: 'campagnes',
                     demandes: 'demandes', demande: 'demandes', colis: 'colis', reseau: 'reseau', reglages: 'reglages', utilisateurs: 'reglages',
                     messages: 'messages', alertes: 'alertes' }[m[0] || ''];
    if (estPartenaire() && onglet !== 'colis' && onglet !== 'alertes') { location.hash = '#/colis'; return; }
    document.querySelectorAll('.nav-bas a, .nav-haut a').forEach((a) => a.classList.toggle('actif', a.dataset.onglet === onglet));
    window.scrollTo(0, 0);
    if (onglet && !peut(onglet)) { location.hash = '#/'; return; }
    const routes = { '': vueAccueil, paiements: vuePaiements, campagnes: vueCampagnes, campagne: vueCampagne,
                     demandes: vueDemandes, demande: vueDemande, colis: vueColis, reseau: vueReseau, reglages: vueReglages,
                     pistes: ops.vuePistes, piste: ops.vuePiste, utilisateurs: ops.vueUtilisateurs,
                     messages: vueMessages, alertes: vueAlertes, document: vueDocument, 'bon-commande': vueBonCommande };
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
      compte(sb.from('paiements').select('id', { count: 'exact', head: true }).eq('statut', 'initie').or('agregateur.is.null,agregateur.neq.paygate')),
      compte(sb.from('demandes').select('id', { count: 'exact', head: true }).eq('statut', 'nouvelle')),
      compte(sb.from('demandes').select('id', { count: 'exact', head: true }).eq('statut', 'acceptee')),
      compte(sb.from('campagnes').select('id', { count: 'exact', head: true }).eq('statut', 'ouverte')),
      compte(sb.from('commandes').select('id', { count: 'exact', head: true }).eq('statut', 'a_rembourser')),
      sb.from('campagnes').select('id,titre,statut,quota,quantite_payee,nb_clients,date_cloture,image_url,prix_unitaire,prix_reference')
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
        ${c.image_url ? `<img src="${esc(urlImageCampagne(c.image_url))}" alt="" loading="lazy">`
          : `<span class="dm-sans-photo" style="background:linear-gradient(145deg,#fff3ea,#f6e3d3)"><span class="dm-cube">${I.colis}</span><small>Ajoutez des photos</small></span>`}
        <span class="pastille-statut">${badge(c.statut)}</span>
        ${c.prix_reference > c.prix_unitaire && (1 - c.prix_unitaire / c.prix_reference) >= .05 ? `<span class="cp-remise" style="top:auto;bottom:10px">-${Math.round(100 * (1 - c.prix_unitaire / c.prix_reference))} %</span>` : ''}
        ${c.statut === 'ouverte' ? `<span class="pastille-delai">${esc(joursRestants(c.date_cloture))}</span>` : ''}</a>
      <div class="campagne-corps">
        <a class="campagne-titre" href="#/campagne/${c.id}">${esc(c.titre)}</a>
        ${window.IA.blocPrix(c)}
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
    // Les paiements en ligne (PayGate) se confirment seuls : on n'affiche pas les tentatives en attente ni les tentatives expirées
    const filtres = statut === 'confirme' ? data : data.filter((p) => p.agregateur !== 'paygate');
    data.length = 0; data.push(...filtres);

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
          <div class="ref">${esc(p.reference_externe || '')}${p.agregateur === 'paygate' ? ' <span class="badge badge-ok">Payé en ligne, vérifié</span>' : ''}</div>
          <small>${esc(lib(p.operateur))} · payé par ${esc(p.numero_payeur || '-')} · ${date(p.created_at, true)}</small>
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
  async function vueCampagnes(_, params) {
    const memoVue = (v) => { try { if (v) localStorage.setItem('ip_vue_campagnes', v); return localStorage.getItem('ip_vue_campagnes'); } catch { return v; } };
    const mode = params.get('vue') || memoVue() || 'galerie';
    const f = params.get('f') || 'toutes';
    const { data, error } = await sb.from('campagnes')
      .select('id,titre,statut,quota,quantite_payee,nb_clients,date_cloture,image_url,prix_unitaire,prix_reference,mode_transport,type_prix')
      .order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    const GROUPES = { brouillon: ['brouillon'], ouvertes: ['ouverte'], en_cours: ['quota_atteint', 'commandee', 'entrepot_chine', 'en_transit', 'arrivee'],
                      finies: ['terminee', 'echec_quota'] };
    const filtres = [['toutes', 'Toutes'], ['ouvertes', 'Ouvertes'], ['brouillon', 'Brouillons'], ['en_cours', 'En route'], ['finies', 'Terminées']];
    const garde = (c, k) => k === 'toutes' || (GROUPES[k] || []).includes(c.statut);
    const liste = data.filter((c) => garde(c, f));
    const pct = (c) => Math.min(100, Math.round(100 * (c.quantite_payee || 0) / (c.quota || 1)));
    const visuel = (c, cls) => c.image_url
      ? `<img class="${cls}" src="${esc(urlImageCampagne(c.image_url))}" alt="" loading="lazy">`
      : `<span class="${cls} dm-sans-photo"><span class="dm-cube">${window.ICO.colis}</span><small>Ajoutez des photos</small></span>`;
    const prix = (c) => `<span class="cp-prix"><b>${fcfa(c.prix_unitaire)}</b>${c.prix_reference > c.prix_unitaire ? `<s>${fcfa(c.prix_reference)}</s>` : ''}</span>`;
    const remise = (c) => c.prix_reference > c.prix_unitaire ? Math.round(100 * (1 - c.prix_unitaire / c.prix_reference)) : 0;
    const jaugeC = (c) => `<span class="cp-jauge"><span class="cp-barre"><span style="width:${pct(c)}%"></span></span>
      <small><b>${c.quantite_payee || 0}</b> / ${c.quota} payés · ${pct(c)} %</small></span>`;
    const puces = (c) => `<span class="dm-puce">${c.mode_transport === 'maritime' ? '🚢 Bateau' : '✈️ Avion'}</span>
      <span class="dm-puce">${window.ICO.personnes}${c.nb_clients || 0} client${(c.nb_clients || 0) > 1 ? 's' : ''}</span>
      ${['brouillon', 'ouverte'].includes(c.statut) ? `<span class="dm-puce">⏳ ${esc(joursRestants(c.date_cloture))}</span>` : ''}`;

    const galerie = () => `<div class="dm-galerie">${liste.map((c) => `
      <a class="dm-carte" href="#/campagne/${c.id}">
        <span class="dm-visuel">${visuel(c, 'dm-photo')}<span class="dm-badge">${badge(c.statut)}</span>
          ${remise(c) >= 5 ? `<span class="cp-remise">-${remise(c)} %</span>` : ''}</span>
        <span class="dm-corps">
          <b class="dm-titre">${esc(c.titre)}</b>
          ${window.IA.blocPrix(c, true)}
          ${jaugeC(c)}
          <span class="dm-puces">${puces(c)}</span>
        </span></a>`).join('')}</div>`;
    const lignes = () => `<div class="dm-liste">${liste.map((c) => `
      <a class="dm-ligne" href="#/campagne/${c.id}">
        ${visuel(c, 'dm-mini')}
        <span class="dm-ligne-txt"><b class="dm-titre">${esc(c.titre)}</b>${jaugeC(c)}<span class="dm-puces">${puces(c)}</span></span>
        <span class="dm-ligne-fin">${badge(c.statut)}${prix(c)}<span class="dm-chevron">›</span></span></a>`).join('')}</div>`;

    vue.innerHTML = `${ops.ongletsCampagnes('campagnes')}
      <div class="dm-entete"><h1>Campagnes</h1>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <div class="dm-vues" role="group" aria-label="Affichage">
          <button data-vue="galerie" class="${mode === 'galerie' ? 'actif' : ''}"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg>Galerie</button>
          <button data-vue="liste" class="${mode === 'liste' ? 'actif' : ''}"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="5" height="5" rx="1.5"/><rect x="3" y="15" width="5" height="5" rx="1.5"/><path d="M11 6h10M11 9h6M11 17h10M11 20h6"/></svg>Liste</button>
        </div>
        <a class="btn btn-petit" href="#/campagne/nouvelle">+ Nouvelle</a></div></div>
      <div class="filtres">${filtres.map(([k, l]) => `<button class="${k === f ? 'actif' : ''}" data-f="${k}">${l}<span class="dm-compte">${data.filter((c) => garde(c, k)).length}</span></button>`).join('')}</div>
      ${liste.length ? (mode === 'liste' ? lignes() : galerie())
        : `<div class="carte vide"><span class="dm-cube grand">${window.ICO.colis}</span><p>${data.length ? 'Aucune campagne dans ce filtre.' : 'Aucune campagne. Créez la première, ou partez d\'un produit à l\'étude.'}</p></div>`}`;
    vue.querySelectorAll('img.dm-photo, img.dm-mini').forEach((im) => im.addEventListener('error', () => {
      const r = document.createElement('span'); r.className = im.className + ' dm-sans-photo';
      r.innerHTML = `<span class="dm-cube">${window.ICO.colis}</span><small>Photo indisponible</small>`; im.replaceWith(r);
    }));
    vue.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/campagnes?' + new URLSearchParams({ f: b.dataset.f, vue: mode }); }));
    vue.querySelectorAll('[data-vue]').forEach((b) => b.addEventListener('click', () => {
      memoVue(b.dataset.vue); location.hash = '#/campagnes?' + new URLSearchParams({ f, vue: b.dataset.vue });
    }));
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
        <div class="boutons" style="margin-top:10px">
          ${!['brouillon', 'echec_quota'].includes(c.statut) ? `<a class="btn btn-second btn-petit" href="#/bon-commande/${c.id}">${window.ICO.fichier}Bon de commande fournisseur</a>` : ''}
          ${c.id && estAdmin() ? `<button type="button" class="btn btn-lien btn-petit btn-supprimer" id="supprimer-campagne">🗑 Supprimer la campagne</button>` : ''}
        </div>
        ${['quota_atteint', 'commandee', 'entrepot_chine', 'en_transit', 'arrivee'].includes(c.statut) ? blocRetard() : ''}
        ${c.id && c.statut !== 'brouillon' ? blocDouane(c.frais_douane_unitaire, true) : ''}
        ${['ouverte', 'brouillon'].includes(c.statut) ? `<div class="bloc-delai-eq">
            <b>Clôture : ${esc(date(c.date_cloture, true))}</b> <span class="discret">(${esc(joursRestants(c.date_cloture))})</span>
            <div class="boutons"><button type="button" class="btn btn-second btn-petit" data-prolonger="7">+7 jours</button>
              <button type="button" class="btn btn-second btn-petit" data-prolonger="14">+14 jours</button>
              <button type="button" class="btn btn-second btn-petit" data-prolonger="autre">Autre date…</button></div>
            <div class="aide">Le compte à rebours affiché aux clients se met à jour tout de suite.</div></div>` : ''}
        ${['quota_atteint', 'commandee', 'entrepot_chine', 'en_transit', 'arrivee', 'terminee', 'echec_quota'].includes(c.statut) ? `<details class="bloc-retard">
            <summary class="lien-texte">Relancer cette campagne</summary>
            <form id="form-relancer"><p class="discret">Une nouvelle campagne identique (photos, prix, description) est créée, avec un compteur remis à zéro. Celle-ci continue normalement.</p>
              <label for="rl-cloture">Nouvelle date de clôture</label><input id="rl-cloture" type="datetime-local" required>
              <label class="case-acceptation"><input type="checkbox" id="rl-publier" checked> Publier tout de suite (alerte « Nouvelle campagne » à tous les clients)</label>
              <button class="btn" style="margin-top:8px">Relancer la campagne</button></form></details>` : ''}
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
        <label for="img">Photos du produit <small class="discret">(jusqu'à 10 · la 1re est la couverture)</small></label>
        <div class="photos-edit" id="photos-edit"></div>
        <input id="img" type="file" accept="image/*" multiple hidden>
        <button type="button" class="btn btn-second" id="ajout-photos">📷 Ajouter des photos</button>
        <div class="aide">Montrez le produit sous tous ses angles : face, côté, plié, détails, dimensions, emballage. Touchez une photo pour en faire la couverture.</div>
        <div class="rangee">
          <div><label for="prix">Prix unitaire (F)</label><input id="prix" type="number" inputmode="numeric" min="1" required value="${esc(c.prix_unitaire)}"></div>
          <div><label for="tp">Prix</label><select id="tp"><option value="TTC" ${c.type_prix === 'TTC' ? 'selected' : ''}>Transport inclus (hors taxes)</option>
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
        <div class="aide">C'est l'argument n° 1 : il s'affiche barré, avec « Vous économisez X F ». Mettez un prix que vous avez réellement relevé (boutique, marché, page Facebook d'un vendeur de Lomé) et gardez la preuve (photo, capture).</div>
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

    // Photos : existantes (chemins) + nouvelles (fichiers), dans l'ordre affiché
    const fichier = document.getElementById('img');
    let photos = (Array.isArray(c.images) && c.images.length ? c.images : (c.image_url ? [c.image_url] : []))
      .map((ch) => ({ chemin: ch, url: urlImageCampagne(ch) }));
    const dessinerPhotos = () => {
      const z = document.getElementById('photos-edit');
      z.innerHTML = photos.length ? photos.map((p, i) => `<div class="photo-edit${i === 0 ? ' couverture' : ''}" data-i="${i}">
          <img src="${esc(p.url)}" alt="">${i === 0 ? '<span class="photo-couv">Couverture</span>' : ''}
          <button type="button" class="photo-suppr" data-suppr="${i}" aria-label="Retirer la photo">✕</button></div>`).join('')
        : '<p class="discret" style="margin:0">Aucune photo pour l\'instant.</p>';
      z.querySelectorAll('[data-suppr]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation(); photos.splice(Number(b.dataset.suppr), 1); dessinerPhotos();
      }));
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
      const refus = [];
      for (let f of liste) {
        if (photos.length >= 10) { toast('10 photos au maximum'); break; }
        // Vérification immédiate : une photo illisible est signalée tout de suite, pas au moment d'enregistrer
        if (!(await window.IA.imageLisible(f))) {
          if (window.IA.estHeic(f)) {
            toast('Conversion de la photo iPhone…');
            const j = await window.IA.convertirHeic(f).catch(() => null);
            if (j) f = new File([j], (f.name || 'photo').replace(/\.(heic|heif)$/i, '') + '.jpg', { type: 'image/jpeg' });
            else { refus.push(f); continue; }
          } else { refus.push(f); continue; }
        }
        photos.push({ fichier: f, url: URL.createObjectURL(f) });
      }
      if (refus.length) toast(`Photo illisible : ${refus.map((f) => `${f.name} (${f.type || 'format inconnu'})`).join(', ')}. Enregistrez-la en JPG ou PNG (ouvrez-la puis « Enregistrer sous », ou faites une capture d'écran) et réessayez.`, 'ko');
      dessinerPhotos();
    });

    // Enregistrement
    document.getElementById('form-c').addEventListener('submit', (ev) => {
      ev.preventDefault();
      occupe(ev.target.querySelector('button.btn-large'), async () => {
        const images = [];
        for (const [i, p] of photos.entries()) {
          if (p.chemin) { images.push(p.chemin); continue; }
          const blob = await compresserImage(p.fichier, 1400, 0.82);
          const type = blob.type || 'image/jpeg';
          const ext = { 'image/png': 'png', 'image/webp': 'webp' }[type] || 'jpg';
          const chemin = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
          const up = await sb.storage.from('campagnes').upload(chemin, blob, { contentType: type });
          if (up.error) { toast('Photo ' + (i + 1) + ' non envoyée : ' + msgErreur(up.error), 'ko'); return; }
          p.chemin = chemin; images.push(chemin);
        }
        const image_url = images[0] || null;
        const val = (x) => document.getElementById(x).value;
        const ligne = {
          titre: val('titre').trim(), description: val('desc').trim() || null, image_url, images,
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
        toast(images.length ? `Enregistré avec ${images.length} photo${images.length > 1 ? 's' : ''}` : 'Enregistré');
        if (nouvelle) location.hash = '#/campagne/' + r.data.id; else router();
      });
    });

    if (nouvelle) return;
    sections.brancher();
    brancherRetard(c.id, null);
    brancherDouane(c.id, null);
    const bSupC = document.getElementById('supprimer-campagne');
    if (bSupC) bSupC.addEventListener('click', () => {
      const saisie = prompt(`Supprimer définitivement « ${c.titre} » ?\n\nLa campagne, ses commandes non payées et ses photos seront effacées. C'est irréversible. Impossible si un paiement a été reçu.\n\nTapez SUPPRIMER pour confirmer :`);
      if (saisie === null) return;
      if (saisie.trim().toUpperCase() !== 'SUPPRIMER') { toast('Suppression annulée : il fallait taper SUPPRIMER', 'ko'); return; }
      occupe(bSupC, async () => {
        const { data, error: e } = await sb.rpc('supprimer_campagne', { p_campagne: c.id });
        if (e) { toast(msgErreur(e), 'ko'); return; }
        if (data && data.images && data.images.length) await sb.storage.from('campagnes').remove(data.images);
        toast('Campagne supprimée');
        location.hash = '#/campagnes';
      });
    });
    // Prolonger une campagne ouverte
    vue.querySelectorAll('[data-prolonger]').forEach((b) => b.addEventListener('click', () => {
      let fin;
      if (b.dataset.prolonger === 'autre') {
        const v = prompt('Nouvelle date de clôture (JJ/MM/AAAA) :', new Date(c.date_cloture).toLocaleDateString('fr-FR'));
        if (!v) return;
        const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!m) { toast('Format attendu : JJ/MM/AAAA', 'ko'); return; }
        fin = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 20, 0);
      } else {
        fin = new Date(Math.max(new Date(c.date_cloture).getTime(), Date.now()) + Number(b.dataset.prolonger) * 86400000);
      }
      occupe(b, async () => {
        const { error: e } = await sb.rpc('prolonger_campagne', { p_campagne: c.id, p_cloture: fin.toISOString() });
        if (e) { toast(msgErreur(e), 'ko'); return; }
        toast('Clôture repoussée au ' + fin.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })); router();
      });
    }));
    // Relancer une campagne clôturée
    const fr = document.getElementById('form-relancer');
    if (fr) {
      const dflt = new Date(Date.now() + 14 * 86400000); dflt.setHours(20, 0, 0, 0);
      document.getElementById('rl-cloture').value = local(dflt.toISOString());
      fr.addEventListener('submit', (ev) => {
        ev.preventDefault();
        occupe(fr.querySelector('button'), async () => {
          const { data: nid, error: e } = await sb.rpc('relancer_campagne', { p_campagne: c.id,
            p_cloture: new Date(document.getElementById('rl-cloture').value).toISOString(), p_publier: document.getElementById('rl-publier').checked });
          if (e) { toast(msgErreur(e), 'ko'); return; }
          toast('Campagne relancée'); location.hash = '#/campagne/' + nid;
        });
      });
    }

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
      const motif = prompt('Annuler cette commande non payée ?\nMotif communiqué au client (facultatif) :', '');
      if (motif === null) return;
      occupe(b, async () => {
        const { error } = await sb.from('commandes').update({ statut: 'annulee', motif_annulation: motif.trim() || null }).eq('id', b.dataset.annuler);
        if (error) toast(msgErreur(error), 'ko'); else { toast('Commande annulée'); router(); }
      });
    }));
    vue.querySelectorAll('[data-retirer-cmd]').forEach((b) => b.addEventListener('click', () => {
      const motif = prompt('Retirer cette commande payée ? Elle passera « à rembourser » et le client recevra un avis d\'annulation.\nMotif communiqué au client :', '');
      if (motif === null) return;
      occupe(b, async () => {
        const { error } = await sb.from('commandes').update({ statut: 'a_rembourser', motif_annulation: motif.trim() || null }).eq('id', b.dataset.retirerCmd);
        if (error) toast(msgErreur(error), 'ko'); else { toast('Commande retirée, à rembourser'); router(); }
      });
    }));
    vue.querySelectorAll('[data-rembourser]').forEach((b) => b.addEventListener('click', () => {
      const ref = prompt('Le client a bien été remboursé ?\nRéférence de la transaction de remboursement (T-Money / Flooz), affichée sur son avis :', '');
      if (ref === null) return;
      occupe(b, async () => {
        const { data: pp } = await sb.from('paiements').select('id').eq('commande_id', b.dataset.rembourser).eq('statut', 'confirme');
        for (const p of pp || []) {
          const { error } = await sb.rpc('marquer_rembourse', { p_paiement: p.id, p_reference: ref.trim() || null });
          if (error) { toast(msgErreur(error), 'ko'); return; }
        }
        if (!(pp || []).length) await sb.from('commandes').update({ statut: 'remboursee' }).eq('id', b.dataset.rembourser);
        toast('Remboursement enregistré · avis envoyé au client'); router();
      });
    }));
  }

  // ------------------------------------------------------------------
  // Demandes sur mesure
  // ------------------------------------------------------------------
  async function vueDemandes(_, params) {
    const recherche = (params.get('q') || '').trim();
    const statut = recherche ? 'toutes' : (params.get('statut') || 'nouvelle');
    const memoVue = (v) => { try { if (v) localStorage.setItem('ip_vue_demandes', v); return localStorage.getItem('ip_vue_demandes'); } catch { return v; } };
    const mode = params.get('vue') || memoVue() || 'galerie';
    let q = sb.from('demandes').select('id,description,statut,quantite,budget,montant_devis,created_at,photo_path,mode_transport,relance_wa_a_faire,profils(nom_complet,telephone)')
      .order('created_at', { ascending: false }).limit(100);
    if (recherche) {
      const { data: ids, error: eR } = await sb.rpc('chercher_demandes', { p_texte: recherche });
      if (eR) throw eR;
      q = q.in('id', (ids || []).map((x) => (typeof x === 'object' ? Object.values(x)[0] : x)).concat(['00000000-0000-0000-0000-000000000000']));
    } else if (statut === 'en_cours') q = q.in('statut', ['payee', 'commandee', 'entrepot_chine', 'en_transit', 'arrivee']);
    else if (statut !== 'toutes') q = q.eq('statut', statut);
    const [{ data, error }, { data: tous }] = await Promise.all([q, sb.from('demandes').select('statut').limit(1000)]);
    if (error) throw error;
    // Liens et images trouvés par l'équipe (équipe seulement)
    const sources = {};
    const imagesEquipe = {};
    if (data.length) {
      const { data: src } = await sb.from('demandes_sources').select('demande_id,lien,image_path').in('demande_id', data.map((d) => d.id));
      const imgs = (src || []).filter((x) => x.image_path);
      const signees = {};
      if (imgs.length) {
        const { data: u } = await sb.storage.from('sources').createSignedUrls(imgs.map((x) => x.image_path), 3600);
        (u || []).forEach((x) => { if (x && x.signedUrl) signees[x.path] = x.signedUrl; });
      }
      (src || []).forEach((x) => {
        if (x.lien) sources[x.demande_id] = x.lien;
        if (x.image_path && signees[x.image_path]) imagesEquipe[x.demande_id] = signees[x.image_path];
      });
    }
    // Miniatures : une seule requête pour toutes les photos
    const chemins = data.map((d) => d.photo_path).filter(Boolean);
    const photos = {};
    if (chemins.length) {
      const { data: urls } = await sb.storage.from('demandes').createSignedUrls(chemins, 3600);
      (urls || []).forEach((u) => { if (u && u.signedUrl) photos[u.path] = u.signedUrl; });
    }
    const nb = (k) => (tous || []).filter((x) => k === 'toutes' ? true : k === 'en_cours'
      ? ['payee', 'commandee', 'entrepot_chine', 'en_transit', 'arrivee'].includes(x.statut) : x.statut === k).length;
    const filtres = [['nouvelle', 'À chiffrer'], ['devis_envoye', 'Devis envoyés'], ['acceptee', 'À payer'], ['en_cours', 'En cours'], ['toutes', 'Toutes']];
    const initiales = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
    const visuel = (d, cls) => imagesEquipe[d.id] || photos[d.photo_path]
      ? `<img class="${cls}" src="${esc(imagesEquipe[d.id] || photos[d.photo_path])}" alt="" loading="lazy">`
      : `<span class="${cls} dm-sans-photo"><span class="dm-cube">${window.ICO.colis}</span><small>Pas de photo</small></span>`;
    const prix = (d) => d.montant_devis ? `<b class="dm-prix">${fcfa(d.montant_devis)}</b>` : d.budget ? `<span class="dm-budget">Budget ${fcfa(d.budget)}</span>` : '';
    const puces = (d) => `<span class="dm-puce">${window.ICO.colis}${d.quantite} pièce${d.quantite > 1 ? 's' : ''}</span>
      ${d.mode_transport ? `<span class="dm-puce">${d.mode_transport === 'aerien' ? '✈️' : '🚢'} ${esc(lib(d.mode_transport))}</span>` : ''}
      ${d.relance_wa_a_faire ? '<span class="dm-puce dm-alerte">Relance WhatsApp</span>' : ''}
      ${sources[d.id] ? '<span class="dm-puce dm-source" title="Lien fournisseur vérifié enregistré">🔗 Lien fournisseur</span>' : ''}`;
    const client = (d) => `<span class="dm-client"><span class="dm-avatar">${esc(initiales(d.profils && d.profils.nom_complet))}</span>
      <span><b>${esc((d.profils && d.profils.nom_complet) || 'Client')}</b><small>${esc(date(d.created_at, true))}</small></span></span>`;

    const galerie = () => `<div class="dm-galerie">${data.map((d) => `
      <a class="dm-carte" href="#/demande/${d.id}">
        <span class="dm-visuel">${visuel(d, 'dm-photo')}<span class="dm-badge">${badge(d.statut)}</span></span>
        <span class="dm-corps">
          <b class="dm-titre">${esc(d.description)}</b>
          <span class="dm-puces">${puces(d)}</span>
          <span class="dm-pied">${client(d)}${prix(d)}</span>
        </span></a>`).join('')}</div>`;
    const liste = () => `<div class="dm-liste">${data.map((d) => `
      <a class="dm-ligne" href="#/demande/${d.id}">
        ${visuel(d, 'dm-mini')}
        <span class="dm-ligne-txt"><b class="dm-titre">${esc(d.description)}</b>
          <span class="dm-puces">${puces(d)}</span>${client(d)}</span>
        <span class="dm-ligne-fin">${badge(d.statut)}${prix(d)}<span class="dm-chevron">›</span></span></a>`).join('')}</div>`;

    vue.innerHTML = `<div class="dm-entete"><h1>Sur mesure</h1>
        <div class="dm-vues" role="group" aria-label="Affichage">
          <button data-vue="galerie" class="${mode === 'galerie' ? 'actif' : ''}" aria-label="Vue galerie"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg>Galerie</button>
          <button data-vue="liste" class="${mode === 'liste' ? 'actif' : ''}" aria-label="Vue liste"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="5" height="5" rx="1.5"/><rect x="3" y="15" width="5" height="5" rx="1.5"/><path d="M11 6h10M11 9h6M11 17h10M11 20h6"/></svg>Liste</button>
        </div></div>
      <form class="dm-recherche" id="dm-recherche" role="search">
        <input id="dm-q" type="search" value="${esc(recherche)}" placeholder="Retrouver un produit déjà demandé : mot de la description, du lien ou de la note…" aria-label="Rechercher une demande">
        <button class="btn btn-second">Chercher</button>
        ${recherche ? '<a class="btn btn-lien" href="#/demandes?statut=nouvelle">Effacer</a>' : ''}
      </form>
      ${recherche ? `<p class="discret">${data.length} résultat${data.length > 1 ? 's' : ''} pour « ${esc(recherche)} », tous statuts confondus.</p>`
        : `<div class="filtres">${filtres.map(([k, l]) => `<button class="${k === statut ? 'actif' : ''}" data-s="${k}">${l}<span class="dm-compte">${nb(k)}</span></button>`).join('')}</div>`}
      ${data.length ? (mode === 'liste' ? liste() : galerie()) : `<div class="carte vide"><span class="dm-cube grand">${window.ICO.colis}</span><p>Aucune demande ici.</p></div>`}`;
    document.getElementById('dm-recherche').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = document.getElementById('dm-q').value.trim();
      location.hash = '#/demandes?' + new URLSearchParams(v ? { q: v } : { statut: 'nouvelle' });
    });
    // Photo illisible : on affiche le colis à la place
    vue.querySelectorAll('img.dm-photo, img.dm-mini').forEach((im) => im.addEventListener('error', () => {
      const r = document.createElement('span');
      r.className = im.className + ' dm-sans-photo';
      r.innerHTML = `<span class="dm-cube">${window.ICO.colis}</span><small>Photo indisponible</small>`;
      im.replaceWith(r);
    }));
    vue.querySelectorAll('.filtres button').forEach((b) => b.addEventListener('click', () => { location.hash = '#/demandes?statut=' + b.dataset.s; }));
    vue.querySelectorAll('[data-vue]').forEach((b) => b.addEventListener('click', () => {
      memoVue(b.dataset.vue); location.hash = '#/demandes?' + new URLSearchParams({ statut, vue: b.dataset.vue });
    }));
  }

  async function vueDemande(id) {
    if (etat.canal) { sb.removeChannel(etat.canal); etat.canal = null; }
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
    const [{ data: docs }, { data: paies }, { data: source }] = await Promise.all([
      sb.from('documents').select('id,numero,type,total,remplace,cree_le').eq('demande_id', d.id).order('cree_le', { ascending: false }),
      sb.from('paiements').select('id,montant,statut,operateur,numero_payeur').eq('demande_id', d.id),
      estSupport() ? sb.from('demandes_sources').select('lien,note,image_path,maj_le,profils(nom_complet)').eq('demande_id', d.id).maybeSingle() : Promise.resolve({ data: null })
    ]);
    const src = source || {};
    const imgEquipe = src.image_path ? (await sb.storage.from('sources').createSignedUrl(src.image_path, 3600)).data : null;
    const ouvrable = (u) => /^https?:\/\//i.test(u || '');
    const blocSource = estSupport() ? `<form class="carte carte-interne" id="form-source">
        <div class="interne-tete"><h2>🔗 Lien fournisseur vérifié</h2><span class="badge-interne">Équipe seulement</span></div>
        <p class="discret">Le bon lien, celui où vous achetez vraiment (ou le lien corrigé si celui du client ne marche pas). Le client ne le voit jamais. Il reste enregistré : retrouvez-le plus tard avec la recherche de « Sur mesure ».</p>
        <label for="src-lien">Lien valide</label>
        <div class="src-ligne"><input id="src-lien" type="url" inputmode="url" placeholder="https://detail.1688.com/…" value="${esc(src.lien || '')}">
          ${ouvrable(src.lien) ? `<a class="btn btn-second" href="${esc(src.lien)}" target="_blank" rel="noopener">Ouvrir</a>` : ''}</div>
        <label>Image du produit trouvé</label>
        <div class="src-image">
          ${imgEquipe ? `<a href="${esc(imgEquipe.signedUrl)}" target="_blank" rel="noopener"><img src="${esc(imgEquipe.signedUrl)}" alt="Produit trouvé"></a>` : '<span class="src-vide">Aucune image</span>'}
          <div class="src-image-actions">
            <button type="button" class="btn btn-second btn-petit" id="src-img-btn">${imgEquipe ? 'Remplacer l\'image' : '📷 Ajouter une image'}</button>
            ${imgEquipe ? '<button type="button" class="btn btn-lien btn-petit" id="src-img-suppr">Retirer</button>' : ''}
            <input id="src-img" type="file" accept="image/*" hidden>
          </div>
        </div>
        <p class="aide" style="margin-top:4px">Elle remplace la photo du client dans vos vues Sur mesure. Le client ne la voit pas.</p>
        <label for="src-note">Note interne (facultatif)</label>
        <textarea id="src-note" rows="3" placeholder="Ex. : fournisseur Yiwu Xinda, 12 ¥ / pièce dès 50, couleur noire réf. A-302, contact WeChat…">${esc(src.note || '')}</textarea>
        ${src.maj_le ? `<p class="aide">Modifié le ${esc(date(src.maj_le, true))}${src.profils && src.profils.nom_complet ? ' par ' + esc(src.profils.nom_complet) : ''}.</p>` : ''}
        <button class="btn" style="margin-top:10px">Enregistrer le lien</button>
      </form>` : '';
    const devis = (docs || []).find((x) => x.type === 'devis' && !x.remplace);
    const aRembourser = d.statut === 'annulee' ? (paies || []).filter((p) => p.statut === 'confirme') : [];
    const prenom = (cl.nom_complet || '').split(' ')[0] || '';
    const texteWa = (n) => `Bonjour ${prenom},\n\nNous revenons vers vous au sujet de votre devis${devis ? ' n° ' + devis.numero : ''} pour « ${(d.description || '').slice(0, 60)} », d'un montant de ${fcfa(d.montant_devis)} hors taxes. Les frais de douane et de livraison vous seront communiqués une fois votre colis arrivé à Lomé.\n\n`
      + `Vous pouvez le retrouver dans votre messagerie Import Public pour le consulter, nous poser vos questions ou procéder au paiement :\n${cfg.urlSite.replace(/^https?:\/\//, '')}/#/messages\n\n`
      + `${n >= 4 ? 'Sans nouvelle de votre part, nous clôturerons cette demande dans quelques jours.\n\n' : ''}Merci et à bientôt,\n\nL'équipe Import Public`;
    const opt = (vals, cur, fmt) => vals.map((v) => `<option value="${v}"${Number(cur) === v ? ' selected' : ''}>${fmt(v)}</option>`).join('');
    const blocRelances = d.statut === 'devis_envoye' ? `<div class="carte relances-etat">
        <h2>Relances du devis</h2>
        ${d.relance_wa_a_faire ? `<div class="alerte alerte-alerte">Relance n° ${d.relance_wa_a_faire} à envoyer sur WhatsApp.</div>
          ${cl.telephone ? `<a class="btn btn-wa btn-large" id="relance-wa" target="_blank" rel="noopener" href="${waLien(cl.telephone, texteWa(d.relance_wa_a_faire))}">Envoyer la relance WhatsApp</a>` : '<p class="discret">Pas de numéro WhatsApp pour ce client.</p>'}
          <button class="btn btn-second" id="relance-wa-faite">J'ai envoyé la relance</button>` : ''}
        <p>${d.relances_prevues ? `${d.relances_faites} / ${d.relances_prevues} relance(s) faite(s)` : 'Aucune relance programmée.'}
          ${d.prochaine_relance_le ? ` · prochaine le <b>${esc(date(d.prochaine_relance_le, true))}</b>` : ''}</p>
        <p class="aide">Relances 1${d.relance_wa_des > 2 ? ' à ' + (d.relance_wa_des - 1) : ''} : message automatique dans la messagerie + alerte au client.
          À partir de la n° ${d.relance_wa_des} : vous êtes alerté, et vous l'envoyez sur WhatsApp en un clic. Tout s'arrête si le client répond.</p>
        ${!d.relance_wa_a_faire ? '<button class="btn btn-second btn-petit" id="relancer">Relancer maintenant</button>' : ''}
      </div>` : '';
    const blocDocs = (docs || []).length ? `<div class="carte"><h2>Documents envoyés</h2><div class="liste-docs">${docs.map((x) => `
        <a href="#/document/${x.id}"><span><b>${esc(window.IP_DOCS.libelle(x.type))}</b> <small>n° ${esc(x.numero)} · ${esc(date(x.cree_le))}${x.remplace ? ' · remplacé' : ''}</small></span><b>${x.type === 'bon_retrait' ? 'Code' : fcfa(x.total)}</b></a>`).join('')}</div></div>` : '';

    vue.innerHTML = `
      <a class="retour" href="#/demandes">← Sur mesure</a>
      <div class="deux-colonnes"><div class="colonne">
      <div class="carte">
        <div style="display:flex;justify-content:space-between;gap:10px"><h1>Demande</h1>${badge(d.statut)}</div>
        <p style="white-space:pre-line">${esc(d.description)}</p>
        ${photo ? `<a href="${esc(photo.signedUrl)}" target="_blank" rel="noopener"><img class="photo-apercu" src="${esc(photo.signedUrl)}" alt="Photo du client"></a>` : ''}
        <dl class="cle-valeur" style="margin-top:12px">
          <dt>Quantité</dt><dd>${d.quantite}</dd>
          <dt>Budget</dt><dd>${d.budget ? fcfa(d.budget) : '-'}</dd>
          <dt>Transport</dt><dd>${d.mode_transport ? esc(lib(d.mode_transport)) : 'Pas de préférence'}</dd>
          ${d.lien ? `<dt>Lien</dt><dd>${/^https?:\/\//i.test(d.lien) ? `<a href="${esc(d.lien)}" target="_blank" rel="noopener">Ouvrir le produit</a>` : esc(d.lien)}</dd>` : ''}
          <dt>Client</dt><dd>${esc(cl.nom_complet || '-')}</dd>
          <dt>Livraison</dt><dd>${esc(nomPays(cl.pays))}${cl.region ? ' · ' + esc(cl.region) : ''}</dd>
          <dt>Contact</dt><dd>${cl.telephone ? `<a href="${waLien(cl.telephone)}" target="_blank" rel="noopener">${esc(cl.telephone)}</a>` : '-'} · ${esc(cl.email || '')}</dd>
          <dt>Reçue le</dt><dd>${date(d.created_at, true)}</dd>
        </dl>
      </div>
      ${blocSource}
      ${estSupport() ? `<div class="carte"><h2>Discussion avec ${esc(cl.nom_complet || 'le client')}</h2>
        <p class="discret">Posez vos questions avant d'envoyer le prix. Le client répond depuis l'onglet Messages du site.</p>
        <div id="zone-chat"></div></div>` : ''}
      </div><div class="colonne">
      ${peutChiffrer ? `<form class="carte" id="form-devis">
        <h2>${d.statut === 'nouvelle' ? 'Envoyer un prix' : 'Modifier le devis'}</h2>
        ${chiffrage.html}
        <label for="montant">Prix total hors taxes, transport jusqu'à Lomé inclus (F CFA)</label>
        <input id="montant" type="number" inputmode="numeric" min="1" required value="${esc(d.montant_devis || '')}">
        <label for="note">Message au client (affiché sur le devis)</label>
        <textarea id="note" placeholder="Ex. : Modèle disponible en noir, livraison aérien sous 3 semaines.">${esc(d.note_devis || '')}</textarea>
        <fieldset class="relances-choix"><legend>Relances si le client ne répond pas</legend>
          <div class="rangee">
            <div><label for="rl-nb">Nombre</label><select id="rl-nb">${opt([0, 1, 2, 3, 4], d.statut === 'nouvelle' ? 3 : d.relances_prevues, (v) => v === 0 ? 'Aucune' : v + ' relance' + (v > 1 ? 's' : ''))}</select></div>
            <div><label for="rl-int">Espacées de</label><select id="rl-int">${opt([24, 48, 72], d.relance_intervalle_h || 48, (v) => v / 24 + ' jour' + (v > 24 ? 's' : ''))}</select></div>
            <div><label for="rl-wa">Par WhatsApp dès la</label><select id="rl-wa">${opt([1, 2, 3, 4], d.relance_wa_des || 3, (v) => v + (v === 1 ? 're' : 'e') + ' relance')}</select></div>
          </div>
          <p class="aide">Les premières relances partent seules dans la messagerie. Pour WhatsApp, vous recevez une alerte et l'envoyez en un clic (message prêt).</p>
        </fieldset>
        <p class="aide">Le client reçoit un devis numéroté (format facture) dans sa messagerie, avec le bouton « Accepter et payer ».</p>
        <button class="btn btn-large" style="margin-top:14px">${d.statut === 'nouvelle' ? 'Envoyer le devis' : 'Envoyer le devis modifié'}</button>
      </form>` : ''}
      ${blocRelances}
      ${d.montant_devis && !peutChiffrer ? `<div class="carte"><b>Devis : ${fcfa(d.montant_devis)}</b>${d.note_devis ? `<p class="discret" style="white-space:pre-line;margin-top:6px">${esc(d.note_devis)}</p>` : ''}</div>` : ''}
      <div class="carte">
        <h2>Étape</h2>
        ${d.statut === 'acceptee' ? '<p class="discret">En attente du paiement du client. Il apparaîtra dans Paiements.</p>' : ''}
        <div class="boutons">
          ${suivant ? `<button class="btn" id="avancer">${esc(ACTION[suivant])}</button>` : ''}
          ${!['livree', 'annulee', 'refusee'].includes(d.statut) ? `<button class="btn btn-ko" id="annuler">Annuler la demande</button>` : ''}
          ${estAdmin() ? `<button type="button" class="btn btn-lien btn-supprimer" id="supprimer-demande">🗑 Supprimer</button>` : ''}
        </div>
        ${aRembourser.length ? `<div class="alerte alerte-alerte" style="margin-top:10px">Le client avait payé ${fcfa(aRembourser.reduce((t, p) => t + Number(p.montant), 0))} : à rembourser.</div>
          <button class="btn" id="rembourser-dem">Marquer comme remboursé</button>` : ''}
        <div id="zone-wa"></div>
        ${['payee', 'commandee', 'entrepot_chine', 'en_transit', 'arrivee'].includes(d.statut) ? blocRetard() : ''}
        ${['payee', 'commandee', 'entrepot_chine', 'en_transit', 'arrivee', 'livree'].includes(d.statut) ? blocDouane(d.frais_douane, false) : ''}
      </div>
      ${blocDocs}
      ${opsDemande.html}
      </div></div>`;
    if (estSupport()) {
      const { data: eq } = await sb.from('profils').select('id,nom_complet').in('role', ['admin', 'assistant']);
      const noms = { client: cl.nom_complet || 'Client' };
      (eq || []).forEach((x) => { noms[x.id] = (x.nom_complet || 'Équipe').split(' ')[0]; });
      etat.canal = await chat.monter(document.getElementById('zone-chat'), d.client_id, etat.profil.id, {
        noms, vide: '<p>Aucun message pour l\'instant.</p>' });
    }
    brancherRetard(null, d.id);
    brancherDouane(null, d.id);
    const bSupD = document.getElementById('supprimer-demande');
    if (bSupD) bSupD.addEventListener('click', () => {
      const saisie = prompt(`Supprimer définitivement cette demande ?\n\nElle disparaît aussi pour le client, avec ses devis. C'est irréversible. Impossible si un paiement a été reçu : annulez-la plutôt.\n\nTapez SUPPRIMER pour confirmer :`);
      if (saisie === null) return;
      if (saisie.trim().toUpperCase() !== 'SUPPRIMER') { toast('Suppression annulée : il fallait taper SUPPRIMER', 'ko'); return; }
      occupe(bSupD, async () => {
        const { data, error: e } = await sb.rpc('supprimer_demande', { p_demande: d.id });
        if (e) { toast(msgErreur(e), 'ko'); return; }
        if (data && data.photo) await sb.storage.from('demandes').remove([data.photo]);
        if (data && data.image_equipe) await sb.storage.from('sources').remove([data.image_equipe]);
        toast('Demande supprimée');
        location.hash = '#/demandes';
      });
    });
    const iSrc = document.getElementById('src-img');
    if (iSrc) {
      document.getElementById('src-img-btn').addEventListener('click', () => iSrc.click());
      iSrc.addEventListener('change', () => {
        const f = iSrc.files[0]; iSrc.value = '';
        if (!f) return;
        occupe(document.getElementById('src-img-btn'), async () => {
          const blob = await compresserImage(f, 1400, 0.82);
          const type = blob.type || 'image/jpeg';
          const chemin = `${d.id}/${Date.now()}.${{ 'image/png': 'png', 'image/webp': 'webp' }[type] || 'jpg'}`;
          const up = await sb.storage.from('sources').upload(chemin, blob, { contentType: type });
          if (up.error) { toast(msgErreur(up.error), 'ko'); return; }
          const { error: e } = await sb.from('demandes_sources').upsert({ demande_id: d.id, image_path: chemin });
          if (e) { toast(msgErreur(e), 'ko'); return; }
          if (src.image_path) await sb.storage.from('sources').remove([src.image_path]);
          toast('Image enregistrée (visible par l\'équipe uniquement)'); router();
        });
      });
      const bSup = document.getElementById('src-img-suppr');
      if (bSup) bSup.addEventListener('click', () => occupe(bSup, async () => {
        const { error: e } = await sb.from('demandes_sources').update({ image_path: null }).eq('demande_id', d.id);
        if (e) { toast(msgErreur(e), 'ko'); return; }
        await sb.storage.from('sources').remove([src.image_path]);
        toast('Image retirée'); router();
      }));
    }
    const fSrc = document.getElementById('form-source');
    if (fSrc) fSrc.addEventListener('submit', (ev) => {
      ev.preventDefault();
      occupe(fSrc.querySelector('button'), async () => {
        let lien = document.getElementById('src-lien').value.trim();
        if (lien && !/^https?:\/\//i.test(lien)) lien = 'https://' + lien;
        const note = document.getElementById('src-note').value.trim();
        const { error: e } = await sb.from('demandes_sources').upsert({ demande_id: d.id, lien: lien || null, note: note || null });
        if (e) { toast(msgErreur(e), 'ko'); return; }
        toast('Lien enregistré (visible par l\'équipe uniquement)'); router();
      });
    });
    const bWa = document.getElementById('relance-wa-faite');
    if (bWa) bWa.addEventListener('click', () => occupe(bWa, async () => {
      const { error: e } = await sb.rpc('relance_wa_faite', { p_demande: d.id, p_texte: texteWa(d.relance_wa_a_faire) });
      if (e) { toast(msgErreur(e), 'ko'); return; }
      toast('Relance notée'); router();
    }));
    const bRel = document.getElementById('relancer');
    if (bRel) bRel.addEventListener('click', () => occupe(bRel, async () => {
      const { error: e } = await sb.rpc('relancer_maintenant', { p_demande: d.id });
      if (e) { toast(msgErreur(e), 'ko'); return; }
      toast('Relance envoyée'); router();
    }));
    const bRb = document.getElementById('rembourser-dem');
    if (bRb) bRb.addEventListener('click', () => {
      const ref = prompt('Référence de la transaction de remboursement (affichée sur l\'avis du client) :', '');
      if (ref === null) return;
      occupe(bRb, async () => {
        for (const p of aRembourser) {
          const { error: e } = await sb.rpc('marquer_rembourse', { p_paiement: p.id, p_reference: ref.trim() || null });
          if (e) { toast(msgErreur(e), 'ko'); return; }
        }
        toast('Remboursement enregistré · avis envoyé au client'); router();
      });
    });

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
          chiffrage: chiffrage.lire(),
          relances_prevues: Number(document.getElementById('rl-nb').value),
          relance_intervalle_h: Number(document.getElementById('rl-int').value),
          relance_wa_des: Number(document.getElementById('rl-wa').value)
        }).eq('id', d.id);
        if (error) { toast(msgErreur(error), 'ko'); return; }
        toast('Devis envoyé dans la messagerie du client');
        router();
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
      const motif = prompt('Annuler cette demande ?' + (['payee', 'commandee', 'entrepot_chine', 'en_transit', 'arrivee'].includes(d.statut) ? ' Le client a déjà payé : il sera remboursé.' : '')
        + '\nMotif communiqué au client (sur l\'avis d\'annulation) :', '');
      if (motif === null) return;
      occupe(an, async () => {
        const { error } = await sb.from('demandes').update({ statut: 'annulee', motif_annulation: motif.trim() || null }).eq('id', d.id);
        if (error) toast(msgErreur(error), 'ko'); else router();
      });
    });
  }

  // ------------------------------------------------------------------
  // Réglages : numéros marchands + équipe
  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  // Messages clients : boîte de réception + conversation
  // ------------------------------------------------------------------
  async function vueMessages(clientId, params) {
    if (clientId) return vueConversation(clientId);
    const filtre = params.get('f') || 'tous';
    let q = sb.from('conversations').select('*, profils(nom_complet,telephone,reference,email)').order('dernier_msg_le', { ascending: false }).limit(200);
    if (filtre === 'a_traiter') q = q.eq('traite', false);
    const { data, error } = await q;
    if (error) throw error;
    const initiales = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
    vue.innerHTML = `
      <div class="chat-entete"><h1>Messages clients</h1>
        <form id="f-nouveau" class="rangee" style="margin:0;gap:6px"><input id="q-client" placeholder="Écrire à : email, téléphone ou référence" style="margin:0;min-width:240px">
          <button class="btn btn-petit">Ouvrir</button></form></div>
      <div class="onglets" style="margin-bottom:12px">
        <button data-f="tous" class="${filtre === 'tous' ? 'actif' : ''}">Toutes</button>
        <button data-f="a_traiter" class="${filtre === 'a_traiter' ? 'actif' : ''}">En attente de réponse</button></div>
      ${data.length ? `<div class="boite">${data.map((c) => {
        const p = c.profils || {};
        const nonLu = !c.dernier_de_equipe && new Date(c.dernier_msg_le) > new Date(c.lu_equipe_le);
        return `<a class="conv${nonLu ? ' non-lue' : ''}" href="#/messages/${c.client_id}">
          <span class="conv-avatar">${esc(initiales(p.nom_complet))}</span>
          <span class="conv-txt"><b>${esc(p.nom_complet || p.email || 'Client')}</b><span>${c.dernier_de_equipe ? 'Vous : ' : ''}${esc(c.dernier_apercu || '')}</span></span>
          <small>${esc(date(c.dernier_msg_le, true))}${nonLu ? '<b class="compte-badge">1</b>' : (!c.traite ? '<span class="badge badge-alerte">À répondre</span>' : '')}</small></a>`;
      }).join('')}</div>` : `<div class="carte vide"><p>${filtre === 'a_traiter' ? 'Aucune conversation en attente. Bravo !' : 'Aucun message pour l\'instant. Les clients écrivent depuis l\'onglet « Messages » du site.'}</p></div>`}`;
    vue.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/messages' + (b.dataset.f === 'tous' ? '' : '?f=' + b.dataset.f); }));
    document.getElementById('f-nouveau').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const v = document.getElementById('q-client').value.trim();
      if (!v) return;
      const col = v.includes('@') ? 'email' : /^IP/i.test(v) ? 'reference' : 'telephone';
      const val = col === 'email' ? v.toLowerCase() : col === 'reference' ? v.toUpperCase() : normTel(v);
      const { data: pr } = await sb.from('profils').select('id').ilike(col, val).maybeSingle();
      if (!pr) return toast('Aucun client trouvé', 'ko');
      location.hash = '#/messages/' + pr.id;
    });
    etat.canal = sb.channel('boite').on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
      if (location.hash.replace(/\?.*$/, '') === '#/messages') router();
    }).subscribe();
  }

  async function vueConversation(clientId) {
    const [{ data: p, error }, { data: conv }, { data: cmd }, { data: dem }, { data: equipe }] = await Promise.all([
      sb.from('profils').select('id,nom_complet,telephone,email,reference,region,pays,created_at').eq('id', clientId).maybeSingle(),
      sb.from('conversations').select('traite').eq('client_id', clientId).maybeSingle(),
      sb.from('commandes').select('id,quantite,montant_total,statut,created_at,campagne_id,campagnes(titre)').eq('client_id', clientId).order('created_at', { ascending: false }).limit(5),
      sb.from('demandes').select('id,description,statut,created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(3),
      sb.from('profils').select('id,nom_complet').in('role', ['admin', 'assistant'])
    ]);
    if (error) throw error;
    if (!p) throw new Error('Client introuvable');
    const noms = { client: p.nom_complet || 'Client' };
    (equipe || []).forEach((x) => { noms[x.id] = (x.nom_complet || 'Équipe').split(' ')[0]; });
    vue.innerHTML = `
      <p><a href="#/messages">← Tous les messages</a></p>
      <div class="messagerie-equipe">
        <div><h1 style="margin-bottom:10px">${esc(p.nom_complet || 'Client')}</h1><div id="zone-chat"></div></div>
        <aside class="carte conv-fiche">
          <h2>Client</h2>
          <div class="ligne-info"><span class="discret">Référence</span><b>${esc(p.reference || '-')}</b></div>
          ${p.telephone ? `<div class="ligne-info"><span class="discret">Téléphone</span><b>${esc(p.telephone)}</b></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn btn-second btn-petit" href="tel:${esc(p.telephone)}">Appeler</a>
            <a class="btn btn-second btn-petit" href="${waLien(p.telephone, 'Bonjour ' + (p.nom_complet || '').split(' ')[0] + ', ')}" target="_blank" rel="noopener">WhatsApp</a></div>` : ''}
          ${p.email ? `<div class="ligne-info"><span class="discret">Email</span><span style="overflow-wrap:anywhere">${esc(p.email)}</span></div>` : ''}
          ${p.region ? `<div class="ligne-info"><span class="discret">Région</span><span>${esc(p.region)}</span></div>` : ''}
          <h3 style="margin-top:10px">Dernières commandes</h3>
          ${(cmd || []).length ? cmd.map((c) => `<a class="ligne-info" href="#/campagne/${c.campagne_id}" style="text-decoration:none;color:inherit">
              <span>${esc((c.campagnes && c.campagnes.titre) || 'Campagne')} · ${c.quantite}</span>${badge(c.statut)}</a>`).join('') : '<p class="discret">Aucune</p>'}
          ${(dem || []).length ? `<h3 style="margin-top:10px">Sur mesure</h3>${dem.map((d) => `<a class="ligne-info" href="#/demande/${d.id}" style="text-decoration:none;color:inherit">
              <span>${esc((d.description || '').slice(0, 40))}</span>${badge(d.statut)}</a>`).join('')}` : ''}
          <label class="case-acceptation" style="margin-top:12px"><input type="checkbox" id="traite" ${conv && conv.traite ? 'checked' : ''}> Conversation traitée</label>
          <p class="aide">Vous pouvez modifier ou supprimer vos propres messages. Le client voit « modifié » ou « Message supprimé ».</p>
        </aside>
      </div>`;
    document.getElementById('traite').addEventListener('change', async (e) => {
      const { error: er } = await sb.rpc('classer_conversation', { p_client: clientId, p_traite: e.target.checked });
      if (er) toast(msgErreur(er), 'ko');
    });
    etat.canal = await chat.monter(document.getElementById('zone-chat'), clientId, etat.profil.id, {
      noms, vide: '<p>Aucun message. Écrivez le premier : le client recevra une alerte.</p>' });
    majBadges();
  }

  // Retard de livraison : message à tous les clients payés de la campagne (ou au client de la demande)
  // Frais de douane : par unité pour une campagne (les mêmes pour tous), montant total pour une demande sur mesure.
  // Ils sont indiqués au client dans le message d'arrivée du colis et sur son bon de retrait.
  function blocDouane(valeur, campagne) {
    return `<form class="carte" id="form-douane">
      <h2>Frais de douane</h2>
      <p class="discret">${campagne ? 'Montant par unité, le même pour tous les clients de la campagne.' : 'Montant total pour ce colis.'}
        Il est indiqué au client à l'arrivée du colis (message et bon de retrait) et encaissé au retrait.</p>
      <div class="rangee"><div><label for="douane">${campagne ? 'Douane par unité (F)' : 'Douane (F)'}</label>
        <input id="douane" type="number" inputmode="numeric" min="0" value="${valeur == null ? '' : esc(valeur)}" placeholder="Ex. : 1500"></div></div>
      <div class="boutons"><button class="btn">Enregistrer</button>
        <button type="button" class="btn btn-second" id="douane-informer">Informer ${campagne ? 'les clients' : 'le client'}</button></div>
      <p class="aide">« Informer » envoie le montant aux clients dont le colis est attendu ou déjà arrivé. Inutile si vous l'enregistrez avant l'arrivée : le message d'arrivée le contient déjà.</p>
    </form>`;
  }
  function brancherDouane(campagneId, demandeId) {
    const f = document.getElementById('form-douane');
    if (!f) return;
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      occupe(f.querySelector('button'), async () => {
        const v = document.getElementById('douane').value.trim();
        const val = v === '' ? null : parseInt(v, 10);
        const { error: e } = campagneId
          ? await sb.from('campagnes').update({ frais_douane_unitaire: val }).eq('id', campagneId)
          : await sb.from('demandes').update({ frais_douane: val }).eq('id', demandeId);
        if (e) { toast(msgErreur(e), 'ko'); return; }
        toast('Frais de douane enregistrés');
      });
    });
    document.getElementById('douane-informer').addEventListener('click', (ev) => {
      if (!confirm('Envoyer le montant des frais de douane aux clients concernés ?')) return;
      occupe(ev.currentTarget, async () => {
        const { data, error: e } = await sb.rpc('annoncer_douane', { p_campagne: campagneId, p_demande: demandeId });
        if (e) { toast(msgErreur(e), 'ko'); return; }
        toast(data ? `${data} client${data > 1 ? 's' : ''} informé${data > 1 ? 's' : ''}` : 'Aucun colis en cours pour l\'instant');
      });
    });
  }

  function blocRetard() {
    const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    return `<details class="bloc-retard"><summary class="lien-texte">Annoncer un retard aux clients</summary>
      <form id="form-retard">
        <label for="rt-raison">Raison du retard</label>
        <input id="rt-raison" required maxlength="200" placeholder="Ex. : un retard de chargement du navire au port de Ningbo">
        <div class="aide">Elle s'insère dans : « Votre colis connaît actuellement un retard en raison de : … »</div>
        <label for="rt-date">Nouvelle date estimée d'arrivée à Lomé (vérifiée)</label>
        <input id="rt-date" type="date" required min="${demain}">
        <button class="btn btn-second" style="margin-top:10px">Envoyer le message aux clients</button>
      </form></details>`;
  }
  function brancherRetard(campagneId, demandeId) {
    const f = document.getElementById('form-retard');
    if (!f) return;
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!confirm('Envoyer le message de retard à tous les clients concernés ?')) return;
      occupe(f.querySelector('button'), async () => {
        const { data: n, error: e } = await sb.rpc('annoncer_retard', { p_campagne: campagneId, p_demande: demandeId,
          p_raison: document.getElementById('rt-raison').value, p_date: document.getElementById('rt-date').value });
        if (e) { toast(msgErreur(e), 'ko'); return; }
        toast(`Message envoyé à ${n} client${n > 1 ? 's' : ''}`);
        f.closest('details').open = false; f.reset();
      });
    });
  }

  // Bon de commande fournisseur (document interne, imprimable en PDF)
  async function vueBonCommande(id) {
    const [{ data: c, error }, { data: cmd }, { data: piste }] = await Promise.all([
      sb.from('campagnes').select('*').eq('id', id).maybeSingle(),
      sb.from('commandes').select('quantite,variante,statut').eq('campagne_id', id).in('statut', ['payee', 'livree']),
      sb.from('pistes').select('fournisseur,liens,moq').eq('campagne_id', id).maybeSingle()
    ]);
    if (error) throw error;
    if (!c) { vue.innerHTML = '<div class="carte vide">Campagne introuvable.</div>'; return; }
    const b = c.bon_commande || {};
    const noms = (c.variantes || []).map((v) => v.nom);
    const groupes = {};
    (cmd || []).forEach((o) => {
      const v = o.variante && typeof o.variante === 'object' ? o.variante : {};
      const cle = noms.map((n) => v[n] || '-').join(' · ') || 'Modèle unique';
      groupes[cle] = (groupes[cle] || 0) + Number(o.quantite || 0);
    });
    const total = Object.values(groupes).reduce((t, q) => t + q, 0);
    const lien = b.lien || ((piste && piste.liens) || '').match(/https?:\/\/\S+/)?.[0] || '';
    const numero = 'BC-' + new Date().getFullYear() + '-' + id.slice(0, 6).toUpperCase();
    const champ = (k, v, ph) => `<input class="bc-champ" data-k="${k}" value="${esc(b[k] ?? v ?? '')}" placeholder="${esc(ph || '')}">`;
    vue.innerHTML = `
      <a class="retour" href="#/campagne/${id}">← ${esc(c.titre)}</a>
      <article class="doc bon-commande">
        <header class="doc-tete">
          <div class="doc-marque"><span class="doc-logo">IP</span><div><b>Import<span>Public</span></b><small>Service approvisionnement</small></div></div>
          <div class="doc-titre"><h2>Bon de commande fournisseur</h2><p>N° <b>${esc(numero)}</b></p><p>Date : ${esc(new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }))}</p></div>
        </header>
        <table class="doc-lignes bc-infos"><tbody>
          <tr><td>Référence de commande</td><td><b>${esc(numero)}</b></td></tr>
          <tr><td>Campagne</td><td>${esc(c.titre)}</td></tr>
          <tr><td>Date souhaitée d'expédition</td><td>${champ('date_expedition', '', 'JJ/MM/AAAA')}</td></tr>
        </tbody></table>
        <h3>1. Informations sur le produit</h3>
        <div class="bc-grille">
          <span>Nom du produit</span>${champ('produit', c.titre)}
          <span>Lien du produit</span>${champ('lien', lien, 'https://…')}
          <span>Fournisseur</span>${champ('fournisseur', piste && piste.fournisseur, 'Nom du fournisseur')}
          <span>Référence produit</span>${champ('reference', '', 'Référence fournisseur')}
        </div>
        <h3>2. Détail des quantités</h3>
        <table class="doc-lignes"><thead><tr><th>${esc(noms.join(' · ') || 'Variante')}</th><th>Quantité</th></tr></thead>
          <tbody>${Object.keys(groupes).length ? Object.entries(groupes).map(([k, q]) => `<tr><td>${esc(k)}</td><td>${q}</td></tr>`).join('') : '<tr><td colspan="2">Aucune commande payée pour l\'instant.</td></tr>'}</tbody></table>
        <div class="doc-total"><span>Quantité totale à commander</span><b>${total} pièce${total > 1 ? 's' : ''}</b></div>
        <h3>3. Informations logistiques</h3>
        <div class="bc-grille">
          <span>Mode de transport</span>${champ('transport', lib(c.mode_transport))}
          <span>Adresse de livraison (entrepôt en Chine)</span>${champ('adresse', '', 'Adresse de l\'entrepôt')}
          <span>Contact à l'entrepôt</span>${champ('contact', '', 'Nom et téléphone')}
          <span>Date souhaitée de livraison à l'entrepôt</span>${champ('date_entrepot', '', 'JJ/MM/AAAA')}
        </div>
        <h3>4. Instructions particulières</h3>
        <textarea class="bc-champ bc-instructions" data-k="instructions" placeholder="Emballage, étiquetage, contrôle qualité, variantes à vérifier…">${esc(b.instructions || '')}</textarea>
        <h3>5. Vérifications avant expédition</h3>
        <ul class="bc-verifs"><li>Les quantités correspondent au bon de commande.</li><li>Les couleurs et les tailles sont conformes.</li>
          <li>Les produits ne présentent pas de défaut apparent.</li><li>Les articles sont correctement emballés.</li>
          <li>Les éventuelles différences ou ruptures de stock nous sont signalées avant expédition.</li></ul>
        <div class="doc-note">Merci de confirmer la disponibilité des produits et la bonne prise en compte de cette commande avant de procéder à l'expédition.</div>
        <footer class="doc-pied">IMPORT PUBLIC · Service approvisionnement · Lomé, Togo · contact@importpublic.com</footer>
      </article>
      <div class="doc-actions">
        <button class="btn" id="bc-enregistrer">Enregistrer les informations</button>
        <button class="btn btn-second" id="bc-imprimer">${window.ICO.telecharger}Enregistrer en PDF</button>
      </div>`;
    const lire = () => Object.fromEntries([...vue.querySelectorAll('.bc-champ')].map((x) => [x.dataset.k, x.value.trim()]));
    document.getElementById('bc-enregistrer').addEventListener('click', (ev) => occupe(ev.currentTarget, async () => {
      const { error: e } = await sb.from('campagnes').update({ bon_commande: lire() }).eq('id', id);
      if (e) toast(msgErreur(e), 'ko'); else toast('Enregistré');
    }));
    document.getElementById('bc-imprimer').addEventListener('click', async () => {
      await sb.from('campagnes').update({ bon_commande: lire() }).eq('id', id);
      window.print();
    });
  }

  // Document client (même rendu que chez le client)
  async function vueDocument(id) {
    const { data: doc, error } = await sb.from('documents').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!doc) { vue.innerHTML = '<div class="carte vide">Document introuvable.</div>'; return; }
    const retour = doc.demande_id ? '#/demande/' + doc.demande_id : '#/messages/' + doc.client_id;
    vue.innerHTML = `<a class="retour" href="${retour}">← Retour</a>${window.IP_DOCS.html(doc)}
      <div class="doc-actions"><button class="btn btn-second" id="doc-imprimer">${window.ICO.telecharger}Enregistrer en PDF</button>
      <a class="btn btn-second" href="#/messages/${doc.client_id}">${window.ICO.bulle}Conversation du client</a></div>`;
    document.getElementById('doc-imprimer').addEventListener('click', () => window.print());
  }

  // Alertes de ce téléphone (accessible à toute l'équipe, y compris les points de retrait)
  async function vueAlertes() {
    vue.innerHTML = `<h1>Alertes</h1><div data-zone-notifs id="zone-alertes" style="max-width:560px"></div>`;
    await notifs.remplirCarte(document.getElementById('zone-alertes'));
  }

  async function vueReglages() {
    const g = etat.groupeur || {};
    const membres = estAdmin()
      ? (await sb.from('profils').select('id,nom_complet,telephone,email,role').in('role', ['admin', 'assistant', 'groupeur']).order('nom_complet')).data || []
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
        ${estAdmin() ? `<label class="case-acceptation" style="margin-top:14px"><input type="checkbox" id="pg-actif" ${g.paiement_en_ligne ? 'checked' : ''}>
          <span><b>Paiement en ligne PayGate activé</b><br><small class="discret">Le client paie depuis sa commande (demande envoyée sur son téléphone). Le paiement est vérifié auprès de PayGate et le reçu est généré tout seul. Cochez seulement quand le compte PayGate est actif et la clé API enregistrée.</small></span></label>` : ''}
        <button class="btn btn-large" style="margin-top:14px">Enregistrer</button>
      </form>
      ${estAdmin() ? `<div class="carte">
        <h2>Équipe</h2>
        ${membres.map((p) => `<div class="ligne"><div style="flex:1;min-width:0"><div class="ligne-titre">${esc(p.nom_complet || p.email)}</div>
          <small>${esc(p.email || '')} · ${esc(p.telephone || '')}</small></div>
          <div class="actions-ligne">${p.id !== etat.profil.id ? `<select class="choix-role" data-profil="${p.id}" aria-label="Rôle de ${esc(p.nom_complet || p.email)}">
              ${[['assistant', 'Assistant'], ['admin', 'Admin']].map(([v, l]) =>
                `<option value="${v}"${(p.role === v || (v === 'assistant' && p.role === 'groupeur')) ? ' selected' : ''}>${l}</option>`).join('')}
            </select><button class="btn btn-second btn-petit" data-retirer="${p.id}">Retirer</button>` : badge(p.role)}</div></div>`).join('')}
        <details class="roles-aide"><summary>Qui voit quoi ?</summary>
          <ul><li><b>Admin</b> : tout, y compris les réglages, l'équipe et les analyses.</li>
          <li><b>Assistant</b> : accueil, paiements (vérifier, valider), campagnes, sur mesure (chiffrer les devis).</li>
          <li><b>Représentant</b> = point de retrait : uniquement les colis de son point (réception, remise contre code). Se nomme dans <a href="#/reseau/points">Réseau › Représentants</a>.</li>
          <li>Les <b>analyses</b> se partagent à part, depuis le site data (bouton Partager).</li></ul></details>
        <a class="btn btn-second btn-large" href="#/utilisateurs" style="margin-top:12px">${window.ICO.personnes}Voir tous les utilisateurs et gérer les rôles</a>
        <hr>
        <form id="form-ajout">
          <label for="cherche">Ajouter un membre</label>
          <input id="cherche" required placeholder="Email ou numéro WhatsApp de son compte">
          <div class="aide">La personne doit d'abord créer un compte sur le site client.</div>
          <select id="role-ajout" style="margin-top:8px"><option value="assistant">Assistant</option><option value="admin">Admin</option></select>
          <div class="aide">Pour un représentant (point de retrait) : <a href="#/reseau/points">Réseau › Représentants</a>.</div>
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
          numero_marchand_flooz: v('fl') || null, whatsapp: normTel(v('wa')) || null,
          ...(document.getElementById('pg-actif') ? { paiement_en_ligne: document.getElementById('pg-actif').checked } : {})
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
    // Points accessibles : tous pour l'équipe, le sien pour un représentant
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
                <small>${esc(c.objet || '')}${c.etat === 'endommage' ? ' · endommagé' : ''} · ${c.remis_le ? 'remis le ' + date(c.remis_le, true) : c.recu_le ? 'reçu le ' + date(c.recu_le, true) : 'créé le ' + date(c.created_at)}</small>
                ${c.statut !== 'remis' ? `<div class="encaisser">${c.a_encaisser == null ? '⚠ Douane non renseignée' : c.a_encaisser > 0 ? 'À encaisser au retrait : <b>' + fcfa(c.a_encaisser) + '</b> (douane)' : 'Rien à encaisser'}${c.frais_livraison != null ? ` · Livraison proposée : <b>${fcfa(c.frais_livraison)}</b>${c.adresse_livraison ? ' (' + esc(c.adresse_livraison) + ')' : ''}` : ''}</div>` : ''}</div>
              <div class="actions-ligne">${badge(c.statut)}
                ${c.telephone && ['recu', 'non_recupere'].includes(c.statut) ? `<a class="btn btn-wa btn-petit" target="_blank" rel="noopener" href="${waLien(c.telephone,
                  `Bonjour ${(c.client || '').split(' ')[0]}, votre colis Import Public (réf. ${c.reference}) vous attend au point de retrait ${point.nom}${point.adresse ? ', ' + point.adresse : ''}${point.horaires ? ' (' + point.horaires + ')' : ''}.${c.a_encaisser > 0 ? ' Frais de douane à régler au retrait : ' + fcfa(c.a_encaisser) + '.' : ''} Présentez votre code de retrait, visible dans votre compte sur ${cfg.urlSite}`)}">Prévenir</a>` : ''}
                ${estStaff() && ['attendu', 'recu', 'non_recupere'].includes(c.statut) ? `<button class="btn btn-second btn-petit" data-livrer="${esc(c.id)}">Proposer la livraison</button>` : ''}
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
          ${data.a_encaisser == null ? '<br>⚠ Frais de douane non renseignés : indiquez-les dans la campagne ou la demande.' : data.a_encaisser > 0 ? '<br>À encaisser au retrait : <b>' + fcfa(data.a_encaisser) + '</b>.' : ''}
          ${data.telephone ? `<div class="boutons"><a class="btn btn-wa btn-petit" target="_blank" rel="noopener" href="${waLien(data.telephone,
            `Bonjour ${(data.client || '').split(' ')[0]}, votre colis Import Public (réf. ${data.reference}) est arrivé au point de retrait ${data.point}${data.adresse ? ', ' + data.adresse : ''}${data.horaires ? ' (' + data.horaires + ')' : ''}.${data.a_encaisser > 0 ? ' Frais de douane à régler au retrait : ' + fcfa(data.a_encaisser) + '.' : ''} Présentez votre code de retrait, visible dans votre compte sur ${cfg.urlSite}`)}">Prévenir ${esc((data.client || 'le client').split(' ')[0])}</a></div>` : ''}</div>`);
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
    vue.querySelectorAll('[data-livrer]').forEach((b) => b.addEventListener('click', () => {
      const frais = prompt('Frais de livraison pour ce client (F CFA) :');
      if (frais === null) return;
      const n = parseInt(String(frais).replace(/\D/g, ''), 10);
      if (!(n >= 0)) { toast('Montant invalide', 'ko'); return; }
      const adresse = prompt('Adresse de livraison (quartier, repère), facultatif :') || '';
      occupe(b, async () => {
        const { error: e } = await sb.rpc('proposer_livraison', { p_colis: b.dataset.livrer, p_frais: n, p_adresse: adresse });
        if (e) toast(msgErreur(e), 'ko'); else { toast('Proposition envoyée au client'); router(); }
      });
    }));
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
    const onglets = [['ambassadeurs', 'Ambassadeurs'], ['commissions', 'Commissions'], ['points', 'Représentants'], ['bareme', 'Barème et versements']];
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
            <small>${esc(a.region || '-')} · ${a.telephone ? `<a href="${waLien(a.telephone)}" target="_blank" rel="noopener">${esc(a.telephone)}</a>` : ''} · depuis le ${date(a.adhere_le)} · conditions ${esc(a.conditions_version)}</small>
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

  async function reseauPoints(params) {
    const { data, error } = await sb.from('points_retrait').select('*, profils(nom_complet,telephone,email,role)').order('principal', { ascending: false }).order('nom');
    if (error) throw error;
    const prerempli = (params && params.get('responsable')) || '';
    const formPoint = (p) => `
      <form class="form-point" data-id="${p ? p.id : ''}">
        <label>Représentant (email ou numéro WhatsApp de son compte)</label>
        <input name="responsable" value="${esc(p ? (p.profils ? p.profils.email || p.profils.telephone || '' : '') : prerempli)}" placeholder="${p && p.principal ? 'Vide = géré par l\'équipe' : 'La personne crée d\'abord un compte sur le site'}" ${p && p.principal ? '' : 'required'}>
        <div class="rangee"><div><label>Nom du point</label><input name="nom" required value="${esc(p ? p.nom : '')}" placeholder="Ex. : Chez Jacques · Agoè"></div>
          <div><label>Région</label><input name="region" value="${esc(p ? p.region || '' : '')}" placeholder="Ex. : Kara"></div></div>
        <div class="rangee"><div><label>Ville</label><input name="ville" value="${esc(p ? p.ville || '' : '')}"></div>
          <div><label>Téléphone du point</label><input name="telephone" type="tel" value="${esc(p ? p.telephone || '' : '')}"></div></div>
        <label>Adresse / repère</label><input name="adresse" value="${esc(p ? p.adresse || '' : '')}" placeholder="Ex. : Grand marché, à côté de la pharmacie">
        <label>Horaires</label><input name="horaires" value="${esc(p ? p.horaires || '' : '')}" placeholder="Ex. : Lun-Sam 8h-18h">
        <label class="case-acceptation"><input type="checkbox" name="actif" ${!p || p.actif ? 'checked' : ''}> Point actif (proposé aux clients)</label>
        <button class="btn btn-petit">${p ? 'Enregistrer' : 'Nommer le représentant'}</button>
      </form>`;
    return {
      html: `
      <div class="deux-colonnes"><div class="colonne">
        ${data.map((p) => `<div class="carte">
          <div style="display:flex;justify-content:space-between;gap:10px"><h2>${esc(p.nom)}</h2>${p.actif ? badge('actif') : '<span class="badge badge-neutre">Inactif</span>'}</div>
          <p class="discret">${esc([p.adresse, p.ville, p.region].filter(Boolean).join(' · ') || 'Adresse à compléter')}${p.horaires ? ' · ' + esc(p.horaires) : ''}</p>
          <p class="discret">Représentant : ${p.profils ? esc(p.profils.nom_complet || p.profils.email) + (p.profils.telephone ? ' · ' + esc(p.profils.telephone) : '') : 'aucun (géré par l\'équipe)'}</p>
          ${estAdmin() ? `<details><summary class="lien-texte">Modifier</summary>${formPoint(p)}</details>` : ''}
          <a class="btn btn-second btn-petit" href="#/colis?point=${p.id}">Voir les colis</a>
        </div>`).join('')}
      </div><div class="colonne">
        ${estAdmin() ? `<div class="carte" id="nouveau-rep"><h2>Nommer un représentant</h2>
          <p class="discret">Chaque représentant est un point de retrait : les clients viennent chercher leurs colis chez lui.</p>
          ${formPoint(null)}
          <p class="aide">La personne crée d'abord un compte sur importpublic.com. En validant, elle devient « Représentant » :
          elle se connecte sur equipe.importpublic.com et ne voit que les colis de son point. Elle touche 50 F à la réception et 50 F à la remise de chaque colis.
          Pour lui retirer ce rôle : Utilisateurs › rôle « Client » (son point est alors désactivé).</p></div>` : ''}
      </div></div>`,
      brancher() {
        if (prerempli) { const n = document.getElementById('nouveau-rep'); if (n) { n.scrollIntoView({ block: 'start' }); n.querySelector('[name=nom]').focus(); } }
        vue.querySelectorAll('.form-point').forEach((f) => f.addEventListener('submit', (ev) => {
          ev.preventDefault();
          occupe(f.querySelector('button'), async () => {
            const v = (n) => f.elements[n].value.trim();
            const tel = v('telephone') ? normTel(v('telephone')) : null;
            const ligne = { nom: v('nom'), region: v('region') || null, ville: v('ville') || null, telephone: tel,
                            adresse: v('adresse') || null, horaires: v('horaires') || null, actif: f.elements.actif.checked };
            if (v('responsable')) {
              const col = v('responsable').includes('@') ? 'email' : 'telephone';
              const val = col === 'email' ? v('responsable').toLowerCase() : normTel(v('responsable'));
              const { data: pr } = await sb.from('profils').select('id,nom_complet').ilike(col, val).maybeSingle();
              if (!pr) { toast('Aucun compte trouvé. La personne doit d\'abord s\'inscrire sur importpublic.com', 'ko'); return; }
              // Donne le rôle Représentant et crée / met à jour son point, en une fois
              const { data: idPoint, error: er } = await sb.rpc('nommer_representant', { p_profil: pr.id, p_nom: ligne.nom, p_ville: ligne.ville,
                p_region: ligne.region, p_adresse: ligne.adresse, p_telephone: tel, p_horaires: ligne.horaires, p_point: f.dataset.id || null });
              if (er) { toast(msgErreur(er), 'ko'); return; }
              if (!ligne.actif) await sb.from('points_retrait').update({ actif: false }).eq('id', idPoint);
              toast((pr.nom_complet || 'Représentant') + ' est représentant · ' + ligne.nom);
            } else {
              const r = f.dataset.id ? await sb.from('points_retrait').update({ ...ligne, responsable_id: null }).eq('id', f.dataset.id)
                                     : await sb.from('points_retrait').insert(ligne);
              if (r.error) { toast(msgErreur(r.error), 'ko'); return; }
              toast('Point enregistré');
            }
            location.hash = '#/reseau/points';  router();
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
          <p>${nbModules || 0} modules de formation actifs · conditions en vigueur : <b>${esc(cond ? cond.version : '-')}</b>${cond ? ' (publiées le ' + date(cond.publie_le) + ')' : ''}.</p>
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
