// Import Public : mise en page des documents clients (devis, reçu, avis d'annulation, avis de remboursement).
// Un seul modèle, type facture, imprimable ou enregistrable en PDF depuis le navigateur.
(function () {
  const TYPES = {
    devis:         { titre: 'Devis',                 total: 'Total à payer (hors taxes)' },
    recu:          { titre: 'Reçu de paiement',      total: 'Montant payé' },
    annulation:    { titre: 'Avis d\'annulation',    total: 'Montant à rembourser' },
    remboursement: { titre: 'Avis de remboursement', total: 'Montant remboursé' },
    bon_retrait:   { titre: 'Bon de retrait',        total: '' }
  };

  window.IP_DOCS = {
    TYPES,

    // Bon de retrait : le code en grand + QR code, l'adresse et les horaires du point
    bonRetrait(doc) {
      const { esc } = window.IA;
      const c = doc.contenu || {};
      const pt = c.point || {};
      const cl = c.client || {};
      const l = (Array.isArray(doc.lignes) && doc.lignes[0]) || {};
      let qr = '';
      if (window.qrcode && c.code) {
        try { const q = window.qrcode(0, 'M'); q.addData('IP-RETRAIT:' + (c.colis_reference || '') + ':' + c.code); q.make(); qr = q.createSvgTag({ cellSize: 5, margin: 2 }); } catch { qr = ''; }
      }
      const d = new Date(doc.cree_le).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      return `<article class="doc doc-bon_retrait">
        <header class="doc-tete">
          <div class="doc-marque"><span class="doc-logo">IP</span><div><b>Import<span>Public</span></b><small>Achetez en Chine, recevez chez vous.</small></div></div>
          <div class="doc-titre"><h2>Bon de retrait</h2><p>N° <b>${esc(doc.numero)}</b></p><p>Date : ${esc(d)}</p></div>
        </header>
        <div class="bon-code">
          ${qr ? `<div class="bon-qr">${qr}</div>` : ''}
          <div><small>Votre code de retrait</small><b>${esc(c.code || '------')}</b><span>Colis ${esc(c.colis_reference || '')}</span></div>
        </div>
        <div class="doc-parties">
          <div><small>Pour</small><b>${esc(cl.nom || 'Client')}</b>${cl.reference ? `<span>Réf. client : ${esc(cl.reference)}</span>` : ''}${cl.telephone ? `<span>${esc(cl.telephone)}</span>` : ''}</div>
          <div><small>Où retirer</small><b>${esc(pt.representant || pt.nom || 'Point de retrait')}</b>${pt.adresse ? `<span>${esc(pt.adresse)}</span>` : ''}
            ${pt.horaires ? `<span>Horaires : ${esc(pt.horaires)}</span>` : ''}${pt.telephone ? `<span>Tél. : ${esc(pt.telephone)}</span>` : ''}</div>
        </div>
        <p class="doc-objet">Article : <b>${esc(l.libelle || '')}</b>${l.quantite ? ` × ${esc(String(l.quantite))}` : ''}</p>
        <p class="doc-objet">Frais de douane à régler au retrait : <b>${c.frais_douane == null ? 'communiqués par notre équipe' : Number(c.frais_douane) > 0 ? window.IA.fcfa(c.frais_douane) : 'aucun'}</b></p>
        <div class="doc-note">Présentez ce bon (sur votre téléphone ou imprimé) ou donnez votre code au point de retrait. Gardez ce code confidentiel et ne le communiquez à personne : il permet de récupérer votre colis.</div>
        <footer class="doc-pied">Import Public · Lomé, Togo · importpublic.com · contact@importpublic.com<br>Document émis électroniquement par Import Public.</footer>
      </article>`;
    },
    libelle: (t) => (TYPES[t] || { titre: 'Document' }).titre,

    // Rendu HTML du document (doc = ligne de la table documents)
    html(doc) {
      if (doc.type === 'bon_retrait') return this.bonRetrait(doc);
      const { esc, fcfa } = window.IA;
      // Date complète avec l'année (un document se conserve)
      const date = (d, heure) => new Date(d).toLocaleString('fr-FR', heure
        ? { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { day: 'numeric', month: 'long', year: 'numeric' });
      const T = TYPES[doc.type] || TYPES.devis;
      const c = doc.contenu || {};
      const cl = c.client || {};
      const em = c.emetteur || {};
      const lignes = Array.isArray(doc.lignes) ? doc.lignes : [];
      const info = (l, v) => (v || v === 0) && v !== '' ? `<div><span>${esc(l)}</span><b>${esc(String(v))}</b></div>` : '';
      let tampon = '';
      if (doc.type === 'recu') tampon = '<div class="doc-tampon ok">Payé</div>';
      if (doc.type === 'remboursement') tampon = '<div class="doc-tampon ok">Remboursé</div>';
      if (doc.type === 'annulation') tampon = '<div class="doc-tampon ko">Annulé</div>';
      if (doc.type === 'devis' && doc.remplace) tampon = '<div class="doc-tampon neutre">Remplacé</div>';

      let details = '';
      if (doc.type === 'devis') {
        details = `${info('Valable jusqu\'au', c.valide_jusqu_au ? date(c.valide_jusqu_au) : '')}${info('Délai indicatif', c.delai)}`;
      } else if (doc.type === 'recu') {
        details = `${info('Payé le', c.paye_le ? date(c.paye_le, true) : '')}${info('Moyen', c.operateur)}${info('Référence de la transaction', c.reference)}${info('Numéro payeur', c.numero_payeur)}`;
      } else if (doc.type === 'annulation') {
        details = `${info('Motif', c.motif)}${info('Déjà payé', c.deja_paye ? fcfa(c.deja_paye) : 'Rien')}`;
      } else if (doc.type === 'remboursement') {
        details = `${info('Remboursé le', c.rembourse_le ? date(c.rembourse_le, true) : '')}${info('Moyen', c.operateur)}${info('Sur le numéro', c.numero_payeur)}${info('Référence du remboursement', c.reference)}${info('Paiement d\'origine', c.paiement_reference)}`;
      }

      let pied = '';
      if (doc.type === 'devis') {
        const moyens = [em.tmoney && `T-Money : <b>${esc(em.tmoney)}</b>`, em.flooz && `Flooz : <b>${esc(em.flooz)}</b>`].filter(Boolean).join(' · ');
        pied = `<div class="doc-note"><b>Comment payer ?</b> Acceptez le devis dans votre compte Import Public, puis payez par Mobile Money${moyens ? ' (' + moyens + (em.marchand ? ', au nom de ' + esc(em.marchand) : '') + ')' : ''}.
          Nous passons commande dès que votre paiement est validé. Le prix comprend l'achat et le transport jusqu'à Lomé. Les frais de douane et de livraison vous seront communiqués une fois votre colis arrivé à Lomé.</div>`;
      } else if (doc.type === 'recu') {
        pied = `<div class="doc-note">Merci pour votre confiance. Conservez ce reçu : il prouve votre paiement. Vous serez prévenu à chaque étape, jusqu'au retrait de votre colis.</div>`;
      } else if (doc.type === 'annulation') {
        pied = `<div class="doc-note">${c.deja_paye ? 'Votre paiement vous sera remboursé intégralement sous 72 h sur le numéro qui a servi au paiement. Un avis de remboursement vous sera envoyé.' : 'Aucun paiement n\'ayant été reçu, vous n\'avez rien à faire.'}
          Toutes nos excuses pour ce contretemps.</div>`;
      } else if (doc.type === 'remboursement') {
        pied = `<div class="doc-note">Le remboursement a été envoyé sur votre compte Mobile Money. Si vous ne le voyez pas sous 24 h, écrivez-nous dans votre messagerie Import Public.</div>`;
      }

      return `<article class="doc doc-${esc(doc.type)}">
        ${tampon}
        <header class="doc-tete">
          <div class="doc-marque"><span class="doc-logo">IP</span><div><b>Import<span>Public</span></b><small>Achetez en Chine, recevez chez vous.</small></div></div>
          <div class="doc-titre"><h2>${esc(T.titre)}</h2><p>N° <b>${esc(doc.numero)}</b></p><p>Date : ${esc(date(doc.cree_le))}</p></div>
        </header>
        <div class="doc-parties">
          <div><small>De</small><b>${esc(em.nom || 'Import Public')}</b><span>${esc(em.ville || 'Lomé, Togo')}</span>
            <span>${esc(em.email || 'contact@importpublic.com')}</span>${em.whatsapp ? `<span>WhatsApp : ${esc(em.whatsapp)}</span>` : ''}</div>
          <div><small>Pour</small><b>${esc(cl.nom || 'Client')}</b>${cl.reference ? `<span>Réf. client : ${esc(cl.reference)}</span>` : ''}
            ${cl.telephone ? `<span>${esc(cl.telephone)}</span>` : ''}${cl.email ? `<span>${esc(cl.email)}</span>` : ''}</div>
        </div>
        ${c.objet ? `<p class="doc-objet">Objet : <b>${esc(c.objet)}</b></p>` : ''}
        <table class="doc-lignes"><thead><tr><th>Désignation</th><th>Qté</th><th>Prix unitaire</th><th>Montant</th></tr></thead>
          <tbody>${lignes.map((l) => `<tr><td>${esc(l.libelle || '')}${l.detail ? `<small>${esc(l.detail)}</small>` : ''}</td>
            <td>${esc(String(l.quantite ?? ''))}</td><td>${l.prix_unitaire != null ? fcfa(l.prix_unitaire) : ''}</td><td>${l.montant != null ? fcfa(l.montant) : ''}</td></tr>`).join('')}</tbody></table>
        <div class="doc-total"><span>${esc(T.total)}</span><b>${fcfa(doc.total)}</b></div>
        ${details ? `<div class="doc-infos">${details}</div>` : ''}
        ${c.note ? `<div class="doc-message"><small>Message de l'équipe</small><p>${esc(c.note)}</p></div>` : ''}
        ${pied}
        <footer class="doc-pied">Import Public · Lomé, Togo · importpublic.com · ${esc(em.email || 'contact@importpublic.com')}<br>Document émis électroniquement par Import Public.</footer>
      </article>`;
    }
  };
})();
