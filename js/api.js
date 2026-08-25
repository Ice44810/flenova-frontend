/**
 * Flenova API Wrapper
 * Global fetch interceptor with automatic 401 handling
 */
/** Override en dev statique : window.FLENOVA_API_URL = 'http://localhost:3000/api' */
const API_URL = (typeof window !== 'undefined' && window.FLENOVA_API_URL) || '/api';

async function apiFetch(url, options = {}) {
    const fullUrl = url.startsWith('http') ? url : `${API_URL}/${url}`;

    const isFormData = options.body instanceof FormData;
    const headers = { ...options.headers };
    
    if (!isFormData && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    const fetchOptions = { ...options, headers, credentials: 'include' };
    if (options.body && typeof options.body === 'object' && !isFormData) {
        fetchOptions.body = JSON.stringify(options.body);
    }

    // Ces routes gèrent elles-mêmes leurs réponses d'erreur : les intercepter
    // déclencherait une déconnexion ou une redirection intempestive sur des
    // pages où l'utilisateur n'a précisément pas encore de session.
    const AUTH_ROUTES = [
        'auth/login', 'auth/register', 'auth/me',
        'auth/forgot-password', 'auth/reset-password',
        'auth/verify-email', 'auth/resend-verification'
    ];
    const AUTH_PAGES = [
        'login.html', 'register.html',
        'forgot-password.html', 'reset-password.html', 'verify-email.html'
    ];
    const isAuthRoute = AUTH_ROUTES.some((route) => url.includes(route));
    const isAuthPage = AUTH_PAGES.some((page) => window.location.pathname.endsWith(page));

    try {
        const response = await fetch(fullUrl, fetchOptions);

        if (response.status === 401 && isAuthRoute) return response;

        if (response.status === 401 && !isAuthRoute) {
            if (!isAuthPage) {
                logout();
            }
            return Promise.reject(new Error('Session expirée'));
        }

        if (response.status === 403 && !isAuthRoute && !isAuthPage) {
            return response;
        }

        return response;
    } catch (networkErr) {
        console.error('API Error:', networkErr);
        throw networkErr;
    }
}

async function logout() {
    try {
        await fetch(`${API_URL}/auth/logout`, {
            method: 'POST',
            credentials: 'include'
        });
    } catch (e) {
        // Ignore network errors during logout
    }
    localStorage.removeItem('user');
    window.location.href = '/login.html';
}

function getCurrentUser() {
    try {
        return JSON.parse(localStorage.getItem('user'));
    } catch (e) {
        return null;
    }
}

function setCurrentUser(user) {
    const safe = typeof sanitizeUserForStorage === 'function'
        ? sanitizeUserForStorage(user)
        : user;
    if (safe) {
        localStorage.setItem('user', JSON.stringify(safe));
    }
}
