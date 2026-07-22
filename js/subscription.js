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
            tagline: 'Transporteur solo — exploitation complète sans affrètement',
            priceMonthly: 129,
            popular: false,
            limits: { maxUsers: 1, maxMobileDrivers: 3 },
            addonsAllowed: true,
            featureLabels: [
                '1 utilisateur PC inclus (+29 €/mois / user suppl.)',
                '3 chauffeurs mobile inclus (+19 €/mois / chauffeur suppl.)',
                'Commandes, planning & app mobile (GPS, eCMR, signatures)',
                'CMR / bordereaux & suivi client (code TRK)',
                'Facturation Factur-X & export comptable CSV',
                'Calculateur de cotation (poids taxé & trinôme)',
                'Carbone GLEC par transport'
            ]
        },
        {
            id: 'pme',
            name: 'PME',
            tagline: 'Équipe et sous-traitance — marges & conformité',
            priceMonthly: 269,
            popular: true,
            limits: { maxUsers: 5, maxMobileDrivers: 25 },
            addonsAllowed: true,
            featureLabels: [
                '5 utilisateurs PC inclus (+29 €/mois / user suppl.)',
                '25 chauffeurs mobile inclus (+19 €/mois / chauffeur suppl.)',
                'Tout Indépendant + affrètement & sous-traitants',
                'Confirmation affrètement PDF & dashboard marges',
                'Palettes Europe (solde & échanges)',
                'Optimisation green & rapports CSRD',
                'Conformité ST (RC Pro, URSSAF)'
            ]
        },
        {
            id: 'premium',
            name: 'Premium',
            tagline: 'Multi-agences & volume — capacité étendue',
            priceMonthly: 449,
            popular: false,
            limits: { maxUsers: 15, maxMobileDrivers: 50 },
            addonsAllowed: true,
            featureLabels: [
                '15 utilisateurs PC & 50 chauffeurs mobile inclus',
                'Suppléments au-delà : +29 €/PC · +19 €/mobile',
                'Toutes les fonctions PME',
                'Administration : users, agences, logo, IBAN',
                'Multi-agences & filtres par dépôt',
                'Support prioritaire & personnalisation'
            ]
        }
    ];
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
            buttonHtml = `<a href="register.html?plan=${plan.id}" class="block w-full py-2.5 text-center ${plan.popular ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border border-blue-600 text-blue-600 hover:bg-blue-50'} rounded-lg font-semibold transition">Choisir ce forfait</a>`;
        } else if (selectedPlan === plan.id) {
            buttonHtml = `<div class="w-full py-2.5 text-center bg-green-50 border border-green-200 text-green-800 rounded-lg font-semibold">Votre forfait actuel</div>`;
        } else {
            buttonHtml = `<p class="text-center text-sm text-gray-500 py-2">Changement de forfait sur demande — contactez notre équipe.</p>`;
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
        <p class="mt-12 text-center text-gray-600">Tous les tarifs sont hors taxes. <strong>1 mois d'essai Premium offert</strong> à l'inscription, puis règlement mensuel par virement bancaire.<br>
        <span class="text-sm text-gray-500">Suppléments Indépendant & PME : +29 €/utilisateur PC · +19 €/chauffeur mobile / mois.</span></p>`;
}

async function renderPublicPricingAsync() {
    await loadPublicPlans();
    return `<div class="fade-in">
        <div class="public-page-header py-12">
            <div class="max-w-6xl mx-auto px-4 sm:px-6 text-center">
                <h1 class="text-4xl font-extrabold text-blue-900 mb-4">Tarifs Flenova</h1>
                <p class="text-lg text-gray-600">Des solutions adaptées à vos besoins, sans frais cachés.</p>
            </div>
        </div>
        <div class="max-w-6xl mx-auto px-4 sm:px-6 py-12">${renderPricingCards({ mode: 'public' })}</div>
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
    const addonsLine = billing.addonsMonthly > 0
        ? `<p class="text-sm text-gray-600">Forfait ${billing.baseMonthly} € + suppléments ${billing.addonsMonthly} € = <strong>${billing.totalMonthly} € HT/mois</strong></p>`
        : `<p class="text-sm text-gray-600">Estimation : <strong>${billing.totalMonthly ?? sub.priceMonthly} € HT/mois</strong></p>`;
    return addonsLine;
}

function renderAppPricingPage() {
    const sub = window.cachedSubscription || {};
    const usage = sub.usage || {};
    const limits = sub.limits || {};
    const warnings = (sub.usageWarnings || []).map((w) =>
        `<p class="text-sm ${w.type?.includes('at_limit') ? 'text-red-600' : 'text-orange-600'} mt-1"><i class="fa-solid fa-triangle-exclamation mr-1"></i>${w.message}</p>`
    ).join('');

    const companyName = (typeof getCurrentUser === 'function' ? getCurrentUser()?.company_name : null) || '';
    const safeCompany = typeof escapeHtml === 'function' ? escapeHtml(companyName) : companyName;

    return `<div class="max-w-6xl mx-auto fade-in py-10">
        <div class="text-center mb-12">
            <h1 class="text-4xl font-extrabold text-gray-900 mb-4">Tarifs Flenova</h1>
            <p class="text-sm text-gray-500 mb-2">Entreprise : <strong>${safeCompany || '—'}</strong></p>
            <p class="text-lg text-gray-600">Forfait actuel : <strong>${sub.planName || '—'}</strong>${sub.isDemo ? ` — essai Premium (${sub.demoDaysRemaining ?? '—'} j. restants)` : ''}</p>
            ${sub.isDemo && sub.targetPlanName ? `<p class="text-sm text-purple-700 mt-2">Après l'essai : forfait ${sub.targetPlanName}</p>` : ''}
            ${renderBillingSummary(sub)}
            <div class="max-w-md mx-auto mt-4 text-left bg-gray-50 rounded-xl p-4">
                ${renderUsageBar('Utilisateurs PC', usage.users || 0, limits.maxUsers)}
                ${renderUsageBar('Chauffeurs mobile', usage.mobileDrivers || 0, limits.maxMobileDrivers)}
            </div>
            ${warnings}
            <p class="text-sm text-gray-500 mt-3">Facturation par virement bancaire. Pour modifier votre forfait, contactez notre équipe.</p>
        </div>
        ${renderAddonsPanel(sub)}
        <div class="mt-10">${renderPricingCards({ mode: 'app', selectedPlan: sub.plan })}</div>
    </div>`;
}

window._addonDraft = { extra_pc_users: 0, extra_mobile_drivers: 0 };

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
        'create_order', 'cmr_preview'
    ]);
    document.querySelectorAll('[data-nav-route]').forEach((el) => {
        const route = el.dataset.navRoute;
        if (el.style.display === 'none') return;
        if (!sub?.allowedRoutes) return;
        if (['pricing', 'contact', 'about', 'solutions'].includes(route)) return;
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
    const sub = window.cachedSubscription;
    const transportRoutes = sub?.transportRoutes || [
        'transports', 'planning', 'inprogress_transports', 'completed_transports',
        'create_order', 'cmr_preview'
    ];
    if (transportRoutes.includes(routeName)) return true;
    if (!sub?.allowedRoutes) return true;
    if (['pricing', 'contact', 'about', 'solutions'].includes(routeName)) return true;
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
