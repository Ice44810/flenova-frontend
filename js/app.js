/**
 * Transfact - Application JavaScript
 */

// --- MOCK DATABASE ---
let db = { orders: [], clients: [], missions: [], drivers: [], vehicles: [], users: [], sales_invoices: [], purchase_invoices: [], subcontractors: [] };

let salesChartInstance = null;
let invoiceLines = [];
let currentUser = getCurrentUser();

// Fonction utilitaire pour masquer TOUS les modaux
function hideAllModals() {
    // Empêche des “ré-activations” tardives (setTimeout / handlers de preview facture)
    // de faire réapparaître l’aperçu facture pendant l’ouverture d’un autre modal.
    // Verrou global désactivé à l'ouverture d'autres modals via hideAllModals/openInvoiceModal.
    window.__invoicePreviewLock = true;

    // Sécurité supplémentaire: arrêter tout affichage tardif de facture A4.
    // Certains navigateurs exécutent des callbacks après le changement de modal.
    if (!window.__invoicePreviewSessionId) window.__invoicePreviewSessionId = 0;
    window.__invoicePreviewSessionId++;


    const modalIds = [
        'chart-modal', 'edit-mission-modal', 'add-mission-modal', 'add-client-modal',
        'driver-card-modal', 'driver-modal', 'add-vehicle-modal', 'edit-vehicle-modal',
        'add-purchase-invoice-modal', 'add-user-modal', 'modal-overlay',
        'edit-order-modal', 'add-order-modal', 'add-subcontractor-modal', 'dispatch-modal',
        'invoice-modal'
    ];


    // Invariant: le modal aperçu facture A4 (modal-overlay/modal-content) ne doit jamais être visible
    // lorsque l'utilisateur ouvre un autre modal.
    // On le masque en dur ici, même si un rendu (ex: openInvoiceModal) l'avait réaffiché.
    const invoiceOverlayEl = document.getElementById('modal-overlay');
    if (invoiceOverlayEl) {
        invoiceOverlayEl.classList.add('hidden');
        invoiceOverlayEl.classList.remove('flex', 'items-center', 'justify-center');
    }
    const invoiceContentEl = document.getElementById('modal-content');
    if (invoiceContentEl) {
        invoiceContentEl.classList.add('hidden');
        invoiceContentEl.innerHTML = '';
    }
    modalIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('hidden');
            el.classList.remove('flex'); // Nécessaire car modal-overlay utilise flex pour le centrage
            
            // CRITICAL: Vider le contenu du conteneur générique 'modal-content'
            // pour éviter que l'aperçu de facture ne s'affiche par erreur dans d'autres modaux.
            if (id === 'modal-content') {
                el.innerHTML = '';
            }
            // Réinitialiser la position et le style de drag si ce n'est pas l'overlay lui-même
            if (id !== 'modal-overlay') {
                el.style.top = '';
                el.style.left = '';
                el.style.position = '';
                el.style.margin = '';
                el.style.transform = '';
            }
        }
    });
}

// Fonction pour rendre un élément déplaçable (Draggable)
function makeElementDraggable(el) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    el.onmousedown = function(e) {
        // On ne déplace pas si on clique sur un input, bouton, textarea ou icône
        if (['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'A', 'I'].includes(e.target.tagName) || e.target.closest('button')) return;

        e.preventDefault();
        
        // Capture de la position actuelle pour passer du mode Flex (centré) au mode Fixed (déplaçable) sans saut visuel
        const rect = el.getBoundingClientRect();
        el.style.position = 'fixed';
        el.style.top = rect.top + 'px';
        el.style.left = rect.left + 'px';
        el.style.margin = '0';
        el.style.transform = 'none'; // Désactive le centrage automatique de Tailwind

        pos3 = e.clientX;
        pos4 = e.clientY;

        document.onmouseup = () => {
            document.onmouseup = null;
            document.onmousemove = null;
            el.style.cursor = 'grab';
        };

        document.onmousemove = (e) => {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            el.style.top = (el.offsetTop - pos2) + "px";
            el.style.left = (el.offsetLeft - pos1) + "px";
        };
        el.style.cursor = 'grabbing';
    };
    el.style.cursor = 'grab';
}

// --- BOOTSTRAP ---
(async () => {
    if (!currentUser) {
        // Try to validate session with backend
        try {
            const res = await apiFetch('auth/me');
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.user) {
                    currentUser = data.user;
                    setCurrentUser(data.user);
                } else {
                    throw new Error('No user');
                }
            } else {
                throw new Error('Not authenticated');
            }
        } catch (e) {
            window.location.href = '/login.html';
            return;
        }
    }

    const appScreen = document.getElementById('app-screen');
    if (appScreen) appScreen.classList.remove('hidden');

    hideAllModals();

    const ok = await fetchAllData();
    if (ok) {
        router('dashboard');
    }

    // Rendre les modaux déplaçables après le premier rendu
    const modalsToMakeDraggable = ['edit-mission-modal', 'add-order-modal', 'add-client-modal', 'driver-modal', 'add-vehicle-modal', 'add-purchase-invoice-modal', 'add-user-modal', 'dispatch-modal', 'add-subcontractor-modal'];
    modalsToMakeDraggable.forEach(id => {
        const el = document.getElementById(id);
        if (el) makeElementDraggable(el);
    });
})();

// --- DASHBOARD STATE ---
window.activeDashboardTab = 'general';
window.dashboardFilters = { startDate: null, endDate: null };
window.switchDashboardTab = function(tab) {
    destroyAllChartInstances();
    window.activeDashboardTab = tab;
    router('dashboard');
};

// --- PLANNING STATE ---
window.planningDate = new Date();
window.changePlanningWeek = function(offset) {
    const d = new Date(window.planningDate);
    d.setDate(d.getDate() + (offset * 7));
    window.planningDate = d;
    router('planning');
};

async function fetchAllData() {
    try {
        const fetchJson = async (url) => {
            const res = await apiFetch(url);
            const data = await res.json();
            // Gère les tableaux bruts ou les réponses enveloppées { data: [...] } ou { orders: [...] }
            if (Array.isArray(data)) return data;
            if (data.data && Array.isArray(data.data)) return data.data;
            
            // Tente de trouver une clé correspondant à la ressource (ex: "orders" pour la route 'orders')
            const resourceKey = url.split('/')[0].replace('-', '_');
            return (data[resourceKey] && Array.isArray(data[resourceKey])) ? data[resourceKey] : [];
        };
        const [orders, clients, missions, drivers, vehicles, users, sales, purchase, subcontractors] = await Promise.all([
            fetchJson('orders'),
            fetchJson('clients'),
            fetchJson('missions'),
            fetchJson('drivers'),
            fetchJson('vehicles'),
            fetchJson('users'),
            fetchJson('sales-invoices'),
            fetchJson('purchase-invoices'),
            fetchJson('subcontractors')
        ]);
        db = { orders, clients, missions, drivers, vehicles, users, sales_invoices: sales, purchase_invoices: purchase, subcontractors };
        return true;
    } catch (error) {
        showToast("Erreur de connexion au serveur", "error");
        return false;
    }
}

// Helper function to check if current user is admin
function isAdmin() {
    return currentUser && currentUser.role === 'admin';
}

// Helper function to check if user has access to invoice functions
function canManageInvoices() {
    return currentUser && currentUser.role === 'admin';
}

// Function to toggle all invoice checkboxes
function toggleSelectAllInvoices(masterCheckbox) {
    const checkboxes = document.querySelectorAll('.invoice-checkbox');
    checkboxes.forEach(cb => cb.checked = masterCheckbox.checked);
}

// Function to delete selected sales invoices
async function deleteSelectedInvoices() {
    if (!canManageInvoices()) {
        showToast("Vous n'avez pas l'autorisation de supprimer des factures.", "error");
        return;
    }
    const selectedIds = Array.from(document.querySelectorAll('.invoice-checkbox:checked'))
        .map(cb => cb.value);
    if (selectedIds.length === 0) {
        showToast("Veuillez sélectionner au moins une facture à supprimer.", "info");
        return;
    }
    if (confirm(`Êtes-vous sûr de vouloir supprimer ${selectedIds.length} facture(s) ?`)) {
        await apiFetch('sales-invoices/bulk-delete', { method: 'POST', body: { ids: selectedIds } });
        await fetchAllData();
        showToast(`${selectedIds.length} facture(s) supprimée(s).`, "success");
        router('sales_invoices');
    }
}

// --- RENDERERS ---

function renderDashboard(stats = {}) {
    const activeTab = window.activeDashboardTab || 'general';
    
    // Tab Headers
    const tabsHtml = `
        <div class="flex gap-1 border-b border-gray-200">
            <button onclick="window.switchDashboardTab('general')" class="px-6 py-2 ${activeTab === 'general' ? 'bg-gray-100 border-t-2 border-blue-500 font-bold text-blue-600' : 'text-gray-400 font-bold hover:bg-gray-50'} text-xs uppercase tracking-wider">Général</button>
            <button onclick="window.switchDashboardTab('quotations')" class="px-6 py-2 ${activeTab === 'quotations' ? 'bg-gray-100 border-t-2 border-blue-500 font-bold text-blue-600' : 'text-gray-400 font-bold hover:bg-gray-50'} text-xs uppercase tracking-wider">Cotations</button>
            <button onclick="window.switchDashboardTab('invoicing')" class="px-6 py-2 ${activeTab === 'invoicing' ? 'bg-gray-100 border-t-2 border-blue-500 font-bold text-blue-600' : 'text-gray-400 font-bold hover:bg-gray-50'} text-xs uppercase tracking-wider">Facturation</button>
        </div>
    `;

    let tabContent = '';
    
    if (activeTab === 'general') {
        tabContent = `
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-gray-700">${stats.totalExpeditions || 0}</h3>
                <p class="text-gray-400 text-sm">Expéditions</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center relative">
                <h3 class="text-3xl font-bold text-gray-700">${Number(stats.totalRevenue || 0).toLocaleString()} €</h3>
                <p class="text-gray-400 text-sm">Chiffre d'Affaires</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-gray-700">${Number(stats.totalExpenses || 0).toLocaleString()} €</h3>
                <p class="text-gray-400 text-sm">Dépenses</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-gray-700">${Number(stats.totalSavings || 0).toLocaleString()} €</h3>
                <p class="text-gray-400 text-sm">Économies réalisées</p>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h4 class="text-center font-bold text-gray-700 mb-4">Analyse du Chiffre d'Affaires</h4>
                <div class="h-64"><canvas id="revenueEvolutionChart"></canvas></div>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h4 class="text-center font-bold text-gray-700 mb-4">Répartition des Coûts (Propre vs Affrètement)</h4>
                <div class="h-64"><canvas id="costBreakdownChart"></canvas></div>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h4 class="text-center font-bold text-gray-700 mb-4">Performance Géographique (Destinations)</h4>
                <div class="h-64"><canvas id="geoPerformanceChart"></canvas></div>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h4 class="text-center font-bold text-gray-700 mb-4">Taux de Remplissage Flotte</h4>
                <div class="h-64 relative">
                    <canvas id="donutCapacity"></canvas>
                    <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span id="capacity-text" class="text-2xl font-bold text-blue-600 mt-2">0%</span>
                    </div>
                </div>
            </div>
        </div>`;
    } else if (activeTab === 'quotations') {
        tabContent = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-gray-700">${stats.totalQuotations || 0}</h3>
                <p class="text-gray-400 text-sm">Cotations totales</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 id="conversion-rate-kpi" class="text-3xl font-bold text-blue-600">-- %</h3>
                <p class="text-gray-400 text-sm">Taux de Conversion</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-gray-700">${stats.avgQuotationTime || '--:--:--'}</h3>
                <p class="text-gray-400 text-sm">Délai moyen</p>
            </div>
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h4 class="text-center font-bold text-gray-700 mb-4">Répartition des Statuts de Cotations</h4>
            <div class="h-80"><canvas id="quotationConversionChart"></canvas></div>
        </div>`;
    } else if (activeTab === 'invoicing') {
        const totalInvoiced = db.sales_invoices.reduce((acc, inv) => acc + inv.amount, 0);
        const pendingValidation = db.sales_invoices.filter(inv => inv.status === 'En attente').length;
        const outstanding = db.sales_invoices.filter(inv => inv.status !== 'Payée').reduce((acc, inv) => acc + inv.amount, 0);
        
        tabContent = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-gray-700">${Number(totalInvoiced).toLocaleString()} €</h3>
                <p class="text-gray-400 text-sm">Montant total facturé</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-orange-600">${pendingValidation}</h3>
                <p class="text-gray-400 text-sm">Factures en attente validation</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-red-600">${Number(outstanding).toLocaleString()} €</h3>
                <p class="text-gray-400 text-sm">Encours Clients</p>
            </div>
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h4 class="text-center font-bold text-gray-700 mb-4">Répartition des règlements</h4>
            <div class="h-80"><canvas id="invoicingStatusChart"></canvas></div>
        </div>`;
    }

    return `
    <div class="fade-in">
        <div class="mb-6 flex flex-col gap-4">
            <div class="flex flex-wrap items-center gap-2 bg-white p-3 rounded-lg shadow-sm border border-gray-100">
                <button class="bg-cyan-500 text-white px-4 py-2 rounded flex items-center gap-2 text-sm font-medium">
                    <i class="fa-solid fa-filter"></i> Filtre avancé
                </button>
                <div class="h-8 w-px bg-gray-200 mx-2"></div>
                <div class="flex-1"></div>
                <input type="text" value="2022-12-01 - 2023-12-31" class="border rounded px-3 py-1 text-sm text-gray-600">
            </div>
            ${tabsHtml}
        </div>
        ${tabContent}

        <div class="mt-6 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 class="font-bold text-gray-800 mb-4">Accès Rapide</h3>
            <div class="flex gap-4">
                <button onclick="router('quotation')" class="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"><i class="fa-solid fa-calculator mr-2"></i>Calculateur Cotation</button>
                ${canManageInvoices() ? `<button onclick="router('create_invoice')" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"><i class="fa-solid fa-plus mr-2"></i>Nouvelle Facture</button>` : ''}
                <button onclick="router('completed_transports')" class="bg-white border text-gray-700 px-4 py-2 rounded hover:bg-gray-50"><i class="fa-solid fa-truck mr-2"></i>Transports Réalisés</button>
            </div>
            <div class="mt-4 text-xs text-gray-400"><i class="fa-solid fa-leaf mr-1 text-green-500"></i> Émissions CO2 estimées : <strong>${stats.totalCO2 || 0} kg</strong></div>
        </div>
    </div>`;
}

function renderCompletedTransports() {
    const completedMissions = db.missions.filter(m => m.status === 'Terminé');
    return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 fade-in">
        <div class="flex justify-between items-center mb-6">
            <h3 class="font-bold text-lg text-gray-800">Transports Réalisés</h3>
            <input type="text" placeholder="Rechercher..." class="border rounded px-3 py-1 text-sm focus:outline-none focus:border-blue-500">
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-sm text-left text-gray-500">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                    <tr><th class="px-4 py-3">N° Mission</th><th class="px-4 py-3">Client</th><th class="px-4 py-3">Trajet</th><th class="px-4 py-3">Date</th><th class="px-4 py-3">Heure</th><th class="px-4 py-3">Montant</th><th class="px-4 py-3">Actions</th></tr>
                </thead>
                <tbody>
                    ${completedMissions.map(m => {
                        const client = db.clients.find(c => c.id === m.client_id);
                        return `<tr class="bg-white border-b hover:bg-gray-50">
                            <td class="px-4 py-3 font-medium text-gray-900">#${m.id}</td>
                            <td class="px-4 py-3">${client ? client.name : '-'}</td>
                            <td class="px-4 py-3">${m.origin} → ${m.dest}</td>
                            <td class="px-4 py-3">${m.date}</td>
                            <td class="px-4 py-3">${m.delivery_time || '-'}</td>
                            <td class="px-4 py-3 font-bold text-gray-700">${m.price} €</td>
                            <td class="px-4 py-3"><button onclick="createInvoiceFromMission(${m.id})" class="text-blue-600 hover:underline text-xs"><i class="fa-solid fa-file-invoice mr-1"></i>Facturer</button></td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>`;
}

function renderInProgressTransports() {
    const inProgressMissions = db.missions.filter(m => m.status === 'En cours');
    return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 fade-in">
        <div class="flex justify-between items-center mb-6">
            <div>
                <h3 class="font-bold text-lg text-gray-800">Transports En cours</h3>
                <p class="text-xs text-gray-500">Missions acceptées par les chauffeurs (Mobile)</p>
            </div>
            <div class="flex gap-2">
                <span class="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold self-center">${inProgressMissions.length} actif(s)</span>
                <input type="text" placeholder="Rechercher..." class="border rounded px-3 py-1 text-sm focus:outline-none focus:border-blue-500">
            </div>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-sm text-left text-gray-500">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                    <tr>
                        <th class="px-4 py-3">Mission</th>
                        <th class="px-4 py-3">Client</th>
                        <th class="px-4 py-3">Chauffeur / Véhicule</th>
                        <th class="px-4 py-3">Trajet</th>
                        <th class="px-4 py-3">H. Prévue</th>
                        <th class="px-4 py-3">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${inProgressMissions.length > 0 ? inProgressMissions.map(m => {
                        return `<tr class="bg-white border-b hover:bg-gray-50">
                            <td class="px-4 py-3 font-medium text-gray-900">#${m.id}</td>
                            <td class="px-4 py-3">${m.client_name || '-'}</td>
                            <td class="px-4 py-3">
                                <div class="font-medium text-gray-800">${m.driver_name || 'Non assigné'}</div>
                                <div class="text-[10px] text-gray-400">${m.vehicle_plate || 'Sans véhicule'}</div>
                            </td>
                            <td class="px-4 py-3 text-xs">${m.origin} <i class="fa-solid fa-arrow-right mx-1 text-blue-400"></i> ${m.dest}</td>
                            <td class="px-4 py-3 text-blue-600 font-bold animate-pulse">${m.delivery_time || '-'}</td>
                            <td class="px-4 py-3 flex gap-3">
                                <button onclick="finishMission(${m.id})" class="text-green-600 hover:text-green-800 font-bold text-xs"><i class="fa-solid fa-check-double mr-1"></i>Terminer</button>
                                <button onclick="openEditMissionModal(${m.id})" class="text-gray-400 hover:text-blue-600 text-xs"><i class="fa-solid fa-gear"></i></button>
                            </td>
                        </tr>`;
                    }).join('') : '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-400 italic">Aucun chauffeur n\'a de mission en cours actuellement</td></tr>'}
                </tbody>
            </table>
        </div>
    </div>`;
}

async function finishMission(missionId) {
    if (!confirm("Voulez-vous marquer cette mission comme terminée ? Elle pourra ensuite être facturée.")) return;
    const mission = db.missions.find(m => m.id === missionId);
    if (mission) {
        const updatedMission = { ...mission, status: 'Terminé' };
        await apiFetch(`missions/${missionId}`, { method: 'PUT', body: updatedMission });
        await fetchAllData();
        showToast("Mission terminée avec succès", "success");
        router('inprogress_transports');
    }
}
window.finishMission = finishMission;

function createInvoiceFromMission(missionId) {
    const mission = db.missions.find(m => m.id === missionId);
    if (mission) {
        router('create_invoice');
        setTimeout(() => {
            const clientSelect = document.getElementById('create-invoice-client');
            if (clientSelect) clientSelect.value = mission.client_id;
            const descInput = document.getElementById('create-invoice-desc');
            if (descInput) descInput.value = `Transport ${mission.origin} → ${mission.dest}`;
            const priceInput = document.getElementById('create-invoice-price');
            if (priceInput) priceInput.value = mission.price;
            showToast("Informations de la mission importées", "success");
        }, 100);
    }
}

function renderPlanning() {
    const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    const now = new Date();

    // Calcul de la plage de la semaine affichée (Lundi à Dimanche)
    const current = new Date(window.planningDate);
    const day = current.getDay();
    const diff = current.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(current.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    // Filtrage des commandes pour la semaine sélectionnée uniquement
    const weekMissions = db.orders.filter(o => {
        const loadDate = o.load_date || o.date_chargement;
        if (!loadDate) return false;
        const dObj = new Date(loadDate);
        return dObj >= monday && dObj <= sunday;
    }).map(o => {
        const loadDate = o.load_date || o.date_chargement;
        const dateObj = new Date(loadDate);
        const dayIndex = dateObj.getDay();
        let dayName = days[dayIndex === 0 ? 6 : dayIndex - 1];
        return { ...o, day: dayName };
    });

    const getStatusColor = (s) => { if (s === 'Planifié') return 'border-l-4 border-gray-400'; if (s === 'En cours') return 'border-l-4 border-blue-500'; if (s === 'Terminé') return 'border-l-4 border-green-500'; if (s === 'Annulé') return 'border-l-4 border-red-400'; return ''; };
    
    // Calcul du numéro de semaine ISO
    const getISOWeek = (date) => {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    };
    const weekNum = getISOWeek(monday);
    
    return `<div class="h-full flex flex-col fade-in">
        <div class="flex justify-between items-center mb-4">
            <div class="flex items-center gap-4">
                <button onclick="changePlanningWeek(-1)" class="p-2 bg-white rounded shadow hover:text-blue-600"><i class="fa-solid fa-chevron-left"></i></button>
                <span class="font-bold text-gray-700 self-center text-lg">Semaine ${weekNum} - ${monday.getFullYear()}</span>
                <button onclick="changePlanningWeek(1)" class="p-2 bg-white rounded shadow hover:text-blue-600"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
            <button onclick="openAddOrderModal()" class="bg-blue-600 text-white px-4 py-2 rounded text-sm shadow hover:bg-blue-700"><i class="fa-solid fa-plus mr-2"></i>Nouvelle Commande</button>
        </div>
        <div class="flex-1 overflow-x-auto bg-white rounded-xl shadow-sm border border-gray-200">
            <div class="min-w-[1200px] flex h-full">
                ${days.map(day => {
                    const dayMissions = weekMissions.filter(m => m.day === day);
                    const isToday = day === days[now.getDay() === 0 ? 6 : now.getDay() - 1];
                    return `<div class="flex-1 flex flex-col h-full min-w-[150px] ${isToday ? 'bg-blue-50' : ''}">
                        <div class="p-3 text-center border-b font-semibold text-sm text-gray-600 ${isToday ? 'bg-blue-100 text-blue-700' : ''}">${day}</div>
                        <div class="p-2 space-y-2 flex-1 overflow-y-auto">
                            ${dayMissions.length > 0 ? dayMissions.map(m => `<div class="bg-white p-3 rounded shadow-sm border border-gray-100 text-xs ${getStatusColor(m.status)} hover:shadow-md transition cursor-pointer relative group" onclick="openEditOrderModal(${m.id})">
                                <div class="font-bold text-gray-800 mb-1">#${m.ref || m.id}</div>
                                <div class="text-gray-500 truncate text-[10px]">${m.origin} <i class="fa-solid fa-arrow-right mx-1"></i> ${m.dest}</div>
                                <div class="mt-1 text-xs text-gray-400"><i class="fa-regular fa-clock mr-1"></i>${m.delivery_date || '--/--'}</div>
                                <div class="mt-2 flex justify-between items-center">
                                    <span class="bg-gray-100 px-1 rounded text-[10px]">${m.price}€</span>
                                    <span class="text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition"><i class="fa-solid fa-pencil"></i> Modifier</span>
                                </div>
                            </div>`).join('') : '<div class="h-full min-h-[100px] border-2 border-dashed border-gray-200 rounded flex items-center justify-center text-gray-300 text-xs">Disponible</div>'}
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>
    </div>`;
}

function renderClients() {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const days = Math.floor((now - startOfYear) / (24 * 60 * 60 * 1000));
    const weekNum = Math.ceil((days + startOfYear.getDay() + 1) / 7);
    
    return `<div class="h-full flex flex-col fade-in">
        <div class="flex justify-between items-center mb-4">
        <div class="flex items-center gap-4">
        <h3 class="font-bold text-lg mb-4 text-gray-800">Gestion des Clients</h3>
        </div>
            <button onclick="openAddClientModal()" class="bg-blue-600 text-white px-4 py-2 rounded text-sm shadow hover:bg-blue-700"><i class="fa-solid fa-plus mr-2"></i>Nouveau Client</button>
        </div>
        <div class="flex-1 overflow-x-auto bg-white rounded-xl shadow-sm border border-gray-200">
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left text-gray-500">
                    <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                        <tr><th class="px-4 py-3">Client</th><th class="px-4 py-3">Email</th><th class="px-4 py-3">Téléphone</th><th class="px-4 py-3">Adresse</th><th class="px-4 py-3">Actions</th></tr>
                    </thead>
                    <tbody>
                        ${db.clients.map(c => `<tr class="bg-white border-b hover:bg-gray-50">
                            <td class="px-4 py-3 font-medium text-gray-900">${c.name}</td>
                            <td class="px-4 py-3">${c.email}</td>
                            <td class="px-4 py-3">${c.phone}</td>
                            <td class="px-4 py-3">${c.address}</td>
                            <td class="px-4 py-3"><button onclick="openEditClientModal(${c.id})" class="text-blue-600 hover:underline">Éditer</button></td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    </div>`;
}

function renderSubcontractors() {
    return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 fade-in">
        <div class="flex justify-between items-center mb-6">
            <h3 class="font-bold text-lg text-gray-800">Gestion des Sous-traitants</h3>
            <button onclick="openAddSubcontractorModal()" class="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"><i class="fa-solid fa-plus"></i> Nouveau</button>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-sm text-left text-gray-500">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                    <tr><th class="px-4 py-3">Sous-traitant</th><th class="px-4 py-3">SIRET</th><th class="px-4 py-3">RC Pro</th><th class="px-4 py-3">URSSAF</th><th class="px-4 py-3">Statut</th><th class="px-4 py-3">Actions</th></tr>
                </thead>
                <tbody>
                    ${(Array.isArray(db.subcontractors) ? db.subcontractors : []).map(s => {
                        const rcStatus = s.rc_pro_status === 'EXPIRED' ? 'text-red-600 bg-red-100' : (s.rc_pro_status === 'VALID' ? 'text-green-600 bg-green-100' : 'text-gray-400 bg-gray-100');
                        const statusClass = s.status === 'ACTIF' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
                        return `<tr class="bg-white border-b hover:bg-gray-50">
                            <td class="px-4 py-3 font-medium text-gray-900">${s.name}</td>
                            <td class="px-4 py-3 font-mono text-xs">${s.siret || '-'}</td>
                            <td class="px-4 py-3">
                                <span class="${rcStatus} px-2 py-1 rounded text-xs font-semibold block mb-1">${s.rc_pro_expiry || 'N/A'}</span>
                                ${s.insurance_doc_url ? `<a href="${s.insurance_doc_url}" target="_blank" class="text-blue-500 text-[10px] hover:underline flex items-center gap-1"><i class="fa-solid fa-file-pdf"></i> Voir document</a>` : ''}
                            </td>
                            <td class="px-4 py-3">${s.urssaf_expiry || '-'}</td>
                            <td class="px-4 py-3"><span class="${statusClass} px-2 py-1 rounded text-xs font-semibold">${s.status}</span></td>
                            <td class="px-4 py-3">
                                <button onclick="openEditSubcontractorModal(${s.id})" class="text-blue-600 hover:underline mr-3"><i class="fa-solid fa-pen-to-square mr-1"></i>Éditer</button>
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>
    </div>`;
}

function renderMarginDashboard() {
    return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 fade-in">
        <h3 class="font-bold text-lg text-gray-800 mb-6">Analyse des Marges - Sous-traitance</h3>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
            <div class="bg-blue-50 p-4 rounded-lg text-center">
                <p class="text-gray-500 text-sm">Commandes sous-traitées</p>
                <p class="text-2xl font-bold text-blue-600" id="margin-total-orders">--</p>
            </div>
            <div class="bg-green-50 p-4 rounded-lg text-center">
                <p class="text-gray-500 text-sm">Chiffre d'affaires</p>
                <p class="text-2xl font-bold text-green-600" id="margin-total-sale">--€</p>
            </div>
            <div class="bg-orange-50 p-4 rounded-lg text-center">
                <p class="text-gray-500 text-sm">Coût sous-traitance</p>
                <p class="text-2xl font-bold text-orange-600" id="margin-total-cost">--€</p>
            </div>
            <div class="bg-purple-50 p-4 rounded-lg text-center">
                <p class="text-gray-500 text-sm">Marge brute</p>
                <p class="text-2xl font-bold text-purple-600" id="margin-total-margin">--€</p>
                <p class="text-xs text-purple-500" id="margin-avg-percent">--%</p>
            </div>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-sm text-left text-gray-500">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                    <tr><th class="px-4 py-3">Sous-traitant</th><th class="px-4 py-3">NB Orders</th><th class="px-4 py-3">Prix Vente</th><th class="px-4 py-3">Prix Achat</th><th class="px-4 py-3">Marge €</th><th class="px-4 py-3">Marge %</th></tr>
                </thead>
                <tbody id="margin-by-subcontractor">
                    <tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">Chargement...</td></tr>
                </tbody>
            </table>
        </div>
    </div>`;
}

function updateMarginDashboard(data) {
    if (!data || !data.summary) return;
    
    document.getElementById('margin-total-orders').textContent = data.summary.totalOrders || 0;
    document.getElementById('margin-total-sale').textContent = (data.summary.totalSale || 0).toLocaleString() + '€';
    document.getElementById('margin-total-cost').textContent = (data.summary.totalCost || 0).toLocaleString() + '€';
    document.getElementById('margin-total-margin').textContent = (data.summary.totalMargin || 0).toLocaleString() + '€';
    document.getElementById('margin-avg-percent').textContent = (data.summary.avgMarginPercent || 0).toFixed(1) + '%';
    
    if (data.bySubcontractor && data.bySubcontractor.length > 0) {
        const rows = data.bySubcontractor.map(item => {
            const marginPercent = item.saleTotal > 0 ? ((item.margin / item.saleTotal) * 100).toFixed(1) : 0;
            return `<tr class="border-b hover:bg-gray-50">
                <td class="px-4 py-3 font-medium">${item.name}</td>
                <td class="px-4 py-3">${item.orderCount}</td>
                <td class="px-4 py-3 text-green-600">${item.saleTotal.toLocaleString()}€</td>
                <td class="px-4 py-3 text-orange-600">${item.costTotal.toLocaleString()}€</td>
                <td class="px-4 py-3 font-bold ${item.margin >= 0 ? 'text-green-600' : 'text-red-600'}">${item.margin.toLocaleString()}€</td>
                <td class="px-4 py-3 font-bold ${item.margin >= 0 ? 'text-green-600' : 'text-red-600'}">${marginPercent}%</td>
            </tr>`;
        }).join('');
        document.getElementById('margin-by-subcontractor').innerHTML = rows;
    } else {
        document.getElementById('margin-by-subcontractor').innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">Aucune donnée</td></tr>';
    }
}

function renderDrivers() {
    return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 fade-in">
        <div class="flex justify-between items-center mb-6">
            <h3 class="font-bold text-lg text-gray-800">Gestion des Chauffeurs</h3>
            <button onclick="openAddDriverModal()" class="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"><i class="fa-solid fa-plus"></i> Nouveau</button>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-sm text-left text-gray-500">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                    <tr><th class="px-4 py-3">Chauffeur</th><th class="px-4 py-3">Contact</th><th class="px-4 py-3">Permis</th><th class="px-4 py-3">Statut</th><th class="px-4 py-3">Actions</th></tr>
                </thead>
                <tbody>
                    ${(Array.isArray(db.drivers) ? db.drivers : []).map(d => {
                        const statusColor = d.status === 'Disponible' ? 'text-green-600' : 'text-blue-600';
                        const statusBg = d.status === 'Disponible' ? 'bg-green-100' : 'bg-blue-100';
                        return `<tr class="bg-white border-b hover:bg-gray-50">
                            <td class="px-4 py-3 font-medium text-gray-900 flex items-center gap-2">
                                <div class="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-500">
                                    ${d.name ? d.name.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase() : '?'}
                                </div>
                                ${d.name || 'N/A'}
                            </td>
                            <td class="px-4 py-3">${d.phone}</td>
                            <td class="px-4 py-3"><span class="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs font-bold">${d.license}</span></td>
                            <td class="px-4 py-3"><span class="${statusBg} ${statusColor} px-2 py-1 rounded-full text-xs font-semibold">${d.status}</span></td>
                            <td class="px-4 py-3">
                                <button onclick="openEditDriverModal(${d.id})" class="text-blue-600 hover:underline mr-3"><i class="fa-solid fa-pen-to-square mr-1"></i>Éditer</button>
                                <button onclick="openDriverCardModal(${d.id})" class="text-gray-400 hover:underline"><i class="fa-solid fa-id-card mr-1"></i>Fiche</button>
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>`;
}

function renderFleet() {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const days = Math.floor((now - startOfYear) / (24 * 60 * 60 * 1000));
    const weekNum = Math.ceil((days + startOfYear.getDay() + 1) / 7);
    
    return `<div class="h-full flex flex-col fade-in">
        <div class="flex justify-between items-center mb-4">
            <div class="flex items-center gap-4">
                <h3 class="font-bold text-lg mb-4 text-gray-800">Gestion des Véhicules</h3>
            </div>
            <button onclick="openAddVehicleModal()" class="bg-blue-600 text-white px-4 py-2 rounded text-sm shadow hover:bg-blue-700"><i class="fa-solid fa-plus mr-2"></i>Ajouter Camion</button>
        </div>
        <div class="flex-1 overflow-x-auto bg-white rounded-xl shadow-sm border border-gray-200">
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
                ${(Array.isArray(db.vehicles) ? db.vehicles : []).map(v => {
                    const statusColor = v.status === 'Disponible' ? 'border-green-500' : (v.status === 'Garage' ? 'border-red-500' : 'border-blue-500');
                    return `<div onclick="openEditVehicleModal(${v.id})" class="border rounded-xl p-5 hover:shadow-md transition relative overflow-hidden cursor-pointer">
                        <div class="absolute top-0 left-0 w-full h-1 ${statusColor}"></div>
                        <div class="flex justify-between items-start mb-4">
                            <div><h4 class="font-bold text-gray-800">${v.plate}</h4><p class="text-xs text-gray-500">${v.model}</p></div>
                            <span class="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs font-bold uppercase">${v.status}</span>
                        </div>
                        <div class="space-y-3 text-sm">
                            <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-500">Chauffeur</span><span class="font-medium">${v.driver_name || '<span class="text-gray-400">Aucun</span>'}</span></div>
                            <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-500">Maintenance</span><span class="font-medium">${v.next_maintenance}</span></div>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>
    </div>`;
}

function renderPurchaseInvoices() {
    const canManage = canManageInvoices();
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const days = Math.floor((now - startOfYear) / (24 * 60 * 60 * 1000));
    const weekNum = Math.ceil((days + startOfYear.getDay() + 1) / 7);

    return `<div class="h-full flex flex-col fade-in">
        <div class="flex justify-between items-center mb-4">
            <div class="flex items-center gap-4">
               <h3 class="font-bold text-lg mb-4 text-gray-800">Gestion des Factures de Achats</h3>
            </div>
            ${canManage ? `<button onclick="openAddPurchaseInvoiceModal()" class="bg-blue-600 text-white px-4 py-2 rounded text-sm shadow hover:bg-blue-700"><i class="fa-solid fa-plus mr-2"></i>Ajouter une facture</button>` : `<span class="text-sm text-gray-500 bg-gray-100 px-3 py-2 rounded"><i class="fa-solid fa-lock mr-2"></i>Lecture seule</span>`}
        </div>
        <div class="flex-1 overflow-x-auto bg-white rounded-xl shadow-sm border border-gray-200">
            <table class="w-full text-sm text-left text-gray-500">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                    <tr><th class="px-4 py-3">N° Pièce</th><th class="px-4 py-3">Fournisseur</th><th class="px-4 py-3">Type</th><th class="px-4 py-3">Montant TTC</th><th class="px-4 py-3">Statut</th></tr>
                </thead>
                <tbody>
                    ${db.purchase_invoices.map(inv => `<tr class="bg-white border-b hover:bg-gray-50">
                        <td class="px-4 py-3 font-medium text-gray-900">${inv.id}</td>
                        <td class="px-4 py-3">${inv.supplier}</td>
                        <td class="px-4 py-3">${inv.type}</td>
                        <td class="px-4 py-3 font-bold text-gray-700">-${inv.amount.toLocaleString()} €</td>
                        <td class="px-4 py-3"><span class="${inv.status === 'Payée' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'} px-2 py-1 rounded text-xs font-semibold">${inv.status}</span></td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>
    </div>`;
}

function renderSalesInvoices() {
    const canManage = canManageInvoices();
    return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 fade-in">
        <div class="flex justify-between items-center mb-6">
            <h3 class="font-bold text-lg text-gray-800">Factures de Ventes</h3>
            <div class="flex gap-2">
                ${canManage ? `
                <button onclick="deleteSelectedInvoices()" class="bg-red-500 text-white px-3 py-1 rounded text-sm hover:bg-red-600">
                    <i class="fa-solid fa-trash mr-1"></i> Supprimer sélection
                </button>
                <button onclick="router('create_invoice')" class="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700">
                    <i class="fa-solid fa-plus mr-1"></i> Créer une facture
                </button>
                <button onclick="router('invoice_settings')" class="bg-gray-100 border text-gray-600 px-3 py-1 rounded text-sm hover:bg-gray-200">
                    <i class="fa-solid fa-gear mr-1"></i> Paramètres
                </button>` : ''}
            </div>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-sm text-left text-gray-500">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                    <tr>
                        <th class="px-4 py-3"><input type="checkbox" onchange="toggleSelectAllInvoices(this)"></th>
                        <th class="px-4 py-3">N° Facture</th>
                        <th class="px-4 py-3">Client</th>
                        <th class="px-4 py-3">Date</th>
                        <th class="px-4 py-3">Montant TTC</th>
                        <th class="px-4 py-3">Statut</th>
                        <th class="px-4 py-3">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${db.sales_invoices.map(inv => {
                        const client = db.clients.find(c => c.id === inv.client_id);
                        return `<tr class="bg-white border-b hover:bg-gray-50">
                            <td class="px-4 py-3"><input type="checkbox" class="invoice-checkbox" value="${inv.id}"></td>
                            <td class="px-4 py-3 font-medium text-gray-900">${inv.id}</td>
                            <td class="px-4 py-3">${client ? client.name : '-'}</td>
                            <td class="px-4 py-3">${inv.date}</td>
                            <td class="px-4 py-3 font-bold text-gray-700">${inv.amount.toLocaleString()} €</td>
                            <td class="px-4 py-3">
                                <span class="px-2 py-1 rounded text-xs font-semibold ${
                                    inv.status === 'Payée' ? 'bg-green-100 text-green-800' : 
                                    inv.status === 'Brouillon' ? 'bg-gray-100 text-gray-800' : 'bg-orange-100 text-orange-800'
                                }">${inv.status}</span>
                            </td>
                            <td class="px-4 py-3">
                                <button onclick="openInvoiceModal('${inv.id}')" class="text-blue-600 hover:underline mr-2">Voir</button>
                                ${inv.status !== 'Payée' && canManage ? `<button onclick="relanceFacture('${inv.id}')" class="text-orange-600 hover:underline">Relancer</button>` : ''}
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>
    </div>`;
}

function renderSettingInvoices() {
    return `<div class="max-w-4xl mx-auto bg-white rounded-xl shadow-sm border border-gray-100 p-8 fade-in">
        <h2 class="text-2xl font-bold text-gray-800 mb-6">Personnalisation des Factures</h2>
        
        <form onsubmit="saveInvoiceSettings(event)" class="space-y-8">
            <div>
                <h3 class="font-bold text-gray-700 mb-4 border-b pb-2 uppercase text-xs tracking-wider">Coordonnées Bancaires (RIB / IBAN)</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="md:col-span-2">
                        <label class="block text-xs font-semibold text-gray-500 mb-1">IBAN</label>
                        <input type="text" class="w-full border p-2 rounded text-sm font-mono" value="FR76 3000 6000 0001 2345 6789 X01">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-gray-500 mb-1">Code BIC / SWIFT</label>
                        <input type="text" class="w-full border p-2 rounded text-sm font-mono" value="AGRIFRPPXXX">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-gray-500 mb-1">Nom de la Banque</label>
                        <input type="text" class="w-full border p-2 rounded text-sm" value="Crédit Agricole">
                    </div>
                </div>
            </div>

            <div>
                <h3 class="font-bold text-gray-700 mb-4 border-b pb-2 uppercase text-xs tracking-wider">Personnalisation du Document</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-semibold text-gray-500 mb-1">Couleur des en-têtes</label>
                        <input type="color" class="h-9 w-full border p-1 rounded" value="#004d40">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-gray-500 mb-1">Logo (URL)</label>
                        <input type="text" class="w-full border p-2 rounded text-sm" placeholder="https://votre-site.fr/logo.png">
                    </div>
                </div>
            </div>

            <div class="flex justify-end pt-4 gap-3">
                <button type="button" onclick="router('sales_invoices')" class="px-6 py-2 border rounded text-gray-600 hover:bg-gray-50">Annuler</button>
                <button type="submit" class="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-bold">Enregistrer les modifications</button>
            </div>
        </form>
    </div>`;
}

window.saveInvoiceSettings = function(e) {
    if (e) e.preventDefault();
    showToast("Paramètres de facturation mis à jour avec succès", "success");
    router('sales_invoices');
};

function renderCreateInvoice() {
    return `
    <div class="h-full flex flex-col gap-6 fade-in">

        <!-- HEADER ACTIONS -->
        <div class="flex justify-between items-center">
            <h3 class="text-xl font-bold text-gray-800">Créer une facture</h3>
            <div class="flex gap-2">
                <button onclick="router('sales_invoices')" class="px-4 py-2 border rounded text-gray-600 hover:bg-gray-100">Annuler</button>
                <button onclick="previewInvoice()" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                    <i class="fa fa-eye mr-2"></i>Prévisualiser
                </button>
                <button onclick="saveDraft()" class="px-4 py-2 bg-gray-700 text-blue-500 rounded hover:bg-gray-800">
                    Brouillon
                </button>
                <button onclick="validateInvoice()" class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 font-bold shadow-lg">
                    Valider la facture
                </button>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 overflow-hidden">

            <!-- LEFT : FORM -->
            <div class="bg-white p-6 rounded-xl shadow-sm border overflow-y-auto">
                <h4 class="font-bold text-gray-700 mb-4 uppercase text-xs tracking-wider">Informations générales</h4>
                <div class="grid grid-cols-2 gap-4 mb-8">
                    <div>
                        <label class="block text-xs font-semibold text-gray-500 mb-1">Client</label>
                        <select id="invoice-client" class="w-full border p-2 rounded text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all">
                            ${db.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-gray-500 mb-1">Date d'émission</label>
                        <input type="date" id="invoice-date" class="w-full border p-2 rounded text-sm bg-gray-50" value="${new Date().toISOString().split('T')[0]}">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-gray-500 mb-1">Numéro de facture</label>
                        <input type="text" id="invoice-number" class="w-full border p-2 rounded bg-gray-100 text-sm font-mono" readonly value="${generateInvoiceNumber()}">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-gray-500 mb-1">Échéance</label>
                        <input type="date" id="invoice-due" class="w-full border p-2 rounded text-sm bg-gray-50" value="${new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]}">
                    </div>
                </div>

                <!-- LIGNES -->
                <div>
                    <div class="flex justify-between items-center mb-3">
                        <h4 class="font-bold text-gray-700 uppercase text-xs tracking-wider">Lignes de facturation</h4>
                        <button onclick="addLine()" class="text-blue-600 text-xs font-bold hover:underline">
                            <i class="fa fa-plus-circle mr-1"></i>Ajouter une ligne
                        </button>
                    </div>

                    <table class="w-full text-sm">
                        <thead class="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold">
                            <tr>
                                <th class="p-3 text-left">Description</th>
                                <th class="p-3 text-left w-20">Qté</th>
                                <th class="p-3 text-left w-32">Prix U. HT</th>
                                <th class="p-3 w-10"></th>
                            </tr>
                        </thead>
                        <tbody id="invoice-lines"></tbody>
                    </table>
                </div>
            </div>

            <!-- RIGHT : PREVIEW -->
            <div class="bg-gray-100 p-6 rounded-xl border border-gray-200 overflow-y-auto flex flex-col">
                <h4 class="font-bold text-gray-700 mb-4 uppercase text-xs tracking-wider">Aperçu du document</h4>
                <div id="invoice-preview" class="flex-1 bg-white shadow-lg rounded p-8 min-h-[600px] flex flex-col items-center justify-center border border-gray-200">
                    <div class="text-center">
                        <i class="fa-solid fa-file-invoice text-5xl text-gray-200 mb-4"></i>
                        <p class="text-gray-400 text-sm italic">Cliquez sur "Prévisualiser" pour générer l'aperçu dynamique</p>
                    </div>
                </div>
            </div>

        </div>
    </div>
    `;
}

function generateInvoiceNumber() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `FAC${year}${month}`;
    
    // On filtre les factures du mois en cours pour incrémenter le compteur
    const monthInvoices = db.sales_invoices.filter(inv => inv.id && inv.id.startsWith(prefix));
    const nextIndex = monthInvoices.length + 1;
    return `${prefix}${String(nextIndex).padStart(3, '0')}`;
}

function addLine() {
    invoiceLines.push({ 
        desc: '', 
        qty: 1, 
        price: 0 
    });
    renderLines();
}

function renderLines() {
    const tbody = document.getElementById('invoice-lines');
    if (!tbody) return; // Guard clause to prevent errors when view is inactive

    tbody.innerHTML = invoiceLines.map((l, i) => `
        <tr class="border-b border-gray-100 hover:bg-gray-50">
            <td class="p-2"><input value="${l.desc}" onchange="updateLine(${i}, 'desc', this.value)" class="w-full border p-2 rounded text-s" placeholder="Ex: Transport de marchandises..."></td>
            <td class="p-2"><input type="number" value="${l.qty}" onchange="updateLine(${i}, 'qty', this.value)" class="w-full border p-2 rounded text-s"></td>
            <td class="p-2"><input type="number" value="${l.price}" onchange="updateLine(${i}, 'price', this.value)" class="w-full border p-2 rounded text-s"></td>
            <td class="p-2 text-center">
                <button onclick="removeLine(${i})" class="text-red-400 hover:text-red-600 transition-colors" title="Supprimer la ligne">
                    <i class="fa fa-trash-can"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function updateLine(i, field, value) {
    // Parse numeric fields to prevent calculation errors in preview/storage
    const isNumeric = field === 'qty' || field === 'price';
    invoiceLines[i][field] = isNumeric ? (parseFloat(value) || 0) : value;
}

function removeLine(i) {
    invoiceLines.splice(i, 1);
    renderLines();
}

function previewInvoice() {
    const clientId = document.getElementById('invoice-client').value;
    const client = db.clients.find(c => c.id == clientId);
    const invNumber = document.getElementById('invoice-number').value;
    const invDate = document.getElementById('invoice-date').value;

    let total = 0;
    const rows = invoiceLines.map(l => {
        const lineTotal = l.qty * l.price;
        total += lineTotal;
        return `
            <tr class="border-b border-gray-100">
                <td class="py-3 text-xs">${l.desc || '<em>Sans description</em>'}</td>
                <td class="py-3 text-xs text-center">${l.qty}</td>
                <td class="py-3 text-xs text-right">${Number(l.price).toLocaleString()} €</td>
                <td class="py-3 text-xs text-right font-bold">${lineTotal.toLocaleString()} €</td>
            </tr>
        `;
    }).join('');

    const companyName = currentUser?.company_name || '';
    const companyAddress = currentUser?.company_address || '';
    const companySiret = currentUser?.company_siret || '';
    const companyTva = currentUser?.company_tva || '';

    document.getElementById('invoice-preview').innerHTML = `
        <div class="w-full h-full text-gray-800">
            <div class="flex justify-between items-start mb-10">
                <div>
                    <h2 class="text-3xl font-black text-blue-600 mb-1">FACTURE</h2>
                    <p class="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Document Provisoire</p>
                </div>
                <div class="text-right">
                    <p class="font-bold text-lg">${invNumber}</p>
                    <p class="text-xs text-gray-500">${new Date(invDate).toLocaleDateString('fr-FR')}</p>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-8 mb-12">
                <div>
                    <p class="text-[9px] uppercase font-bold text-gray-400 mb-2 tracking-wider">Émetteur</p>
                    <p class="font-bold text-sm">${companyName}</p>
                    <p class="text-[11px] text-gray-500">${companyAddress}</p>
                    <p class="text-[10px] text-gray-400 mt-1">SIRET : ${companySiret || '-'}</p>
                    <p class="text-[10px] text-gray-400">TVA : ${companyTva || '-'}</p>
                </div>
                <div class="text-right">
                    <p class="text-[9px] uppercase font-bold text-gray-400 mb-2 tracking-wider">Client</p>
                    <p class="font-bold text-sm">${client?.name || '-'}</p>
                    <p class="text-[11px] text-gray-500">${client?.address || ''}</p>
                    <p class="text-[11px] text-gray-500">${client?.tva || ''}</p>
                </div>
            </div>

            <table class="w-full mt-4 text-sm">
                <thead class="bg-gray-50 text-gray-500 uppercase text-[9px] font-bold tracking-wider">
                    <tr class="border-b">
                        <th class="py-2 text-left">Désignation</th>
                        <th class="py-2 text-center w-16">Qté</th>
                        <th class="py-2 text-right w-24">P.U. HT</th>
                        <th class="py-2 text-right w-28">Total HT</th>
                    </tr>
                </thead>
                <tbody>${rows || '<tr><td colspan="4" class="text-center py-10 text-gray-300 italic text-sm">Aucune ligne saisie</td></tr>'}</tbody>
            </table>

            <div class="flex justify-end pt-4">
                <div class="w-48 space-y-2">
                    <div class="flex justify-between text-xs text-gray-500">
                        <span>Total HT</span>
                        <span>${total.toLocaleString()} €</span>
                    </div>
                    <div class="flex justify-between text-base font-black text-blue-700 border-t-2 border-blue-100 pt-2">
                        <span>NET À PAYER&nbsp;:&nbsp;</span>
                        <span>${total.toLocaleString()} €</span>
                    </div>
                </div>
            </div>

            <div class="mt-20 pt-8 border-t border-dashed text-center">
                <p class="text-[9px] text-gray-400 uppercase tracking-widest">Aperçu généré par Transfact TMS - Ce document n'a pas de valeur légale tant qu'il n'est pas validé.</p>
            </div>
        </div>
    `;
}

async function saveDraft() {
    const data = getInvoiceFormData('Brouillon');
    if (!data) return;

    try {
        const res = await apiFetch('sales-invoices', { method: 'POST', body: data });
        if (res.ok) {
            await fetchAllData();
            showToast("Brouillon sauvegardé avec succès", "success");
            router('sales_invoices');
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || "Erreur lors de la sauvegarde du brouillon", "error");
        }
    } catch (err) {
        showToast("Impossible de contacter le serveur", "error");
    }
}

async function validateInvoice() {
    const data = getInvoiceFormData('En attente');
    if (!data) return;

    try {
        const res = await apiFetch('sales-invoices', { method: 'POST', body: data });
        if (res.ok) {
            await fetchAllData();
            showToast("Facture validée et enregistrée !", "success");
            router('sales_invoices');
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || "Erreur lors de la validation de la facture", "error");
        }
    } catch (err) {
        showToast("Impossible de contacter le serveur", "error");
    }
}

function getInvoiceFormData(status) {
    const clientId = document.getElementById('invoice-client').value;
    const date = document.getElementById('invoice-date').value;
    const number = document.getElementById('invoice-number').value;
    const due = document.getElementById('invoice-due').value;
    
    // Filtrer les lignes vides pour ne pas polluer la base de données
    const validLines = invoiceLines.filter(l => l.desc && l.desc.trim() !== "");

    if (!clientId) {
        showToast("Veuillez sélectionner un client", "error");
        return null;
    }
    
    if (validLines.length === 0) {
        showToast("Veuillez ajouter au moins une ligne avec une description", "error");
        return null;
    }

    const totalAmount = validLines.reduce((acc, l) => acc + (l.qty * l.price), 0);

    return {
        id: number,
        client_id: parseInt(clientId),
        date: date,
        due_date: due,
        items: validLines,
        amount: totalAmount,
        status: status,
        currency: 'EUR',
        typeCode: '380' // Code Factur-X standard pour une facture commerciale
    };
}

function renderAdmin() {
    const isAdmin = currentUser && currentUser.role === 'admin';
    const emailEnabled = currentUser?.company_notifications === 1;

    return `<div class="space-y-6 fade-in">
        <h2 class="text-2xl font-bold text-gray-800">Paramètres de l'Entreprise</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 class="font-bold text-gray-700 mb-4 uppercase text-xs tracking-wider">Utilisateurs Plateforme</h3>
                <table class="w-full text-sm text-left">
                    <thead class="border-b"><tr><th class="pb-2">Nom</th><th class="pb-2">Rôle</th><th class="pb-2">Action</th></tr></thead>
                    <tbody>
                        ${db.users.map(u => `<tr class="border-b last:border-0">
                            <td class="py-2">${u.name}</td>
                            <td class="py-2"><span class="${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'} px-2 rounded text-[10px] font-bold uppercase">${u.role}</span></td>
                            <td class="py-2"><button class="text-blue-600 text-xs">Modifier</button></td>
                        </tr>`).join('')}
                    </tbody>
                </table>
                ${isAdmin ? `<button onclick="openAddUserModal()" class="mt-4 w-full py-2 border border-dashed rounded text-gray-500 hover:bg-gray-50 text-sm">+ Ajouter utilisateur</button>` : ''}
            </div>

            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-6">
                <div>
                    <h3 class="font-bold text-gray-700 mb-4 uppercase text-xs tracking-wider">Identité Légale de la Compagnie</h3>
                    <div class="space-y-4">
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">Adresse Siège Social</label>
                            <input type="text" id="admin-company-address" class="w-full border p-2 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" value="${currentUser?.company_address || ''}" placeholder="123 Rue du Transport...">
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">N° TVA Intra.</label>
                                <input type="text" id="admin-company-tva" class="w-full border p-2 rounded text-sm font-mono uppercase" value="${currentUser?.company_tva || ''}" placeholder="FR123456789">
                            </div>
                            <div>
                                <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">SIRET / SIREN</label>
                                <input type="text" id="admin-company-siret" class="w-full border p-2 rounded text-sm font-mono" value="${currentUser?.company_siret || ''}" placeholder="123 456 789 00012">
                            </div>
                        </div>
                        <button onclick="updateCompanyInfo()" class="w-full py-2 bg-blue-600 text-white rounded text-sm font-bold hover:bg-blue-700 transition shadow-sm">
                            <i class="fa-solid fa-save mr-2"></i>Sauvegarder les informations
                        </button>
                    </div>
                </div>

                <div class="pt-6 border-t">
                    <h3 class="font-bold text-gray-700 mb-4 uppercase text-xs tracking-wider">Communication & Alertes</h3>
                    <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                            <span class="text-sm text-gray-800 font-semibold block">Notifications Email Automatiques</span>
                            <span class="text-[10px] text-gray-500">Envoyer les rapports de planning et confirmations de factures</span>
                        </div>
                        <div onclick="toggleEmailNotifications()" class="w-12 h-6 ${emailEnabled ? 'bg-blue-600' : 'bg-gray-200'} rounded-full relative cursor-pointer transition-colors duration-200">
                            <div class="w-4 h-4 bg-white rounded-full absolute top-1 ${emailEnabled ? 'right-1' : 'left-1'} transition-all shadow-sm"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}

// Fonctions logiques pour les paramètres
window.updateCompanyInfo = async function() {
    const payload = {
        address: document.getElementById('admin-company-address').value,
        tva_intra: document.getElementById('admin-company-tva').value,
        siret: document.getElementById('admin-company-siret').value
    };

    try {
        const response = await apiFetch(`companies/${currentUser.company_id}`, {
            method: 'PUT',
            body: payload
        });

        if (response.ok) {
            Object.assign(currentUser, { 
                company_address: payload.address, 
                company_tva: payload.tva_intra, 
                company_siret: payload.siret 
            });
            setCurrentUser(currentUser);
            showToast("Informations de la compagnie enregistrées", "success");
        } else {
            const errorData = await response.json().catch(() => ({}));
            showToast(errorData.error || "Échec de la sauvegarde", "error");
        }
    } catch (err) {
        showToast("Erreur de communication avec le serveur", "error");
    }
};

window.toggleEmailNotifications = async function() {
    const currentVal = currentUser?.company_notifications || 0;
    const newVal = currentVal === 1 ? 0 : 1;
    
    try {
        const response = await apiFetch(`companies/${currentUser.company_id}/notifications`, {
            method: 'PATCH',
            body: { email_notifications: newVal }
        });

        if (response.ok) {
            currentUser.company_notifications = newVal;
            setCurrentUser(currentUser);
            showToast(newVal ? "Notifications email activées" : "Notifications email désactivées", "info");
            router('admin'); // Re-render pour mettre à jour le switch visuel
        }
    } catch (err) {
        showToast("Erreur lors de la modification des notifications", "error");
    }
};

function renderPricing() {
    return `<div class="max-w-6xl mx-auto fade-in py-10">
        <div class="text-center mb-12">
            <h1 class="text-4xl font-extrabold text-gray-900 mb-4">Tarifs Transfact</h1>
            <p class="text-lg text-gray-600">Des solutions adaptées à vos besoins, sans frais cachés.</p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
            <div class="bg-white p-8 rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl transition">
                <h3 class="font-bold text-xl text-gray-800 mb-2">Starter</h3>
                <div class="text-4xl font-bold text-gray-900 mb-4">150€<span class="text-sm font-normal text-gray-500">/mois</span></div>
                <ul class="space-y-3 text-sm text-gray-600 mb-6">
                    <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Factures illimitées</li>
                    <li><i class="fa-solid fa-check text-green-500 mr-2"></i>1 utilisateur</li>
                    <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Support par email</li>
                    <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Gestion des clients</li>
                    <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Tableau de bord basique</li>
                    <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Planning avancé</li>
                    <li><i class="fa-solid fa-check text-green-500 mr-2"></i>3 Chauffeurs Application Mobile</li>
                </ul>
                <button class="w-full py-2 border border-blue-600 text-blue-600 rounded hover:bg-blue-50">Commencer</button>
            </div>
            <div class="bg-white p-8 rounded-2xl shadow-lg border-2 border-blue-500 relative transform scale-105">
                <div class="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-blue-500 text-white px-4 py-1 rounded-full text-sm font-bold">Le plus populaire</div>
                <h3 class="font-bold text-xl text-gray-800 mb-2">Professionnel</h3>
                <div class="text-4xl font-bold text-gray-900 mb-4">199€<span class="text-sm font-normal text-gray-500">/mois</span></div>
                <ul class="space-y-3 text-sm text-gray-600 mb-6">
                    <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Factures illimitées</li>
                    <li><i class="fa-solid fa-check text-green-500 mr-2"></i>1 utilisateurs</li>
                    <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Support prioritaire</li>
                    <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Accès API</li>
                    <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Planning avancé</li>
                    <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Gestion de flotte</li>
                </ul>
                <button class="w-full py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Choisir ce forfait</button>
            </div>
            <div class="bg-white p-8 rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl transition">
                <h3 class="font-bold text-xl text-gray-800 mb-2">Enterprise</h3>
                <div class="text-4xl font-bold text-gray-900 mb-4">399€<span class="text-sm font-normal text-gray-500">/mois</span></div>
                <ul class="space-y-3 text-sm text-gray-600 mb-6">
                    <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Tout dans Professionnel</li>
                    <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Utilisateurs illimités</li>
                    <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Support 24/7</li>
                    <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Personnalisation</li>
                    <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Intégration sur mesure</li>
                    <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Formation incluse</li>
                </ul>
                <button class="w-full py-2 border border-blue-600 text-blue-600 rounded hover:bg-blue-50">Nous contacter</button>
            </div>
        </div>
        <div class="mt-12 text-center">
            <p class="text-gray-600">Tous les tarifs sont hors taxes. Engagement mensuel résiliable à tout moment.</p>
        </div>
    </div>`;
}

function renderSolutions() {
    return `<div class="max-w-6xl mx-auto fade-in py-10">
        <div class="text-center mb-12">
            <h1 class="text-4xl font-extrabold text-gray-900 mb-4">Nos Solutions</h1>
            <p class="text-lg text-gray-600">Une suite complète pour gérer votre activité de transport.</p>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
            <div class="bg-white p-8 rounded-2xl shadow-lg border border-gray-100">
                <div class="w-14 h-14 bg-blue-100 rounded-xl flex items-center justify-center mb-4">
                    <i class="fa-solid fa-boxes-packing text-2xl text-blue-600"></i>
                </div>
                <h3 class="font-bold text-xl text-gray-800 mb-3">Gestion des Commandes</h3>
                <p class="text-gray-600">Créez et gérez vos ordres de transport facilement. Suivi complet du chargement à la livraison, avec gestion des statuts.</p>
            </div>
            <div class="bg-white p-8 rounded-2xl shadow-lg border border-gray-100">
                <div class="w-14 h-14 bg-green-100 rounded-xl flex items-center justify-center mb-4">
                    <i class="fa-solid fa-calendar-days text-2xl text-green-600"></i>
                </div>
                <h3 class="font-bold text-xl text-gray-800 mb-3">Planning Intelligent</h3>
                <p class="text-gray-600">Planifiez vos missions sur un planning hebdomadaire visuel. Optimisez les tournées et réduisez les coûts, avec affectation chauffeurs/véhicules.</p>
            </div>
            <div class="bg-white p-8 rounded-2xl shadow-lg border border-gray-100">
                <div class="w-14 h-14 bg-purple-100 rounded-xl flex items-center justify-center mb-4">
                    <i class="fa-solid fa-truck text-2xl text-purple-600"></i>
                </div>
                <h3 class="font-bold text-xl text-gray-800 mb-3">Gestion de Flotte</h3>
                <p class="text-gray-600">Suivez l'état de votre parc véhicule. Gestion de la maintenance, assurance, kilomètres et affectation aux chauffeurs.</p>
            </div>
            <div class="bg-white p-8 rounded-2xl shadow-lg border border-gray-100">
                <div class="w-14 h-14 bg-orange-100 rounded-xl flex items-center justify-center mb-4">
                    <i class="fa-solid fa-file-invoice-dollar text-2xl text-orange-600"></i>
                </div>
                <h3 class="font-bold text-xl text-gray-800 mb-3">Facturation Automatique</h3>
                <p class="text-gray-600">Générez vos factures clients (Factur-X) et achats en un clic. Suivi des paiements et relances automatiques.</p>
            </div>
            <div class="bg-white p-8 rounded-2xl shadow-lg border border-gray-100">
                <div class="w-14 h-14 bg-red-100 rounded-xl flex items-center justify-center mb-4">
                    <i class="fa-solid fa-handshake-angle text-2xl text-red-600"></i>
                </div>
                <h3 class="font-bold text-xl text-gray-800 mb-3">Gestion des Sous-traitants & Affrètement</h3>
                <p class="text-gray-600">Gérez vos sous-traitants, affectez des commandes et analysez la rentabilité de chaque affrètement.</p>
            </div>
            <div class="bg-white p-8 rounded-2xl shadow-lg border border-gray-100">
                <div class="w-14 h-14 bg-cyan-100 rounded-xl flex items-center justify-center mb-4">
                    <i class="fa-solid fa-mobile-screen-button text-2xl text-cyan-600"></i>
                </div>
                <h3 class="font-bold text-xl text-gray-800 mb-3">Application Mobile Chauffeurs</h3>
                <p class="text-gray-600">Permettez à vos chauffeurs de gérer leurs missions, scanner des documents et collecter des signatures directement depuis leur mobile.</p>
            </div>
        </div>
        
        <div class="bg-gradient-to-r from-blue-600 to-blue-800 rounded-2xl p-8 text-white text-center">
            <h2 class="text-2xl font-bold mb-4">Prêt à simplifier votre gestion?</h2>
            <p class="text-blue-100 mb-6">Démarrez gratuitement et adaptez votre solution à vos besoins.</p>
            <div class="flex justify-center gap-4">
                <button onclick="router('pricing')" class="bg-white text-blue-600 px-6 py-3 rounded-lg font-semibold hover:bg-blue-50 transition">Voir les tarifs</button>
                <button onclick="router('contact')" class="border border-white text-white px-6 py-3 rounded-lg font-semibold hover:bg-white/10 transition">Nous contacter</button>
            </div>
        </div>
    </div>`;
}

function renderContact() {
    return `<div class="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-gray-100 p-8 fade-in">
        <h2 class="text-2xl font-bold text-gray-800 mb-6">Contact & Aide</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div class="text-center p-6 bg-blue-50 rounded-lg">
                <i class="fa-solid fa-phone text-3xl text-blue-600 mb-3"></i>
                <h4 class="font-bold text-gray-800">Téléphone</h4>
                <p class="text-gray-600">02 99 00 00 00</p>
                <p class="text-sm text-gray-500">Lun-Ven: 9h-18h</p>
            </div>
            <div class="text-center p-6 bg-blue-50 rounded-lg">
                <i class="fa-solid fa-envelope text-3xl text-blue-600 mb-3"></i>
                <h4 class="font-bold text-gray-800">Email</h4>
                <p class="text-gray-600">support@transfact.fr</p>
                <p class="text-sm text-gray-500">Réponse sous 24h</p>
            </div>
        </div>
        <form class="space-y-4" onsubmit="submitContact(event)">
            <div><label class="block text-sm font-medium text-gray-700 mb-1">Sujet</label><input type="text" class="w-full border rounded p-2" required></div>
            <div><label class="block text-sm font-medium text-gray-700 mb-1">Message</label><textarea class="w-full border rounded p-2" rows="5" required></textarea></div>
            <button type="submit" class="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Envoyer</button>
        </form>
    </div>`;
}

// ---  --- 
function renderAbout() {
    return `<div class="max-w-4xl mx-auto bg-white rounded-xl shadow-sm border border-gray-100 p-8 fade-in">
        <div class="text-center mb-8">
            <i class="fa-solid fa-truck-fast text-5xl text-blue-600 mb-4"></i>  
            <h2 class="text-3xl font-bold text-gray-900 mb-2">À propos de Transfact</h2>
            <p class="text-gray-600">Votre solution de gestion de transport</p>
        </div>
        <div class="space-y-6 text-gray-700">
            <p>Transfact est une application de gestion de transport (TMS) complète conçue pour simplifier la planification, 
            le suivi et la facturation de vos opérations de Transports.</p>
            
            <h3 class="text-xl font-bold text-gray-800">Nos Services</h3>
            <ul class="space-y-2">
                <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Gestion des Commandes & Suivi de livraison</li>
                <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Planning Intelligent & Affectation</li>
                <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Gestion de Flotte & Maintenance</li>
                <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Facturation Automatique (Factur-X) & Achats</li>
                <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Gestion des Sous-traitants & Affrètement</li>
                <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Application Mobile pour les Chauffeurs</li>
                <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Calculateur de Cotation & Offres PDF</li>
            </ul>
            
            <h3 class="text-xl font-bold text-gray-800">Informations Légales</h3>
            <div class="bg-gray-50 p-2 rounded-lg">
                <p><strong>Entreprise:</strong> Transfact SAS</p>
                <p><strong>SIRET:</strong> SIRET A VOIR</p>
                <p><strong>TVA:</strong> TVA A VOIR</p>
                <p><strong>Adresse:</strong> ADRESSE A VOIR LORS DE LA CREATION DU START UP</p>
            </div>
        </div>
    </div>`;
}

function submitContact(e) {
    e.preventDefault();
    showToast("Message envoyé avec succès ! Nous vous répondrons sous 24h.", "success");
    e.target.reset();
}

function renderQuotationCalculator() {
    return `
    <div class="max-w-4xl mx-auto bg-white rounded-xl shadow-sm border border-gray-100 p-8 fade-in">
        <h2 class="text-2xl font-bold text-gray-800 mb-6"><i class="fa-solid fa-calculator mr-2 text-indigo-600"></i>Calculateur de Cotation (Trinôme)</h2>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div class="space-y-6">
                <div class="p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <h4 class="font-bold text-gray-700 mb-3 text-sm uppercase tracking-wider">1. Coût Kilométrique (CK)</h4>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs text-gray-500 mb-1">Nombre de km</label>
                            <input type="number" id="q-km" value="100" class="w-full border rounded p-2 text-sm" oninput="updateQuotation()">
                        </div>
                        <div>
                            <label class="block text-xs text-gray-500 mb-1">Coût au km (€)</label>
                            <input type="number" id="q-cost-km" value="0.45" step="0.01" class="w-full border rounded p-2 text-sm" oninput="updateQuotation()">
                        </div>
                    </div>
                    <p class="mt-2 text-[10px] text-gray-400">Carburant, pneus, entretien, péages.</p>
                </div>

                <div class="p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <h4 class="font-bold text-gray-700 mb-3 text-sm uppercase tracking-wider">2. Coût Conducteur (CC)</h4>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs text-gray-500 mb-1">Nombre d'heures</label>
                            <input type="number" id="q-hours" value="8" class="w-full border rounded p-2 text-sm" oninput="updateQuotation()">
                        </div>
                        <div>
                            <label class="block text-xs text-gray-500 mb-1">Coût horaire (€)</label>
                            <input type="number" id="q-cost-hour" value="32.00" step="0.5" class="w-full border rounded p-2 text-sm" oninput="updateQuotation()">
                        </div>
                    </div>
                    <p class="mt-2 text-[10px] text-gray-400">Rémunération, cotisations, frais.</p>
                </div>

                <div class="p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <h4 class="font-bold text-gray-700 mb-3 text-sm uppercase tracking-wider">3. Charges Journalières (CJ)</h4>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs text-gray-500 mb-1">Nombre de jours</label>
                            <input type="number" id="q-days" value="1" class="w-full border rounded p-2 text-sm" oninput="updateQuotation()">
                        </div>
                        <div>
                            <label class="block text-xs text-gray-500 mb-1">Coût journalier (€)</label>
                            <input type="number" id="q-cost-day" value="150.00" step="10" class="w-full border rounded p-2 text-sm" oninput="updateQuotation()">
                        </div>
                    </div>
                    <p class="mt-2 text-[10px] text-gray-400">Amortissement, assurance, taxes.</p>
                </div>
            </div>

            <div class="bg-indigo-900 rounded-2xl p-8 text-white flex flex-col justify-between shadow-xl">
                <div>
                    <h3 class="text-indigo-200 font-bold text-sm uppercase mb-6">Récapitulatif de la cotation</h3>
                    <div class="space-y-4">
                        <div class="flex justify-between border-b border-indigo-800 pb-2">
                            <span>Coût KM (CK)</span>
                            <span id="res-ck" class="font-bold">0.00 €</span>
                        </div>
                        <div class="flex justify-between border-b border-indigo-800 pb-2">
                            <span>Coût Conducteur (CC)</span>
                            <span id="res-cc" class="font-bold">0.00 €</span>
                        </div>
                        <div class="flex justify-between border-b border-indigo-800 pb-2">
                            <span>Charges Journalières (CJ)</span>
                            <span id="res-cj" class="font-bold">0.00 €</span>
                        </div>
                    </div>
                </div>
                
                <div class="mt-12 text-center">
                    <div class="text-indigo-300 text-sm mb-2">Prix de transport Total</div>
                    <div class="text-5xl font-black" id="res-total">0.00 €</div>
                </div>
                
                <button onclick="saveQuotation()" class="mt-8 w-full py-3 bg-white text-indigo-900 rounded-xl font-bold hover:bg-indigo-50 transition shadow-lg">
                    Générer Offre Commerciale
                </button>
            </div>
        </div>
    </div>`;
}

function updateQuotation() {
    const ck = (parseFloat(document.getElementById('q-km').value) || 0) * (parseFloat(document.getElementById('q-cost-km').value) || 0);
    const cc = (parseFloat(document.getElementById('q-hours').value) || 0) * (parseFloat(document.getElementById('q-cost-hour').value) || 0);
    const cj = (parseFloat(document.getElementById('q-days').value) || 0) * (parseFloat(document.getElementById('q-cost-day').value) || 0);
    const total = ck + cc + cj;

    document.getElementById('res-ck').textContent = ck.toFixed(2) + ' €';
    document.getElementById('res-cc').textContent = cc.toFixed(2) + ' €';
    document.getElementById('res-cj').textContent = cj.toFixed(2) + ' €';
    document.getElementById('res-total').textContent = total.toFixed(2) + ' €';
}

async function saveQuotation() {
    const km = document.getElementById('q-km').value;
    const costKm = document.getElementById('q-cost-km').value;
    const hours = document.getElementById('q-hours').value;
    const costHour = document.getElementById('q-cost-hour').value;
    const days = document.getElementById('q-days').value;
    const costDay = document.getElementById('q-cost-day').value;
    
    const ck = document.getElementById('res-ck').textContent;
    const cc = document.getElementById('res-cc').textContent;
    const cj = document.getElementById('res-cj').textContent;
    const total = document.getElementById('res-total').textContent;

    const offerContent = `
        <div style="padding: 40px; font-family: sans-serif; color: #333;">
            <div style="display: flex; justify-content: space-between; border-bottom: 2px solid #2563eb; padding-bottom: 20px; margin-bottom: 30px;">
                <div>
                    <h1 style="color: #2563eb; margin: 0; font-size: 24px;">Offre Commerciale</h1>
                    <p style="margin: 5px 0; font-weight: bold;">${currentUser?.company_name || 'Transfact'} - Votre partenaire transport</p>
                </div>
                <div style="text-align: right;">
                    <p style="margin: 0;">Date: ${new Date().toLocaleDateString('fr-FR')}</p>
                    <p style="margin: 0;">Réf: DEV-${Date.now().toString().slice(-6)}</p>
                </div>
            </div>

            <div style="margin-bottom: 40px;">
                <h3 style="border-bottom: 1px solid #eee; padding-bottom: 10px; color: #475569;">Détails de la proposition</h3>
                <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                    <thead>
                        <tr style="background: #f1f5f9;">
                            <th style="padding: 12px; text-align: left; border: 1px solid #e2e8f0; font-size: 13px;">Poste de coût</th>
                            <th style="padding: 12px; text-align: center; border: 1px solid #e2e8f0; font-size: 13px;">Quantité / Base</th>
                            <th style="padding: 12px; text-align: right; border: 1px solid #e2e8f0; font-size: 13px;">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style="padding: 12px; border: 1px solid #e2e8f0;">Coût Kilométrique (CK)</td>
                            <td style="padding: 12px; text-align: center; border: 1px solid #e2e8f0;">${km} km à ${costKm}€/km</td>
                            <td style="padding: 12px; text-align: right; border: 1px solid #e2e8f0;">${ck}</td>
                        </tr>
                        <tr>
                            <td style="padding: 12px; border: 1px solid #e2e8f0;">Coût Conducteur (CC)</td>
                            <td style="padding: 12px; text-align: center; border: 1px solid #e2e8f0;">${hours} h à ${costHour}€/h</td>
                            <td style="padding: 12px; text-align: right; border: 1px solid #e2e8f0;">${cc}</td>
                        </tr>
                        <tr>
                            <td style="padding: 12px; border: 1px solid #e2e8f0;">Charges Journalières (CJ)</td>
                            <td style="padding: 12px; text-align: center; border: 1px solid #e2e8f0;">${days} j à ${costDay}€/j</td>
                            <td style="padding: 12px; text-align: right; border: 1px solid #e2e8f0;">${cj}</td>
                        </tr>
                        <tr style="font-weight: bold; font-size: 16px; background: #f0f9ff;">
                            <td colspan="2" style="padding: 15px; border: 1px solid #e2e8f0;">PRIX TOTAL HT</td>
                            <td style="padding: 15px; text-align: right; border: 1px solid #e2e8f0; color: #1d4ed8;">${total}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div style="font-size: 11px; color: #64748b; margin-top: 60px; border-top: 1px solid #e2e8f0; padding-top: 20px; line-height: 1.6;">
                <p style="margin: 0;"><strong>Validité :</strong> Cette offre est valable pour une durée de 30 jours à compter de la date d'émission.</p>
                <p style="margin: 5px 0 0 0;">Cette simulation a été générée via Transfact TMS. Les prix sont indiqués Hors Taxes.</p>
            </div>
        </div>
    `;

    const opt = {
        margin: [0.5, 0.5],
        filename: `Offre_Commerciale_Transfact_${Date.now().toString().slice(-6)}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
    };

    showToast("Génération de l'offre PDF...", "info");
    
    try {
        await html2pdf().from(offerContent).set(opt).save();
        showToast("Offre commerciale sauvegardée localement", "success");
    } catch (err) {
        console.error("Erreur PDF:", err);
        showToast("Échec de la génération du PDF", "error");
    }
}

// Store chart instances to destroy them when switching tabs
const chartInstances = {};

function destroyAllChartInstances() {
    for (const chartId in chartInstances) {
        if (chartInstances[chartId]) {
            chartInstances[chartId].destroy();
            chartInstances[chartId] = null;
        }
    }
}
// --- ROUTER ---
async function router(route) {
    const appContent = document.getElementById('app-content');
    const pageTitle = document.getElementById('page-title');
    const navItems = document.querySelectorAll('.nav-item');
    
    // Update active nav
    navItems.forEach(item => {
        item.classList.remove('active');
        const action = item.getAttribute('onclick');
        if (action && action.includes(route)) {
            item.classList.add('active');
        }
    });
    
    let content = '';
    let title = '';
    
    switch(route) {
        case 'dashboard':
            title = 'Tableau de bord';
            // Rendu immédiat avec le squelette et les données vides
            content = renderDashboard();
            
            // Prepare filter query parameters
            const filterParams = new URLSearchParams();
            if (window.dashboardFilters.startDate) {
                filterParams.append('startDate', window.dashboardFilters.startDate);
            }
            if (window.dashboardFilters.endDate) {
                filterParams.append('endDate', window.dashboardFilters.endDate);
            }
            const queryString = filterParams.toString();
            // Chargement asynchrone des statistiques en arrière-plan
            apiFetch(`dashboard/stats${queryString ? `?${queryString}` : ''}`)
                .then(res => res.json())
                .then(stats => {
                    document.getElementById('app-content').innerHTML = renderDashboard(stats);
                    initDashboardCharts(stats); // Pass stats to initDashboardCharts
                })
                .catch(err => console.warn("Statistiques indisponibles, affichage par défaut", err));
            break;
        case 'planning':
            title = 'Planning Hebdomadaire';
            content = renderPlanning();
            break;
        case 'create_order':
            title = 'Créer une Commande';
            content = '<div class="fade-in"><button onclick="openAddOrderModal()" class="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700"><i class="fa-solid fa-plus mr-2"></i>Nouvelle Commande</button></div>';
            break;
        case 'completed_transports':
            title = 'Transports Réalisés';
            content = renderCompletedTransports();
            break;
        case 'inprogress_transports':
            title = 'Transports En cours';
            content = renderInProgressTransports();
            break;
        case 'clients':
            title = 'Clients';
            content = renderClients();
            break;
        case 'drivers':
            title = 'Chauffeurs';
            content = renderDrivers();
            break;
case 'fleet':
            title = 'Flotte & Véhicules';
            content = renderFleet();
            break;
        case 'subcontractors':
            title = 'Sous-traitants';
            content = renderSubcontractors();
            break;
        case 'margin_dashboard':
            title = 'Analyse des Marges';
            content = renderMarginDashboard();
            // Load margin data from API
            apiFetch('dispatch/margins')
                .then(res => res.json())
                .then(data => {
                    updateMarginDashboard(data);
                })
                .catch(err => console.warn('Erreur chargement marges'));
            break;
        case 'sales_invoices':
            title = 'Factures Ventes';
            content = renderSalesInvoices();
            break;
        case 'purchase_invoices':
            title = 'Factures Achats';
            content = renderPurchaseInvoices();
            break;
        case 'invoice_settings':
            title = 'Paramètres Facturation';
            content = renderSettingInvoices();
            break;
        case 'create_invoice':
            title = 'Nouvelle Facture';
            invoiceLines = [{ desc: '', qty: 1, price: 0 }]; // On démarre avec une ligne vide
            content = renderCreateInvoice();
            setTimeout(renderLines, 50); // Attendre l'injection du DOM
            break;
        case 'admin':
            title = 'Administration';
            content = renderAdmin();
            break;
        case 'pricing':
            title = 'Tarifs';
            content = renderPricing();
            break;
        case 'solutions':
            title = 'Nos Solutions';
            content = renderSolutions();
            break;
        case 'contact':
            title = 'Contact & Aide';
            content = renderContact();
            break;
        case 'about':
            title = 'À propos';
            content = renderAbout();
            break;
        case 'quotation':
            title = 'Calculateur de Cotation';
            content = renderQuotationCalculator();
            setTimeout(updateQuotation, 50);
            break;
        default:
            title = 'Tableau de bord';
            content = renderDashboard();
            
            // Prepare filter query parameters for default route
            const defaultFilterParams = new URLSearchParams();
            if (window.dashboardFilters.startDate) {
                defaultFilterParams.append('startDate', window.dashboardFilters.startDate);
            }
            if (window.dashboardFilters.endDate) {
                defaultFilterParams.append('endDate', window.dashboardFilters.endDate);
            }
            const defaultQueryString = defaultFilterParams.toString();
            apiFetch(`dashboard/stats${defaultQueryString ? `?${defaultQueryString}` : ''}`)
                .then(res => res.json())
                .then(stats => {
                    document.getElementById('app-content').innerHTML = renderDashboard(stats);
                    initDashboardCharts(stats); // Pass stats to initDashboardCharts
                })
                .catch(err => console.warn("Statistiques indisponibles (default)", err));
            break;
    }
    
    if (content) {
        appContent.innerHTML = content;
    }
    
    pageTitle.textContent = title;
}

// --- TOAST NOTIFICATIONS ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast border-${type === 'success' ? 'green' : type === 'error' ? 'red' : 'blue'}-500`;
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        info: 'fa-info-circle'
    };
    
    toast.innerHTML = `
        <i class="fa-solid ${icons[type] || icons.info} text-${type === 'success' ? 'green' : type === 'error' ? 'red' : 'blue'}-500 text-xl mr-3"></i>
        <span class="text-sm text-gray-700">${message}</span>
    `;
    
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// --- MODAL FUNCTIONS ---
function openChartModal() {
    hideAllModals();
    document.getElementById('chart-modal').classList.remove('hidden');
    initChart();
}

function closeChartModal() {
    hideAllModals();
}

function initChart() {
    const ctx = document.getElementById('salesChart');
    if (salesChartInstance) {
        salesChartInstance.destroy();
    }
    salesChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin'],
            datasets: [{
                label: 'Chiffre d\'affaires (€)',
                data: [12000, 19000, 15000, 25000, 22000, 30000],
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } }
        }
    });
}

function updateChart() {
    initChart();
}

function initDashboardCharts(stats = {}) { // Now accepts stats object
    const activeTab = window.activeDashboardTab || 'general';
    
    // Common options for charts
    const chartColors = ['#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899', '#6366f1'];
    const statusColors = ['#94a3b8', '#3b82f6', '#10b981', '#ef4444']; // Gris, Bleu, Vert, Rouge

    const commonOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } };

    // Clear previous chart instances
    destroyAllChartInstances();

    if (activeTab === 'general') {
        // Evolution CA (Mensuel)
        const revCtx = document.getElementById('revenueEvolutionChart');
        if (revCtx) {
            chartInstances.revenueEvolutionChart = new Chart(revCtx, {
                type: 'bar',
                data: {
                    labels: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'],
                    datasets: [{ label: 'CA (€)', data: stats.revenueChart || new Array(12).fill(0), backgroundColor: '#3b82f6' }]
                },
                options: commonOptions
            });
        }

        // Propre vs Affrètement
        const costCtx = document.getElementById('costBreakdownChart');
        if (costCtx) {
            const own = stats.costBreakdown ? stats.costBreakdown[0] : 0;
            const chartered = stats.costBreakdown ? stats.costBreakdown[1] : 0;
            const data = (own === 0 && chartered === 0) ? [1, 1] : [own, chartered]; // Default to show something if no data
            const labels = (own === 0 && chartered === 0) ? ['Aucune donnée'] : ['Transport Propre', 'Affrètement'];
            
            chartInstances.costBreakdownChart = new Chart(costCtx, {
                type: 'pie',
                data: {
                    labels: labels,
                    datasets: [{ data: data, backgroundColor: ['#10b981', '#f59e0b'] }]
                },
                options: { ...commonOptions, plugins: { legend: { display: true, position: 'bottom' } } }
            });
        }

        // Performance Géo (Top 5 destinations)
        const geoCtx = document.getElementById('geoPerformanceChart');
        if (geoCtx) {
            const labels = stats.geoPerformance ? stats.geoPerformance.map(item => item.label) : ['Aucune donnée'];
            const data = stats.geoPerformance ? stats.geoPerformance.map(item => item.value) : [1];
            chartInstances.geoPerformanceChart = new Chart(geoCtx, {
                type: 'bar',
                data: { labels, datasets: [{ label: 'Missions', data, backgroundColor: '#8b5cf6' }] },
                options: { ...commonOptions, indexAxis: 'y' }
            });
        }

        // Taux de remplissage
        const donutCapacity = document.getElementById('donutCapacity');
        if (donutCapacity) {
            const fillRate = stats.fillRate || 0;
            const capText = document.getElementById('capacity-text'); // This element is already in renderDashboard
            if (capText) capText.textContent = `${fillRate}%`; // Update text content
            chartInstances.donutCapacity = new Chart(donutCapacity, {
                type: 'doughnut',
                data: {
                    labels: ['Rempli', 'Libre'],
                    datasets: [{ data: [fillRate, 100 - fillRate], backgroundColor: ['#3b82f6', '#f1f5f9'], borderWidth: 0, cutout: '80%' }]
                },
                options: { ...commonOptions, plugins: { legend: { display: false }, tooltip: { enabled: false } } }
            });
        }

        // Expéditions par Client (new)
        const donutExp = document.getElementById('donutExpeditions');
        if (donutExp) {
            const clientLabels = stats.clientTransportCounts ? stats.clientTransportCounts.map(item => item.client_name) : ['Aucune donnée'];
            const clientData = stats.clientTransportCounts ? stats.clientTransportCounts.map(item => item.count) : [1];
            chartInstances.donutExpeditions = new Chart(donutExp, {
                type: 'doughnut',
                data: {
                    labels: clientLabels,
                    datasets: [{
                        data: clientData,
                        backgroundColor: chartColors,
                        borderWidth: 0,
                        cutout: '70%'
                    }]
                },
                options: { ...commonOptions, plugins: { legend: { display: true, position: 'right' } } }
            });
        }

        // Dépenses par Client (new)
        const donutDep = document.getElementById('donutDepenses');
        if (donutDep) {
            const clientLabels = stats.clientTransportCosts ? stats.clientTransportCosts.map(item => item.client_name) : ['Aucune donnée'];
            const clientData = stats.clientTransportCosts ? stats.clientTransportCosts.map(item => item.total_cost) : [1];
            chartInstances.donutDepenses = new Chart(donutDep, {
                type: 'doughnut',
                data: {
                    labels: clientLabels,
                    datasets: [{
                        data: clientData,
                        backgroundColor: chartColors,
                        borderWidth: 0,
                        cutout: '70%'
                    }]
                },
                options: { ...commonOptions, plugins: { legend: { display: true, position: 'right' } } }
            });
        }
    }

    if (activeTab === 'quotations') {
        const total = stats.totalQuotations || 0;
        const converted = stats.orderStatusCounts ? stats.orderStatusCounts.filter(s => s.status === 'Terminé' || s.status === 'En cours').reduce((acc, s) => acc + s.count, 0) : 0;
        const rate = total > 0 ? Math.round((converted / total) * 100) : 0; // Use converted count from backend
        
        const rateEl = document.getElementById('conversion-rate-kpi');
        if (rateEl) rateEl.textContent = `${rate}%`;

        const convCtx = document.getElementById('quotationConversionChart');
        if (convCtx) {
            const labels = stats.orderStatusCounts ? stats.orderStatusCounts.map(item => item.status) : ['Aucune donnée'];
            const data = stats.orderStatusCounts ? stats.orderStatusCounts.map(item => item.count) : [1];
            chartInstances.quotationConversionChart = new Chart(convCtx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{ data: data, backgroundColor: statusColors, cutout: '60%' }]
                },
                options: { ...commonOptions, plugins: { legend: { display: true, position: 'right' } } }
            });
        }
    }

    if (activeTab === 'invoicing') {
        const invCtx = document.getElementById('invoicingStatusChart');
        if (invCtx) { // Use stats.totalRevenue and stats.outstandingAmount from backend
            const statusSums = { 'Payée': stats.totalRevenue || 0, 'En attente': stats.outstandingAmount || 0 };
            const labels = Object.keys(statusSums);
            const data = Object.values(statusSums);
            
            chartInstances.invoicingStatusChart = new Chart(invCtx, {
                type: 'pie',
                data: {
                    labels: labels,
                    datasets: [{ data: data, backgroundColor: ['#10b981', '#f59e0b'] }]
                },
                options: { ...commonOptions, plugins: { legend: { display: true, position: 'bottom' } } }
            });
        }
    }
}

// --- MISSION MODALS ---
function openEditMissionModal(missionId) {
    hideAllModals(); // Masquer tous les autres modaux d'abord
    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
        modalOverlay.classList.remove('hidden');
        modalOverlay.classList.add('flex', 'items-center', 'justify-center');
    }
    const mission = db.missions.find(m => m.id === missionId);
    if (!mission) return;
    
    document.getElementById('edit-mission-id').value = missionId;
    document.getElementById('edit-mission-id-display').textContent = missionId;
    
    // Populate drivers
    const driverSelect = document.getElementById('edit-mission-driver');
    driverSelect.innerHTML = db.drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    driverSelect.value = mission.driver_id || '';
    
    // Populate vehicles
    const vehicleSelect = document.getElementById('edit-mission-vehicle');
    vehicleSelect.innerHTML = db.vehicles.map(v => `<option value="${v.id}">${v.plate} - ${v.model}</option>`).join('');
    vehicleSelect.value = mission.vehicle_id || '';
    
    document.getElementById('edit-mission-date').value = mission.date;
    document.getElementById('edit-mission-delivery-time').value = mission.delivery_time || '';
    
    document.getElementById('edit-mission-modal').classList.remove('hidden');
}

function closeEditMissionModal() {
    hideAllModals();
}

async function submitEditMission() {
    const missionId = parseInt(document.getElementById('edit-mission-id').value);
    const mission = db.missions.find(m => m.id === missionId);
    
    if (mission) {
        const updatedMission = {
            ...mission,
            driver_id: parseInt(document.getElementById('edit-mission-driver').value) || null,
            vehicle_id: parseInt(document.getElementById('edit-mission-vehicle').value) || null,
            date: document.getElementById('edit-mission-date').value,
            delivery_time: document.getElementById('edit-mission-delivery-time').value
        };

        await apiFetch(`missions/${missionId}`, { method: 'PUT', body: updatedMission });
        await fetchAllData();
        showToast('Mission mise à jour avec succès', 'success');
        closeEditMissionModal();
        router('planning');
    }
}

function openAddMissionModal() {
    hideAllModals();
    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
        modalOverlay.classList.remove('hidden');
        modalOverlay.classList.add('flex', 'items-center', 'justify-center');
    }
    // Populate clients
    const clientSelect = document.getElementById('add-mission-client');
    clientSelect.innerHTML = db.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    
    // Populate drivers
    const driverSelect = document.getElementById('add-mission-driver');
    driverSelect.innerHTML = db.drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    
    // Populate vehicles
    const vehicleSelect = document.getElementById('add-mission-vehicle');
    vehicleSelect.innerHTML = db.vehicles.map(v => `<option value="${v.id}">${v.plate} - ${v.model}</option>`).join('');
    
    // Set default date
    document.getElementById('add-mission-date').value = new Date().toISOString().split('T')[0];
    
    document.getElementById('add-mission-modal').classList.remove('hidden');
}

function closeAddMissionModal() {
    hideAllModals();
}

async function submitAddMission() {
    const newMission = {
        id: Math.max(...db.missions.map(m => m.id)) + 1,
        client_id: parseInt(document.getElementById('add-mission-client').value),
        driver_id: parseInt(document.getElementById('add-mission-driver').value) || null,
        vehicle_id: parseInt(document.getElementById('add-mission-vehicle').value) || null,
        origin: document.getElementById('add-mission-origin').value,
        dest: document.getElementById('add-mission-dest').value,
        date: document.getElementById('add-mission-date').value,
        delivery_time: document.getElementById('add-mission-delivery-time').value,
        price: parseFloat(document.getElementById('add-mission-price').value) || 0,
        status: 'Planifié',
        distance: 0
    };
    
    if (newMission.client_id && newMission.origin && newMission.dest) {
        await apiFetch('missions', { method: 'POST', body: newMission });
        await fetchAllData();
        showToast('Mission créée avec succès', 'success');
        closeAddMissionModal();
        router('planning');
    } else {
        showToast('Veuillez remplir tous les champs obligatoires', 'error');
    }
}

// --- CLIENT MODALS ---
function openAddClientModal() {
    hideAllModals();

    // Important: le modal aperçu facture (modal-overlay / modal-content) ne doit jamais être réutilisé ici.
    // On le force donc à rester caché et on vide son contenu pour éviter les conflits d'affichage.
    const invoiceOverlay = document.getElementById('modal-overlay');
    const invoiceContent = document.getElementById('modal-content');
    if (invoiceOverlay) {
        invoiceOverlay.classList.add('hidden');
        invoiceOverlay.classList.remove('flex', 'items-center', 'justify-center');
    }
    if (invoiceContent) {
        invoiceContent.classList.add('hidden');
        invoiceContent.innerHTML = '';
    }

    // Afficher uniquement le modal client
    const clientModal = document.getElementById('add-client-modal');
    if (clientModal) clientModal.classList.remove('hidden');

    document.getElementById('client-modal-title').textContent = 'Nouveau Client';
    document.getElementById('edit-client-id').value = '';
    document.getElementById('add-client-name').value = '';
    document.getElementById('add-client-email').value = '';
    document.getElementById('add-client-phone').value = '';
    document.getElementById('add-client-address').value = '';
    document.getElementById('add-client-tva').value = '';
    document.getElementById('add-client-contact-name').value = '';
    document.getElementById('add-client-contact-type').value = 'Exploitant';
}

function openEditClientModal(clientId) {
    hideAllModals();
    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
        modalOverlay.classList.remove('hidden');
        modalOverlay.classList.add('flex', 'items-center', 'justify-center');
    }
    const client = db.clients.find(c => c.id === clientId);
    if (!client) return;
    
    document.getElementById('client-modal-title').textContent = 'Éditer Client';
    document.getElementById('edit-client-id').value = clientId;
    document.getElementById('add-client-name').value = client.name;
    document.getElementById('add-client-email').value = client.email;
    document.getElementById('add-client-phone').value = client.phone;
    document.getElementById('add-client-address').value = client.address;
    document.getElementById('add-client-tva').value = client.tva || '';
    document.getElementById('add-client-contact-name').value = client.contact_name || '';
    document.getElementById('add-client-contact-type').value = client.contact_type || 'Exploitant';
    
    document.getElementById('add-client-modal').classList.remove('hidden');
}

function closeAddClientModal() {
    hideAllModals();
}

async function submitAddClient() {
    const editId = document.getElementById('edit-client-id').value;
    const clientData = {
        name: document.getElementById('add-client-name').value,
        email: document.getElementById('add-client-email').value,
        phone: document.getElementById('add-client-phone').value,
        address: document.getElementById('add-client-address').value,
        tva: document.getElementById('add-client-tva').value,
        contact_name: document.getElementById('add-client-contact-name').value,
        contact_type: document.getElementById('add-client-contact-type').value
    };
    
    if (!clientData.name) {
        showToast('Le nom du client est obligatoire', 'error');
        return;
    }
    
    try {
        const response = await apiFetch(editId ? `clients/${editId}` : 'clients', {
            method: editId ? 'PUT' : 'POST',
            body: clientData
        });

        if (response.ok) {
            showToast(editId ? 'Client mis à jour avec succès' : 'Client ajouté avec succès', 'success');
            await fetchAllData();
            closeAddClientModal();
            router('clients');
        } else {
            const errorData = await response.json().catch(() => ({}));
            showToast(errorData.error || `Erreur ${response.status}`, "error");
        }
    } catch (error) {
        showToast("Erreur de communication avec le serveur", "error");
    }
}

// --- DRIVER MODAL ---
function openDriverCardModal(driverId) {
    hideAllModals();
    const driver = db.drivers.find(d => d.id === driverId);
    if (!driver) return;
    
    const content = document.getElementById('driver-card-content');
    content.innerHTML = `
        <div class="text-center mb-4">
            <div class="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center text-3xl font-bold text-gray-500 mx-auto mb-3">
                ${driver.name.charAt(0)}${driver.name.split(' ')[1].charAt(0)}
            </div>
            <h3 class="font-bold text-xl text-gray-800">${driver.name}</h3>
            <span class="bg-${driver.status === 'Disponible' ? 'green' : 'blue'}-100 text-${driver.status === 'Disponible' ? 'green' : 'blue'}-800 px-3 py-1 rounded-full text-sm">${driver.status}</span>
        </div>
        <div class="space-y-3">
            <div class="flex justify-between border-b pb-2"><span class="text-gray-500">Téléphone</span><span class="font-medium">${driver.phone}</span></div>
            <div class="flex justify-between border-b pb-2"><span class="text-gray-500">Permis</span><span class="font-medium">${driver.license}</span></div>
            <div class="flex justify-between border-b pb-2"><span class="text-gray-500">Expiration permis</span><span class="font-medium">${driver.license_expiry}</span></div>
            <div class="flex justify-between border-b pb-2"><span class="text-gray-500">Adresse</span><span class="font-medium">${driver.address}</span></div>
            <div class="flex justify-between"><span class="text-gray-500">Notes</span><span class="font-medium">${driver.notes || '-'}</span></div>
        </div>
    `;
    
    document.getElementById('driver-card-modal').classList.remove('hidden');
}

/**
 * Gestion des chauffeurs - Modals et CRUD
 */
function openAddDriverModal() {
    hideAllModals();
    document.getElementById('driver-modal-title').textContent = 'Nouveau Chauffeur';
    document.getElementById('edit-driver-id').value = '';
    document.getElementById('driver-name').value = '';
    document.getElementById('driver-phone').value = '';
    document.getElementById('driver-license').value = 'C+E';
    document.getElementById('driver-license-expiry').value = '';
    document.getElementById('driver-status').value = 'Disponible';
    document.getElementById('driver-address').value = '';
    document.getElementById('driver-notes').value = '';

    // On masque le bouton de suppression pour un nouveau chauffeur
    const deleteBtn = document.getElementById('btn-delete-driver');
    if (deleteBtn) deleteBtn.classList.add('hidden');

    document.getElementById('driver-modal').classList.remove('hidden');
}

function openEditDriverModal(driverId) {
    hideAllModals();
    const driver = db.drivers.find(d => d.id === driverId);
    if (!driver) return;

    document.getElementById('driver-modal-title').textContent = 'Modifier Chauffeur';
    document.getElementById('edit-driver-id').value = driverId;
    document.getElementById('driver-name').value = driver.name;
    document.getElementById('driver-phone').value = driver.phone || '';
    document.getElementById('driver-license').value = driver.license || '';
    document.getElementById('driver-license-expiry').value = driver.license_expiry ? driver.license_expiry.split('T')[0] : '';
    document.getElementById('driver-status').value = driver.status || 'Disponible';
    document.getElementById('driver-address').value = driver.address || '';
    document.getElementById('driver-notes').value = driver.notes || '';

    // On affiche le bouton de suppression pour un chauffeur existant
    const deleteBtn = document.getElementById('btn-delete-driver');
    if (deleteBtn) deleteBtn.classList.remove('hidden');

    document.getElementById('driver-modal').classList.remove('hidden');
}

function closeDriverModal() {
    hideAllModals();
}

async function submitDriver(e) {
    if (e) e.preventDefault();
    const id = document.getElementById('edit-driver-id').value;
    const driverData = {
        name: document.getElementById('driver-name').value,
        phone: document.getElementById('driver-phone').value,
        license: document.getElementById('driver-license').value,
        license_expiry: document.getElementById('driver-license-expiry').value,
        status: document.getElementById('driver-status').value,
        address: document.getElementById('driver-address').value,
        notes: document.getElementById('driver-notes').value
    };
    if (!driverData.name) return showToast("Le nom est obligatoire", "error");
    
    try {
        const response = await apiFetch(id ? `drivers/${id}` : 'drivers', { method: id ? 'PUT' : 'POST', body: driverData });
        
        if (response.ok) {
            showToast(id ? "Chauffeur mis à jour" : "Chauffeur ajouté", "success");
            await fetchAllData();
            closeDriverModal();
            router('drivers');
        } else {
            const errorData = await response.json();
            showToast(errorData.error || `Erreur ${response.status}`, "error");
        }
    } catch (error) { 
        showToast("Erreur réseau - Vérifiez le serveur Backend", "error"); 
    }
}

async function deleteDriver() {
    const id = document.getElementById('edit-driver-id').value;
    if (!id || !confirm("Êtes-vous sûr de vouloir retirer ce chauffeur de l'entreprise ?")) return;
    
    try {
        const res = await apiFetch(`drivers/${id}`, { method: 'DELETE' });
        if (res.ok) { 
            showToast("Chauffeur retiré avec succès", "success"); 
            await fetchAllData(); 
            closeDriverModal(); 
            router('drivers'); 
        } else {
            const errorData = await res.json();
            showToast(errorData.error || `Erreur ${res.status}`, "error");
        }
    } catch (error) { 
        showToast("Erreur réseau - Vérifiez le serveur Backend", "error"); 
    }
}

function closeDriverCardModal() {
    hideAllModals();
}

// --- SUBCONTRACTOR MODALS ---
function openAddSubcontractorModal() {
    hideAllModals();

    // Hard guarantee: l’aperçu Facture A4 ne doit jamais remonter au-dessus des modaux.
    // Même logique que openAddClientModal().
    const invoiceOverlay = document.getElementById('modal-overlay');
    const invoiceContent = document.getElementById('modal-content');
    if (invoiceOverlay) {
        invoiceOverlay.classList.add('hidden');
        invoiceOverlay.classList.remove('flex', 'items-center', 'justify-center');
    }
    if (invoiceContent) {
        invoiceContent.classList.add('hidden');
        invoiceContent.innerHTML = '';
    }

    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
        modalOverlay.classList.remove('hidden');
        modalOverlay.classList.add('flex', 'items-center', 'justify-center');
    }
    document.getElementById('subcontractor-modal-title').textContent = 'Nouveau Sous-traitant';
    document.getElementById('edit-subcontractor-id').value = '';
    document.getElementById('add-subcontractor-name').value = '';
    document.getElementById('add-subcontractor-siret').value = '';
    document.getElementById('add-subcontractor-email').value = '';
    document.getElementById('add-subcontractor-phone').value = '';
    document.getElementById('add-subcontractor-address').value = '';
    document.getElementById('add-subcontractor-rc-expiry').value = '';
    document.getElementById('add-subcontractor-urssaf-expiry').value = '';
    document.getElementById('add-subcontractor-insurance-file').value = '';
    document.getElementById('subcontractor-insurance-view').classList.add('hidden');
    document.getElementById('add-subcontractor-status').value = 'ACTIF';
    document.getElementById('subcontractor-rc-warning').classList.add('hidden');
    document.getElementById('btn-delete-subcontractor').classList.add('hidden');
    document.getElementById('add-subcontractor-modal').classList.remove('hidden');
}


function openEditSubcontractorModal(subcontractorId) {
    hideAllModals();
    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
        modalOverlay.classList.remove('hidden');
        modalOverlay.classList.add('flex', 'items-center', 'justify-center');
    }

    const subcontractor = db.subcontractors.find(s => s.id === subcontractorId);
    if (!subcontractor) return;
    
    document.getElementById('subcontractor-modal-title').textContent = 'Modifier Sous-traitant';
    document.getElementById('edit-subcontractor-id').value = subcontractorId;
    document.getElementById('add-subcontractor-name').value = subcontractor.name;
    document.getElementById('add-subcontractor-siret').value = subcontractor.siret || '';
    document.getElementById('add-subcontractor-email').value = subcontractor.email || '';
    document.getElementById('add-subcontractor-phone').value = subcontractor.phone || '';
    document.getElementById('add-subcontractor-address').value = subcontractor.address || '';
    document.getElementById('add-subcontractor-rc-expiry').value = subcontractor.rc_pro_expiry || '';
    document.getElementById('add-subcontractor-urssaf-expiry').value = subcontractor.urssaf_expiry || '';
    document.getElementById('add-subcontractor-insurance-file').value = '';
    
    const viewLink = document.getElementById('subcontractor-insurance-view');
    if (subcontractor.insurance_doc_url) {
        viewLink.href = subcontractor.insurance_doc_url;
        viewLink.classList.remove('hidden');
    } else {
        viewLink.classList.add('hidden');
    }

    document.getElementById('add-subcontractor-status').value = subcontractor.status || 'ACTIF';
    
    // Check expiry
    const rcExpiry = new Date(subcontractor.rc_pro_expiry);
    const today = new Date();
    if (subcontractor.rc_pro_expiry && rcExpiry < today) {
        document.getElementById('subcontractor-rc-warning').classList.remove('hidden');
    } else {
        document.getElementById('subcontractor-rc-warning').classList.add('hidden');
    }
    document.getElementById('btn-delete-subcontractor').classList.remove('hidden');
    document.getElementById('add-subcontractor-modal').classList.remove('hidden');
}

function closeAddSubcontractorModal() {
    hideAllModals();
}

async function submitAddSubcontractor() {
    const editId = document.getElementById('edit-subcontractor-id').value;
    const formData = new FormData();
    formData.append('name', document.getElementById('add-subcontractor-name').value);
    formData.append('siret', document.getElementById('add-subcontractor-siret').value);
    formData.append('email', document.getElementById('add-subcontractor-email').value);
    formData.append('phone', document.getElementById('add-subcontractor-phone').value);
    formData.append('address', document.getElementById('add-subcontractor-address').value);
    formData.append('rc_pro_expiry', document.getElementById('add-subcontractor-rc-expiry').value);
    formData.append('urssaf_expiry', document.getElementById('add-subcontractor-urssaf-expiry').value);
    formData.append('status', document.getElementById('add-subcontractor-status').value);

    const fileInput = document.getElementById('add-subcontractor-insurance-file');
    if (fileInput && fileInput.files[0]) {
        formData.append('insurance_doc', fileInput.files[0]);
    }
    
    if (!document.getElementById('add-subcontractor-name').value || !document.getElementById('add-subcontractor-rc-expiry').value) {
        showToast('Nom et expiration RC Pro obligatoires', 'error');
        return;
    }
    
    try {
        const response = await apiFetch(editId ? `subcontractors/${editId}` : 'subcontractors', {
            method: editId ? 'PUT' : 'POST',
            body: formData
        });
        
        if (response.ok) {
            showToast(editId ? 'Sous-traitant mis à jour' : 'Sous-traitant ajouté', 'success');
            await fetchAllData();
            closeAddSubcontractorModal();
            router('subcontractors');
        } else {
            const errorData = await response.json();
            showToast(errorData.error || 'Erreur', 'error');
        }
    } catch (error) {
        showToast('Erreur réseau', 'error');
    }
}

async function deleteSubcontractor() {
    const id = document.getElementById('edit-subcontractor-id').value;
    if (!id || !confirm('Êtes-vous sûr de vouloir supprimer ce sous-traitant?')) return;
    
    try {
        const res = await apiFetch(`subcontractors/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Sous-traitant supprimé', 'success');
            await fetchAllData();
            closeAddSubcontractorModal();
            router('subcontractors');
        } else {
            showToast('Erreur lors de la suppression', 'error');
        }
    } catch (error) {
        showToast('Erreur réseau', 'error');
    }
}

// --- DISPATCH MODALS ---
function openDispatchModal(orderId) {
    hideAllModals();
    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
        modalOverlay.classList.remove('hidden');
        modalOverlay.classList.add('flex', 'items-center', 'justify-center');
    }

    const order = db.orders.find(o => o.id === orderId);
    if (!order) return;
    
    document.getElementById('dispatch-order-id').value = orderId;
    document.getElementById('dispatch-order-ref').textContent = order.ref || '#' + orderId;
    document.getElementById('dispatch-order-price').textContent = (order.price || 0) + '€';
    document.getElementById('dispatch-purchase-price').value = '';
    
    // Populate valid subcontractors only
    const select = document.getElementById('dispatch-subcontractor');
    const validSubcontractors = db.subcontractors.filter(s => 
        s.status === 'ACTIF' && 
        (!s.rc_pro_expiry || new Date(s.rc_pro_expiry) >= new Date())
    );
    select.innerHTML = '<option value="">-- Sélectionner --</option>' + 
        validSubcontractors.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    
    // Also add expired ones with warning
    const expired = db.subcontractors.filter(s => 
        s.status === 'ACTIF' && s.rc_pro_expiry && new Date(s.rc_pro_expiry) < new Date()
    );
    if (expired.length > 0) {
        select.innerHTML += '<option disabled>--- Expirés (attention) ---</option>' +
            expired.map(s => `<option value="${s.id}" class="text-red-500">${s.name} ⚠️</option>`).join('');
    }
    
    calculateDispatchMargin();
    document.getElementById('dispatch-modal').classList.remove('hidden');
}

function closeDispatchModal() {
    hideAllModals();
}

function checkSubcontractorValidity() {
    const select = document.getElementById('dispatch-subcontractor');
    const selectedId = parseInt(select.value);
    const warningEl = document.getElementById('dispatch-subcontractor-warning');
    
    if (!selectedId) {
        warningEl.classList.add('hidden');
        return;
    }
    
    const subcontractor = db.subcontractors.find(s => s.id === selectedId);
    if (subcontractor && subcontractor.rc_pro_expiry && new Date(subcontractor.rc_pro_expiry) < new Date()) {
        warningEl.classList.remove('hidden');
    } else {
        warningEl.classList.add('hidden');
    }
}

function calculateDispatchMargin() {
    const order = db.orders.find(o => o.id === parseInt(document.getElementById('dispatch-order-id').value));
    const salePrice = order ? parseFloat(order.price) || 0 : 0;
    const purchasePrice = parseFloat(document.getElementById('dispatch-purchase-price').value) || 0;
    const margin = salePrice - purchasePrice;
    const marginPercent = salePrice > 0 ? ((margin / salePrice) * 100).toFixed(1) : 0;
    
    document.getElementById('dispatch-sale-display').textContent = salePrice.toFixed(2) + '€';
    document.getElementById('dispatch-cost-display').textContent = purchasePrice.toFixed(2) + '€';
    document.getElementById('dispatch-margin-display').textContent = margin.toFixed(2) + '€ (' + marginPercent + '%)';
    document.getElementById('dispatch-margin-display').className = margin >= 0 ? 'font-bold text-green-600' : 'font-bold text-red-600';
}

async function submitDispatch() {
    const orderId = parseInt(document.getElementById('dispatch-order-id').value);
    const subcontractorId = parseInt(document.getElementById('dispatch-subcontractor').value);
    const purchasePrice = parseFloat(document.getElementById('dispatch-purchase-price').value);
    
    if (!subcontractorId || !purchasePrice) {
        showToast('Veuillez sélectionner un sous-traitant et saisir le prix d\'achat', 'error');
        return;
    }
    
    try {
        const response = await apiFetch(`dispatch`, {
            method: 'POST',
            body: {
                orderId,
                subcontractorId,
                purchasePrice
            }
        });
        
        if (response.ok) {
            showToast('Commande affectée au sous-traitant', 'success');
            await fetchAllData();
            closeDispatchModal();
            router('planning');
        } else {
            const errorData = await response.json();
            showToast(errorData.error || 'Erreur', 'error');
        }
    } catch (error) {
        showToast('Erreur réseau', 'error');
    }
}

// --- VEHICLE MODALS ---
function openAddVehicleModal() {
    hideAllModals();

    // Hard guarantee: l’aperçu Facture A4 ne doit jamais remonter au-dessus des modaux.
    // Même logique que openAddClientModal().
    const invoiceOverlay = document.getElementById('modal-overlay');
    const invoiceContent = document.getElementById('modal-content');
    if (invoiceOverlay) {
        invoiceOverlay.classList.add('hidden');
        invoiceOverlay.classList.remove('flex', 'items-center', 'justify-center');
    }
    if (invoiceContent) {
        invoiceContent.classList.add('hidden');
        invoiceContent.innerHTML = '';
    }

    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
        modalOverlay.classList.remove('hidden');
        modalOverlay.classList.add('flex', 'items-center', 'justify-center');
    }

    document.getElementById('add-vehicle-plate').value = '';
    document.getElementById('add-vehicle-model').value = '';
    document.getElementById('add-vehicle-fuel').value = 'Diesel';
    document.getElementById('add-vehicle-mileage').value = '';
    document.getElementById('add-vehicle-maintenance').value = '';
    document.getElementById('add-vehicle-modal').classList.remove('hidden');
}


function closeAddVehicleModal() {
    hideAllModals();
}

async function submitAddVehicle() {
    const newVehicle = {
        plate: document.getElementById('add-vehicle-plate').value,
        model: document.getElementById('add-vehicle-model').value,
        fuel: document.getElementById('add-vehicle-fuel').value,
        mileage: parseInt(document.getElementById('add-vehicle-mileage').value) || 0,
        next_maintenance: document.getElementById('add-vehicle-maintenance').value,
        status: 'Disponible',
        driver_id: null,
        insurance_expiry: '2025-12-31'
    };
    
    if (newVehicle.plate && newVehicle.model) {
        try {
            const response = await apiFetch('vehicles', { method: 'POST', body: newVehicle });
            
            if (response.ok) {
                await fetchAllData();
                showToast('Camion ajouté avec succès', 'success');
                closeAddVehicleModal();
                router('fleet');
            } else {
                const errorData = await response.json();
                showToast(errorData.error || `Erreur ${response.status}`, "error");
            }
        } catch (error) {
            showToast("Erreur réseau - Vérifiez le serveur Backend", "error");
        }
    } else {
        showToast('Veuillez remplir l\'immatriculation et le modèle', 'error');
    }
}

function openEditVehicleModal(vehicleId) {
    hideAllModals();
    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
        modalOverlay.classList.remove('hidden');
        modalOverlay.classList.add('flex', 'items-center', 'justify-center');
    }

    const vehicle = db.vehicles.find(v => v.id === vehicleId);
    if (!vehicle) return;
    
    document.getElementById('edit-vehicle-id').value = vehicleId;
    document.getElementById('edit-vehicle-plate').value = vehicle.plate;
    document.getElementById('edit-vehicle-model').value = vehicle.model;
    document.getElementById('edit-vehicle-fuel').value = vehicle.fuel || 'Diesel';
    document.getElementById('edit-vehicle-mileage').value = vehicle.mileage || 0;
    document.getElementById('edit-vehicle-maintenance').value = vehicle.next_maintenance || '';
    document.getElementById('edit-vehicle-status').value = vehicle.status || 'Disponible';
    
    // Populate driver select if it exists in the modal
    const driverSelect = document.getElementById('edit-vehicle-driver');
    if (driverSelect) {
        driverSelect.innerHTML = '<option value="">-- Aucun --</option>' + 
            db.drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
        driverSelect.value = vehicle.driver_id || '';
    }
    
    document.getElementById('edit-vehicle-modal').classList.remove('hidden');
}

function closeEditVehicleModal() {
    hideAllModals();
}

async function submitEditVehicle() {
    const vehicleId = parseInt(document.getElementById('edit-vehicle-id').value);
    const vehicle = db.vehicles.find(v => v.id === vehicleId);
    
    if (vehicle) {
        const updatedVehicle = {
            ...vehicle,
            plate: document.getElementById('edit-vehicle-plate').value,
            model: document.getElementById('edit-vehicle-model').value,
            fuel: document.getElementById('edit-vehicle-fuel').value,
            mileage: parseInt(document.getElementById('edit-vehicle-mileage').value) || 0,
            next_maintenance: document.getElementById('edit-vehicle-maintenance').value,
            status: document.getElementById('edit-vehicle-status').value
        };

        const driverSelect = document.getElementById('edit-vehicle-driver');
        if (driverSelect) {
            updatedVehicle.driver_id = driverSelect.value ? parseInt(driverSelect.value) : null;
        }

        await apiFetch(`vehicles/${vehicleId}`, { method: 'PUT', body: updatedVehicle });
        await fetchAllData();
        showToast('Véhicule mis à jour avec succès', 'success');
        closeEditVehicleModal();
        router('fleet');
    } else {
        showToast('Véhicule non trouvé', 'error');
    }
}

// --- PURCHASE INVOICE MODAL ---
let selectedPurchaseCategory = 'Carburant';

function openAddPurchaseInvoiceModal() {
    hideAllModals();
    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
        modalOverlay.classList.remove('hidden');
        modalOverlay.classList.add('flex', 'items-center', 'justify-center');
    }
    document.getElementById('add-purchase-supplier').value = '';
    document.getElementById('add-purchase-type').value = 'Carburant';
    document.getElementById('add-purchase-ref').value = '';
    document.getElementById('add-purchase-amount').value = '';
    document.getElementById('add-purchase-date').value = new Date().toISOString().split('T')[0];
    selectedPurchaseCategory = 'Carburant';
    switchPurchaseInvoiceTab('manual');
    document.getElementById('add-purchase-invoice-modal').classList.remove('hidden');
}

function closeAddPurchaseInvoiceModal() {
    hideAllModals();
}

function switchPurchaseInvoiceTab(tab) {
    document.getElementById('purchase-invoice-manual').classList.add('hidden');
    document.getElementById('purchase-invoice-scan').classList.add('hidden');
    document.getElementById('purchase-invoice-file').classList.add('hidden');
    
    document.getElementById('tab-manual').classList.remove('border-blue-600', 'text-blue-600');
    document.getElementById('tab-scan').classList.remove('border-blue-600', 'text-blue-600');
    document.getElementById('tab-file').classList.remove('border-blue-600', 'text-blue-600');
    document.getElementById('tab-manual').classList.add('border-transparent', 'text-gray-500');
    document.getElementById('tab-scan').classList.add('border-transparent', 'text-gray-500');
    document.getElementById('tab-file').classList.add('border-transparent', 'text-gray-500');
    
    document.getElementById(`purchase-invoice-${tab}`).classList.remove('hidden');
    document.getElementById(`tab-${tab}`).classList.remove('border-transparent', 'text-gray-500');
    document.getElementById(`tab-${tab}`).classList.add('border-blue-600', 'text-blue-600');
}

function openCamera() {
    showToast('Fonctionnalité de scan en cours de développement', 'info');
}

function selectPurchaseCategory(element, category) {
    document.querySelectorAll('.category-tag').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');
    selectedPurchaseCategory = category;
}

async function handlePurchaseFileUpload(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        showToast(`Analyse de ${file.name} en cours...`, 'info');

        // Simulation de l'algorithme d'extraction (OCR / Parsing)
        // Dans une application réelle, on enverrait le fichier au backend
        // ou on utiliserait une librairie type Tesseract.js
        setTimeout(() => {
            const extractedData = {
                ref: "PIECE-" + Math.floor(Math.random() * 9000 + 1000),
                supplier: file.name.includes('Total') ? 'Total Energies' : (file.name.includes('Vinci') ? 'Vinci Autoroutes' : 'Fournisseur Extrait'),
                amount: (Math.random() * 200 + 50).toFixed(2),
                date: new Date().toISOString().split('T')[0],
                type: file.name.toLowerCase().includes('essence') || file.name.toLowerCase().includes('total') ? 'Carburant' : 'Entretien'
            };

            // Remplissage automatique des champs pour validation utilisateur
            document.getElementById('add-purchase-ref').value = extractedData.ref;
            document.getElementById('add-purchase-supplier').value = extractedData.supplier;
            document.getElementById('add-purchase-amount').value = extractedData.amount;
            document.getElementById('add-purchase-date').value = extractedData.date;
            document.getElementById('add-purchase-type').value = extractedData.type;

            // Basculement vers l'onglet manuel pour vérification
            switchPurchaseInvoiceTab('manual');
            showToast("Données extraites avec succès !", "success");
        }, 1500);
    }
}

async function submitPurchaseInvoice() {
    // Check if user is admin
    if (!canManageInvoices()) {
        showToast("Vous n'avez pas l'autorisation d'ajouter des factures d'achat.", "error");
        return;
    }
    
    const ref = document.getElementById('add-purchase-ref').value;
    const supplier = document.getElementById('add-purchase-supplier').value;
    const type = document.getElementById('add-purchase-type').value;
    const amount = parseFloat(document.getElementById('add-purchase-amount').value);
    const date = document.getElementById('add-purchase-date').value;

    if (supplier && amount && date) {
        const newInvoice = {
            id: ref || ("ACH-" + new Date().getFullYear() + "-" + String(db.purchase_invoices.length + 1).padStart(3, '0')),
            supplier: supplier,
            type: type,
            date: date,
            amount: amount,
            status: 'À payer',
            file: null
        };
        await apiFetch('purchase-invoices', { method: 'POST', body: newInvoice });
        await fetchAllData();
        showToast('Facture d\'achat ajoutée avec succès', 'success');
        closeAddPurchaseInvoiceModal();
        router('purchase_invoices');
    } else {
        showToast('Veuillez remplir tous les champs obligatoires', 'error');
    }
}

// --- USER MODAL (ADMIN) ---
function openAddUserModal() {
    hideAllModals();
    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
        modalOverlay.classList.remove('hidden');
        modalOverlay.classList.add('flex', 'items-center', 'justify-center');
    }
    document.getElementById('add-user-name').value = '';
    document.getElementById('add-user-email').value = '';
    document.getElementById('add-user-role').value = 'user';
    document.getElementById('add-user-password').value = '';
    document.getElementById('add-user-modal').classList.remove('hidden');
}

function closeAddUserModal() {
    hideAllModals();
}

async function submitAddUser() {
    const name = document.getElementById('add-user-name').value;
    const email = document.getElementById('add-user-email').value;
    const role = document.getElementById('add-user-role').value;
    const password = document.getElementById('add-user-password').value;
    
    if (name && email && password) {
        const newUser = {
            id: Math.max(...db.users.map(u => u.id)) + 1,
            name: name,
            email: email,
            role: role,
            password: password
        };
        await apiFetch('users', { method: 'POST', body: newUser });
        await fetchAllData();
        showToast('Utilisateur créé avec succès', 'success');
        closeAddUserModal();
        router('admin');
    } else {
        showToast('Veuillez remplir tous les champs', 'error');
    }
}

// --- INVOICE MODAL ---
async function openInvoiceModal(invoiceId) {
    hideAllModals();
    // unlock: on autorise l'ouverture SEULEMENT après avoir nettoyé tous les autres modaux
    // (on augmente également le sessionId pour invalider tout rendu tardif)
    if (!window.__invoicePreviewSessionId) window.__invoicePreviewSessionId = 0;
    window.__invoicePreviewSessionId++;
    window.__invoicePreviewLock = false;

    const mySessionId = window.__invoicePreviewSessionId;


    
    let invoice;
    try {
        const res = await apiFetch(`sales-invoices/${invoiceId}`);
        const result = await res.json();
        invoice = result.data;
    } catch (e) {
        showToast("Erreur lors du chargement des détails", "error");
        return;
    }

    if (!invoice) return;
    const client = db.clients.find(c => c.id == invoice.client_id);
    const invoiceCurrency = invoice.currency || 'EUR';
    const clientEmail = client ? client.email : '';

    // Sécurité : s'assurer que les items sont bien un tableau
    let items = invoice.items || [];
    if (typeof items === 'string') {
        try { items = JSON.parse(items); } catch (e) { items = []; }
    }

    document.getElementById('modal-title').textContent = 'Facture ' + invoiceId;

    // Calculs dynamiques pour le nouveau modèle Factur-X
    let totalHT = 0;
    let tax20 = 0;
    let tax55 = 0;
    let hasZeroTax = false;

    const itemsHtml = items.map((item, index) => {
        const qty = item.qty || 1;
        const pu = item.price; // HT
        // On récupère le taux de l'objet facture ou 20% par défaut
        const tvaRate = (invoice.tva_rate !== undefined) ? (invoice.tva_rate / 100) : 0.20;
        
        const lineHT = qty * pu;
        const lineTax = lineHT * tvaRate;

        if (tvaRate === 0) hasZeroTax = true;
        totalHT += lineHT;
        if (tvaRate === 0.20) tax20 += lineTax;
        else if (tvaRate === 0.055) tax55 += lineTax;

        return `
            <tr class="border-b border-gray-100">
                <td class="p-3 font-mono text-[10px]">${invoice.order_ref || 'REF-' + (index + 1)}</td>
                <td class="p-3 font-medium text-[11px] text-gray-800">${item.desc}</td>
                <td class="p-3 text-center text-[11px]">${qty}</td>
                <td class="p-3 text-right text-[11px]">${pu.toLocaleString('fr-FR', { style: 'currency', currency: invoiceCurrency })}</td>
                <td class="p-3 text-right text-[11px]">${(tvaRate * 100).toFixed(1)}%</td>
                <td class="p-3 text-right font-bold text-[11px]">${lineHT.toLocaleString('fr-FR', { style: 'currency', currency: invoiceCurrency })}</td>
            </tr>
        `;
    }).join('');

    const totalTTC = totalHT + tax20 + tax55;
    
    document.getElementById('modal-content').innerHTML = `
        <div class="max-w-4xl mx-auto bg-white overflow-hidden">
            <div class="bg-[#004d40] text-white p-6 flex justify-between items-center">
                <div>
                    <h1 class="text-xl font-bold tracking-tight uppercase">Facture Électronique Conforme</h1>
                    <p class="text-[10px] opacity-80">(FORMAT MIXTE / FACTUR-X)</p>
                </div>
                <div class="text-right uppercase">
                    <h2 class="text-3xl font-extrabold leading-none">Facture</h2>
                    <p class="text-sm mt-1">N° : <span class="font-mono text-lg">${invoice.id}</span> [${invoice.typeCode || '380'}]</p>
                    <p class="text-xs">Date : ${invoice.date}</p>
                </div>
            </div>

            <div class="p-8">
                <div class="grid grid-cols-2 gap-12 mb-8">
                    <div>
                        <h3 class="font-bold text-gray-800 border-b-2 border-[#004d40] mb-2 text-[10px] uppercase tracking-wider">Émetteur</h3>
                        <p class="font-bold text-sm text-gray-800">${currentUser?.company_name || 'TRANSFACT SAS'}</p>
                        <p class="text-[11px] text-gray-600">${currentUser?.company_address || 'Adresse non renseignée'}</p>
                        <p class="text-[11px] text-gray-500">SIRET : ${currentUser?.company_siret || '-'}</p>
                        <p class="text-[11px] text-gray-500">TVA : ${currentUser?.company_tva || '-'}</p>
                    </div>
                    <div>
                        <h3 class="font-bold text-gray-800 border-b-2 border-gray-300 mb-2 text-right text-[10px] uppercase tracking-wider">Destinataire</h3>
                        <div class="text-right">
                            <p class="font-bold uppercase text-sm text-gray-800">${client ? client.name : '-'}</p>
                            <p class="text-[11px] text-gray-600">${client ? client.address : '-'}</p>
                            ${client && client.tva ? `<p class="text-[11px] text-gray-500">TVA : ${client.tva}</p>` : ''}
                        </div>
                    </div>
                </div>

                <div class="bg-green-50 border border-green-200 p-3 rounded-md flex items-center mb-8">
                    <svg class="w-5 h-5 text-green-600 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    <p class="text-[10px] text-green-800 uppercase font-semibold">Note : Ce document contient un fichier de données XML intégré conforme au standard Factur-X pour un traitement automatique.</p>
                </div>

                <table class="w-full text-left border-collapse mb-8">
                    <thead class="bg-gray-50 uppercase text-[10px] font-bold text-gray-600 border-y border-gray-200">
                        <tr>
                            <th class="p-3">Référence</th>
                            <th class="p-3">Désignation</th>
                            <th class="p-3 text-center">Qté</th>
                            <th class="p-3 text-right">PU H.T.</th>
                            <th class="p-3 text-right">TVA</th>
                            <th class="p-3 text-right">Montant H.T.</th>
                        </tr>
                    </thead>
                    <tbody id="invoice-items" class="text-gray-700">
                        ${itemsHtml}
                    </tbody>
                </table>

                <div class="flex justify-between items-start">
                    <div class="text-[10px] text-gray-500 space-y-1 w-1/2 pr-8 text-justify">
                        <p class="font-bold text-gray-700 uppercase">Modalités de paiement :</p>
                        <p>Date d'échéance : 30 jours (Loi LME)</p>
                        <p>Mode de règlement : Virement Bancaire</p>
                        <p>IBAN : FR76 3000 6000 0001 2345 6789 X01</p>
                        ${hasZeroTax ? `
                        <div class="mt-2 p-2 bg-blue-50 text-blue-800 border-l-2 border-blue-400 font-semibold italic">
                            Mention : Exonération de TVA, article 262 ter I du CGI (ou Auto-liquidation).
                        </div>
                        ` : ''}
                        <div class="mt-4 p-3 bg-gray-50 border-l-4 border-orange-400">
                             <p class="font-bold text-gray-700 uppercase mb-1">Pénalités de retard :</p>
                             <p class="text-[9px] leading-relaxed">Taux de 33,39% annuel (3 fois le taux légal). Indemnité forfaitaire de 40€ pour frais de recouvrement. S'applique de plein droit dès le premier jour de retard sans rappel nécessaire.</p>
                        </div>
                    </div>
                    
                    <div class="w-1/3 space-y-2">
                        <div class="flex justify-between text-xs text-gray-600">
                            <span>Total H.T.</span>
                            <span class="font-medium">${totalHT.toLocaleString('fr-FR', { style: 'currency', currency: invoiceCurrency })}</span>
                        </div>
                        <div class="flex justify-between text-xs text-gray-600">
                            <span>TVA (20%)</span>
                            <span>${tax20.toLocaleString('fr-FR', { style: 'currency', currency: invoiceCurrency })}</span>
                        </div>
                        <div class="flex justify-between text-xs text-gray-600">
                            <span>TVA (5,5%)</span>
                            <span>${tax55.toLocaleString('fr-FR', { style: 'currency', currency: invoiceCurrency })}</span>
                        </div>
                        <div class="flex justify-between text-lg font-bold text-[#004d40] border-t-2 border-[#004d40] pt-2 mt-2">
                            <span>NET À PAYER</span>
                            <span>${totalTTC.toLocaleString('fr-FR', { style: 'currency', currency: invoiceCurrency })}</span>
                        </div>
                    </div>
                </div>

                <div class="mt-12 pt-6 border-t border-gray-200 text-[9px] text-gray-400 text-center uppercase tracking-widest leading-relaxed">
                    Facture émise électroniquement. L'intégrité et l'authenticité sont garanties par signature numérique. Archivage légal 10 ans.
                    <br>${currentUser?.company_name || 'TRANSFACT SAS'} - SIRET: ${currentUser?.company_siret || '000 000 000 00000'} - APE: 4941B - Capital Social: 10 000€
                </div>
            </div>
        </div>
    `;
    
    // Update modal for A4 full page display
    // Cette partie est spécifique au modal de facture, qui semble être structuré différemment.
    // Elle manipule directement modal-overlay.
    // Si un autre modal a été ouvert pendant le chargement async, on n'affiche pas la facture.
    if (window.__invoicePreviewLock) return;
    // Invalide tout rendu async si une autre ouverture de modal a eu lieu
    if (mySessionId !== window.__invoicePreviewSessionId) return;


    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
        modalOverlay.classList.remove('hidden');
        modalOverlay.classList.add('flex', 'items-center', 'justify-center');
    }

    // On affiche explicitement le conteneur de la facture
    const invoiceContent = document.getElementById('modal-content');
    if (invoiceContent) invoiceContent.classList.remove('hidden');


    const btnContainer = document.querySelector('#modal-overlay .border-t');
    if (btnContainer) {
        let actionButtons = '';
        
        if (invoice.status === 'Brouillon' || invoice.status === 'Draft') {
            actionButtons = `
                <button onclick="editDraft('${invoiceId}')" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 shadow transition-all">
                    <i class="fa-solid fa-pen mr-2"></i>Modifier contenu
                </button>
                <button onclick="validateDraft('${invoiceId}')" class="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 shadow transition-all active:scale-95">
                    <i class="fa-solid fa-check-double mr-2"></i>Valider définitivement
                </button>
            `;
        } else if (invoice.status !== 'Cancelled' && invoice.status !== 'annulée') {
            actionButtons = `
                <button onclick="window.createCreditNote('${invoiceId}', false)" class="px-4 py-2 bg-orange-100 text-orange-700 border border-orange-200 rounded hover:bg-orange-200 shadow-sm transition-all">
                    <i class="fa-solid fa-file-invoice-dollar mr-1"></i> Avoir Total
                </button>
                <button onclick="window.createCreditNote('${invoiceId}', true)" class="px-4 py-2 bg-gray-100 text-gray-700 border rounded hover:bg-gray-200 shadow-sm transition-all">
                    <i class="fa-solid fa-scissors mr-1"></i> Avoir Partiel
                </button>
            `;
        }

        btnContainer.innerHTML = `
            <div class="flex items-center gap-2 text-sm text-gray-600 mr-auto">
                ${clientEmail ? `<i class="fa-solid fa-envelope"></i><span>Envoyer à: <strong>${clientEmail}</strong></span>` : '<div class="text-orange-500 font-semibold text-xs"><i class="fa-solid fa-triangle-exclamation mr-1"></i> Email client manquant</div>'}
            </div>
            <button onclick="closeModal()" class="px-4 py-2 border rounded text-gray-600 hover:bg-white">Fermer</button>
            ${actionButtons}
            <button onclick="confirmSendInvoice('${invoiceId}', '${clientEmail}')" class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 shadow transition-all active:scale-95">
                <i class="fa-solid fa-paper-plane mr-2"></i>Envoyer
            </button>
            <button onclick="downloadInvoicePDF('${invoiceId}')" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 shadow transition-all active:scale-95">
                <i class="fa-solid fa-file-pdf mr-2"></i>Télécharger PDF
            </button>
        `;
    }
}

window.editDraft = function(invoiceId) {
    const invoice = db.sales_invoices.find(inv => inv.id === invoiceId);
    if (!invoice) return;
    
    router('create_invoice');
    setTimeout(() => {
        document.getElementById('invoice-client').value = invoice.client_id;
        document.getElementById('invoice-date').value = invoice.date;
        document.getElementById('invoice-number').value = invoice.id;
        invoiceLines = invoice.items || [];
        renderLines();
        showToast("Reprise du brouillon", "info");
    }, 100);
};

function closeModal() {
    hideAllModals();
}

window.validateDraft = async function(invoiceId) {
    if (!confirm("Voulez-vous transformer ce brouillon en facture définitive ?")) return;
    try {
        const res = await apiFetch(`sales-invoices/${invoiceId}/validate`, { method: 'POST' });
        if (res.ok) {
            showToast("Facture validée avec succès !", "success");
            await fetchAllData();
            closeModal();
            router('sales_invoices');
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || "Erreur de validation", "error");
        }
    } catch (e) { showToast("Serveur injoignable", "error"); }
};

window.createCreditNote = async function(invoiceId, isPartial) {
    let amount = null;
    if (isPartial) {
        const input = prompt("Saisissez le montant HT de l'avoir partiel :");
        if (input === null) return;
        amount = parseFloat(input);
        if (isNaN(amount) || amount <= 0) {
            showToast("Montant invalide", "error");
            return;
        }
    }

    const message = isPartial 
        ? `Voulez-vous générer un avoir partiel de ${amount}€ pour cette facture ?` 
        : "Voulez-vous générer un avoir total pour cette facture ?";

    if (!confirm(message)) return;

    try {
        const res = await apiFetch(`sales-invoices/${invoiceId}/credit-note`, { 
            method: 'POST', 
            body: { isPartial, amount } 
        });

        if (res.ok) {
            showToast("Avoir créé avec succès", "success");
            await fetchAllData();
            closeModal();
            router('sales_invoices');
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || "Erreur de création d'avoir", "error");
        }
    } catch (e) { showToast("Serveur injoignable", "error"); }
};

function confirmSendInvoice(invoiceId, clientEmail) {
    if (!clientEmail) {
        showToast('Aucun email trouvé pour ce client. Veuillez éditer le client pour ajouter un email.', 'error');
        return;
    }
    
    if (confirm('Êtes-vous sûr de vouloir envoyer la facture ' + invoiceId + ' à l\'adresse email:\n\n' + clientEmail + ' ?')) {
        sendInvoice(invoiceId);
    }
}

function sendInvoice(invoiceId) {
    // Check if user is admin
    if (!canManageInvoices()) {
        showToast("Vous n'avez pas l'autorisation d'envoyer des factures.", "error");
        closeModal();
        return;
    }
    
    const invoice = db.sales_invoices.find(inv => inv.id === invoiceId);
    const client = db.clients.find(c => c.id == invoice.client_id);

    if (invoice && client && client.email) {
        invoice.sent_date = new Date().toISOString().split('T')[0];

        // Show success message with client email
        showToast('Facture envoyée par email à: ' + client.email, 'success');

        // Refresh the invoice list
        router('sales_invoices');
    } else if (invoice) {
        invoice.sent_date = new Date().toISOString().split('T')[0];
        showToast('Facture marquée comme envoyée', 'success');
        router('sales_invoices');
    }
    closeModal();
}

function relanceFacture(invoiceId) {
    // Check if user is admin
    if (!canManageInvoices()) {
        showToast("Vous n'avez pas l'autorisation de relancer des factures.", "error");
        return;
    }
    
    const invoice = db.sales_invoices.find(inv => inv.id === invoiceId);
    if (invoice) {
        invoice.reminder_date = new Date().toISOString().split('T')[0];
        showToast('Relance envoyée pour la facture ' + invoiceId, 'success');
        router('sales_invoices');
    }
}

async function downloadInvoicePDF(invoiceId) {
    showToast('Génération de la facture Factur-X (PDF/A-3)...', 'info');
    try {
        const response = await apiFetch(`sales-invoices/${invoiceId}/download`);
        if (!response.ok) throw new Error('Erreur de génération serveur');

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `facture_${invoiceId}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        showToast('Facture conforme téléchargée', 'success');
    } catch (err) {
        console.error(err);
        showToast('Erreur lors de la génération PDF/A-3', 'error');
    }
}

function exportAccounting(type) {
    showToast('Export comptabilité en cours...', 'info');
    setTimeout(() => {
        showToast('Export prêt (simulation)', 'success');
    }, 1500);
}

// --- ORDER FUNCTIONS ---
function openAddOrderModal() {
    hideAllModals();
    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
        modalOverlay.classList.remove('hidden');
        modalOverlay.classList.add('flex', 'items-center', 'justify-center');
    }
    // Populate clients
    const clientSelect = document.getElementById('add-order-client');
    clientSelect.innerHTML = db.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    
    // Populate vehicles
    const vehicleSelect = document.getElementById('add-order-vehicle');
    vehicleSelect.innerHTML = '<option value="">-- Sélectionner un véhicule --</option>' + 
        db.vehicles.map(v => `<option value="${v.id}">${v.plate} - ${v.model}</option>`).join('');
    
    // Populate drivers
    const driverSelect = document.getElementById('add-order-driver');
    driverSelect.innerHTML = '<option value="">-- Sélectionner un chauffeur --</option>' + 
        db.drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    
    // Set default dates
    document.getElementById('add-order-load-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('add-order-delivery-date').value = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    
    // Set default reference
    const nextNum = db.orders.length + 1;
    document.getElementById('add-order-ref').value = `CMD-${new Date().getFullYear()}-${String(nextNum).padStart(3, '0')}`;
    
    document.getElementById('add-order-modal').classList.remove('hidden');
}

function closeAddOrderModal() {
    hideAllModals();
}

async function submitAddOrder() {
    const newOrder = {
        id: Math.max(...db.orders.map(o => o.id), 0) + 1,
        ref: document.getElementById('add-order-ref').value,
        client_id: parseInt(document.getElementById('add-order-client').value),
        cargo: document.getElementById('add-order-cargo').value,
        origin: document.getElementById('add-order-origin').value,
        dest: document.getElementById('add-order-dest').value,
        load_date: document.getElementById('add-order-load-date').value,
        delivery_date: document.getElementById('add-order-delivery-date').value,
        vehicle_id: document.getElementById('add-order-vehicle').value ? parseInt(document.getElementById('add-order-vehicle').value) : null,
        driver_id: document.getElementById('add-order-driver').value ? parseInt(document.getElementById('add-order-driver').value) : null,
        weight: parseFloat(document.getElementById('add-order-weight').value) || 0,
        pallet_type: document.getElementById('add-order-pallet-type').value,
        pallet_exchange: document.getElementById('add-order-pallet-exchange').checked,
        price: parseFloat(document.getElementById('add-order-price').value) || 0,
        status: 'Planifié'
    };
    
    if (newOrder.client_id && newOrder.origin && newOrder.dest && newOrder.load_date) {
        await apiFetch('orders', { method: 'POST', body: newOrder });
        await fetchAllData();
        showToast('Commande créée avec succès ! Elle apparaît maintenant dans le planning.', 'success');
        closeAddOrderModal();
        router('planning');
    } else {
        showToast('Veuillez remplir les champs obligatoires', 'error');
    }
}

// --- EDIT ORDER FUNCTIONS ---
function openEditOrderModal(orderId) {
    hideAllModals();
    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
        modalOverlay.classList.remove('hidden');
        modalOverlay.classList.add('flex', 'items-center', 'justify-center');
    }
    const order = db.orders.find(o => o.id === orderId);
    if (!order) return;
    
    document.getElementById('edit-order-id').value = orderId;
    document.getElementById('edit-order-ref-display').textContent = order.ref || orderId;
    document.getElementById('edit-order-ref').value = order.ref || '';
    
    // Populate clients
    const clientSelect = document.getElementById('edit-order-client');
    clientSelect.innerHTML = db.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    clientSelect.value = order.client_id || '';
    
    // Populate vehicles
    const vehicleSelect = document.getElementById('edit-order-vehicle');
    vehicleSelect.innerHTML = '<option value="">-- Sélectionner un véhicule --</option>' + 
        db.vehicles.map(v => `<option value="${v.id}">${v.plate} - ${v.model}</option>`).join('');
    vehicleSelect.value = order.vehicle_id || '';
    
    // Populate drivers
    const driverSelect = document.getElementById('edit-order-driver');
    driverSelect.innerHTML = '<option value="">-- Sélectionner un chauffeur --</option>' + 
        db.drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    driverSelect.value = order.driver_id || '';
    
    document.getElementById('edit-order-cargo').value = order.cargo || '';
    document.getElementById('edit-order-origin').value = order.origin || '';
    document.getElementById('edit-order-dest').value = order.dest || '';
    document.getElementById('edit-order-load-date').value = order.load_date || '';
    document.getElementById('edit-order-delivery-date').value = order.delivery_date || '';
    document.getElementById('edit-order-weight').value = order.weight || '';
    document.getElementById('edit-order-pallet-type').value = order.pallet_type || 'palette_europe';
    document.getElementById('edit-order-price').value = order.price || '';
    document.getElementById('edit-order-pallet-exchange').checked = order.pallet_exchange || false;
    document.getElementById('edit-order-status').value = order.status || 'Planifié';
    
    document.getElementById('edit-order-modal').classList.remove('hidden');
}

function closeEditOrderModal() {
    hideAllModals();
}

async function submitEditOrder() {
    const orderId = parseInt(document.getElementById('edit-order-id').value);
    const order = db.orders.find(o => o.id === orderId);
    
    if (order) {
        const updatedOrder = {
            ...order,
            ref: document.getElementById('edit-order-ref').value,
            client_id: parseInt(document.getElementById('edit-order-client').value),
            cargo: document.getElementById('edit-order-cargo').value,
            origin: document.getElementById('edit-order-origin').value,
            dest: document.getElementById('edit-order-dest').value,
            load_date: document.getElementById('edit-order-load-date').value,
            delivery_date: document.getElementById('edit-order-delivery-date').value,
            vehicle_id: document.getElementById('edit-order-vehicle').value ? parseInt(document.getElementById('edit-order-vehicle').value) : null,
            driver_id: document.getElementById('edit-order-driver').value ? parseInt(document.getElementById('edit-order-driver').value) : null,
            weight: parseFloat(document.getElementById('edit-order-weight').value) || 0,
            pallet_type: document.getElementById('edit-order-pallet-type').value,
            pallet_exchange: document.getElementById('edit-order-pallet-exchange').checked,
            price: parseFloat(document.getElementById('edit-order-price').value) || 0,
            status: document.getElementById('edit-order-status').value
        };

        await apiFetch(`orders/${orderId}`, { method: 'PUT', body: updatedOrder });
        await fetchAllData();
        
        showToast('Commande mise à jour avec succès', 'success');
        closeEditOrderModal();
        router('planning');
    } else {
        showToast('Commande non trouvée', 'error');
    }
}

function deleteOrder() {
    const orderId = parseInt(document.getElementById('edit-order-id').value);
    const orderIndex = db.orders.findIndex(o => o.id === orderId);
    
    if (orderIndex !== -1) {
        if (confirm('Êtes-vous sûr de vouloir supprimer cette commande ?')) {
            db.orders.splice(orderIndex, 1);
            showToast('Commande supprimée avec succès', 'success');
            closeEditOrderModal();
            router('planning');
        }
    }
}
