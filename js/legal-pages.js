/**
 * Pages légales RGPD — contenu, liens footer, droits des personnes
 */
const FLENOVA_LEGAL = {
    company: 'Flenova SAS',
    address: 'Siège social : à compléter lors de l\'immatriculation',
    siret: 'En cours d\'attribution',
    tva: 'En cours d\'attribution',
    email: 'support@flenova.fr',
    dpo: 'support@flenova.fr',
    host: 'Hébergeur à documenter dans le registre des traitements',
    updatedAt: '28 juillet 2026'
};

function legalEsc(value) {
    if (typeof escapeHtml === 'function') return escapeHtml(value);
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderLegalFooterLinks(extraClass = '') {
    return `<nav class="legal-footer-links ${extraClass}" aria-label="Informations légales">
        <a href="#" onclick="openLegalPage('privacy'); return false;">Confidentialité</a>
        <span aria-hidden="true">·</span>
        <a href="#" onclick="openLegalPage('legal'); return false;">Mentions légales</a>
        <span aria-hidden="true">·</span>
        <a href="#" onclick="openLegalPage('terms'); return false;">CGU</a>
        <span aria-hidden="true">·</span>
        <a href="#" onclick="openLegalPage('cgv'); return false;">CGV</a>
        <span aria-hidden="true">·</span>
        <a href="#" onclick="openLegalPage('cookies'); return false;">Cookies</a>
    </nav>`;
}

function renderLegalDocumentShell(title, bodyHtml) {
    return `<div class="max-w-3xl mx-auto bg-white rounded-xl shadow-sm border border-gray-100 p-8 fade-in legal-doc">
        <button type="button" onclick="historyBackLegal()" class="text-sm text-gray-600 hover:text-blue-600 mb-4">
            <i class="fa-solid fa-arrow-left mr-1"></i>Retour
        </button>
        <h1 class="text-2xl font-bold text-gray-900 mb-2">${legalEsc(title)}</h1>
        <p class="text-xs text-gray-400 mb-6">Dernière mise à jour : ${legalEsc(FLENOVA_LEGAL.updatedAt)}</p>
        <div class="legal-doc-body text-sm text-gray-700 space-y-4 leading-relaxed">${bodyHtml}</div>
        ${renderLegalFooterLinks('mt-8 pt-4 border-t text-xs')}
    </div>`;
}

function getPrivacyPolicyHtml() {
    const L = FLENOVA_LEGAL;
    return `
        <p>La présente politique informe les utilisateurs de la plateforme <strong>Flenova</strong> (TMS transport) sur la manière dont leurs données personnelles sont traitées, conformément au Règlement (UE) 2016/679 (RGPD).</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">1. Responsable du traitement</h2>
        <p><strong>${legalEsc(L.company)}</strong><br>${legalEsc(L.address)}<br>Contact : <a href="mailto:${legalEsc(L.email)}" class="text-blue-600 hover:underline">${legalEsc(L.email)}</a><br>DPO / contact données : <a href="mailto:${legalEsc(L.dpo)}" class="text-blue-600 hover:underline">${legalEsc(L.dpo)}</a></p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">2. Données collectées</h2>
        <ul class="list-disc pl-5 space-y-1">
            <li><strong>Compte utilisateur :</strong> nom, email, rôle, mot de passe (hashé).</li>
            <li><strong>Entreprise :</strong> raison sociale, adresse, SIRET, TVA, IBAN/BIC, logo.</li>
            <li><strong>Exploitation TMS :</strong> clients, chauffeurs, véhicules, transports, factures, documents (POD, CMR).</li>
            <li><strong>Application mobile chauffeur :</strong> position GPS (arrivée chargement/livraison), photos, signatures électroniques.</li>
            <li><strong>Abonnement :</strong> identifiants GoCardless (mandat SEPA), historique de facturation.</li>
            <li><strong>Contact :</strong> nom, email, message via le formulaire public ou connecté.</li>
        </ul>

        <h2 class="text-lg font-bold text-gray-800 mt-6">3. Finalités et bases légales</h2>
        <ul class="list-disc pl-5 space-y-1">
            <li>Exécution du contrat SaaS et gestion des transports (art. 6.1.b RGPD).</li>
            <li>Facturation et obligations comptables (art. 6.1.c — conservation légale 10 ans).</li>
            <li>Sécurité, authentification et prévention de la fraude (intérêt légitime, art. 6.1.f).</li>
            <li>Support client et réponse aux demandes (art. 6.1.b et 6.1.f).</li>
        </ul>

        <h2 class="text-lg font-bold text-gray-800 mt-6">4. Destinataires et sous-traitants</h2>
        <p>Les données peuvent être traitées par des prestataires agissant pour notre compte : hébergeur, GoCardless (prélèvement SEPA), service email (SMTP), TomTom / Google Maps (cartographie et distances), prestataires CDN pour les ressources statiques. Des contrats de sous-traitance (DPA) doivent être signés avec chaque prestataire.</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">5. Durées de conservation</h2>
        <ul class="list-disc pl-5 space-y-1">
            <li>Compte actif : durée de la relation contractuelle.</li>
            <li>Factures et pièces comptables : 10 ans.</li>
            <li>Documents de transport (CMR, POD) : durée liée à l'exploitation et aux obligations légales.</li>
            <li>Messages contact : 3 ans maximum sauf obligation contraire.</li>
            <li>Compte supprimé : anonymisation de l'identifiant utilisateur ; certaines données peuvent être conservées pour obligations légales ou litiges.</li>
        </ul>

        <h2 class="text-lg font-bold text-gray-800 mt-6">6. Vos droits</h2>
        <p>Vous disposez des droits d'accès, rectification, effacement, limitation, opposition et portabilité. Pour les exercer :</p>
        <ul class="list-disc pl-5 space-y-1">
            <li>Espace connecté → <strong>Mes données personnelles</strong> (export / suppression de compte).</li>
            <li>Email : <a href="mailto:${legalEsc(L.dpo)}" class="text-blue-600 hover:underline">${legalEsc(L.dpo)}</a> (réponse sous 1 mois).</li>
        </ul>
        <p>Vous pouvez introduire une réclamation auprès de la <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">CNIL</a>.</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">7. Sécurité</h2>
        <p>Mots de passe hashés (bcrypt), sessions révocables, accès par rôle, isolation des données par entreprise (multi-tenant), chiffrement HTTPS en production.</p>
    `;
}

function getLegalMentionsHtml() {
    const L = FLENOVA_LEGAL;
    return `
        <h2 class="text-lg font-bold text-gray-800">Éditeur du site</h2>
        <p><strong>${legalEsc(L.company)}</strong><br>${legalEsc(L.address)}<br>SIRET : ${legalEsc(L.siret)}<br>TVA : ${legalEsc(L.tva)}<br>Email : ${legalEsc(L.email)}</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">Directeur de la publication</h2>
        <p>Le représentant légal de ${legalEsc(L.company)}.</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">Hébergement</h2>
        <p>${legalEsc(L.host)}</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">Propriété intellectuelle</h2>
        <p>L'ensemble des éléments de la plateforme Flenova (textes, logiciel, marque, interface) est protégé. Toute reproduction non autorisée est interdite.</p>
    `;
}

function getTermsHtml() {
    const L = FLENOVA_LEGAL;
    return `
        <p>Les présentes Conditions Générales d'Utilisation (« <strong>CGU</strong> ») régissent l'accès et l'utilisation de la plateforme SaaS <strong>Flenova TMS</strong>, éditée par ${legalEsc(L.company)}. L'utilisateur agit exclusivement en qualité de <strong>professionnel</strong> (transporteur, commissionnaire, PME).</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">1. Objet et description du service</h2>
        <p>Flenova fournit un logiciel en ligne (TMS) permettant la gestion des ordres de transport, du planning, de la flotte, des chauffeurs, de l'affrètement, de la facturation (Factur-X), du suivi client et des indicateurs d'activité. Le service est accessible via navigateur web et application mobile chauffeur.</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">2. Création de compte et essai</h2>
        <ul class="list-disc pl-5 space-y-1">
            <li>L'inscription crée un espace entreprise isolé (multi-tenant).</li>
            <li>Un essai Premium peut être proposé à l'inscription ; à l'issue de l'essai, le forfait choisi s'applique selon les <a href="#" onclick="openLegalPage('cgv'); return false;" class="text-blue-600 hover:underline">CGV</a>. L'abonnement payant est <strong>sans engagement de durée</strong> (résiliation mensuelle possible).</li>
            <li>L'utilisateur garantit l'exactitude des informations fournies et les met à jour sans délai.</li>
        </ul>

        <h2 class="text-lg font-bold text-gray-800 mt-6">3. Engagements de disponibilité (SLA)</h2>
        <p>Flenova s'efforce d'assurer une <strong>disponibilité mensuelle de 99,5&nbsp;%</strong> du service, hors :</p>
        <ul class="list-disc pl-5 space-y-1">
            <li>maintenance planifiée (notifiée au minimum 48 h à l'avance lorsque possible) ;</li>
            <li>interruptions imputables à l'hébergeur, au réseau Internet, à un cas de force majeure ou à un usage non conforme du Client ;</li>
            <li>indisponibilité des services tiers (GoCardless, cartographie, PA facturation électronique).</li>
        </ul>
        <p>En cas de non-respect avéré et documenté du SLA sur un mois calendaire, le Client administrateur peut demander un <strong>avoir au prorata</strong> du temps d'indisponibilité excédentaire, plafonné à <strong>un mois d'abonnement HT</strong> du forfait en cours. Aucun autre indemnité n'est due au titre du SLA.</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">4. Propriété des données</h2>
        <ul class="list-disc pl-5 space-y-1">
            <li><strong>Données métier du Client</strong> (clients, transports, documents, factures, chauffeurs, etc.) : le Client en reste <strong>propriétaire</strong>. Flenova n'en acquiert aucun droit de propriété, hors licence limitée nécessaire à l'hébergement et à l'exécution du service.</li>
            <li><strong>Logiciel, marque, interface et documentation Flenova</strong> : propriété exclusive de Flenova. Aucune cession de droits de propriété intellectuelle n'est consentie.</li>
            <li>Le Client peut <strong>exporter</strong> ses données (export JSON depuis l'espace « Mes données personnelles », exports CSV comptables) tant que le compte est actif.</li>
            <li>À la résiliation, Flenova conserve les données le temps des obligations légales (notamment comptables, 10 ans pour les factures), puis les supprime ou anonymise selon la politique de conservation.</li>
        </ul>

        <h2 class="text-lg font-bold text-gray-800 mt-6">5. Obligations du Client</h2>
        <ul class="list-disc pl-5 space-y-1">
            <li>Utiliser le service conformément à sa destination et à la réglementation transport / RGPD applicable à ses propres traitements.</li>
            <li>Préserver la confidentialité des identifiants et gérer les droits de ses utilisateurs internes.</li>
            <li>Ne pas tenter d'accéder aux données d'autres entreprises, ni de contourner les mesures de sécurité.</li>
            <li>Disposer des autorisations nécessaires pour traiter les données de ses clients, chauffeurs et destinataires via Flenova.</li>
        </ul>

        <h2 class="text-lg font-bold text-gray-800 mt-6">6. Limitation de responsabilité</h2>
        <p>Flenova est un <strong>outil d'aide à l'exploitation</strong>. Le Client reste seul responsable de ses opérations de transport, de la conformité de ses documents (CMR, factures, déclarations) et des décisions prises sur la base des informations affichées.</p>
        <p>Dans les limites autorisées par la loi, la responsabilité totale de Flenova au titre du service, sur une période de <strong>12 mois glissants</strong>, est plafonnée au montant des sommes effectivement versées par le Client au titre de l'abonnement sur cette période.</p>
        <p>Flenova ne pourra être tenue responsable des dommages indirects (perte de chiffre d'affaires, perte de clientèle, perte de données non imputable à une faute prouvée de Flenova, préjudice commercial).</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">7. Support et évolutions</h2>
        <p>Flenova peut faire évoluer le service (corrections, améliorations, nouvelles fonctionnalités) sans modifier substantiellement les engagements essentiels. Le support est accessible via l'espace Contact & Aide et ${legalEsc(L.email)}.</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">8. Suspension et résiliation</h2>
        <p>Flenova peut suspendre l'accès en cas de violation des CGU/CGV, de risque de sécurité ou d'impayé persistant. Le Client peut résilier selon les CGV. La suppression du compte utilisateur est possible depuis « Mes données personnelles ».</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">9. Droit applicable</h2>
        <p>Les CGU sont soumises au <strong>droit français</strong>. Compétence exclusive des tribunaux du ressort du siège social de Flenova, sauf dispositions impératives contraires.</p>
    `;
}

function getCgvHtml() {
    const L = FLENOVA_LEGAL;
    return `
        <p>Les présentes Conditions Générales de Vente (« <strong>CGV</strong> ») s'appliquent à toute souscription au service SaaS <strong>Flenova</strong> par un client professionnel. Elles complètent les <a href="#" onclick="openLegalPage('terms'); return false;" class="text-blue-600 hover:underline">CGU</a>.</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">1. Offres et tarifs</h2>
        <p>Les forfaits (Indépendant, PME, Premium) et suppléments (utilisateurs PC, chauffeurs mobile, confirmations affrètement hors quota) sont décrits sur la page Tarifs du site public Flenova. Les prix sont indiqués <strong>hors taxes (HT)</strong> en euros, <strong>sans engagement de durée</strong> (abonnement mensuel résiliable). Flenova se réserve le droit de modifier ses tarifs pour les périodes futures ; le Client en est informé avant renouvellement.</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">2. Commande et essai gratuit</h2>
        <ul class="list-disc pl-5 space-y-1">
            <li>La souscription s'effectue en ligne (inscription + choix de forfait) ou sur devis accepté par le Client.</li>
            <li>Un essai Premium peut être offert à l'inscription ; à son terme, le forfait choisi devient facturable sauf résiliation préalable. L'abonnement est ensuite <strong>sans engagement de durée</strong>.</li>
            <li>L'activation du mandat de prélèvement SEPA via GoCardless vaut acceptation des CGV.</li>
        </ul>

        <h2 class="text-lg font-bold text-gray-800 mt-6">3. Facturation et paiement</h2>
        <ul class="list-disc pl-5 space-y-1">
            <li>Facturation <strong>mensuelle</strong>, payable par prélèvement SEPA (GoCardless) ou tout autre moyen accepté par Flenova.</li>
            <li>Les suppléments et dépassements de quota sont facturés sur la période en cours ou la suivante selon les règles affichées dans l'application.</li>
            <li>Tout impayé peut entraîner la suspension de l'accès après mise en demeure restée sans effet sous 8 jours.</li>
        </ul>

        <h2 class="text-lg font-bold text-gray-800 mt-6">4. Durée et résiliation — sans engagement</h2>
        <p>L'abonnement est conclu <strong>sans engagement de durée</strong> : facturation mensuelle, reconduction tacite mois par mois, <strong>sans durée minimale</strong> ni pénalité de résiliation anticipée.</p>
        <p>Le Client peut résilier <strong>à tout moment</strong> depuis son espace (Mon abonnement), par email à ${legalEsc(L.email)} ou en révoquant son mandat SEPA via GoCardless. La résiliation prend effet à la fin de la période mensuelle en cours déjà facturée. Aucun remboursement au prorata n'est dû pour la période entamée, sauf disposition légale impérative ou accord écrit de Flenova.</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">5. Engagements de service</h2>
        <p>Les engagements de disponibilité (SLA 99,5&nbsp;%) et les modalités de crédit éventuel sont détaillés dans les CGU. Flenova fournit le service « en l'état » avec obligation de moyens renforcée pour un SaaS professionnel.</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">6. Propriété des données et réversibilité</h2>
        <p>Le Client conserve la propriété de ses données métier. En cas de résiliation, il dispose d'un délai de <strong>30 jours</strong> pour exporter ses données via les fonctionnalités d'export disponibles. Passé ce délai, Flenova pourra supprimer les données non soumises à obligation légale de conservation.</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">7. Limitation de responsabilité</h2>
        <p>La responsabilité de Flenova est limitée conformément aux CGU. En cas de manquement prouvé imputable à Flenova, seuls les dommages directs et prévisibles sont indemnisables, dans la limite du plafond contractuel (montant des abonnements versés sur 12 mois).</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">8. Réclamations</h2>
        <p>Toute réclamation commerciale ou facturation doit être adressée à ${legalEsc(L.email)} dans un délai de 30 jours suivant la facture ou l'événement concerné.</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">9. Droit applicable — litiges</h2>
        <p>Les CGV sont régies par le droit français. En cas de litige, les parties recherchent une solution amiable. À défaut, compétence exclusive des tribunaux du ressort du siège social de ${legalEsc(L.company)}.</p>
    `;
}

function getCookiesPolicyHtml() {
    return `
        <h2 class="text-lg font-bold text-gray-800">Cookies strictement nécessaires</h2>
        <p>Flenova utilise un cookie de session (<code>accessToken</code>, durée 24 h, httpOnly) indispensable à l'authentification. Il ne nécessite pas de consentement préalable (exemption CNIL — cookie technique).</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">Ressources tierces</h2>
        <p>Des bibliothèques peuvent être chargées depuis des CDN (polices, icônes, graphiques). Selon la configuration, ces services peuvent déposer des traceurs : consultez leurs politiques respectives. Aucun cookie publicitaire Flenova n'est déposé par défaut.</p>

        <h2 class="text-lg font-bold text-gray-800 mt-6">Gestion</h2>
        <p>Vous pouvez supprimer les cookies via les paramètres de votre navigateur. La déconnexion invalide la session côté serveur.</p>
    `;
}

function renderLegalPage(type) {
    const pages = {
        privacy: ['Politique de confidentialité', getPrivacyPolicyHtml()],
        legal: ['Mentions légales', getLegalMentionsHtml()],
        terms: ['Conditions générales d\'utilisation', getTermsHtml()],
        cgv: ['Conditions générales de vente', getCgvHtml()],
        cookies: ['Politique cookies', getCookiesPolicyHtml()]
    };
    const [title, body] = pages[type] || pages.privacy;
    return renderLegalDocumentShell(title, body);
}

function renderPrivacySettingsPage() {
    return `<div class="max-w-3xl mx-auto space-y-6 fade-in">
        <div>
            <h2 class="text-2xl font-bold text-gray-800">Mes données personnelles</h2>
            <p class="text-sm text-gray-500 mt-1">Exercez vos droits RGPD : accès, portabilité et suppression de compte.</p>
        </div>

        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 class="font-bold text-gray-700 mb-2"><i class="fa-solid fa-download mr-2 text-blue-600"></i>Exporter mes données</h3>
            <p class="text-sm text-gray-600 mb-4">Téléchargez une copie structurée de vos données (profil, entreprise, clients, transports, documents, factures).</p>
            <button type="button" onclick="exportMyPersonalData()" id="btn-export-data" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                Télécharger l'export JSON
            </button>
        </div>

        <div class="bg-white p-6 rounded-xl shadow-sm border border-red-100">
            <h3 class="font-bold text-red-700 mb-2"><i class="fa-solid fa-user-slash mr-2"></i>Supprimer mon compte</h3>
            <p class="text-sm text-gray-600 mb-2">Votre compte sera désactivé et votre identifiant anonymisé. Les données d'exploitation de l'entreprise (transports, factures) peuvent être conservées pour obligations légales ou si d'autres utilisateurs actifs subsistent.</p>
            <p class="text-xs text-gray-500 mb-4">Cette action est irréversible pour votre accès personnel.</p>
            <button type="button" onclick="confirmDeleteMyAccount()" id="btn-delete-account" class="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">
                Supprimer mon compte
            </button>
        </div>

        <div class="bg-gray-50 p-4 rounded-xl border border-gray-100 text-sm text-gray-600">
            <p class="font-semibold text-gray-700 mb-2">Documents et contact</p>
            ${renderLegalFooterLinks('')}
            <p class="mt-3">Question sur vos données : <a href="mailto:${legalEsc(FLENOVA_LEGAL.dpo)}" class="text-blue-600 hover:underline">${legalEsc(FLENOVA_LEGAL.dpo)}</a></p>
        </div>
    </div>`;
}

function openLegalPage(type) {
    window._legalPageType = type;
    const publicRouteMap = { privacy: 'privacy', legal: 'legal', terms: 'terms', cgv: 'cgv', cookies: 'cookies' };
    const publicRoute = publicRouteMap[type] || 'privacy';

    if (typeof isAuthenticated !== 'undefined' && isAuthenticated && typeof router === 'function') {
        window._legalReturnRoute = window.currentAppRoute || 'about';
        router('legal_page');
        return;
    }

    window._legalReturnRoute = (window.location.hash || '').replace('#', '').trim() || 'home';
    if (!PUBLIC_ROUTES.includes(window._legalReturnRoute)) {
        window._legalReturnRoute = 'home';
    }
    if (typeof publicRouter === 'function') {
        publicRouter(publicRoute);
        try {
            window.location.hash = publicRoute;
        } catch (_) { /* ignore */ }
    }
}

function historyBackLegal() {
    const back = window._legalReturnRoute || 'home';
    if (typeof isAuthenticated !== 'undefined' && isAuthenticated && typeof router === 'function') {
        router(back === 'home' ? 'about' : back);
        return;
    }
    if (typeof publicRouter === 'function') {
        publicRouter(PUBLIC_ROUTES.includes(back) ? back : 'home');
        try {
            window.location.hash = PUBLIC_ROUTES.includes(back) ? back : 'home';
        } catch (_) { /* ignore */ }
    }
}

async function exportMyPersonalData() {
    const btn = document.getElementById('btn-export-data');
    if (btn) btn.disabled = true;
    try {
        const res = await apiFetch('auth/export');
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || 'Export impossible');
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `flenova-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        if (typeof showToast === 'function') showToast('Export téléchargé', 'success');
    } catch (e) {
        if (typeof showToast === 'function') showToast(e.message, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function confirmDeleteMyAccount() {
    const ok = window.confirm(
        'Confirmer la suppression de votre compte ? Vous serez déconnecté et votre identifiant sera anonymisé.'
    );
    if (!ok) return;

    const btn = document.getElementById('btn-delete-account');
    if (btn) btn.disabled = true;
    try {
        const res = await apiFetch('auth/me', { method: 'DELETE' });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || 'Suppression impossible');
        localStorage.removeItem('user');
        if (typeof showToast === 'function') showToast(payload.message || 'Compte supprimé', 'success');
        setTimeout(() => { window.location.href = 'login.html'; }, 600);
    } catch (e) {
        if (typeof showToast === 'function') showToast(e.message, 'error');
        if (btn) btn.disabled = false;
    }
}

window.FLENOVA_LEGAL = FLENOVA_LEGAL;
window.renderLegalPage = renderLegalPage;
window.renderLegalFooterLinks = renderLegalFooterLinks;
window.renderPrivacySettingsPage = renderPrivacySettingsPage;
window.openLegalPage = openLegalPage;
window.historyBackLegal = historyBackLegal;
window.exportMyPersonalData = exportMyPersonalData;
window.confirmDeleteMyAccount = confirmDeleteMyAccount;
