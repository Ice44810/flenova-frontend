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
            <p class="public-section-lead">Du transporteur solo à la PME multi-agences : choisissez le forfait adapté à votre volume. Essai Premium 30 jours sur demande · <strong>Sans engagement de durée</strong>.</p>
            ${renderPublicPlansComparison()}
            ${renderUpgradeVsAddonsBlock({ showAll: true, context: 'public' })}
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
            buttonHtml = `<button type="button" onclick="publicRouterContactTrial('${plan.id}')" class="block w-full py-2.5 text-center ${plan.popular ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border border-blue-600 text-blue-600 hover:bg-blue-50'} rounded-lg font-semibold transition">Demander un essai</button>`;
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
        <p class="mt-12 text-center text-gray-600">Tous les tarifs sont hors taxes. <strong>Essai Premium sur demande</strong> via le formulaire contact · <strong>Sans engagement de durée</strong>.<br>
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
            ${renderUpgradeVsAddonsBlock({ showAll: true, context: 'public' })}
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

/** Scénarios « rester + addons » vs « passer au forfait supérieur » */
function buildUpgradeVsAddonsScenarios() {
    const plans = window.cachedPlans || getFallbackPlans();
    const byId = Object.fromEntries(plans.map((p) => [p.id, p]));
    const addons = byId.independant?.addons || byId.pme?.addons || {
        extraPcUser: { priceMonthly: 29 },
        extraMobileDriver: { priceMonthly: 19 }
    };
    const pcPrice = addons.extraPcUser?.priceMonthly ?? 29;
    const mobilePrice = addons.extraMobileDriver?.priceMonthly ?? 19;

    const ladder = [
        { from: 'independant', to: 'pme' },
        { from: 'pme', to: 'premium' }
    ];

    return ladder
        .map((step) => {
            const from = byId[step.from];
            const to = byId[step.to];
            if (!from || !to) return null;
            const extraPc = Math.max(0, (to.limits?.maxUsers || 0) - (from.limits?.maxUsers || 0));
            const extraMobile = Math.max(0, (to.limits?.maxMobileDrivers || 0) - (from.limits?.maxMobileDrivers || 0));
            const addonsCost = extraPc * pcPrice + extraMobile * mobilePrice;
            const viaAddons = (from.priceMonthly || 0) + addonsCost;
            const viaUpgrade = to.priceMonthly || 0;
            const saving = viaAddons - viaUpgrade;
            return {
                fromId: from.id,
                toId: to.id,
                fromName: from.name,
                toName: to.name,
                extraPc,
                extraMobile,
                pcPrice,
                mobilePrice,
                viaAddons,
                viaUpgrade,
                saving,
                highlight: saving > 0
            };
        })
        .filter(Boolean);
}

function renderUpgradeVsAddonsBlock(options = {}) {
    const { currentPlanId = null, showAll = false, context = 'public' } = options;
    let scenarios = buildUpgradeVsAddonsScenarios();
    if (!showAll && currentPlanId) {
        scenarios = scenarios.filter((s) => s.fromId === currentPlanId);
    }
    if (!scenarios.length) return '';

    const cards = scenarios.map((s) => {
        const saveLabel = s.saving > 0
            ? `<p class="text-sm font-semibold text-emerald-700 mt-3">Économie en passant à ${s.toName} : ${s.saving} € HT/mois</p>`
            : `<p class="text-sm text-gray-500 mt-3">Comparaison capacité sièges uniquement.</p>`;
        const cta = context === 'app' && typeof window.subscribeToPlan === 'function'
            ? `<button type="button" onclick="subscribeToPlan('${s.toId}')" class="mt-4 w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition">Passer au forfait ${s.toName}</button>`
            : context === 'public'
                ? `<button type="button" onclick="publicRouterContactTrial('${s.toId}')" class="mt-4 w-full py-2.5 border border-blue-600 text-blue-700 rounded-lg text-sm font-semibold hover:bg-blue-50 transition">Demander un essai ${s.toName}</button>`
                : '';
        return `<div class="border border-gray-200 rounded-xl p-5 bg-white text-left shadow-sm">
            <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">${s.fromName} → capacité ${s.toName}</p>
            <h4 class="font-bold text-gray-900 mb-3">Même nombre de sièges PC & mobiles</h4>
            <ul class="text-sm text-gray-600 space-y-2 mb-3">
                <li>Via <strong>suppléments</strong> sur ${s.fromName} : +${s.extraPc} PC × ${s.pcPrice} € + +${s.extraMobile} mobiles × ${s.mobilePrice} € → <strong>${s.viaAddons} € HT/mois</strong></li>
                <li>Via forfait <strong>${s.toName}</strong> : <strong>${s.viaUpgrade} € HT/mois</strong>${s.toId === 'pme' ? ' + marges, RSE, 50 affrètements/mois' : s.toId === 'premium' ? ' + multi-agences & affrètement illimité' : ''}</li>
            </ul>
            ${saveLabel}
            ${cta}
        </div>`;
    }).join('');

    return `<div class="${context === 'app' ? 'mt-8 max-w-3xl mx-auto' : 'mt-10'}">
        <div class="text-center mb-5">
            <h3 class="text-xl font-bold text-gray-900">Suppléments vs forfait supérieur</h3>
            <p class="text-sm text-gray-500 mt-1">Comparer le coût pour atteindre la capacité du palier suivant — le forfait supérieur est souvent plus avantageux.</p>
        </div>
        <div class="grid grid-cols-1 ${scenarios.length > 1 ? 'md:grid-cols-2' : ''} gap-4">${cards}</div>
    </div>`;
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
    const planId = sub.targetPlan || sub.plan || null;

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
            ${sub.needsPayment && !sub.isDemo ? `<button type="button" onclick="subscribeToPlan('${sub.targetPlan || sub.plan}')" class="mt-4 px-6 py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition">Activer mon abonnement</button>` : ''}
        </div>
        ${renderAddonsPanel(sub)}
        ${renderBillingSummary(sub)}
        ${planId && planId !== 'premium'
            ? renderUpgradeVsAddonsBlock({ currentPlanId: planId, context: 'app' })
            : ''}
    </div>`;
}

window._addonDraft = { extra_pc_users: 0, extra_mobile_drivers: 0 };

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
        if (res?.data) window.cachedSubscription = res.data;
        const clean = new URL(window.location.href);
        clean.searchParams.delete('gocardless');
        clean.searchParams.delete('billing_request_id');
        clean.searchParams.delete('billing_request_flow_id');
        window.history.replaceState({}, '', clean.pathname + clean.search + (window.location.hash || ''));
        alert(res?.message || 'Abonnement activé via GoCardless.');
        if (typeof router === 'function') router('pricing');
    } catch (e) {
        console.warn('[GoCardless] complete:', e.message);
        alert(e.message || 'Autorisation reçue — finalisation en cours. Rechargez la page Tarifs dans un instant.');
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

window.subscribeToPlan = async function (planId) {
    if (!planId) return;
    if (!confirm(`Activer le forfait ${planId} via prélèvement SEPA (GoCardless) ?`)) return;
    try {
        const res = await apiFetch('subscription/subscribe', { method: 'POST', body: { plan: planId } });
        if (res?.redirectUrl) {
            window.location.href = res.redirectUrl;
            return;
        }
        if (res?.data) window.cachedSubscription = res.data;
        alert(res?.message || 'Abonnement activé.');
        router('pricing');
    } catch (e) {
        alert(e.message || 'Impossible d\'activer l\'abonnement. Vérifiez la configuration GoCardless.');
    }
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
        if (['pricing', 'contact', 'about', 'solutions', 'onboarding', 'feedback', 'disputes'].includes(route)) return;
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
    const transportRoutes = sub?.transportRoutes || [
        'transports', 'planning', 'inprogress_transports', 'completed_transports',
        'closed_transports', 'cancelled_transports', 'chartered_transports',
        'create_order', 'cmr_preview'
    ];
    if (transportRoutes.includes(routeName)) return true;
    const salesInvoiceSubRoutes = ['sales_invoices_validated', 'sales_invoices_draft'];
    if (salesInvoiceSubRoutes.includes(routeName) && sub?.allowedRoutes?.includes('sales_invoices')) return true;
    if (!sub?.allowedRoutes) return true;
    if (['pricing', 'contact', 'about', 'solutions', 'onboarding', 'feedback', 'disputes'].includes(routeName)) return true;
    return sub.allowedRoutes.includes(routeName);
};

function showOverdueBillingModal(alert) {
    if (!alert || sessionStorage.getItem('overdue_dismissed') === '1') return;
    const modal = document.getElementById('saas-overdue-modal');
    if (!modal) return;
    document.getElementById('saas-overdue-title').textContent = alert.title || 'Facture en retard';
    document.getElementById('saas-overdue-message').textContent = alert.message || '';
    modal.classList.remove('hidden');
}

window.dismissSaasOverdueModal = async function () {
    document.getElementById('saas-overdue-modal')?.classList.add('hidden');
    sessionStorage.setItem('overdue_dismissed', '1');
    try {
        await apiFetch('subscription/overdue/dismiss', { method: 'POST', body: {} });
    } catch (e) { /* ignore */ }
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
    }
};

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
