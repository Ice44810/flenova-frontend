/**
 * Tests unitaires pour la logique d'interception API
 * Chemin: /home/yangue/Documents/Dev/Transfact/Frontend/js/api.test.js
 */

// Simulation de l'environnement navigateur
const API_URL = 'http://localhost:3000/api';

describe('apiFetch Interceptor', () => {
    beforeEach(() => {
        fetch.resetMocks();
        jest.clearAllMocks();
        
        // Mock de window.location
        delete window.location;
        window.location = { 
            pathname: '/index.html',
            href: '' 
        };

        // Mock de localStorage
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

    it('ne devrait pas tenter de rafraîchir le token sur les routes d\'authentification (401)', async () => {
        fetch.mockResponseOnce(JSON.stringify({ error: 'Auth failed' }), { status: 401 });

        const response = await apiFetch('auth/login');
        
        expect(response.status).toBe(401);
        expect(fetch).toHaveBeenCalledTimes(1); // Pas d'appel à /auth/refresh
    });

    it('devrait rafraîchir le token et rejouer la requête initiale en cas de TOKEN_EXPIRED', async () => {
        // 1. Échec initial (401 Expired)
        fetch.mockResponseOnce(JSON.stringify({ error: 'TOKEN_EXPIRED' }), { status: 401 });
        // 2. Succès du Refresh
        fetch.mockResponseOnce(JSON.stringify({ success: true }), { status: 200 });
        // 3. Succès de la requête rejouée
        fetch.mockResponseOnce(JSON.stringify({ data: 'final-data' }), { status: 200 });

        const response = await apiFetch('protected-resource');
        const result = await response.json();

        expect(result.data).toBe('final-data');
        expect(fetch).toHaveBeenCalledTimes(3);
        // Vérifie que le 2ème appel était bien le refresh
        expect(fetch.mock.calls[1][0]).toBe(`${API_URL}/auth/refresh`);
    });

    it('devrait déconnecter l\'utilisateur si le rafraîchissement échoue', async () => {
        fetch.mockResponseOnce(JSON.stringify({ error: 'TOKEN_EXPIRED' }), { status: 401 });
        fetch.mockResponseOnce(JSON.stringify({ error: 'Refresh failed' }), { status: 401 });

        await expect(apiFetch('protected-resource')).rejects.toThrow('Session expirée');
        
        expect(window.localStorage.clear).toHaveBeenCalled();
        expect(window.location.href).toBe('/login.html');
    });

    it('devrait mettre en file d\'attente les requêtes concurrentes pendant un rafraîchissement', async () => {
        // Configuration des mocks pour simuler un délai de rafraîchissement
        fetch.mockResponseOnce(JSON.stringify({ error: 'TOKEN_EXPIRED' }), { status: 401 }); // Req 1: 401
        fetch.mockResponseOnce(JSON.stringify({ error: 'TOKEN_EXPIRED' }), { status: 401 }); // Req 2: 401
        
        // Mock du refresh qui prend un peu de temps
        fetch.mockResponseOnce(async () => {
            return { body: JSON.stringify({ success: true }), status: 200 };
        });

        fetch.mockResponseOnce(JSON.stringify({ data: 'result-1' })); // Retry Req 1
        fetch.mockResponseOnce(JSON.stringify({ data: 'result-2' })); // Retry Req 2

        const [res1, res2] = await Promise.all([
            apiFetch('url1'),
            apiFetch('url2')
        ]);

        const d1 = await res1.json();
        const d2 = await res2.json();

        expect(d1.data).toBe('result-1');
        expect(d2.data).toBe('result-2');
        // 2 erreurs initiales + 1 refresh + 2 retries = 5 appels au total
        expect(fetch).toHaveBeenCalledTimes(5);
    });

    it('devrait rejeter l\'erreur en cas de problème réseau', async () => {
        const networkError = new Error('DNS lookup failed');
        fetch.mockRejectOnce(networkError);

        await expect(apiFetch('endpoint')).rejects.toThrow('DNS lookup failed');
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});