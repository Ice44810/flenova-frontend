/**
 * Utilitaires sécurité frontend — échappement HTML et cache utilisateur minimal.
 */
function escapeHtml(value) {
    if (value === undefined || value === null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeHtmlAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

function sanitizeUrlForDisplay(url) {
    if (!url) return '';
    const s = String(url).trim();
    if (s.startsWith('/') || s.startsWith('https://') || s.startsWith('http://')) {
        return escapeHtmlAttr(s);
    }
    return '';
}

/** Ne conserve que les champs UI non sensibles en localStorage. */
function sanitizeUserForStorage(user) {
    if (!user || typeof user !== 'object') return null;
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        driver_id: user.driver_id ?? null,
        company_id: user.company_id,
        company_name: user.company_name || null
    };
}

function clearUserCache() {
    try {
        localStorage.removeItem('user');
    } catch (e) {
        /* ignore */
    }
}

/** Préfixe les uploads protégés par l'API authentifiée. */
function resolveProtectedUploadUrl(url) {
    if (!url) return '';
    const s = String(url);
    if (s.startsWith('/api/uploads/')) return s;
    if (s.startsWith('/uploads/')) return `/api${s}`;
    const match = s.match(/\/uploads\/[^\s?#]+/);
    return match ? `/api${match[0]}` : s;
}

window.escapeHtml = escapeHtml;
window.escapeHtmlAttr = escapeHtmlAttr;
window.sanitizeUrlForDisplay = sanitizeUrlForDisplay;
window.sanitizeUserForStorage = sanitizeUserForStorage;
window.clearUserCache = clearUserCache;
window.resolveProtectedUploadUrl = resolveProtectedUploadUrl;
