/**
 * Flenova MVP — Transport cycle (ordre = TransportOrder)
 * Conserve le visuel existant ; branché sur /api/transport-orders
 */

const MVP_STATUSES = ['Brouillon', 'À planifier', 'Pris en charge', 'En cours', 'Livré', 'Validé', 'Clôturé'];

const MVP_ROLE_LABELS = {
    admin: 'Admin',
    exploitant: 'Exploitant',
    manager: 'Exploitant',
    chauffeur: 'Chauffeur',
    comptabilite: 'Comptabilité',
    lecture: 'Lecture seule',
    user: 'Lecture seule'
};

function getUserRole() {
    return PERM.getUserRole();
}

function getStatusBadgeClass(status) {
    const map = {
        'Brouillon': 'bg-gray-100 text-gray-800',
        'À planifier': 'bg-yellow-100 text-yellow-800',
        'Pris en charge': 'bg-indigo-100 text-indigo-800',
        'En cours': 'bg-blue-100 text-blue-800',
        'Livré': 'bg-teal-100 text-teal-800',
        'Validé': 'bg-green-100 text-green-800',
        'Clôturé': 'bg-slate-100 text-slate-600',
        'Planifié': 'bg-gray-100 text-gray-800',
        'Terminé': 'bg-green-100 text-green-800',
        'Annulé': 'bg-red-100 text-red-800',
        'Affrété': 'bg-purple-100 text-purple-800'
    };
    return map[status] || 'bg-orange-100 text-orange-800';
}

function getStatusBorderClass(status) {
    const map = {
        'Brouillon': 'border-l-4 border-gray-400',
        'À planifier': 'border-l-4 border-yellow-500',
        'Pris en charge': 'border-l-4 border-indigo-500',
        'En cours': 'border-l-4 border-blue-500',
        'Livré': 'border-l-4 border-teal-500',
        'Validé': 'border-l-4 border-green-500',
        'Clôturé': 'border-l-4 border-slate-400',
        'Planifié': 'border-l-4 border-gray-400',
        'Terminé': 'border-l-4 border-green-500',
        'Annulé': 'border-l-4 border-red-400',
        'Affrété': 'border-l-4 border-purple-500',
    };
    return map[status] || 'border-l-4 border-gray-300';
}

let transportFilters = { status: '', search: '', view: 'active' };
let currentTransportDetail = null;
let completedTransportSelection = new Set();
let transportSelection = new Set();
let deletedTransportOrders = [];

const CLOSED_TRANSPORT_STATUSES = ['Validé', 'Clôturé'];

function transportCanDelete(order) {
    return typeof canDeleteTransport === 'function' && canDeleteTransport()
        && order && !CLOSED_TRANSPORT_STATUSES.includes(order.status);
}
window.transportCanDelete = transportCanDelete;

function transportIsSelectable(order) {
    if (!order) return false;
    if (transportFilters.view === 'trash') return true;
    return transportHasBillingActions(order) || transportCanDelete(order);
}

function getTransportListSource() {
    return transportFilters.view === 'trash' ? deletedTransportOrders : (db.orders || []);
}

const MVP_CYCLE_STEPS = [
    { id: 'create', label: 'Créer' },
    { id: 'assign', label: 'Affecter' },
    { id: 'execute', label: 'Exécuter' },
    { id: 'validate', label: 'Valider' },
    { id: 'preinvoice', label: 'Préfacturer' }
];

function getMvpCycleState(order) {
    const status = order?.status || '';
    const flags = {
        create: !!order?.id,
        assign: !!(order?.driver_id || order?.assignment_type === 'SUBCONTRACTED'
            || ['Pris en charge', 'Affrété', 'En cours', 'Livré', 'Validé', 'Clôturé'].includes(status)),
        execute: ['Livré', 'Validé', 'Clôturé'].includes(status),
        validate: ['Validé', 'Clôturé'].includes(status),
        preinvoice: !!(order?.invoice_draft_id || status === 'Clôturé')
    };
    const steps = MVP_CYCLE_STEPS.map((step) => ({ ...step, done: !!flags[step.id] }));
    const currentIdx = steps.findIndex((s) => !s.done);
    return { steps, currentIdx: currentIdx === -1 ? steps.length - 1 : currentIdx };
}

function renderMvpCycleProgress(order) {
    const { steps, currentIdx } = getMvpCycleState(order);
    return `<div class="flex flex-wrap items-center gap-1 text-[10px] uppercase tracking-wide">
        ${steps.map((step, idx) => {
            const isCurrent = idx === currentIdx && !step.done;
            const cls = step.done
                ? 'bg-green-100 text-green-800 border-green-200'
                : isCurrent
                    ? 'bg-blue-100 text-blue-800 border-blue-300 ring-1 ring-blue-300'
                    : 'bg-gray-50 text-gray-400 border-gray-200';
            const icon = step.done ? '<i class="fa-solid fa-check mr-1"></i>' : '';
            return `<span class="px-2 py-1 rounded-full border font-semibold ${cls}">${icon}${step.label}</span>${idx < steps.length - 1 ? '<i class="fa-solid fa-chevron-right text-gray-300 text-[8px]"></i>' : ''}`;
        }).join('')}
    </div>`;
}

function routeForMvpStep(step, status) {
    const byStep = {
        create: 'transports',
        assign: 'planning',
        execute: 'inprogress_transports',
        validate: 'completed_transports',
        preinvoice: 'preinvoicing'
    };
    if (step && byStep[step]) return byStep[step];
    if (['Brouillon', 'À planifier', 'Planifié'].includes(status)) return 'transports';
    if (['Pris en charge', 'Affrété', 'En cours'].includes(status)) return 'inprogress_transports';
    if (['Livré', 'Validé'].includes(status)) return 'completed_transports';
    if (status === 'Clôturé') return 'preinvoicing';
    return window.currentAppRoute || 'transports';
}

window.refreshAfterMvpStep = async function (options = {}) {
    const {
        orderId = null,
        step = null,
        status = null,
        route = null,
        reopenDetail = !!orderId,
        closeDetail = false
    } = options;

    const targetRoute = route || routeForMvpStep(step, status);
    if (typeof fetchAllData === 'function') await fetchAllData();
    if (typeof router === 'function') await router(targetRoute);
    if (closeDetail && typeof closeTransportDetail === 'function') {
        closeTransportDetail();
    } else if (reopenDetail && orderId && typeof openTransportDetail === 'function') {
        await openTransportDetail(orderId);
    }
};

function getTransportBillingOptions(order) {
    const options = [];
    const inProgress = ['Pris en charge', 'En cours', 'Planifié', 'Affrété'].includes(order.status);

    if (inProgress && typeof canChangeTransportStatus === 'function' && canChangeTransportStatus()) {
        options.push({ value: 'delivered', label: 'Marquer livré' });
    }
    if (order.status === 'Livré' && typeof canValidateTransport === 'function' && canValidateTransport()) {
        options.push({ value: 'validate', label: 'Valider' });
    }
    if (order.status === 'Validé' && !order.invoice_draft_id && typeof canManageFinance === 'function' && canManageFinance()) {
        options.push({ value: 'preinvoice', label: 'Préfacturer' });
    }
    if (typeof canManageFinance === 'function' && canManageFinance()) {
        if (order.invoice_draft_id) {
            options.push({ value: 'invoice', label: 'Facturer (brouillon)' });
        } else if (['Validé', 'Clôturé'].includes(order.status)) {
            options.push({ value: 'invoice', label: 'Facturer' });
        }
    }
    return options;
}

function transportHasBillingActions(order) {
    return getTransportBillingOptions(order).length > 0;
}

function renderTransportBillingSelect(order) {
    const options = getTransportBillingOptions(order);
    if (!options.length) {
        return '<span class="text-gray-300 text-xs">—</span>';
    }
    return `<select class="border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 bg-white focus:ring-blue-500 focus:border-blue-500 max-w-[150px]"
        onchange="runTransportBillingAction(this.value, ${order.id}); this.selectedIndex = 0;">
        <option value="">Facturation…</option>
        ${options.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
    </select>`;
}

function countSelectedTransportsForAction(action) {
    return [...transportSelection].filter(id => {
        const o = (db.orders || []).find(x => x.id === id);
        if (!o) return false;
        return getTransportBillingOptions(o).some(opt => opt.value === action);
    }).length;
}

function countSelectedTransportsForDelete() {
    if (transportFilters.view === 'trash') return transportSelection.size;
    return [...transportSelection].filter(id => {
        const o = (db.orders || []).find(x => x.id === id);
        return transportCanDelete(o);
    }).length;
}

function renderTransportList() {
    let orders = [...getTransportListSource()];
    if (transportFilters.status) orders = orders.filter(o => o.status === transportFilters.status);
    if (transportFilters.search) {
        const q = transportFilters.search.toLowerCase();
        orders = orders.filter(o =>
            (o.ref || '').toLowerCase().includes(q) ||
            (o.origin || '').toLowerCase().includes(q) ||
            (o.dest || '').toLowerCase().includes(q) ||
            (o.client_name || '').toLowerCase().includes(q)
        );
    }

    const statusOptions = ['<option value="">Tous statuts</option>']
        .concat(MVP_STATUSES.map(s => `<option value="${s}" ${transportFilters.status === s ? 'selected' : ''}>${s}</option>`))
        .join('');

    const selectableOrders = orders.filter(transportIsSelectable);
    const selectedCount = selectableOrders.filter(o => transportSelection.has(o.id)).length;
    const allSelectableSelected = selectableOrders.length > 0
        && selectableOrders.every(o => transportSelection.has(o.id));
    const preinvoiceCount = countSelectedTransportsForAction('preinvoice');
    const validateCount = countSelectedTransportsForAction('validate');
    const deliveredCount = countSelectedTransportsForAction('delivered');
    const invoiceCount = countSelectedTransportsForAction('invoice');
    const deleteCount = countSelectedTransportsForDelete();
    const restoreCount = transportFilters.view === 'trash' ? selectedCount : 0;
    const inTrash = transportFilters.view === 'trash';
    const canDelete = typeof canDeleteTransport === 'function' && canDeleteTransport();

    return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 fade-in">
        <div class="flex flex-wrap justify-between items-center gap-4 mb-6">
            <div>
                <h3 class="font-bold text-lg text-gray-800">${inTrash ? 'Corbeille — Transports supprimés' : 'Transports'}</h3>
                <p class="text-xs text-gray-500">${inTrash ? 'Restaurez les transports supprimés ou videz la sélection' : 'Cycle MVP : créer → affecter → exécuter → valider → préfacturer'}</p>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
                <div class="inline-flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                    <button type="button" onclick="setTransportListView('active')"
                        class="px-3 py-1.5 ${!inTrash ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}">Actifs</button>
                    ${canDelete ? `<button type="button" onclick="setTransportListView('trash')"
                        class="px-3 py-1.5 ${inTrash ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}"><i class="fa-solid fa-trash-can mr-1"></i>Corbeille</button>` : ''}
                </div>
                <input type="text" id="transport-search" placeholder="Rechercher ref, client, trajet…" value="${transportFilters.search || ''}"
                    oninput="transportFilters.search=this.value; router('transports')"
                    class="border rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                <select id="transport-status-filter" onchange="transportFilters.status=this.value; router('transports')"
                    class="border rounded px-3 py-2 text-sm">${statusOptions}</select>
                ${!inTrash && canWriteTransport() ? `<button onclick="openAddOrderModal()" class="bg-blue-600 text-white px-4 py-2 rounded text-sm shadow hover:bg-blue-700"><i class="fa-solid fa-plus mr-2"></i>Créer un transport</button>` : ''}
            </div>
        </div>
        ${selectableOrders.length ? `
        <div class="flex flex-wrap items-center gap-2 mb-4 p-3 bg-slate-50 border border-slate-100 rounded-lg">
            <span class="text-xs text-gray-500 mr-1"><i class="fa-solid fa-check-double mr-1"></i>Sélection : <strong>${selectedCount}</strong></span>
            ${inTrash && canDelete ? `
                <button type="button" onclick="bulkRestoreTransports()"
                    class="bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    ${restoreCount === 0 ? 'disabled' : ''}>
                    <i class="fa-solid fa-rotate-left mr-1"></i>Restaurer (${restoreCount})
                </button>
            ` : ''}
            ${!inTrash && canDelete ? `
                <button type="button" onclick="bulkDeleteTransports()"
                    class="bg-red-600 text-white px-3 py-1.5 rounded text-xs font-semibold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    ${deleteCount === 0 ? 'disabled' : ''}>
                    <i class="fa-solid fa-trash mr-1"></i>Supprimer (${deleteCount})
                </button>
            ` : ''}
            ${!inTrash && typeof canChangeTransportStatus === 'function' && canChangeTransportStatus() ? `
                <button type="button" onclick="bulkMarkDeliveredTransports()"
                    class="bg-teal-600 text-white px-3 py-1.5 rounded text-xs font-semibold hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    ${deliveredCount === 0 ? 'disabled' : ''}>
                    <i class="fa-solid fa-truck-fast mr-1"></i>Marquer livré (${deliveredCount})
                </button>
            ` : ''}
            ${!inTrash && typeof canValidateTransport === 'function' && canValidateTransport() ? `
                <button type="button" onclick="bulkValidateTransports()"
                    class="bg-green-600 text-white px-3 py-1.5 rounded text-xs font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    ${validateCount === 0 ? 'disabled' : ''}>
                    <i class="fa-solid fa-check mr-1"></i>Valider (${validateCount})
                </button>
            ` : ''}
            ${!inTrash && typeof canManageFinance === 'function' && canManageFinance() ? `
                <button type="button" onclick="bulkPreinvoiceTransports()"
                    class="bg-orange-600 text-white px-3 py-1.5 rounded text-xs font-semibold hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    ${preinvoiceCount === 0 ? 'disabled' : ''}>
                    <i class="fa-solid fa-file-invoice mr-1"></i>Préfacturer (${preinvoiceCount})
                </button>
                <button type="button" onclick="bulkInvoiceTransports()"
                    class="bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    ${invoiceCount === 0 ? 'disabled' : ''}>
                    <i class="fa-solid fa-file-invoice-dollar mr-1"></i>Facturer (${invoiceCount})
                </button>
            ` : ''}
        </div>` : ''}
        <div class="overflow-x-auto">
            <table class="w-full text-sm text-left text-gray-500">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                    <tr>
                        <th class="px-4 py-3 w-10">
                            ${selectableOrders.length ? `
                                <input type="checkbox" class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    ${allSelectableSelected ? 'checked' : ''}
                                    onchange="toggleSelectAllTransports(this.checked)"
                                    title="Tout sélectionner">
                            ` : ''}
                        </th>
                        <th class="px-4 py-3">Réf.</th>
                        <th class="px-4 py-3">Client</th>
                        <th class="px-4 py-3">Trajet</th>
                        <th class="px-4 py-3">Dates</th>
                        <th class="px-4 py-3">Chauffeur / Sous-traitant</th>
                        <th class="px-4 py-3">Statut</th>
                        <th class="px-4 py-3">Montant</th>
                        <th class="px-4 py-3">Actions</th>
                        ${inTrash ? '' : '<th class="px-4 py-3">Facturation</th>'}
                        ${inTrash ? '<th class="px-4 py-3">Supprimé le</th>' : ''}
                    </tr>
                </thead>
                <tbody>
                    ${orders.length ? orders.map(o => {
        const canSelect = transportIsSelectable(o);
        const isSelected = transportSelection.has(o.id);
        const deletedLabel = o.deleted_at ? (typeof formatDisplayDate === 'function' ? formatDisplayDate(o.deleted_at) : String(o.deleted_at).slice(0, 10)) : '—';
        return `
                        <tr class="bg-white border-b hover:bg-gray-50 ${isSelected ? 'bg-blue-50/60' : ''}">
                            <td class="px-4 py-3">
                                ${canSelect ? `
                                    <input type="checkbox" class="transport-checkbox rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        data-order-id="${o.id}" ${isSelected ? 'checked' : ''}
                                        onchange="toggleTransportSelect(${o.id}, this.checked)">
                                ` : ''}
                            </td>
                            <td class="px-4 py-3 font-medium text-gray-900">${o.ref || '#' + o.id}</td>
                            <td class="px-4 py-3">${o.client_name || '-'}</td>
                            <td class="px-4 py-3 text-xs">${o.origin || '-'} → ${o.dest || '-'}</td>
                            <td class="px-4 py-3 text-xs">${formatDisplayDate(o.load_date) || '-'} / ${formatDisplayDate(o.delivery_date) || '-'}</td>
                            <td class="px-4 py-3">${o.assignment_type === 'SUBCONTRACTED' ? (o.subcontractor_name || '<span class="text-purple-600">Sous-traitant</span>') : (o.driver_name || '-')}</td>
                            <td class="px-4 py-3">
                                <span class="px-2 py-1 rounded text-xs font-semibold ${getStatusBadgeClass(o.status)}">${o.status}</span>
                                ${o.invoice_draft_id ? `<div class="text-[10px] text-gray-400 mt-1">Préfacture ${o.invoice_draft_id}</div>` : ''}
                            </td>
                            <td class="px-4 py-3 font-bold">${Number(o.price || 0).toLocaleString()} €</td>
                            <td class="px-4 py-3 whitespace-nowrap">
                                ${inTrash ? `
                                    ${canDelete ? `<button onclick="restoreTransport(${o.id})" class="text-emerald-600 hover:underline text-xs"><i class="fa-solid fa-rotate-left mr-1"></i>Restaurer</button>` : ''}
                                ` : `
                                <button onclick="openTransportDetail(${o.id})" class="text-blue-600 hover:underline text-xs mr-2">Détail</button>
                                ${canShowDispatchButton(o) ? `<button onclick="openDispatchModal(${o.id})" class="text-purple-600 hover:underline text-xs mr-2"><i class="fa-solid fa-handshake mr-1"></i>Affréter</button>` : ''}
                                ${canWriteTransport() ? `<button onclick="openEditOrderModal(${o.id})" class="text-gray-500 hover:text-blue-600 text-xs"><i class="fa-solid fa-pen"></i></button>` : ''}
                                `}
                            </td>
                            ${inTrash ? `<td class="px-4 py-3 text-xs text-gray-500">${deletedLabel}</td>` : `<td class="px-4 py-3">${renderTransportBillingSelect(o)}</td>`}
                        </tr>`;
    }).join('') : `<tr><td colspan="${inTrash ? 10 : 10}" class="px-4 py-10 text-center text-gray-400 italic">${inTrash ? 'Aucun transport dans la corbeille' : 'Aucun transport'}</td></tr>`}
                </tbody>
            </table>
        </div>
    </div>`;
}

function renderPreInvoicing() {
    const candidates = (db.orders || []).filter(o => o.status === 'Validé' && !o.invoice_draft_id);
    return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 fade-in">
        <div class="flex justify-between items-center mb-6">
            <div>
                <h3 class="font-bold text-lg text-gray-800">Préfacturation</h3>
                <p class="text-xs text-gray-500">Transports validés, prêts à être transformés en brouillon de facture</p>
            </div>
            <span class="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-xs font-bold">${candidates.length} en attente</span>
        </div>
        <table class="w-full text-sm text-left text-gray-500">
            <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                <tr><th class="px-4 py-3">Réf.</th><th class="px-4 py-3">Client</th><th class="px-4 py-3">Trajet</th><th class="px-4 py-3">Montant</th><th class="px-4 py-3">Action</th></tr>
            </thead>
            <tbody>
                ${candidates.length ? candidates.map(o => `
                    <tr class="border-b hover:bg-gray-50">
                        <td class="px-4 py-3 font-medium">${o.ref || o.id}</td>
                        <td class="px-4 py-3">${o.client_name || '-'}</td>
                        <td class="px-4 py-3 text-xs">${o.origin} → ${o.dest}</td>
                        <td class="px-4 py-3 font-bold">${Number(o.price || 0).toLocaleString()} €</td>
                        <td class="px-4 py-3">
                            ${canManageFinance() ? `<button onclick="createInvoiceDraftFromTransport(${o.id})" class="bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700"><i class="fa-solid fa-file-invoice mr-1"></i>Générer préfacture</button>` : '-'}
                        </td>
                    </tr>`).join('') : '<tr><td colspan="5" class="px-4 py-10 text-center text-gray-400 italic">Aucun transport à préfacturer</td></tr>'}
            </tbody>
        </table>
    </div>`;
}

window.openTransportDetail = async function(orderId) {
    try {
        const res = await apiFetch(`transport-orders/${orderId}`);
        if (!res.ok) { showToast('Transport introuvable', 'error'); return; }
        const json = await res.json();
        currentTransportDetail = json.data;
        renderTransportDetailModal(currentTransportDetail);
        const modal = document.getElementById('transport-detail-modal');
        if (modal) {
            modal.style.top = '';
            modal.style.left = '';
            modal.style.position = '';
            modal.style.margin = '';
            modal.style.transform = '';
            modal.style.cursor = '';
            modal.classList.remove('hidden');
        }
    } catch (e) {
        showToast('Erreur de chargement', 'error');
    }
};

function renderTransportDetailModal(t) {
    document.getElementById('td-ref').textContent = t.ref || '#' + t.id;
    document.getElementById('td-status').innerHTML = `<span class="px-2 py-1 rounded text-xs font-semibold ${getStatusBadgeClass(t.status)}">${t.status}</span>`;
    const cycleEl = document.getElementById('td-mvp-cycle');
    if (cycleEl) cycleEl.innerHTML = renderMvpCycleProgress(t);
    document.getElementById('td-client').textContent = t.client_name || '-';
    document.getElementById('td-route').textContent = `${t.origin || '-'} → ${t.dest || '-'}`;
    document.getElementById('td-dates').textContent = `Chargement : ${formatDisplayDate(t.load_date) || '-'} | Livraison : ${formatDisplayDate(t.delivery_date) || '-'}`;
    document.getElementById('td-driver').textContent = t.assignment_type === 'SUBCONTRACTED'
        ? (t.subcontractor_name ? `Sous-traitant : ${t.subcontractor_name}` : 'Sous-traitant (non renseigné)')
        : (t.driver_name || 'Non assigné');
    if (t.assignment_type === 'SUBCONTRACTED' && t.purchase_price) {
        const margin = Number(t.price || 0) - Number(t.purchase_price || 0);
        document.getElementById('td-driver').textContent += ` — Achat: ${Number(t.purchase_price).toLocaleString()} € (marge ${margin.toLocaleString()} €)`;
    }
    const priceEl = document.getElementById('td-price');
    if (getUserRole() === 'chauffeur' || t.price === undefined) {
        priceEl.textContent = '—';
        priceEl.closest('.td-price-row')?.classList.add('hidden');
    } else {
        priceEl.textContent = `${Number(t.price || 0).toLocaleString()} €`;
        priceEl.closest('.td-price-row')?.classList.remove('hidden');
    }

    const historyEl = document.getElementById('td-history');
    const esc = typeof escapeHtml === 'function' ? escapeHtml : (v) => String(v ?? '');
    historyEl.innerHTML = (t.history || []).map(h => `
        <div class="flex gap-3 text-xs border-b pb-2 mb-2">
            <span class="font-mono text-gray-400">${esc(formatDisplayDate(h.changed_at) || '—')}</span>
            <span class="font-semibold ${getStatusBadgeClass(h.status)} px-1 rounded">${esc(h.status)}</span>
            <span class="text-gray-600">${esc(h.changed_by_name || 'Système')}${h.comment ? ' — ' + esc(h.comment) : ''}</span>
        </div>`).join('') || '<p class="text-gray-400 italic text-xs">Aucun historique</p>';

    const docsEl = document.getElementById('td-documents');
    docsEl.innerHTML = (t.documents || []).map(d => {
        const fileUrl = typeof resolveProtectedUploadUrl === 'function'
            ? resolveProtectedUploadUrl(d.file_url)
            : (d.file_url || '');
        return `
        <a href="${esc(fileUrl)}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-2 text-blue-600 hover:underline text-xs mb-1">
            <i class="fa-solid fa-file-pdf"></i> ${esc(d.file_name)} (${esc(d.doc_type)})
        </a>`;
    }).join('') || '<p class="text-gray-400 italic text-xs">Aucun document</p>';

    const commentsEl = document.getElementById('td-comments');
    commentsEl.innerHTML = (t.comments || []).map(c => `
        <div class="bg-gray-50 rounded p-2 mb-2 text-xs">
            <span class="font-bold text-gray-700">${esc(c.user_name || 'Utilisateur')}</span>
            <span class="text-gray-400 ml-2">${esc(formatDisplayDate(c.created_at) || '—')}</span>
            <p class="mt-1 text-gray-600">${esc(c.content)}</p>
        </div>`).join('') || '<p class="text-gray-400 italic text-xs">Aucun commentaire</p>';

    const actionsEl = document.getElementById('td-actions');
    let actionsHtml = '';
    if (typeof canAssignTransport === 'function' && canAssignTransport()) {
        actionsHtml += `<button onclick="assignTransportFromDetail(${t.id})" class="px-3 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 mr-2"><i class="fa-solid fa-user-check mr-1"></i>Affecter chauffeur</button>`;
    }
    if (typeof canShowDispatchButton === 'function' && canShowDispatchButton(t)) {
        actionsHtml += `<button onclick="closeTransportDetail(); openDispatchModal(${t.id})" class="px-3 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-700 mr-2"><i class="fa-solid fa-handshake mr-1"></i>Affréter</button>`;
    }
    if (typeof canWriteTransport === 'function' && canWriteTransport() && !['Validé', 'Clôturé', 'Terminé', 'Annulé'].includes(t.status)) {
        actionsHtml += `<button onclick="closeTransportDetail(); openEditOrderModal(${t.id})" class="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 mr-2"><i class="fa-solid fa-pen mr-1"></i>Modifier affectation</button>`;
    }
    if (typeof isOrderSubcontracted === 'function' ? isOrderSubcontracted(t) : (t.assignment_type === 'SUBCONTRACTED' || t.status === 'Affrété')) {
        actionsHtml += `<button onclick="closeTransportDetail(); openAffretementConfirmation(${t.id})" class="px-3 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 mr-2"><i class="fa-solid fa-file-contract mr-1"></i>Confirmation</button>`;
    }
    actionsHtml += `<button onclick="closeTransportDetail(); openTransportCmr(${t.id})" class="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 mr-2"><i class="fa-solid fa-truck-ramp-box mr-1"></i>CMR</button>`;
    if (typeof canValidateTransport === 'function' && canValidateTransport() && t.status === 'Livré') {
        actionsHtml += `<button onclick="validateTransportFromDetail(${t.id})" class="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 mr-2">Valider transport</button>`;
    }
    if (typeof canChangeTransportStatus === 'function' && canChangeTransportStatus()) {
        const nextStatuses = getNextStatuses(t.status);
        nextStatuses.forEach(s => {
            actionsHtml += `<button onclick="changeTransportStatus(${t.id}, '${s}')" class="px-3 py-1 border border-blue-300 text-blue-700 rounded text-xs hover:bg-blue-50 mr-1 mb-1">${s}</button>`;
        });
    }
    if (typeof canManageFinance === 'function' && canManageFinance() && t.status === 'Validé' && !t.invoice_draft_id) {
        actionsHtml += `<button onclick="createInvoiceDraftFromTransport(${t.id})" class="px-3 py-1 bg-orange-600 text-white rounded text-xs hover:bg-orange-700">Préfacturer</button>`;
    }
    actionsEl.innerHTML = actionsHtml || '<span class="text-xs text-gray-400">Aucune action disponible pour votre rôle</span>';

    document.getElementById('td-upload-section').style.display = (typeof canUploadDocument === 'function' && canUploadDocument()) ? 'block' : 'none';
    document.getElementById('td-comment-section').style.display = (typeof can === 'function' && can(PERM.MODULES.COMMENTS, PERM.ACTIONS.CREATE)) ? 'block' : 'none';
    document.getElementById('td-order-id').value = t.id;
}

function getNextStatuses(current) {
    const terminal = ['Validé', 'Clôturé', 'Terminé', 'Annulé'];
    if (terminal.includes(current)) return [];

    const allowed = typeof getAllowedStatusTransitions === 'function' ? getAllowedStatusTransitions() : [];
    const flow = {
        'Brouillon': ['À planifier', 'Planifié', 'Annulé'],
        'À planifier': ['Pris en charge', 'Planifié', 'Annulé'],
        'Pris en charge': ['En cours', 'Livré'],
        'En cours': ['Livré'],
        'Planifié': ['En cours', 'Pris en charge', 'Annulé'],
        'Affrété': ['En cours', 'Livré', 'Annulé'],
        'Livré': (typeof canValidateTransport === 'function' && canValidateTransport()) ? ['Validé'] : []
    };
    const candidates = flow[current] || [];
    return candidates.filter(s => !allowed.length || allowed.includes(s));
}

window.getNextStatuses = getNextStatuses;

window.closeTransportDetail = function() {
    document.getElementById('transport-detail-modal').classList.add('hidden');
    currentTransportDetail = null;
};

window.changeTransportStatus = async function (orderId, status, options = {}) {
    try {
        const res = await apiFetch(`transport-orders/${orderId}/status`, { method: 'POST', body: { status } });
        if (res.ok) {
            showToast(`Statut → ${status}`, 'success');
            await refreshAfterMvpStep({
                orderId,
                step: status === 'Livré' ? 'execute' : 'execute',
                status,
                reopenDetail: options.reopenDetail !== false && !options.fromList,
                route: options.route
            });
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Changement de statut refusé', 'error');
        }
    } catch (e) { showToast('Erreur serveur', 'error'); }
};

window.validateTransportFromDetail = async function (orderId, options = {}) {
    try {
        const res = await apiFetch(`transport-orders/${orderId}/validate`, { method: 'POST' });
        if (res.ok) {
            showToast('Transport validé', 'success');
            await refreshAfterMvpStep({
                orderId,
                step: 'validate',
                status: 'Validé',
                route: options.route,
                reopenDetail: options.reopenDetail !== false && !options.fromList
            });
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Validation impossible', 'error');
        }
    } catch (e) { showToast('Erreur serveur', 'error'); }
};

window.assignTransportFromDetail = async function (orderId) {
    const driverId = prompt('ID chauffeur à affecter (laisser vide si déjà renseigné) :');
    const vehicleId = prompt('ID véhicule (optionnel) :');
    try {
        const body = {};
        if (driverId) body.driver_id = parseInt(driverId, 10);
        if (vehicleId) body.vehicle_id = parseInt(vehicleId, 10);
        const res = await apiFetch(`transport-orders/${orderId}/assign`, { method: 'POST', body });
        if (res.ok) {
            showToast('Transport affecté', 'success');
            await refreshAfterMvpStep({ orderId, step: 'assign', status: 'Pris en charge' });
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Affectation impossible', 'error');
        }
    } catch (e) { showToast('Erreur serveur', 'error'); }
};

window.uploadTransportDocument = async function() {
    const orderId = document.getElementById('td-order-id').value;
    const fileInput = document.getElementById('td-doc-file');
    if (!fileInput.files.length) { showToast('Choisissez un fichier', 'error'); return; }
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('doc_type', document.getElementById('td-doc-type').value || 'POD');
    try {
        const res = await apiFetch(`transport-orders/${orderId}/documents`, { method: 'POST', body: formData });
        if (res.ok) {
            showToast('Document ajouté', 'success');
            fileInput.value = '';
            openTransportDetail(orderId);
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Upload échoué', 'error');
        }
    } catch (e) { showToast('Erreur upload', 'error'); }
};

window.submitTransportComment = async function() {
    const orderId = document.getElementById('td-order-id').value;
    const content = document.getElementById('td-comment-input').value.trim();
    if (!content) return;
    try {
        const res = await apiFetch(`transport-orders/${orderId}/comments`, { method: 'POST', body: { content } });
        if (res.ok) {
            document.getElementById('td-comment-input').value = '';
            showToast('Commentaire ajouté', 'success');
            openTransportDetail(orderId);
        }
    } catch (e) { showToast('Erreur serveur', 'error'); }
};

window.createInvoiceDraftFromTransport = async function (orderId, options = {}) {
    if (options.confirm !== false && !confirm('Générer une préfacture (brouillon) pour ce transport ?')) return;
    try {
        const res = await apiFetch(`transport-orders/${orderId}/invoice-draft`, { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            showToast(`Préfacture ${data.invoice_draft_id} créée`, 'success');
            if (typeof completedTransportSelection !== 'undefined') completedTransportSelection.delete(orderId);
            if (typeof transportSelection !== 'undefined') transportSelection.delete(orderId);
            await refreshAfterMvpStep({
                orderId,
                step: 'preinvoice',
                status: 'Clôturé',
                route: options.route || 'preinvoicing',
                closeDetail: true,
                reopenDetail: false
            });
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Échec préfacturation', 'error');
        }
    } catch (e) { showToast('Erreur serveur', 'error'); }
};

window.openInvoiceFromTransport = async function (orderId) {
    const order = (db.orders || []).find(o => o.id === orderId);
    if (!order) {
        showToast('Transport introuvable', 'error');
        return;
    }
    if (order.invoice_draft_id) {
        if (typeof window.editDraft === 'function') {
            window.editDraft(order.invoice_draft_id);
        }
        return;
    }
    if (order.status === 'Validé' && typeof canManageFinance === 'function' && canManageFinance()) {
        if (!confirm('Créer une préfacture puis ouvrir la facturation ?')) return;
        try {
            const res = await apiFetch(`transport-orders/${orderId}/invoice-draft`, { method: 'POST' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showToast(err.error || 'Échec préfacturation', 'error');
                return;
            }
            const data = await res.json();
            showToast(`Préfacture ${data.invoice_draft_id} créée`, 'success');
            transportSelection.delete(orderId);
            if (typeof fetchAllData === 'function') await fetchAllData();
            if (data.invoice_draft_id && typeof window.editDraft === 'function') {
                window.editDraft(data.invoice_draft_id);
            }
        } catch (e) {
            showToast('Erreur serveur', 'error');
        }
        return;
    }
    if (typeof router !== 'function') return;
    if (typeof editingInvoiceId !== 'undefined') editingInvoiceId = null;
    router('create_invoice');
    setTimeout(() => {
        const clientEl = document.getElementById('invoice-client');
        if (clientEl && order.client_id) clientEl.value = order.client_id;
        if (typeof invoiceLines !== 'undefined') {
            invoiceLines = [{
                desc: `Transport ${order.origin || ''} → ${order.dest || ''}`.trim(),
                qty: 1,
                price: Number(order.price || 0),
                tva: 0.20
            }];
        }
        if (typeof renderLines === 'function') renderLines();
        if (typeof previewInvoice === 'function') previewInvoice();
    }, 50);
};

window.runTransportBillingAction = async function (action, orderId) {
    if (!action) return;
    const listOptions = { fromList: true, reopenDetail: false, route: 'transports' };
    switch (action) {
        case 'delivered':
            await changeTransportStatus(orderId, 'Livré', listOptions);
            break;
        case 'validate':
            await validateTransportFromDetail(orderId, listOptions);
            break;
        case 'preinvoice':
            await createInvoiceDraftFromTransport(orderId, { route: 'transports' });
            break;
        case 'invoice':
            await openInvoiceFromTransport(orderId);
            break;
        default:
            break;
    }
};

window.toggleTransportSelect = function (orderId, checked) {
    if (checked) transportSelection.add(orderId);
    else transportSelection.delete(orderId);
    router('transports');
};

window.toggleSelectAllTransports = function (checked) {
    let orders = [...getTransportListSource()];
    if (transportFilters.status) orders = orders.filter(o => o.status === transportFilters.status);
    if (transportFilters.search) {
        const q = transportFilters.search.toLowerCase();
        orders = orders.filter(o =>
            (o.ref || '').toLowerCase().includes(q) ||
            (o.origin || '').toLowerCase().includes(q) ||
            (o.dest || '').toLowerCase().includes(q) ||
            (o.client_name || '').toLowerCase().includes(q)
        );
    }
    const selectable = orders.filter(transportIsSelectable);
    if (checked) selectable.forEach(o => transportSelection.add(o.id));
    else selectable.forEach(o => transportSelection.delete(o.id));
    router('transports');
};

window.setTransportListView = async function (view) {
    transportFilters.view = view === 'trash' ? 'trash' : 'active';
    transportSelection.clear();
    if (transportFilters.view === 'trash') {
        await loadDeletedTransports();
    }
    router('transports');
};

window.loadDeletedTransports = async function () {
    try {
        const res = await apiFetch('transport-orders/deleted');
        if (!res.ok) {
            deletedTransportOrders = [];
            return [];
        }
        const payload = await res.json();
        deletedTransportOrders = payload.data || [];
        return deletedTransportOrders;
    } catch (e) {
        deletedTransportOrders = [];
        return [];
    }
};

window.bulkDeleteTransports = async function () {
    const ids = [...transportSelection].filter(id => {
        const o = (db.orders || []).find(x => x.id === id);
        return transportCanDelete(o);
    });
    if (!ids.length) {
        showToast('Sélectionnez des transports supprimables (hors Validé/Clôturé)', 'info');
        return;
    }
    if (!confirm(`Déplacer ${ids.length} transport(s) vers la corbeille ?`)) return;

    try {
        const res = await apiFetch('transport-orders/bulk-delete', { method: 'POST', body: { ids } });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            showToast(payload.error || 'Échec de la suppression', 'error');
            return;
        }
        const deleted = payload.deleted?.length || 0;
        const skipped = payload.skipped?.length || 0;
        ids.forEach(id => transportSelection.delete(id));
        showToast(`${deleted} transport(s) supprimé(s)${skipped ? ` — ${skipped} ignoré(s)` : ''}`, skipped ? 'info' : 'success');
        if (typeof fetchAllData === 'function') await fetchAllData();
        router('transports');
    } catch (e) {
        showToast('Erreur serveur', 'error');
    }
};

window.bulkRestoreTransports = async function () {
    const ids = [...transportSelection];
    if (!ids.length) {
        showToast('Sélectionnez des transports à restaurer', 'info');
        return;
    }
    if (!confirm(`Restaurer ${ids.length} transport(s) ?`)) return;

    try {
        const res = await apiFetch('transport-orders/bulk-restore', { method: 'POST', body: { ids } });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            showToast(payload.error || 'Échec de la restauration', 'error');
            return;
        }
        const restored = payload.restored?.length || 0;
        const skipped = payload.skipped?.length || 0;
        ids.forEach(id => transportSelection.delete(id));
        showToast(`${restored} transport(s) restauré(s)${skipped ? ` — ${skipped} ignoré(s)` : ''}`, skipped ? 'info' : 'success');
        await loadDeletedTransports();
        if (typeof fetchAllData === 'function') await fetchAllData();
        router('transports');
    } catch (e) {
        showToast('Erreur serveur', 'error');
    }
};

window.restoreTransport = async function (orderId) {
    if (!confirm('Restaurer ce transport ?')) return;
    try {
        const res = await apiFetch(`transport-orders/${orderId}/restore`, { method: 'POST', body: {} });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            showToast(payload.error || 'Échec de la restauration', 'error');
            return;
        }
        transportSelection.delete(orderId);
        showToast('Transport restauré', 'success');
        await loadDeletedTransports();
        if (typeof fetchAllData === 'function') await fetchAllData();
        router('transports');
    } catch (e) {
        showToast('Erreur serveur', 'error');
    }
};

window.bulkMarkDeliveredTransports = async function () {
    const ids = [...transportSelection].filter(id => {
        const o = (db.orders || []).find(x => x.id === id);
        return o && getTransportBillingOptions(o).some(opt => opt.value === 'delivered');
    });
    if (!ids.length) {
        showToast('Sélectionnez des transports en cours à marquer livrés', 'info');
        return;
    }
    if (!confirm(`Marquer ${ids.length} transport(s) comme livré(s) ?`)) return;

    let ok = 0;
    let failed = 0;
    for (const orderId of ids) {
        try {
            const res = await apiFetch(`transport-orders/${orderId}/status`, { method: 'POST', body: { status: 'Livré' } });
            if (res.ok) {
                ok++;
                transportSelection.delete(orderId);
            } else {
                failed++;
            }
        } catch (e) {
            failed++;
        }
    }

    if (ok) showToast(`${ok} transport(s) marqué(s) livré(s)${failed ? ` — ${failed} échec(s)` : ''}`, failed ? 'info' : 'success');
    else showToast('Échec du changement de statut', 'error');

    if (typeof fetchAllData === 'function') await fetchAllData();
    router('transports');
};

window.bulkValidateTransports = async function () {
    const ids = [...transportSelection].filter(id => {
        const o = (db.orders || []).find(x => x.id === id);
        return o && o.status === 'Livré';
    });
    if (!ids.length) {
        showToast('Sélectionnez des transports livrés à valider', 'info');
        return;
    }
    if (!confirm(`Valider ${ids.length} transport(s) ?`)) return;

    let ok = 0;
    let failed = 0;
    for (const orderId of ids) {
        try {
            const res = await apiFetch(`transport-orders/${orderId}/validate`, { method: 'POST' });
            if (res.ok) {
                ok++;
                transportSelection.delete(orderId);
            } else {
                failed++;
            }
        } catch (e) {
            failed++;
        }
    }

    if (ok) showToast(`${ok} transport(s) validé(s)${failed ? ` — ${failed} échec(s)` : ''}`, failed ? 'info' : 'success');
    else showToast('Échec de la validation', 'error');

    if (typeof fetchAllData === 'function') await fetchAllData();
    router('transports');
};

window.bulkPreinvoiceTransports = async function () {
    const ids = [...transportSelection].filter(id => {
        const o = (db.orders || []).find(x => x.id === id);
        return o && o.status === 'Validé' && !o.invoice_draft_id;
    });
    if (!ids.length) {
        showToast('Sélectionnez des transports validés à préfacturer', 'info');
        return;
    }
    if (!confirm(`Générer ${ids.length} préfacture(s) pour les transports sélectionnés ?`)) return;

    let ok = 0;
    let failed = 0;
    for (const orderId of ids) {
        try {
            const res = await apiFetch(`transport-orders/${orderId}/invoice-draft`, { method: 'POST' });
            if (res.ok) {
                ok++;
                transportSelection.delete(orderId);
            } else {
                failed++;
            }
        } catch (e) {
            failed++;
        }
    }

    if (ok) showToast(`${ok} préfacture(s) créée(s)${failed ? ` — ${failed} échec(s)` : ''}`, failed ? 'info' : 'success');
    else showToast('Échec de la préfacturation', 'error');

    if (typeof fetchAllData === 'function') await fetchAllData();
    router('transports');
};

window.bulkInvoiceTransports = async function () {
    const ids = [...transportSelection].filter(id => {
        const o = (db.orders || []).find(x => x.id === id);
        return o && getTransportBillingOptions(o).some(opt => opt.value === 'invoice');
    });
    if (!ids.length) {
        showToast('Sélectionnez des transports à facturer', 'info');
        return;
    }
    if (ids.length > 1) {
        showToast('Ouvrez les brouillons un par un — sélectionnez un seul transport pour facturer', 'info');
        return;
    }
    await openInvoiceFromTransport(ids[0]);
};

/** Vues en cours / réalisés basées sur orders (MVP) */
window.renderOrdersInProgress = function() {
    const statuses = ['Pris en charge', 'En cours', 'En cours', 'Planifié'];
    let orders = (db.orders || []).filter(o => ['Pris en charge', 'En cours', 'Planifié', 'Affrété'].includes(o.status));
    if (getUserRole() === 'chauffeur' && currentUser?.driver_id) {
        orders = orders.filter(o => o.driver_id === currentUser.driver_id);
    }
    return renderOrdersTable(orders, 'Transports en cours', true);
};

window.renderOrdersCompleted = function() {
    const orders = (db.orders || []).filter(o => ['Livré', 'Validé', 'Clôturé', 'Terminé'].includes(o.status));
    const preinvoiceCandidates = orders.filter(o => o.status === 'Validé' && !o.invoice_draft_id);
    const selectedCount = preinvoiceCandidates.filter(o => completedTransportSelection.has(o.id)).length;
    const allCandidatesSelected = preinvoiceCandidates.length > 0
        && preinvoiceCandidates.every(o => completedTransportSelection.has(o.id));

    const canPreinvoice = typeof canManageFinance === 'function' && canManageFinance();

    return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 fade-in">
        <div class="flex flex-wrap justify-between items-center gap-4 mb-6">
            <div>
                <h3 class="font-bold text-lg text-gray-800">Transports réalisés</h3>
                <p class="text-xs text-gray-500">Transports livrés, validés ou clôturés — sélectionnez les validés à préfacturer</p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <span class="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold">${orders.length} transport(s)</span>
                ${canPreinvoice && preinvoiceCandidates.length ? `
                    <button type="button" onclick="bulkPreinvoiceCompletedTransports()"
                        class="bg-orange-600 text-white px-4 py-2 rounded text-sm font-semibold hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        ${selectedCount === 0 ? 'disabled' : ''}>
                        <i class="fa-solid fa-file-invoice mr-1"></i>Préfacturer la sélection (${selectedCount})
                    </button>
                ` : ''}
            </div>
        </div>
        <table class="w-full text-sm text-left text-gray-500">
            <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                <tr>
                    <th class="px-4 py-3 w-10">
                        ${canPreinvoice && preinvoiceCandidates.length ? `
                            <input type="checkbox" class="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                                ${allCandidatesSelected ? 'checked' : ''}
                                onchange="toggleSelectAllCompletedTransports(this.checked)"
                                title="Tout sélectionner (validés à préfacturer)">
                        ` : ''}
                    </th>
                    <th class="px-4 py-3">Réf.</th>
                    <th class="px-4 py-3">Client</th>
                    <th class="px-4 py-3">Trajet</th>
                    <th class="px-4 py-3">Montant</th>
                    <th class="px-4 py-3">Statut</th>
                    <th class="px-4 py-3">Actions</th>
                </tr>
            </thead>
            <tbody>
                ${orders.length ? orders.map(o => {
        const canSelect = o.status === 'Validé' && !o.invoice_draft_id;
        const isSelected = completedTransportSelection.has(o.id);
        return `
                    <tr class="border-b hover:bg-gray-50 ${isSelected ? 'bg-orange-50/60' : ''}">
                        <td class="px-4 py-3">
                            ${canSelect && canPreinvoice ? `
                                <input type="checkbox" class="completed-transport-checkbox rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                                    data-order-id="${o.id}" ${isSelected ? 'checked' : ''}
                                    onchange="toggleCompletedTransportSelect(${o.id}, this.checked)">
                            ` : ''}
                        </td>
                        <td class="px-4 py-3 font-medium">${o.ref || o.id}</td>
                        <td class="px-4 py-3">${o.client_name || '-'}</td>
                        <td class="px-4 py-3 text-xs">${o.origin} → ${o.dest}</td>
                        <td class="px-4 py-3 font-bold">${Number(o.price || 0).toLocaleString()} €</td>
                        <td class="px-4 py-3">
                            <span class="px-2 py-1 rounded text-xs font-semibold ${getStatusBadgeClass(o.status)}">${o.status}</span>
                            ${o.invoice_draft_id ? `<div class="text-[10px] text-gray-400 mt-1">Préfacture ${o.invoice_draft_id}</div>` : ''}
                        </td>
                        <td class="px-4 py-3 whitespace-nowrap">
                            <button onclick="openTransportDetail(${o.id})" class="text-blue-600 hover:underline text-xs">Détail</button>
                            ${o.status === 'Livré' && typeof canValidateTransport === 'function' && canValidateTransport()
                                ? `<button onclick="validateTransportFromDetail(${o.id})" class="text-green-600 hover:underline text-xs ml-2">Valider</button>`
                                : ''}
                            ${canSelect && canPreinvoice
                                ? `<button onclick="createInvoiceDraftFromTransport(${o.id})" class="text-orange-600 hover:underline text-xs ml-2">Préfacturer</button>`
                                : ''}
                        </td>
                    </tr>`;
    }).join('') : '<tr><td colspan="7" class="px-4 py-10 text-center text-gray-400 italic">Aucun transport réalisé</td></tr>'}
            </tbody>
        </table>
    </div>`;
};

window.toggleCompletedTransportSelect = function (orderId, checked) {
    if (checked) completedTransportSelection.add(orderId);
    else completedTransportSelection.delete(orderId);
    router('completed_transports');
};

window.toggleSelectAllCompletedTransports = function (checked) {
    const candidates = (db.orders || []).filter(o => o.status === 'Validé' && !o.invoice_draft_id);
    if (checked) candidates.forEach(o => completedTransportSelection.add(o.id));
    else candidates.forEach(o => completedTransportSelection.delete(o.id));
    router('completed_transports');
};

window.bulkPreinvoiceCompletedTransports = async function () {
    const ids = [...completedTransportSelection].filter(id => {
        const o = (db.orders || []).find(x => x.id === id);
        return o && o.status === 'Validé' && !o.invoice_draft_id;
    });
    if (!ids.length) {
        showToast('Sélectionnez au moins un transport validé à préfacturer', 'info');
        return;
    }
    if (!confirm(`Générer ${ids.length} préfacture(s) pour les transports sélectionnés ?`)) return;

    let ok = 0;
    let failed = 0;
    for (const orderId of ids) {
        try {
            const res = await apiFetch(`transport-orders/${orderId}/invoice-draft`, { method: 'POST' });
            if (res.ok) {
                ok++;
                completedTransportSelection.delete(orderId);
            } else {
                failed++;
            }
        } catch (e) {
            failed++;
        }
    }

    if (ok) showToast(`${ok} préfacture(s) créée(s)${failed ? ` — ${failed} échec(s)` : ''}`, failed ? 'info' : 'success');
    else showToast('Échec de la préfacturation', 'error');

    await refreshAfterMvpStep({
        step: 'preinvoice',
        route: failed && ok ? 'completed_transports' : 'preinvoicing',
        closeDetail: true,
        reopenDetail: false
    });
};

function renderOrdersTable(orders, title, showActions) {
    return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 fade-in">
        <div class="flex justify-between items-center mb-6">
            <h3 class="font-bold text-lg text-gray-800">${title}</h3>
            <span class="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold">${orders.length}</span>
        </div>
        <table class="w-full text-sm text-left text-gray-500">
            <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                <tr><th class="px-4 py-3">Réf.</th><th class="px-4 py-3">Client</th><th class="px-4 py-3">Trajet</th><th class="px-4 py-3">Statut</th><th class="px-4 py-3">Actions</th></tr>
            </thead>
            <tbody>
                ${orders.length ? orders.map(o => `
                    <tr class="border-b hover:bg-gray-50">
                        <td class="px-4 py-3 font-medium">${o.ref || o.id}</td>
                        <td class="px-4 py-3">${o.client_name || '-'}</td>
                        <td class="px-4 py-3 text-xs">${o.origin} → ${o.dest}</td>
                        <td class="px-4 py-3"><span class="px-2 py-1 rounded text-xs font-semibold ${getStatusBadgeClass(o.status)}">${o.status}</span></td>
                        <td class="px-4 py-3">
                            <button onclick="openTransportDetail(${o.id})" class="text-blue-600 hover:underline text-xs">Détail</button>
                            ${showActions && canChangeTransportStatus() ? `<button onclick="changeTransportStatus(${o.id}, 'Livré', { fromList: true, reopenDetail: false })" class="text-green-600 hover:underline text-xs ml-2">Marquer livré</button>` : ''}
                        </td>
                    </tr>`).join('') : '<tr><td colspan="5" class="px-4 py-10 text-center text-gray-400 italic">Aucun transport</td></tr>'}
            </tbody>
        </table>
    </div>`;
}
