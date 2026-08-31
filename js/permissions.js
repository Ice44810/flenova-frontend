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
    RESOLVE: 'resolve',
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
    DISPUTES: 'disputes',
    USERS: 'users'
};

let cachedPermissions = null;
let permissionsLoadFailed = false;

function normalizeRole(role) {
    const key = String(role || '').trim().toLowerCase();
    const map = {
        admin: 'admin',
        administrateur: 'admin',
        dirigeant: 'admin',
        owner: 'admin',
        manager: 'exploitant',
        exploitant: 'exploitant',
        gerant: 'exploitant',
        'gérant': 'exploitant',
        user: 'lecture',
        lecture: 'lecture',
        comptabilite: 'comptabilite',
        comptabilité: 'comptabilite',
        chauffeur: 'chauffeur',
        driver: 'chauffeur'
    };
    return map[key] || key || 'lecture';
}

function getUserRole() {
    return normalizeRole(typeof currentUser !== 'undefined' ? currentUser?.role : null);
}

const PLATFORM_ONLY_ROUTES = new Set(['platform_ops', 'platform_crm']);

function isPlatformOnlyRoute(routeName) {
    return PLATFORM_ONLY_ROUTES.has(routeName);
}

/**
 * Console ops = capacité en plus. Ne remplace jamais le rôle TMS (admin, exploitant…).
 * Une route entreprise n'est jamais réécrite vers platform_ops.
 * Les hashes marketing (site public) ne bloquent pas une session TMS.
 */
const PUBLIC_HASH_TO_APP = {
    home: 'dashboard',
    fonctionnalites: 'dashboard',
    tarifs: 'pricing',
    privacy: 'legal_page',
    terms: 'legal_page',
    cgv: 'legal_page',
    cookies: 'legal_page',
    legal: 'legal_page'
};

const LEGAL_HASH_TYPES = new Set(['privacy', 'terms', 'cgv', 'cookies', 'legal']);

function resolveTenantAppRoute(requestedRoute) {
    const raw = String(requestedRoute || 'dashboard').trim() || 'dashboard';
    // Conserver le document demandé (#cgv, #terms…) : sans ça, legal_page
    // retomberait toujours sur la politique de confidentialité.
    if (LEGAL_HASH_TYPES.has(raw)) {
        window._legalPageType = raw;
    }
    const route = PUBLIC_HASH_TO_APP[raw] || raw;
    if (isPlatformOnlyRoute(route) && !(typeof currentUser !== 'undefined' && currentUser?.isPlatformAdmin)) {
        return 'dashboard';
    }
    return route;
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
            permissionsLoadFailed = false;
            return data;
        }
        permissionsLoadFailed = true;
    } catch (e) {
        permissionsLoadFailed = true;
    }
    return null;
}

function can(module, action) {
    if (cachedPermissions?.modules?.[module]) {
        return cachedPermissions.modules[module].includes(action);
    }
    if (permissionsLoadFailed) return false;
    return fallbackCan(getUserRole(), module, action);
}

/** Fallback si /auth/permissions indisponible */
function fallbackCan(role, module, action) {
    const matrix = {
        admin: { transports: ['view','create','edit','delete','assign','validate_transport'], planning: ['view','edit'], statuses: ['change_status'], documents: ['view','upload_document','delete'], comments: ['view','create'], clients: ['view','create','edit','delete'], carriers: ['view','create','edit','delete','assign'], billing: ['view','create','edit','delete','generate_invoice','export'], settings: ['view','edit'], users: ['manage_users','view','create','edit','delete'], dashboard: ['view'], reports: ['view','export'], disputes: ['view','create','edit','resolve'] },
        exploitant: { transports: ['view','create','edit','delete','assign','validate_transport'], planning: ['view','edit'], statuses: ['change_status'], documents: ['view','upload_document'], comments: ['view','create'], clients: ['view','create','edit'], carriers: ['view','create','edit','delete','assign'], billing: ['view','generate_invoice'], dashboard: ['view'], reports: ['view'], disputes: ['view','create','edit','resolve'] },
        comptabilite: { transports: ['view'], documents: ['view'], comments: ['view'], clients: ['view'], carriers: ['view'], billing: ['view','create','edit','generate_invoice','export'], dashboard: ['view'], reports: ['view','export'], disputes: ['view'] },
        chauffeur: { transports: ['view'], statuses: ['change_status'], documents: ['view','upload_document'], comments: ['view','create'], dashboard: ['view'], disputes: ['view','create'] },
        lecture: { transports: ['view'], documents: ['view'], comments: ['view'], clients: ['view'], carriers: ['view'], dashboard: ['view'], reports: ['view'], disputes: ['view'] }
    };
    return (matrix[role]?.[module] || []).includes(action);
}

function canAccessRoute(routeName) {
    if (isPlatformOnlyRoute(routeName)) {
        return !!(typeof currentUser !== 'undefined' && currentUser?.isPlatformAdmin);
    }
    const openRoutes = new Set(['pricing', 'solutions', 'contact', 'about', 'tracking', 'onboarding', 'feedback']);
    if (openRoutes.has(routeName)) return true;
    if (routeName === 'disputes') {
        if (window.cachedSubscription?.features && typeof planHasFeature === 'function'
            && !planHasFeature('dispute_management')) {
            return false;
        }
        return can('disputes', 'view');
    }

    const rules = {
        dashboard: ['dashboard', 'view'],
        transports: ['transports', 'view'],
        planning: ['planning', 'view'],
        inprogress_transports: ['transports', 'view'],
        completed_transports: ['transports', 'view'],
        closed_transports: ['transports', 'view'],
        cancelled_transports: ['transports', 'view'],
        chartered_transports: ['transports', 'view'],
        disputes: ['disputes', 'view'],
        clients: ['clients', 'view'],
        drivers: ['carriers', 'view'],
        fleet: ['carriers', 'view'],
        subcontractors: ['carriers', 'view'],
        preinvoicing: ['billing', 'generate_invoice'],
        sales_invoices: ['billing', 'view'],
        sales_invoices_validated: ['billing', 'view'],
        sales_invoices_draft: ['billing', 'view'],
        purchase_invoices: ['billing', 'view'],
        accounting_export: ['billing', 'export'],
        admin: ['settings', 'view'],
        margin_dashboard: ['reports', 'view'],
        sustainability: ['reports', 'view'],
        rse_compliance: ['reports', 'view'],
        privacy: ['transports', 'view'],
        legal_page: ['transports', 'view'],
        affretement_confirmation: ['transports', 'view'],
        cmr_preview: ['transports', 'view'],
        quotation: ['reports', 'view'],
        invoice_settings: ['settings', 'view'],
        create_invoice: ['billing', 'create'],
        create_order: ['transports', 'create']
    };
    const rule = rules[routeName];
    if (!rule) return false;
    return can(rule[0], rule[1]);
}

function getAllowedStatusTransitions() {
    if (cachedPermissions?.statusTransitions?.length) {
        return cachedPermissions.statusTransitions;
    }
    const role = getUserRole();
    const map = {
        admin: ['Brouillon','À planifier','Pris en charge','En cours','Livré','Validé','Clôturé','Planifié','Annulé'],
        exploitant: ['Brouillon','À planifier','Pris en charge','En cours','Livré','Planifié','Annulé','Affrété'],
        chauffeur: ['Pris en charge','En cours','Livré'],
        comptabilite: [],
        lecture: []
    };
    return map[role] || [];
}

window.PERM = { ACTIONS: PERM_ACTIONS, MODULES: PERM_MODULES, can, canAccessRoute, getUserRole, normalizeRole, loadPermissions, setPermissionsFromServer, getAllowedStatusTransitions, isPlatformOnlyRoute, resolveTenantAppRoute };
window.isPlatformOnlyRoute = isPlatformOnlyRoute;
window.resolveTenantAppRoute = resolveTenantAppRoute;

window.canDeleteTransport = () => can(PERM_MODULES.TRANSPORTS, PERM_ACTIONS.DELETE);
window.canWriteTransport = () => can(PERM_MODULES.TRANSPORTS, PERM_ACTIONS.CREATE) || can(PERM_MODULES.TRANSPORTS, PERM_ACTIONS.EDIT);
window.canAssignTransport = () => can(PERM_MODULES.TRANSPORTS, PERM_ACTIONS.ASSIGN);
window.canDispatchSubcontractor = () => can(PERM_MODULES.CARRIERS, PERM_ACTIONS.ASSIGN) || can(PERM_MODULES.TRANSPORTS, PERM_ACTIONS.ASSIGN);
window.canValidateTransport = () => can(PERM_MODULES.TRANSPORTS, PERM_ACTIONS.VALIDATE_TRANSPORT);
window.canUploadDocument = () => can(PERM_MODULES.DOCUMENTS, PERM_ACTIONS.UPLOAD_DOCUMENT);
window.canManageFinance = () => can(PERM_MODULES.BILLING, PERM_ACTIONS.GENERATE_INVOICE) || can(PERM_MODULES.BILLING, PERM_ACTIONS.CREATE);
window.canManageInvoices = () => can(PERM_MODULES.BILLING, PERM_ACTIONS.CREATE) || can(PERM_MODULES.BILLING, PERM_ACTIONS.EDIT) || can(PERM_MODULES.BILLING, PERM_ACTIONS.DELETE);
window.canValidateInvoices = () => can(PERM_MODULES.BILLING, PERM_ACTIONS.EDIT) || can(PERM_MODULES.BILLING, PERM_ACTIONS.GENERATE_INVOICE);
window.canExportAccounting = () => can(PERM_MODULES.BILLING, PERM_ACTIONS.EXPORT)
    && (typeof planHasFeature !== 'function' || planHasFeature('accounting_export'));
window.canChangeTransportStatus = () => can(PERM_MODULES.STATUSES, PERM_ACTIONS.CHANGE_STATUS);
window.canManageUsers = () => can(PERM_MODULES.USERS, PERM_ACTIONS.MANAGE_USERS);
window.canManageClients = () => can(PERM_MODULES.CLIENTS, PERM_ACTIONS.CREATE) || can(PERM_MODULES.CLIENTS, PERM_ACTIONS.EDIT);
window.canDeleteClients = () => can(PERM_MODULES.CLIENTS, PERM_ACTIONS.DELETE);
window.canManageCarriers = () => can(PERM_MODULES.CARRIERS, PERM_ACTIONS.CREATE) || can(PERM_MODULES.CARRIERS, PERM_ACTIONS.EDIT);
window.canDeleteCarriers = () => can(PERM_MODULES.CARRIERS, PERM_ACTIONS.DELETE);
window.canManageDisputes = () => can(PERM_MODULES.DISPUTES, PERM_ACTIONS.EDIT)
    || can(PERM_MODULES.DISPUTES, PERM_ACTIONS.RESOLVE);
window.canScanDisputes = () => can(PERM_MODULES.DISPUTES, PERM_ACTIONS.EDIT);
window.isAdmin = () => getUserRole() === 'admin';
window.getUserRole = getUserRole;

function isNavItemVisible(el) {
    return !!el && el.style.display !== 'none';
}

function hideEmptySidebarSections() {
    const nav = document.getElementById('tenant-app-nav');
    if (!nav) return;

    nav.querySelectorAll('.sidebar-group').forEach((group) => {
        const anyVisible = [...group.querySelectorAll('[data-nav-route]')].some(isNavItemVisible);
        group.style.display = anyVisible ? '' : 'none';
    });

    nav.querySelectorAll('p.sidebar-section-label').forEach((label) => {
        const ul = label.nextElementSibling;
        if (!ul || ul.tagName !== 'UL') return;
        const anyVisible = [...ul.querySelectorAll('[data-nav-route]')].some(isNavItemVisible);
        label.style.display = anyVisible ? '' : 'none';
        ul.style.display = anyVisible ? '' : 'none';
    });
}

window.applyRoleBasedNav = function() {
    if (typeof applyPlatformOperatorShell === 'function') applyPlatformOperatorShell(currentUser);
    const tenantNav = document.getElementById('tenant-app-nav');
    if (tenantNav) tenantNav.classList.remove('hidden');
    document.querySelectorAll('#tenant-app-nav [data-nav-route]').forEach(el => {
        const route = el.dataset.navRoute;
        el.style.display = canAccessRoute(route) ? '' : 'none';
    });
    document.querySelectorAll('#platform-operator-nav [data-nav-route]').forEach(el => {
        el.style.display = currentUser?.isPlatformAdmin ? '' : 'none';
    });
    document.querySelectorAll('[data-role]').forEach(el => {
        const allowed = (el.dataset.role || '').split(',').map(r => r.trim());
        const role = getUserRole();
        if (allowed.includes('all') || allowed.includes(role)) {
            el.style.display = '';
            return;
        }
        el.style.display = 'none';
    });
    document.querySelectorAll('[data-perm-module][data-perm-action]').forEach((el) => {
        el.style.display = can(el.dataset.permModule, el.dataset.permAction) ? '' : 'none';
    });
    if (typeof applyPlanBasedNav === 'function') applyPlanBasedNav();
    hideEmptySidebarSections();
};
