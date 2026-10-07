#!/usr/bin/env node
/**
 * Cache-busting : ajoute ?v=<empreinte du contenu> aux CSS/JS locaux référencés
 * dans les pages HTML. Un fichier modifié change d'URL, donc les navigateurs
 * ne peuvent plus servir une ancienne version depuis leur cache.
 *
 * À lancer après `npm run build:css` et avant chaque déploiement :
 *   npm run version:assets
 * Option --check : échoue (code 1) si une page n'est pas à jour, sans rien écrire.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CHECK = process.argv.includes('--check');

// href="css/x.css" / src="js/x.js" (avec ou sans / initial, avec ou sans ?v= existant)
const ASSET_RE = /((?:href|src)=")(\/?)((?:css|js)\/[^"?#]+\.(?:css|js))(?:\?v=[^"]*)?(")/g;

const hashCache = new Map();
function hashOf(relPath) {
    if (!hashCache.has(relPath)) {
        const abs = path.join(ROOT, relPath);
        if (!fs.existsSync(abs)) {
            hashCache.set(relPath, null);
        } else {
            const digest = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
            hashCache.set(relPath, digest.slice(0, 10));
        }
    }
    return hashCache.get(relPath);
}

const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
let stale = 0;

for (const page of pages) {
    const file = path.join(ROOT, page);
    const before = fs.readFileSync(file, 'utf8');
    const after = before.replace(ASSET_RE, (match, attr, slash, rel, quote) => {
        const hash = hashOf(rel);
        if (!hash) {
            console.warn(`⚠ ${page} : ${rel} introuvable, référence laissée telle quelle`);
            return match;
        }
        return `${attr}${slash}${rel}?v=${hash}${quote}`;
    });
    if (after !== before) {
        stale += 1;
        if (CHECK) {
            console.error(`✗ ${page} : versions d'assets obsolètes`);
        } else {
            fs.writeFileSync(file, after);
            console.log(`✓ ${page}`);
        }
    }
}

if (CHECK && stale) {
    console.error('Lancez `npm run version:assets` puis commitez.');
    process.exit(1);
}
if (!stale) console.log('Versions des assets déjà à jour.');
