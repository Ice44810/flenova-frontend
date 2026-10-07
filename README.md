# Flenova Frontend

Interface web TMS (HTML / CSS / JavaScript vanilla + Tailwind).

```bash
git clone git@github.com:Ice44810/flenova-frontend.git
cd flenova-frontend
```

## Prérequis

- Node.js 18+ (build CSS uniquement)

## Développement

```bash
npm install
npm run watch:css   # Tailwind en mode watch
```

### Connexion à l'API

Par défaut, le client appelle `/api` (même origine). Deux cas :

**1. nginx en production (recommandé)**

```
https://app.domaine.com/     → fichiers statiques (ce dépôt)
https://app.domaine.com/api  → proxy vers le backend
```

**2. Dev local sans nginx**

Lancer le backend avec `FRONTEND_PATH` pointant vers ce dossier, **ou** définir l'URL API avant les scripts :

```html
<script>window.FLENOVA_API_URL = 'http://localhost:3000/api';</script>
```

(dans `index.html`, avant `js/api.js`)

## Build production

```bash
npm ci
npm run build:css
npm run version:assets   # ajoute ?v=<empreinte> aux CSS/JS dans les pages HTML
```

`version:assets` doit être relancé (puis commité) après toute modification d'un fichier
`css/` ou `js/` : chaque fichier modifié change d'URL, les navigateurs ne peuvent donc pas
garder l'ancienne version en cache. La CI échoue si les versions ne sont pas à jour.

Déployer le contenu du dossier (hors `node_modules/`, `src/`) vers `/var/www/flenova-frontend` ou équivalent.

## nginx (dépôts séparés)

Exemple dans `deploy/nginx/nginx.conf` :

- `/` → fichiers statiques
- `/api/*` → proxy `127.0.0.1:3000`

## CI

Le workflow GitHub Actions vérifie le build Tailwind à chaque push sur `main`.

## Dépôts associés

| Dépôt | Rôle |
|-------|------|
| **flenova-backend** | API REST |
| **flenova-mobile** | App chauffeur |
