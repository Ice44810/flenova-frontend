/**
 * Préparation commerciale — guide de prise en main & questionnaire retours
 */

function commercialEsc(value) {
    if (typeof escapeHtml === 'function') return escapeHtml(value);
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const ONBOARDING_STEPS = [
    {
        n: 1,
        icon: 'fa-building',
        title: 'Paramétrez votre entreprise',
        desc: 'Renseignez raison sociale, logo, IBAN et coordonnées dans Administration.',
        route: 'admin',
        tip: 'Ces informations apparaissent sur vos factures Factur-X et confirmations d\'affrètement.'
    },
    {
        n: 2,
        icon: 'fa-building-user',
        title: 'Créez vos clients',
        desc: 'Ajoutez vos donneurs d\'ordre avec contacts et adresses de facturation.',
        route: 'clients',
        tip: 'Un client bien renseigné accélère la création des ordres de transport.'
    },
    {
        n: 3,
        icon: 'fa-id-card',
        title: 'Invitez chauffeurs & véhicules',
        desc: 'Créez vos chauffeurs et associez-les à la flotte pour le planning.',
        route: 'drivers',
        tip: 'Chaque chauffeur reçoit un code d\'activation TF- : il s\'inscrit dans l\'app mobile avec ce code et un mot de passe, pas avec votre e-mail exploitant.'
    },
    {
        n: 4,
        icon: 'fa-list',
        title: 'Créez votre premier transport',
        desc: 'Ordre de transport : client, trajet, marchandise, tarif et statut.',
        route: 'transports',
        tip: 'Utilisez le calculateur de cotation pour estimer vos prix de vente.'
    },
    {
        n: 5,
        icon: 'fa-calendar-days',
        title: 'Planifiez sur le calendrier',
        desc: 'Affectez chauffeur et véhicule depuis le planning hebdomadaire.',
        route: 'planning',
        tip: 'Glissez-déposez ou modifiez une mission directement depuis le planning.'
    },
    {
        n: 6,
        icon: 'fa-mobile-screen-button',
        title: 'Exécutez sur le terrain',
        desc: 'Le chauffeur valide arrivée, signatures et POD depuis l\'app mobile.',
        route: 'inprogress_transports',
        tip: 'Le suivi client public (code TRK) se met à jour automatiquement.'
    },
    {
        n: 7,
        icon: 'fa-file-invoice-dollar',
        title: 'Facturez sans ressaisie',
        desc: 'Validez le transport, préfacturez puis émettez la facture Factur-X.',
        route: 'preinvoicing',
        tip: 'Export comptable CSV disponible pour votre expert-comptable.'
    },
    {
        n: 8,
        icon: 'fa-chart-pie',
        title: 'Pilotez votre activité',
        desc: 'Tableau de bord, marges et indicateurs clés en temps réel.',
        route: 'dashboard',
        tip: 'Consultez le guide ou contactez le support si vous bloquez sur une étape.'
    }
];

function renderOnboardingGuidePage() {
    const welcomeMsg = window.cachedPlatformStatus?.welcomeMessage;
    const welcomeBlock = welcomeMsg ? `
        <div class="bg-teal-50 border border-teal-200 rounded-xl p-5 text-teal-900">
            <h2 class="font-bold text-lg mb-2"><i class="fa-solid fa-handshake text-teal-600 mr-2"></i>Message de l'équipe Flenova</h2>
            <p class="text-sm leading-relaxed whitespace-pre-line">${commercialEsc(welcomeMsg)}</p>
        </div>
    ` : '';

    const steps = ONBOARDING_STEPS.map((s) => `
        <article class="bg-white border border-gray-100 rounded-xl p-5 shadow-sm hover:shadow-md transition">
            <div class="flex gap-4">
                <div class="shrink-0 w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-lg">
                    <i class="fa-solid ${s.icon}" aria-hidden="true"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <p class="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">Étape ${s.n}</p>
                    <h3 class="font-bold text-gray-900 mb-1">${commercialEsc(s.title)}</h3>
                    <p class="text-sm text-gray-600 mb-2">${commercialEsc(s.desc)}</p>
                    <p class="text-xs text-gray-500 mb-3"><i class="fa-solid fa-lightbulb text-amber-500 mr-1"></i>${commercialEsc(s.tip)}</p>
                    <button type="button" onclick="router('${s.route}')" class="text-sm text-blue-600 hover:text-blue-800 font-medium">
                        Aller à cette section <i class="fa-solid fa-arrow-right ml-1"></i>
                    </button>
                </div>
            </div>
        </article>
    `).join('');

    return `<div class="max-w-4xl mx-auto fade-in space-y-8">
        <div class="text-center">
            <p class="text-sm font-semibold text-blue-600 uppercase tracking-wide mb-2">Bienvenue sur Flenova</p>
            <h1 class="text-3xl font-extrabold text-gray-900 mb-3">Guide de prise en main rapide</h1>
            <p class="text-gray-600 max-w-2xl mx-auto">Suivez ces 8 étapes pour être opérationnel en moins d'une heure. Chaque étape ouvre directement la section concernée.</p>
        </div>

        ${welcomeBlock}

        <div class="bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
                <h2 class="font-bold text-lg mb-1"><i class="fa-solid fa-gift mr-2"></i>Essai Premium actif</h2>
                <p class="text-sm text-blue-100">Profitez de toutes les fonctionnalités pendant votre période d'essai. Abonnement mensuel sans engagement de durée par la suite.</p>
            </div>
            <button type="button" onclick="router('contact')" class="shrink-0 px-5 py-2.5 bg-white text-blue-700 rounded-lg font-semibold hover:bg-blue-50 transition">
                Contacter le support
            </button>
        </div>

        <div class="grid grid-cols-1 gap-4">${steps}</div>

        <div class="bg-gray-50 border border-gray-100 rounded-xl p-6 text-center">
            <h3 class="font-bold text-gray-800 mb-2">Une idée ou un blocage ?</h3>
            <p class="text-sm text-gray-600 mb-4">Aidez-nous à améliorer Flenova en partageant vos retours.</p>
            <button type="button" onclick="router('feedback')" class="px-5 py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition">
                Remplir le questionnaire
            </button>
        </div>
    </div>`;
}

function renderFeedbackQuestionnairePage() {
    return `<div class="max-w-2xl mx-auto fade-in">
        <div class="mb-8">
            <h1 class="text-3xl font-extrabold text-gray-900 mb-2">Vos retours nous intéressent</h1>
            <p class="text-gray-600">Signalez un bug, une friction UX ou une fonctionnalité manquante. Vos réponses sont transmises à l'équipe produit Flenova.</p>
        </div>

        <form id="feedback-form" class="bg-white border border-gray-100 rounded-xl shadow-sm p-6 space-y-6" onsubmit="submitCustomerFeedback(event)">
            <fieldset>
                <legend class="block text-sm font-semibold text-gray-800 mb-3">Satisfaction globale *</legend>
                <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Satisfaction de 1 à 5">
                    ${[1, 2, 3, 4, 5].map((n) => `
                        <label class="feedback-rating-label cursor-pointer">
                            <input type="radio" name="feedback-rating" value="${n}" class="sr-only peer" ${n === 4 ? 'checked' : ''} required>
                            <span class="inline-flex items-center justify-center w-11 h-11 rounded-lg border-2 border-gray-200 peer-checked:border-blue-600 peer-checked:bg-blue-50 peer-checked:text-blue-700 font-bold text-gray-600 hover:border-blue-300 transition">${n}</span>
                        </label>
                    `).join('')}
                </div>
                <p class="text-xs text-gray-500 mt-2">1 = insatisfait · 5 = très satisfait</p>
            </fieldset>

            <div>
                <label for="feedback-bugs" class="block text-sm font-semibold text-gray-800 mb-2">
                    <i class="fa-solid fa-bug text-red-500 mr-1"></i>Bugs rencontrés
                </label>
                <textarea id="feedback-bugs" rows="3" class="w-full border border-gray-200 rounded-lg p-3 text-sm focus:ring-blue-500 focus:border-blue-500" placeholder="Décrivez le problème, la page concernée et les étapes pour le reproduire…"></textarea>
            </div>

            <div>
                <label for="feedback-ux" class="block text-sm font-semibold text-gray-800 mb-2">
                    <i class="fa-solid fa-wand-magic-sparkles text-purple-500 mr-1"></i>UX manquante ou frustrante
                </label>
                <textarea id="feedback-ux" rows="3" class="w-full border border-gray-200 rounded-lg p-3 text-sm focus:ring-blue-500 focus:border-blue-500" placeholder="Navigation, libellés, étapes trop longues, informations absentes…"></textarea>
            </div>

            <div>
                <label for="feedback-features" class="block text-sm font-semibold text-gray-800 mb-2">
                    <i class="fa-solid fa-puzzle-piece text-blue-500 mr-1"></i>Fonctionnalités attendues
                </label>
                <textarea id="feedback-features" rows="3" class="w-full border border-gray-200 rounded-lg p-3 text-sm focus:ring-blue-500 focus:border-blue-500" placeholder="Intégrations, rapports, automatisations, modules métier…"></textarea>
            </div>

            <div>
                <label for="feedback-comment" class="block text-sm font-semibold text-gray-800 mb-2">Commentaire libre</label>
                <textarea id="feedback-comment" rows="2" class="w-full border border-gray-200 rounded-lg p-3 text-sm focus:ring-blue-500 focus:border-blue-500" placeholder="Autre remarque ou suggestion…"></textarea>
            </div>

            <p class="text-xs text-gray-500">* Satisfaction obligatoire. Au moins un des champs de détail doit être renseigné.</p>

            <button type="submit" id="feedback-submit-btn" class="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50">
                Envoyer mes retours
            </button>
        </form>

        <p class="text-center text-sm text-gray-500 mt-6">
            Besoin d'une réponse rapide ? <button type="button" onclick="router('contact')" class="text-blue-600 hover:underline">Contact & Aide</button>
        </p>
    </div>`;
}

async function submitCustomerFeedback(e) {
    e.preventDefault();
    const btn = document.getElementById('feedback-submit-btn');
    const ratingEl = document.querySelector('input[name="feedback-rating"]:checked');
    const payload = {
        satisfaction_rating: ratingEl ? Number(ratingEl.value) : null,
        bugs: document.getElementById('feedback-bugs')?.value?.trim() || '',
        ux_missing: document.getElementById('feedback-ux')?.value?.trim() || '',
        features_expected: document.getElementById('feedback-features')?.value?.trim() || '',
        comment: document.getElementById('feedback-comment')?.value?.trim() || '',
        page_context: window.currentAppRoute || 'feedback'
    };

    if (btn) btn.disabled = true;
    try {
        const res = await apiFetch('feedback', { method: 'POST', body: payload });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Envoi impossible');
        if (typeof showToast === 'function') showToast(data.message || 'Merci pour votre retour !', 'success');
        document.getElementById('feedback-form')?.reset();
        const defaultRating = document.querySelector('input[name="feedback-rating"][value="4"]');
        if (defaultRating) defaultRating.checked = true;
    } catch (err) {
        if (typeof showToast === 'function') showToast(err.message, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

window.renderOnboardingGuidePage = renderOnboardingGuidePage;
window.renderFeedbackQuestionnairePage = renderFeedbackQuestionnairePage;
window.submitCustomerFeedback = submitCustomerFeedback;
