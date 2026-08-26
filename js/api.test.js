/**
 * Tests unitaires pour la logique d'interception API
 */

const API_URL = 'http://localhost:3000/api';

describe('apiFetch Interceptor', () => {
    beforeEach(() => {
        fetch.resetMocks();
        jest.clearAllMocks();
        
        delete window.location;
        window.location = { 
            pathname: '/index.html',
            href: '' 
        };

        Object.defineProperty(window, 'localStorage', {
            value: {
                clear: jest.fn(),
                getItem: jest.fn(),
                setItem: jest.fn(),
                removeItem: jest.fn(),
            },
            writable: true
        });
    });

    it('devrait effectuer une requête standard avec succès', async () => {
        fetch.mockResponseOnce(JSON.stringify({ data: 'success' }));

        const response = await apiFetch('test-endpoint');
        const result = await response.json();

        expect(result.data).toBe('success');
        expect(fetch).toHaveBeenCalledWith(`${API_URL}/test-endpoint`, expect.any(Object));
    });

    it('ne devrait pas rediriger sur les routes d\'authentification (401)', async () => {
        fetch.mockResponseOnce(JSON.stringify({ error: 'Auth failed' }), { status: 401 });

        const response = await apiFetch('auth/login');
        
        expect(response.status).toBe(401);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('devrait déconnecter l\'utilisateur si la session est expirée (401)', async () => {
        fetch.mockResponseOnce(JSON.stringify({ error: 'Token manquant' }), { status: 401 });
        fetch.mockResponseOnce(JSON.stringify({ success: true }), { status: 200 });

        await expect(apiFetch('protected-resource')).rejects.toThrow('Session expirée');
        
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch.mock.calls[1][0]).toBe(`${API_URL}/auth/logout`);
        expect(window.location.href).toBe('/login.html');
    });

    it('ne devrait pas déconnecter sur 402 (abonnement suspendu)', async () => {
        fetch.mockResponseOnce(JSON.stringify({ error: 'Abonnement actif requis' }), { status: 402 });

        const response = await apiFetch('transport-orders');

        expect(response.status).toBe(402);
        expect(window.location.href).toBe('');
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('devrait rejeter l\'erreur en cas de problème réseau', async () => {
        const networkError = new Error('DNS lookup failed');
        fetch.mockRejectOnce(networkError);

        await expect(apiFetch('endpoint')).rejects.toThrow('DNS lookup failed');
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
