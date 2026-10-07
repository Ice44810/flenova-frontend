/**
 * Abonnements Flenova — tarifs unifiés, suppléments et gating UI par forfait
 */
window.cachedSubscription = null;
window.cachedPlans = null;

async function loadPublicPlans() {
    if (window.cachedPlans) return window.cachedPlans;
    try {
        const res = await fetch('/api/subscription/plans');
        if (res.ok) {
            const data = await res.json();
            window.cachedPlans = data.data || [];
            return window.cachedPlans;
        }
    } catch (e) { /* ignore */ }
    window.cachedPlans = getFallbackPlans();
    return window.cachedPlans;
}

function getFallbackPlans() {
    return [
        {
            id: 'independant',
            name: 'Indépendant',
            tagline: 'Transporteur solo — exploitation & affrètement limité',
            priceMonthly: 129,
            popular: false,
            limits: { maxUsers: 1, maxMobileDrivers: 3, maxAffretementSendsPerMonth: 20 },
            addonsAllowed: true,
            featureLabels: [
                '1 utilisateur PC inclus (+29 €/mois / user suppl.)',
                '3 chauffeurs mobile inclus (+19 €/mois / chauffeur suppl.)',
                'Commandes, planning & app mobile (GPS, eCMR, signatures)',
                'CMR / bordereaux & suivi client (code TRK)',
                'Affrètement & carnet sous-traitants : 20 confirmations/mois (+1,50 €/envoi au-delà)',
                'Litiges transport inclus',
                'Calculateur de cotation (poids taxé & trinôme)',
                'Facturation Factur-X & export comptable CSV',
                'Carbone GLEC par transport'
            ]
        },
        {
            id: 'pme',
            name: 'PME',
            tagline: 'Équipe et sous-traitance — marges & conformité',
            priceMonthly: 269,
            popular: true,
            limits: { maxUsers: 5, maxMobileDrivers: 25, maxAffretementSendsPerMonth: 50 },
            addonsAllowed: true,
            featureLabels: [
                '5 utilisateurs PC inclus (+29 €/mois / user suppl.)',
                '25 chauffeurs mobile inclus (+19 €/mois / chauffeur suppl.)',
                'Tout Indépendant + marges affrètement & conformité ST (RC Pro, URSSAF)',
                '50 confirmations affrètement/mois (+1,50 €/envoi au-delà)',
                'Palettes Europe (solde & échanges)',
                'Optimisation green & rapports CSRD',
                'Litiges transport inclus'
            ]
        },
        {
            id: 'premium',
            name: 'Premium',
            tagline: 'Multi-agences & volume — capacité étendue',
            priceMonthly: 449,
            popular: false,
            limits: { maxUsers: 15, maxMobileDrivers: 50, maxAffretementSendsPerMonth: null },
            addonsAllowed: true,
            featureLabels: [
                '15 utilisateurs PC & 50 chauffeurs mobile inclus',
                'Confirmations affrètement illimitées (création + envoi email)',
                'Suppléments au-delà : +29 €/PC · +19 €/mobile',
                'Toutes les fonctions PME',
                'Administration : users, agences, logo, IBAN',
                'Multi-agences & filtres par dépôt',
                'Litiges transport inclus',
                'Support prioritaire & personnalisation'
            ]
        }
    ];
}

const PUBLIC_PLAN_COMPARISON_ROWS = [
    { label: 'Utilisateurs PC inclus', independant: '1', pme: '5', premium: '15' },
    { label: 'Chauffeurs mobile inclus', independant: '3', pme: '25', premium: '50' },
    { label: 'Confirmations affrètement / mois', independant: '20 (+1,50 €)', pme: '50 (+1,50 €)', premium: 'Illimité' },
    { label: 'Suppléments PC / mobile', independant: '+29 € / +19 €', pme: '+29 € / +19 €', premium: '+29 € / +19 €' },
    { label: 'Commandes, planning & flotte', independant: true, pme: true, premium: true },
    { label: 'App mobile (GPS, eCMR, signatures)', independant: true, pme: true, premium: true },
    { label: 'Suivi client public (code TRK)', independant: true, pme: true, premium: true },
    { label: 'Factur-X & export comptable', independant: true, pme: true, premium: true },
    { label: 'Calculateur de cotation', independant: true, pme: true, premium: true },
    { label: 'Carbone GLEC par transport', independant: true, pme: true, premium: true },
    { label: 'Affrètement (confirmations PDF)', independant: true, pme: true, premium: true },
    { label: 'Carnet sous-traitants', independant: true, pme: true, premium: true },
    { label: 'Litiges transport', independant: true, pme: true, premium: true },
    { label: 'Dashboard marges & confirmation PDF', independant: false, pme: true, premium: true },
    { label: 'Palettes Europe', independant: false, pme: true, premium: true },
    { label: 'Optimisation green & rapports CSRD', independant: false, pme: true, premium: true },
    { label: 'Multi-agences & administration', independant: false, pme: false, premium: true }
];

function renderPlanComparisonCell(value) {
    if (value === true) {
        return '<span class="public-plans-check" aria-label="Inclus"><i class="fa-solid fa-check"></i></span>';
    }
    if (value === false) {
        return '<span class="public-plans-dash" aria-label="Non inclus">—</span>';
    }
    return `<span class="public-plans-text">${value}</span>`;
}

function renderPublicPlansComparison() {
    const plans = window.cachedPlans || getFallbackPlans();
    const planMeta = Object.fromEntries(plans.map((p) => [p.id, p]));
    const headCells = ['independant', 'pme', 'premium'].map((id) => {
        const p = planMeta[id] || {};
        const popular = p.popular ? ' public-plans-col--popular' : '';
        return `<th scope="col" class="public-plans-col${popular}">
            <span class="public-plans-col-name">${p.name || id}</span>
            <span class="public-plans-col-price">${p.priceMonthly ?? '—'} €<small>/mois HT</small></span>
        </th>`;
    }).join('');

    const bodyRows = PUBLIC_PLAN_COMPARISON_ROWS.map((row) => `
        <tr>
            <th scope="row">${row.label}</th>
            <td>${renderPlanComparisonCell(row.independant)}</td>
            <td>${renderPlanComparisonCell(row.pme)}</td>
            <td>${renderPlanComparisonCell(row.premium)}</td>
        </tr>
    `).join('');

    return `<div class="public-plans-comparison-wrap">
        <table class="public-plans-comparison" aria-label="Comparatif des forfaits Flenova">
            <thead>
                <tr>
                    <th scope="col" class="public-plans-feature-col">Fonctionnalité</th>
                    ${headCells}
                </tr>
            </thead>
            <tbody>${bodyRows}</tbody>
        </table>
    </div>`;
}

function renderPublicPlansSection() {
    return `<section class="public-plans-section" id="public-plans" aria-labelledby="public-plans-title">
        <div class="public-section-inner">
            <p class="public-page-eyebrow">Tarifs transparents</p>
            <h2 class="public-section-title" id="public-plans-title">Trois forfaits, une couverture complète</h2>
            <p class="public-section-lead">Du transporteur solo à la PME multi-agences : choisissez le forfait adapté à votre volume. Essai Premium 30 jours à l’inscription · <strong>Sans engagement de durée</strong>.</p>
            ${renderPublicPlansComparison()}
            <div class="public-plans-cards mt-12">
                ${renderPricingCards({ mode: 'public' })}
            </div>
            <p class="public-plans-footnote text-center mt-6">
                <button type="button" class="public-pillar-link" onclick="publicRouter('tarifs')">Voir le détail des tarifs <i class="fa-solid fa-arrow-right"></i></button>
            </p>
        </div>
    </section>`;
}

async function hydratePublicPlansSection() {
    const mount = document.getElementById('public-plans-mount');
    if (!mount) return;
    try {
        await loadPublicPlans();
        mount.outerHTML = renderPublicPlansSection();
    } catch (e) {
        mount.outerHTML = renderPublicPlansSection();
    }
}

function renderPricingCards(options = {}) {
    const { mode = 'public', selectedPlan = null } = options;
    const plans = window.cachedPlans || getFallbackPlans();
    const cards = plans.map((plan) => {
        const popular = plan.popular
            ? `<div class="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-blue-600 text-white px-4 py-1 rounded-full text-sm font-bold">Le plus populaire</div>`
            : '';
        const borderClass = plan.popular ? 'public-pricing-popular relative border-2 border-blue-500' : 'border border-gray-100 hover:shadow-xl transition';
        const features = (plan.featureLabels || []).map((f) =>
            `<li><i class="fa-solid fa-check text-green-500 mr-2"></i>${f}</li>`
        ).join('');

        let buttonHtml;
        if (mode === 'public') {
            buttonHtml = `<button type="button" onclick="publicRouterContactTrial('${plan.id}')" class="block w-full py-2.5 text-center ${plan.popular ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border border-blue-600 text-blue-600 hover:bg-blue-50'} rounded-lg font-semibold transition">Commencer l'essai</button>`;
        } else if (selectedPlan === plan.id) {
            buttonHtml = `<div class="w-full py-2.5 text-center bg-green-50 border border-green-200 text-green-800 rounded-lg font-semibold">Votre forfait actuel</div>`;
        } else if (mode === 'app' && window.cachedSubscription?.needsPayment) {
            buttonHtml = `<button type="button" onclick="subscribeToPlan('${plan.id}')" class="block w-full py-2.5 text-center bg-blue-600 text-white hover:bg-blue-700 rounded-lg font-semibold transition">Activer ${plan.name}</button>`;
        } else {
            buttonHtml = `<p class="text-center text-sm text-gray-500 py-2">Changement de forfait — contactez notre équipe ou réactivez depuis Tarifs.</p>`;
        }

        return `<div class="bg-white p-8 rounded-2xl shadow-lg ${borderClass}">
            ${popular}
            <h3 class="font-bold text-xl text-gray-800 mb-1">${plan.name}</h3>
            <p class="text-sm text-gray-500 mb-3">${plan.tagline || ''}</p>
            <div class="text-4xl font-bold text-gray-900 mb-4">${plan.priceMonthly}€<span class="text-sm font-normal text-gray-500">/mois HT</span></div>
            <ul class="space-y-3 text-sm text-gray-600 mb-6">${features}</ul>
            ${buttonHtml}
        </div>`;
    }).join('');

    return `<div class="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">${cards}</div>
        <p class="mt-12 text-center text-gray-600">Tous les tarifs sont hors taxes. <strong>Essai Premium 30 jours</strong> à l’inscription · <strong>Sans engagement de durée</strong>.<br>
        <span class="text-sm text-gray-500">Facturation mensuelle · Prélèvement SEPA · Résiliation possible à tout moment, sous réserve d’un préavis d’1 mois (effet en fin de période mensuelle) · Suppléments : +29 €/utilisateur PC · +19 €/chauffeur mobile / mois · +1,50 €/confirmation affrètement au-delà du quota (20/mois Indépendant · 50/mois PME · illimité Premium).</span></p>`;
}

async function renderPublicPricingAsync() {
    await loadPublicPlans();
    return `<div class="fade-in">
        <div class="public-page-header py-12">
            <div class="max-w-6xl mx-auto px-4 sm:px-6 text-center">
                <h1 class="text-4xl font-extrabold text-blue-900 mb-4">Tarifs Flenova</h1>
                <p class="text-lg text-gray-600">Des solutions adaptées à vos besoins, sans frais cachés — <strong>sans engagement de durée</strong>.</p>
            </div>
        </div>
        <div class="max-w-6xl mx-auto px-4 sm:px-6 py-12">
            ${renderPricingCards({ mode: 'public' })}
        </div>
    </div>`;
}

function renderUsageBar(label, used, max) {
    if (max == null) return '';
    const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
    const color = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-orange-400' : 'bg-blue-500';
    return `<div class="mb-3">
        <div class="flex justify-between text-sm mb-1">
            <span class="text-gray-600">${label}</span>
            <span class="font-medium ${pct >= 100 ? 'text-red-600' : 'text-gray-800'}">${used} / ${max}</span>
        </div>
        <div class="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div class="${color} h-full rounded-full transition-all" style="width:${pct}%"></div>
        </div>
    </div>`;
}

function renderAddonsPanel(sub) {
    if (!sub?.addons?.allowed) return '';
    const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    if (user?.role !== 'admin') return '';

    const cfg = sub.addons?.config || {};
    const pcPrice = cfg.extraPcUser?.priceMonthly ?? 29;
    const mobilePrice = cfg.extraMobileDriver?.priceMonthly ?? 19;
    const extraPc = sub.addons?.extraPcUsers ?? 0;
    const extraMobile = sub.addons?.extraMobileDrivers ?? 0;
    const included = sub.includedLimits || {};

    return `<div class="mt-8 max-w-xl mx-auto bg-white border border-gray-200 rounded-xl p-6 shadow-sm text-left">
        <h3 class="font-bold text-gray-800 mb-1"><i class="fa-solid fa-puzzle-piece text-blue-600 mr-2"></i>Suppléments mensuels</h3>
        <p class="text-sm text-gray-500 mb-4">Inclus dans le forfait : ${included.maxUsers ?? '—'} PC · ${included.maxMobileDrivers ?? '—'} mobile. Les suppléments s'ajoutent à la facture.</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div class="border border-gray-100 rounded-lg p-4">
                <p class="text-sm font-medium text-gray-700 mb-2">Utilisateurs PC suppl.</p>
                <div class="flex items-center gap-3">
                    <button type="button" onclick="adjustSubscriptionAddon('extra_pc_users', -1)" class="w-9 h-9 rounded-lg border border-gray-200 hover:bg-gray-50 font-bold">−</button>
                    <span id="addon-pc-count" class="text-xl font-bold w-8 text-center">${extraPc}</span>
                    <button type="button" onclick="adjustSubscriptionAddon('extra_pc_users', 1)" class="w-9 h-9 rounded-lg border border-gray-200 hover:bg-gray-50 font-bold">+</button>
                    <span class="text-sm text-gray-500 ml-auto">+${pcPrice} €/mois</span>
                </div>
            </div>
            <div class="border border-gray-100 rounded-lg p-4">
                <p class="text-sm font-medium text-gray-700 mb-2">Chauffeurs mobile suppl.</p>
                <div class="flex items-center gap-3">
                    <button type="button" onclick="adjustSubscriptionAddon('extra_mobile_drivers', -1)" class="w-9 h-9 rounded-lg border border-gray-200 hover:bg-gray-50 font-bold">−</button>
                    <span id="addon-mobile-count" class="text-xl font-bold w-8 text-center">${extraMobile}</span>
                    <button type="button" onclick="adjustSubscriptionAddon('extra_mobile_drivers', 1)" class="w-9 h-9 rounded-lg border border-gray-200 hover:bg-gray-50 font-bold">+</button>
                    <span class="text-sm text-gray-500 ml-auto">+${mobilePrice} €/mois</span>
                </div>
            </div>
        </div>
        <button type="button" id="addon-save-btn" onclick="saveSubscriptionAddons()" class="w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50">
            Enregistrer les suppléments
        </button>
        <p id="addon-save-msg" class="text-sm mt-2 hidden"></p>
    </div>`;
}

function renderBillingSummary(sub) {
    const billing = sub.billing;
    if (!billing) return '';
    const parts = [`Estimation : <strong>${billing.totalMonthly ?? sub.priceMonthly} € HT/mois</strong>`];
    const detail = [];
    if (billing.baseMonthly != null) detail.push(`forfait ${billing.baseMonthly} €`);
    if (billing.addonsMonthly > 0) detail.push(`suppléments ${billing.addonsMonthly} €`);
    if (billing.affretementOverageMonthly > 0) {
        detail.push(`affrètement hors quota ${billing.affretementOverageMonthly.toFixed(2).replace('.', ',')} €`);
    }
    if (detail.length) parts.push(`<span class="text-gray-500">(${detail.join(' + ')})</span>`);
    return `<p class="text-sm text-gray-600">${parts.join(' ')}</p>`;
}

function renderAppPricingPage() {
    const sub = window.cachedSubscription || {};
    const usage = sub.usage || {};
    const limits = sub.limits || {};
    const affretement = sub.affretementUsage || {};
    const warnings = (sub.usageWarnings || []).map((w) =>
        `<p class="text-sm ${w.type?.includes('at_limit') ? 'text-red-600' : 'text-orange-600'} mt-1"><i class="fa-solid fa-triangle-exclamation mr-1"></i>${w.message}</p>`
    ).join('');

    const companyName = (typeof getCurrentUser === 'function' ? getCurrentUser()?.company_name : null) || '';
    const safeCompany = typeof escapeHtml === 'function' ? escapeHtml(companyName) : companyName;

    return `<div class="max-w-3xl mx-auto fade-in py-10">
        <div class="text-center mb-10">
            <h1 class="text-3xl font-extrabold text-gray-900 mb-4">Mon abonnement</h1>
            <p class="text-sm text-gray-500 mb-2">Entreprise : <strong>${safeCompany || '—'}</strong></p>
            <p class="text-lg text-gray-600">Forfait actuel : <strong>${sub.planName || '—'}</strong>${sub.isDemo ? ` — essai Premium (${sub.demoDaysRemaining ?? '—'} j. restants)` : ''}</p>
            ${sub.isDemo && sub.targetPlanName ? `<p class="text-sm text-purple-700 mt-2">Après l'essai : forfait ${sub.targetPlanName}</p>` : ''}
            <div class="max-w-md mx-auto mt-6 text-left bg-gray-50 rounded-xl p-4">
                ${renderUsageBar('Utilisateurs PC', usage.users || 0, limits.maxUsers)}
                ${renderUsageBar('Chauffeurs mobile', usage.mobileDrivers || 0, limits.maxMobileDrivers)}
                ${affretement.limit != null ? renderUsageBar('Confirmations affrètement (mois)', affretement.sendsThisMonth || 0, affretement.limit) : ''}
            </div>
            ${affretement.billableSendsThisMonth > 0 ? `<p class="text-sm text-amber-700 mt-2">Affrètements hors quota ce mois : ${affretement.billableSendsThisMonth}</p>` : ''}
            ${warnings}
            <p class="text-sm text-gray-500 mt-4">Abonnement <strong>sans engagement de durée</strong> · Facturation mensuelle · Prélèvement SEPA · Résiliation possible à tout moment, sous réserve d’un préavis d’1 mois (effet en fin de période mensuelle).</p>
            <p class="text-sm mt-3"><a href="/index.html#tarifs" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline font-medium">Consulter les tarifs et comparatif des forfaits →</a></p>
            ${sub.needsPayment && !sub.isDemo ? `<button type="button" onclick="subscribeToPlan('${sub.targetPlan || sub.plan}')" class="mt-4 px-6 py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition">${sub.accessSuspended ? 'Mettre à jour mon paiement' : 'Activer mon abonnement'}</button>` : ''}
        </div>
        ${(() => {
            const cancelReq = typeof getCancellationRequest === 'function' ? getCancellationRequest() : null;
            const effectDate = sub.cancellationEffectDate || cancelReq?.effectDate;
            const requestedAt = sub.cancellationRequestedAt || cancelReq?.requestedAt;
            const isAdmin = (typeof getCurrentUser === 'function' ? getCurrentUser()?.role : null) === 'admin';
            if (sub.isDemo) return '';
            return `<div class="mt-6 max-w-xl mx-auto text-left bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <h3 class="font-bold text-gray-800 mb-1">Résiliation</h3>
                <p class="text-sm text-gray-500 mb-3">Sans engagement de durée · préavis obligatoire d'1 mois · effet en fin de période mensuelle · tout mois entamé est dû (CGV).</p>
                ${effectDate ? `<p class="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg p-3 mb-3">Résiliation demandée${requestedAt ? ` le ${new Date(requestedAt).toLocaleDateString('fr-FR')}` : ''} — effet estimé <strong>${effectDate}</strong>.</p>` : ''}
                ${isAdmin && !effectDate ? `<button type="button" onclick="requestSubscriptionCancellation()" class="px-4 py-2 border border-red-200 text-red-700 rounded-lg text-sm font-semibold hover:bg-red-50">Demander la résiliation (préavis 1 mois)</button>` : (!isAdmin ? `<p class="text-xs text-gray-500">Contactez l'administrateur de votre entreprise pour résilier.</p>` : '')}
            </div>`;
        })()}
        ${renderAddonsPanel(sub)}
        ${renderBillingSummary(sub)}
    </div>`;
}

window._addonDraft = { extra_pc_users: 0, extra_mobile_drivers: 0 };

let _subscriptionPollTimer = null;
let _subscriptionPollTicks = 0;
const SUBSCRIPTION_POLL_MS = 10000;
const SUBSCRIPTION_POLL_MAX_TICKS = 36; // ~6 min

function subscriptionNeedsRegularization(sub = window.cachedSubscription) {
    if (!sub || sub.isDemo || sub.isTrial || sub.trialActive) return false;
    return !!(sub.needsPayment || sub.gracePeriod || sub.accessSuspended || sub.status === 'past_due');
}

function stopSubscriptionStatusPolling() {
    if (_subscriptionPollTimer) {
        clearInterval(_subscriptionPollTimer);
        _subscriptionPollTimer = null;
    }
    _subscriptionPollTicks = 0;
}

/**
 * Relit le statut abonnement depuis la BDD (GET /subscription/status)
 * et met à jour l'UI (bandeaux / écran suspendu / modale).
 */
window.refreshSubscriptionStatus = async function (opts = {}) {
    try {
        // Optionnellement resynchroniser via GoCardless (écrit en BDD) avant lecture locale
        if (opts.syncRemote) {
            try {
                await apiFetch('gocardless/sync', { method: 'POST', body: {} });
            } catch { /* lecture BDD suffit ensuite */ }
        }
        const res = await apiFetch('subscription/status');
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) return null;
        const prev = window.cachedSubscription || {};
        const next = payload.data;
        if (!next) return null;

        window.cachedSubscription = next;
        window._addonDraft = {
            extra_pc_users: next.addons?.extraPcUsers ?? 0,
            extra_mobile_drivers: next.addons?.extraMobileDrivers ?? 0
        };
        // Met à jour l'UI sans relancer le polling (évite reset du timer)
        if (typeof applyDemoBanner === 'function') applyDemoBanner();
        if (typeof applyGraceBanner === 'function') applyGraceBanner();
        if (typeof applyAccessSuspendedScreen === 'function') applyAccessSuspendedScreen();
        if (typeof updateNavQuotaWidget === 'function') updateNavQuotaWidget();
        if (typeof updateAppActionRail === 'function') {
            updateAppActionRail(window.currentAppRoute || 'dashboard');
        }

        const wasProblem = subscriptionNeedsRegularization(prev);
        const nowOk = next.status === 'active' && !next.accessSuspended && !next.needsPayment;
        if (wasProblem && nowOk) {
            stopSubscriptionStatusPolling();
            if (typeof closeAppModal === 'function') closeAppModal('saas-overdue-modal');
            else document.getElementById('saas-overdue-modal')?.classList.add('hidden');
            try { sessionStorage.removeItem('overdue_dismissed'); } catch { /* ignore */ }
            if (typeof showToast === 'function') {
                showToast('Paiement enregistré — votre accès est rétabli.', 'success');
            }
            if (typeof router === 'function' && (window.currentAppRoute === 'pricing' || opts.reloadPricing)) {
                router('pricing');
            }
        } else if (subscriptionNeedsRegularization(next)) {
            startSubscriptionStatusPolling();
        } else {
            stopSubscriptionStatusPolling();
        }
        return next;
    } catch (e) {
        console.warn('[subscription] refreshStatus:', e.message);
        return null;
    }
};

/**
 * Polling BDD tant que le compte est en grâce / impayé / suspendu,
 * ou après retour GoCardless (paiement en cours de confirmation).
 */
window.startSubscriptionStatusPolling = function (opts = {}) {
    const force = !!opts.force;
    if (!force && !subscriptionNeedsRegularization()) {
        stopSubscriptionStatusPolling();
        return;
    }
    // Déjà en cours : ne pas réinitialiser le compteur (évite une boucle avec applySubscriptionAccessGate)
    if (_subscriptionPollTimer && !force) return;

    stopSubscriptionStatusPolling();

    const tick = async () => {
        _subscriptionPollTicks += 1;
        const doSync = force && _subscriptionPollTicks <= 3;
        const ctx = await refreshSubscriptionStatus({ syncRemote: doSync });
        if (ctx && ctx.status === 'active' && !ctx.accessSuspended) {
            stopSubscriptionStatusPolling();
            return;
        }
        if (_subscriptionPollTicks >= SUBSCRIPTION_POLL_MAX_TICKS) {
            stopSubscriptionStatusPolling();
        }
    };

    void tick();
    _subscriptionPollTimer = setInterval(tick, SUBSCRIPTION_POLL_MS);
};

async function completeGoCardlessReturn() {
    const params = new URLSearchParams(window.location.search);
    const gcFlag = params.get('gocardless');
    const billingRequestId = params.get('billing_request_id');
    if (!billingRequestId || (gcFlag && gcFlag !== 'success')) return;

    try {
        const res = await apiFetch('gocardless/complete', {
            method: 'POST',
            body: { billing_request_id: billingRequestId }
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || payload.message || 'Finalisation impossible');
        if (payload?.data) {
            window.cachedSubscription = payload.data;
            if (typeof applySubscriptionAccessGate === 'function') applySubscriptionAccessGate();
        }
        const clean = new URL(window.location.href);
        clean.searchParams.delete('gocardless');
        clean.searchParams.delete('billing_request_id');
        clean.searchParams.delete('billing_request_flow_id');
        window.history.replaceState({}, '', clean.pathname + clean.search + (window.location.hash || ''));
        if (typeof showToast === 'function') {
            showToast(payload?.message || 'Abonnement activé via GoCardless.', 'success');
        } else {
            alert(payload?.message || 'Abonnement activé via GoCardless.');
        }
        startSubscriptionStatusPolling({ force: true });
        if (typeof router === 'function') router('pricing');
    } catch (e) {
        console.warn('[GoCardless] complete:', e.message);
        if (typeof showToast === 'function') {
            showToast(e.message || 'Autorisation reçue — confirmation en cours…', 'info');
        } else {
            alert(e.message || 'Autorisation reçue — finalisation en cours. Rechargez la page Tarifs dans un instant.');
        }
        // Le webhook / sync mettra à jour la BDD — on poll jusqu'à régularisation
        startSubscriptionStatusPolling({ force: true });
        void refreshSubscriptionStatus({ syncRemote: true });
    }
}

if (typeof window !== 'undefined') {
    const maybeCompleteGc = () => {
        if (new URLSearchParams(window.location.search).has('billing_request_id')) {
            completeGoCardlessReturn();
        }
    };
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', maybeCompleteGc);
    } else {
        maybeCompleteGc();
    }
}

/**
 * Démarre le parcours de paiement abonnement (GoCardless SEPA).
 * @param {string} [planId]
 * @param {{ skipConfirm?: boolean }} [opts]
 */
window.subscribeToPlan = async function (planId, opts = {}) {
    const sub = window.cachedSubscription || {};
    const resolvedPlan = planId || sub.targetPlan || sub.plan;
    if (!resolvedPlan) {
        if (typeof showToast === 'function') showToast('Aucun forfait à régulariser', 'error');
        return;
    }
    if (!opts.skipConfirm) {
        if (!confirm(`Activer / régulariser le forfait ${resolvedPlan} via prélèvement SEPA (GoCardless) ?`)) return;
    }
    try {
        const res = await apiFetch('subscription/subscribe', {
            method: 'POST',
            body: { plan: resolvedPlan }
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(payload.error || payload.message || `Erreur ${res.status}`);
        }
        if (payload?.redirectUrl) {
            window.location.href = payload.redirectUrl;
            return;
        }
        if (payload?.data) window.cachedSubscription = payload.data;
        if (typeof showToast === 'function') {
            showToast(payload?.message || 'Abonnement activé.', 'success');
        } else {
            alert(payload?.message || 'Abonnement activé.');
        }
        if (typeof router === 'function') router('pricing');
        if (typeof applySubscriptionAccessGate === 'function') applySubscriptionAccessGate();
    } catch (e) {
        const ribUrl = sub.flenovaRib?.ribUrl;
        if (ribUrl) {
            window.open(ribUrl, '_blank', 'noopener');
            if (typeof showToast === 'function') {
                showToast('Ouverture du lien de paiement / RIB', 'info');
            }
            return;
        }
        if (typeof showToast === 'function') {
            showToast(e.message || 'Paiement indisponible — contactez support@flenova.fr', 'error');
        } else {
            alert(e.message || 'Impossible d\'activer l\'abonnement. Vérifiez la configuration GoCardless.');
        }
        if (typeof router === 'function') router('pricing');
    }
};

/** CTA bandeau grâce / retard / accès suspendu → parcours paiement SEPA. */
window.goToSubscriptionPayment = function () {
    if (typeof closeAppModal === 'function') closeAppModal('saas-overdue-modal');
    else document.getElementById('saas-overdue-modal')?.classList.add('hidden');
    const sub = window.cachedSubscription || {};
    const planId = sub.targetPlan || sub.plan;
    if (typeof subscribeToPlan === 'function' && planId) {
        void subscribeToPlan(planId, { skipConfirm: true });
        return;
    }
    if (sub.flenovaRib?.ribUrl) {
        window.open(sub.flenovaRib.ribUrl, '_blank', 'noopener');
        return;
    }
    if (typeof router === 'function') router('pricing');
    else window.location.hash = 'pricing';
};

window.adjustSubscriptionAddon = function (field, delta) {
    const sub = window.cachedSubscription || {};
    const current = field === 'extra_pc_users'
        ? (window._addonDraft.extra_pc_users ?? sub.addons?.extraPcUsers ?? 0)
        : (window._addonDraft.extra_mobile_drivers ?? sub.addons?.extraMobileDrivers ?? 0);
    const next = Math.max(0, current + delta);
    if (field === 'extra_pc_users') {
        window._addonDraft.extra_pc_users = next;
        document.getElementById('addon-pc-count').textContent = String(next);
    } else {
        window._addonDraft.extra_mobile_drivers = next;
        document.getElementById('addon-mobile-count').textContent = String(next);
    }
};

window.saveSubscriptionAddons = async function () {
    const sub = window.cachedSubscription || {};
    const btn = document.getElementById('addon-save-btn');
    const msg = document.getElementById('addon-save-msg');
    const payload = {
        extra_pc_users: window._addonDraft.extra_pc_users ?? sub.addons?.extraPcUsers ?? 0,
        extra_mobile_drivers: window._addonDraft.extra_mobile_drivers ?? sub.addons?.extraMobileDrivers ?? 0
    };
    if (btn) btn.disabled = true;
    try {
        const res = await apiFetch('subscription/addons', { method: 'PATCH', body: payload });
        if (res?.data) {
            window.cachedSubscription = res.data;
            window._addonDraft = {
                extra_pc_users: res.data.addons?.extraPcUsers ?? 0,
                extra_mobile_drivers: res.data.addons?.extraMobileDrivers ?? 0
            };
        }
        if (msg) {
            msg.textContent = 'Suppléments enregistrés.';
            msg.className = 'text-sm mt-2 text-green-600';
            msg.classList.remove('hidden');
        }
        router('pricing');
    } catch (e) {
        if (msg) {
            msg.textContent = e.message || 'Erreur lors de l\'enregistrement.';
            msg.className = 'text-sm mt-2 text-red-600';
            msg.classList.remove('hidden');
        }
    } finally {
        if (btn) btn.disabled = false;
    }
};

window.applyPlanBasedNav = function () {
    const sub = window.cachedSubscription;
    const transportRoutes = new Set(sub?.transportRoutes || [
        'transports', 'planning', 'inprogress_transports', 'completed_transports',
        'closed_transports', 'cancelled_transports', 'chartered_transports',
        'create_order', 'cmr_preview'
    ]);
    document.querySelectorAll('[data-nav-route]').forEach((el) => {
        const route = el.dataset.navRoute;
        if (el.style.display === 'none') return;
        if (!sub?.allowedRoutes) return;
        if (['pricing', 'contact', 'about', 'solutions', 'onboarding', 'feedback', 'tracking'].includes(route)) return;
        if (route === 'platform_ops' || route === 'platform_crm') return;
        if (transportRoutes.has(route)) return;
        if (!sub.allowedRoutes.includes(route)) {
            el.style.display = 'none';
        }
    });
};

window.planHasFeature = function (featureKey) {
    return !!window.cachedSubscription?.features?.[featureKey];
};

window.canAccessPlanRoute = function (routeName) {
    if (routeName === 'platform_ops' || routeName === 'platform_crm') return !!currentUser?.isPlatformAdmin;
    const sub = window.cachedSubscription;
    // Accès suspendu : seules pages de régularisation
    if (sub?.accessSuspended || (sub?.needsPayment && !sub?.gracePeriod && !sub?.isDemo)) {
        return ['pricing', 'contact', 'feedback', 'about'].includes(routeName);
    }
    const transportRoutes = sub?.transportRoutes || [
        'transports', 'planning', 'inprogress_transports', 'completed_transports',
        'closed_transports', 'cancelled_transports', 'chartered_transports',
        'create_order', 'cmr_preview', 'tracking'
    ];
    if (transportRoutes.includes(routeName)) return true;
    const salesInvoiceSubRoutes = ['sales_invoices_validated', 'sales_invoices_draft'];
    if (salesInvoiceSubRoutes.includes(routeName) && sub?.allowedRoutes?.includes('sales_invoices')) return true;
    if (!sub?.allowedRoutes) return true;
    if (['pricing', 'contact', 'about', 'solutions', 'onboarding', 'feedback', 'tracking'].includes(routeName)) return true;
    if (routeName === 'disputes') {
        if (!sub?.features) return true;
        return typeof planHasFeature !== 'function' || planHasFeature('dispute_management');
    }
    return sub.allowedRoutes.includes(routeName);
};

function showOverdueBillingModal(alert) {
    if (!alert) return;
    const sub = window.cachedSubscription || {};
    // Essai / démo : pas de modal « période de grâce »
    if (sub.isDemo || sub.isTrial || sub.trialActive || sub.status === 'trialing') return;
    // Grâce : modal non oubliable (pas de dismiss session) — CTA paiement obligatoire
    if (alert.type === 'grace_period' || sub.gracePeriod) {
        const modal = document.getElementById('saas-overdue-modal');
        if (!modal) return;
        document.getElementById('saas-overdue-title').textContent = alert.title || 'Période de grâce';
        document.getElementById('saas-overdue-message').textContent = alert.message || '';
        const payBtn = document.getElementById('saas-overdue-pay-btn');
        if (payBtn) payBtn.textContent = alert.cta || 'Régulariser mon paiement';
        const dismissBtn = document.getElementById('saas-overdue-dismiss-btn');
        if (dismissBtn) {
            dismissBtn.classList.remove('hidden');
            dismissBtn.textContent = 'Continuer (le bandeau reste affiché)';
        }
        if (typeof showAppModal === 'function') showAppModal('saas-overdue-modal');
        else {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }
        return;
    }
    if (alert.type === 'payment_required' || sub.accessSuspended) {
        // Géré par l'écran plein accès suspendu
        return;
    }
    if (sessionStorage.getItem('overdue_dismissed') === '1') return;
    const modal = document.getElementById('saas-overdue-modal');
    if (!modal) return;
    document.getElementById('saas-overdue-title').textContent = alert.title || 'Facture Flenova en retard';
    document.getElementById('saas-overdue-message').textContent = alert.message || '';
    const dismissBtn = document.getElementById('saas-overdue-dismiss-btn');
    if (dismissBtn) dismissBtn.classList.remove('hidden');
    if (typeof showAppModal === 'function') showAppModal('saas-overdue-modal');
    else {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

window.dismissSaasOverdueModal = async function () {
    const sub = window.cachedSubscription || {};
    if (typeof closeAppModal === 'function') closeAppModal('saas-overdue-modal');
    else document.getElementById('saas-overdue-modal')?.classList.add('hidden');
    // En grâce : on ne masque PAS le bandeau ; dismiss modal seulement
    if (sub.gracePeriod) return;
    sessionStorage.setItem('overdue_dismissed', '1');
    try {
        await apiFetch('subscription/overdue/dismiss', { method: 'POST', body: {} });
    } catch (e) { /* ignore */ }
};

window.applyGraceBanner = function () {
    const banner = document.getElementById('grace-banner');
    const textEl = document.getElementById('grace-banner-text');
    if (!banner || !textEl) return;
    const sub = window.cachedSubscription;
    // Essai Premium / démo / trial : jamais de bandeau grâce (évite le fantôme a11y)
    if (!sub?.gracePeriod || sub.isDemo || sub.isTrial || sub.trialActive || sub.status === 'trialing') {
        banner.classList.add('hidden');
        banner.setAttribute('aria-hidden', 'true');
        textEl.textContent = '';
        return;
    }
    const days = sub.graceDaysRemaining ?? '?';
    const endLabel = sub.graceEndsAt
        ? new Date(sub.graceEndsAt).toLocaleDateString('fr-FR')
        : '';
    textEl.innerHTML = `<i class="fa-solid fa-clock mr-2"></i><strong>Période de grâce — J-${days}</strong> : accès maintenu${endLabel ? ` jusqu'au ${endLabel}` : ''}. Régularisez votre <em>facture Flenova</em> (abonnement) pour éviter la suspension.`;
    banner.classList.remove('hidden');
    banner.setAttribute('aria-hidden', 'false');
};

window.applyAccessSuspendedScreen = function () {
    const screen = document.getElementById('access-suspended-screen');
    if (!screen) return false;
    const sub = window.cachedSubscription;
    const suspended = !!(sub && (sub.accessSuspended || (sub.needsPayment && !sub.gracePeriod && !sub.isDemo && !sub.isActive)));
    if (!suspended || currentUser?.isPlatformAdmin) {
        screen.classList.add('hidden');
        return false;
    }
    const alert = sub.billingAlert || {};
    const titleEl = document.getElementById('access-suspended-title');
    const msg = document.getElementById('access-suspended-message');
    const cta = document.getElementById('access-suspended-cta');
    if (titleEl) titleEl.textContent = alert.title || 'Compte en pause';
    if (msg) {
        msg.textContent = alert.message
            || 'Vos données sont conservées. Pour rouvrir Transports, Planning et Facturation, régularisez votre paiement (prélèvement SEPA).';
    }
    if (cta) cta.textContent = alert.cta || 'Mettre à jour mon paiement';
    screen.classList.remove('hidden');
    document.getElementById('onboarding-checklist-mount')?.classList.add('hidden');
    return true;
};

window.applySubscriptionAccessGate = function () {
    if (typeof applyDemoBanner === 'function') applyDemoBanner();
    applyGraceBanner();
    const suspended = applyAccessSuspendedScreen();
    updateNavQuotaWidget();
    if (typeof updateAppActionRail === 'function') {
        updateAppActionRail(window.currentAppRoute || 'dashboard');
    }
    if (subscriptionNeedsRegularization()) {
        startSubscriptionStatusPolling();
    } else {
        stopSubscriptionStatusPolling();
    }
    return suspended;
};

window.updateNavQuotaWidget = function () {
    document.getElementById('nav-quota-widget')?.remove();
};

window.renderAppPricingPage = renderAppPricingPage;
window.showOverdueBillingModal = showOverdueBillingModal;
window.renderPublicPricingAsync = renderPublicPricingAsync;
window.renderPublicPlansSection = renderPublicPlansSection;
window.hydratePublicPlansSection = hydratePublicPlansSection;
window.loadPublicPlans = loadPublicPlans;

window.hydrateSubscription = function (payload) {
    if (payload?.subscription) {
        window.cachedSubscription = payload.subscription;
        window._addonDraft = {
            extra_pc_users: payload.subscription.addons?.extraPcUsers ?? 0,
            extra_mobile_drivers: payload.subscription.addons?.extraMobileDrivers ?? 0
        };
        applySubscriptionAccessGate();
    }
};

if (typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (!subscriptionNeedsRegularization()) return;
        void refreshSubscriptionStatus({ syncRemote: true });
    });
    window.addEventListener('focus', () => {
        if (!subscriptionNeedsRegularization()) return;
        void refreshSubscriptionStatus();
    });
}

window.applyDemoBanner = function () {
    const sub = window.cachedSubscription;
    const banner = document.getElementById('demo-banner');
    const textEl = document.getElementById('demo-banner-text');
    if (!banner || !textEl) return;
    if (!sub?.isDemo) {
        banner.classList.add('hidden');
        return;
    }
    const days = sub.demoDaysRemaining ?? '—';
    const endLabel = sub.demoEndsAt
        ? new Date(sub.demoEndsAt).toLocaleDateString('fr-FR')
        : '';
    textEl.innerHTML = `<i class="fa-solid fa-gift mr-2"></i>Essai Premium — <strong>${days} jour(s)</strong> restant(s)${endLabel ? ` (jusqu'au ${endLabel})` : ''}. Toutes les fonctionnalités sont débloquées.${sub.targetPlanName ? ` Forfait prévu après l'essai : <strong>${sub.targetPlanName}</strong>.` : ''}`;
    banner.classList.remove('hidden');
};
