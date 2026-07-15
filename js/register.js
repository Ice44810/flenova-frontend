/**
 * Register Logic — création entreprise + choix forfait
 */

const VALID_PLANS = ['independant', 'pme', 'premium'];
const PLAN_LABELS = {
    independant: 'Indépendant — 99 €/mois HT (après essai)',
    pme: 'PME — 189 €/mois HT (après essai)',
    premium: 'Premium — 349 €/mois HT (après essai)'
};

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast border-${type === 'success' ? 'green' : type === 'error' ? 'red' : 'blue'}-500`;
    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
    toast.innerHTML = `
        <i class="fa-solid ${icons[type] || icons.info} text-${type === 'success' ? 'green' : type === 'error' ? 'red' : 'blue'}-500 text-xl mr-3"></i>
        <span class="text-sm text-gray-700">${message}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

function getSelectedPlan() {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = (params.get('plan') || '').trim().toLowerCase();
    const select = document.getElementById('reg-plan');
    const fromSelect = select?.value || 'independant';
    if (VALID_PLANS.includes(fromUrl)) return fromUrl;
    return VALID_PLANS.includes(fromSelect) ? fromSelect : 'independant';
}

function initPlanSelector() {
    const plan = getSelectedPlan();
    const select = document.getElementById('reg-plan');
    if (select) select.value = plan;
    const label = document.getElementById('reg-plan-label');
    if (label) label.textContent = PLAN_LABELS[plan] || PLAN_LABELS.independant;
    select?.addEventListener('change', () => {
        const next = select.value;
        if (label) label.textContent = PLAN_LABELS[next] || '';
        const url = new URL(window.location.href);
        url.searchParams.set('plan', next);
        window.history.replaceState({}, '', url);
    });
}

initPlanSelector();

document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Création...';

    const companyName = document.getElementById('reg-company').value.trim();
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const passwordConfirm = document.getElementById('reg-password-confirm').value;
    const plan = getSelectedPlan();

    if (password !== passwordConfirm) {
        showToast('Les mots de passe ne correspondent pas', 'error');
        btn.disabled = false;
        btn.innerHTML = originalText;
        return;
    }

    if (password.length < 8) {
        showToast('Le mot de passe doit contenir au moins 8 caractères', 'error');
        btn.disabled = false;
        btn.innerHTML = originalText;
        return;
    }

    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include'
        });
    } catch (e) {
        // ignore
    }
    localStorage.removeItem('user');

    try {
        const response = await apiFetch('auth/register', {
            method: 'POST',
            body: { company_name: companyName, name, email, password, plan }
        });

        let result = {};
        try { result = await response.json(); } catch (e) { result = { error: 'Erreur serveur inattendue' }; }

        if (response.ok && result.success) {
            setCurrentUser(result.user);
            const days = result.demo?.trialDays || 30;
            showToast(`Compte créé ! Essai Premium ${days} jours activé. Redirection...`, 'success');
            setTimeout(() => {
                window.location.href = '/index.html';
            }, 800);
        } else {
            showToast(result.error || result.message || 'Erreur lors de l\'inscription', 'error');
        }
    } catch (err) {
        showToast('Impossible de contacter le serveur', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
});
