/**
 * CRM opérateur Flenova — gestion de la clientèle SaaS
 */
window.cachedPlatformCrm = null;
window.platformCrmSelectedId = null;

const CRM_STATUS_LABELS = {
    nouveau: 'Nouveau',
    actif: 'Actif',
    a_risque: 'À risque',
    inactif: 'Inactif',
    vip: 'VIP',
};

const CRM_STATUS_TONES = {
    nouveau: 'info',
    actif: 'ok',
    a_risque: 'warn',
    inactif: 'bad',
    vip: 'vip',
};

const SUB_STATUS_TONES = {
    active: 'ok',
    trialing: 'info',
    past_due: 'bad',
    canceled: 'bad',
    incomplete: 'warn',
};

const CONTACT_STATUS_LABELS = {
    new: 'Nouveau',
    read: 'Lu',
    replied: 'Répondu',
    archived: 'Archivé',
};

/** Valeur pour <input type="datetime-local"> en heure locale (toISOString donnerait l'heure UTC). */
function toLocalDateTimeInputValue(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function crmEsc(value) {
    if (typeof escapeHtml === 'function') return escapeHtml(value);
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatCrmDate(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatCrmDateShort(value) {
    if (!value) return '—';
    return new Date(value).toLocaleDateString('fr-FR');
}

function crmPill(label, tone = 'neutral') {
    return `<span class="platform-crm-pill platform-crm-pill--${tone}">${crmEsc(label)}</span>`;
}

async function loadPlatformCrmData(params = {}) {
    const qs = new URLSearchParams();
    if (params.search) qs.set('search', params.search);
    if (params.crmStatus) qs.set('crmStatus', params.crmStatus);
    if (params.subStatus) qs.set('subStatus', params.subStatus);
    if (params.plan) qs.set('plan', params.plan);
    const query = qs.toString();
    const res = await apiFetch(`platform/crm${query ? `?${query}` : ''}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Impossible de charger le CRM');
    window.cachedPlatformCrm = json.data;
    return window.cachedPlatformCrm;
}

async function loadPlatformCrmDetail(companyId) {
    const res = await apiFetch(`platform/crm/${companyId}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Fiche client introuvable');
    return json.data;
}

function renderCrmSummaryCards(summary) {
    const s = summary || {};
    const cards = [
        { icon: 'fa-building', label: 'Clients total', value: s.total ?? 0, tone: 'neutral' },
        { icon: 'fa-circle-check', label: 'Abonnements actifs', value: s.active_subs ?? 0, tone: 'ok' },
        { icon: 'fa-triangle-exclamation', label: 'Impayés', value: s.past_due ?? 0, tone: s.past_due > 0 ? 'warn' : 'neutral' },
        { icon: 'fa-star', label: 'Comptes VIP', value: s.vip ?? 0, tone: 'vip' },
        { icon: 'fa-envelope', label: 'Messages non lus', value: s.new_contacts ?? 0, tone: s.new_contacts > 0 ? 'warn' : 'neutral' },
    ];
    return `<div class="platform-ops-metrics">${cards.map((c) => `
        <article class="platform-ops-metric platform-ops-metric--${c.tone === 'vip' ? 'ok' : c.tone}">
            <i class="fa-solid ${c.icon}"></i>
            <div>
                <p class="platform-ops-metric-label">${crmEsc(c.label)}</p>
                <p class="platform-ops-metric-value">${crmEsc(String(c.value))}</p>
            </div>
        </article>
    `).join('')}</div>`;
}

function renderCrmFilters(filters = {}) {
    const f = window.platformCrmFilters || {};
    return `<div class="platform-crm-toolbar">
        <div class="platform-crm-search">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="search" id="crm-search" placeholder="Rechercher entreprise, e-mail, SIRET…" value="${crmEsc(f.search || '')}">
        </div>
        <select id="crm-filter-status" class="platform-crm-select">
            <option value="">Statut CRM</option>
            ${Object.entries(CRM_STATUS_LABELS).map(([k, v]) =>
                `<option value="${k}" ${f.crmStatus === k ? 'selected' : ''}>${crmEsc(v)}</option>`
            ).join('')}
        </select>
        <select id="crm-filter-sub" class="platform-crm-select">
            <option value="">Abonnement</option>
            <option value="active" ${f.subStatus === 'active' ? 'selected' : ''}>Actif</option>
            <option value="trialing" ${f.subStatus === 'trialing' ? 'selected' : ''}>Essai</option>
            <option value="past_due" ${f.subStatus === 'past_due' ? 'selected' : ''}>Impayé</option>
            <option value="canceled" ${f.subStatus === 'canceled' ? 'selected' : ''}>Résilié</option>
        </select>
        <select id="crm-filter-plan" class="platform-crm-select">
            <option value="">Forfait</option>
            <option value="independant" ${f.plan === 'independant' ? 'selected' : ''}>Indépendant</option>
            <option value="pme" ${f.plan === 'pme' ? 'selected' : ''}>PME</option>
            <option value="premium" ${f.plan === 'premium' ? 'selected' : ''}>Premium</option>
        </select>
        <button type="button" onclick="applyCrmFilters()" class="platform-crm-btn platform-crm-btn--primary">Filtrer</button>
        <button type="button" onclick="resetCrmFilters()" class="platform-crm-btn">Réinitialiser</button>
    </div>`;
}

function renderCrmClientsTable(clients) {
    if (!clients?.length) {
        return '<p class="text-sm text-gray-500 py-6 text-center">Aucun client ne correspond aux critères.</p>';
    }
    return `<div class="overflow-x-auto"><table class="w-full text-sm platform-crm-table">
        <thead><tr class="text-left text-gray-500 border-b">
            <th class="py-2 pr-3">Entreprise</th>
            <th class="py-2 pr-3">Contact</th>
            <th class="py-2 pr-3">Forfait</th>
            <th class="py-2 pr-3">Abonnement</th>
            <th class="py-2 pr-3">Statut CRM</th>
            <th class="py-2 pr-3">Utilisateurs</th>
            <th class="py-2 pr-3">Dernière activité</th>
            <th class="py-2">Inscription</th>
        </tr></thead>
        <tbody>${clients.map((c) => {
            const crmTone = CRM_STATUS_TONES[c.crmStatus] || 'neutral';
            const subTone = SUB_STATUS_TONES[c.subStatus] || 'neutral';
            const lastActivity = c.lastOrderAt || c.lastContactAt || c.createdAt;
            const unread = c.newMessages > 0
                ? `<span class="platform-crm-unread" title="${c.newMessages} message(s) non lu(s)">${c.newMessages}</span>`
                : '';
            return `<tr class="border-b border-gray-100 platform-crm-row ${window.platformCrmSelectedId === c.id ? 'is-selected' : ''}"
                onclick="openCrmClientDetail(${c.id})" role="button" tabindex="0">
                <td class="py-2.5 pr-3">
                    <div class="font-medium text-gray-800">${crmEsc(c.name)} ${unread}</div>
                    ${c.siret ? `<div class="text-xs text-gray-500">${crmEsc(c.siret)}</div>` : ''}
                </td>
                <td class="py-2.5 pr-3">
                    <div>${crmEsc(c.contactName || '—')}</div>
                    <div class="text-xs text-gray-500">${crmEsc(c.contactEmail || '—')}</div>
                </td>
                <td class="py-2.5 pr-3">${crmEsc(c.planName)}</td>
                <td class="py-2.5 pr-3">${crmPill(c.subStatusLabel || c.subStatus || '—', subTone)}</td>
                <td class="py-2.5 pr-3">${c.crmStatus ? crmPill(CRM_STATUS_LABELS[c.crmStatus] || c.crmStatus, crmTone) : '<span class="text-gray-400">—</span>'}</td>
                <td class="py-2.5 pr-3">${c.userCount ?? 0}</td>
                <td class="py-2.5 pr-3 whitespace-nowrap">${formatCrmDateShort(lastActivity)}</td>
                <td class="py-2.5 whitespace-nowrap">${formatCrmDateShort(c.createdAt)}</td>
            </tr>`;
        }).join('')}</tbody>
    </table></div>`;
}

function renderCrmDetailPanel(detail) {
    if (!detail) {
        return `<aside class="platform-crm-detail platform-crm-detail--empty">
            <div class="platform-crm-detail-placeholder">
                <i class="fa-solid fa-hand-pointer"></i>
                <p>Sélectionnez un client pour voir sa fiche</p>
            </div>
        </aside>`;
    }

    const sub = detail.subscription || {};
    const usage = detail.usage || {};
    const stats = detail.stats || {};
    const subTone = SUB_STATUS_TONES[sub.status] || 'neutral';

    return `<aside class="platform-crm-detail">
        <div class="platform-crm-detail-header">
            <div>
                <h3>${crmEsc(detail.name)}</h3>
                <p class="text-sm text-gray-500">Client depuis ${formatCrmDateShort(detail.createdAt)}</p>
            </div>
            <button type="button" class="platform-crm-detail-close" onclick="closeCrmClientDetail()" aria-label="Fermer">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>

        <div class="platform-crm-detail-body">
            <section class="platform-crm-detail-section">
                <h4>Informations</h4>
                <dl class="platform-crm-dl">
                    <dt>Adresse</dt><dd>${crmEsc(detail.address || '—')}</dd>
                    <dt>SIRET</dt><dd>${crmEsc(detail.siret || '—')}</dd>
                    <dt>TVA intra</dt><dd>${crmEsc(detail.tvaIntra || '—')}</dd>
                </dl>
            </section>

            <section class="platform-crm-detail-section">
                <h4>Abonnement</h4>
                <div class="flex flex-wrap gap-2 mb-3">
                    ${crmPill(sub.planName || '—', 'info')}
                    ${crmPill(sub.statusLabel || sub.status || '—', subTone)}
                    ${sub.isDemo && sub.demoDaysRemaining != null ? crmPill(`${sub.demoDaysRemaining} j. d'essai restants`, 'warn') : ''}
                </div>
                <dl class="platform-crm-dl">
                    <dt>Fin de période</dt><dd>${formatCrmDate(sub.currentPeriodEnd)}</dd>
                    <dt>Utilisation</dt><dd>${usage.users ?? 0} PC / ${usage.mobileDrivers ?? 0} mobile</dd>
                    <dt>Numelys</dt><dd>${sub.numelysClientId ? `#${sub.numelysClientId}` : 'Non synchronisé'}</dd>
                </dl>
                <div class="flex flex-wrap gap-2 mt-3">
                    <button type="button" onclick="syncNumelysClient(${detail.id})" class="platform-crm-btn text-xs">Sync Numelys</button>
                    <button type="button" onclick="generateNumelysInvoice(${detail.id})" class="platform-crm-btn text-xs platform-crm-btn--primary">Facturer</button>
                </div>
            </section>

            <section class="platform-crm-detail-section">
                <h4>Activité plateforme</h4>
                <div class="platform-crm-stats-grid">
                    <div><span>${stats.orders ?? 0}</span><small>Transports</small></div>
                    <div><span>${stats.drivers ?? 0}</span><small>Chauffeurs</small></div>
                    <div><span>${stats.transport_clients ?? 0}</span><small>Clients transport</small></div>
                    <div><span>${stats.invoices ?? 0}</span><small>Factures</small></div>
                </div>
            </section>

            <section class="platform-crm-detail-section">
                <h4>Utilisateurs</h4>
                ${detail.users?.length ? `<ul class="platform-crm-users">${detail.users.map((u) => `
                    <li>
                        <strong>${crmEsc(u.name)}</strong>
                        <span class="text-gray-500">${crmEsc(u.email)}</span>
                        ${crmPill(u.role === 'admin' ? 'Admin' : u.role, u.role === 'admin' ? 'vip' : 'neutral')}
                    </li>
                `).join('')}</ul>` : '<p class="text-sm text-gray-500">Aucun utilisateur.</p>'}
            </section>

            <section class="platform-crm-detail-section">
                <h4>Suivi CRM</h4>
                <form id="crm-detail-form" class="space-y-3" onsubmit="saveCrmClientDetail(event, ${detail.id})">
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1" for="crm-detail-status">Statut</label>
                        <select id="crm-detail-status" class="w-full border rounded-lg px-3 py-2 text-sm">
                            <option value="">— Non défini —</option>
                            ${Object.entries(CRM_STATUS_LABELS).map(([k, v]) =>
                                `<option value="${k}" ${detail.crmStatus === k ? 'selected' : ''}>${crmEsc(v)}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1" for="crm-detail-last-contact">Dernier contact</label>
                        <input type="datetime-local" id="crm-detail-last-contact" class="w-full border rounded-lg px-3 py-2 text-sm"
                            value="${detail.lastContactAt ? toLocalDateTimeInputValue(detail.lastContactAt) : ''}">
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1" for="crm-detail-notes">Notes internes</label>
                        <textarea id="crm-detail-notes" rows="4" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Historique commercial, points d'attention…">${crmEsc(detail.crmNotes || '')}</textarea>
                    </div>
                    <button type="submit" class="platform-crm-btn platform-crm-btn--primary w-full">Enregistrer la fiche</button>
                </form>
            </section>

            <section class="platform-crm-detail-section">
                <h4>Messages contact</h4>
                ${detail.contacts?.length ? `<div class="platform-crm-messages">${detail.contacts.map((m) => `
                    <article class="platform-crm-message">
                        <header>
                            <strong>${crmEsc(m.subject || 'Sans sujet')}</strong>
                            <span>${formatCrmDate(m.created_at)}</span>
                        </header>
                        <p>${crmEsc(m.message || '')}</p>
                        <footer>
                            <select onchange="updateCrmContactStatus(${m.id}, this.value)" class="platform-crm-select text-xs">
                                ${Object.entries(CONTACT_STATUS_LABELS).map(([k, v]) =>
                                    `<option value="${k}" ${(m.status || 'new') === k ? 'selected' : ''}>${crmEsc(v)}</option>`
                                ).join('')}
                            </select>
                        </footer>
                    </article>
                `).join('')}</div>` : '<p class="text-sm text-gray-500">Aucun message.</p>'}
            </section>
        </div>
    </aside>`;
}

function renderCrmNumelysSection(numelys) {
    const n = numelys || {};
    const tone = n.configured && n.apiOk ? 'ok' : (n.configured ? 'warn' : 'bad');
    return `<section class="mt-6 bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <div class="flex flex-wrap items-start justify-between gap-4 mb-4">
            <div>
                <h3 class="font-bold text-gray-800"><i class="fa-solid fa-file-invoice-dollar text-violet-600 mr-2"></i>Facturation Numelys</h3>
                <p class="text-sm text-gray-500 mt-1">Synchronisation des clients Flenova et facturation des suppléments (PC, chauffeurs mobile, affrètement).</p>
            </div>
            <span class="platform-ops-pill platform-ops-pill--${tone}">${crmEsc(n.apiMessage || (n.configured ? 'Configuré' : 'Non configuré'))}</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div class="rounded-lg bg-gray-50 p-4"><p class="text-gray-500">API</p><p class="font-semibold text-gray-800">${crmEsc(n.apiUrl || '—')}</p></div>
            <div class="rounded-lg bg-gray-50 p-4"><p class="text-gray-500">Clients synchronisés</p><p class="font-semibold text-gray-800">${crmEsc(String(n.syncedClients ?? 0))} / ${crmEsc(String(n.totalSubscriptions ?? 0))}</p></div>
            <div class="rounded-lg bg-gray-50 p-4"><p class="text-gray-500">État connexion</p><p class="font-semibold text-gray-800">${n.apiOk ? 'Connecté' : 'Indisponible'}</p></div>
        </div>
        <div class="flex flex-wrap gap-3 mt-4">
            <button type="button" onclick="syncNumelysAllClients()" class="px-4 py-2 border border-violet-300 text-violet-700 rounded-lg hover:bg-violet-50">Synchroniser tous les clients</button>
            <button type="button" onclick="runNumelysMonthlyBilling()" class="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700">Facturer le mois précédent</button>
            <button type="button" onclick="loadNumelysBillingPreview()" class="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Actualiser l'aperçu</button>
        </div>
        <div id="numelys-billing-mount" class="mt-6"></div>
    </section>`;
}

function renderNumelysBillingTable(rows, period) {
    if (!rows?.length) {
        return `<p class="text-sm text-gray-500">Aucune entreprise pour la période ${crmEsc(period || '')}.</p>`;
    }
    return `<div class="overflow-x-auto"><table class="w-full text-sm platform-ops-billing-table">
        <thead><tr class="text-left text-gray-500 border-b">
            <th class="py-2 pr-3">Entreprise</th>
            <th class="py-2 pr-3">Forfait</th>
            <th class="py-2 pr-3">PC</th>
            <th class="py-2 pr-3">Mobile</th>
            <th class="py-2 pr-3">Affrèt.</th>
            <th class="py-2 pr-3">Suppl. PC</th>
            <th class="py-2 pr-3">Suppl. mob.</th>
            <th class="py-2 pr-3">Dépassement</th>
            <th class="py-2 pr-3">Total HT</th>
            <th class="py-2">Actions</th>
        </tr></thead>
        <tbody>${rows.map((r) => `<tr class="border-b border-gray-100 align-top">
            <td class="py-2 pr-3">
                <button type="button" class="text-left hover:text-teal-700" onclick="openCrmClientDetail(${r.companyId})">
                    <div class="font-medium text-gray-800">${crmEsc(r.companyName)}</div>
                    <div class="text-xs text-gray-500">${r.numelysClientId ? `Numelys #${r.numelysClientId}` : 'Non sync.'}</div>
                </button>
            </td>
            <td class="py-2 pr-3">${crmEsc(r.planName)}</td>
            <td class="py-2 pr-3">${r.usage?.pcUsers ?? 0}${r.limits?.maxPcUsers != null ? ` / ${r.limits.maxPcUsers}` : ''}</td>
            <td class="py-2 pr-3">${r.usage?.mobileDrivers ?? 0}${r.limits?.maxMobileDrivers != null ? ` / ${r.limits.maxMobileDrivers}` : ''}</td>
            <td class="py-2 pr-3">${r.usage?.affretementSends ?? 0}${r.limits?.affretementQuota != null ? ` / ${r.limits.affretementQuota}` : ''}</td>
            <td class="py-2 pr-3">${r.limits?.contractedExtraPc ?? 0}</td>
            <td class="py-2 pr-3">${r.limits?.contractedExtraMobile ?? 0}</td>
            <td class="py-2 pr-3">${r.usage?.billableAffretementSends ?? 0}</td>
            <td class="py-2 pr-3 font-semibold">${Number(r.estimatedTotalHt || 0).toFixed(2)} €</td>
            <td class="py-2 whitespace-nowrap">
                <button type="button" class="text-violet-600 hover:underline mr-2" onclick="syncNumelysClient(${r.companyId})">Sync</button>
                <button type="button" class="text-violet-600 hover:underline" onclick="generateNumelysInvoice(${r.companyId})">Facturer</button>
            </td>
        </tr>`).join('')}</tbody>
    </table></div>`;
}

async function loadNumelysBillingPreview() {
    const mount = document.getElementById('numelys-billing-mount');
    if (!mount) return;
    mount.innerHTML = '<p class="text-sm text-gray-500"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Chargement de l\'aperçu facturation…</p>';
    try {
        const res = await apiFetch('numelys/billing/preview');
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Aperçu indisponible');
        mount.innerHTML = `
            <h4 class="font-semibold text-gray-800 mb-3">Aperçu — période ${crmEsc(json.period || '')}</h4>
            ${renderNumelysBillingTable(json.data, json.period)}
        `;
    } catch (err) {
        mount.innerHTML = `<p class="text-sm text-red-600">${crmEsc(err.message)}</p>`;
    }
}

async function syncNumelysAllClients() {
    try {
        const res = await apiFetch('numelys/billing/sync-all-clients', { method: 'POST', body: {} });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Synchronisation impossible');
        showToast(json.message || 'Clients synchronisés', 'success');
        await refreshPlatformCrmPage();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function syncNumelysClient(companyId) {
    try {
        const res = await apiFetch(`numelys/billing/sync-client/${companyId}`, { method: 'POST', body: {} });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Synchronisation impossible');
        showToast('Client synchronisé dans Numelys', 'success');
        await loadNumelysBillingPreview();
        if (window.platformCrmSelectedId === companyId) {
            await openCrmClientDetail(companyId, { scroll: false });
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function runNumelysMonthlyBilling() {
    if (!confirm('Générer les factures Numelys pour le mois précédent ?')) return;
    try {
        const res = await apiFetch('numelys/billing/run-monthly', { method: 'POST', body: { issue: true, send: false } });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Facturation impossible');
        showToast(json.message || 'Facturation mensuelle lancée', 'success');
        await loadNumelysBillingPreview();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function generateNumelysInvoice(companyId) {
    if (!confirm('Créer la facture Numelys pour cette entreprise (mois précédent) ?')) return;
    try {
        const res = await apiFetch(`numelys/billing/invoice/${companyId}`, { method: 'POST', body: { issue: true, send: false } });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Facturation impossible');
        showToast(json.data?.skipped ? 'Période déjà facturée' : `Facture ${json.data?.invoiceNumber || 'créée'}`, json.data?.skipped ? 'info' : 'success');
        await loadNumelysBillingPreview();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function renderPlatformCrmPageShell(data) {
    return `<div class="max-w-7xl mx-auto fade-in platform-crm-page">
        <div class="mb-6">
            <h2 class="text-2xl font-bold text-gray-800">CRM Clients</h2>
            <p class="text-sm text-gray-500 mt-1">Vue consolidée de votre clientèle Flenova : abonnements, facturation Numelys, contacts et suivi commercial.</p>
        </div>

        ${renderCrmSummaryCards(data?.summary)}
        ${renderCrmNumelysSection(data?.numelys)}
        ${renderCrmFilters()}

        <div class="platform-crm-layout mt-6">
            <section class="platform-crm-list bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="font-bold text-gray-800"><i class="fa-solid fa-users text-teal-600 mr-2"></i>Portefeuille clients (${data?.clients?.length ?? 0})</h3>
                    <button type="button" onclick="refreshPlatformCrmPage()" class="text-sm text-blue-600 hover:underline">Actualiser</button>
                </div>
                <div id="crm-clients-table">${renderCrmClientsTable(data?.clients)}</div>
            </section>
            <div id="crm-detail-mount">${renderCrmDetailPanel(null)}</div>
        </div>
    </div>`;
}

async function renderPlatformCrmPage() {
    return `<div class="py-8 text-center text-gray-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i><p class="mt-3">Chargement du CRM…</p></div>`;
}

async function hydratePlatformCrmPage() {
    const el = document.getElementById('app-content');
    if (!el) return;
    try {
        const data = await loadPlatformCrmData(window.platformCrmFilters || {});
        el.innerHTML = renderPlatformCrmPageShell(data);
        document.getElementById('crm-search')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') applyCrmFilters();
        });
        if (data?.numelys?.configured) await loadNumelysBillingPreview();
        if (window.platformCrmSelectedId) {
            await openCrmClientDetail(window.platformCrmSelectedId, { scroll: false });
        }
    } catch (e) {
        el.innerHTML = `<div class="p-8 text-center text-red-600">${crmEsc(e.message)}</div>`;
    }
}

async function refreshPlatformCrmPage() {
    window.cachedPlatformCrm = null;
    await hydratePlatformCrmPage();
}

function applyCrmFilters() {
    window.platformCrmFilters = {
        search: document.getElementById('crm-search')?.value?.trim() || '',
        crmStatus: document.getElementById('crm-filter-status')?.value || '',
        subStatus: document.getElementById('crm-filter-sub')?.value || '',
        plan: document.getElementById('crm-filter-plan')?.value || '',
    };
    window.platformCrmSelectedId = null;
    hydratePlatformCrmPage();
}

function resetCrmFilters() {
    window.platformCrmFilters = {};
    window.platformCrmSelectedId = null;
    hydratePlatformCrmPage();
}

async function openCrmClientDetail(companyId, { scroll = true } = {}) {
    window.platformCrmSelectedId = companyId;
    document.querySelectorAll('.platform-crm-row').forEach((row) => row.classList.remove('is-selected'));
    document.querySelector(`.platform-crm-row[onclick="openCrmClientDetail(${companyId})"]`)?.classList.add('is-selected');

    const mount = document.getElementById('crm-detail-mount');
    if (!mount) return;
    mount.innerHTML = `<aside class="platform-crm-detail"><div class="p-8 text-center text-gray-500"><i class="fa-solid fa-spinner fa-spin"></i></div></aside>`;

    try {
        const detail = await loadPlatformCrmDetail(companyId);
        mount.innerHTML = renderCrmDetailPanel(detail);
        if (scroll) mount.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
        mount.innerHTML = `<aside class="platform-crm-detail"><div class="p-6 text-red-600 text-sm">${crmEsc(err.message)}</div></aside>`;
    }
}

function closeCrmClientDetail() {
    window.platformCrmSelectedId = null;
    document.querySelectorAll('.platform-crm-row').forEach((row) => row.classList.remove('is-selected'));
    const mount = document.getElementById('crm-detail-mount');
    if (mount) mount.innerHTML = renderCrmDetailPanel(null);
}

async function saveCrmClientDetail(e, companyId) {
    e.preventDefault();
    const lastContactRaw = document.getElementById('crm-detail-last-contact')?.value;
    const payload = {
        crm_status: document.getElementById('crm-detail-status')?.value || null,
        crm_notes: document.getElementById('crm-detail-notes')?.value ?? '',
        last_contact_at: lastContactRaw ? new Date(lastContactRaw).toISOString() : null,
    };
    try {
        const res = await apiFetch(`platform/crm/${companyId}`, { method: 'PATCH', body: payload });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Enregistrement impossible');
        showToast(json.message || 'Fiche CRM enregistrée', 'success');
        window.cachedPlatformCrm = null;
        const data = await loadPlatformCrmData(window.platformCrmFilters || {});
        const table = document.getElementById('crm-clients-table');
        if (table) table.innerHTML = renderCrmClientsTable(data.clients);
        document.getElementById('crm-detail-mount').innerHTML = renderCrmDetailPanel(json.data);
        window.platformCrmSelectedId = companyId;
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function updateCrmContactStatus(contactId, status) {
    try {
        const res = await apiFetch(`platform/crm/contacts/${contactId}`, { method: 'PATCH', body: { status } });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Mise à jour impossible');
        showToast('Statut du message mis à jour', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

window.renderPlatformCrmPage = renderPlatformCrmPage;
window.hydratePlatformCrmPage = hydratePlatformCrmPage;
window.refreshPlatformCrmPage = refreshPlatformCrmPage;
window.applyCrmFilters = applyCrmFilters;
window.resetCrmFilters = resetCrmFilters;
window.openCrmClientDetail = openCrmClientDetail;
window.closeCrmClientDetail = closeCrmClientDetail;
window.saveCrmClientDetail = saveCrmClientDetail;
window.updateCrmContactStatus = updateCrmContactStatus;
window.loadNumelysBillingPreview = loadNumelysBillingPreview;
window.syncNumelysAllClients = syncNumelysAllClients;
window.syncNumelysClient = syncNumelysClient;
window.runNumelysMonthlyBilling = runNumelysMonthlyBilling;
window.generateNumelysInvoice = generateNumelysInvoice;
