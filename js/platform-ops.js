/**
 * Console opérateur Flenova — monitoring, maintenance, messages publics
 */
window.cachedPlatformStatus = null;
window.cachedPlatformOps = null;

async function fetchPlatformStatus(force = false) {
    if (!force && window.cachedPlatformStatus) return window.cachedPlatformStatus;
    try {
        const res = await fetch('/api/platform/status');
        if (!res.ok) throw new Error('status');
        const json = await res.json();
        window.cachedPlatformStatus = json.data || null;
    } catch {
        window.cachedPlatformStatus = null;
    }
    return window.cachedPlatformStatus;
}

function formatOpsUptime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function opsEsc(value) {
    if (typeof escapeHtml === 'function') return escapeHtml(value);
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderPlatformMaintenancePage(status, { inApp = false } = {}) {
    const m = status?.maintenance || {};
    const contactAction = inApp
        ? `onclick="router('contact'); return false;"`
        : `onclick="publicRouter('contact'); return false;"`;
    return `<div class="platform-maintenance-page fade-in">
        <div class="platform-maintenance-card">
            <div class="platform-maintenance-icon"><i class="fa-solid fa-screwdriver-wrench"></i></div>
            <h1>${opsEsc(m.title || 'Maintenance en cours')}</h1>
            <p>${opsEsc(m.message || 'Flenova est temporairement indisponible.')}</p>
            <button type="button" class="public-btn-secondary mt-6" ${contactAction}>Nous contacter</button>
        </div>
    </div>`;
}

function renderPublicAnnouncementFromStatus(status) {
    const banner = status?.banner;
    if (!banner?.enabled) return '';
    const label = opsEsc(banner.linkLabel || 'En savoir plus');
    const route = opsEsc(banner.linkRoute || 'fonctionnalites');
    const title = banner.title ? `<strong>${opsEsc(banner.title)}</strong>` : '';
    const sep = banner.title && banner.message ? ' — ' : '';
    return `<div class="public-announcement" role="note">
        <div class="public-announcement-inner">
            <i class="fa-solid fa-bullhorn" aria-hidden="true"></i>
            <span>${title}${sep}${opsEsc(banner.message || '')}</span>
            <button type="button" class="public-announcement-link" onclick="publicRouter('${route}')">${label}</button>
        </div>
    </div>`;
}

async function hydratePublicPlatformUi() {
    const status = await fetchPlatformStatus();
    if (!status) return status;

    if (status.maintenance?.enabled && !currentUser?.isPlatformAdmin) {
        const container = document.getElementById('public-content');
        if (container) container.innerHTML = renderPlatformMaintenancePage(status);
        return status;
    }

    const mount = document.getElementById('public-announcement-mount');
    if (mount) {
        mount.innerHTML = renderPublicAnnouncementFromStatus(status);
    }
    return status;
}

function showAppMaintenanceIfNeeded(status) {
    if (!status?.maintenance?.enabled || currentUser?.isPlatformAdmin) return false;
    const appContent = document.getElementById('app-content');
    const pageTitle = document.getElementById('page-title');
    if (appContent) appContent.innerHTML = renderPlatformMaintenancePage(status, { inApp: true });
    if (pageTitle) pageTitle.textContent = 'Maintenance';
    return true;
}

function applyPlatformAdminNav(user) {
    applyPlatformOperatorShell(user);
}

function isPlatformOperatorSession(user = currentUser) {
    return !!user?.isPlatformAdmin;
}

function applyPlatformOperatorShell(user) {
    const operator = isPlatformOperatorSession(user);
    document.body.classList.toggle('platform-operator-mode', operator);

    const tenantNav = document.getElementById('tenant-app-nav');
    const operatorNav = document.getElementById('platform-operator-nav');
    if (tenantNav) tenantNav.classList.toggle('hidden', operator);
    if (operatorNav) operatorNav.classList.toggle('hidden', !operator);

    const brand = document.querySelector('#app-screen aside .text-xl.font-bold');
    if (brand) brand.textContent = operator ? 'Flenova Ops' : 'Flenova';

    const companyHeader = document.getElementById('header-company-name');
    if (companyHeader) {
        if (operator) {
            companyHeader.textContent = 'Console opérateur — monitoring & maintenance';
            companyHeader.classList.remove('hidden');
        }
    }

    document.getElementById('demo-banner')?.classList.add('hidden');
}

async function loadPlatformOpsDashboard(force = false) {
    if (!force && window.cachedPlatformOps) return window.cachedPlatformOps;
    const res = await apiFetch('platform/ops');
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Impossible de charger la console opérateur');
    window.cachedPlatformOps = json.data;
    return window.cachedPlatformOps;
}

function renderPlatformOpsMetrics(metrics) {
    const m = metrics || {};
    const cards = [
        { icon: 'fa-database', label: 'Base MySQL', value: m.dbOk ? 'OK' : 'Erreur', tone: m.dbOk ? 'ok' : 'bad' },
        { icon: 'fa-building', label: 'Entreprises', value: m.companies ?? '—', tone: 'neutral' },
        { icon: 'fa-users', label: 'Utilisateurs', value: m.users ?? '—', tone: 'neutral' },
        { icon: 'fa-credit-card', label: 'Abonnements actifs', value: m.activeSubscriptions ?? '—', tone: 'neutral' },
        { icon: 'fa-envelope', label: 'Messages contact (nouveaux)', value: m.newContactMessages ?? '—', tone: m.newContactMessages > 0 ? 'warn' : 'neutral' },
        { icon: 'fa-clock', label: 'Uptime API', value: formatOpsUptime(m.uptimeSec || 0), tone: 'neutral' },
    ];
    return `<div class="platform-ops-metrics">${cards.map((c) => `
        <article class="platform-ops-metric platform-ops-metric--${c.tone}">
            <i class="fa-solid ${c.icon}"></i>
            <div>
                <p class="platform-ops-metric-label">${opsEsc(c.label)}</p>
                <p class="platform-ops-metric-value">${opsEsc(String(c.value))}</p>
            </div>
        </article>
    `).join('')}</div>`;
}

function renderPlatformOpsContacts(rows) {
    if (!rows?.length) {
        return '<p class="text-sm text-gray-500">Aucun message contact récent.</p>';
    }
    return `<div class="overflow-x-auto"><table class="w-full text-sm">
        <thead><tr class="text-left text-gray-500 border-b">
            <th class="py-2 pr-3">Date</th><th class="py-2 pr-3">Nom</th><th class="py-2 pr-3">E-mail</th><th class="py-2 pr-3">Tél.</th><th class="py-2">Sujet</th>
        </tr></thead>
        <tbody>${rows.map((r) => `<tr class="border-b border-gray-100">
            <td class="py-2 pr-3 whitespace-nowrap">${opsEsc(new Date(r.created_at).toLocaleString('fr-FR'))}</td>
            <td class="py-2 pr-3">${opsEsc(r.contact_name || '—')}</td>
            <td class="py-2 pr-3">${opsEsc(r.email || '—')}</td>
            <td class="py-2 pr-3">${opsEsc(r.phone || '—')}</td>
            <td class="py-2">${opsEsc(r.subject || '—')}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
}

function renderPlatformOpsPageShell(data) {
    const s = data?.settings || {};
    const maint = s.maintenance || {};
    const banner = s.banner || {};
    return `<div class="max-w-6xl mx-auto fade-in platform-ops-page">
        <div class="mb-8">
            <h2 class="text-2xl font-bold text-gray-800">Console opérateur</h2>
            <p class="text-sm text-gray-500 mt-1">Monitoring de l'application, mode maintenance et messages pour les visiteurs et nouveaux clients.</p>
        </div>

        ${renderPlatformOpsMetrics(data?.metrics)}

        <form id="platform-ops-form" class="mt-8 space-y-6" onsubmit="savePlatformOpsSettings(event)">
            <section class="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <div class="flex items-start justify-between gap-4 mb-4">
                    <div>
                        <h3 class="font-bold text-gray-800"><i class="fa-solid fa-screwdriver-wrench text-amber-600 mr-2"></i>Mode maintenance</h3>
                        <p class="text-sm text-gray-500 mt-1">Bloque l'accès à l'application et affiche un écran dédié sur le site public (sauf pour les opérateurs).</p>
                    </div>
                    <label class="inline-flex items-center gap-2 text-sm font-medium cursor-pointer">
                        <input type="checkbox" id="ops-maintenance-enabled" ${maint.enabled ? 'checked' : ''} class="rounded border-gray-300 text-blue-600">
                        Activer
                    </label>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1" for="ops-maintenance-title">Titre</label>
                        <input type="text" id="ops-maintenance-title" class="w-full border rounded-lg px-3 py-2" value="${opsEsc(maint.title || '')}">
                    </div>
                    <div class="md:col-span-2">
                        <label class="block text-sm font-medium text-gray-700 mb-1" for="ops-maintenance-message">Message</label>
                        <textarea id="ops-maintenance-message" rows="3" class="w-full border rounded-lg px-3 py-2">${opsEsc(maint.message || '')}</textarea>
                    </div>
                </div>
            </section>

            <section class="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <div class="flex items-start justify-between gap-4 mb-4">
                    <div>
                        <h3 class="font-bold text-gray-800"><i class="fa-solid fa-bullhorn text-blue-600 mr-2"></i>Bandeau site public</h3>
                        <p class="text-sm text-gray-500 mt-1">Annonce en haut de la page d'accueil pour les visiteurs et prospects.</p>
                    </div>
                    <label class="inline-flex items-center gap-2 text-sm font-medium cursor-pointer">
                        <input type="checkbox" id="ops-banner-enabled" ${banner.enabled ? 'checked' : ''} class="rounded border-gray-300 text-blue-600">
                        Afficher
                    </label>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1" for="ops-banner-title">Titre (gras)</label>
                        <input type="text" id="ops-banner-title" class="w-full border rounded-lg px-3 py-2" value="${opsEsc(banner.title || '')}">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1" for="ops-banner-link-label">Libellé du lien</label>
                        <input type="text" id="ops-banner-link-label" class="w-full border rounded-lg px-3 py-2" value="${opsEsc(banner.linkLabel || '')}">
                    </div>
                    <div class="md:col-span-2">
                        <label class="block text-sm font-medium text-gray-700 mb-1" for="ops-banner-message">Message</label>
                        <input type="text" id="ops-banner-message" class="w-full border rounded-lg px-3 py-2" value="${opsEsc(banner.message || '')}">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1" for="ops-banner-link-route">Page cible du lien</label>
                        <select id="ops-banner-link-route" class="w-full border rounded-lg px-3 py-2">
                            ${['home', 'fonctionnalites', 'tarifs', 'contact'].map((r) =>
                                `<option value="${r}" ${banner.linkRoute === r ? 'selected' : ''}>${r}</option>`
                            ).join('')}
                        </select>
                    </div>
                </div>
            </section>

            <section class="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <h3 class="font-bold text-gray-800 mb-2"><i class="fa-solid fa-handshake text-teal-600 mr-2"></i>Message nouveaux clients</h3>
                <p class="text-sm text-gray-500 mb-3">Affiché en tête du guide « Prise en main » pour accueillir les nouvelles entreprises.</p>
                <textarea id="ops-welcome-message" rows="4" class="w-full border rounded-lg px-3 py-2">${opsEsc(s.welcomeMessage || '')}</textarea>
            </section>

            <div class="flex flex-wrap gap-3">
                <button type="submit" class="px-5 py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700">Enregistrer</button>
                <button type="button" onclick="refreshPlatformOpsPage()" class="px-5 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Actualiser</button>
            </div>
        </form>

        <section class="mt-10 bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <h3 class="font-bold text-gray-800 mb-4"><i class="fa-solid fa-inbox text-indigo-600 mr-2"></i>Derniers messages contact</h3>
            ${renderPlatformOpsContacts(data?.recentContacts)}
        </section>
    </div>`;
}

async function renderPlatformOpsPage() {
    return `<div class="py-8 text-center text-gray-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i><p class="mt-3">Chargement de la console…</p></div>`;
}

async function hydratePlatformOpsPage() {
    const el = document.getElementById('app-content');
    if (!el) return;
    try {
        const data = await loadPlatformOpsDashboard(true);
        el.innerHTML = renderPlatformOpsPageShell(data);
    } catch (e) {
        el.innerHTML = `<div class="p-8 text-center text-red-600">${opsEsc(e.message)}</div>`;
    }
}

async function refreshPlatformOpsPage() {
    window.cachedPlatformOps = null;
    window.cachedPlatformStatus = null;
    await hydratePlatformOpsPage();
}

async function savePlatformOpsSettings(e) {
    e.preventDefault();
    const payload = {
        maintenance_enabled: document.getElementById('ops-maintenance-enabled')?.checked,
        maintenance_title: document.getElementById('ops-maintenance-title')?.value,
        maintenance_message: document.getElementById('ops-maintenance-message')?.value,
        public_banner_enabled: document.getElementById('ops-banner-enabled')?.checked,
        public_banner_title: document.getElementById('ops-banner-title')?.value,
        public_banner_message: document.getElementById('ops-banner-message')?.value,
        public_banner_link_label: document.getElementById('ops-banner-link-label')?.value,
        public_banner_link_route: document.getElementById('ops-banner-link-route')?.value,
        welcome_clients_message: document.getElementById('ops-welcome-message')?.value,
    };
    try {
        const res = await apiFetch('platform/ops', { method: 'PATCH', body: payload });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Enregistrement impossible');
        window.cachedPlatformStatus = json.data ? { ...json.data, maintenance: json.data.maintenance, banner: json.data.banner, welcomeMessage: json.data.welcomeMessage } : null;
        window.cachedPlatformOps = null;
        showToast(json.message || 'Paramètres enregistrés', 'success');
        await hydratePlatformOpsPage();
    } catch (err) {
        showToast(err.message || 'Erreur', 'error');
    }
}

window.fetchPlatformStatus = fetchPlatformStatus;
window.hydratePublicPlatformUi = hydratePublicPlatformUi;
window.showAppMaintenanceIfNeeded = showAppMaintenanceIfNeeded;
window.applyPlatformAdminNav = applyPlatformAdminNav;
window.applyPlatformOperatorShell = applyPlatformOperatorShell;
window.isPlatformOperatorSession = isPlatformOperatorSession;
window.renderPlatformOpsPage = renderPlatformOpsPage;
window.hydratePlatformOpsPage = hydratePlatformOpsPage;
window.refreshPlatformOpsPage = refreshPlatformOpsPage;
window.savePlatformOpsSettings = savePlatformOpsSettings;
