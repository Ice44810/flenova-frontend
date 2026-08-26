#!/usr/bin/env node
/**
 * Copie maplibre-gl depuis node_modules vers assets/vendor (self-host, sans unpkg).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkgDir = path.join(ROOT, 'node_modules', 'maplibre-gl', 'dist');
const outDir = path.join(ROOT, 'assets', 'vendor', 'maplibre-gl');

const files = ['maplibre-gl.js', 'maplibre-gl.css'];

if (!fs.existsSync(pkgDir)) {
  console.error('maplibre-gl introuvable — exécutez npm ci dans Frontend/');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
for (const file of files) {
  const src = path.join(pkgDir, file);
  if (!fs.existsSync(src)) {
    console.error(`Fichier manquant : ${src}`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(outDir, file));
}
console.log('✓ MapLibre copié vers assets/vendor/maplibre-gl/');
