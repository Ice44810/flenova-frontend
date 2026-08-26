/**
 * Gestion des litiges transport — flotte propre & sous-traitée
 */

const DISPUTE_STATUS_LABELS = {
    OPEN: 'Ouvert',
    IN_PROGRESS: 'En cours',
    MEDIATION: 'En médiation',
    RESOLVED: 'Résolu',
    REJECTED: 'Rejeté',
    CLOSED: 'Clos'
};

const DISPUTE_TYPE_LABELS = {
    RESERVE: 'Réserve',
    DELAY: 'Retard',
    LOSS: 'Perte',
    DAMAGE: 'Avarie',
    QUANTITY: 'Quantité',
    DOCUMENT: 'Document',
    OTHER: 'Autre'
};

const DISPUTE_STATUS_CLASS = {
    OPEN: 'bg-red-100 text-red-800',
    IN_PROGRESS: 'bg-amber-100 text-amber-800',
    MEDIATION: 'bg-purple-100 text-purple-800',
    RESOLVED: 'bg-green-100 text-green-800',
    REJECTED: 'bg-gray-200 text-gray-700',
    CLOSED: 'bg-slate-200 text-slate-700'
};

function disputeEsc(v) {
    return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '');
}

function disputeStatusBadge(status) {
    const label = DISPUTE_STATUS_LABELS[status] || status;
    const cls = DISPUTE_STATUS_CLASS[status] || 'bg-gray-100 text-gray-700';
    return `<span class="px-2 py-0.5 rounded text-xs font-semibold ${cls}">${disputeEsc(label)}</span>`;
}

function canManageDisputes() {
    return typeof can === 'function' && (
        can(PERM.MODULES.DISPUTES, PERM.ACTIONS.EDIT)
        || can(PERM.MODULES.DISPUTES, PERM.ACTIONS.RESOLVE)
    );
}

async function loadDisputesList(filters = {}) {
    const params = new URLSearchParams();
    if (filters.open) params.set('open', '1');
    if (filters.status) params.set('status', filters.status);
    const qs = params.toString();
    const res = await apiFetch(`disputes${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw new Error('Impossible de charger les litiges');
    const json = await res.json();
    return json.data || [];
}

async function loadDisputeStats() {
    const res = await apiFetch('disputes/stats');
    if (!res.ok) return null;
    const json = await res.json();
    return json.data;
}

function renderDisputesPage() {
    return `<div class="max-w-6xl mx-auto fade-in space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
                <h1 class="text-3xl font-extrabold text-gray-900">Litiges transport</h1>
                <p class="text-sm text-gray-600 mt-1">Preuves centralisées, alertes automatiques et suivi collaboratif (flotte & sous-traitance).</p>
            </div>
            <div class="flex flex-wrap gap-2">
                ${canManageDisputes() ? `
                <button type="button" onclick="runDisputeScanAll()" class="px-4 py-2 border border-blue-200 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-50">
                    <i class="fa-solid fa-radar mr-1"></i>Détecter anomalies
                </button>` : ''}
            </div>
        </div>
        <div id="disputes-kpi" class="grid grid-cols-2 md:grid-cols-4 gap-4"></div>
        <div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div class="p-4 border-b flex flex-wrap gap-2 items-center">
                <span class="text-sm font-semibold text-gray-700">Filtres :</span>
                <button type="button" onclick="filterDisputesList('open')" class="dispute-filter-btn px-3 py-1 rounded-full text-xs border border-gray-200 hover:bg-gray-50" data-filter="open">Ouverts</button>
                <button type="button" onclick="filterDisputesList('all')" class="dispute-filter-btn px-3 py-1 rounded-full text-xs border border-gray-200 hover:bg-gray-50" data-filter="all">Tous</button>
            </div>
            <div id="disputes-list" class="p-4 text-center text-gray-400">
                <i class="fa-solid fa-spinner fa-spin"></i>
            </div>
        </div>
    </div>`;
}

function renderDisputesKpi(stats) {
    const el = document.getElementById('disputes-kpi');
    if (!el || !stats) return;
    el.innerHTML = `
        <div class="bg-red-50 border border-red-100 rounded-xl p-4">
            <p class="text-xs text-red-600 uppercase font-semibold">Ouverts</p>
            <p class="text-2xl font-bold text-red-800">${stats.openCount ?? 0}</p>
        </div>
        <div class="bg-green-50 border border-green-100 rounded-xl p-4">
            <p class="text-xs text-green-600 uppercase font-semibold">Auto-résolus</p>
            <p class="text-2xl font-bold text-green-800">${stats.autoResolvedCount ?? 0}</p>
        </div>
        <div class="bg-blue-50 border border-blue-100 rounded-xl p-4 col-span-2">
            <p class="text-xs text-blue-600 uppercase font-semibold mb-2">Par type (top)</p>
            <div class="flex flex-wrap gap-2 text-xs">
                ${(stats.byType || []).slice(0, 4).map((r) =>
                    `<span class="bg-white px-2 py-1 rounded border">${disputeEsc(DISPUTE_TYPE_LABELS[r.dispute_type] || r.dispute_type)}: ${r.cnt}</span>`
                ).join('') || '—'}
            </div>
        </div>`;
}

function renderDisputesTable(rows) {
    const el = document.getElementById('disputes-list');
    if (!el) return;
    if (!rows.length) {
        el.innerHTML = '<p class="text-gray-500 py-8">Aucun litige — lancez une détection ou ouvrez un dossier depuis un transport.</p>';
        return;
    }
    el.innerHTML = `<div class="overflow-x-auto"><table class="w-full text-sm">
        <thead class="text-left text-xs uppercase text-gray-500 border-b">
            <tr>
                <th class="py-3 pr-4">Réf.</th>
                <th class="py-3 pr-4">Transport</th>
                <th class="py-3 pr-4">Type</th>
                <th class="py-3 pr-4">Porteur</th>
                <th class="py-3 pr-4">Statut</th>
                <th class="py-3 pr-4">Échéance</th>
                <th class="py-3">Actions</th>
            </tr>
        </thead>
        <tbody>
            ${rows.map((d) => `
                <tr class="border-b border-gray-50 hover:bg-gray-50">
                    <td class="py-3 pr-4 font-mono text-xs">${disputeEsc(d.ref)}${d.auto_detected ? ' <i class="fa-solid fa-bolt text-amber-500" title="Détection auto"></i>' : ''}</td>
                    <td class="py-3 pr-4">
                        <button type="button" onclick="openTransportDetail(${d.order_id})" class="text-blue-600 hover:underline font-medium">${disputeEsc(d.order_ref)}</button>
                        <div class="text-xs text-gray-500">${disputeEsc(d.origin)} → ${disputeEsc(d.dest)}</div>
                    </td>
                    <td class="py-3 pr-4">${disputeEsc(DISPUTE_TYPE_LABELS[d.dispute_type] || d.dispute_type)}</td>
                    <td class="py-3 pr-4 text-xs">${d.carrier_type === 'SUBCONTRACTED' ? disputeEsc(d.subcontractor_name || 'Sous-traitant') : 'Flotte propre'}</td>
                    <td class="py-3 pr-4">${disputeStatusBadge(d.status)}</td>
                    <td class="py-3 pr-4 text-xs">${disputeEsc(d.claim_deadline || '—')}</td>
                    <td class="py-3">
                        <button type="button" onclick="openDisputeDetail(${d.id})" class="text-blue-600 hover:underline text-xs">Dossier</button>
                    </td>
                </tr>
            `).join('')}
        </tbody>
    </table></div>`;
}

async function refreshDisputesPage(filter = 'open') {
    try {
        const [rows, stats] = await Promise.all([
            loadDisputesList(filter === 'open' ? { open: true } : {}),
            loadDisputeStats()
        ]);
        renderDisputesKpi(stats);
        renderDisputesTable(rows);
    } catch (e) {
        const el = document.getElementById('disputes-list');
        if (el) el.innerHTML = `<p class="text-red-600 py-4">${disputeEsc(e.message)}</p>`;
    }
}

window.filterDisputesList = function (filter) {
    document.querySelectorAll('.dispute-filter-btn').forEach((b) => {
        b.classList.toggle('bg-blue-50', b.dataset.filter === filter);
        b.classList.toggle('border-blue-300', b.dataset.filter === filter);
    });
    refreshDisputesPage(filter);
};

window.runDisputeScanAll = async function () {
    try {
        if (typeof canManageDisputes === 'function' && !canManageDisputes()) {
            if (typeof showToast === 'function') showToast('Action réservée à l’exploitation', 'error');
            return;
        }
        const res = await apiFetch('disputes/scan', { method: 'POST' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Scan impossible');
        if (typeof showToast === 'function') showToast(json.message || 'Scan terminé', 'success');
        refreshDisputesPage('open');
    } catch (e) {
        if (typeof showToast === 'function') showToast(e.message, 'error');
    }
};

window.openDisputeDetail = async function (disputeId) {
    try {
        const res = await apiFetch(`disputes/${disputeId}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Litige introuvable');
        showDisputeDetailModal(json.data);
    } catch (e) {
        if (typeof showToast === 'function') showToast(e.message, 'error');
    }
};

function showDisputeDetailModal(d) {
    const existing = document.getElementById('dispute-detail-modal');
    if (existing) existing.remove();

    const events = (d.events || []).map((e) => `
        <div class="text-xs border-l-2 border-blue-200 pl-3 py-2">
            <span class="text-gray-400 font-mono">${disputeEsc(e.created_at)}</span>
            <span class="font-semibold text-gray-700 ml-2">${disputeEsc(e.user_name || 'Système')}</span>
            <p class="text-gray-600 mt-0.5">${disputeEsc(e.message)}</p>
        </div>`).join('') || '<p class="text-xs text-gray-400">Aucun événement</p>';

    const proofs = (d.proofs || []).map((p) => {
        const url = p.file_url && typeof resolveProtectedUploadUrl === 'function'
            ? resolveProtectedUploadUrl(p.file_url) : p.file_url;
        const link = url
            ? `<a href="${disputeEsc(url)}" target="_blank" rel="noopener" class="text-blue-600 hover:underline">${disputeEsc(p.label || p.proof_type)}</a>`
            : disputeEsc(p.label || p.proof_type);
        return `<li class="text-xs flex items-center gap-2"><i class="fa-solid fa-paperclip text-gray-400"></i>${link} <span class="text-gray-400">(${disputeEsc(p.proof_type)})</span></li>`;
    }).join('') || '<li class="text-xs text-gray-400">Aucune preuve rattachée</li>';

    const statusOptions = Object.keys(DISPUTE_STATUS_LABELS).map((s) =>
        `<option value="${s}" ${d.status === s ? 'selected' : ''}>${DISPUTE_STATUS_LABELS[s]}</option>`
    ).join('');

    const modal = document.createElement('div');
    modal.id = 'dispute-detail-modal';
    modal.className = 'fixed inset-0 z-[95] flex items-center justify-center bg-black/50 p-4';
    modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div class="p-4 border-b flex justify-between items-start">
                <div>
                    <h3 class="font-bold text-lg">${disputeEsc(d.ref)} — ${disputeEsc(d.title)}</h3>
                    <p class="text-sm text-gray-500 mt-1">Transport ${disputeEsc(d.order_ref)} · ${disputeStatusBadge(d.status)}</p>
                </div>
                <button type="button" onclick="closeDisputeDetailModal()" class="text-gray-400 hover:text-red-500"><i class="fa-solid fa-xmark text-xl"></i></button>
            </div>
            <div class="p-4 overflow-y-auto flex-1 space-y-4 text-sm">
                <p class="text-gray-700">${disputeEsc(d.description || '')}</p>
                ${d.legal_basis ? `<p class="text-xs text-amber-800 bg-amber-50 rounded p-2"><i class="fa-solid fa-gavel mr-1"></i>${disputeEsc(d.legal_basis)}${d.claim_deadline ? ` — échéance ${disputeEsc(d.claim_deadline)}` : ''}</p>` : ''}
                <div>
                    <h4 class="font-bold text-xs uppercase text-gray-500 mb-2">Preuves digitalisées</h4>
                    <ul class="space-y-1">${proofs}</ul>
                </div>
                <div>
                    <h4 class="font-bold text-xs uppercase text-gray-500 mb-2">Historique horodaté</h4>
                    ${events}
                </div>
                ${canManageDisputes() ? `
                <div class="border-t pt-4 space-y-3">
                    <label class="block text-xs font-semibold text-gray-600">Statut</label>
                    <select id="dispute-status-select" class="border rounded px-3 py-2 text-sm w-full">${statusOptions}</select>
                    <label class="block text-xs font-semibold text-gray-600">Résolution / commentaire</label>
                    <textarea id="dispute-resolution-input" rows="2" class="border rounded px-3 py-2 text-sm w-full" placeholder="Décision, indemnisation, réserve juridique…">${disputeEsc(d.resolution || '')}</textarea>
                    <button type="button" onclick="saveDisputeDetail(${d.id})" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">Enregistrer</button>
                </div>` : ''}
            </div>
        </div>`;
    document.body.appendChild(modal);
}

window.closeDisputeDetailModal = function () {
    document.getElementById('dispute-detail-modal')?.remove();
};

window.saveDisputeDetail = async function (id) {
    try {
        const status = document.getElementById('dispute-status-select')?.value;
        const resolution = document.getElementById('dispute-resolution-input')?.value?.trim();
        const res = await apiFetch(`disputes/${id}`, {
            method: 'PATCH',
            body: { status, resolution }
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Mise à jour impossible');
        if (typeof showToast === 'function') showToast('Dossier mis à jour', 'success');
        closeDisputeDetailModal();
        if (window.currentAppRoute === 'disputes') refreshDisputesPage('open');
        if (currentTransportDetail?.id) openTransportDetail(currentTransportDetail.id);
    } catch (e) {
        if (typeof showToast === 'function') showToast(e.message, 'error');
    }
};

window.openCreateDisputeModal = function (orderId, prefill = {}) {
    const existing = document.getElementById('dispute-create-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'dispute-create-modal';
    modal.className = 'fixed inset-0 z-[95] flex items-center justify-center bg-black/50 p-4';
    modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
            <h3 class="font-bold text-lg mb-4">Ouvrir un dossier litige</h3>
            <form id="dispute-create-form" class="space-y-3 text-sm" onsubmit="submitCreateDispute(event, ${orderId})">
                <div>
                    <label class="block text-xs font-semibold text-gray-600 mb-1">Type</label>
                    <select id="dispute-create-type" class="w-full border rounded px-3 py-2">
                        ${Object.entries(DISPUTE_TYPE_LABELS).map(([k, v]) =>
                            `<option value="${k}" ${prefill.dispute_type === k ? 'selected' : ''}>${v}</option>`
                        ).join('')}
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-semibold text-gray-600 mb-1">Gravité</label>
                    <select id="dispute-create-severity" class="w-full border rounded px-3 py-2">
                        <option value="LEGERE">Légère</option>
                        <option value="MAJEURE" ${prefill.severity === 'MAJEURE' ? 'selected' : ''}>Majeure</option>
                        <option value="CRITIQUE">Critique</option>
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-semibold text-gray-600 mb-1">Titre</label>
                    <input type="text" id="dispute-create-title" class="w-full border rounded px-3 py-2" required value="${disputeEsc(prefill.title || '')}">
                </div>
                <div>
                    <label class="block text-xs font-semibold text-gray-600 mb-1">Description / réserve</label>
                    <textarea id="dispute-create-desc" rows="3" class="w-full border rounded px-3 py-2" required>${disputeEsc(prefill.description || '')}</textarea>
                </div>
                <label class="flex items-center gap-2 text-xs text-gray-600">
                    <input type="checkbox" id="dispute-create-link-proofs" checked>
                    Rattacher automatiquement les preuves du transport (POD, CMR, signatures)
                </label>
                <div class="flex justify-end gap-2 pt-2">
                    <button type="button" onclick="closeCreateDisputeModal()" class="px-4 py-2 border rounded text-gray-600">Annuler</button>
                    <button type="submit" class="px-4 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700">Créer le dossier</button>
                </div>
            </form>
        </div>`;
    document.body.appendChild(modal);
};

window.closeCreateDisputeModal = function () {
    document.getElementById('dispute-create-modal')?.remove();
};

window.submitCreateDispute = async function (e, orderId) {
    e.preventDefault();
    try {
        const body = {
            dispute_type: document.getElementById('dispute-create-type')?.value,
            severity: document.getElementById('dispute-create-severity')?.value,
            title: document.getElementById('dispute-create-title')?.value?.trim(),
            description: document.getElementById('dispute-create-desc')?.value?.trim(),
            link_order_proofs: document.getElementById('dispute-create-link-proofs')?.checked
        };
        const res = await apiFetch(`transport-orders/${orderId}/disputes`, { method: 'POST', body });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Création impossible');
        if (typeof showToast === 'function') showToast('Dossier litige créé', 'success');
        closeCreateDisputeModal();
        openTransportDetail(orderId);
    } catch (err) {
        if (typeof showToast === 'function') showToast(err.message, 'error');
    }
};

function renderTransportDisputesSection(disputes, orderId) {
    if (typeof planHasFeature === 'function' && !planHasFeature('dispute_management')) return '';
    const rows = (disputes || []).map((d) => `
        <div class="flex items-center justify-between gap-2 py-2 border-b border-gray-100 text-xs">
            <div>
                <span class="font-mono font-semibold">${disputeEsc(d.ref)}</span>
                ${d.auto_detected ? '<i class="fa-solid fa-bolt text-amber-500 ml-1" title="Auto"></i>' : ''}
                <span class="text-gray-500 ml-2">${disputeEsc(DISPUTE_TYPE_LABELS[d.dispute_type] || d.dispute_type)}</span>
            </div>
            <div class="flex items-center gap-2">
                ${disputeStatusBadge(d.status)}
                <button type="button" onclick="openDisputeDetail(${d.id})" class="text-blue-600 hover:underline">Voir</button>
            </div>
        </div>`).join('') || '<p class="text-xs text-gray-400 italic">Aucun litige sur ce transport</p>';

    const canCreate = typeof can === 'function' && can(PERM.MODULES.DISPUTES, PERM.ACTIONS.CREATE);
    return `
        <div id="td-disputes-section">
            <div class="flex items-center justify-between mb-2">
                <h4 class="font-bold text-xs uppercase text-gray-500">Litiges & réclamations</h4>
                ${canCreate ? `<button type="button" onclick="openCreateDisputeModal(${orderId})" class="text-xs text-red-600 hover:underline font-medium"><i class="fa-solid fa-scale-balanced mr-1"></i>Déclarer</button>` : ''}
            </div>
            ${rows}
        </div>`;
}

window.renderDisputesPage = renderDisputesPage;
window.refreshDisputesPage = refreshDisputesPage;
window.renderTransportDisputesSection = renderTransportDisputesSection;
