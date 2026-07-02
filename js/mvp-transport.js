/**
 * Transfact MVP — Transport cycle (ordre = TransportOrder)
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
        'Annulé': 'border-l-4 border-red-400'
    };
    return map[status] || 'border-l-4 border-gray-300';
}

let transportFilters = { status: '', search: '' };
let currentTransportDetail = null;

function renderTransportList() {
    let orders = [...(db.orders || [])];
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

    return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 fade-in">
        <div class="flex flex-wrap justify-between items-center gap-4 mb-6">
            <div>
                <h3 class="font-bold text-lg text-gray-800">Transports</h3>
                <p class="text-xs text-gray-500">Cycle MVP : créer → affecter → exécuter → valider → préfacturer</p>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
                <input type="text" id="transport-search" placeholder="Rechercher ref, client, trajet…" value="${transportFilters.search || ''}"
                    oninput="transportFilters.search=this.value; router('transports')"
                    class="border rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                <select id="transport-status-filter" onchange="transportFilters.status=this.value; router('transports')"
                    class="border rounded px-3 py-2 text-sm">${statusOptions}</select>
                ${canWriteTransport() ? `<button onclick="openAddOrderModal()" class="bg-blue-600 text-white px-4 py-2 rounded text-sm shadow hover:bg-blue-700"><i class="fa-solid fa-plus mr-2"></i>Créer un transport</button>` : ''}
            </div>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-sm text-left text-gray-500">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                    <tr>
                        <th class="px-4 py-3">Réf.</th>
                        <th class="px-4 py-3">Client</th>
                        <th class="px-4 py-3">Trajet</th>
                        <th class="px-4 py-3">Dates</th>
                        <th class="px-4 py-3">Chauffeur</th>
                        <th class="px-4 py-3">Statut</th>
                        <th class="px-4 py-3">Montant</th>
                        <th class="px-4 py-3">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${orders.length ? orders.map(o => `
                        <tr class="bg-white border-b hover:bg-gray-50">
                            <td class="px-4 py-3 font-medium text-gray-900">${o.ref || '#' + o.id}</td>
                            <td class="px-4 py-3">${o.client_name || '-'}</td>
                            <td class="px-4 py-3 text-xs">${o.origin || '-'} → ${o.dest || '-'}</td>
                            <td class="px-4 py-3 text-xs">${o.load_date || '-'} / ${o.delivery_date || '-'}</td>
                            <td class="px-4 py-3">${o.driver_name || '-'}</td>
                            <td class="px-4 py-3"><span class="px-2 py-1 rounded text-xs font-semibold ${getStatusBadgeClass(o.status)}">${o.status}</span></td>
                            <td class="px-4 py-3 font-bold">${Number(o.price || 0).toLocaleString()} €</td>
                            <td class="px-4 py-3">
                                <button onclick="openTransportDetail(${o.id})" class="text-blue-600 hover:underline text-xs mr-2">Détail</button>
                                ${canWriteTransport() ? `<button onclick="openEditOrderModal(${o.id})" class="text-gray-500 hover:text-blue-600 text-xs"><i class="fa-solid fa-pen"></i></button>` : ''}
                            </td>
                        </tr>`).join('') : '<tr><td colspan="8" class="px-4 py-10 text-center text-gray-400 italic">Aucun transport</td></tr>'}
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
    document.getElementById('td-client').textContent = t.client_name || '-';
    document.getElementById('td-route').textContent = `${t.origin || '-'} → ${t.dest || '-'}`;
    document.getElementById('td-dates').textContent = `Chargement : ${t.load_date || '-'} | Livraison : ${t.delivery_date || '-'}`;
    document.getElementById('td-driver').textContent = t.driver_name || 'Non assigné';
    const priceEl = document.getElementById('td-price');
    if (getUserRole() === 'chauffeur' || t.price === undefined) {
        priceEl.textContent = '—';
        priceEl.closest('.td-price-row')?.classList.add('hidden');
    } else {
        priceEl.textContent = `${Number(t.price || 0).toLocaleString()} €`;
        priceEl.closest('.td-price-row')?.classList.remove('hidden');
    }

    const historyEl = document.getElementById('td-history');
    historyEl.innerHTML = (t.history || []).map(h => `
        <div class="flex gap-3 text-xs border-b pb-2 mb-2">
            <span class="font-mono text-gray-400">${new Date(h.changed_at).toLocaleString('fr-FR')}</span>
            <span class="font-semibold ${getStatusBadgeClass(h.status)} px-1 rounded">${h.status}</span>
            <span class="text-gray-600">${h.changed_by_name || 'Système'}${h.comment ? ' — ' + h.comment : ''}</span>
        </div>`).join('') || '<p class="text-gray-400 italic text-xs">Aucun historique</p>';

    const docsEl = document.getElementById('td-documents');
    docsEl.innerHTML = (t.documents || []).map(d => `
        <a href="${d.file_url.startsWith('/') ? d.file_url : d.file_url}" target="_blank" class="flex items-center gap-2 text-blue-600 hover:underline text-xs mb-1">
            <i class="fa-solid fa-file-pdf"></i> ${d.file_name} (${d.doc_type})
        </a>`).join('') || '<p class="text-gray-400 italic text-xs">Aucun document</p>';

    const commentsEl = document.getElementById('td-comments');
    commentsEl.innerHTML = (t.comments || []).map(c => `
        <div class="bg-gray-50 rounded p-2 mb-2 text-xs">
            <span class="font-bold text-gray-700">${c.user_name || 'Utilisateur'}</span>
            <span class="text-gray-400 ml-2">${new Date(c.created_at).toLocaleString('fr-FR')}</span>
            <p class="mt-1 text-gray-600">${c.content}</p>
        </div>`).join('') || '<p class="text-gray-400 italic text-xs">Aucun commentaire</p>';

    const actionsEl = document.getElementById('td-actions');
    let actionsHtml = '';
    if (typeof canAssignTransport === 'function' && canAssignTransport()) {
        actionsHtml += `<button onclick="assignTransportFromDetail(${t.id})" class="px-3 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 mr-2"><i class="fa-solid fa-user-check mr-1"></i>Affecter</button>`;
    }
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
    const allowed = typeof getAllowedStatusTransitions === 'function' ? getAllowedStatusTransitions() : [];
    const flow = {
        'Brouillon': ['À planifier', 'Planifié', 'Annulé'],
        'À planifier': ['Pris en charge', 'Planifié', 'Annulé'],
        'Pris en charge': ['En cours', 'Livré'],
        'En cours': ['Livré'],
        'Planifié': ['En cours', 'Pris en charge', 'Annulé'],
        'Livré': getUserRole() === 'admin' ? ['Validé'] : []
    };
    const candidates = flow[current] || [];
    if (getUserRole() === 'admin') return candidates.length ? candidates : allowed;
    return candidates.filter(s => !allowed.length || allowed.includes(s));
}

window.closeTransportDetail = function() {
    document.getElementById('transport-detail-modal').classList.add('hidden');
    currentTransportDetail = null;
};

window.changeTransportStatus = async function(orderId, status) {
    try {
        const res = await apiFetch(`transport-orders/${orderId}/status`, { method: 'POST', body: { status } });
        if (res.ok) {
            showToast(`Statut → ${status}`, 'success');
            await fetchAllData();
            openTransportDetail(orderId);
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Changement de statut refusé', 'error');
        }
    } catch (e) { showToast('Erreur serveur', 'error'); }
};

window.validateTransportFromDetail = async function(orderId) {
    try {
        const res = await apiFetch(`transport-orders/${orderId}/validate`, { method: 'POST' });
        if (res.ok) {
            showToast('Transport validé', 'success');
            await fetchAllData();
            openTransportDetail(orderId);
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Validation impossible', 'error');
        }
    } catch (e) { showToast('Erreur serveur', 'error'); }
};

window.assignTransportFromDetail = async function(orderId) {
    const driverId = prompt('ID chauffeur à affecter (laisser vide si déjà renseigné) :');
    const vehicleId = prompt('ID véhicule (optionnel) :');
    try {
        const body = {};
        if (driverId) body.driver_id = parseInt(driverId, 10);
        if (vehicleId) body.vehicle_id = parseInt(vehicleId, 10);
        const res = await apiFetch(`transport-orders/${orderId}/assign`, { method: 'POST', body });
        if (res.ok) {
            showToast('Transport affecté', 'success');
            await fetchAllData();
            openTransportDetail(orderId);
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

window.createInvoiceDraftFromTransport = async function(orderId) {
    if (!confirm('Générer une préfacture (brouillon) pour ce transport ?')) return;
    try {
        const res = await apiFetch(`transport-orders/${orderId}/invoice-draft`, { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            showToast(`Préfacture ${data.invoice_draft_id} créée`, 'success');
            await fetchAllData();
            closeTransportDetail();
            router('preinvoicing');
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Échec préfacturation', 'error');
        }
    } catch (e) { showToast('Erreur serveur', 'error'); }
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
    return renderOrdersTable(orders, 'Transports réalisés / clôturés', false);
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
                            ${showActions && canChangeTransportStatus() ? `<button onclick="changeTransportStatus(${o.id}, 'Livré')" class="text-green-600 hover:underline text-xs ml-2">Marquer livré</button>` : ''}
                        </td>
                    </tr>`).join('') : '<tr><td colspan="5" class="px-4 py-10 text-center text-gray-400 italic">Aucun transport</td></tr>'}
            </tbody>
        </table>
    </div>`;
}
