/**
 * RBAC Frontend — miroir des permissions backend
 */
const PERM_ACTIONS = {
    VIEW: 'view',
    CREATE: 'create',
    EDIT: 'edit',
    DELETE: 'delete',
    ASSIGN: 'assign',
    CHANGE_STATUS: 'change_status',
    UPLOAD_DOCUMENT: 'upload_document',
    GENERATE_INVOICE: 'generate_invoice',
    MANAGE_USERS: 'manage_users',
    VALIDATE_TRANSPORT: 'validate_transport',
    EXPORT: 'export'
};

const PERM_MODULES = {
    DASHBOARD: 'dashboard',
    TRANSPORTS: 'transports',
    PLANNING: 'planning',
    STATUSES: 'statuses',
    DOCUMENTS: 'documents',
    COMMENTS: 'comments',
    CLIENTS: 'clients',
    CARRIERS: 'carriers',
    BILLING: 'billing',
    REPORTS: 'reports',
    SETTINGS: 'settings',
    USERS: 'users'
};

let cachedPermissions = null;

function normalizeRole(role) {
    const map = { manager: 'exploitant', user: 'lecture' };
    return map[role] || role || 'lecture';
}

function getUserRole() {
    return normalizeRole(typeof currentUser !== 'undefined' ? currentUser?.role : null);
}

function setPermissionsFromServer(permPayload) {
    cachedPermissions = permPayload;
}

async function loadPermissions() {
    try {
        const res = await apiFetch('auth/permissions');
        if (res.ok) {
            const data = await res.json();
            cachedPermissions = data;
            return data;
        }
    } catch (e) { /* ignore */ }
    return null;
}

function can(module, action) {
    if (cachedPermissions?.modules?.[module]) {
        return cachedPermissions.modules[module].includes(action);
    }
    return fallbackCan(getUserRole(), module, action);
}

/** Fallback si /auth/permissions indisponible */
function fallbackCan(role, module, action) {
    const matrix = {
        admin: { transports: ['view','create','edit','delete','assign','validate_transport'], planning: ['view','edit'], statuses: ['change_status'], documents: ['view','upload_document'], comments: ['view','create'], clients: ['view','create','edit','delete'], carriers: ['view','create','edit','delete','assign'], billing: ['view','create','edit','delete','generate_invoice'], settings: ['view','edit'], users: ['manage_users','view','create','edit','delete'], dashboard: ['view'], reports: ['view'] },
        exploitant: { transports: ['view','create','edit','delete','assign','validate_transport'], planning: ['view','edit'], statuses: ['change_status'], documents: ['view','upload_document'], comments: ['view','create'], clients: ['view','create','edit'], carriers: ['view','assign'], billing: ['view'], dashboard: ['view'], reports: ['view'] },
        comptabilite: { transports: ['view'], documents: ['view'], comments: ['view'], clients: ['view'], carriers: ['view'], billing: ['view','create','edit','generate_invoice'], dashboard: ['view'], reports: ['view'] },
        chauffeur: { transports: ['view'], statuses: ['change_status'], documents: ['view','upload_document'], comments: ['view','create'], dashboard: ['view'] },
        lecture: { transports: ['view'], documents: ['view'], comments: ['view'], clients: ['view'], carriers: ['view'], dashboard: ['view'], reports: ['view'] }
    };
    return (matrix[role]?.[module] || []).includes(action);
}

function canAccessRoute(routeName) {
    const rules = {
        dashboard: ['dashboard', 'view'],
        transports: ['transports', 'view'],
        planning: ['planning', 'view'],
        inprogress_transports: ['transports', 'view'],
        completed_transports: ['transports', 'view'],
        clients: ['clients', 'view'],
        drivers: ['carriers', 'view'],
        fleet: ['carriers', 'view'],
        subcontractors: ['carriers', 'view'],
        preinvoicing: ['billing', 'generate_invoice'],
        sales_invoices: ['billing', 'view'],
        purchase_invoices: ['billing', 'view'],
        admin: ['settings', 'view'],
        margin_dashboard: ['reports', 'view'],
        quotation: ['reports', 'view'],
        invoice_settings: ['settings', 'view'],
        create_invoice: ['billing', 'create']
    };
    const rule = rules[routeName];
    if (!rule) return true;
    return can(rule[0], rule[1]);
}

function getAllowedStatusTransitions() {
    if (cachedPermissions?.statusTransitions?.length) {
        return cachedPermissions.statusTransitions;
    }
    const role = getUserRole();
    const map = {
        admin: ['Brouillon','À planifier','Pris en charge','En cours','Livré','Validé','Clôturé','Planifié','Annulé'],
        exploitant: ['Brouillon','À planifier','Pris en charge','Planifié','Annulé','Affrété'],
        chauffeur: ['Pris en charge','En cours','Livré'],
        comptabilite: [],
        lecture: []
    };
    return map[role] || [];
}

window.PERM = { ACTIONS: PERM_ACTIONS, MODULES: PERM_MODULES, can, canAccessRoute, getUserRole, normalizeRole, loadPermissions, setPermissionsFromServer, getAllowedStatusTransitions };

window.canWriteTransport = () => can(PERM_MODULES.TRANSPORTS, PERM_ACTIONS.CREATE) || can(PERM_MODULES.TRANSPORTS, PERM_ACTIONS.EDIT);
window.canAssignTransport = () => can(PERM_MODULES.TRANSPORTS, PERM_ACTIONS.ASSIGN);
window.canDispatchSubcontractor = () => can(PERM_MODULES.CARRIERS, PERM_ACTIONS.ASSIGN) || can(PERM_MODULES.TRANSPORTS, PERM_ACTIONS.ASSIGN);
window.canValidateTransport = () => can(PERM_MODULES.TRANSPORTS, PERM_ACTIONS.VALIDATE_TRANSPORT);
window.canUploadDocument = () => can(PERM_MODULES.DOCUMENTS, PERM_ACTIONS.UPLOAD_DOCUMENT);
window.canManageFinance = () => can(PERM_MODULES.BILLING, PERM_ACTIONS.GENERATE_INVOICE) || can(PERM_MODULES.BILLING, PERM_ACTIONS.CREATE);
window.canManageInvoices = () => can(PERM_MODULES.BILLING, PERM_ACTIONS.CREATE) || can(PERM_MODULES.BILLING, PERM_ACTIONS.EDIT) || can(PERM_MODULES.BILLING, PERM_ACTIONS.DELETE);
window.canChangeTransportStatus = () => can(PERM_MODULES.STATUSES, PERM_ACTIONS.CHANGE_STATUS);
window.canManageUsers = () => can(PERM_MODULES.USERS, PERM_ACTIONS.MANAGE_USERS);
window.canManageClients = () => can(PERM_MODULES.CLIENTS, PERM_ACTIONS.CREATE);
window.canManageCarriers = () => can(PERM_MODULES.CARRIERS, PERM_ACTIONS.CREATE);
window.isAdmin = () => getUserRole() === 'admin';
window.getUserRole = getUserRole;

window.applyRoleBasedNav = function() {
    document.querySelectorAll('[data-nav-route]').forEach(el => {
        const route = el.dataset.navRoute;
        el.style.display = canAccessRoute(route) ? '' : 'none';
    });
    document.querySelectorAll('[data-role]').forEach(el => {
        const allowed = (el.dataset.role || '').split(',').map(r => r.trim());
        const role = getUserRole();
        if (allowed.includes('all') || allowed.includes(role)) return;
        el.style.display = 'none';
    });
};
