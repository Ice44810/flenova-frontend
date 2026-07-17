/**
 * Abonnements Flenova — tarifs unifiés et gating UI par forfait
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
        { id: 'independant', name: 'Indépendant', tagline: 'Pour les transporteurs solo', priceMonthly: 99, popular: false, featureLabels: ['1 utilisateur PC', '3 chauffeurs mobile', 'Tableau de bord & analyses', 'Export comptable', 'Planning', 'Calculateur tarif'] },
        { id: 'pme', name: 'PME', tagline: 'Pour les équipes en croissance', priceMonthly: 189, popular: true, featureLabels: ['5 utilisateurs PC', '10 chauffeurs mobile', 'Tableau de bord & analyses', 'Export comptable', 'Affrètement sous-traitant', 'Gestion palettes'] },
        { id: 'premium', name: 'Premium', tagline: 'Sans limite', priceMonthly: 349, popular: false, featureLabels: ['Utilisateurs illimités', 'Chauffeurs illimités', 'Tableau de bord & analyses', 'Export comptable', 'Toutes les fonctions PME', 'Support prioritaire'] },
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
        <p class="mt-12 text-center text-gray-600">Tous les tarifs sont hors taxes. <strong>1 mois d'essai Premium offert</strong> à l'inscription, puis règlement mensuel par virement bancaire.</p>`;
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

function renderAppPricingPage() {
    const sub = window.cachedSubscription || {};
    const usage = sub.usage || {};
    const limits = sub.limits || {};
    const usageLine = limits.maxUsers != null
        ? `<p class="text-sm text-gray-500 mt-2">Utilisateurs : ${usage.users || 0} / ${limits.maxUsers} · Chauffeurs mobile : ${usage.mobileDrivers || 0} / ${limits.maxMobileDrivers ?? '∞'}</p>`
        : `<p class="text-sm text-gray-500 mt-2">Forfait illimité — Utilisateurs : ${usage.users || 0} · Chauffeurs mobile : ${usage.mobileDrivers || 0}</p>`;

    const companyName = (typeof getCurrentUser === 'function' ? getCurrentUser()?.company_name : null) || '';
    const safeCompany = typeof escapeHtml === 'function' ? escapeHtml(companyName) : companyName;

    return `<div class="max-w-6xl mx-auto fade-in py-10">
        <div class="text-center mb-12">
            <h1 class="text-4xl font-extrabold text-gray-900 mb-4">Tarifs Flenova</h1>
            <p class="text-sm text-gray-500 mb-2">Entreprise : <strong>${safeCompany || '—'}</strong></p>
            <p class="text-lg text-gray-600">Forfait actuel : <strong>${sub.planName || '—'}</strong>${sub.isDemo ? ` — essai Premium (${sub.demoDaysRemaining ?? '—'} j. restants)` : ''}</p>
            ${sub.isDemo && sub.targetPlanName ? `<p class="text-sm text-purple-700 mt-2">Après l'essai : forfait ${sub.targetPlanName}</p>` : ''}
            ${usageLine}
            <p class="text-sm text-gray-500 mt-3">Facturation par virement bancaire. Pour modifier votre forfait, contactez notre équipe.</p>
        </div>
        ${renderPricingCards({ mode: 'app', selectedPlan: sub.plan })}
    </div>`;
}

window.applyPlanBasedNav = function () {
    const sub = window.cachedSubscription;
    const transportRoutes = new Set(sub?.transportRoutes || [
        'transports', 'planning', 'inprogress_transports', 'completed_transports',
        'create_order', 'cmr_preview', 'affretement_confirmation'
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
        'create_order', 'cmr_preview', 'affretement_confirmation'
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
