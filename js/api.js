/**
 * Transfact API Wrapper
 * Global fetch interceptor with automatic 401 handling & token refresh
 */
const API_URL = '/api';

let isRefreshing = false;
let refreshSubscribers = [];

function onRefreshed() {
    refreshSubscribers.forEach(cb => cb());
    refreshSubscribers = [];
}

function addRefreshSubscriber(cb) {
    refreshSubscribers.push(cb);
}

async function apiFetch(url, options = {}) {
    const fullUrl = url.startsWith('http') ? url : `${API_URL}/${url}`;

    const isFormData = options.body instanceof FormData;
    const headers = { ...options.headers };
    
    // On ne définit le JSON par défaut que si ce n'est pas un envoi de fichier (FormData)
    if (!isFormData && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    const fetchOptions = { ...options, headers, credentials: 'include' };
    if (options.body && typeof options.body === 'object' && !isFormData) {
        fetchOptions.body = JSON.stringify(options.body);
    }

    try {
        let response = await fetch(fullUrl, fetchOptions);

        // Routes d'authentification ou de vérification de session
        // On ne tente pas de rafraîchir le token sur ces routes pour éviter les boucles d'erreurs au démarrage
        const isAuthRoute = url.includes('auth/login') || url.includes('auth/register') || url.includes('auth/refresh') || url.includes('auth/me');
        const isAuthPage = window.location.pathname.endsWith('login.html') || window.location.pathname.endsWith('register.html');

        if (response.status === 401 && isAuthRoute) return response;

        if (response.status === 401 && !isAuthRoute) {
            // Cloner la réponse pour pouvoir la lire sans bloquer les retours ultérieurs
            const responseClone = response.clone();
            const errorData = await responseClone.json().catch(() => ({}));

            // Liste des erreurs qui doivent déclencher une tentative de rafraîchissement
            const shouldTryRefresh = 
                errorData.error === 'TOKEN_EXPIRED' || 
                errorData.error === 'TOKEN_MISSING' ||
                errorData.error?.toLowerCase().includes('expir') || 
                errorData.error?.toLowerCase().includes('manquant') ||
                errorData.error?.toLowerCase().includes('expired') ||
                errorData.error?.toLowerCase().includes('missing');

            if (shouldTryRefresh) {
                if (isAuthPage) return response; // Ne pas rediriger si on est déjà sur login/register

                if (!isRefreshing) {
                    isRefreshing = true;
                    try {
                        const refreshResponse = await fetch(`${API_URL}/auth/refresh`, {
                            method: 'POST',
                            credentials: 'include'
                        });

                        if (!refreshResponse.ok) {
                            throw new Error('Refresh failed');
                        }

                        isRefreshing = false;
                        onRefreshed();

                        // Retry original request
                        response = await fetch(fullUrl, fetchOptions);
                    } catch (refreshErr) {
                        isRefreshing = false;
                        refreshSubscribers = [];
                        logout();
                        if (!isAuthPage) window.location.href = '/login.html';
                        return Promise.reject(new Error('Session expirée'));
                    }
                } else {
                    // Wait for refresh to complete then retry
                    return new Promise((resolve) => {
                        addRefreshSubscriber(() => {
                            resolve(fetch(fullUrl, fetchOptions));
                        });
                    });
                }
            } else if (errorData.error?.includes('révoquée')) {
                // Si la session est explicitement révoquée, on déconnecte sans tenter de refresh
                logout();
                return Promise.reject(new Error('Session révoquée'));
            } else {
                logout();
                if (!isAuthPage) window.location.href = '/login.html';
                return Promise.reject(new Error('Accès refusé'));
            }
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
