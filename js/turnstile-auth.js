/**
 * Cloudflare Turnstile — chargement optionnel pour login / inscription.
 */
let turnstileWidgetId = null;
let turnstileRequired = false;

async function fetchTurnstileSiteKey() {
    try {
        const res = await fetch('/api/auth/security-config', { credentials: 'same-origin' });
        if (!res.ok) return null;
        const data = await res.json();
        return data.turnstileSiteKey || null;
    } catch {
        return null;
    }
}

function loadTurnstileScript() {
    return new Promise((resolve, reject) => {
        if (window.turnstile) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Turnstile indisponible'));
        document.head.appendChild(script);
    });
}

async function initTurnstileWidget(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return false;

    const siteKey = await fetchTurnstileSiteKey();
    if (!siteKey) return false;

    await loadTurnstileScript();
    turnstileRequired = true;
    container.classList.remove('hidden');
    turnstileWidgetId = window.turnstile.render(`#${containerId}`, { sitekey: siteKey });
    return true;
}

function getTurnstileToken() {
    if (!turnstileRequired || !window.turnstile || turnstileWidgetId == null) return undefined;
    const token = window.turnstile.getResponse(turnstileWidgetId);
    return token || undefined;
}

function resetTurnstileWidget() {
    if (turnstileWidgetId != null && window.turnstile) {
        window.turnstile.reset(turnstileWidgetId);
    }
}

window.initTurnstileWidget = initTurnstileWidget;
window.getTurnstileToken = getTurnstileToken;
window.resetTurnstileWidget = resetTurnstileWidget;
