/**
 * Notifications légères pour les pages d'authentification autonomes
 * (connexion, mot de passe oublié, réinitialisation, confirmation d'adresse).
 */
(function (global) {
    const COLORS = { success: 'green', error: 'red', info: 'blue' };
    const ICONS = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        info: 'fa-info-circle'
    };

    global.showToast = function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const color = COLORS[type] || COLORS.info;
        const toast = document.createElement('div');
        toast.className = `toast border-${color}-500`;
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

        const icon = document.createElement('i');
        icon.className = `fa-solid ${ICONS[type] || ICONS.info} text-${color}-500 text-xl mr-3`;
        icon.setAttribute('aria-hidden', 'true');

        const label = document.createElement('span');
        label.className = 'text-sm text-gray-700';
        // textContent et non innerHTML : ces messages proviennent de l'API et
        // peuvent contenir des saisies utilisateur.
        label.textContent = message;

        toast.appendChild(icon);
        toast.appendChild(label);
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 5000);
    };
})(window);
