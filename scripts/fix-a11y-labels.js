#!/usr/bin/env node
/**
 * Associe les <label> aux champs (for/id) et ajoute aria-label sur les boutons fermer icône.
 */
const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../index.html');
let html = fs.readFileSync(target, 'utf8');

html = html.replace(
    /<label([^>]*?)>([\s\S]*?)<\/label>\s*<(input|select|textarea)([^>]*?\sid="([^"]+)"[^>]*>)/gi,
    (match, labelAttrs, labelText, tag, rest, id) => {
        if (/for\s*=/.test(labelAttrs)) return match;
        if (/<input|<select|<textarea/i.test(labelText)) return match;
        return `<label for="${id}"${labelAttrs}>${labelText}</label>\n                    <${tag}${rest}`;
    }
);

html = html.replace(
    /<button([^>]*onclick="close[^"]*"[^>]*)>\s*<i class="fa-solid fa-(times|xmark)[^"]*"[^>]*>\s*<\/i>\s*<\/button>/gi,
    (match, attrs) => {
        if (/aria-label/.test(attrs)) return match;
        const type = /type="([^"]+)"/.exec(attrs);
        const typeAttr = type ? '' : ' type="button"';
        return `<button${typeAttr}${attrs} aria-label="Fermer"><i class="fa-solid fa-times text-xl" aria-hidden="true"></i></button>`;
    }
);

html = html.replace(
    /<button([^>]*onclick="close[^"]*"[^>]*)>\s*<i class="fa-solid fa-xmark[^"]*"[^>]*>\s*<\/i>\s*<\/button>/gi,
    (match, attrs) => {
        if (/aria-label/.test(attrs)) return match;
        const typeAttr = /type=/.test(attrs) ? '' : ' type="button"';
        return `<button${typeAttr}${attrs} aria-label="Fermer"><i class="fa-solid fa-xmark text-xl" aria-hidden="true"></i></button>`;
    }
);

fs.writeFileSync(target, html);
console.log('index.html — labels et boutons fermer corrigés');
