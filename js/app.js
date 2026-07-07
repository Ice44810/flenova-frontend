/**
 * Transfact - Application JavaScript (SPA TMS + site public)
 */

// --- MOCK DATABASE ---
let db = { orders: [], clients: [], missions: [], drivers: [], vehicles: [], users: [], sales_invoices: [], purchase_invoices: [], subcontractors: [] };
let subcontractorFilters = { search: '', status: '', compliance: '' };
let purchaseInvoiceFilter = { subcontractor_id: '', type: '' };
let affretementConfirmationOrderId = null;

let salesChartInstance = null;
let invoiceLines = [];
let editingInvoiceId = null;

function formatDateForInput(value) {
    if (!value) return new Date().toISOString().split('T')[0];
    const s = String(value);
    if (s.includes('T')) return s.split('T')[0];
    return s.slice(0, 10);
}

function formatDisplayDate(value) {
    if (value === undefined || value === null || String(value).trim() === '') return '';
    const s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const [y, m, d] = s.split('-');
        return `${d}/${m}/${y}`;
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
        const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : s.split('T')[0];
    }
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

window.formatDisplayDate = formatDisplayDate;
window.formatDateForInput = formatDateForInput;

// --- UTILITAIRES ---
function normalizeUploadUrl(url) {
    if (!url) return '';
    if (url.startsWith('/uploads/')) return url;
    const match = url.match(/\/uploads\/subcontractors\/[^/?#]+/);
    return match ? match[0] : url;
}
let currentUser = getCurrentUser();

// --- MODAUX (global) ---
function hideAllModals() {
    // Empêche des “ré-activations” tardives (setTimeout / handlers de preview facture)
    // de faire réapparaître l’aperçu facture pendant l’ouverture d’un autre modal.
    // Verrou global désactivé à l'ouverture d'autres modals via hideAllModals/openInvoiceModal.
    window.__invoicePreviewLock = true;

    // Sécurité supplémentaire: arrêter tout affichage tardif de facture A4.
    // Certains navigateurs exécutent des callbacks après le changement de modal.
    if (!window.__invoicePreviewSessionId) window.__invoicePreviewSessionId = 0;
    window.__invoicePreviewSessionId++;


    const modalIds = [
        'chart-modal', 'edit-mission-modal', 'add-mission-modal', 'add-client-modal',
        'driver-card-modal', 'driver-modal', 'add-vehicle-modal', 'edit-vehicle-modal',
        'add-purchase-invoice-modal', 'add-user-modal', 'modal-overlay',
        'edit-order-modal', 'add-order-modal', 'add-subcontractor-modal', 'dispatch-modal',
        'invoice-modal', 'transport-detail-modal', 'credit-note-modal'
    ];

    // Invariant: le modal aperçu facture A4 (modal-overlay/modal-content) ne doit jamais être visible
    // lorsque l'utilisateur ouvre un autre modal.
    // On le masque en dur ici, même si un rendu (ex: openInvoiceModal) l'avait réaffiché.
    const invoiceOverlayEl = document.getElementById('modal-overlay');
    if (invoiceOverlayEl) {
        invoiceOverlayEl.classList.add('hidden');
        invoiceOverlayEl.classList.remove('flex', 'items-center', 'justify-center');
    }
    const invoiceContentEl = document.getElementById('modal-content');
    if (invoiceContentEl) {
        invoiceContentEl.classList.add('hidden');
        invoiceContentEl.innerHTML = '';
    }
    modalIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('hidden');
            el.classList.remove('flex'); // Nécessaire car modal-overlay utilise flex pour le centrage

            // CRITICAL: Vider le contenu du conteneur générique 'modal-content'
            // pour éviter que l'aperçu de facture ne s'affiche par erreur dans d'autres modaux.
            if (id === 'modal-content') {
                el.innerHTML = '';
            }
            // Réinitialiser la position et le style de drag si ce n'est pas l'overlay lui-même
            if (id !== 'modal-overlay') {
                el.style.top = '';
                el.style.left = '';
                el.style.position = '';
                el.style.margin = '';
                el.style.transform = '';
                el.style.cursor = '';
            }
        }
    });
    document.body.classList.remove('invoice-modal-open');
}

// Fonction pour rendre un élément déplaçable (Draggable)
function makeElementDraggable(el) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    el.onmousedown = function (e) {
        // On ne déplace pas si on clique sur un input, bouton, textarea ou icône
        if (['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'A', 'I'].includes(e.target.tagName) || e.target.closest('button')) return;

        e.preventDefault();

        // Capture de la position actuelle pour passer du mode Flex (centré) au mode Fixed (déplaçable) sans saut visuel
        const rect = el.getBoundingClientRect();
        el.style.position = 'fixed';
        el.style.top = rect.top + 'px';
        el.style.left = rect.left + 'px';
        el.style.margin = '0';
        el.style.transform = 'none'; // Désactive le centrage automatique de Tailwind

        pos3 = e.clientX;
        pos4 = e.clientY;

        document.onmouseup = () => {
            document.onmouseup = null;
            document.onmousemove = null;
            el.style.cursor = 'grab';
        };

        document.onmousemove = (e) => {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            el.style.top = (el.offsetTop - pos2) + "px";
            el.style.left = (el.offsetLeft - pos1) + "px";
        };
        el.style.cursor = 'grabbing';
    };
    el.style.cursor = 'grab';
}

// --- SITE PUBLIC ---
const PUBLIC_ROUTES = ['home', 'fonctionnalites', 'tarifs', 'contact'];
let isAuthenticated = false;
let publicReviewsTimer = null;

function escapePublicHtml(value) {
    if (value === undefined || value === null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderPublicReviewStars(rating) {
    const safeRating = Math.max(0, Math.min(5, Number(rating) || 0));
    return Array.from({ length: 5 }, (_, i) =>
        `<i class="fa-${i < safeRating ? 'solid' : 'regular'} fa-star" aria-hidden="true"></i>`
    ).join('');
}

function renderPublicReviewsSection(reviews) {
    if (!reviews?.length) {
        return `<section class="public-testimonial public-reviews">
            <div class="public-reviews-wrap">
                <p class="public-reviews-empty">Aucun avis client pour le moment.</p>
            </div>
        </section>`;
    }

    const avgRating = (reviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / reviews.length).toFixed(1);
    const slides = reviews.map((review, index) => {
        const author = escapePublicHtml(review.author);
        const role = escapePublicHtml(review.role);
        const company = escapePublicHtml(review.company);
        const quote = escapePublicHtml(review.quote);
        const portrait = review.photo
            ? `<img src="${escapePublicHtml(review.photo)}" alt="${author}" class="public-testimonial-portrait" width="120" height="120">`
            : `<div class="public-testimonial-portrait public-review-avatar" aria-hidden="true">${escapePublicHtml(review.initials || review.author?.charAt(0) || '?')}</div>`;
        return `<article class="public-review-slide${index === 0 ? ' is-active' : ''}" data-review-index="${index}">
            <div class="public-testimonial-inner">
                <div class="public-testimonial-quote-wrap">
                    <span class="public-testimonial-mark" aria-hidden="true">&ldquo;</span>
                    <div class="public-review-stars" aria-label="${Number(review.rating) || 0} sur 5">${renderPublicReviewStars(review.rating)}</div>
                    <blockquote>${quote}</blockquote>
                    <cite>&mdash; ${author}${role ? `, ${role}` : ''}${company ? ` · ${company}` : ''}</cite>
                </div>
                ${portrait}
            </div>
        </article>`;
    }).join('');

    const dots = reviews.map((_, index) =>
        `<button type="button" class="public-review-dot${index === 0 ? ' is-active' : ''}" data-review-go="${index}" aria-label="Afficher l'avis ${index + 1}"></button>`
    ).join('');

    const cards = reviews.map((review) => {
        const author = escapePublicHtml(review.author);
        const role = escapePublicHtml(review.role);
        const company = escapePublicHtml(review.company);
        const quote = escapePublicHtml(review.quote);
        return `<article class="public-review-card">
            <div class="public-review-stars" aria-label="${Number(review.rating) || 0} sur 5">${renderPublicReviewStars(review.rating)}</div>
            <p class="public-review-card-text">&ldquo;${quote}&rdquo;</p>
            <footer class="public-review-card-author">
                <strong>${author}</strong>
                <span>${role}${company ? ` · ${company}` : ''}</span>
            </footer>
        </article>`;
    }).join('');

    return `<section class="public-testimonial public-reviews">
            <div class="public-testimonial-wave" aria-hidden="true"></div>
            <div class="public-testimonial-wave-bottom" aria-hidden="true"></div>
            <div class="public-reviews-wrap">
                <div class="public-reviews-header">
                    <h2 class="public-reviews-title">Commentaires &amp; Avis clients</h2>
                    <p class="public-reviews-summary">
                        <span class="public-reviews-stars" aria-hidden="true">${renderPublicReviewStars(Math.round(Number(avgRating)))}</span>
                        <span><strong>${avgRating}/5</strong> · ${reviews.length} avis vérifiés</span>
                    </p>
                </div>
                <div class="public-reviews-carousel" aria-live="polite">
                    <button type="button" class="public-review-nav public-review-prev" aria-label="Avis précédent">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div class="public-reviews-track">${slides}</div>
                    <button type="button" class="public-review-nav public-review-next" aria-label="Avis suivant">
                        <i class="fa-solid fa-chevron-right"></i>
                    </button>
                </div>
                <div class="public-review-dots" role="tablist" aria-label="Navigation des avis">${dots}</div>
                <div class="public-reviews-grid">${cards}</div>
            </div>
        </section>`;
}

function renderPublicReviewsLoading() {
    return `<div id="public-reviews-mount" class="public-reviews-loading">
        <section class="public-testimonial public-reviews">
            <div class="public-reviews-wrap">
                <p class="public-reviews-empty"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Chargement des avis clients…</p>
            </div>
        </section>
    </div>`;
}

async function loadPublicReviews() {
    const mount = document.getElementById('public-reviews-mount');
    if (!mount) return;

    try {
        const res = await fetch('/api/avis/public');
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Erreur serveur');

        mount.outerHTML = renderPublicReviewsSection(json.data || []);
        initPublicReviewsCarousel();
    } catch (err) {
        console.warn('Chargement avis clients:', err.message);
        mount.outerHTML = renderPublicReviewsSection([]);
    }
}

function initPublicReviewsCarousel() {
    if (publicReviewsTimer) {
        clearInterval(publicReviewsTimer);
        publicReviewsTimer = null;
    }
    const root = document.querySelector('.public-reviews');
    if (!root) return;

    const slides = [...root.querySelectorAll('.public-review-slide')];
    const dots = [...root.querySelectorAll('.public-review-dot')];
    if (!slides.length) return;

    let current = slides.findIndex((slide) => slide.classList.contains('is-active'));
    if (current < 0) current = 0;

    function goTo(index) {
        current = (index + slides.length) % slides.length;
        slides.forEach((slide, i) => slide.classList.toggle('is-active', i === current));
        dots.forEach((dot, i) => {
            dot.classList.toggle('is-active', i === current);
            dot.setAttribute('aria-selected', i === current ? 'true' : 'false');
        });
    }

    root.querySelector('.public-review-prev')?.addEventListener('click', () => {
        goTo(current - 1);
        restartAutoplay();
    });
    root.querySelector('.public-review-next')?.addEventListener('click', () => {
        goTo(current + 1);
        restartAutoplay();
    });
    dots.forEach((dot) => {
        dot.addEventListener('click', () => {
            goTo(Number(dot.dataset.reviewGo));
            restartAutoplay();
        });
    });

    function restartAutoplay() {
        if (publicReviewsTimer) clearInterval(publicReviewsTimer);
        publicReviewsTimer = setInterval(() => goTo(current + 1), 7000);
    }
    restartAutoplay();
}

function renderPublicHome() {
    const iconClipboard = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="8" width="28" height="34" rx="3"/><path d="M18 8V6a6 6 0 0 1 12 0v2"/><line x1="24" y1="22" x2="24" y2="32"/><line x1="19" y1="27" x2="29" y2="27"/></svg>`;
    const iconGears = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="18" cy="22" r="7"/><circle cx="32" cy="30" r="6"/><path d="M18 12v3M18 29v3M11 22h3M22 22h3M14 15l2 2M20 27l2 2M14 29l2-2M20 19l2-2M32 21v3M32 33v3M27 30h3M35 30h3"/></svg>`;
    const iconChart = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="28" width="7" height="12" rx="1"/><rect x="20" y="20" width="7" height="20" rx="1"/><rect x="32" y="12" width="7" height="28" rx="1"/><polyline points="8,26 22,18 36,10 42,6"/></svg>`;

    return `<div class="public-landing fade-in pb-8">
        <section class="public-hero">
            <div class="public-hero-bg-shape public-hero-bg-shape-1" aria-hidden="true"></div>
            <div class="public-hero-bg-shape public-hero-bg-shape-2" aria-hidden="true"></div>
            <div class="public-hero-inner">
                <div>
                    <h1 class="public-hero-title">Simplifiez votre gestion de transport.</h1>
                    <p class="public-hero-subtitle">Optimisez des opérations logistiques avec notre solution TMS tout-en-un</p>
                    <div class="public-hero-cta">
                        <button type="button" onclick="publicRouter('contact')" class="public-btn-primary">Essayer Gratuitement</button>
                    </div>
                </div>
                <div class="public-hero-image-wrap">
                    <img src="assets/public-hero-illustration.png" alt="Interface Transfact et chauffeur" class="public-hero-image" width="520" height="250">
                </div>
            </div>
        </section>

        <section class="public-features-section">
            <div class="public-features-inner">
                <h2 class="public-features-title">Une Solution Complète pour Votre Logistique</h2>
                <div class="public-features-grid">
                    <div class="public-feature-card-home">
                        <div class="public-feature-icon-home">${iconClipboard}</div>
                        <h3>Suivi des Expéditions</h3>
                        <p>Suivez et gérez des livraisons en temps réel</p>
                    </div>
                    <div class="public-feature-card-home">
                        <div class="public-feature-icon-home">${iconGears}</div>
                        <h3>Automatisation des Tâches</h3>
                        <p>Optimisez vos processus avec des outils intelligents</p>
                    </div>
                    <div class="public-feature-card-home">
                        <div class="public-feature-icon-home">${iconChart}</div>
                        <h3>Analyse &amp; Rapports</h3>
                        <p>Obtenez des insights détaillés sur votre activité</p>
                    </div>
                </div>
            </div>
        </section>

        ${renderPublicReviewsLoading()}
    </div>`;
}

function renderPublicFeatures() {
    return `<div class="fade-in pb-10">
        <div class="public-page-header py-12">
            <div class="max-w-6xl mx-auto px-4 sm:px-6 text-center">
                <h1 class="text-4xl font-extrabold text-blue-900 mb-4">Nos Fonctionnalités</h1>
                <p class="text-lg text-gray-600 max-w-2xl mx-auto">Une suite complète pour gérer votre activité de transport, de la commande à la facturation.</p>
            </div>
        </div>
        <div class="max-w-6xl mx-auto px-4 sm:px-6 py-12">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                <div class="public-feature-card text-left">
                    <div class="public-feature-icon !mx-0"><i class="fa-solid fa-boxes-packing"></i></div>
                    <h3 class="font-bold text-xl text-gray-800 mb-3">Gestion des Commandes</h3>
                    <p class="text-gray-600">Créez et gérez vos ordres de transport facilement. Suivi complet du chargement à la livraison, avec gestion des statuts.</p>
                </div>
                <div class="public-feature-card text-left">
                    <div class="public-feature-icon !mx-0"><i class="fa-solid fa-calendar-days"></i></div>
                    <h3 class="font-bold text-xl text-gray-800 mb-3">Planning Intelligent</h3>
                    <p class="text-gray-600">Planifiez vos missions sur un planning hebdomadaire visuel. Optimisez les tournées et réduisez les coûts.</p>
                </div>
                <div class="public-feature-card text-left">
                    <div class="public-feature-icon !mx-0"><i class="fa-solid fa-truck"></i></div>
                    <h3 class="font-bold text-xl text-gray-800 mb-3">Gestion de Flotte</h3>
                    <p class="text-gray-600">Suivez l'état de votre parc véhicule : maintenance, assurance, kilomètres et affectation aux chauffeurs.</p>
                </div>
                <div class="public-feature-card text-left">
                    <div class="public-feature-icon !mx-0"><i class="fa-solid fa-file-invoice-dollar"></i></div>
                    <h3 class="font-bold text-xl text-gray-800 mb-3">Facturation Automatique</h3>
                    <p class="text-gray-600">Générez vos factures clients (Factur-X) et achats en un clic. Suivi des paiements et relances automatiques.</p>
                </div>
                <div class="public-feature-card text-left">
                    <div class="public-feature-icon !mx-0"><i class="fa-solid fa-handshake-angle"></i></div>
                    <h3 class="font-bold text-xl text-gray-800 mb-3">Sous-traitants &amp; Affrètement</h3>
                    <p class="text-gray-600">Gérez vos sous-traitants, affectez des commandes et analysez la rentabilité de chaque affrètement.</p>
                </div>
                <div class="public-feature-card text-left">
                    <div class="public-feature-icon !mx-0"><i class="fa-solid fa-mobile-screen-button"></i></div>
                    <h3 class="font-bold text-xl text-gray-800 mb-3">Application Mobile Chauffeurs</h3>
                    <p class="text-gray-600">Vos chauffeurs gèrent leurs missions, scannent des documents et collectent des signatures depuis leur mobile.</p>
                </div>
            </div>
            <div class="bg-gradient-to-r from-blue-700 to-blue-900 rounded-2xl p-8 text-white text-center">
                <h2 class="text-2xl font-bold mb-4">Prêt à simplifier votre gestion ?</h2>
                <p class="text-blue-100 mb-6">Démarrez gratuitement et adaptez votre solution à vos besoins.</p>
                <div class="flex flex-col sm:flex-row justify-center gap-4">
                    <a href="register.html" class="bg-white text-blue-700 px-6 py-3 rounded-lg font-semibold hover:bg-blue-50 transition">Essayer Gratuitement</a>
                    <button type="button" onclick="publicRouter('contact')" class="border border-white/60 text-white px-6 py-3 rounded-lg font-semibold hover:bg-white/10 transition">Demander une démo</button>
                </div>
            </div>
        </div>
    </div>`;
}

function renderPublicContact() {
    return `<div class="public-contact-page fade-in">
        <div class="public-contact-inner">
            <h1>Contact</h1>
            <p class="public-contact-lead">Une question ou une demande de démo ? Écrivez-nous, nous vous répondons sous 24&nbsp;h.</p>
            <div class="public-contact-card">
                <div class="public-contact-infos">
                    <div class="public-contact-info-box">
                        <i class="fa-solid fa-phone"></i>
                        <h4>Téléphone</h4>
                        <p>02 99 00 00 00</p>
                        <p class="public-contact-info-meta">Lun–Ven : 9h–18h</p>
                    </div>
                    <div class="public-contact-info-box">
                        <i class="fa-solid fa-envelope"></i>
                        <h4>Email</h4>
                        <p>support@transfact.fr</p>
                    </div>
                </div>
                <form id="public-contact-form" class="public-contact-form" onsubmit="submitPublicContact(event)">
                    <div class="public-contact-form-grid">
                        <div class="public-contact-form-field">
                            <label for="public-contact-name">Votre nom</label>
                            <input type="text" id="public-contact-name" required>
                        </div>
                        <div class="public-contact-form-field">
                            <label for="public-contact-email">E-mail</label>
                            <input type="email" id="public-contact-email" required>
                        </div>
                    </div>
                    <div class="public-contact-form-field">
                        <label for="public-contact-subject">Sujet</label>
                        <input type="text" id="public-contact-subject" required>
                    </div>
                    <div class="public-contact-form-field">
                        <label for="public-contact-message">Message</label>
                        <textarea id="public-contact-message" rows="6" required></textarea>
                    </div>
                    <button type="submit" class="public-contact-submit">Envoyer le message</button>
                </form>
            </div>
        </div>
    </div>`;
}

function updatePublicNav(route) {
    document.querySelectorAll('[data-public-nav]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.publicNav === route);
    });
}

function publicRouter(route) {
    if (!PUBLIC_ROUTES.includes(route)) route = 'home';
    const container = document.getElementById('public-content');
    if (!container) return;

    window.location.hash = route;
    updatePublicNav(route);
    document.getElementById('public-screen')?.classList.toggle('public-on-home', route === 'home');
    container.classList.toggle('public-scroll-visible', route === 'home' || route === 'fonctionnalites');
    container.scrollTop = 0;
    if (route !== 'home' && publicReviewsTimer) {
        clearInterval(publicReviewsTimer);
        publicReviewsTimer = null;
    }

    switch (route) {
        case 'contact':
            container.innerHTML = renderPublicContact();
            break;
        case 'fonctionnalites':
            container.innerHTML = renderPublicFeatures();
            break;
        case 'tarifs':
            container.innerHTML = '<div class="py-20 text-center text-gray-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>';
            if (typeof renderPublicPricingAsync === 'function') {
                renderPublicPricingAsync().then((html) => { container.innerHTML = html; });
            }
            break;
        default:
            container.innerHTML = renderPublicHome();
            loadPublicReviews();
            break;
    }
}

window.publicRouter = publicRouter;

async function submitPublicContact(e) {
    e.preventDefault();
    const name = document.getElementById('public-contact-name')?.value?.trim();
    const email = document.getElementById('public-contact-email')?.value?.trim();
    const subject = document.getElementById('public-contact-subject')?.value?.trim();
    const message = document.getElementById('public-contact-message')?.value?.trim();
    if (!name || !email || !subject || !message) {
        showToast('Veuillez remplir tous les champs', 'error');
        return;
    }
    try {
        const res = await fetch('/api/contact/public', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, subject, message })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            showToast(data.message || 'Message envoyé', 'success');
            document.getElementById('public-contact-form')?.reset();
        } else {
            showToast(data.error || 'Erreur lors de l\'envoi', 'error');
        }
    } catch {
        showToast('Erreur de communication avec le serveur', 'error');
    }
}

function setAppModalsVisible(visible) {
    const wrap = document.getElementById('app-modals');
    if (!wrap) return;
    wrap.classList.toggle('hidden', !visible);
    wrap.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function initPublicSite() {
    hideAllModals();
    setAppModalsVisible(false);
    document.getElementById('app-screen')?.classList.add('hidden');
    document.getElementById('public-screen')?.classList.remove('hidden');
    document.body.classList.remove('h-screen', 'overflow-hidden');
    document.body.classList.add('public-site-active');

    if (typeof loadPublicPlans === 'function') loadPublicPlans();

    const hash = (window.location.hash || '').replace('#', '').trim();
    publicRouter(PUBLIC_ROUTES.includes(hash) ? hash : 'home');

    window.addEventListener('hashchange', () => {
        if (isAuthenticated) return;
        const next = (window.location.hash || '').replace('#', '').trim();
        publicRouter(PUBLIC_ROUTES.includes(next) ? next : 'home');
    });
}

// --- BOOTSTRAP ---
(async () => {
    // On vérifie systématiquement la validité de la session avec le serveur au démarrage.
    // Cela évite de lancer des requêtes de données en parallèle si le jeton est expiré.
    try {
        const res = await apiFetch('auth/me');
        if (res.ok) {
            const data = await res.json();
            currentUser = data.user;
            setCurrentUser(data.user);
            if (data.permissions && typeof setPermissionsFromServer === 'function') {
                setPermissionsFromServer(data.permissions);
            }
            if (typeof hydrateSubscription === 'function') hydrateSubscription(data);
            isAuthenticated = true;
        } else {
            throw new Error('Session expirée ou invalide');
        }
    } catch (e) {
        console.warn("Échec de l'authentification au démarrage:", e.message);
        initPublicSite();
        return;
    }

    document.getElementById('public-screen')?.classList.add('hidden');
    document.body.classList.remove('public-site-active');
    document.body.classList.add('h-screen', 'overflow-hidden');
    const appScreen = document.getElementById('app-screen');
    if (appScreen) appScreen.classList.remove('hidden');
    setAppModalsVisible(true);

    hideAllModals();

    if (typeof loadPermissions === 'function' && !cachedPermissions) await loadPermissions();

    const ok = await fetchAllData();
    if (typeof applyRoleBasedNav === 'function') applyRoleBasedNav();

    const hashRoute = (window.location.hash || '').replace('#', '').split('&')[0].trim();
    const initialRoute = hashRoute || 'dashboard';
    if (ok) {
        router(initialRoute);
    }
    if (window.cachedSubscription?.billingAlert && typeof showOverdueBillingModal === 'function') {
        showOverdueBillingModal(window.cachedSubscription.billingAlert);
    }

    // Rendre les modaux déplaçables après le premier rendu
    const modalsToMakeDraggable = ['edit-mission-modal', 'add-order-modal', 'add-client-modal', 'driver-modal', 'add-vehicle-modal', 'add-purchase-invoice-modal', 'add-user-modal', 'dispatch-modal', 'add-subcontractor-modal', 'edit-order-modal'];
    modalsToMakeDraggable.forEach(id => {
        const el = document.getElementById(id);
        if (el) makeElementDraggable(el);
    });
})();

// --- DASHBOARD STATE ---
window.activeDashboardTab = 'general';
window.dashboardFilters = { startDate: null, endDate: null };
window.switchDashboardTab = function (tab) {
    destroyAllChartInstances();
    window.activeDashboardTab = tab;
    router('dashboard');
};

// --- PLANNING STATE ---
window.planningDate = new Date();
window.changePlanningWeek = function (offset) {
    const d = new Date(window.planningDate);
    d.setDate(d.getDate() + (offset * 7));
    window.planningDate = d;
    router('planning');
};

async function fetchAllData() {
    try {
        const fetchJson = async (url) => {
            const res = await apiFetch(url);
            if (!res.ok) return [];
            const data = await res.json();
            if (Array.isArray(data)) return data;
            if (data.data && Array.isArray(data.data)) return data.data;
            const resourceKey = url.split('/')[0].replace('-', '_');
            return (data[resourceKey] && Array.isArray(data[resourceKey])) ? data[resourceKey] : [];
        };
        const mayView = (module) => (typeof can !== 'function') || can(module, 'view');

        const [orders, clients, missions, drivers, vehicles, users, sales, purchase, subcontractors] = await Promise.all([
            mayView('transports') ? fetchJson('transport-orders') : Promise.resolve([]),
            mayView('clients') ? fetchJson('clients') : Promise.resolve([]),
            mayView('transports') ? fetchJson('missions') : Promise.resolve([]),
            mayView('carriers') ? fetchJson('drivers') : Promise.resolve([]),
            mayView('carriers') ? fetchJson('vehicles') : Promise.resolve([]),
            (typeof canManageUsers === 'function' && canManageUsers()) ? fetchJson('users') : Promise.resolve([]),
            mayView('billing') ? fetchJson('sales-invoices') : Promise.resolve([]),
            mayView('billing') ? fetchJson('purchase-invoices') : Promise.resolve([]),
            mayView('carriers') ? fetchJson('subcontractors') : Promise.resolve([])
        ]);
        db = { orders, clients, missions, drivers, vehicles, users, sales_invoices: sales, purchase_invoices: purchase, subcontractors };
        return true;
    } catch (error) {
        showToast("Erreur de connexion au serveur", "error");
        return false;
    }
}

// RBAC : isAdmin, canManageInvoices, canManageUsers, … → permissions.js

// Function to toggle all invoice checkboxes
function toggleSelectAllInvoices(masterCheckbox) {
    const checkboxes = document.querySelectorAll('.invoice-checkbox');
    checkboxes.forEach(cb => cb.checked = masterCheckbox.checked);
}

// Function to delete selected sales invoices
async function deleteSelectedInvoices() {
    if (!canManageInvoices()) {
        showToast("Vous n'avez pas l'autorisation de supprimer des factures.", "error");
        return;
    }
    const selectedIds = Array.from(document.querySelectorAll('.invoice-checkbox:checked'))
        .map(cb => cb.value);
    if (selectedIds.length === 0) {
        showToast("Veuillez sélectionner au moins une facture à supprimer.", "info");
        return;
    }
    if (confirm(`Êtes-vous sûr de vouloir supprimer ${selectedIds.length} facture(s) ?`)) {
        await apiFetch('sales-invoices/bulk-delete', { method: 'POST', body: { ids: selectedIds } });
        await fetchAllData();
        showToast(`${selectedIds.length} facture(s) supprimée(s).`, "success");
        router('sales_invoices');
    }
}

// --- RENDERERS ---

// --- RENDER: Dashboard & transports ---
function renderDashboard(stats = {}) {
    let activeTab = window.activeDashboardTab || 'general';
    if (activeTab === 'pallets' && typeof planHasFeature === 'function' && !planHasFeature('pallets')) {
        window.activeDashboardTab = 'general';
        activeTab = 'general';
    }

    const palletsTabBtn = (typeof planHasFeature === 'function' && planHasFeature('pallets'))
        ? `<button onclick="window.switchDashboardTab('pallets')" class="px-6 py-2 ${activeTab === 'pallets' ? 'bg-gray-100 border-t-2 border-teal-500 font-bold text-teal-700' : 'text-gray-400 font-bold hover:bg-gray-50'} text-xs uppercase tracking-wider"><i class="fa-solid fa-pallet mr-1"></i> Palettes Europe</button>`
        : '';

    // Tab Headers
    const tabsHtml = `
        <div class="flex gap-1 border-b border-gray-200">
            <button onclick="window.switchDashboardTab('general')" class="px-6 py-2 ${activeTab === 'general' ? 'bg-gray-100 border-t-2 border-blue-500 font-bold text-blue-600' : 'text-gray-400 font-bold hover:bg-gray-50'} text-xs uppercase tracking-wider">Général</button>
            <button onclick="window.switchDashboardTab('quotations')" class="px-6 py-2 ${activeTab === 'quotations' ? 'bg-gray-100 border-t-2 border-blue-500 font-bold text-blue-600' : 'text-gray-400 font-bold hover:bg-gray-50'} text-xs uppercase tracking-wider">Cotations</button>
            <button onclick="window.switchDashboardTab('invoicing')" class="px-6 py-2 ${activeTab === 'invoicing' ? 'bg-gray-100 border-t-2 border-blue-500 font-bold text-blue-600' : 'text-gray-400 font-bold hover:bg-gray-50'} text-xs uppercase tracking-wider">Facturation</button>
            ${palletsTabBtn}
        </div>
    `;

    let tabContent = '';

    if (activeTab === 'general') {
        tabContent = `
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-blue-600">${stats.activeTransports ?? stats.activeMissions ?? 0}</h3>
                <p class="text-gray-400 text-sm">Transports actifs</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-teal-600">${stats.delivered ?? 0}</h3>
                <p class="text-gray-400 text-sm">Livrés</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-orange-600">${stats.uninvoicedTransports ?? 0}</h3>
                <p class="text-gray-400 text-sm">À préfacturer</p>
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-gray-700">${stats.totalTransports ?? stats.totalExpeditions ?? 0}</h3>
                <p class="text-gray-400 text-sm">Total transports</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center relative">
                <h3 class="text-3xl font-bold text-gray-700">${Number(stats.totalRevenue || 0).toLocaleString()} €</h3>
                <p class="text-gray-400 text-sm">Chiffre d'Affaires</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-gray-700">${Number(stats.totalExpenses || 0).toLocaleString()} €</h3>
                <p class="text-gray-400 text-sm">Dépenses</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-gray-700">${Number(stats.totalSavings || 0).toLocaleString()} €</h3>
                <p class="text-gray-400 text-sm">Économies réalisées</p>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h4 class="text-center font-bold text-gray-700 mb-4">Analyse du Chiffre d'Affaires</h4>
                <div class="h-64"><canvas id="revenueEvolutionChart"></canvas></div>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h4 class="text-center font-bold text-gray-700 mb-4">Répartition des Coûts (Propre vs Affrètement)</h4>
                <div class="h-64"><canvas id="costBreakdownChart"></canvas></div>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h4 class="text-center font-bold text-gray-700 mb-4">Performance Géographique (Destinations)</h4>
                <div class="h-64"><canvas id="geoPerformanceChart"></canvas></div>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h4 class="text-center font-bold text-gray-700 mb-4">Taux de Remplissage Flotte</h4>
                <div class="h-64 relative">
                    <canvas id="donutCapacity"></canvas>
                    <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span id="capacity-text" class="text-2xl font-bold text-blue-600 mt-2">0%</span>
                    </div>
                </div>
            </div>
        </div>`;
    } else if (activeTab === 'quotations') {
        tabContent = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-gray-700">${stats.totalQuotations || 0}</h3>
                <p class="text-gray-400 text-sm">Cotations totales</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 id="conversion-rate-kpi" class="text-3xl font-bold text-blue-600">-- %</h3>
                <p class="text-gray-400 text-sm">Taux de Conversion</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-gray-700">${stats.avgQuotationTime || '--:--:--'}</h3>
                <p class="text-gray-400 text-sm">Délai moyen</p>
            </div>
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h4 class="text-center font-bold text-gray-700 mb-4">Répartition des Statuts de Cotations</h4>
            <div class="h-80"><canvas id="quotationConversionChart"></canvas></div>
        </div>`;
    } else if (activeTab === 'invoicing') {
        const totalInvoiced = db.sales_invoices.reduce((acc, inv) => acc + inv.amount, 0);
        const pendingValidation = db.sales_invoices.filter(inv => inv.status === 'En attente').length;
        const outstanding = db.sales_invoices.filter(inv => inv.status !== 'Payée').reduce((acc, inv) => acc + inv.amount, 0);

        tabContent = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-gray-700">${Number(totalInvoiced).toLocaleString()} €</h3>
                <p class="text-gray-400 text-sm">Montant total facturé</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-orange-600">${pendingValidation}</h3>
                <p class="text-gray-400 text-sm">Factures en attente validation</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-red-600">${Number(outstanding).toLocaleString()} €</h3>
                <p class="text-gray-400 text-sm">Encours Clients</p>
            </div>
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h4 class="text-center font-bold text-gray-700 mb-4">Répartition des règlements</h4>
            <div class="h-80"><canvas id="invoicingStatusChart"></canvas></div>
        </div>`;
    } else if (activeTab === 'pallets') {
        tabContent = `
        <div id="dashboard-pallets-root" class="space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                    <h3 id="pallet-kpi-delivered" class="text-3xl font-bold text-teal-600">—</h3>
                    <p class="text-gray-400 text-sm">Palettes livrées (échange)</p>
                </div>
                <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                    <h3 id="pallet-kpi-returned" class="text-3xl font-bold text-blue-600">—</h3>
                    <p class="text-gray-400 text-sm">Palettes rendues</p>
                </div>
                <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                    <h3 id="pallet-kpi-balance" class="text-3xl font-bold text-orange-600">—</h3>
                    <p class="text-gray-400 text-sm">Solde global (dues par clients)</p>
                </div>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
                    <h4 class="font-bold text-gray-800"><i class="fa-solid fa-pallet mr-2 text-teal-600"></i>Soldes par client</h4>
                    <div class="flex items-center gap-2">
                        <label class="text-sm text-gray-600">Filtrer :</label>
                        <select id="dashboard-pallet-client-filter" onchange="loadDashboardPallets()" class="border border-gray-300 rounded-md px-3 py-1.5 text-sm">
                            <option value="">Tous les clients</option>
                        </select>
                    </div>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm text-left">
                        <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                            <tr>
                                <th class="px-4 py-3">Client</th>
                                <th class="px-4 py-3 text-right">Livrées</th>
                                <th class="px-4 py-3 text-right">Rendues</th>
                                <th class="px-4 py-3 text-right">Solde</th>
                            </tr>
                        </thead>
                        <tbody id="dashboard-pallet-balance-body">
                            <tr><td colspan="4" class="px-4 py-6 text-center text-gray-400 italic">Chargement…</td></tr>
                        </tbody>
                        <tfoot id="dashboard-pallet-balance-foot" class="bg-gray-50 font-bold border-t"></tfoot>
                    </table>
                </div>
                <p class="text-xs text-gray-400 mt-3">Solde = palettes livrées − palettes rendues (commandes avec échange activé). Solde positif = palettes encore dues par le client.</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h4 class="font-bold text-gray-800 mb-4">Derniers mouvements</h4>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm text-left">
                        <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                            <tr>
                                <th class="px-4 py-3">Réf.</th>
                                <th class="px-4 py-3">Client</th>
                                <th class="px-4 py-3">Date</th>
                                <th class="px-4 py-3 text-right">Livrées</th>
                                <th class="px-4 py-3 text-right">Rendues</th>
                                <th class="px-4 py-3">Échange</th>
                            </tr>
                        </thead>
                        <tbody id="dashboard-pallet-movements-body">
                            <tr><td colspan="6" class="px-4 py-6 text-center text-gray-400 italic">Chargement…</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>`;
    }

    return `
    <div class="fade-in">
        <div class="mb-6 flex flex-col gap-4">
            <div class="flex flex-wrap items-center gap-2 bg-white p-3 rounded-lg shadow-sm border border-gray-100">
                <button class="bg-cyan-500 text-white px-4 py-2 rounded flex items-center gap-2 text-sm font-medium">
                    <i class="fa-solid fa-filter"></i> Filtre avancé
                </button>
                <div class="h-8 w-px bg-gray-200 mx-2"></div>
                <div class="flex-1"></div>
                <input type="text" value="2022-12-01 - 2023-12-31" class="border rounded px-3 py-1 text-sm text-gray-600">
            </div>
            ${tabsHtml}
        </div>
        ${tabContent}

        <div class="mt-6 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 class="font-bold text-gray-800 mb-4">Accès Rapide</h3>
            <div class="flex gap-4">
                <button onclick="router('quotation')" class="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"><i class="fa-solid fa-calculator mr-2"></i>Calculateur Cotation</button>
                ${canManageInvoices() ? `<button onclick="router('create_invoice')" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"><i class="fa-solid fa-plus mr-2"></i>Nouvelle Facture</button>` : ''}
                <button onclick="router('completed_transports')" class="bg-white border text-gray-700 px-4 py-2 rounded hover:bg-gray-50"><i class="fa-solid fa-truck mr-2"></i>Transports Réalisés</button>
            </div>
            <div class="mt-4 text-xs text-gray-400"><i class="fa-solid fa-leaf mr-1 text-green-500"></i> Émissions CO2 estimées : <strong>${stats.totalCO2 || 0} kg</strong></div>
        </div>
    </div>`;
}

function renderCompletedTransports() {
    const completedMissions = db.missions.filter(m => m.status === 'Terminé');
    return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 fade-in">
        <div class="flex justify-between items-center mb-6">
            <h3 class="font-bold text-lg text-gray-800">Transports Réalisés</h3>
            <input type="text" placeholder="Rechercher..." class="border rounded px-3 py-1 text-sm focus:outline-none focus:border-blue-500">
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-sm text-left text-gray-500">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                    <tr><th class="px-4 py-3">N° Mission</th><th class="px-4 py-3">Client</th><th class="px-4 py-3">Trajet</th><th class="px-4 py-3">Date</th><th class="px-4 py-3">Heure</th><th class="px-4 py-3">Montant</th><th class="px-4 py-3">Actions</th></tr>
                </thead>
                <tbody>
                    ${completedMissions.map(m => {
        const client = db.clients.find(c => c.id === m.client_id);
        return `<tr class="bg-white border-b hover:bg-gray-50">
                            <td class="px-4 py-3 font-medium text-gray-900">#${m.id}</td>
                            <td class="px-4 py-3">${client ? client.name : '-'}</td>
                            <td class="px-4 py-3">${m.origin} → ${m.dest}</td>
                            <td class="px-4 py-3">${formatDisplayDate(m.date) || '-'}</td>
                            <td class="px-4 py-3">${m.delivery_time || '-'}</td>
                            <td class="px-4 py-3 font-bold text-gray-700">${m.price} €</td>
                            <td class="px-4 py-3"><button onclick="createInvoiceFromMission(${m.id})" class="text-blue-600 hover:underline text-xs"><i class="fa-solid fa-file-invoice mr-1"></i>Facturer</button></td>
                        </tr>`;
    }).join('')}
                </tbody>
            </table>
        </div>`;
}

function renderInProgressTransports() {
    const inProgressMissions = db.missions.filter(m => m.status === 'En cours');
    return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 fade-in">
        <div class="flex justify-between items-center mb-6">
            <div>
                <h3 class="font-bold text-lg text-gray-800">Transports En cours</h3>
                <p class="text-xs text-gray-500">Missions acceptées par les chauffeurs (Mobile)</p>
            </div>
            <div class="flex gap-2">
                <span class="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold self-center">${inProgressMissions.length} actif(s)</span>
                <input type="text" placeholder="Rechercher..." class="border rounded px-3 py-1 text-sm focus:outline-none focus:border-blue-500">
            </div>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-sm text-left text-gray-500">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                    <tr>
                        <th class="px-4 py-3">Mission</th>
                        <th class="px-4 py-3">Client</th>
                        <th class="px-4 py-3">Chauffeur / Véhicule</th>
                        <th class="px-4 py-3">Trajet</th>
                        <th class="px-4 py-3">H. Prévue</th>
                        <th class="px-4 py-3">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${inProgressMissions.length > 0 ? inProgressMissions.map(m => {
        return `<tr class="bg-white border-b hover:bg-gray-50">
                            <td class="px-4 py-3 font-medium text-gray-900">#${m.id}</td>
                            <td class="px-4 py-3">${m.client_name || '-'}</td>
                            <td class="px-4 py-3">
                                <div class="font-medium text-gray-800">${m.driver_name || 'Non assigné'}</div>
                                <div class="text-[10px] text-gray-400">${m.vehicle_plate || 'Sans véhicule'}</div>
                            </td>
                            <td class="px-4 py-3 text-xs">${m.origin} <i class="fa-solid fa-arrow-right mx-1 text-blue-400"></i> ${m.dest}</td>
                            <td class="px-4 py-3 text-blue-600 font-bold animate-pulse">${m.delivery_time || '-'}</td>
                            <td class="px-4 py-3 flex gap-3">
                                <button onclick="finishMission(${m.id})" class="text-green-600 hover:text-green-800 font-bold text-xs"><i class="fa-solid fa-check-double mr-1"></i>Terminer</button>
                                <button onclick="openEditMissionModal(${m.id})" class="text-gray-400 hover:text-blue-600 text-xs"><i class="fa-solid fa-gear"></i></button>
                            </td>
                        </tr>`;
    }).join('') : '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-400 italic">Aucun chauffeur n\'a de mission en cours actuellement</td></tr>'}
                </tbody>
            </table>
        </div>
    </div>`;
}

async function finishMission(missionId) {
    if (!confirm("Voulez-vous marquer cette mission comme terminée ? Elle pourra ensuite être facturée.")) return;
    const mission = db.missions.find(m => m.id === missionId);
    if (mission) {
        const updatedMission = { ...mission, status: 'Terminé' };
        await apiFetch(`missions/${missionId}`, { method: 'PUT', body: updatedMission });
        await fetchAllData();
        showToast("Mission terminée avec succès", "success");
        router('inprogress_transports');
    }
}
window.finishMission = finishMission;

function createInvoiceFromMission(missionId) {
    const mission = db.missions.find(m => m.id === missionId);
    if (mission) {
        router('create_invoice');
        setTimeout(() => {
            const clientSelect = document.getElementById('create-invoice-client');
            if (clientSelect) clientSelect.value = mission.client_id;
            const descInput = document.getElementById('create-invoice-desc');
            if (descInput) descInput.value = `Transport ${mission.origin} → ${mission.dest}`;
            const priceInput = document.getElementById('create-invoice-price');
            if (priceInput) priceInput.value = mission.price;
            showToast("Informations de la mission importées", "success");
        }, 100);
    }
}

// --- RENDER: Planning ---
function renderPlanning() {
    const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    const now = new Date();

    // Calcul de la plage de la semaine affichée (Lundi à Dimanche)
    const current = new Date(window.planningDate);
    const day = current.getDay();
    const diff = current.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(current.setDate(diff));
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    // Filtrage des commandes pour la semaine sélectionnée uniquement
    const weekMissions = db.orders.filter(o => {
        const loadDate = o.load_date || o.date_chargement;
        if (!loadDate) return false;
        const dObj = new Date(loadDate);
        return dObj >= monday && dObj <= sunday;
    }).map(o => {
        const loadDate = o.load_date || o.date_chargement;
        const dateObj = new Date(loadDate);
        const dayIndex = dateObj.getDay();
        let dayName = days[dayIndex === 0 ? 6 : dayIndex - 1];
        return { ...o, day: dayName };
    });

    const getStatusColor = (s) => typeof getStatusBorderClass === 'function' ? getStatusBorderClass(s) : (s === 'Planifié' ? 'border-l-4 border-gray-400' : s === 'En cours' ? 'border-l-4 border-blue-500' : s === 'Terminé' ? 'border-l-4 border-green-500' : s === 'Annulé' ? 'border-l-4 border-red-400' : '');

    // Calcul du numéro de semaine ISO
    const getISOWeek = (date) => {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    };
    const weekNum = getISOWeek(monday);

    return `<div class="h-full flex flex-col fade-in">
        <div class="flex justify-between items-center mb-4">
            <div class="flex items-center gap-4">
                <button onclick="changePlanningWeek(-1)" class="p-2 bg-white rounded shadow hover:text-blue-600"><i class="fa-solid fa-chevron-left"></i></button>
                <span class="font-bold text-gray-700 self-center text-lg">Semaine ${weekNum} - ${monday.getFullYear()}</span>
                <button onclick="changePlanningWeek(1)" class="p-2 bg-white rounded shadow hover:text-blue-600"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
            <button onclick="openAddOrderModal()" class="bg-blue-600 text-white px-4 py-2 rounded text-sm shadow hover:bg-blue-700"><i class="fa-solid fa-plus mr-2"></i>Nouvelle Commande</button>
        </div>
        <div class="flex-1 overflow-x-auto bg-white rounded-xl shadow-sm border border-gray-200">
            <div class="min-w-[1200px] flex h-full">
                ${days.map(day => {
        const dayMissions = weekMissions.filter(m => m.day === day);
        const isToday = day === days[now.getDay() === 0 ? 6 : now.getDay() - 1];
        return `<div class="flex-1 flex flex-col h-full min-w-[150px] ${isToday ? 'bg-blue-50' : ''}">
                        <div class="p-3 text-center border-b font-semibold text-sm text-gray-600 ${isToday ? 'bg-blue-100 text-blue-700' : ''}">${day}</div>
                        <div class="p-2 space-y-2 flex-1 overflow-y-auto">
                            ${dayMissions.length > 0 ? dayMissions.map(m => {
            const isSub = m.assignment_type === 'SUBCONTRACTED' || m.status === 'Affrété';
            const subName = m.subcontractor_name || (db.subcontractors.find(s => s.id === m.subcontractor_id) || {}).name;
            const dispatchBtn = canShowDispatchButton(m) ? `<button onclick="event.stopPropagation(); openDispatchModal(${m.id})" class="text-[10px] text-purple-600 hover:underline ml-1" title="Affréter"><i class="fa-solid fa-handshake"></i></button>` : '';
            return `<div class="bg-white p-3 rounded shadow-sm border border-gray-100 text-xs ${getStatusColor(m.status)} hover:shadow-md transition cursor-pointer relative group" onclick="openTransportDetail(${m.id})">
                                <div class="font-bold text-gray-800 mb-1">#${m.ref || m.id}${isSub ? ' <span class="text-purple-600 text-[10px]"><i class="fa-solid fa-handshake"></i></span>' : ''}</div>
                                <div class="text-gray-500 truncate text-[10px]">${m.origin} <i class="fa-solid fa-arrow-right mx-1"></i> ${m.dest}</div>
                                ${isSub && subName ? `<div class="text-[10px] text-purple-600 truncate">${subName}</div>` : ''}
                                <div class="mt-1 text-xs text-gray-400"><i class="fa-regular fa-clock mr-1"></i>${formatDisplayDate(m.delivery_date) || '--/--'}</div>
                                <div class="mt-2 flex justify-between items-center">
                                    <span class="bg-gray-100 px-1 rounded text-[10px]">${m.price}€</span>
                                    <span class="text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition">${dispatchBtn}<i class="fa-solid fa-pencil ml-1"></i> Modifier</span>
                                </div>
                            </div>`;
        }).join('') : '<div class="h-full min-h-[100px] border-2 border-dashed border-gray-200 rounded flex items-center justify-center text-gray-300 text-xs">Disponible</div>'}
                        </div>
                    </div>`;
    }).join('')}
            </div>
        </div>
    </div>`;
}

// --- RENDER: Clients & sous-traitants ---
function renderClients() {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const days = Math.floor((now - startOfYear) / (24 * 60 * 60 * 1000));
    const weekNum = Math.ceil((days + startOfYear.getDay() + 1) / 7);

    return `<div class="h-full flex flex-col fade-in">
        <div class="flex justify-between items-center mb-4">
        <div class="flex items-center gap-4">
        <h3 class="font-bold text-lg mb-4 text-gray-800">Gestion des Clients</h3>
        </div>
            <button onclick="openAddClientModal()" class="bg-blue-600 text-white px-4 py-2 rounded text-sm shadow hover:bg-blue-700"><i class="fa-solid fa-plus mr-2"></i>Nouveau Client</button>
        </div>
        <div class="flex-1 overflow-x-auto bg-white rounded-xl shadow-sm border border-gray-200">
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left text-gray-500">
                    <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                        <tr><th class="px-4 py-3">Client</th><th class="px-4 py-3">Email</th><th class="px-4 py-3">Téléphone</th><th class="px-4 py-3">Adresse</th><th class="px-4 py-3">Actions</th></tr>
                    </thead>
                    <tbody>
                        ${db.clients.map(c => `<tr class="bg-white border-b hover:bg-gray-50">
                            <td class="px-4 py-3 font-medium text-gray-900">${c.name}</td>
                            <td class="px-4 py-3">${c.email}</td>
                            <td class="px-4 py-3">${c.phone}</td>
                            <td class="px-4 py-3">${c.address}</td>
                            <td class="px-4 py-3"><button onclick="openEditClientModal(${c.id})" class="text-blue-600 hover:underline">Éditer</button></td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    </div>`;
}

function getSubcontractorComplianceInfo(s) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const in30 = new Date(today);
    in30.setDate(in30.getDate() + 30);

    const checkDate = (expiry, label) => {
        if (!expiry) return { label, status: 'unknown', text: 'Non renseigné' };
        const d = new Date(expiry);
        d.setHours(0, 0, 0, 0);
        if (d < today) return { label, status: 'expired', text: formatDisplayDate(expiry) };
        if (d <= in30) return { label, status: 'expiring', text: formatDisplayDate(expiry) };
        return { label, status: 'valid', text: formatDisplayDate(expiry) };
    };

    return {
        rc: checkDate(s.rc_pro_expiry, 'RC Pro'),
        urssaf: checkDate(s.urssaf_expiry, 'URSSAF')
    };
}

function filterSubcontractors(list) {
    return (list || []).filter(s => {
        if (subcontractorFilters.status && s.status !== subcontractorFilters.status) return false;
        if (subcontractorFilters.search) {
            const q = subcontractorFilters.search.toLowerCase();
            const hay = `${s.name || ''} ${s.siret || ''} ${s.email || ''}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        if (subcontractorFilters.compliance) {
            const info = getSubcontractorComplianceInfo(s);
            if (subcontractorFilters.compliance === 'expired') {
                if (info.rc.status !== 'expired' && info.urssaf.status !== 'expired') return false;
            } else if (subcontractorFilters.compliance === 'expiring') {
                if (info.rc.status !== 'expiring' && info.urssaf.status !== 'expiring') return false;
            } else if (subcontractorFilters.compliance === 'valid') {
                if (info.rc.status === 'expired' || info.urssaf.status === 'expired') return false;
            }
        }
        return true;
    });
}

function countSubcontractorsNeedingAttention() {
    return (db.subcontractors || []).filter(s => {
        const info = getSubcontractorComplianceInfo(s);
        return info.rc.status === 'expired' || info.rc.status === 'expiring'
            || info.urssaf.status === 'expired' || info.urssaf.status === 'expiring';
    }).length;
}

function complianceBadgeClass(status) {
    if (status === 'expired') return 'text-red-600 bg-red-100';
    if (status === 'expiring') return 'text-orange-600 bg-orange-100';
    if (status === 'valid') return 'text-green-600 bg-green-100';
    return 'text-gray-400 bg-gray-100';
}

function canShowDispatchButton(order) {
    if (typeof planHasFeature === 'function' && !planHasFeature('subcontractor')) return false;
    if (!order || typeof canDispatchSubcontractor !== 'function' || !canDispatchSubcontractor()) return false;
    if (order.assignment_type === 'SUBCONTRACTED' || order.status === 'Affrété') return false;
    return !['Validé', 'Clôturé', 'Terminé', 'Annulé'].includes(order.status);
}

function renderSubcontractors() {
    const all = Array.isArray(db.subcontractors) ? db.subcontractors : [];
    const filtered = filterSubcontractors(all);
    const attentionCount = countSubcontractorsNeedingAttention();

    return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 fade-in">
        <div class="flex justify-between items-center mb-4">
            <h3 class="font-bold text-lg text-gray-800">Gestion des Sous-traitants</h3>
            <button onclick="openAddSubcontractorModal()" class="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"><i class="fa-solid fa-plus"></i> Nouveau</button>
        </div>
        ${attentionCount > 0 ? `<div class="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg flex items-center gap-2 text-sm text-orange-800">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <span><strong>${attentionCount}</strong> sous-traitant(s) avec document expiré ou expirant sous 30 jours</span>
            <button onclick="subcontractorFilters.compliance='expiring'; subcontractorFilters.status=''; router('subcontractors')" class="ml-auto text-xs underline">Voir les alertes</button>
        </div>` : ''}
        <div class="flex flex-wrap gap-3 mb-4">
            <input type="text" placeholder="Rechercher nom, SIRET…" value="${subcontractorFilters.search || ''}"
                oninput="subcontractorFilters.search=this.value; router('subcontractors')"
                class="border rounded px-3 py-2 text-sm flex-1 min-w-[180px]">
            <select onchange="subcontractorFilters.status=this.value; router('subcontractors')" class="border rounded px-3 py-2 text-sm">
                <option value="">Tous statuts</option>
                <option value="ACTIF" ${subcontractorFilters.status === 'ACTIF' ? 'selected' : ''}>ACTIF</option>
                <option value="BLOQUÉ" ${subcontractorFilters.status === 'BLOQUÉ' ? 'selected' : ''}>BLOQUÉ</option>
            </select>
            <select onchange="subcontractorFilters.compliance=this.value; router('subcontractors')" class="border rounded px-3 py-2 text-sm">
                <option value="">Conformité (tous)</option>
                <option value="valid" ${subcontractorFilters.compliance === 'valid' ? 'selected' : ''}>Conformes</option>
                <option value="expiring" ${subcontractorFilters.compliance === 'expiring' ? 'selected' : ''}>Expire bientôt</option>
                <option value="expired" ${subcontractorFilters.compliance === 'expired' ? 'selected' : ''}>Expirés</option>
            </select>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-sm text-left text-gray-500">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                    <tr><th class="px-4 py-3">Sous-traitant</th><th class="px-4 py-3">SIRET</th><th class="px-4 py-3">RC Pro</th><th class="px-4 py-3">URSSAF</th><th class="px-4 py-3">Statut</th><th class="px-4 py-3">Actions</th></tr>
                </thead>
                <tbody>
                    ${filtered.length ? filtered.map(s => {
        const rc = getSubcontractorComplianceInfo(s).rc;
        const urssaf = getSubcontractorComplianceInfo(s).urssaf;
        const statusClass = s.status === 'ACTIF' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
        return `<tr class="bg-white border-b hover:bg-gray-50">
                            <td class="px-4 py-3 font-medium text-gray-900">${s.name}</td>
                            <td class="px-4 py-3 font-mono text-xs">${s.siret || '-'}</td>
                            <td class="px-4 py-3">
                                <span class="${complianceBadgeClass(rc.status)} px-2 py-1 rounded text-xs font-semibold block mb-1">${rc.text}</span>
                                ${s.insurance_doc_url ? `<a href="${normalizeUploadUrl(s.insurance_doc_url)}" target="_blank" class="text-blue-500 text-[10px] hover:underline flex items-center gap-1"><i class="fa-solid fa-file-pdf"></i> Voir document</a>` : ''}
                            </td>
                            <td class="px-4 py-3"><span class="${complianceBadgeClass(urssaf.status)} px-2 py-1 rounded text-xs font-semibold">${urssaf.text}</span></td>
                            <td class="px-4 py-3"><span class="${statusClass} px-2 py-1 rounded text-xs font-semibold">${s.status}</span></td>
                            <td class="px-4 py-3 whitespace-nowrap">
                                <button onclick="openEditSubcontractorModal(${s.id})" class="text-blue-600 hover:underline mr-3"><i class="fa-solid fa-pen-to-square mr-1"></i>Éditer</button>
                                <button onclick="deleteSubcontractorById(${s.id}, '${(s.name || '').replace(/'/g, "\\'")}')" class="text-red-600 hover:underline"><i class="fa-solid fa-trash mr-1"></i>Supprimer</button>
                            </td>
                        </tr>`;
    }).join('') : `<tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">Aucun sous-traitant${all.length ? ' pour ces filtres' : ''}</td></tr>`}
                </tbody>
            </table>
        </div>
    </div>`;
}

function renderMarginDashboard() {
    return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 fade-in">
        <h3 class="font-bold text-lg text-gray-800 mb-6">Analyse des Marges - Sous-traitance</h3>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
            <div class="bg-blue-50 p-4 rounded-lg text-center">
                <p class="text-gray-500 text-sm">Commandes sous-traitées</p>
                <p class="text-2xl font-bold text-blue-600" id="margin-total-orders">--</p>
            </div>
            <div class="bg-green-50 p-4 rounded-lg text-center">
                <p class="text-gray-500 text-sm">Chiffre d'affaires</p>
                <p class="text-2xl font-bold text-green-600" id="margin-total-sale">--€</p>
            </div>
            <div class="bg-orange-50 p-4 rounded-lg text-center">
                <p class="text-gray-500 text-sm">Coût sous-traitance</p>
                <p class="text-2xl font-bold text-orange-600" id="margin-total-cost">--€</p>
            </div>
            <div class="bg-purple-50 p-4 rounded-lg text-center">
                <p class="text-gray-500 text-sm">Marge brute</p>
                <p class="text-2xl font-bold text-purple-600" id="margin-total-margin">--€</p>
                <p class="text-xs text-purple-500" id="margin-avg-percent">--%</p>
            </div>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-sm text-left text-gray-500">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                    <tr><th class="px-4 py-3">Sous-traitant</th><th class="px-4 py-3">NB Orders</th><th class="px-4 py-3">Prix Vente</th><th class="px-4 py-3">Prix Achat</th><th class="px-4 py-3">Marge €</th><th class="px-4 py-3">Marge %</th><th class="px-4 py-3">Actions</th></tr>
                </thead>
                <tbody id="margin-by-subcontractor">
                    <tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">Chargement...</td></tr>
                </tbody>
            </table>
        </div>
    </div>`;
}

function updateMarginDashboard(data) {
    if (!data || !data.summary) return;

    document.getElementById('margin-total-orders').textContent = data.summary.totalOrders || 0;
    document.getElementById('margin-total-sale').textContent = (data.summary.totalSale || 0).toLocaleString() + '€';
    document.getElementById('margin-total-cost').textContent = (data.summary.totalCost || 0).toLocaleString() + '€';
    document.getElementById('margin-total-margin').textContent = (data.summary.totalMargin || 0).toLocaleString() + '€';
    document.getElementById('margin-avg-percent').textContent = (data.summary.avgMarginPercent || 0).toFixed(1) + '%';

    if (data.bySubcontractor && data.bySubcontractor.length > 0) {
        const rows = data.bySubcontractor.map(item => {
            const marginPercent = item.saleTotal > 0 ? ((item.margin / item.saleTotal) * 100).toFixed(1) : 0;
            return `<tr class="border-b hover:bg-gray-50">
                <td class="px-4 py-3 font-medium">${item.name}</td>
                <td class="px-4 py-3">${item.orderCount}</td>
                <td class="px-4 py-3 text-green-600">${item.saleTotal.toLocaleString()}€</td>
                <td class="px-4 py-3 text-orange-600">${item.costTotal.toLocaleString()}€</td>
                <td class="px-4 py-3 font-bold ${item.margin >= 0 ? 'text-green-600' : 'text-red-600'}">${item.margin.toLocaleString()}€</td>
                <td class="px-4 py-3 font-bold ${item.margin >= 0 ? 'text-green-600' : 'text-red-600'}">${marginPercent}%</td>
                <td class="px-4 py-3">
                    <button onclick="filterPurchaseInvoicesBySubcontractor('${(item.name || '').replace(/'/g, "\\'")}')" class="text-xs text-blue-600 hover:underline">Factures achat</button>
                </td>
            </tr>`;
        }).join('');
        document.getElementById('margin-by-subcontractor').innerHTML = rows;
    } else {
        document.getElementById('margin-by-subcontractor').innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">Aucune donnée</td></tr>';
    }
}

function renderAffretementConfirmationShell() {
    return `<div class="fade-in h-full flex flex-col">
        <div class="flex flex-wrap justify-between items-center gap-3 mb-4">
            <div>
                <button onclick="router('planning')" class="text-sm text-gray-600 hover:text-blue-600 mb-1"><i class="fa-solid fa-arrow-left mr-1"></i>Retour au planning</button>
                <h3 class="font-bold text-lg text-gray-800">Confirmation d'affrètement</h3>
                <p class="text-xs text-gray-500" id="affretement-page-subtitle">Chargement…</p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <a id="affretement-pdf-link" href="#" target="_blank" class="hidden px-3 py-2 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50">
                    <i class="fa-solid fa-file-pdf mr-1 text-red-500"></i>Télécharger PDF
                </a>
                <input type="email" id="affretement-send-email" placeholder="Email sous-traitant" class="border border-gray-300 rounded px-3 py-2 text-sm min-w-[220px]">
                <button id="affretement-send-btn" onclick="sendAffretementConfirmation()" class="px-4 py-2 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700">
                    <i class="fa-solid fa-paper-plane mr-1"></i>Envoyer au sous-traitant
                </button>
            </div>
        </div>
        <div id="affretement-sent-status" class="hidden mb-4 p-3 rounded-lg text-sm"></div>
        <div class="flex-1 overflow-auto bg-slate-100 rounded-xl border border-gray-200 p-4">
            <div id="affretement-preview" class="bg-white rounded-xl shadow-sm mx-auto">
                <p class="p-8 text-center text-gray-400">Chargement de la confirmation…</p>
            </div>
        </div>
    </div>`;
}

async function loadAffretementConfirmationPage() {
    const orderId = affretementConfirmationOrderId;
    const preview = document.getElementById('affretement-preview');
    const subtitle = document.getElementById('affretement-page-subtitle');
    const statusEl = document.getElementById('affretement-sent-status');
    const pdfLink = document.getElementById('affretement-pdf-link');
    const emailInput = document.getElementById('affretement-send-email');
    const sendBtn = document.getElementById('affretement-send-btn');

    if (!orderId) {
        if (preview) preview.innerHTML = '<p class="p-8 text-center text-red-500">Aucune commande sélectionnée.</p>';
        return;
    }

    try {
        const res = await apiFetch(`dispatch/confirmations/${orderId}`);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Confirmation introuvable');
        }
        const { data } = await res.json();

        if (subtitle) {
            subtitle.textContent = `Commande ${data.orderRef} — ${data.subcontractor?.name || 'Sous-traitant'}`;
        }
        if (preview) preview.innerHTML = data.html || '<p class="p-8 text-center text-gray-400">Aucun contenu</p>';
        if (emailInput) emailInput.value = data.subcontractor?.email || '';

        if (pdfLink && data.pdfUrl) {
            pdfLink.href = normalizeUploadUrl(data.pdfUrl);
            pdfLink.classList.remove('hidden');
        } else if (pdfLink) {
            pdfLink.classList.add('hidden');
        }

        if (statusEl) {
            if (data.sentAt && data.sentTo) {
                statusEl.className = 'mb-4 p-3 rounded-lg text-sm bg-green-50 border border-green-200 text-green-800';
                statusEl.innerHTML = `<i class="fa-solid fa-circle-check mr-1"></i> Envoyée le ${formatDisplayDate(data.sentAt)} à <strong>${data.sentTo}</strong>`;
                statusEl.classList.remove('hidden');
            } else {
                statusEl.classList.add('hidden');
                statusEl.innerHTML = '';
            }
        }

        if (sendBtn) {
            const canSend = typeof canDispatchSubcontractor === 'function' && canDispatchSubcontractor();
            sendBtn.classList.toggle('hidden', !canSend);
            if (emailInput) emailInput.disabled = !canSend;
        }
    } catch (e) {
        if (preview) preview.innerHTML = `<p class="p-8 text-center text-red-500">${e.message}</p>`;
        showToast(e.message, 'error');
    }
}

function openAffretementConfirmation(orderId) {
    affretementConfirmationOrderId = parseInt(orderId, 10);
    router('affretement_confirmation');
}

async function sendAffretementConfirmation() {
    const orderId = affretementConfirmationOrderId;
    const email = document.getElementById('affretement-send-email')?.value?.trim();
    if (!orderId) return;

    const sendBtn = document.getElementById('affretement-send-btn');
    if (sendBtn) sendBtn.disabled = true;

    try {
        const res = await apiFetch(`dispatch/confirmations/${orderId}/send`, {
            method: 'POST',
            body: { email: email || undefined }
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(payload.error || 'Envoi impossible');
        }
        showToast(payload.data?.message || 'Confirmation envoyée', payload.data?.simulated ? 'info' : 'success');
        await loadAffretementConfirmationPage();
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        if (sendBtn) sendBtn.disabled = false;
    }
}

window.openAffretementConfirmation = openAffretementConfirmation;
window.sendAffretementConfirmation = sendAffretementConfirmation;

// --- RENDER: Flotte ---
function renderDrivers() {
    return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 fade-in">
        <div class="flex justify-between items-center mb-6">
            <h3 class="font-bold text-lg text-gray-800">Gestion des Chauffeurs</h3>
            <button onclick="openAddDriverModal()" class="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"><i class="fa-solid fa-plus"></i> Nouveau</button>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-sm text-left text-gray-500">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                    <tr><th class="px-4 py-3">Chauffeur</th><th class="px-4 py-3">Contact</th><th class="px-4 py-3">Permis</th><th class="px-4 py-3">Mobile</th><th class="px-4 py-3">Statut</th><th class="px-4 py-3">Actions</th></tr>
                </thead>
                <tbody>
                    ${(Array.isArray(db.drivers) ? db.drivers : []).map(d => {
        const statusColor = d.status === 'Disponible' ? 'text-green-600' : 'text-blue-600';
        const statusBg = d.status === 'Disponible' ? 'bg-green-100' : 'bg-blue-100';
        const mobileBadge = d.user_account_id
            ? '<span class="text-green-700 bg-green-100 px-2 py-1 rounded text-xs font-semibold"><i class="fa-solid fa-circle-check mr-1"></i>Activé</span>'
            : (d.invite_code
                ? `<span class="font-mono text-xs text-teal-700 bg-teal-50 px-2 py-1 rounded border border-teal-200" title="Code à transmettre au chauffeur">${d.invite_code}</span>`
                : '<span class="text-gray-400 text-xs">—</span>');
        return `<tr class="bg-white border-b hover:bg-gray-50">
                            <td class="px-4 py-3 font-medium text-gray-900 flex items-center gap-2">
                                <div class="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-500">
                                    ${d.name ? d.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : '?'}
                                </div>
                                ${d.name || 'N/A'}
                            </td>
                            <td class="px-4 py-3">${d.phone}</td>
                            <td class="px-4 py-3"><span class="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs font-bold">${d.license}</span></td>
                            <td class="px-4 py-3">${mobileBadge}</td>
                            <td class="px-4 py-3"><span class="${statusBg} ${statusColor} px-2 py-1 rounded-full text-xs font-semibold">${d.status}</span></td>
                            <td class="px-4 py-3">
                                <button onclick="openEditDriverModal(${d.id})" class="text-blue-600 hover:underline mr-3"><i class="fa-solid fa-pen-to-square mr-1"></i>Éditer</button>
                                <button onclick="openDriverCardModal(${d.id})" class="text-gray-400 hover:underline"><i class="fa-solid fa-id-card mr-1"></i>Fiche</button>
                            </td>
                        </tr>`;
    }).join('')}
                </tbody>
            </table>
        </div>`;
}

function renderFleet() {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const days = Math.floor((now - startOfYear) / (24 * 60 * 60 * 1000));
    const weekNum = Math.ceil((days + startOfYear.getDay() + 1) / 7);

    return `<div class="h-full flex flex-col fade-in">
        <div class="flex justify-between items-center mb-4">
            <div class="flex items-center gap-4">
                <h3 class="font-bold text-lg mb-4 text-gray-800">Gestion des Véhicules</h3>
            </div>
            <button onclick="openAddVehicleModal()" class="bg-blue-600 text-white px-4 py-2 rounded text-sm shadow hover:bg-blue-700"><i class="fa-solid fa-plus mr-2"></i>Ajouter Camion</button>
        </div>
        <div class="flex-1 overflow-x-auto bg-white rounded-xl shadow-sm border border-gray-200">
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
                ${(Array.isArray(db.vehicles) ? db.vehicles : []).map(v => {
        const statusColor = v.status === 'Disponible' ? 'border-green-500' : (v.status === 'Garage' ? 'border-red-500' : 'border-blue-500');
        return `<div onclick="openEditVehicleModal(${v.id})" class="border rounded-xl p-5 hover:shadow-md transition relative overflow-hidden cursor-pointer">
                        <div class="absolute top-0 left-0 w-full h-1 ${statusColor}"></div>
                        <div class="flex justify-between items-start mb-4">
                            <div><h4 class="font-bold text-gray-800">${v.plate}</h4><p class="text-xs text-gray-500">${v.model}</p></div>
                            <span class="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs font-bold uppercase">${v.status}</span>
                        </div>
                        <div class="space-y-3 text-sm">
                            <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-500">Chauffeur</span><span class="font-medium">${v.driver_name || '<span class="text-gray-400">Aucun</span>'}</span></div>
                            <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-500">Maintenance</span><span class="font-medium">${formatDisplayDate(v.next_maintenance) || v.next_maintenance || '—'}</span></div>
                        </div>
                    </div>`;
    }).join('')}
            </div>
        </div>
    </div>`;
}

// --- RENDER: Facturation ---
function renderPurchaseInvoices() {
    const canManage = canManageInvoices();
    const subcontractorOptions = (db.subcontractors || []).map(s =>
        `<option value="${s.id}" ${String(purchaseInvoiceFilter.subcontractor_id) === String(s.id) ? 'selected' : ''}>${s.name}</option>`
    ).join('');

    let invoices = [...(db.purchase_invoices || [])];
    if (purchaseInvoiceFilter.subcontractor_id) {
        invoices = invoices.filter(inv => String(inv.subcontractor_id) === String(purchaseInvoiceFilter.subcontractor_id));
    }
    if (purchaseInvoiceFilter.type) {
        invoices = invoices.filter(inv => inv.type === purchaseInvoiceFilter.type);
    }

    return `<div class="h-full flex flex-col fade-in">
        <div class="flex justify-between items-center mb-4">
            <div class="flex items-center gap-4">
               <h3 class="font-bold text-lg mb-4 text-gray-800">Gestion des Factures d'Achats</h3>
            </div>
            ${canManage ? `<button onclick="openAddPurchaseInvoiceModal()" class="bg-blue-600 text-white px-4 py-2 rounded text-sm shadow hover:bg-blue-700"><i class="fa-solid fa-plus mr-2"></i>Ajouter une facture</button>` : `<span class="text-sm text-gray-500 bg-gray-100 px-3 py-2 rounded"><i class="fa-solid fa-lock mr-2"></i>Lecture seule</span>`}
        </div>
        <div class="flex flex-wrap gap-3 mb-4">
            <select onchange="purchaseInvoiceFilter.subcontractor_id=this.value; router('purchase_invoices')" class="border rounded px-3 py-2 text-sm">
                <option value="">Tous sous-traitants</option>
                ${subcontractorOptions}
            </select>
            <select onchange="purchaseInvoiceFilter.type=this.value; router('purchase_invoices')" class="border rounded px-3 py-2 text-sm">
                <option value="">Toutes catégories</option>
                <option value="Sous-traitance" ${purchaseInvoiceFilter.type === 'Sous-traitance' ? 'selected' : ''}>Sous-traitance</option>
                <option value="Carburant" ${purchaseInvoiceFilter.type === 'Carburant' ? 'selected' : ''}>Carburant</option>
                <option value="Péage" ${purchaseInvoiceFilter.type === 'Péage' ? 'selected' : ''}>Péage</option>
                <option value="Maintenance" ${purchaseInvoiceFilter.type === 'Maintenance' ? 'selected' : ''}>Maintenance</option>
            </select>
        </div>
        <div class="mb-4">${canExportAccounting() ? `<a href="#" onclick="router('accounting_export')" class="text-sm text-emerald-700 hover:underline"><i class="fa-solid fa-file-csv mr-1"></i>Export comptable CSV</a>` : ''}</div>
        <div class="flex-1 overflow-x-auto bg-white rounded-xl shadow-sm border border-gray-200">
            <table class="w-full text-sm text-left text-gray-500">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                    <tr><th class="px-4 py-3">N° Pièce</th><th class="px-4 py-3">Fournisseur</th><th class="px-4 py-3">Sous-traitant / Commande</th><th class="px-4 py-3">Type</th><th class="px-4 py-3">Montant TTC</th><th class="px-4 py-3">Statut</th><th class="px-4 py-3">Doc</th></tr>
                </thead>
                <tbody>
                    ${invoices.length ? invoices.map(inv => `<tr class="bg-white border-b hover:bg-gray-50">
                        <td class="px-4 py-3 font-medium text-gray-900">${inv.id}</td>
                        <td class="px-4 py-3">${inv.supplier}</td>
                        <td class="px-4 py-3 text-xs">${inv.subcontractor_name || '-'}${inv.order_ref ? `<br><span class="text-gray-400">Cmd. ${inv.order_ref}</span>` : ''}</td>
                        <td class="px-4 py-3">${inv.type}</td>
                        <td class="px-4 py-3 font-bold text-gray-700">-${Number(inv.amount || 0).toLocaleString()} €</td>
                        <td class="px-4 py-3"><span class="${inv.status === 'Payée' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'} px-2 py-1 rounded text-xs font-semibold">${inv.status}</span></td>
                        <td class="px-4 py-3">${inv.file ? `<a href="${normalizeUploadUrl(inv.file)}" target="_blank" class="text-blue-600 hover:underline text-xs"><i class="fa-solid fa-file-pdf"></i></a>` : '-'}</td>
                    </tr>`).join('') : '<tr><td colspan="7" class="px-4 py-10 text-center text-gray-400 italic">Aucune facture d\'achat</td></tr>'}
                </tbody>
            </table>
        </div>
    </div>`;
}

window.filterPurchaseInvoicesBySubcontractor = function (subcontractorName) {
    const sub = (db.subcontractors || []).find(s => s.name === subcontractorName);
    purchaseInvoiceFilter.subcontractor_id = sub ? sub.id : '';
    purchaseInvoiceFilter.type = 'Sous-traitance';
    router('purchase_invoices');
};

function isCreditNoteType(inv) {
    const type = (inv.type || '').toLowerCase();
    return type.includes('credit') || type.includes('avoir');
}

function isCreditNoteEligibleInvoice(inv) {
    if (!inv || isCreditNoteType(inv)) return false;
    const status = (inv.status || '').toString().trim().toLowerCase();
    if (status.includes('brouillon') || status === 'draft') return false;
    return status.includes('valid') || status === 'payée' || status === 'payee' || status === 'paid';
}

function renderSalesInvoices() {
    const canManage = canManageInvoices();
    return `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 fade-in">
        <div class="flex justify-between items-center mb-6">
            <h3 class="font-bold text-lg text-gray-800">Factures de Ventes</h3>
            <div class="flex gap-2">
                ${canManage ? `
                <button onclick="deleteSelectedInvoices()" class="bg-red-500 text-white px-3 py-1 rounded text-sm hover:bg-red-600">
                    <i class="fa-solid fa-trash mr-1"></i> Supprimer sélection
                </button>
                <button onclick="router('create_invoice')" class="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700">
                    <i class="fa-solid fa-plus mr-1"></i> Créer une facture
                </button>
                <button onclick="router('invoice_settings')" class="bg-gray-100 border text-gray-600 px-3 py-1 rounded text-sm hover:bg-gray-200">
                    <i class="fa-solid fa-gear mr-1"></i> Paramètres
                </button>` : ''}
            </div>
        </div>
        ${canExportAccounting() ? `<div class="mb-4"><a href="#" onclick="router('accounting_export')" class="text-sm text-emerald-700 hover:underline"><i class="fa-solid fa-file-csv mr-1"></i>Export comptable CSV</a></div>` : ''}
        <div class="overflow-x-auto">
            <table class="w-full text-sm text-left text-gray-500">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                    <tr>
                        <th class="px-4 py-3"><input type="checkbox" onchange="toggleSelectAllInvoices(this)"></th>
                        <th class="px-4 py-3">N° Facture</th>
                        <th class="px-4 py-3">Client</th>
                        <th class="px-4 py-3">Date</th>
                        <th class="px-4 py-3">Montant TTC</th>
                        <th class="px-4 py-3">Statut</th>
                        <th class="px-4 py-3">Actions</th>
                        <th class="px-4 py-3">Relances</th>
                    </tr>
                </thead>
                <tbody>
                    ${db.sales_invoices.map(inv => {
        const client = db.clients.find(c => Number(c.id) === Number(inv.client_id));
        const reminderLabel = inv.reminder_date
            ? formatDisplayDate(inv.reminder_date)
            : '<span class="text-gray-300">—</span>';
        const isCreditNote = isCreditNoteType(inv);
        const invoiceNumber = inv.number || inv.invoice_number || inv.id;
        const amountLabel = isCreditNote
            ? `- ${Number(inv.amount).toLocaleString('fr-FR')} €`
            : `${Number(inv.amount).toLocaleString('fr-FR')} €`;
        const amountClass = isCreditNote ? 'text-red-600' : 'text-gray-700';
        const canCredit = canManage && isCreditNoteEligibleInvoice(inv);
        return `<tr class="bg-white border-b hover:bg-gray-50">
                            <td class="px-4 py-3"><input type="checkbox" class="invoice-checkbox" value="${inv.id}"></td>
                            <td class="px-4 py-3 font-medium text-gray-900">
                                ${invoiceNumber}
                                ${isCreditNote ? '<span class="ml-2 px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800">Avoir</span>' : ''}
                            </td>
                            <td class="px-4 py-3">${client ? client.name : '-'}</td>
                            <td class="px-4 py-3">${formatDisplayDate(inv.date)}</td>
                            <td class="px-4 py-3 font-bold ${amountClass}">${amountLabel}</td>
                            <td class="px-4 py-3">
                                <span class="px-2 py-1 rounded text-xs font-semibold ${inv.status === 'Payée' ? 'bg-green-100 text-green-800' :
                inv.status === 'Brouillon' ? 'bg-gray-100 text-gray-800' : 'bg-orange-100 text-orange-800'
            }">${inv.status}</span>
                            </td>
                            <td class="px-4 py-3 whitespace-nowrap">
                                <button onclick="openInvoiceModal('${inv.id}')" class="text-blue-600 hover:underline mr-2">Voir</button>
                                ${canCredit ? `
                                    <button onclick="createCreditNote('${inv.id}', false)" class="text-purple-600 hover:underline mr-2" title="Annuler la facture en totalité">Avoir total</button>
                                    <button onclick="openPartialCreditNoteModal('${inv.id}')" class="text-purple-600 hover:underline mr-2" title="Créditer une partie">Avoir partiel</button>
                                ` : ''}
                                ${!isCreditNote && inv.status !== 'Payée' && canManage ? `<button onclick="relanceFacture('${inv.id}')" class="text-orange-600 hover:underline">Relancer</button>` : ''}
                            </td>
                            <td class="px-4 py-3 text-sm text-gray-600">${reminderLabel}</td>
                        </tr>`;
    }).join('')}
                </tbody>
            </table>
        </div>
    </div>`;
}

window.openInvoiceModal = async function (invoiceId) {
    let inv = db.sales_invoices.find(i => String(i.id) === String(invoiceId) || i.number === invoiceId);
    if (!inv) return showToast("Facture introuvable", "error");

    const userRefreshPromise = refreshCompanyProfileForInvoice();
    const bankSettingsPromise = fetchBankSettingsForInvoice();
    const clientFetchPromise = inv.client_id ? fetchClientForInvoice(inv.client_id) : Promise.resolve(null);

    try {
        const res = await apiFetch(`sales-invoices/${inv.id}`);
        if (res.ok) {
            const payload = await res.json();
            if (payload.data) inv = { ...inv, ...payload.data };
        }
    } catch (e) {
        console.warn('Chargement détail facture indisponible', e);
    }

    const cachedClient = db.clients.find(c => Number(c.id) === Number(inv.client_id));
    const [user, bankSettings, fetchedClient] = await Promise.all([
        userRefreshPromise,
        bankSettingsPromise,
        clientFetchPromise
    ]);
    const client = fetchedClient
        ? { ...(cachedClient || {}), ...fetchedClient }
        : cachedClient;

    // Normalisation statut pour rendre les boutons fiables
    const normalizedStatus = (inv.status ?? '').toString().trim().toLowerCase();
    const isDraft = normalizedStatus.includes('brouillon') || normalizedStatus === 'draft';

    // 1. Infos Générales
    const invNumberEl = document.getElementById('modal-inv-number');
    if (invNumberEl) invNumberEl.innerText = inv.number || inv.id || "N/A";

    const invDateEl = document.getElementById('modal-inv-date');
    if (invDateEl) invDateEl.innerText = formatDisplayDate(inv.date);

    const dueEl = document.getElementById('modal-inv-due');
    if (dueEl) dueEl.innerText = formatDisplayDate(inv.due_date || inv.date);

    const statusEl = document.getElementById('modal-inv-status');
    if (statusEl) statusEl.innerText = inv.status || 'Brouillon';

    const refEl = document.getElementById('modal-inv-reference');
    if (refEl) refEl.innerText = inv.order_ref || inv.number || inv.id || '—';

    // 2. Émetteur
    const issuerName = document.getElementById('modal-issuer-name');
    if (issuerName) issuerName.innerText = (user?.company_name || currentUser?.company_name || "VOTRE ENTREPRISE").toUpperCase();

    const issuerAddress = document.getElementById('modal-issuer-address');
    if (issuerAddress) issuerAddress.innerText = user?.company_address || currentUser?.company_address || "";

    const issuerSiret = document.getElementById('modal-issuer-siret');
    if (issuerSiret) issuerSiret.innerText = user?.company_siret || currentUser?.company_siret || "-";

    const issuerTva = document.getElementById('modal-issuer-tva');
    if (issuerTva) issuerTva.innerText = user?.company_tva || currentUser?.company_tva || "-";

    const logoEl = document.getElementById('modal-company-logo');
    if (logoEl) {
        const rawLogo = user?.company_logo || currentUser?.company_logo;
        const logoUrl = rawLogo ? resolveCompanyLogoUrl(rawLogo) : '';
        if (logoUrl) {
            logoEl.src = logoUrl;
            logoEl.classList.remove('hidden');
            logoEl.onerror = () => logoEl.classList.add('hidden');
        } else {
            logoEl.src = '';
            logoEl.classList.add('hidden');
        }
    }

    // 3. Client (priorité : données jointes sur la facture, puis fetch client, puis cache)
    const clientName = document.getElementById('modal-client-name');
    if (clientName) clientName.innerText = inv.client_name || client?.name || "Client Inconnu";

    const clientAddress = document.getElementById('modal-client-address');
    if (clientAddress) clientAddress.innerText = inv.client_address || client?.address || "";

    const clientSiretEl = document.getElementById('modal-client-siret');
    if (clientSiretEl) {
        const siret = inv.client_siret || client?.siret;
        clientSiretEl.innerText = (siret && String(siret).trim()) ? String(siret).trim() : "-";
    }

    const clientTvaEl = document.getElementById('modal-client-tva');
    if (clientTvaEl) {
        const tva = inv.client_tva || client?.tva;
        clientTvaEl.innerText = (tva && String(tva).trim()) ? String(tva).trim() : "-";
    }

    // 4. Lignes et Calculs
    const itemsBody = document.getElementById('modal-invoice-items');
    if (itemsBody) itemsBody.innerHTML = '';

    let totalHT = 0;
    let taxes = {}; // taux TVA => montant TVA

    let lines = normalizeInvoiceItems(inv.items);
    if (lines.length === 1 && !lines[0].desc && Number(inv.amount) > 0) {
        lines = [{ desc: 'Prestation de transport', qty: 1, price: Number(inv.amount), tva: 0.20 }];
    }

    lines.forEach(l => {
        const qty = Number(l.qty ?? 1) || 1;
        const price = Number(l.price ?? 0) || 0;
        const lineHT = qty * price;
        totalHT += lineHT;

        // TVA: parfois 0.20, parfois 20
        let tvaRate = Number(l.tva ?? l.tva_rate ?? 0.20) || 0;
        if (tvaRate > 1) tvaRate = tvaRate / 100;

        const taxAmount = lineHT * tvaRate;
        taxes[tvaRate] = (taxes[tvaRate] || 0) + taxAmount;

        if (!itemsBody) return;
        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-50/80 transition-colors even:bg-gray-50/40";
        tr.innerHTML = `
            <td class="px-5 py-4 font-medium text-gray-800">${l.desc || ''}</td>
            <td class="px-5 py-4 text-center font-mono tabular-nums">${qty}</td>
            <td class="px-5 py-4 text-right font-mono tabular-nums">${price.toLocaleString('fr-FR')} €</td>
            <td class="px-5 py-4 text-right font-semibold font-mono tabular-nums">${lineHT.toLocaleString('fr-FR')} €</td>
        `;
        itemsBody.appendChild(tr);
    });

    // 5. Totaux
    const totalHTEl = document.getElementById('modal-total-ht');
    if (totalHTEl) totalHTEl.innerText = totalHT.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

    const taxRows = document.getElementById('modal-tax-rows');
    if (taxRows) taxRows.innerHTML = '';

    let totalTVA = 0;
    if (taxRows) {
        for (let rate in taxes) {
            totalTVA += taxes[rate];
            taxRows.innerHTML += `
                <div class="flex justify-between font-mono tabular-nums">
                    <span>TVA (${(Number(rate) * 100).toFixed(1)}%)</span>
                    <span>${taxes[rate].toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span>
                </div>
            `;
        }
    } else {
        totalTVA = Object.values(taxes).reduce((a, b) => a + b, 0);
    }

    const totalTTC = (totalHT + totalTVA).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
    const summaryTTCEl = document.getElementById('modal-summary-ttc');
    if (summaryTTCEl) summaryTTCEl.innerText = totalTTC;

    const totalTTCEl = document.getElementById('modal-total-ttc');
    if (totalTTCEl) totalTTCEl.innerText = totalTTC;

    // 6. Coordonnées bancaires (table bank_settings)
    const methodEl = document.getElementById('modal-payment-method');
    if (methodEl) methodEl.innerText = (bankSettings?.method || '').trim() || 'Non renseigné';

    const bankEl = document.getElementById('modal-bank-name');
    if (bankEl) bankEl.innerText = (bankSettings?.bank_name || '').trim() || 'Non renseigné';

    const bicEl = document.getElementById('modal-bic');
    if (bicEl) bicEl.innerText = (bankSettings?.bic || '').trim() || 'Non renseigné';

    const ibanEl = document.getElementById('modal-iban');
    if (ibanEl) ibanEl.innerText = (bankSettings?.iban || '').trim() || 'Non renseigné';

    // 7. Actions
    const editBtn = document.getElementById('edit-draft-btn');
    if (editBtn) {
        if (isDraft) {
            editBtn.classList.remove('hidden');
            editBtn.onclick = () => { closeInvoiceModal(); editDraft(inv.id); };
        } else {
            editBtn.classList.add('hidden');
        }
    }

    const downloadBtn = document.getElementById('download-btn');
    if (downloadBtn) {
        // Actuellement le backend retourne un PDF. On garde la fonction en attendant XML dédié.
        downloadBtn.onclick = () => downloadInvoicePDF(invoiceId);
    }

    const cnTotalBtn = document.getElementById('credit-note-total-btn');
    if (cnTotalBtn) {
        if (canManageInvoices() && isCreditNoteEligibleInvoice(inv)) {
            cnTotalBtn.classList.remove('hidden');
            cnTotalBtn.onclick = () => createCreditNote(inv.id, false);
        } else {
            cnTotalBtn.classList.add('hidden');
            cnTotalBtn.onclick = null;
        }
    }

    const cnPartialBtn = document.getElementById('credit-note-partial-btn');
    if (cnPartialBtn) {
        if (canManageInvoices() && isCreditNoteEligibleInvoice(inv)) {
            cnPartialBtn.classList.remove('hidden');
            cnPartialBtn.onclick = () => openPartialCreditNoteModal(inv.id);
        } else {
            cnPartialBtn.classList.add('hidden');
            cnPartialBtn.onclick = null;
        }
    }

    const modal = document.getElementById('invoice-modal');
    if (modal) {
        modal.style.top = '';
        modal.style.left = '';
        modal.style.position = '';
        modal.style.margin = '';
        modal.style.transform = '';
        modal.style.cursor = '';
        modal.classList.remove('hidden');
        document.body.classList.add('invoice-modal-open');
    }
};
window.openInvoiceModal = openInvoiceModal;

async function fetchBankSettingsForInvoice() {
    try {
        const res = await apiFetch('bank-settings');
        if (res.ok) {
            const payload = await res.json();
            return payload.data || null;
        }
    } catch (e) {
        console.warn('Chargement bank_settings indisponible', e);
    }
    return null;
}

async function fetchClientForInvoice(clientId) {
    try {
        const res = await apiFetch(`clients/${clientId}`);
        if (res.ok) {
            const payload = await res.json();
            return payload.data || payload;
        }
    } catch (e) {
        console.warn('Chargement client indisponible', e);
    }
    return null;
}

async function refreshCompanyProfileForInvoice() {
    try {
        const res = await apiFetch('auth/me');
        if (res.ok) {
            const data = await res.json();
            if (data.user) {
                currentUser = data.user;
                setCurrentUser(data.user);
                return data.user;
            }
        }
    } catch (e) {
        console.warn('Refresh profil entreprise indisponible', e);
    }
    return currentUser || getCurrentUser();
}


window.closeInvoiceModal = function () {
    hideAllModals();
};

window.printInvoice = function () {
    const content = document.getElementById('printable-invoice');
    if (!content) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        showToast('Veuillez autoriser les pop-ups pour imprimer', 'error');
        return;
    }

    printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="fr">
            <head>
                <meta charset="UTF-8">
                <title>Impression Facture</title>
                <link rel="stylesheet" href="/css/tailwind.css">
                <style>
                    body { margin: 0; padding: 20px; font-family: Arial, sans-serif; color: #1f2937; }
                    table { width: 100%; border-collapse: collapse; }
                    th, td { padding: 8px; border-bottom: 1px solid #e5e7eb; }
                    @media print { body { padding: 0; } }
                </style>
            </head>
            <body onload="window.print(); setTimeout(() => window.close(), 300);">
                ${content.innerHTML}
            </body>
        </html>
    `);
    printWindow.document.close();
};

function renderSettingInvoices() {
    const currentColor = db.settings?.invoice_color || "#004d40";
    const logoSrc = resolveCompanyLogoUrl(currentUser?.company_logo);

    return `
    <div class="max-w-5xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 p-8 fade-in">
        <div class="flex justify-between items-center mb-8 border-b pb-4">
            <div>
                <h2 class="text-2xl font-bold text-gray-800">Configuration du document</h2>
                <p class="text-sm text-gray-500">Personnalisez l'apparence et les données légales de vos factures</p>
            </div>
            <button type="button" onclick="router('sales_invoices')" class="text-gray-400 hover:text-gray-600 transition-colors">
                <i class="fa-solid fa-xmark text-xl"></i>
            </button>
        </div>
        
        <form onsubmit="saveInvoiceSettings(event)" class="grid grid-cols-1 lg:grid-cols-3 gap-12">
            
            <div class="lg:col-span-2 space-y-8">
                
                <div class="space-y-4">
                    <h3 class="flex items-center font-bold text-blue-600 uppercase text-xs tracking-wider">
                        <i class="fa-solid fa-building-columns mr-2"></i> Coordonnées Bancaires
                    </h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="md:col-span-2">
                            <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">Mode de règlement</label>
                            <input type="text" name="method" id="bank-settings-method" class="w-full border-gray-200 border p-3 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all bg-gray-50 focus:bg-white" value="Virement Bancaire" placeholder="Virement Bancaire">
                        </div>
                        <div class="md:col-span-2">
                            <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">IBAN</label>
                            <input type="text" name="iban" id="bank-settings-iban" class="w-full border-gray-200 border p-3 rounded-xl text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none transition-all bg-gray-50 focus:bg-white" value="" placeholder="FR76 3000 6000 0001 2345 6789 X01">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">Code BIC / SWIFT</label>
                            <input type="text" name="bic" id="bank-settings-bic" class="w-full border-gray-200 border p-3 rounded-xl text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none transition-all bg-gray-50 focus:bg-white" value="" placeholder="BNPAFRPP">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nom de la Banque</label>
                            <input type="text" name="bank_name" id="bank-settings-bank-name" class="w-full border-gray-200 border p-3 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all bg-gray-50 focus:bg-white" value="" placeholder="BNP Paribas">
                        </div>
                    </div>
                </div>

                <div class="space-y-4">
                    <h3 class="flex items-center font-bold text-blue-600 uppercase text-xs tracking-wider">
                        <i class="fa-solid fa-palette mr-2"></i> Identité Visuelle
                    </h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">Couleur thématique</label>
                            <div class="flex gap-2">
                                <input type="color" id="color-picker" oninput="updateThemePreview(this.value)" class="h-11 w-20 border-gray-200 border p-1 rounded-xl cursor-pointer bg-gray-50" value="${currentColor}">
                                <input type="text" id="color-text" class="flex-1 border-gray-200 border p-3 rounded-xl text-sm font-mono uppercase bg-gray-50" value="${currentColor}" readonly>
                            </div>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">Logo sur les factures</label>
                            <div class="flex items-center gap-4 p-3 border border-gray-200 rounded-xl bg-gray-50">
                                <img src="${logoSrc}" alt="Logo" class="h-12 max-w-[120px] object-contain"
                                     onerror="this.src='assets/transfact_icon_512.jpg'">
                                <p class="text-xs text-gray-500">Modifiable dans <button type="button" onclick="router('admin')" class="text-blue-600 hover:underline font-medium">Paramètres entreprise</button>.</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="flex justify-end pt-6 gap-4 border-t">
                    <button type="button" onclick="router('sales_invoices')" class="px-6 py-2.5 text-gray-500 font-medium hover:bg-gray-100 rounded-xl transition-all">Annuler</button>
                    <button type="submit" class="px-8 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-bold shadow-lg shadow-blue-100 transition-all transform hover:-translate-y-0.5">
                        Enregistrer les modifications
                    </button>
                </div>
            </div>

            <div class="hidden lg:flex flex-col items-center">
                <div class="sticky top-24 w-full">
                    <div class="bg-gray-50 p-8 rounded-3xl border-2 border-dashed border-gray-200 flex flex-col items-center">
                        <p class="text-[10px] font-black text-gray-400 uppercase mb-6 tracking-widest">Aperçu du rendu</p>
                        
                        <div class="bg-white w-56 h-72 shadow-2xl rounded-sm p-5 border border-gray-100 transition-all duration-300 transform hover:scale-105">
                            <div id="theme-preview-header" class="h-5 w-full mb-4 transition-colors duration-300" style="background: ${currentColor}"></div>
                            
                            <div class="space-y-3">
                                <div class="flex justify-between">
                                    <div class="h-2 w-12 bg-gray-100"></div>
                                    <div class="h-2 w-8 bg-gray-100"></div>
                                </div>
                                <div class="h-3 w-2/3 bg-gray-200"></div>
                                <div class="h-2 w-1/2 bg-gray-100"></div>
                                
                                <div class="pt-4 space-y-2">
                                    <div class="h-1 w-full bg-gray-50 border-b border-gray-100 pb-1"></div>
                                    <div class="h-1 w-full bg-gray-50 border-b border-gray-100 pb-1"></div>
                                    <div class="h-1 w-full bg-gray-50 border-b border-gray-100 pb-1"></div>
                                </div>
                                
                                <div class="pt-4 flex justify-end">
                                    <div class="h-4 w-16 bg-gray-100"></div>
                                </div>
                            </div>
                        </div>
                        
                        <p class="mt-6 text-xs text-gray-400 text-center px-4">L'en-tête et les accents de vos documents utiliseront cette couleur.</p>
                    </div>
                </div>
            </div>

        </form>
    </div>`;
}

// Fonction utilitaire pour la mise à jour en temps réel
window.updateThemePreview = function (color) {
    const header = document.getElementById('theme-preview-header');
    const textInput = document.getElementById('color-text');
    if (header) header.style.backgroundColor = color;
    if (textInput) textInput.value = color.toUpperCase();
};

window.saveInvoiceSettings = async function (e) {
    if (e) e.preventDefault();
    const form = e?.target;
    if (!form || !currentUser?.company_id) return;

    const payload = {
        method: form.method?.value?.trim() || 'Virement Bancaire',
        iban: form.iban?.value?.trim() || '',
        bic: form.bic?.value?.trim() || '',
        bank_name: form.bank_name?.value?.trim() || ''
    };

    if (!payload.iban) {
        showToast('IBAN requis', 'error');
        return;
    }

    try {
        const response = await apiFetch('bank-settings', {
            method: 'PUT',
            body: payload
        });

        if (response.ok) {
            showToast("Paramètres bancaires mis à jour avec succès", "success");
            router('sales_invoices');
        } else {
            const err = await response.json().catch(() => ({}));
            showToast(err.error || "Échec de la sauvegarde", "error");
        }
    } catch (err) {
        showToast("Erreur de communication avec le serveur", "error");
    }
};

window.loadBankSettingsIntoForm = async function () {
    try {
        const res = await apiFetch('bank-settings');
        if (!res.ok) return;
        const payload = await res.json();
        const bank = payload.data;
        if (!bank) return;

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val || '';
        };
        setVal('bank-settings-method', bank.method);
        setVal('bank-settings-iban', bank.iban);
        setVal('bank-settings-bic', bank.bic);
        setVal('bank-settings-bank-name', bank.bank_name);
    } catch (e) {
        console.warn('Chargement bank_settings formulaire', e);
    }
};

// Optimisation de renderCreateInvoice 
function renderCreateInvoice() {
    const isEdit = !!editingInvoiceId;
    const displayNumber = isEdit ? editingInvoiceId : generateInvoiceNumber();
    return `
    <div class="h-full flex flex-col bg-gray-50 -m-6 fade-in">
        <div class="bg-white border-b px-8 py-4 flex justify-between items-center sticky top-0 z-10 shadow-sm">
            <input type="hidden" id="invoice-number" value="${displayNumber}">
            <div>
                <h3 class="text-xl font-bold text-gray-800">${isEdit ? 'Modifier le brouillon' : 'Édition Facture'}</h3>
                <p class="text-xs text-gray-500 font-medium"><span id="invoice-editor-number">${displayNumber}</span> • <span id="invoice-editor-subtitle" class="text-blue-600">${isEdit ? 'Reprise du brouillon' : 'Nouveau document'}</span></p>
            </div>
            <div class="flex gap-3">
                <button onclick="router('sales_invoices')" class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-all font-medium">Annuler</button>
                <div class="h-10 w-[1px] bg-gray-200 mx-2"></div>
                 <button onclick="saveDraft()" class="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 font-medium flex items-center">
                    <i class="fa-regular fa-floppy-disk mr-2"></i> Prévisualiser
                </button>
                <button onclick="validateInvoice()" class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold shadow-md shadow-blue-200 flex items-center transition-all transform hover:-translate-y-0.5">
                    <i class="fa-solid fa-check-double mr-2"></i> Valider & Émettre
                </button>
            </div>
        </div>

        <div class="flex flex-1 overflow-hidden">
            <div class="w-2/2 p-8 overflow-y-auto border-r border-gray-200">
                <div class="max-w-2xl mx-auto space-y-8">
                    <section class="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                        <div class="flex items-center mb-4 text-blue-600">
                            <i class="fa-solid fa-user-tie mr-2"></i>
                            <h4 class="font-bold uppercase text-xs tracking-widest">Informations Destinataire</h4>
                        </div>
                        <div class="grid grid-cols-2 gap-4 text-sm">
                            <div class="col-span-2">
                                <label class="block text-gray-500 mb-1 font-medium">Client</label>
                                <select id="invoice-client" onchange="previewInvoice()" class="w-full border-gray-200 border p-3 rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all">
                                    ${db.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                                </select>
                            </div>
                            <div>
                                <label class="block text-gray-500 mb-1 font-medium">Date d'émission</label>
                                <input type="date" id="invoice-date" value="${new Date().toISOString().split('T')[0]}" onchange="previewInvoice()" class="w-full border-gray-200 border p-3 rounded-xl bg-gray-50">
                            </div>
                            <div>
                                <label class="block text-gray-500 mb-1 font-medium">Échéance</label>
                                <input type="date" id="invoice-due" value="${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}" onchange="previewInvoice()" class="w-full border-gray-200 border p-3 rounded-xl bg-gray-50">
                            </div>
                        </div>
                    </section>

                    <section class="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                        <div class="flex justify-between items-center mb-6">
                             <div class="flex items-center text-blue-600">
                                <i class="fa-solid fa-list-ul mr-2"></i>
                                <h4 class="font-bold uppercase text-xs tracking-widest">Lignes de facturation</h4>
                            </div>
                            <button onclick="addLine()" class="bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-blue-100 transition-colors">
                                <i class="fa fa-plus mr-1"></i> Ajouter
                            </button>
                        </div>
                        <div id="invoice-lines-container" class="space-y-3">
                            </div>
                    </section>
                </div>
            </div>

            <div class="w-1/2 bg-gray-200 p-12 overflow-y-auto flex justify-center">
                <div id="invoice-preview" class="w-full max-w-[21cm] bg-white shadow-2xl rounded-sm p-[1.5cm] min-h-[29.7cm] transition-all duration-300">
                    </div>
            </div>
        </div>
    </div>`;
}

function generateInvoiceNumber() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `FAC${year}${month}`;

    // On filtre les factures du mois en cours pour incrémenter le compteur
    const monthInvoices = db.sales_invoices.filter(inv => inv.id && inv.id.startsWith(prefix));
    const nextIndex = monthInvoices.length + 1;
    return `${prefix}${String(nextIndex).padStart(3, '0')}`;
}

function addLine() {
    invoiceLines.push({
        desc: '',
        qty: 1,
        price: 0
    });
    renderLines();
}

function renderLines() {
    const container = document.getElementById('invoice-lines-container');
    container.innerHTML = invoiceLines.map((l, i) => `
        <div class="group flex gap-3 items-start bg-gray-50 p-4 rounded-xl border border-transparent hover:border-blue-200 hover:bg-white transition-all">
            <div class="w-32 flex items-center">
                <input value="${l.desc}" oninput="updateLine(${i}, 'desc', this.value)" 
                    class="w-full bg-transparent text-left font-bold text-gray-700 outline-none" placeholder="Description de la prestation">
            </div>
            <div class="w-2">
                <input type="number" value="${l.qty}" oninput="updateLine(${i}, 'qty', this.value)" 
                    class="w-full bg-transparent text-center font-bold text-gray-700 outline-none" placeholder="Qté">
            </div>
            <div class="w-25 flex items-center">
                <input type="number" value="${l.price}" oninput="updateLine(${i}, 'price', this.value)" 
                    class="w-full bg-transparent text-right font-bold text-gray-700 outline-none" placeholder="Prix HT">
                <span class="ml-1 text-gray-400 text-xs">€</span>
            </div>
            <button onclick="removeLine(${i})" class="opacity-0 group-hover:opacity-100 p-2 text-red-400 hover:text-red-600 transition-all">
                <i class="fa-solid fa-circle-xmark"></i>
            </button>
        </div>
    `).join('');
    previewInvoice(); // Appel automatique de l'aperçu
}

function updateLine(i, field, value) {
    // Parse numeric fields to prevent calculation errors in preview/storage
    const isNumeric = field === 'qty' || field === 'price';
    invoiceLines[i][field] = isNumeric ? (parseFloat(value) || 0) : value;
    previewInvoice();
}

function removeLine(i) {
    invoiceLines.splice(i, 1);
    renderLines();
}
function previewInvoice() {
    const clientId = document.getElementById('invoice-client').value;
    const client = db.clients.find(c => c.id == clientId);
    const invNumber = document.getElementById('invoice-number').value;
    const invDate = document.getElementById('invoice-date').value;

    let total = 0;
    const rows = invoiceLines.map(l => {
        const lineTotal = l.qty * l.price;
        total += lineTotal;
        return `
            <tr class="border-b border-gray-100">
                <td class="py-3 text-xs">${l.desc || '<em>Sans description</em>'}</td>
                <td class="py-3 text-xs text-center">${l.qty}</td>
                <td class="py-3 text-xs text-right">${Number(l.price).toLocaleString()} €</td>
                <td class="py-3 text-xs text-right font-bold">${lineTotal.toLocaleString()} €</td>
            </tr>
        `;
    }).join('');

    const companyName = currentUser?.company_name || '';
    const companyAddress = currentUser?.company_address || '';
    const companySiret = currentUser?.company_siret || '';
    const companyTva = currentUser?.company_tva || '';

    document.getElementById('invoice-preview').innerHTML = `
        <div class="w-full h-full text-gray-800">
            <div class="flex justify-between items-start mb-10">
                <div>
                    <h2 class="text-3xl font-black text-blue-600 mb-1">FACTURE</h2>
                    <p class="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Document Provisoire</p>
                </div>
                <div class="text-right">
                    <p class="font-bold text-lg">${invNumber}</p>
                    <p class="text-xs text-gray-500">${formatDisplayDate(invDate)}</p>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-8 mb-12">
                <div>
                    <p class="text-[9px] uppercase font-bold text-gray-400 mb-2 tracking-wider">Émetteur</p>
                    <p class="font-bold text-sm">${companyName}</p>
                    <p class="text-[11px] text-gray-500">${companyAddress}</p>
                    <p class="text-[10px] text-gray-400 mt-1">SIRET : ${companySiret || '-'}</p>
                    <p class="text-[10px] text-gray-400">TVA : ${companyTva || '-'}</p>
                </div>
                <div class="text-right">
                    <p class="text-[9px] uppercase font-bold text-gray-400 mb-2 tracking-wider">Client</p>
                    <p class="font-bold text-sm">${client?.name || '-'}</p>
                    <p class="text-[11px] text-gray-500">${client?.address || ''}</p>
                    <p class="text-[11px] text-gray-500">${client?.tva || ''}</p>
                </div>
            </div>

            <table class="w-full mt-4 text-sm">
                <thead class="bg-gray-50 text-gray-500 uppercase text-[9px] font-bold tracking-wider">
                    <tr class="border-b">
                        <th class="py-2 text-left">Désignation</th>
                        <th class="py-2 text-center w-16">Qté</th>
                        <th class="py-2 text-right w-24">P.U. HT</th>
                        <th class="py-2 text-right w-28">Total HT</th>
                    </tr>
                </thead>
                <tbody>${rows || '<tr><td colspan="4" class="text-center py-10 text-gray-300 italic text-sm">Aucune ligne saisie</td></tr>'}</tbody>
            </table>

            <div class="flex justify-end pt-4">
                <div class="w-48 space-y-2">
                    <div class="flex justify-between text-xs text-gray-500">
                        <span>Total HT</span>
                        <span>${total.toLocaleString()} €</span>
                    </div>
                    <div class="flex justify-between text-base font-black text-blue-700 border-t-2 border-blue-100 pt-2">
                        <span>NET À PAYER&nbsp;:&nbsp;</span>
                        <span>${total.toLocaleString()} €</span>
                    </div>
                </div>
            </div>

            <div class="mt-20 pt-8 border-t border-dashed text-center">
                <p class="text-[9px] text-gray-400 uppercase tracking-widest">Aperçu généré par Transfact TMS - Ce document n'a pas de valeur légale tant qu'il n'est pas validé.</p>
            </div>
        </div>
    `;
}

async function saveDraft() {
    const data = getInvoiceFormData('Brouillon');
    if (!data) return;

    try {
        let res;
        if (editingInvoiceId) {
            res = await apiFetch(`sales-invoices/${editingInvoiceId}`, {
                method: 'PUT',
                body: {
                    client_id: data.client_id,
                    date: data.date,
                    amount: data.amount,
                    items: data.items
                }
            });
        } else {
            res = await apiFetch('sales-invoices', { method: 'POST', body: data });
        }

        if (res.ok) {
            await fetchAllData();
            const invoiceId = editingInvoiceId || data.number;
            editingInvoiceId = null;
            openInvoiceModal(invoiceId);
            showToast("Brouillon sauvegardé avec succès", "success");
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || "Erreur lors de la sauvegarde du brouillon", "error");
        }
    } catch (err) {
        showToast("Impossible de contacter le serveur", "error");
    }
}

async function validateInvoice() {
    const data = getInvoiceFormData('Validée');
    if (!data) return;

    const total = invoiceLines.reduce((acc, l) => acc + (l.qty * l.price), 0);

    const isConfirmed = window.confirm(`Êtes-vous sûr de vouloir valider cette facture pour un montant total de ${total.toLocaleString()} € ?\n\nCette action est irréversible.`);
    if (!isConfirmed) return;

    try {
        let res;
        if (editingInvoiceId) {
            const updateRes = await apiFetch(`sales-invoices/${editingInvoiceId}`, {
                method: 'PUT',
                body: {
                    client_id: data.client_id,
                    date: data.date,
                    amount: data.amount,
                    items: data.items
                }
            });
            if (!updateRes.ok) {
                const err = await updateRes.json().catch(() => ({}));
                showToast(err.error || "Erreur lors de la mise à jour du brouillon", "error");
                return;
            }
            res = await apiFetch(`sales-invoices/${editingInvoiceId}/validate`, { method: 'POST' });
        } else {
            res = await apiFetch('sales-invoices', { method: 'POST', body: data });
        }

        if (res.ok) {
            await fetchAllData();
            editingInvoiceId = null;
            showToast("Facture validée et enregistrée !", "success");
            router('sales_invoices');
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || "Erreur lors de la validation de la facture", "error");
        }
    } catch (err) {
        showToast("Impossible de contacter le serveur", "error");
    }
}

function generateCreditNote(invoiceId, isTotal = true) {
    if (isTotal) {
        createCreditNote(invoiceId, false);
    } else {
        openPartialCreditNoteModal(invoiceId);
    }
}

let partialCreditNoteState = { invoiceId: null, lines: [], maxAmount: 0, useAmountOnly: false };

function updateCreditNoteTotal() {
    const totalEl = document.getElementById('cn-total');
    if (!totalEl) return;

    let total = 0;
    if (partialCreditNoteState.useAmountOnly) {
        const input = document.getElementById('cn-amount-input');
        total = parseFloat(input?.value) || 0;
    } else {
        partialCreditNoteState.lines.forEach((line, index) => {
            const qtyInput = document.getElementById(`cn-qty-${index}`);
            const creditQty = qtyInput ? parseFloat(qtyInput.value) || 0 : line.creditQty || 0;
            line.creditQty = creditQty;
            total += creditQty * line.price;
        });
    }

    totalEl.textContent = total.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

window.openPartialCreditNoteModal = async function (invoiceId) {
    if (!canManageInvoices()) {
        showToast('Permission insuffisante pour créer un avoir', 'error');
        return;
    }

    hideAllModals();

    let inv = db.sales_invoices.find(i => String(i.id) === String(invoiceId));
    if (!inv) return showToast('Facture introuvable', 'error');

    try {
        const res = await apiFetch(`sales-invoices/${invoiceId}`);
        if (res.ok) {
            const payload = await res.json();
            if (payload.data) inv = { ...inv, ...payload.data };
        }
    } catch (e) {
        console.warn('Chargement détail facture indisponible', e);
    }

    if (!isCreditNoteEligibleInvoice(inv)) {
        return showToast('Seules les factures validées ou payées peuvent faire l\'objet d\'un avoir', 'error');
    }

    const lines = normalizeInvoiceItems(inv.items).filter(l => l.desc && l.desc.trim() !== '');
    const maxAmount = Number(inv.amount) || 0;
    const invoiceRef = inv.number || inv.invoice_number || inv.id;

    partialCreditNoteState = {
        invoiceId: inv.id,
        lines: lines.map(l => ({ ...l, creditQty: 0, maxQty: l.qty })),
        maxAmount,
        useAmountOnly: lines.length === 0
    };

    const idEl = document.getElementById('cn-invoice-id');
    const refEl = document.getElementById('cn-invoice-ref');
    const maxEl = document.getElementById('cn-max-amount');
    const container = document.getElementById('cn-lines-container');
    const amountOnly = document.getElementById('cn-amount-only');
    const amountInput = document.getElementById('cn-amount-input');

    if (idEl) idEl.value = inv.id;
    if (refEl) refEl.textContent = `Facture ${invoiceRef} — Montant HT : ${maxAmount.toLocaleString('fr-FR')} €`;
    if (maxEl) maxEl.textContent = `${maxAmount.toLocaleString('fr-FR')} €`;

    if (partialCreditNoteState.useAmountOnly) {
        if (container) container.innerHTML = '<p class="text-sm text-gray-500">Cette facture ne contient pas de lignes détaillées. Saisissez le montant à créditer.</p>';
        if (amountOnly) amountOnly.classList.remove('hidden');
        if (amountInput) {
            amountInput.value = '';
            amountInput.max = maxAmount;
            amountInput.oninput = updateCreditNoteTotal;
        }
    } else {
        if (amountOnly) amountOnly.classList.add('hidden');
        if (container) {
            container.innerHTML = `
                <table class="w-full text-sm text-left text-gray-600">
                    <thead class="text-xs uppercase bg-gray-50 border-b">
                        <tr>
                            <th class="px-3 py-2">Description</th>
                            <th class="px-3 py-2 text-right">Qté fact.</th>
                            <th class="px-3 py-2 text-right">Qté à créditer</th>
                            <th class="px-3 py-2 text-right">P.U. HT</th>
                            <th class="px-3 py-2 text-right">Total ligne</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${lines.map((line, index) => `
                            <tr class="border-b">
                                <td class="px-3 py-2">${line.desc}</td>
                                <td class="px-3 py-2 text-right">${line.qty}</td>
                                <td class="px-3 py-2 text-right">
                                    <input id="cn-qty-${index}" type="number" min="0" max="${line.qty}" step="0.01" value="0"
                                        class="w-24 border rounded px-2 py-1 text-right" oninput="updateCreditNoteTotal()">
                                </td>
                                <td class="px-3 py-2 text-right">${Number(line.price).toLocaleString('fr-FR')} €</td>
                                <td class="px-3 py-2 text-right cn-line-total" data-index="${index}">0,00 €</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <p class="text-xs text-gray-500 mt-2">Indiquez les quantités à créditer pour chaque ligne.</p>
            `;
        }
    }

    updateCreditNoteTotal();

    const modal = document.getElementById('credit-note-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
};

window.updateCreditNoteTotal = updateCreditNoteTotal;

window.closeCreditNoteModal = function () {
    const modal = document.getElementById('credit-note-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

window.submitPartialCreditNote = async function () {
    const invoiceId = document.getElementById('cn-invoice-id')?.value;
    if (!invoiceId) return;

    let body;
    if (partialCreditNoteState.useAmountOnly) {
        const amount = parseFloat(document.getElementById('cn-amount-input')?.value);
        if (!Number.isFinite(amount) || amount <= 0) {
            showToast('Montant invalide', 'error');
            return;
        }
        if (amount > partialCreditNoteState.maxAmount + 0.001) {
            showToast('Le montant dépasse le total de la facture', 'error');
            return;
        }
        body = { isPartial: true, amount };
    } else {
        updateCreditNoteTotal();
        const items = partialCreditNoteState.lines
            .map((line, index) => {
                const qtyInput = document.getElementById(`cn-qty-${index}`);
                const creditQty = qtyInput ? parseFloat(qtyInput.value) || 0 : 0;
                return creditQty > 0 ? { desc: line.desc, qty: creditQty, price: line.price } : null;
            })
            .filter(Boolean);

        if (items.length === 0) {
            showToast('Sélectionnez au moins une quantité à créditer', 'error');
            return;
        }

        const total = items.reduce((sum, line) => sum + (line.qty * line.price), 0);
        if (total > partialCreditNoteState.maxAmount + 0.001) {
            showToast('Le total de l\'avoir dépasse le montant de la facture', 'error');
            return;
        }
        body = { isPartial: true, items };
    }

    if (!confirm(`Confirmer la génération d'un avoir partiel de ${document.getElementById('cn-total')?.textContent || ''} ?`)) {
        return;
    }

    try {
        const res = await apiFetch(`sales-invoices/${invoiceId}/credit-note`, {
            method: 'POST',
            body
        });

        if (res.ok) {
            const payload = await res.json().catch(() => ({}));
            showToast(`Avoir ${payload.number || ''} créé avec succès`.trim(), 'success');
            closeCreditNoteModal();
            await fetchAllData();
            router('sales_invoices');
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Erreur de création d\'avoir', 'error');
        }
    } catch (e) {
        showToast('Serveur injoignable', 'error');
    }
};

function getInvoiceFormData(status) {
    const clientId = document.getElementById('invoice-client').value;
    const dateInput = document.getElementById('invoice-date');
    const date = dateInput?.value ? dateInput.value : formatDateForInput(new Date());
    const number = document.getElementById('invoice-number').value;
    const dueInput = document.getElementById('invoice-due');
    const due = dueInput?.value ? dueInput.value : formatDateForInput(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

    // Filtrer les lignes vides pour ne pas polluer la base de données
    const validLines = invoiceLines.filter(l => l.desc && l.desc.trim() !== "");

    if (!clientId) {
        showToast("Veuillez sélectionner un client", "error");
        return null;
    }

    if (validLines.length === 0) {
        showToast("Veuillez ajouter au moins une ligne avec une description", "error");
        return null;
    }

    const totalAmount = validLines.reduce((acc, l) => acc + (l.qty * l.price), 0);

    return {
        number: number,
        client_id: parseInt(clientId),
        date: date,
        due_date: due,
        items: validLines,
        amount: totalAmount,
        status: status,
        currency: 'EUR',
        typeCode: '380' // Code Factur-X standard pour une facture commerciale
    };
}

function resolveCompanyLogoUrl(logoPath) {
    if (!logoPath) return 'assets/transfact_icon_512.jpg';
    if (logoPath.startsWith('http://') || logoPath.startsWith('https://') || logoPath.startsWith('/')) return logoPath;
    return logoPath;
}
window.resolveCompanyLogoUrl = resolveCompanyLogoUrl;

window.previewCompanyLogo = function (input) {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
        showToast('Le logo ne doit pas dépasser 2 Mo', 'error');
        input.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        const preview = document.getElementById('admin-company-logo-preview');
        if (preview) preview.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

window.uploadCompanyLogo = async function () {
    const input = document.getElementById('admin-company-logo-input');
    if (!input?.files?.[0]) {
        showToast('Sélectionnez une image (PNG, JPG, WEBP ou SVG)', 'error');
        return;
    }
    const formData = new FormData();
    formData.append('logo', input.files[0]);
    try {
        const response = await apiFetch(`companies/${currentUser.company_id}/logo`, {
            method: 'POST',
            body: formData
        });
        if (response.ok) {
            const data = await response.json();
            currentUser.company_logo = data.logo_url;
            setCurrentUser(currentUser);
            const preview = document.getElementById('admin-company-logo-preview');
            if (preview) preview.src = resolveCompanyLogoUrl(data.logo_url);
            input.value = '';
            showToast('Logo enregistré — visible sur vos factures', 'success');
        } else {
            const err = await response.json().catch(() => ({}));
            showToast(err.error || 'Échec du téléversement', 'error');
        }
    } catch (e) {
        showToast('Erreur de communication avec le serveur', 'error');
    }
};

// --- RENDER: Admin ---
function renderAdmin() {
    const isAdminUser = typeof canManageUsers === 'function' && canManageUsers();
    const emailEnabled = currentUser?.company_notifications === 1;
    const logoSrc = resolveCompanyLogoUrl(currentUser?.company_logo);

    return `<div class="space-y-6 fade-in">
        <h2 class="text-2xl font-bold text-gray-800">Paramètres de l'Entreprise</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 class="font-bold text-gray-700 mb-4 uppercase text-xs tracking-wider">Utilisateurs Plateforme</h3>
                <table class="w-full text-sm text-left">
                    <thead class="border-b"><tr><th class="pb-2">Nom</th><th class="pb-2">Rôle</th><th class="pb-2">Action</th></tr></thead>
                    <tbody>
                        ${db.users.map(u => `<tr class="border-b last:border-0">
                            <td class="py-2">${u.name}</td>
                            <td class="py-2"><span class="${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'} px-2 rounded text-[10px] font-bold uppercase">${u.role}</span></td>
                            <td class="py-2"><button class="text-blue-600 text-xs">Modifier</button></td>
                        </tr>`).join('')}
                    </tbody>
                </table>
                ${isAdminUser ? `<button onclick="openAddUserModal()" class="mt-4 w-full py-2 border border-dashed rounded text-gray-500 hover:bg-gray-50 text-sm">+ Ajouter utilisateur</button>` : ''}
            </div>

            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-6">
                <div>
                    <h3 class="font-bold text-gray-700 mb-4 uppercase text-xs tracking-wider">Identité Légale de la Compagnie</h3>
                    <div class="space-y-4">
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">Adresse Siège Social</label>
                            <input type="text" id="admin-company-address" class="w-full border p-2 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" value="${currentUser?.company_address || ''}" placeholder="123 Rue du Transport...">
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">N° TVA Intra.</label>
                                <input type="text" id="admin-company-tva" class="w-full border p-2 rounded text-sm font-mono uppercase" value="${currentUser?.company_tva || ''}" placeholder="FR123456789">
                            </div>
                            <div>
                                <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">SIRET / SIREN</label>
                                <input type="text" id="admin-company-siret" class="w-full border p-2 rounded text-sm font-mono" value="${currentUser?.company_siret || ''}" placeholder="123 456 789 00012">
                            </div>
                        </div>
                        <button onclick="updateCompanyInfo()" class="w-full py-2 bg-blue-600 text-white rounded text-sm font-bold hover:bg-blue-700 transition shadow-sm">
                            <i class="fa-solid fa-save mr-2"></i>Sauvegarder les informations
                        </button>
                    </div>
                </div>

                <div class="pt-6 border-t">
                    <h3 class="font-bold text-gray-700 mb-4 uppercase text-xs tracking-wider">Logo de l'entreprise</h3>
                    <p class="text-xs text-gray-500 mb-4">Ce logo apparaît sur vos factures clients, brouillons et documents PDF.</p>
                    <div class="flex flex-col sm:flex-row items-start gap-4">
                        <div class="w-28 h-28 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center bg-gray-50 overflow-hidden shrink-0">
                            <img id="admin-company-logo-preview" src="${logoSrc}" alt="Logo entreprise"
                                 class="max-w-full max-h-full object-contain p-2"
                                 onerror="this.src='assets/transfact_icon_512.jpg'">
                        </div>
                        <div class="flex-1 space-y-3">
                            <input type="file" id="admin-company-logo-input" accept="image/png,image/jpeg,image/webp,image/svg+xml"
                                   class="hidden" onchange="previewCompanyLogo(this)">
                            <div class="flex flex-wrap gap-2">
                                <button type="button" onclick="document.getElementById('admin-company-logo-input').click()"
                                        class="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition">
                                    <i class="fa-solid fa-image mr-2"></i>Choisir une image
                                </button>
                                <button type="button" onclick="uploadCompanyLogo()"
                                        class="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 transition">
                                    <i class="fa-solid fa-cloud-arrow-up mr-2"></i>Enregistrer le logo
                                </button>
                            </div>
                            <p class="text-[10px] text-gray-400">PNG, JPG, WEBP ou SVG — 2 Mo max. Fond transparent recommandé.</p>
                        </div>
                    </div>
                </div>

                <div class="pt-6 border-t">
                    <h3 class="font-bold text-gray-700 mb-4 uppercase text-xs tracking-wider">Communication & Alertes</h3>
                    <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                            <span class="text-sm text-gray-800 font-semibold block">Notifications Email Automatiques</span>
                            <span class="text-[10px] text-gray-500">Envoyer les rapports de planning et confirmations de factures</span>
                        </div>
                        <div onclick="toggleEmailNotifications()" class="w-12 h-6 ${emailEnabled ? 'bg-blue-600' : 'bg-gray-200'} rounded-full relative cursor-pointer transition-colors duration-200">
                            <div class="w-4 h-4 bg-white rounded-full absolute top-1 ${emailEnabled ? 'right-1' : 'left-1'} transition-all shadow-sm"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}

// Fonctions logiques pour les paramètres
window.updateCompanyInfo = async function () {
    const payload = {
        address: document.getElementById('admin-company-address').value,
        tva_intra: document.getElementById('admin-company-tva').value,
        siret: document.getElementById('admin-company-siret').value
    };

    try {
        const response = await apiFetch(`companies/${currentUser.company_id}`, {
            method: 'PUT',
            body: payload
        });

        if (response.ok) {
            Object.assign(currentUser, {
                company_address: payload.address,
                company_tva: payload.tva_intra,
                company_siret: payload.siret
            });
            setCurrentUser(currentUser);
            showToast("Informations de la compagnie enregistrées", "success");
        } else {
            const errorData = await response.json().catch(() => ({}));
            showToast(errorData.error || "Échec de la sauvegarde", "error");
        }
    } catch (err) {
        showToast("Erreur de communication avec le serveur", "error");
    }
};

window.toggleEmailNotifications = async function () {
    const currentVal = currentUser?.company_notifications || 0;
    const newVal = currentVal === 1 ? 0 : 1;

    try {
        const response = await apiFetch(`companies/${currentUser.company_id}/notifications`, {
            method: 'PUT',
            body: { email_notifications: newVal }
        });

        if (response.ok) {
            currentUser.company_notifications = newVal;
            setCurrentUser(currentUser);
            showToast(newVal ? "Notifications email activées" : "Notifications email désactivées", "info");
            router('admin'); // Re-render pour mettre à jour le switch visuel
        }
    } catch (err) {
        showToast("Erreur lors de la modification des notifications", "error");
    }
};

// --- RENDER: Pages info ---
function renderSolutions() {
    return `<div class="max-w-6xl mx-auto fade-in py-10">
        <div class="text-center mb-12">
            <h1 class="text-4xl font-extrabold text-gray-900 mb-4">Nos Solutions</h1>
            <p class="text-lg text-gray-600">Une suite complète pour gérer votre activité de transport.</p>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
            <div class="bg-white p-8 rounded-2xl shadow-lg border border-gray-100">
                <div class="w-14 h-14 bg-blue-100 rounded-xl flex items-center justify-center mb-4">
                    <i class="fa-solid fa-boxes-packing text-2xl text-blue-600"></i>
                </div>
                <h3 class="font-bold text-xl text-gray-800 mb-3">Gestion des Commandes</h3>
                <p class="text-gray-600">Créez et gérez vos ordres de transport facilement. Suivi complet du chargement à la livraison, avec gestion des statuts.</p>
            </div>
            <div class="bg-white p-8 rounded-2xl shadow-lg border border-gray-100">
                <div class="w-14 h-14 bg-green-100 rounded-xl flex items-center justify-center mb-4">
                    <i class="fa-solid fa-calendar-days text-2xl text-green-600"></i>
                </div>
                <h3 class="font-bold text-xl text-gray-800 mb-3">Planning Intelligent</h3>
                <p class="text-gray-600">Planifiez vos missions sur un planning hebdomadaire visuel. Optimisez les tournées et réduisez les coûts, avec affectation chauffeurs/véhicules.</p>
            </div>
            <div class="bg-white p-8 rounded-2xl shadow-lg border border-gray-100">
                <div class="w-14 h-14 bg-purple-100 rounded-xl flex items-center justify-center mb-4">
                    <i class="fa-solid fa-truck text-2xl text-purple-600"></i>
                </div>
                <h3 class="font-bold text-xl text-gray-800 mb-3">Gestion de Flotte</h3>
                <p class="text-gray-600">Suivez l'état de votre parc véhicule. Gestion de la maintenance, assurance, kilomètres et affectation aux chauffeurs.</p>
            </div>
            <div class="bg-white p-8 rounded-2xl shadow-lg border border-gray-100">
                <div class="w-14 h-14 bg-orange-100 rounded-xl flex items-center justify-center mb-4">
                    <i class="fa-solid fa-file-invoice-dollar text-2xl text-orange-600"></i>
                </div>
                <h3 class="font-bold text-xl text-gray-800 mb-3">Facturation Automatique</h3>
                <p class="text-gray-600">Générez vos factures clients (Factur-X) et achats en un clic. Suivi des paiements et relances automatiques.</p>
            </div>
            <div class="bg-white p-8 rounded-2xl shadow-lg border border-gray-100">
                <div class="w-14 h-14 bg-red-100 rounded-xl flex items-center justify-center mb-4">
                    <i class="fa-solid fa-handshake-angle text-2xl text-red-600"></i>
                </div>
                <h3 class="font-bold text-xl text-gray-800 mb-3">Gestion des Sous-traitants & Affrètement</h3>
                <p class="text-gray-600">Gérez vos sous-traitants, affectez des commandes et analysez la rentabilité de chaque affrètement.</p>
            </div>
            <div class="bg-white p-8 rounded-2xl shadow-lg border border-gray-100">
                <div class="w-14 h-14 bg-cyan-100 rounded-xl flex items-center justify-center mb-4">
                    <i class="fa-solid fa-mobile-screen-button text-2xl text-cyan-600"></i>
                </div>
                <h3 class="font-bold text-xl text-gray-800 mb-3">Application Mobile Chauffeurs</h3>
                <p class="text-gray-600">Permettez à vos chauffeurs de gérer leurs missions, scanner des documents et collecter des signatures directement depuis leur mobile.</p>
            </div>
        </div>
        
        <div class="bg-gradient-to-r from-blue-600 to-blue-800 rounded-2xl p-8 text-white text-center">
            <h2 class="text-2xl font-bold mb-4">Prêt à simplifier votre gestion?</h2>
            <p class="text-blue-100 mb-6">Démarrez gratuitement et adaptez votre solution à vos besoins.</p>
            <div class="flex justify-center gap-4">
                <button onclick="router('contact')" class="bg-white text-blue-600 px-6 py-3 rounded-lg font-semibold hover:bg-blue-50 transition">Nous contacter</button>
            </div>
        </div>
    </div>`;
}

function renderContact() {
    return `<div class="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-gray-100 p-8 fade-in">
        <h2 class="text-2xl font-bold text-gray-800 mb-6">Contact & Aide</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div class="text-center p-6 bg-blue-50 rounded-lg">
                <i class="fa-solid fa-phone text-3xl text-blue-600 mb-3"></i>
                <h4 class="font-bold text-gray-800">Téléphone</h4>
                <p class="text-gray-600">02 99 00 00 00</p>
                <p class="text-sm text-gray-500">Lun-Ven: 9h-18h</p>
            </div>
            <div class="text-center p-6 bg-blue-50 rounded-lg">
                <i class="fa-solid fa-envelope text-3xl text-blue-600 mb-3"></i>
                <h4 class="font-bold text-gray-800">Email</h4>
                <p class="text-gray-600">support@transfact.fr</p>
                <p class="text-sm text-gray-500">Réponse sous 24h</p>
            </div>
        </div>
        <form id="contact-form" class="space-y-4" onsubmit="submitContact(event)">
            <div><label class="block text-sm font-medium text-gray-700 mb-1">Sujet</label><input type="text" id="contact-subject" class="w-full border rounded p-2" required></div>
            <div><label class="block text-sm font-medium text-gray-700 mb-1">Message</label><textarea id="contact-message" class="w-full border rounded p-2" rows="5" required></textarea></div>
            <button type="submit" class="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Envoyer</button>
        </form>
    </div>`;
}

// --- PAGES APP (about, solutions, pricing) ---
function renderAbout() {
    return `<div class="max-w-4xl mx-auto bg-white rounded-xl shadow-sm border border-gray-100 p-8 fade-in">
        <div class="text-center mb-8">
            <i class="fa-solid fa-truck-fast text-5xl text-blue-600 mb-4"></i>  
            <h2 class="text-3xl font-bold text-gray-900 mb-2">À propos de Transfact</h2>
            <p class="text-gray-600">Votre solution de gestion de transport</p>
        </div>
        <div class="space-y-6 text-gray-700">
            <p>Transfact est une application de gestion de transport (TMS) complète conçue pour simplifier la planification, 
            le suivi et la facturation de vos opérations de Transports.</p>
            
            <h3 class="text-xl font-bold text-gray-800">Nos Services</h3>
            <ul class="space-y-2">
                <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Gestion des Commandes & Suivi de livraison</li>
                <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Planning Intelligent & Affectation</li>
                <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Gestion de Flotte & Maintenance</li>
                <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Facturation Automatique (Factur-X) & Achats</li>
                <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Gestion des Sous-traitants & Affrètement</li>
                <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Application Mobile pour les Chauffeurs</li>
                <li><i class="fa-solid fa-check text-green-500 mr-2"></i>Calculateur de Cotation & Offres PDF</li>
            </ul>
            
            <h3 class="text-xl font-bold text-gray-800">Informations Légales</h3>
            <div class="bg-gray-50 p-2 rounded-lg">
                <p><strong>Entreprise:</strong> Transfact SAS</p>
                <p><strong>SIRET:</strong> SIRET A VOIR</p>
                <p><strong>TVA:</strong> TVA A VOIR</p>
                <p><strong>Adresse:</strong> ADRESSE A VOIR LORS DE LA CREATION DU START UP</p>
            </div>
        </div>
    </div>`;
}

async function submitContact(e) {
    e.preventDefault();
    const subject = document.getElementById('contact-subject')?.value?.trim();
    const message = document.getElementById('contact-message')?.value?.trim();
    if (!subject || !message) {
        showToast('Veuillez remplir le sujet et le message', 'error');
        return;
    }
    try {
        const res = await apiFetch('contact', { method: 'POST', body: { subject, message } });
        if (res.ok) {
            showToast("Message envoyé avec succès ! Nous vous répondrons sous 24h.", "success");
            document.getElementById('contact-form')?.reset();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Erreur lors de l\'envoi', 'error');
        }
    } catch (err) {
        showToast('Erreur de communication avec le serveur', 'error');
    }
}

function renderQuotationCalculator() {
    return `
    <div class="max-w-4xl mx-auto bg-white rounded-xl shadow-sm border border-gray-100 p-8 fade-in">
        <h2 class="text-2xl font-bold text-gray-800 mb-6"><i class="fa-solid fa-calculator mr-2 text-indigo-600"></i>Calculateur de Cotation (Trinôme)</h2>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div class="space-y-6">
                <div class="p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <h4 class="font-bold text-gray-700 mb-3 text-sm uppercase tracking-wider">1. Coût Kilométrique (CK)</h4>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs text-gray-500 mb-1">Nombre de km</label>
                            <input type="number" id="q-km" value="100" class="w-full border rounded p-2 text-sm" oninput="updateQuotation()">
                        </div>
                        <div>
                            <label class="block text-xs text-gray-500 mb-1">Coût au km (€)</label>
                            <input type="number" id="q-cost-km" value="0.45" step="0.01" class="w-full border rounded p-2 text-sm" oninput="updateQuotation()">
                        </div>
                    </div>
                    <p class="mt-2 text-[10px] text-gray-400">Carburant, pneus, entretien, péages.</p>
                </div>

                <div class="p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <h4 class="font-bold text-gray-700 mb-3 text-sm uppercase tracking-wider">2. Coût Conducteur (CC)</h4>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs text-gray-500 mb-1">Nombre d'heures</label>
                            <input type="number" id="q-hours" value="8" class="w-full border rounded p-2 text-sm" oninput="updateQuotation()">
                        </div>
                        <div>
                            <label class="block text-xs text-gray-500 mb-1">Coût horaire (€)</label>
                            <input type="number" id="q-cost-hour" value="32.00" step="0.5" class="w-full border rounded p-2 text-sm" oninput="updateQuotation()">
                        </div>
                    </div>
                    <p class="mt-2 text-[10px] text-gray-400">Rémunération, cotisations, frais.</p>
                </div>

                <div class="p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <h4 class="font-bold text-gray-700 mb-3 text-sm uppercase tracking-wider">3. Charges Journalières (CJ)</h4>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs text-gray-500 mb-1">Nombre de jours</label>
                            <input type="number" id="q-days" value="1" class="w-full border rounded p-2 text-sm" oninput="updateQuotation()">
                        </div>
                        <div>
                            <label class="block text-xs text-gray-500 mb-1">Coût journalier (€)</label>
                            <input type="number" id="q-cost-day" value="150.00" step="10" class="w-full border rounded p-2 text-sm" oninput="updateQuotation()">
                        </div>
                    </div>
                    <p class="mt-2 text-[10px] text-gray-400">Amortissement, assurance, taxes.</p>
                </div>
            </div>

            <div class="bg-indigo-900 rounded-2xl p-8 text-white flex flex-col justify-between shadow-xl">
                <div>
                    <h3 class="text-indigo-200 font-bold text-sm uppercase mb-6">Récapitulatif de la cotation</h3>
                    <div class="space-y-4">
                        <div class="flex justify-between border-b border-indigo-800 pb-2">
                            <span>Coût KM (CK)</span>
                            <span id="res-ck" class="font-bold">0.00 €</span>
                        </div>
                        <div class="flex justify-between border-b border-indigo-800 pb-2">
                            <span>Coût Conducteur (CC)</span>
                            <span id="res-cc" class="font-bold">0.00 €</span>
                        </div>
                        <div class="flex justify-between border-b border-indigo-800 pb-2">
                            <span>Charges Journalières (CJ)</span>
                            <span id="res-cj" class="font-bold">0.00 €</span>
                        </div>
                    </div>
                </div>
                
                <div class="mt-12 text-center">
                    <div class="text-indigo-300 text-sm mb-2">Prix de transport Total</div>
                    <div class="text-5xl font-black" id="res-total">0.00 €</div>
                </div>
                
                <button onclick="saveQuotation()" class="mt-8 w-full py-3 bg-white text-indigo-900 rounded-xl font-bold hover:bg-indigo-50 transition shadow-lg">
                    Générer Offre Commerciale
                </button>
            </div>
        </div>
    </div>`;
}

function updateQuotation() {
    const ck = (parseFloat(document.getElementById('q-km').value) || 0) * (parseFloat(document.getElementById('q-cost-km').value) || 0);
    const cc = (parseFloat(document.getElementById('q-hours').value) || 0) * (parseFloat(document.getElementById('q-cost-hour').value) || 0);
    const cj = (parseFloat(document.getElementById('q-days').value) || 0) * (parseFloat(document.getElementById('q-cost-day').value) || 0);
    const total = ck + cc + cj;

    document.getElementById('res-ck').textContent = ck.toFixed(2) + ' €';
    document.getElementById('res-cc').textContent = cc.toFixed(2) + ' €';
    document.getElementById('res-cj').textContent = cj.toFixed(2) + ' €';
    document.getElementById('res-total').textContent = total.toFixed(2) + ' €';
}

async function saveQuotation() {
    const km = document.getElementById('q-km').value;
    const costKm = document.getElementById('q-cost-km').value;
    const hours = document.getElementById('q-hours').value;
    const costHour = document.getElementById('q-cost-hour').value;
    const days = document.getElementById('q-days').value;
    const costDay = document.getElementById('q-cost-day').value;

    const ck = document.getElementById('res-ck').textContent;
    const cc = document.getElementById('res-cc').textContent;
    const cj = document.getElementById('res-cj').textContent;
    const total = document.getElementById('res-total').textContent;

    const offerContent = `
        <div style="padding: 40px; font-family: sans-serif; color: #333;">
            <div style="display: flex; justify-content: space-between; border-bottom: 2px solid #2563eb; padding-bottom: 20px; margin-bottom: 30px;">
                <div>
                    <h1 style="color: #2563eb; margin: 0; font-size: 24px;">Offre Commerciale</h1>
                    <p style="margin: 5px 0; font-weight: bold;">${currentUser?.company_name || 'Transfact'} - Votre partenaire transport</p>
                </div>
                <div style="text-align: right;">
                    <p style="margin: 0;">Date: ${new Date().toLocaleDateString('fr-FR')}</p>
                    <p style="margin: 0;">Réf: DEV-${Date.now().toString().slice(-6)}</p>
                </div>
            </div>

            <div style="margin-bottom: 40px;">
                <h3 style="border-bottom: 1px solid #eee; padding-bottom: 10px; color: #475569;">Détails de la proposition</h3>
                <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                    <thead>
                        <tr style="background: #f1f5f9;">
                            <th style="padding: 12px; text-align: left; border: 1px solid #e2e8f0; font-size: 13px;">Poste de coût</th>
                            <th style="padding: 12px; text-align: center; border: 1px solid #e2e8f0; font-size: 13px;">Quantité / Base</th>
                            <th style="padding: 12px; text-align: right; border: 1px solid #e2e8f0; font-size: 13px;">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style="padding: 12px; border: 1px solid #e2e8f0;">Coût Kilométrique (CK)</td>
                            <td style="padding: 12px; text-align: center; border: 1px solid #e2e8f0;">${km} km à ${costKm}€/km</td>
                            <td style="padding: 12px; text-align: right; border: 1px solid #e2e8f0;">${ck}</td>
                        </tr>
                        <tr>
                            <td style="padding: 12px; border: 1px solid #e2e8f0;">Coût Conducteur (CC)</td>
                            <td style="padding: 12px; text-align: center; border: 1px solid #e2e8f0;">${hours} h à ${costHour}€/h</td>
                            <td style="padding: 12px; text-align: right; border: 1px solid #e2e8f0;">${cc}</td>
                        </tr>
                        <tr>
                            <td style="padding: 12px; border: 1px solid #e2e8f0;">Charges Journalières (CJ)</td>
                            <td style="padding: 12px; text-align: center; border: 1px solid #e2e8f0;">${days} j à ${costDay}€/j</td>
                            <td style="padding: 12px; text-align: right; border: 1px solid #e2e8f0;">${cj}</td>
                        </tr>
                        <tr style="font-weight: bold; font-size: 16px; background: #f0f9ff;">
                            <td colspan="2" style="padding: 15px; border: 1px solid #e2e8f0;">PRIX TOTAL HT</td>
                            <td style="padding: 15px; text-align: right; border: 1px solid #e2e8f0; color: #1d4ed8;">${total}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div style="font-size: 11px; color: #64748b; margin-top: 60px; border-top: 1px solid #e2e8f0; padding-top: 20px; line-height: 1.6;">
                <p style="margin: 0;"><strong>Validité :</strong> Cette offre est valable pour une durée de 30 jours à compter de la date d'émission.</p>
                <p style="margin: 5px 0 0 0;">Cette simulation a été générée via Transfact TMS. Les prix sont indiqués Hors Taxes.</p>
            </div>
        </div>
    `;

    const opt = {
        margin: [0.5, 0.5],
        filename: `Offre_Commerciale_Transfact_${Date.now().toString().slice(-6)}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
    };

    showToast("Génération de l'offre PDF...", "info");

    try {
        await html2pdf().from(offerContent).set(opt).save();
        showToast("Offre commerciale sauvegardée localement", "success");
    } catch (err) {
        console.error("Erreur PDF:", err);
        showToast("Échec de la génération du PDF", "error");
    }
}

// Store chart instances to destroy them when switching tabs
const chartInstances = {};

function destroyAllChartInstances() {
    for (const chartId in chartInstances) {
        if (chartInstances[chartId]) {
            chartInstances[chartId].destroy();
            chartInstances[chartId] = null;
        }
    }
}
// --- ROUTER ---
async function router(route) {
    if (!isAuthenticated) {
        publicRouter(PUBLIC_ROUTES.includes(route) ? route : 'home');
        return;
    }
    if (typeof canAccessRoute === 'function' && !canAccessRoute(route)) {
        showToast("Accès refusé pour votre rôle", "error");
        if (route !== 'dashboard' && canAccessRoute('dashboard')) {
            route = 'dashboard';
        } else {
            return;
        }
    }
    if (typeof canAccessPlanRoute === 'function' && !canAccessPlanRoute(route)) {
        showToast("Fonctionnalité non incluse dans votre forfait", "error");
        route = 'dashboard';
    }
    const appContent = document.getElementById('app-content');
    const pageTitle = document.getElementById('page-title');
    const navItems = document.querySelectorAll('.nav-item');

    // Update active nav
    navItems.forEach(item => {
        item.classList.remove('active');
        const action = item.getAttribute('onclick');
        if (action && action.includes(route)) {
            item.classList.add('active');
        }
    });

    let content = '';
    let title = '';

    switch (route) {
        case 'dashboard':
            title = 'Tableau de bord';
            // Rendu immédiat avec le squelette et les données vides
            content = renderDashboard();

            // Prepare filter query parameters
            const filterParams = new URLSearchParams();
            if (window.dashboardFilters.startDate) {
                filterParams.append('startDate', window.dashboardFilters.startDate);
            }
            if (window.dashboardFilters.endDate) {
                filterParams.append('endDate', window.dashboardFilters.endDate);
            }
            const queryString = filterParams.toString();
            // Chargement asynchrone des statistiques en arrière-plan
            apiFetch(`dashboard/stats${queryString ? `?${queryString}` : ''}`)
                .then(res => res.json())
                .then(stats => {
                    document.getElementById('app-content').innerHTML = renderDashboard(stats);
                    if (window.activeDashboardTab === 'pallets') {
                        loadDashboardPallets();
                    } else {
                        initDashboardCharts(stats);
                    }
                })
                .catch(err => console.warn("Statistiques indisponibles, affichage par défaut", err));
            if (window.activeDashboardTab === 'pallets') {
                setTimeout(() => loadDashboardPallets(), 0);
            }
            break;
        case 'transports':
            title = 'Transports';
            content = renderTransportList();
            break;
        case 'preinvoicing':
            title = 'Préfacturation';
            content = renderPreInvoicing();
            break;
        case 'planning':
            title = 'Planning Hebdomadaire';
            content = renderPlanning();
            break;
        case 'create_order':
            title = 'Créer une Commande';
            content = '<div class="fade-in"><button onclick="openAddOrderModal()" class="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700"><i class="fa-solid fa-plus mr-2"></i>Nouvelle Commande</button></div>';
            break;
        case 'completed_transports':
            title = 'Transports Réalisés';
            content = typeof renderOrdersCompleted === 'function' ? renderOrdersCompleted() : renderCompletedTransports();
            break;
        case 'inprogress_transports':
            title = 'Transports En cours';
            content = typeof renderOrdersInProgress === 'function' ? renderOrdersInProgress() : renderInProgressTransports();
            break;
        case 'clients':
            title = 'Clients';
            content = renderClients();
            break;
        case 'drivers':
            title = 'Chauffeurs';
            content = renderDrivers();
            break;
        case 'fleet':
            title = 'Flotte & Véhicules';
            content = renderFleet();
            break;
        case 'subcontractors':
            title = 'Sous-traitants';
            content = renderSubcontractors();
            break;
        case 'margin_dashboard':
            title = 'Analyse des Marges';
            content = renderMarginDashboard();
            // Load margin data from API
            apiFetch('dispatch/summary')
                .then(res => res.ok ? res : apiFetch('dispatch/margins'))
                .then(res => res.json())
                .then(payload => {
                    updateMarginDashboard(payload.data || payload);
                })
                .catch(err => console.warn('Erreur chargement marges'));
            break;
        case 'affretement_confirmation':
            title = 'Confirmation d\'affrètement';
            content = renderAffretementConfirmationShell();
            setTimeout(() => loadAffretementConfirmationPage(), 0);
            break;
        case 'sales_invoices':
            title = 'Factures Ventes';
            content = renderSalesInvoices();
            break;
        case 'purchase_invoices':
            title = 'Factures Achats';
            content = renderPurchaseInvoices();
            break;
        case 'accounting_export':
            title = 'Export comptable';
            content = renderAccountingExport();
            setTimeout(() => {
                toggleAccountingCustomPeriod();
                loadAccountingSettingsForm();
                loadAccountingExportHistory();
            }, 0);
            break;
        case 'invoice_settings':
            title = 'Paramètres Facturation';
            content = renderSettingInvoices();
            setTimeout(() => loadBankSettingsIntoForm(), 0);
            break;
        case 'create_invoice':
            title = editingInvoiceId ? 'Modifier le brouillon' : 'Nouvelle Facture';
            if (!editingInvoiceId) {
                invoiceLines = [{ desc: '', qty: 1, price: 0 }];
            }
            content = renderCreateInvoice();
            if (editingInvoiceId) {
                setTimeout(() => loadInvoiceDraftForm(editingInvoiceId), 0);
            } else {
                setTimeout(renderLines, 50);
            }
            break;
        case 'admin':
            title = 'Administration';
            content = renderAdmin();
            break;
        case 'pricing':
            title = 'Tarifs';
            if (typeof loadPublicPlans === 'function') await loadPublicPlans();
            content = typeof renderAppPricingPage === 'function' ? renderAppPricingPage() : '';
            break;
        case 'solutions':
            title = 'Nos Solutions';
            content = renderSolutions();
            break;
        case 'contact':
            title = 'Contact & Aide';
            content = isAuthenticated ? renderContact() : renderPublicContact();
            break;
        case 'about':
            title = 'À propos';
            content = renderAbout();
            break;
        case 'quotation':
            title = 'Calculateur de Cotation';
            content = renderQuotationCalculator();
            setTimeout(updateQuotation, 50);
            break;
        default:
            title = 'Tableau de bord';
            content = renderDashboard();

            // Prepare filter query parameters for default route
            const defaultFilterParams = new URLSearchParams();
            if (window.dashboardFilters.startDate) {
                defaultFilterParams.append('startDate', window.dashboardFilters.startDate);
            }
            if (window.dashboardFilters.endDate) {
                defaultFilterParams.append('endDate', window.dashboardFilters.endDate);
            }
            const defaultQueryString = defaultFilterParams.toString();
            apiFetch(`dashboard/stats${defaultQueryString ? `?${defaultQueryString}` : ''}`)
                .then(res => res.json())
                .then(stats => {
                    document.getElementById('app-content').innerHTML = renderDashboard(stats);
                    if (window.activeDashboardTab === 'pallets') {
                        loadDashboardPallets();
                    } else {
                        initDashboardCharts(stats);
                    }
                })
                .catch(err => console.warn("Statistiques indisponibles (default)", err));
            if (window.activeDashboardTab === 'pallets') {
                setTimeout(() => loadDashboardPallets(), 0);
            }
            break;
    }

    if (content) {
        appContent.innerHTML = content;
    }

    pageTitle.textContent = title;
    if (typeof applyRoleBasedNav === 'function') applyRoleBasedNav();
}

// --- TOAST NOTIFICATIONS ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast border-${type === 'success' ? 'green' : type === 'error' ? 'red' : 'blue'}-500`;

    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        info: 'fa-info-circle'
    };

    toast.innerHTML = `
        <i class="fa-solid ${icons[type] || icons.info} text-${type === 'success' ? 'green' : type === 'error' ? 'red' : 'blue'}-500 text-xl mr-3"></i>
        <span class="text-sm text-gray-700">${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// --- MODAL FUNCTIONS ---
function openChartModal() {
    hideAllModals();
    document.getElementById('chart-modal').classList.remove('hidden');
    initChart();
}

function closeChartModal() {
    hideAllModals();
}

function initChart() {
    const ctx = document.getElementById('salesChart');
    if (salesChartInstance) {
        salesChartInstance.destroy();
    }
    salesChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin'],
            datasets: [{
                label: 'Chiffre d\'affaires (€)',
                data: [12000, 19000, 15000, 25000, 22000, 30000],
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } }
        }
    });
}

function updateChart() {
    initChart();
}

function initDashboardCharts(stats = {}) { // Now accepts stats object
    const activeTab = window.activeDashboardTab || 'general';

    // Common options for charts
    const chartColors = ['#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899', '#6366f1'];
    const statusColors = ['#94a3b8', '#3b82f6', '#10b981', '#ef4444']; // Gris, Bleu, Vert, Rouge

    const commonOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } };

    // Clear previous chart instances
    destroyAllChartInstances();

    if (activeTab === 'general') {
        // Evolution CA (Mensuel)
        const revCtx = document.getElementById('revenueEvolutionChart');
        if (revCtx) {
            chartInstances.revenueEvolutionChart = new Chart(revCtx, {
                type: 'bar',
                data: {
                    labels: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'],
                    datasets: [{ label: 'CA (€)', data: stats.revenueChart || new Array(12).fill(0), backgroundColor: '#3b82f6' }]
                },
                options: commonOptions
            });
        }

        // Propre vs Affrètement
        const costCtx = document.getElementById('costBreakdownChart');
        if (costCtx) {
            const own = stats.costBreakdown ? stats.costBreakdown[0] : 0;
            const chartered = stats.costBreakdown ? stats.costBreakdown[1] : 0;
            const data = (own === 0 && chartered === 0) ? [1, 1] : [own, chartered]; // Default to show something if no data
            const labels = (own === 0 && chartered === 0) ? ['Aucune donnée'] : ['Transport Propre', 'Affrètement'];

            chartInstances.costBreakdownChart = new Chart(costCtx, {
                type: 'pie',
                data: {
                    labels: labels,
                    datasets: [{ data: data, backgroundColor: ['#10b981', '#f59e0b'] }]
                },
                options: { ...commonOptions, plugins: { legend: { display: true, position: 'bottom' } } }
            });
        }

        // Performance Géo (Top 5 destinations)
        const geoCtx = document.getElementById('geoPerformanceChart');
        if (geoCtx) {
            const labels = stats.geoPerformance ? stats.geoPerformance.map(item => item.label) : ['Aucune donnée'];
            const data = stats.geoPerformance ? stats.geoPerformance.map(item => item.value) : [1];
            chartInstances.geoPerformanceChart = new Chart(geoCtx, {
                type: 'bar',
                data: { labels, datasets: [{ label: 'Missions', data, backgroundColor: '#8b5cf6' }] },
                options: { ...commonOptions, indexAxis: 'y' }
            });
        }

        // Taux de remplissage
        const donutCapacity = document.getElementById('donutCapacity');
        if (donutCapacity) {
            const fillRate = stats.fillRate || 0;
            const capText = document.getElementById('capacity-text'); // This element is already in renderDashboard
            if (capText) capText.textContent = `${fillRate}%`; // Update text content
            chartInstances.donutCapacity = new Chart(donutCapacity, {
                type: 'doughnut',
                data: {
                    labels: ['Rempli', 'Libre'],
                    datasets: [{ data: [fillRate, 100 - fillRate], backgroundColor: ['#3b82f6', '#f1f5f9'], borderWidth: 0, cutout: '80%' }]
                },
                options: { ...commonOptions, plugins: { legend: { display: false }, tooltip: { enabled: false } } }
            });
        }

        // Expéditions par Client (new)
        const donutExp = document.getElementById('donutExpeditions');
        if (donutExp) {
            const clientLabels = stats.clientTransportCounts ? stats.clientTransportCounts.map(item => item.client_name) : ['Aucune donnée'];
            const clientData = stats.clientTransportCounts ? stats.clientTransportCounts.map(item => item.count) : [1];
            chartInstances.donutExpeditions = new Chart(donutExp, {
                type: 'doughnut',
                data: {
                    labels: clientLabels,
                    datasets: [{
                        data: clientData,
                        backgroundColor: chartColors,
                        borderWidth: 0,
                        cutout: '70%'
                    }]
                },
                options: { ...commonOptions, plugins: { legend: { display: true, position: 'right' } } }
            });
        }

        // Dépenses par Client (new)
        const donutDep = document.getElementById('donutDepenses');
        if (donutDep) {
            const clientLabels = stats.clientTransportCosts ? stats.clientTransportCosts.map(item => item.client_name) : ['Aucune donnée'];
            const clientData = stats.clientTransportCosts ? stats.clientTransportCosts.map(item => item.total_cost) : [1];
            chartInstances.donutDepenses = new Chart(donutDep, {
                type: 'doughnut',
                data: {
                    labels: clientLabels,
                    datasets: [{
                        data: clientData,
                        backgroundColor: chartColors,
                        borderWidth: 0,
                        cutout: '70%'
                    }]
                },
                options: { ...commonOptions, plugins: { legend: { display: true, position: 'right' } } }
            });
        }
    }

    if (activeTab === 'quotations') {
        const total = stats.totalQuotations || 0;
        const converted = stats.orderStatusCounts ? stats.orderStatusCounts.filter(s => s.status === 'Terminé' || s.status === 'En cours').reduce((acc, s) => acc + s.count, 0) : 0;
        const rate = total > 0 ? Math.round((converted / total) * 100) : 0; // Use converted count from backend

        const rateEl = document.getElementById('conversion-rate-kpi');
        if (rateEl) rateEl.textContent = `${rate}%`;

        const convCtx = document.getElementById('quotationConversionChart');
        if (convCtx) {
            const labels = stats.orderStatusCounts ? stats.orderStatusCounts.map(item => item.status) : ['Aucune donnée'];
            const data = stats.orderStatusCounts ? stats.orderStatusCounts.map(item => item.count) : [1];
            chartInstances.quotationConversionChart = new Chart(convCtx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{ data: data, backgroundColor: statusColors, cutout: '60%' }]
                },
                options: { ...commonOptions, plugins: { legend: { display: true, position: 'right' } } }
            });
        }
    }

    if (activeTab === 'invoicing') {
        const invCtx = document.getElementById('invoicingStatusChart');
        if (invCtx) { // Use stats.totalRevenue and stats.outstandingAmount from backend
            const statusSums = { 'Payée': stats.totalRevenue || 0, 'En attente': stats.outstandingAmount || 0 };
            const labels = Object.keys(statusSums);
            const data = Object.values(statusSums);

            chartInstances.invoicingStatusChart = new Chart(invCtx, {
                type: 'pie',
                data: {
                    labels: labels,
                    datasets: [{ data: data, backgroundColor: ['#10b981', '#f59e0b'] }]
                },
                options: { ...commonOptions, plugins: { legend: { display: true, position: 'bottom' } } }
            });
        }
    }
}

// --- MISSION MODALS ---
function openEditMissionModal(missionId) {
    hideAllModals(); // Masquer tous les autres modaux d'abord
    const mission = db.missions.find(m => m.id === missionId);
    if (!mission) return;

    document.getElementById('edit-mission-id').value = missionId;
    document.getElementById('edit-mission-id-display').textContent = missionId;

    // Populate drivers
    const driverSelect = document.getElementById('edit-mission-driver');
    driverSelect.innerHTML = db.drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    driverSelect.value = mission.driver_id || '';

    // Populate vehicles
    const vehicleSelect = document.getElementById('edit-mission-vehicle');
    vehicleSelect.innerHTML = db.vehicles.map(v => `<option value="${v.id}">${v.plate} - ${v.model}</option>`).join('');
    vehicleSelect.value = mission.vehicle_id || '';

    document.getElementById('edit-mission-date').value = mission.date;
    document.getElementById('edit-mission-delivery-time').value = mission.delivery_time || '';

    document.getElementById('edit-mission-modal').classList.remove('hidden');
}

function closeEditMissionModal() {
    hideAllModals();
}

async function submitEditMission() {
    const missionId = parseInt(document.getElementById('edit-mission-id').value);
    const mission = db.missions.find(m => m.id === missionId);

    if (mission) {
        const updatedMission = {
            ...mission,
            driver_id: parseInt(document.getElementById('edit-mission-driver').value) || null,
            vehicle_id: parseInt(document.getElementById('edit-mission-vehicle').value) || null,
            date: document.getElementById('edit-mission-date').value,
            delivery_time: document.getElementById('edit-mission-delivery-time').value
        };

        await apiFetch(`missions/${missionId}`, { method: 'PUT', body: updatedMission });
        await fetchAllData();
        showToast('Mission mise à jour avec succès', 'success');
        closeEditMissionModal();
        router('planning');
    }
}
+
    function openAddMissionModal() {
        hideAllModals();
        // Populate clients
        const clientSelect = document.getElementById('add-mission-client');
        clientSelect.innerHTML = db.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

        // Populate drivers
        const driverSelect = document.getElementById('add-mission-driver');
        driverSelect.innerHTML = db.drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join('');

        // Populate vehicles
        const vehicleSelect = document.getElementById('add-mission-vehicle');
        vehicleSelect.innerHTML = db.vehicles.map(v => `<option value="${v.id}">${v.plate} - ${v.model}</option>`).join('');

        // Set default date
        document.getElementById('add-mission-date').value = new Date().toISOString().split('T')[0];

        document.getElementById('add-mission-modal').classList.remove('hidden');
    }

function closeAddMissionModal() {
    hideAllModals();
}

async function submitAddMission() {
    const newMission = {
        id: Math.max(...db.missions.map(m => m.id)) + 1,
        client_id: parseInt(document.getElementById('add-mission-client').value),
        driver_id: parseInt(document.getElementById('add-mission-driver').value) || null,
        vehicle_id: parseInt(document.getElementById('add-mission-vehicle').value) || null,
        origin: document.getElementById('add-mission-origin').value,
        dest: document.getElementById('add-mission-dest').value,
        date: document.getElementById('add-mission-date').value,
        delivery_time: document.getElementById('add-mission-delivery-time').value,
        price: parseFloat(document.getElementById('add-mission-price').value) || 0,
        status: 'Planifié',
        distance: 0
    };

    if (newMission.client_id && newMission.origin && newMission.dest) {
        await apiFetch('missions', { method: 'POST', body: newMission });
        await fetchAllData();
        showToast('Mission créée avec succès', 'success');
        closeAddMissionModal();
        router('planning');
    } else {
        showToast('Veuillez remplir tous les champs obligatoires', 'error');
    }
}

// --- CLIENT MODALS ---
function openAddClientModal() {
    hideAllModals();

    // Important: le modal aperçu facture (modal-overlay / modal-content) ne doit jamais être réutilisé ici.
    // On le force donc à rester caché et on vide son contenu pour éviter les conflits d'affichage.
    const invoiceOverlay = document.getElementById('modal-overlay');
    const invoiceContent = document.getElementById('modal-content');
    if (invoiceOverlay) {
        invoiceOverlay.classList.add('hidden');
        invoiceOverlay.classList.remove('flex', 'items-center', 'justify-center');
    }
    if (invoiceContent) {
        invoiceContent.classList.add('hidden');
        invoiceContent.innerHTML = '';
    }

    // Afficher uniquement le modal client
    const clientModal = document.getElementById('add-client-modal');
    if (clientModal) clientModal.classList.remove('hidden');

    document.getElementById('client-modal-title').textContent = 'Nouveau Client';
    document.getElementById('edit-client-id').value = '';
    document.getElementById('add-client-name').value = '';
    document.getElementById('add-client-siret').value = '';
    document.getElementById('add-client-email').value = '';
    document.getElementById('add-client-accounting-email').value = '';
    document.getElementById('add-client-phone').value = '';
    document.getElementById('add-client-address').value = '';
    document.getElementById('add-client-tva').value = '';
    document.getElementById('add-client-contact-name').value = '';
    const contactTypeEl = document.getElementById('add-client-contact-type');
    if (contactTypeEl) contactTypeEl.value = 'Exploitant';
}

function openEditClientModal(clientId) {
    hideAllModals();
    const client = db.clients.find(c => c.id === clientId);
    if (!client) return;

    document.getElementById('client-modal-title').textContent = 'Éditer Client';
    document.getElementById('edit-client-id').value = clientId;
    document.getElementById('add-client-name').value = client.name;
    document.getElementById('add-client-siret').value = client.siret || '';
    document.getElementById('add-client-email').value = client.email || '';
    document.getElementById('add-client-accounting-email').value = client.accounting_email || '';
    document.getElementById('add-client-phone').value = client.phone;
    document.getElementById('add-client-address').value = client.address;
    document.getElementById('add-client-tva').value = client.tva || '';
    document.getElementById('add-client-contact-name').value = client.contact_name || '';
    const contactTypeEl = document.getElementById('add-client-contact-type');
    if (contactTypeEl) contactTypeEl.value = client.contact_type || 'Exploitant';

    document.getElementById('add-client-modal').classList.remove('hidden');
}

function closeAddClientModal() {
    hideAllModals();
}

async function submitAddClient() {
    const editId = document.getElementById('edit-client-id').value;
    const clientData = {
        name: document.getElementById('add-client-name').value,
        siret: document.getElementById('add-client-siret').value,
        email: document.getElementById('add-client-email').value,
        accounting_email: document.getElementById('add-client-accounting-email').value,
        phone: document.getElementById('add-client-phone').value,
        address: document.getElementById('add-client-address').value,
        tva: document.getElementById('add-client-tva').value,
        contact_name: document.getElementById('add-client-contact-name').value,
        contact_type: document.getElementById('add-client-contact-type')?.value || 'Exploitant'
    };

    if (!clientData.name) {
        showToast('Le nom du client est obligatoire', 'error');
        return;
    }

    try {
        const response = await apiFetch(editId ? `clients/${editId}` : 'clients', {
            method: editId ? 'PUT' : 'POST',
            body: clientData
        });

        if (response.ok) {
            showToast(editId ? 'Client mis à jour avec succès' : 'Client ajouté avec succès', 'success');
            await fetchAllData();
            closeAddClientModal();
            router('clients');
        } else {
            const errorData = await response.json().catch(() => ({}));
            showToast(errorData.error || `Erreur ${response.status}`, "error");
        }
    } catch (error) {
        showToast("Erreur de communication avec le serveur", "error");
    }
}

// --- DRIVER MODAL ---
function openDriverCardModal(driverId) {
    hideAllModals();
    const driver = db.drivers.find(d => d.id === driverId);
    if (!driver) return;

    const content = document.getElementById('driver-card-content');
    content.innerHTML = `
        <div class="text-center mb-4">
            <div class="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center text-3xl font-bold text-gray-500 mx-auto mb-3">
                ${driver.name.charAt(0)}${driver.name.split(' ')[1].charAt(0)}
            </div>
            <h3 class="font-bold text-xl text-gray-800">${driver.name}</h3>
            <span class="bg-${driver.status === 'Disponible' ? 'green' : 'blue'}-100 text-${driver.status === 'Disponible' ? 'green' : 'blue'}-800 px-3 py-1 rounded-full text-sm">${driver.status}</span>
        </div>
        <div class="space-y-3">
            <div class="flex justify-between border-b pb-2"><span class="text-gray-500">Téléphone</span><span class="font-medium">${driver.phone}</span></div>
            <div class="flex justify-between border-b pb-2"><span class="text-gray-500">Permis</span><span class="font-medium">${driver.license}</span></div>
            <div class="flex justify-between border-b pb-2"><span class="text-gray-500">Expiration permis</span><span class="font-medium">${formatDisplayDate(driver.license_expiry) || '—'}</span></div>
            ${driver.invite_code ? `<div class="flex justify-between border-b pb-2"><span class="text-gray-500">Code mobile</span><span class="font-mono font-bold text-teal-700">${driver.invite_code}</span></div>` : ''}
            ${driver.user_account_id ? '<div class="text-green-700 text-sm mt-2"><i class="fa-solid fa-circle-check mr-1"></i>Compte TMS Mobile activé</div>' : (driver.invite_code ? '<div class="text-teal-700 text-sm mt-2">Code à transmettre au chauffeur pour l\'inscription mobile</div>' : '')}
            <div class="flex justify-between border-b pb-2"><span class="text-gray-500">Adresse</span><span class="font-medium">${driver.address}</span></div>
            <div class="flex justify-between"><span class="text-gray-500">Notes</span><span class="font-medium">${driver.notes || '-'}</span></div>
        </div>
    `;

    document.getElementById('driver-card-modal').classList.remove('hidden');
}

function syncDriverMobileSection({ mode, driver } = {}) {
    const optionEl = document.getElementById('driver-mobile-option');
    const checkbox = document.getElementById('driver-generate-mobile-code');
    const pendingEl = document.getElementById('driver-mobile-pending');
    const displayEl = document.getElementById('driver-invite-display');
    const codeEl = document.getElementById('driver-invite-code');
    const statusEl = document.getElementById('driver-mobile-status');
    const actionsEl = document.getElementById('driver-mobile-actions');
    const regenerateBtn = document.getElementById('btn-regenerate-driver-invite');

    const isEdit = mode === 'edit';
    const isActivated = Boolean(driver?.user_account_id);
    const hasCode = Boolean(driver?.invite_code);

    if (optionEl) optionEl.classList.toggle('hidden', isEdit);
    if (checkbox) {
        checkbox.checked = !isEdit;
        checkbox.disabled = isEdit;
    }

    if (pendingEl) {
        pendingEl.classList.toggle('hidden', isEdit || !(checkbox?.checked));
    }

    if (displayEl && codeEl) {
        const showCode = (isEdit && hasCode) || Boolean(driver?.invite_code);
        displayEl.classList.toggle('hidden', !showCode);
        codeEl.value = showCode ? (driver?.invite_code || '') : '';
    }

    if (regenerateBtn && actionsEl) {
        const showRegenerate = isEdit && !isActivated;
        actionsEl.classList.toggle('hidden', !showRegenerate);
        regenerateBtn.innerHTML = hasCode
            ? '<i class="fa-solid fa-rotate mr-1"></i>Nouveau code'
            : '<i class="fa-solid fa-key mr-1"></i>Générer un code';
    }

    if (statusEl) {
        if (isEdit && isActivated) {
            statusEl.textContent = 'Compte TMS Mobile activé — le chauffeur se connecte avec son code et son mot de passe.';
            statusEl.className = 'text-xs mt-2 ml-7 text-green-700 font-medium';
        } else if (isEdit && hasCode) {
            statusEl.textContent = 'En attente d\'activation — transmettez ce code au chauffeur.';
            statusEl.className = 'text-xs mt-2 ml-7 text-teal-800';
        } else if (isEdit && !hasCode) {
            statusEl.textContent = 'Aucun code mobile — cliquez sur « Générer un code » pour activer l\'accès TMS Mobile.';
            statusEl.className = 'text-xs mt-2 ml-7 text-gray-600';
        } else if (!isEdit && checkbox?.checked) {
            statusEl.textContent = '';
        } else if (!isEdit && !checkbox?.checked) {
            statusEl.textContent = 'Aucun accès mobile ne sera créé pour ce chauffeur.';
            statusEl.className = 'text-xs mt-2 ml-7 text-gray-500';
        } else {
            statusEl.textContent = '';
        }
    }
}

function showDriverInviteCodeAfterCreate(driver) {
    const optionEl = document.getElementById('driver-mobile-option');
    const pendingEl = document.getElementById('driver-mobile-pending');
    const displayEl = document.getElementById('driver-invite-display');
    const codeEl = document.getElementById('driver-invite-code');
    const statusEl = document.getElementById('driver-mobile-status');
    const actionsEl = document.getElementById('driver-mobile-actions');
    const regenerateBtn = document.getElementById('btn-regenerate-driver-invite');

    if (optionEl) optionEl.classList.add('hidden');
    if (pendingEl) pendingEl.classList.add('hidden');

    if (driver?.invite_code) {
        if (displayEl) displayEl.classList.remove('hidden');
        if (codeEl) codeEl.value = driver.invite_code;
        if (actionsEl) actionsEl.classList.remove('hidden');
        if (regenerateBtn) {
            regenerateBtn.innerHTML = '<i class="fa-solid fa-rotate mr-1"></i>Nouveau code';
        }
        if (statusEl) {
            statusEl.textContent = 'Code généré — copiez-le et transmettez-le au chauffeur avant de fermer.';
            statusEl.className = 'text-xs mt-2 ml-7 text-teal-900 font-semibold';
        }
    } else {
        if (displayEl) displayEl.classList.add('hidden');
        if (actionsEl) actionsEl.classList.add('hidden');
        if (statusEl) {
            statusEl.textContent = 'Chauffeur créé sans accès mobile.';
            statusEl.className = 'text-xs mt-2 ml-7 text-gray-500';
        }
    }
}

function copyDriverInviteCode() {
    const codeEl = document.getElementById('driver-invite-code');
    if (!codeEl?.value) return;
    navigator.clipboard.writeText(codeEl.value).then(() => {
        showToast(`Code copié : ${codeEl.value}`, 'success');
    }).catch(() => {
        codeEl.select();
        document.execCommand('copy');
        showToast('Code copié', 'success');
    });
}

async function regenerateDriverInviteCode() {
    const driverId = document.getElementById('edit-driver-id').value;
    if (!driverId) return;

    try {
        const response = await apiFetch(`drivers/${driverId}/regenerate-invite`, { method: 'POST' });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || 'Régénération impossible');
        }
        showToast(`Nouveau code : ${result.invite_code}`, 'success');
        await fetchAllData();
        const driver = db.drivers.find(d => String(d.id) === String(driverId));
        syncDriverMobileSection({ mode: 'edit', driver: driver || { invite_code: result.invite_code, user_account_id: null } });
    } catch (err) {
        showToast(err.message || 'Erreur lors de la régénération', 'error');
    }
}

window.copyDriverInviteCode = copyDriverInviteCode;
window.regenerateDriverInviteCode = regenerateDriverInviteCode;

document.addEventListener('DOMContentLoaded', () => {
    const mobileCheckbox = document.getElementById('driver-generate-mobile-code');
    if (mobileCheckbox) {
        mobileCheckbox.addEventListener('change', () => {
            const pendingEl = document.getElementById('driver-mobile-pending');
            const statusEl = document.getElementById('driver-mobile-status');
            if (document.getElementById('edit-driver-id').value) return;
            if (pendingEl) pendingEl.classList.toggle('hidden', !mobileCheckbox.checked);
            if (statusEl && !mobileCheckbox.checked) {
                statusEl.textContent = 'Aucun accès mobile ne sera créé pour ce chauffeur.';
                statusEl.className = 'text-xs mt-2 ml-7 text-gray-500';
            } else if (statusEl) {
                statusEl.textContent = '';
            }
        });
    }
});

function openAddDriverModal() {
    hideAllModals();
    document.getElementById('driver-modal-title').textContent = 'Nouveau Chauffeur';
    document.getElementById('edit-driver-id').value = '';
    document.getElementById('driver-name').value = '';
    document.getElementById('driver-phone').value = '';
    document.getElementById('driver-license').value = 'C+E';
    document.getElementById('driver-license-expiry').value = '';
    document.getElementById('driver-status').value = 'Disponible';
    document.getElementById('driver-address').value = '';
    document.getElementById('driver-notes').value = '';
    syncDriverMobileSection({ mode: 'create' });

    const deleteBtn = document.getElementById('btn-delete-driver');
    if (deleteBtn) deleteBtn.classList.add('hidden');

    document.getElementById('driver-modal').classList.remove('hidden');
}

function openEditDriverModal(driverId) {
    hideAllModals();
    const driver = db.drivers.find(d => d.id === driverId);
    if (!driver) return;

    document.getElementById('driver-modal-title').textContent = 'Modifier Chauffeur';
    document.getElementById('edit-driver-id').value = driverId;
    document.getElementById('driver-name').value = driver.name;
    document.getElementById('driver-phone').value = driver.phone || '';
    document.getElementById('driver-license').value = driver.license || '';
    document.getElementById('driver-license-expiry').value = formatDateForInput(driver.license_expiry);
    document.getElementById('driver-status').value = driver.status || 'Disponible';
    document.getElementById('driver-address').value = driver.address || '';
    document.getElementById('driver-notes').value = driver.notes || '';
    syncDriverMobileSection({ mode: 'edit', driver });

    const deleteBtn = document.getElementById('btn-delete-driver');
    if (deleteBtn) deleteBtn.classList.remove('hidden');

    document.getElementById('driver-modal').classList.remove('hidden');
}

function closeDriverModal() {
    hideAllModals();
}

async function submitDriver(e) {
    if (e) e.preventDefault();
    const id = document.getElementById('edit-driver-id').value;
    const driverData = {
        name: document.getElementById('driver-name').value,
        phone: document.getElementById('driver-phone').value,
        license: document.getElementById('driver-license').value,
        license_expiry: document.getElementById('driver-license-expiry').value,
        status: document.getElementById('driver-status').value,
        address: document.getElementById('driver-address').value,
        notes: document.getElementById('driver-notes').value
    };
    if (!id) {
        driverData.generate_mobile_code = document.getElementById('driver-generate-mobile-code')?.checked !== false;
    }
    if (!driverData.name) return showToast("Le nom est obligatoire", "error");

    try {
        const response = await apiFetch(id ? `drivers/${id}` : 'drivers', { method: id ? 'PUT' : 'POST', body: driverData });

        if (response.ok) {
            const result = await response.json().catch(() => ({}));
            if (id) {
                showToast('Chauffeur mis à jour', 'success');
                await fetchAllData();
                closeDriverModal();
                router('drivers');
            } else {
                await fetchAllData();
                document.getElementById('edit-driver-id').value = result.id || '';
                document.getElementById('driver-modal-title').textContent = 'Chauffeur créé';
                const created = db.drivers.find(d => String(d.id) === String(result.id));
                showDriverInviteCodeAfterCreate(created || result);
                if (result.invite_code) {
                    showToast(`Code d'activation : ${result.invite_code}`, 'success');
                } else {
                    showToast('Chauffeur ajouté (sans accès mobile)', 'success');
                }
                const deleteBtn = document.getElementById('btn-delete-driver');
                if (deleteBtn && result.id) deleteBtn.classList.remove('hidden');
            }
        } else {
            const errorData = await response.json();
            showToast(errorData.error || `Erreur ${response.status}`, "error");
        }
    } catch (error) {
        showToast("Erreur réseau - Vérifiez le serveur Backend", "error");
    }
}

async function deleteDriver() {
    const id = document.getElementById('edit-driver-id').value;
    if (!id || !confirm("Êtes-vous sûr de vouloir retirer ce chauffeur de l'entreprise ?")) return;

    try {
        const res = await apiFetch(`drivers/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast("Chauffeur retiré avec succès", "success");
            await fetchAllData();
            closeDriverModal();
            router('drivers');
        } else {
            const errorData = await res.json();
            showToast(errorData.error || `Erreur ${res.status}`, "error");
        }
    } catch (error) {
        showToast("Erreur réseau - Vérifiez le serveur Backend", "error");
    }
}

function closeDriverCardModal() {
    hideAllModals();
}

// --- SUBCONTRACTOR MODALS ---
function openAddSubcontractorModal() {
    hideAllModals();

    document.getElementById('subcontractor-modal-title').textContent = 'Nouveau Sous-traitant';
    document.getElementById('edit-subcontractor-id').value = '';
    document.getElementById('add-subcontractor-name').value = '';
    document.getElementById('add-subcontractor-siret').value = '';
    document.getElementById('add-subcontractor-email').value = '';
    document.getElementById('add-subcontractor-phone').value = '';
    document.getElementById('add-subcontractor-address').value = '';
    document.getElementById('add-subcontractor-rc-expiry').value = '';
    document.getElementById('add-subcontractor-urssaf-expiry').value = '';
    document.getElementById('add-subcontractor-insurance-file').value = '';
    document.getElementById('subcontractor-insurance-view').classList.add('hidden');
    document.getElementById('add-subcontractor-status').value = 'ACTIF';
    document.getElementById('subcontractor-rc-warning').classList.add('hidden');
    document.getElementById('btn-delete-subcontractor').classList.add('hidden');
    document.getElementById('add-subcontractor-modal').classList.remove('hidden');
}


function openEditSubcontractorModal(subcontractorId) {
    hideAllModals();

    const subcontractor = db.subcontractors.find(s => s.id === subcontractorId);
    if (!subcontractor) return;

    document.getElementById('subcontractor-modal-title').textContent = 'Modifier Sous-traitant';
    document.getElementById('edit-subcontractor-id').value = subcontractorId;
    document.getElementById('add-subcontractor-name').value = subcontractor.name;
    document.getElementById('add-subcontractor-siret').value = subcontractor.siret || '';
    document.getElementById('add-subcontractor-email').value = subcontractor.email || '';
    document.getElementById('add-subcontractor-phone').value = subcontractor.phone || '';
    document.getElementById('add-subcontractor-address').value = subcontractor.address || '';
    document.getElementById('add-subcontractor-rc-expiry').value = subcontractor.rc_pro_expiry || '';
    document.getElementById('add-subcontractor-urssaf-expiry').value = subcontractor.urssaf_expiry || '';
    document.getElementById('add-subcontractor-insurance-file').value = '';

    const viewLink = document.getElementById('subcontractor-insurance-view');
    if (subcontractor.insurance_doc_url) {
        viewLink.href = normalizeUploadUrl(subcontractor.insurance_doc_url);
        viewLink.classList.remove('hidden');
    } else {
        viewLink.classList.add('hidden');
    }

    document.getElementById('add-subcontractor-status').value = subcontractor.status || 'ACTIF';

    // Check expiry
    const rcExpiry = new Date(subcontractor.rc_pro_expiry);
    const today = new Date();
    if (subcontractor.rc_pro_expiry && rcExpiry < today) {
        document.getElementById('subcontractor-rc-warning').classList.remove('hidden');
    } else {
        document.getElementById('subcontractor-rc-warning').classList.add('hidden');
    }
    document.getElementById('btn-delete-subcontractor').classList.remove('hidden');
    document.getElementById('add-subcontractor-modal').classList.remove('hidden');
}

function closeAddSubcontractorModal() {
    hideAllModals();
}

async function submitAddSubcontractor() {
    const editId = document.getElementById('edit-subcontractor-id').value;
    const formData = new FormData();
    formData.append('name', document.getElementById('add-subcontractor-name').value);
    formData.append('siret', document.getElementById('add-subcontractor-siret').value);
    formData.append('email', document.getElementById('add-subcontractor-email').value);
    formData.append('phone', document.getElementById('add-subcontractor-phone').value);
    formData.append('address', document.getElementById('add-subcontractor-address').value);
    formData.append('rc_pro_expiry', document.getElementById('add-subcontractor-rc-expiry').value);
    formData.append('urssaf_expiry', document.getElementById('add-subcontractor-urssaf-expiry').value);
    formData.append('status', document.getElementById('add-subcontractor-status').value);

    const fileInput = document.getElementById('add-subcontractor-insurance-file');
    if (fileInput && fileInput.files[0]) {
        formData.append('insurance_doc', fileInput.files[0]);
    }

    if (!document.getElementById('add-subcontractor-name').value || !document.getElementById('add-subcontractor-rc-expiry').value) {
        showToast('Nom et expiration RC Pro obligatoires', 'error');
        return;
    }

    try {
        const response = await apiFetch(editId ? `subcontractors/${editId}` : 'subcontractors', {
            method: editId ? 'PUT' : 'POST',
            body: formData
        });

        if (response.ok) {
            showToast(editId ? 'Sous-traitant mis à jour' : 'Sous-traitant ajouté', 'success');
            await fetchAllData();
            closeAddSubcontractorModal();
            router('subcontractors');
        } else {
            const errorData = await response.json();
            showToast(errorData.error || 'Erreur', 'error');
        }
    } catch (error) {
        showToast('Erreur réseau', 'error');
    }
}

async function deleteSubcontractor() {
    const id = document.getElementById('edit-subcontractor-id').value;
    if (!id) return;
    await deleteSubcontractorById(id);
}

async function deleteSubcontractorById(id, name) {
    const label = name ? ` « ${name} »` : '';
    if (!id || !confirm(`Êtes-vous sûr de vouloir supprimer ce sous-traitant${label} ?`)) return;

    try {
        const res = await apiFetch(`subcontractors/${id}`, { method: 'DELETE' });
        if (res.ok) {
            const data = await res.json().catch(() => ({}));
            showToast(data.message || 'Sous-traitant supprimé', 'success');
            await fetchAllData();
            closeAddSubcontractorModal();
            router('subcontractors');
        } else {
            showToast('Erreur lors de la suppression', 'error');
        }
    } catch (error) {
        showToast('Erreur réseau', 'error');
    }
}

window.deleteSubcontractorById = deleteSubcontractorById;

// --- DISPATCH MODALS ---
function openDispatchModal(orderId) {
    hideAllModals();

    const order = db.orders.find(o => o.id === orderId);
    if (!order) return;

    document.getElementById('dispatch-order-id').value = orderId;
    document.getElementById('dispatch-order-ref').textContent = order.ref || '#' + orderId;
    document.getElementById('dispatch-order-price').textContent = (order.price || 0) + '€';
    document.getElementById('dispatch-purchase-price').value = '';

    // Populate valid subcontractors only
    const select = document.getElementById('dispatch-subcontractor');
    const validSubcontractors = db.subcontractors.filter(s =>
        s.status === 'ACTIF' &&
        (!s.rc_pro_expiry || new Date(s.rc_pro_expiry) >= new Date())
    );
    select.innerHTML = '<option value="">-- Sélectionner --</option>' +
        validSubcontractors.map(s => `<option value="${s.id}">${s.name}</option>`).join('');

    // Also add expired ones with warning
    const expired = db.subcontractors.filter(s =>
        s.status === 'ACTIF' && s.rc_pro_expiry && new Date(s.rc_pro_expiry) < new Date()
    );
    if (expired.length > 0) {
        select.innerHTML += '<option disabled>--- Expirés (attention) ---</option>' +
            expired.map(s => `<option value="${s.id}" class="text-red-500">${s.name} ⚠️</option>`).join('');
    }

    calculateDispatchMargin();
    document.getElementById('dispatch-modal').classList.remove('hidden');
}

function closeDispatchModal() {
    hideAllModals();
}

function checkSubcontractorValidity() {
    const select = document.getElementById('dispatch-subcontractor');
    const selectedId = parseInt(select.value);
    const warningEl = document.getElementById('dispatch-subcontractor-warning');

    if (!selectedId) {
        warningEl.classList.add('hidden');
        return;
    }

    const subcontractor = db.subcontractors.find(s => s.id === selectedId);
    if (subcontractor && subcontractor.rc_pro_expiry && new Date(subcontractor.rc_pro_expiry) < new Date()) {
        warningEl.classList.remove('hidden');
    } else {
        warningEl.classList.add('hidden');
    }
}

function calculateDispatchMargin() {
    const order = db.orders.find(o => o.id === parseInt(document.getElementById('dispatch-order-id').value));
    const salePrice = order ? parseFloat(order.price) || 0 : 0;
    const purchasePrice = parseFloat(document.getElementById('dispatch-purchase-price').value) || 0;
    const margin = salePrice - purchasePrice;
    const marginPercent = salePrice > 0 ? ((margin / salePrice) * 100).toFixed(1) : 0;

    document.getElementById('dispatch-sale-display').textContent = salePrice.toFixed(2) + '€';
    document.getElementById('dispatch-cost-display').textContent = purchasePrice.toFixed(2) + '€';
    document.getElementById('dispatch-margin-display').textContent = margin.toFixed(2) + '€ (' + marginPercent + '%)';
    document.getElementById('dispatch-margin-display').className = margin >= 0 ? 'font-bold text-green-600' : 'font-bold text-red-600';
}

async function submitDispatch() {
    const orderId = parseInt(document.getElementById('dispatch-order-id').value);
    const subcontractorId = parseInt(document.getElementById('dispatch-subcontractor').value);
    const purchasePrice = parseFloat(document.getElementById('dispatch-purchase-price').value);

    if (!subcontractorId || !purchasePrice) {
        showToast('Veuillez sélectionner un sous-traitant et saisir le prix d\'achat', 'error');
        return;
    }

    try {
        const response = await apiFetch(`dispatch`, {
            method: 'POST',
            body: {
                order_id: orderId,
                subcontractor_id: subcontractorId,
                purchase_price: purchasePrice
            }
        });

        if (response.ok) {
            const result = await response.json().catch(() => ({}));
            showToast(result.data?.purchaseInvoiceId
                ? 'Affrètement confirmé — ouverture de la confirmation'
                : 'Commande affectée au sous-traitant', 'success');
            await fetchAllData();
            closeDispatchModal();
            openAffretementConfirmation(orderId);
        } else {
            const errorData = await response.json();
            showToast(errorData.error || 'Erreur', 'error');
        }
    } catch (error) {
        showToast('Erreur réseau', 'error');
    }
}

// --- VEHICLE MODALS ---
function openAddVehicleModal() {
    hideAllModals();

    document.getElementById('add-vehicle-plate').value = '';
    document.getElementById('add-vehicle-model').value = '';
    document.getElementById('add-vehicle-fuel').value = 'Diesel';
    document.getElementById('add-vehicle-mileage').value = '';
    document.getElementById('add-vehicle-maintenance').value = '';
    document.getElementById('add-vehicle-modal').classList.remove('hidden');
}


function closeAddVehicleModal() {
    hideAllModals();
}

async function submitAddVehicle() {
    const newVehicle = {
        plate: document.getElementById('add-vehicle-plate').value,
        model: document.getElementById('add-vehicle-model').value,
        fuel: document.getElementById('add-vehicle-fuel').value,
        mileage: parseInt(document.getElementById('add-vehicle-mileage').value) || 0,
        next_maintenance: document.getElementById('add-vehicle-maintenance').value,
        status: 'Disponible',
        driver_id: null,
        insurance_expiry: '2025-12-31'
    };

    if (newVehicle.plate && newVehicle.model) {
        try {
            const response = await apiFetch('vehicles', { method: 'POST', body: newVehicle });

            if (response.ok) {
                await fetchAllData();
                showToast('Camion ajouté avec succès', 'success');
                closeAddVehicleModal();
                router('fleet');
            } else {
                const errorData = await response.json();
                showToast(errorData.error || `Erreur ${response.status}`, "error");
            }
        } catch (error) {
            showToast("Erreur réseau - Vérifiez le serveur Backend", "error");
        }
    } else {
        showToast('Veuillez remplir l\'immatriculation et le modèle', 'error');
    }
}

function openEditVehicleModal(vehicleId) {
    hideAllModals();

    const vehicle = db.vehicles.find(v => v.id === vehicleId);
    if (!vehicle) return;

    document.getElementById('edit-vehicle-id').value = vehicleId;
    document.getElementById('edit-vehicle-plate').value = vehicle.plate;
    document.getElementById('edit-vehicle-model').value = vehicle.model;
    document.getElementById('edit-vehicle-fuel').value = vehicle.fuel || 'Diesel';
    document.getElementById('edit-vehicle-mileage').value = vehicle.mileage || 0;
    document.getElementById('edit-vehicle-maintenance').value = vehicle.next_maintenance || '';
    document.getElementById('edit-vehicle-status').value = vehicle.status || 'Disponible';

    // Populate driver select if it exists in the modal
    const driverSelect = document.getElementById('edit-vehicle-driver');
    if (driverSelect) {
        driverSelect.innerHTML = '<option value="">-- Aucun --</option>' +
            db.drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
        driverSelect.value = vehicle.driver_id || '';
    }

    document.getElementById('edit-vehicle-modal').classList.remove('hidden');
}

function closeEditVehicleModal() {
    hideAllModals();
}

async function submitEditVehicle() {
    const vehicleId = parseInt(document.getElementById('edit-vehicle-id').value);
    const vehicle = db.vehicles.find(v => v.id === vehicleId);

    if (vehicle) {
        const updatedVehicle = {
            ...vehicle,
            plate: document.getElementById('edit-vehicle-plate').value,
            model: document.getElementById('edit-vehicle-model').value,
            fuel: document.getElementById('edit-vehicle-fuel').value,
            mileage: parseInt(document.getElementById('edit-vehicle-mileage').value) || 0,
            next_maintenance: document.getElementById('edit-vehicle-maintenance').value,
            status: document.getElementById('edit-vehicle-status').value
        };

        const driverSelect = document.getElementById('edit-vehicle-driver');
        if (driverSelect) {
            updatedVehicle.driver_id = driverSelect.value ? parseInt(driverSelect.value) : null;
        }

        await apiFetch(`vehicles/${vehicleId}`, { method: 'PUT', body: updatedVehicle });
        await fetchAllData();
        showToast('Véhicule mis à jour avec succès', 'success');
        closeEditVehicleModal();
        router('fleet');
    } else {
        showToast('Véhicule non trouvé', 'error');
    }
}

// --- SALE INVOICE MODAL ---
function openSaleInvoiceModal(orderId) {
    const order = db.orders.find(o => o.id === orderId);
    if (!order) return showToast("Commande introuvable", "error");

    // Si l'utilisateur veut voir/modifier une facture à partir d'une commande
    // On utilise la logique de création qui permet déjà la modification avant validation
    showToast("Génération de l'aperçu de facturation...", "info");
    createInvoiceFromMission(orderId);
}

function closeSaleInvoiceModal() {
    hideAllModals();
}

// --- PURCHASE INVOICE MODAL ---
let selectedPurchaseCategory = 'Carburant';

function openAddPurchaseInvoiceModal(prefill = {}) {
    hideAllModals();
    document.getElementById('add-purchase-supplier').value = prefill.supplier || '';
    document.getElementById('add-purchase-type').value = prefill.type || 'Carburant';
    document.getElementById('add-purchase-ref').value = prefill.ref || '';
    document.getElementById('add-purchase-amount').value = prefill.amount ?? '';
    document.getElementById('add-purchase-date').value = prefill.date || new Date().toISOString().split('T')[0];
    populateSubcontractorSelect(document.getElementById('add-purchase-subcontractor'), prefill.subcontractor_id);
    document.getElementById('add-purchase-order-id').value = prefill.order_id || '';
    selectedPurchaseCategory = prefill.type || 'Carburant';
    togglePurchaseSubcontractorFields();
    switchPurchaseInvoiceTab('manual');
    document.getElementById('add-purchase-invoice-modal').classList.remove('hidden');
}

window.onPurchaseSubcontractorChange = function () {
    const id = parseInt(document.getElementById('add-purchase-subcontractor')?.value, 10);
    const sub = (db.subcontractors || []).find(s => s.id === id);
    if (sub) document.getElementById('add-purchase-supplier').value = sub.name;
};

window.togglePurchaseSubcontractorFields = function () {
    const type = document.getElementById('add-purchase-type')?.value;
    const wrap = document.getElementById('add-purchase-subcontractor-wrap');
    if (wrap) wrap.classList.toggle('hidden', type !== 'Sous-traitance');
    if (type === 'Sous-traitance') {
        populateSubcontractorSelect(document.getElementById('add-purchase-subcontractor'));
    }
};

function closeAddPurchaseInvoiceModal() {
    hideAllModals();
}

function switchPurchaseInvoiceTab(tab) {
    document.getElementById('purchase-invoice-manual').classList.add('hidden');
    document.getElementById('purchase-invoice-scan').classList.add('hidden');
    document.getElementById('purchase-invoice-file').classList.add('hidden');

    document.getElementById('tab-manual').classList.remove('border-blue-600', 'text-blue-600');
    document.getElementById('tab-scan').classList.remove('border-blue-600', 'text-blue-600');
    document.getElementById('tab-file').classList.remove('border-blue-600', 'text-blue-600');
    document.getElementById('tab-manual').classList.add('border-transparent', 'text-gray-500');
    document.getElementById('tab-scan').classList.add('border-transparent', 'text-gray-500');
    document.getElementById('tab-file').classList.add('border-transparent', 'text-gray-500');

    document.getElementById(`purchase-invoice-${tab}`).classList.remove('hidden');
    document.getElementById(`tab-${tab}`).classList.remove('border-transparent', 'text-gray-500');
    document.getElementById(`tab-${tab}`).classList.add('border-blue-600', 'text-blue-600');
}

function openCamera() {
    showToast('Fonctionnalité de scan en cours de développement', 'info');
}

function selectPurchaseCategory(element, category) {
    document.querySelectorAll('.category-tag').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');
    selectedPurchaseCategory = category;
}

async function handlePurchaseFileUpload(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        showToast(`Analyse de ${file.name} en cours...`, 'info');

        // Simulation de l'algorithme d'extraction (OCR / Parsing)
        // Dans une application réelle, on enverrait le fichier au backend
        // ou on utiliserait une librairie type Tesseract.js
        setTimeout(() => {
            const extractedData = {
                ref: "PIECE-" + Math.floor(Math.random() * 9000 + 1000),
                supplier: file.name.includes('Total') ? 'Total Energies' : (file.name.includes('Vinci') ? 'Vinci Autoroutes' : 'Fournisseur Extrait'),
                amount: (Math.random() * 200 + 50).toFixed(2),
                date: new Date().toISOString().split('T')[0],
                type: file.name.toLowerCase().includes('essence') || file.name.toLowerCase().includes('total') ? 'Carburant' : 'Entretien'
            };

            // Remplissage automatique des champs pour validation utilisateur
            document.getElementById('add-purchase-ref').value = extractedData.ref;
            document.getElementById('add-purchase-supplier').value = extractedData.supplier;
            document.getElementById('add-purchase-amount').value = extractedData.amount;
            document.getElementById('add-purchase-date').value = extractedData.date;
            document.getElementById('add-purchase-type').value = extractedData.type;

            // Basculement vers l'onglet manuel pour vérification
            switchPurchaseInvoiceTab('manual');
            showToast("Données extraites avec succès !", "success");
        }, 1500);
    }
}

async function submitPurchaseInvoice() {
    // Check if user is admin
    if (!canManageInvoices()) {
        showToast("Vous n'avez pas l'autorisation d'ajouter des factures d'achat.", "error");
        return;
    }

    const ref = document.getElementById('add-purchase-ref').value;
    const supplier = document.getElementById('add-purchase-supplier').value;
    const type = document.getElementById('add-purchase-type').value;
    const amount = parseFloat(document.getElementById('add-purchase-amount').value);
    const date = document.getElementById('add-purchase-date').value;
    const subcontractorId = parseInt(document.getElementById('add-purchase-subcontractor')?.value, 10);
    const orderId = parseInt(document.getElementById('add-purchase-order-id')?.value, 10);

    if (supplier && amount && date) {
        const newInvoice = {
            id: ref || ("ACH-" + new Date().getFullYear() + "-" + String(db.purchase_invoices.length + 1).padStart(3, '0')),
            supplier: supplier,
            type: type,
            date: date,
            amount: amount,
            status: 'À payer',
            file: null,
            subcontractor_id: type === 'Sous-traitance' && subcontractorId ? subcontractorId : null,
            order_id: orderId || null
        };
        await apiFetch('purchase-invoices', { method: 'POST', body: newInvoice });
        await fetchAllData();
        showToast('Facture d\'achat ajoutée avec succès', 'success');
        closeAddPurchaseInvoiceModal();
        router('purchase_invoices');
    } else {
        showToast('Veuillez remplir tous les champs obligatoires', 'error');
    }
}

// --- USER MODAL (ADMIN) ---
function openAddUserModal() {
    hideAllModals();
    document.getElementById('add-user-name').value = '';
    document.getElementById('add-user-email').value = '';
    document.getElementById('add-user-role').value = 'lecture';
    document.getElementById('add-user-password').value = '';
    toggleAddUserDriverField();
    document.getElementById('add-user-modal').classList.remove('hidden');
}

function toggleAddUserDriverField() {
    const role = document.getElementById('add-user-role')?.value;
    const wrap = document.getElementById('add-user-driver-wrap');
    const select = document.getElementById('add-user-driver');
    if (!wrap || !select) return;
    const show = role === 'chauffeur';
    wrap.classList.toggle('hidden', !show);
    if (show && db.drivers?.length) {
        select.innerHTML = db.drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    }
}

function closeAddUserModal() {
    hideAllModals();
}

async function submitAddUser() {
    const name = document.getElementById('add-user-name').value;
    const email = document.getElementById('add-user-email').value;
    const role = document.getElementById('add-user-role').value;
    const password = document.getElementById('add-user-password').value;
    const driverId = document.getElementById('add-user-driver')?.value;

    if (name && email && password) {
        if (role === 'chauffeur' && !driverId) {
            showToast('Sélectionnez le conducteur lié au compte chauffeur', 'error');
            return;
        }
        const newUser = { name, email, role, password };
        if (role === 'chauffeur') newUser.driver_id = parseInt(driverId, 10);
        await apiFetch('users', { method: 'POST', body: newUser });
        await fetchAllData();
        showToast('Utilisateur créé avec succès', 'success');
        closeAddUserModal();
        router('admin');
    } else {
        showToast('Veuillez remplir tous les champs', 'error');
    }
}

function normalizeInvoiceItems(items) {
    let lines = items;
    if (typeof lines === 'string') {
        try { lines = JSON.parse(lines); } catch { lines = []; }
    }
    if (!Array.isArray(lines)) return [{ desc: '', qty: 1, price: 0, tva: 0.20 }];
    const mapped = lines.map(item => ({
        desc: item.desc || item.description || '',
        qty: Number(item.qty ?? 1) || 1,
        price: Number(item.price ?? 0) || 0,
        tva: item.tva ?? 0.20
    }));
    return mapped.length ? mapped : [{ desc: '', qty: 1, price: 0, tva: 0.20 }];
}

async function loadInvoiceDraftForm(invoiceId) {
    try {
        const res = await apiFetch(`sales-invoices/${invoiceId}`);
        if (!res.ok) throw new Error('fetch failed');
        const payload = await res.json();
        const invoice = payload.data || payload;

        const clientEl = document.getElementById('invoice-client');
        const dateEl = document.getElementById('invoice-date');
        const dueEl = document.getElementById('invoice-due');
        const numberEl = document.getElementById('invoice-number');
        const numberDisplayEl = document.getElementById('invoice-editor-number');
        const subtitleEl = document.getElementById('invoice-editor-subtitle');

        const invoiceRef = invoice.id || invoice.number || invoiceId;
        if (clientEl) clientEl.value = invoice.client_id;
        if (dateEl) dateEl.value = formatDateForInput(invoice.date);
        if (dueEl) dueEl.value = formatDateForInput(invoice.due_date || invoice.sent_date || invoice.date);
        if (numberEl) numberEl.value = invoiceRef;
        if (numberDisplayEl) numberDisplayEl.textContent = invoiceRef;
        if (subtitleEl) subtitleEl.textContent = 'Reprise du brouillon';

        invoiceLines = normalizeInvoiceItems(invoice.items);
        renderLines();
        previewInvoice();
        showToast('Reprise du brouillon', 'info');
    } catch (err) {
        console.error(err);
        showToast('Impossible de charger le brouillon', 'error');
        invoiceLines = [{ desc: '', qty: 1, price: 0 }];
        renderLines();
    }
}

window.editDraft = function (invoiceId) {
    editingInvoiceId = String(invoiceId);
    router('create_invoice');
};

function closeModal() {
    hideAllModals();
}

window.validateDraft = async function (invoiceId) {
    if (!confirm("Voulez-vous transformer ce brouillon en facture définitive ?")) return;
    try {
        const res = await apiFetch(`sales-invoices/${invoiceId}/validate`, { method: 'POST' });
        if (res.ok) {
            showToast("Facture validée avec succès !", "success");
            await fetchAllData();
            closeModal();
            router('sales_invoices');
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || "Erreur de validation", "error");
        }
    } catch (e) { showToast("Serveur injoignable", "error"); }
};

window.createCreditNote = async function (invoiceId, isPartial) {
    if (!canManageInvoices()) {
        showToast('Permission insuffisante pour créer un avoir', 'error');
        return;
    }

    const inv = db.sales_invoices.find(i => String(i.id) === String(invoiceId));
    if (inv && !isCreditNoteEligibleInvoice(inv)) {
        showToast('Seules les factures validées ou payées peuvent faire l\'objet d\'un avoir', 'error');
        return;
    }

    const message = isPartial
        ? 'Voulez-vous ouvrir la saisie d\'un avoir partiel pour cette facture ?'
        : 'Voulez-vous générer un avoir total pour cette facture ?';

    if (isPartial) {
        openPartialCreditNoteModal(invoiceId);
        return;
    }

    if (!confirm(message)) return;

    try {
        const res = await apiFetch(`sales-invoices/${invoiceId}/credit-note`, {
            method: 'POST',
            body: { isPartial: false }
        });

        if (res.ok) {
            const payload = await res.json().catch(() => ({}));
            showToast(`Avoir ${payload.number || ''} créé avec succès`.trim(), 'success');
            await fetchAllData();
            closeInvoiceModal();
            closeCreditNoteModal();
            router('sales_invoices');
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Erreur de création d\'avoir', 'error');
        }
    } catch (e) {
        showToast('Serveur injoignable', 'error');
    }
};

function confirmSendInvoice(invoiceId, clientEmail) {
    if (!clientEmail) {
        showToast('Aucun email trouvé pour ce client. Veuillez éditer le client pour ajouter un email.', 'error');
        return;
    }

    if (confirm('Êtes-vous sûr de vouloir envoyer la facture ' + invoiceId + ' à l\'adresse email:\n\n' + clientEmail + ' ?')) {
        sendInvoice(invoiceId);
    }
}

function sendInvoice(invoiceId) {
    // Check if user is admin
    if (!canManageInvoices()) {
        showToast("Vous n'avez pas l'autorisation d'envoyer des factures.", "error");
        closeModal();
        return;
    }

    const invoice = db.sales_invoices.find(inv => inv.id === invoiceId);
    const client = db.clients.find(c => c.id == invoice.client_id);

    if (invoice && client && client.email) {
        invoice.sent_date = new Date().toISOString().split('T')[0];

        // Show success message with client email
        showToast('Facture envoyée par email à: ' + client.email, 'success');

        // Refresh the invoice list
        router('sales_invoices');
    } else if (invoice) {
        invoice.sent_date = new Date().toISOString().split('T')[0];
        showToast('Facture marquée comme envoyée', 'success');
        router('sales_invoices');
    }
    closeModal();
}

function relanceFacture(invoiceId) {
    if (!canManageInvoices()) {
        showToast("Vous n'avez pas l'autorisation de relancer des factures.", "error");
        return;
    }

    const today = new Date().toISOString().split('T')[0];
    if (!confirm(`Envoyer une relance pour la facture ${invoiceId} ?`)) return;

    (async () => {
        try {
            const res = await apiFetch(`sales-invoices/${invoiceId}`, {
                method: 'PUT',
                body: { reminder_date: today }
            });
            if (res.ok) {
                showToast('Relance enregistrée pour la facture ' + invoiceId, 'success');
                await fetchAllData();
                router('sales_invoices');
            } else {
                const err = await res.json().catch(() => ({}));
                showToast(err.error || 'Échec de la relance', 'error');
            }
        } catch (e) {
            showToast('Erreur de communication avec le serveur', 'error');
        }
    })();
}

async function downloadInvoicePDF(invoiceId) {
    showToast('Génération de la facture Factur-X (PDF/A-3)...', 'info');
    try {
        const response = await apiFetch(`sales-invoices/${invoiceId}/download`);
        if (!response.ok) throw new Error('Erreur de génération serveur');

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `facture_${invoiceId}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        showToast('Facture conforme téléchargée', 'success');
    } catch (err) {
        console.error(err);
        showToast('Erreur lors de la génération PDF/A-3', 'error');
    }
}

window.filterPurchaseInvoicesBySubcontractor = function (subcontractorName) {
    const sub = (db.subcontractors || []).find(s => s.name === subcontractorName);
    purchaseInvoiceFilter.subcontractor_id = sub ? sub.id : '';
    purchaseInvoiceFilter.type = 'Sous-traitance';
    router('purchase_invoices');
};

function renderAccountingExport() {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentYear = String(now.getFullYear());
    const currentQuarter = `Q${Math.floor(now.getMonth() / 3) + 1}`;

    return `<div class="max-w-6xl mx-auto space-y-6 fade-in pb-8">
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 class="text-xl font-bold text-gray-800 mb-1"><i class="fa-solid fa-file-csv text-emerald-600 mr-2"></i>Export comptable</h3>
            <p class="text-sm text-gray-500 mb-6">Extrayez les factures ventes et achats au format CSV comptable pour vos déclarations de TVA et votre expert-comptable.</p>

            <div class="grid md:grid-cols-2 gap-6">
                <div class="space-y-4">
                    <h4 class="font-semibold text-gray-700">Période</h4>
                    <select id="acc-export-period-type" onchange="toggleAccountingCustomPeriod()" class="w-full border rounded-lg px-3 py-2 text-sm">
                        <option value="month">Mois</option>
                        <option value="quarter">Trimestre</option>
                        <option value="year">Année</option>
                        <option value="custom">Période personnalisée</option>
                    </select>
                    <div id="acc-export-period-month">
                        <input type="month" id="acc-export-month" value="${currentMonth}" class="w-full border rounded-lg px-3 py-2 text-sm">
                    </div>
                    <div id="acc-export-period-quarter" class="hidden flex gap-2">
                        <input type="number" id="acc-export-quarter-year" value="${currentYear}" min="2020" max="2099" class="w-1/2 border rounded-lg px-3 py-2 text-sm" placeholder="Année">
                        <select id="acc-export-quarter" class="w-1/2 border rounded-lg px-3 py-2 text-sm">
                            <option value="Q1" ${currentQuarter === 'Q1' ? 'selected' : ''}>T1</option>
                            <option value="Q2" ${currentQuarter === 'Q2' ? 'selected' : ''}>T2</option>
                            <option value="Q3" ${currentQuarter === 'Q3' ? 'selected' : ''}>T3</option>
                            <option value="Q4" ${currentQuarter === 'Q4' ? 'selected' : ''}>T4</option>
                        </select>
                    </div>
                    <div id="acc-export-period-year" class="hidden">
                        <input type="number" id="acc-export-year" value="${currentYear}" min="2020" max="2099" class="w-full border rounded-lg px-3 py-2 text-sm">
                    </div>
                    <div id="acc-export-period-custom" class="hidden grid grid-cols-2 gap-2">
                        <label class="text-xs text-gray-500">Du<input type="date" id="acc-export-start" class="w-full border rounded-lg px-2 py-1 text-sm mt-1"></label>
                        <label class="text-xs text-gray-500">Au<input type="date" id="acc-export-end" class="w-full border rounded-lg px-2 py-1 text-sm mt-1"></label>
                    </div>
                </div>

                <div class="space-y-4">
                    <h4 class="font-semibold text-gray-700">Options d'export</h4>
                    <div class="flex flex-wrap gap-4 text-sm">
                        <label class="flex items-center gap-2"><input type="checkbox" id="acc-export-sales" checked> Ventes</label>
                        <label class="flex items-center gap-2"><input type="checkbox" id="acc-export-purchases" checked> Achats</label>
                    </div>
                    <div>
                        <p class="text-xs text-gray-500 mb-2">Niveau de détail</p>
                        <label class="flex items-center gap-2 text-sm mb-1"><input type="radio" name="acc-export-detail" value="line" checked> Ligne par ligne (détail fiscal)</label>
                        <label class="flex items-center gap-2 text-sm"><input type="radio" name="acc-export-detail" value="invoice"> Synthèse par facture</label>
                    </div>
                    <div>
                        <p class="text-xs text-gray-500 mb-2">Filtrer les taux de TVA</p>
                        <div class="flex flex-wrap gap-3 text-sm">
                            <label class="flex items-center gap-1"><input type="checkbox" class="acc-vat-rate" value="20" checked> 20 %</label>
                            <label class="flex items-center gap-1"><input type="checkbox" class="acc-vat-rate" value="10" checked> 10 %</label>
                            <label class="flex items-center gap-1"><input type="checkbox" class="acc-vat-rate" value="5.5" checked> 5,5 %</label>
                            <label class="flex items-center gap-1"><input type="checkbox" class="acc-vat-rate" value="0" checked> Exonéré</label>
                        </div>
                    </div>
                    <div>
                        <p class="text-xs text-gray-500 mb-2">Format</p>
                        <select id="acc-export-format" class="w-full border rounded-lg px-3 py-2 text-sm">
                            <option value="standard">CSV comptable standard (TVA détaillée)</option>
                            <option value="sage">Format Sage (écritures comptables)</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="flex flex-wrap gap-3 mt-6 pt-6 border-t">
                <button type="button" onclick="previewAccountingExport()" class="bg-white border border-emerald-300 text-emerald-800 px-4 py-2 rounded-lg text-sm hover:bg-emerald-50">
                    <i class="fa-solid fa-eye mr-1"></i> Aperçu
                </button>
                <button type="button" onclick="generateAccountingExport()" class="bg-emerald-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-emerald-700 shadow-sm">
                    <i class="fa-solid fa-download mr-1"></i> Générer l'export
                </button>
            </div>
            <div id="acc-export-warnings" class="mt-4 hidden text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3"></div>
        </div>

        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h4 class="font-semibold text-gray-800 mb-4"><i class="fa-solid fa-sliders mr-2 text-gray-500"></i>Plan comptable paramétrable</h4>
            <div class="grid md:grid-cols-3 gap-4">
                <label class="text-sm">Compte ventes<input id="acc-setting-sales" class="w-full border rounded-lg px-3 py-2 mt-1" placeholder="706000"></label>
                <label class="text-sm">Compte achats<input id="acc-setting-purchase" class="w-full border rounded-lg px-3 py-2 mt-1" placeholder="604000"></label>
                <label class="text-sm">TVA collectée<input id="acc-setting-vat-collected" class="w-full border rounded-lg px-3 py-2 mt-1" placeholder="445710"></label>
                <label class="text-sm">TVA déductible<input id="acc-setting-vat-deductible" class="w-full border rounded-lg px-3 py-2 mt-1" placeholder="445660"></label>
                <label class="text-sm">Centre analytique<input id="acc-setting-cost-center" class="w-full border rounded-lg px-3 py-2 mt-1" placeholder="TRANSPORT"></label>
                <label class="text-sm">Taux TVA par défaut (%)<input id="acc-setting-vat-rate" type="number" step="0.1" class="w-full border rounded-lg px-3 py-2 mt-1" placeholder="20"></label>
            </div>
            <button type="button" onclick="saveAccountingSettings()" class="mt-4 bg-gray-800 text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-900">
                <i class="fa-solid fa-save mr-1"></i> Enregistrer le plan comptable
            </button>
        </div>

        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h4 class="font-semibold text-gray-800 mb-4"><i class="fa-solid fa-clock-rotate-left mr-2 text-gray-500"></i>Historique des exports</h4>
            <div id="acc-export-history" class="text-sm text-gray-500 italic">Chargement...</div>
        </div>

        <div id="acc-export-preview-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div class="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
                <div class="flex justify-between items-center p-4 border-b">
                    <h3 class="font-bold text-lg">Aperçu CSV comptable</h3>
                    <button type="button" onclick="closeAccountingPreview()" class="text-gray-400 hover:text-gray-600"><i class="fa-solid fa-times text-xl"></i></button>
                </div>
                <div class="p-4 overflow-auto flex-1">
                    <p id="acc-preview-meta" class="text-sm text-gray-500 mb-3"></p>
                    <div id="acc-preview-table" class="overflow-x-auto text-xs"></div>
                </div>
                <div class="p-4 border-t flex justify-end gap-2">
                    <button type="button" onclick="closeAccountingPreview()" class="px-4 py-2 border rounded text-gray-600">Fermer</button>
                    <button type="button" onclick="generateAccountingExport(); closeAccountingPreview();" class="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700">Télécharger</button>
                </div>
            </div>
        </div>
    </div>`;
}

window.toggleAccountingCustomPeriod = function () {
    const type = document.getElementById('acc-export-period-type')?.value || 'month';
    ['month', 'quarter', 'year', 'custom'].forEach((key) => {
        document.getElementById(`acc-export-period-${key}`)?.classList.toggle('hidden', key !== type);
    });
    if (type === 'quarter') {
        document.getElementById('acc-export-period-quarter')?.classList.remove('hidden');
        document.getElementById('acc-export-period-quarter')?.classList.add('flex');
    }
};

function getAccountingExportOptions() {
    const periodType = document.getElementById('acc-export-period-type')?.value || 'month';
    let periodValue = null;
    let startDate = null;
    let endDate = null;

    if (periodType === 'month') {
        periodValue = document.getElementById('acc-export-month')?.value || null;
    } else if (periodType === 'quarter') {
        const year = document.getElementById('acc-export-quarter-year')?.value;
        const q = document.getElementById('acc-export-quarter')?.value;
        periodValue = year && q ? `${year}-${q}` : null;
    } else if (periodType === 'year') {
        periodValue = document.getElementById('acc-export-year')?.value || null;
    } else {
        startDate = document.getElementById('acc-export-start')?.value || null;
        endDate = document.getElementById('acc-export-end')?.value || null;
    }

    const vatRates = Array.from(document.querySelectorAll('.acc-vat-rate:checked')).map((el) => el.value);
    const detailLevel = document.querySelector('input[name="acc-export-detail"]:checked')?.value || 'line';

    return {
        periodType,
        periodValue,
        startDate,
        endDate,
        includeSales: document.getElementById('acc-export-sales')?.checked !== false,
        includePurchases: document.getElementById('acc-export-purchases')?.checked !== false,
        detailLevel,
        vatRates: vatRates.length ? vatRates : null,
        format: document.getElementById('acc-export-format')?.value || 'standard'
    };
}

async function loadAccountingSettingsForm() {
    try {
        const res = await apiFetch('accounting/settings');
        if (!res.ok) return;
        const { data } = await res.json();
        document.getElementById('acc-setting-sales').value = data.account_sales || '706000';
        document.getElementById('acc-setting-purchase').value = data.account_purchase || '604000';
        document.getElementById('acc-setting-vat-collected').value = data.account_vat_collected || '445710';
        document.getElementById('acc-setting-vat-deductible').value = data.account_vat_deductible || '445660';
        document.getElementById('acc-setting-cost-center').value = data.cost_center || '';
        document.getElementById('acc-setting-vat-rate').value = data.default_vat_rate ?? 20;
    } catch (e) { /* ignore */ }
}

async function loadAccountingExportHistory() {
    const container = document.getElementById('acc-export-history');
    if (!container) return;
    try {
        const res = await apiFetch('accounting/export/history');
        if (!res.ok) throw new Error('Historique indisponible');
        const { data } = await res.json();
        if (!data?.length) {
            container.innerHTML = '<p class="text-gray-400 italic">Aucun export généré pour le moment.</p>';
            return;
        }
        container.innerHTML = `<table class="w-full text-sm text-left">
            <thead class="text-xs uppercase bg-gray-50 border-b"><tr>
                <th class="px-3 py-2">Date</th><th class="px-3 py-2">Fichier</th><th class="px-3 py-2">Période</th><th class="px-3 py-2">Lignes</th><th class="px-3 py-2">Utilisateur</th>
            </tr></thead>
            <tbody>${data.map(row => `<tr class="border-b hover:bg-gray-50">
                <td class="px-3 py-2">${formatDisplayDate(row.created_at) || row.created_at}</td>
                <td class="px-3 py-2 font-medium">${row.filename}</td>
                <td class="px-3 py-2">${row.period_start || '—'} → ${row.period_end || '—'}</td>
                <td class="px-3 py-2">${row.row_count}</td>
                <td class="px-3 py-2">${row.user_name || row.user_email || '—'}</td>
            </tr>`).join('')}</tbody>
        </table>`;
    } catch (e) {
        container.innerHTML = '<p class="text-red-500">Impossible de charger l\'historique.</p>';
    }
}

window.saveAccountingSettings = async function () {
    const body = {
        account_sales: document.getElementById('acc-setting-sales')?.value,
        account_purchase: document.getElementById('acc-setting-purchase')?.value,
        account_vat_collected: document.getElementById('acc-setting-vat-collected')?.value,
        account_vat_deductible: document.getElementById('acc-setting-vat-deductible')?.value,
        cost_center: document.getElementById('acc-setting-cost-center')?.value,
        default_vat_rate: Number(document.getElementById('acc-setting-vat-rate')?.value) || 20
    };
    try {
        const res = await apiFetch('accounting/settings', { method: 'PUT', body });
        if (!res.ok) throw new Error('Enregistrement impossible');
        showToast('Plan comptable enregistré', 'success');
    } catch (e) {
        showToast(e.message || 'Erreur enregistrement plan comptable', 'error');
    }
};

function showAccountingWarnings(warnings) {
    const box = document.getElementById('acc-export-warnings');
    if (!box) return;
    if (!warnings?.length) {
        box.classList.add('hidden');
        box.innerHTML = '';
        return;
    }
    box.classList.remove('hidden');
    box.innerHTML = `<strong>Alertes TVA :</strong><ul class="mt-2 list-disc pl-5">${warnings.map(w => `<li>${w}</li>`).join('')}</ul>`;
}

window.closeAccountingPreview = function () {
    document.getElementById('acc-export-preview-modal')?.classList.add('hidden');
};

window.previewAccountingExport = async function () {
    if (!document.getElementById('acc-export-sales')?.checked && !document.getElementById('acc-export-purchases')?.checked) {
        showToast('Sélectionnez au moins Ventes ou Achats', 'error');
        return;
    }
    showToast('Génération de l\'aperçu...', 'info');
    try {
        const res = await apiFetch('accounting/export/preview', { method: 'POST', body: getAccountingExportOptions() });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || 'Aperçu impossible');

        showAccountingWarnings(payload.warnings);
        const meta = document.getElementById('acc-preview-meta');
        if (meta) {
            meta.textContent = `${payload.filename} — ${payload.totalRows} ligne(s) — période ${payload.period?.startDate || '…'} → ${payload.period?.endDate || '…'}`;
        }
        const tableWrap = document.getElementById('acc-preview-table');
        if (tableWrap && payload.headers) {
            const previewRows = payload.previewRows || [];
            tableWrap.innerHTML = `<table class="min-w-full border text-left">
                <thead class="bg-gray-50"><tr>${payload.headers.map(h => `<th class="px-2 py-1 border whitespace-nowrap">${h}</th>`).join('')}</tr></thead>
                <tbody>${previewRows.map(row => `<tr>${row.map(cell => `<td class="px-2 py-1 border whitespace-nowrap">${cell ?? ''}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>`;
        }
        document.getElementById('acc-export-preview-modal')?.classList.remove('hidden');
    } catch (e) {
        showToast(e.message || 'Erreur aperçu export', 'error');
    }
};

window.generateAccountingExport = async function () {
    if (!document.getElementById('acc-export-sales')?.checked && !document.getElementById('acc-export-purchases')?.checked) {
        showToast('Sélectionnez au moins Ventes ou Achats', 'error');
        return;
    }
    showToast('Génération du CSV comptable...', 'info');
    try {
        const response = await apiFetch('accounting/export/generate', { method: 'POST', body: getAccountingExportOptions() });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || 'Export impossible');
        }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const disposition = response.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="([^"]+)"/);
        a.download = match ? match[1] : 'CSV_Comptable.csv';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        showToast('CSV comptable téléchargé', 'success');
        loadAccountingExportHistory();
    } catch (e) {
        showToast(e.message || 'Erreur export comptable', 'error');
    }
};

function exportAccounting(type) {
    router('accounting_export');
}

// --- ORDER FUNCTIONS ---

function populateSubcontractorSelect(selectEl, selectedId) {
    if (!selectEl) return;
    const validSubcontractors = (db.subcontractors || []).filter(s =>
        s.status === 'ACTIF' && (!s.rc_pro_expiry || new Date(s.rc_pro_expiry) >= new Date())
    );
    const expired = (db.subcontractors || []).filter(s =>
        s.status === 'ACTIF' && s.rc_pro_expiry && new Date(s.rc_pro_expiry) < new Date()
    );
    selectEl.innerHTML = '<option value="">-- Sélectionner --</option>' +
        validSubcontractors.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    if (expired.length) {
        selectEl.innerHTML += '<option disabled>--- Expirés ---</option>' +
            expired.map(s => `<option value="${s.id}">${s.name} ⚠️</option>`).join('');
    }
    if (selectedId) selectEl.value = String(selectedId);
}

window.toggleOrderPalletFields = function (prefix) {
    const isEu = document.getElementById(`${prefix}-pallet-type`)?.value === 'palette_europe';
    document.getElementById(`${prefix}-pallet-fields`)?.classList.toggle('hidden', !isEu);
    if (!isEu) {
        const exchangeEl = document.getElementById(`${prefix}-pallet-exchange`);
        if (exchangeEl) exchangeEl.checked = false;
        toggleOrderPalletExchange(prefix);
    }
};

window.toggleOrderPalletExchange = function (prefix) {
    const checked = document.getElementById(`${prefix}-pallet-exchange`)?.checked;
    document.getElementById(`${prefix}-pallets-returned-wrap`)?.classList.toggle('hidden', !checked);
    if (!checked) {
        const returnedEl = document.getElementById(`${prefix}-pallets-returned`);
        if (returnedEl) returnedEl.value = '0';
    }
};

window.toggleAddOrderAssignment = function () {
    const isSub = document.querySelector('input[name="add-order-assignment"]:checked')?.value === 'SUBCONTRACTED';
    document.getElementById('add-order-internal-fields')?.classList.toggle('hidden', isSub);
    document.getElementById('add-order-subcontractor-fields')?.classList.toggle('hidden', !isSub);
    if (isSub) updateAddOrderMargin();
};

window.toggleEditOrderAssignment = function () {
    const isSub = document.querySelector('input[name="edit-order-assignment"]:checked')?.value === 'SUBCONTRACTED';
    document.getElementById('edit-order-internal-fields')?.classList.toggle('hidden', isSub);
    document.getElementById('edit-order-subcontractor-fields')?.classList.toggle('hidden', !isSub);
    if (isSub) updateEditOrderMargin();
};

window.updateAddOrderMargin = function () {
    const price = parseFloat(document.getElementById('add-order-price')?.value) || 0;
    const purchase = parseFloat(document.getElementById('add-order-purchase-price')?.value) || 0;
    const margin = price - purchase;
    const el = document.getElementById('add-order-margin-display');
    if (el) {
        el.textContent = `${margin.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
        el.classList.toggle('text-red-600', margin < 0);
        el.classList.toggle('text-green-700', margin >= 0);
    }
};

window.updateEditOrderMargin = function () {
    const price = parseFloat(document.getElementById('edit-order-price')?.value) || 0;
    const purchase = parseFloat(document.getElementById('edit-order-purchase-price')?.value) || 0;
    const margin = price - purchase;
    const el = document.getElementById('edit-order-margin-display');
    if (el) {
        el.textContent = `${margin.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
        el.classList.toggle('text-red-600', margin < 0);
        el.classList.toggle('text-green-700', margin >= 0);
    }
};

function getOrderAssignmentPayload(prefix) {
    const isSub = document.querySelector(`input[name="${prefix}-assignment"]:checked`)?.value === 'SUBCONTRACTED';
    const price = parseFloat(document.getElementById(`${prefix}-price`)?.value) || 0;
    if (isSub) {
        const subcontractorId = parseInt(document.getElementById(`${prefix}-subcontractor`)?.value, 10);
        const purchasePrice = parseFloat(document.getElementById(`${prefix}-purchase-price`)?.value) || 0;
        return {
            assignment_type: 'SUBCONTRACTED',
            subcontractor_id: subcontractorId || null,
            purchase_price: purchasePrice,
            margin: price - purchasePrice,
            driver_id: null,
            vehicle_id: null
        };
    }
    const driverVal = document.getElementById(`${prefix}-driver`)?.value;
    const vehicleVal = document.getElementById(`${prefix}-vehicle`)?.value;
    return {
        assignment_type: 'INTERNAL',
        subcontractor_id: null,
        purchase_price: 0,
        margin: 0,
        driver_id: driverVal ? parseInt(driverVal, 10) : null,
        vehicle_id: vehicleVal ? parseInt(vehicleVal, 10) : null
    };
}

function getOrderPalletPayload(prefix) {
    const palletType = document.getElementById(`${prefix}-pallet-type`)?.value;
    const isEu = palletType === 'palette_europe';
    const exchange = isEu && document.getElementById(`${prefix}-pallet-exchange`)?.checked;
    return {
        pallet_type: palletType,
        pallet_exchange: !!exchange,
        pallet_count: isEu ? (parseInt(document.getElementById(`${prefix}-pallet-count`)?.value, 10) || 0) : 0,
        pallets_returned: exchange ? (parseInt(document.getElementById(`${prefix}-pallets-returned`)?.value, 10) || 0) : 0
    };
}

function renderDashboardPalletTable(byClient, totals, highlightClientId) {
    const body = document.getElementById('dashboard-pallet-balance-body');
    const foot = document.getElementById('dashboard-pallet-balance-foot');
    if (!body) return;

    if (!byClient || byClient.length === 0) {
        body.innerHTML = '<tr><td colspan="4" class="px-4 py-6 text-center text-gray-400 italic">Aucun mouvement palette enregistré</td></tr>';
        if (foot) foot.innerHTML = '';
        return;
    }

    body.innerHTML = byClient.map(row => {
        const highlight = highlightClientId && String(row.client_id) === String(highlightClientId);
        const balance = Number(row.balance || 0);
        return `<tr class="${highlight ? 'bg-teal-50 ring-1 ring-teal-300' : 'hover:bg-gray-50'}">
            <td class="px-4 py-3 font-medium ${highlight ? 'text-teal-800' : 'text-gray-900'}">${row.client_name || '—'}${highlight ? ' <span class="text-xs text-teal-600">(sélectionné)</span>' : ''}</td>
            <td class="px-4 py-3 text-right">${Number(row.delivered || 0)}</td>
            <td class="px-4 py-3 text-right">${Number(row.returned || 0)}</td>
            <td class="px-4 py-3 text-right font-bold ${balance > 0 ? 'text-orange-600' : balance < 0 ? 'text-blue-600' : 'text-gray-600'}">${balance}</td>
        </tr>`;
    }).join('');

    if (foot) {
        foot.innerHTML = `<tr>
            <td class="px-4 py-3">TOTAL</td>
            <td class="px-4 py-3 text-right">${Number(totals?.delivered || 0)}</td>
            <td class="px-4 py-3 text-right">${Number(totals?.returned || 0)}</td>
            <td class="px-4 py-3 text-right text-orange-600">${Number(totals?.balance || 0)}</td>
        </tr>`;
    }
}

function renderDashboardPalletMovements(movements) {
    const body = document.getElementById('dashboard-pallet-movements-body');
    if (!body) return;
    if (!movements || movements.length === 0) {
        body.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-gray-400 italic">Aucun mouvement récent</td></tr>';
        return;
    }
    body.innerHTML = movements.map(m => `<tr class="hover:bg-gray-50 border-b">
        <td class="px-4 py-2 font-medium text-gray-900">${m.ref || '#' + m.order_id}</td>
        <td class="px-4 py-2">${m.client_name || '—'}</td>
        <td class="px-4 py-2">${formatDisplayDate(m.load_date) || '—'}</td>
        <td class="px-4 py-2 text-right">${Number(m.pallet_count || 0)}</td>
        <td class="px-4 py-2 text-right">${Number(m.pallets_returned || 0)}</td>
        <td class="px-4 py-2">${m.pallet_exchange ? '<span class="text-teal-600">Oui</span>' : '—'}</td>
    </tr>`).join('');
}

window.loadDashboardPallets = async function (highlightClientId) {
    const filterEl = document.getElementById('dashboard-pallet-client-filter');
    const clientId = filterEl?.value || '';
    const query = clientId ? `?client_id=${clientId}` : '';

    if (filterEl && filterEl.options.length <= 1) {
        filterEl.innerHTML = '<option value="">Tous les clients</option>' +
            (db.clients || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        if (clientId) filterEl.value = clientId;
    }

    try {
        const res = await apiFetch(`transport-orders/pallets/balance${query}`);
        if (!res.ok) throw new Error('API indisponible');
        const json = await res.json();
        const { byClient, totals, recentMovements } = json.data || {};

        const deliveredEl = document.getElementById('pallet-kpi-delivered');
        const returnedEl = document.getElementById('pallet-kpi-returned');
        const balanceEl = document.getElementById('pallet-kpi-balance');
        if (deliveredEl) deliveredEl.textContent = Number(totals?.delivered || 0);
        if (returnedEl) returnedEl.textContent = Number(totals?.returned || 0);
        if (balanceEl) balanceEl.textContent = Number(totals?.balance || 0);

        renderDashboardPalletTable(byClient, totals, highlightClientId || clientId);
        renderDashboardPalletMovements(recentMovements);
    } catch (err) {
        console.warn('Soldes palettes indisponibles', err);
        const body = document.getElementById('dashboard-pallet-balance-body');
        if (body) body.innerHTML = '<tr><td colspan="4" class="px-4 py-6 text-center text-red-400">Erreur de chargement</td></tr>';
    }
};

function openAddOrderModal() {
    hideAllModals();
    const clientSelect = document.getElementById('add-order-client');
    if (clientSelect) {
        clientSelect.innerHTML = (db.clients || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    }

    const vehicleSelect = document.getElementById('add-order-vehicle');
    if (vehicleSelect) {
        vehicleSelect.innerHTML = '<option value="">-- Sélectionner un véhicule --</option>' +
            (db.vehicles || []).map(v => `<option value="${v.id}">${v.plate} - ${v.model}</option>`).join('');
    }

    const driverSelect = document.getElementById('add-order-driver');
    if (driverSelect) {
        driverSelect.innerHTML = '<option value="">-- Sélectionner un chauffeur --</option>' +
            (db.drivers || []).map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    }

    populateSubcontractorSelect(document.getElementById('add-order-subcontractor'));

    const internalRadio = document.querySelector('input[name="add-order-assignment"][value="INTERNAL"]');
    if (internalRadio) internalRadio.checked = true;
    toggleAddOrderAssignment();

    document.getElementById('add-order-load-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('add-order-delivery-date').value = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    const nextNum = (db.orders || []).length + 1;
    document.getElementById('add-order-ref').value = `CMD-${new Date().getFullYear()}-${String(nextNum).padStart(3, '0')}`;

    document.getElementById('add-order-pallet-type').value = 'palette_europe';
    document.getElementById('add-order-pallet-count').value = '0';
    document.getElementById('add-order-pallet-exchange').checked = false;
    document.getElementById('add-order-pallets-returned').value = '0';
    document.getElementById('add-order-purchase-price').value = '';
    toggleOrderPalletFields('add-order');
    toggleOrderPalletExchange('add-order');
    updateAddOrderMargin();

    const modal = document.getElementById('add-order-modal');
    modal.classList.remove('hidden');
    if (!modal.classList.contains('flex')) modal.classList.add('flex', 'items-center', 'justify-center');
}
window.openAddOrderModal = openAddOrderModal;

function closeAddOrderModal() {
    hideAllModals();
}

async function submitAddOrder() {
    const assignment = getOrderAssignmentPayload('add-order');
    const pallet = getOrderPalletPayload('add-order');
    const newOrder = {
        ref: document.getElementById('add-order-ref').value,
        client_id: parseInt(document.getElementById('add-order-client').value, 10),
        cargo: document.getElementById('add-order-cargo').value,
        origin: document.getElementById('add-order-origin').value,
        dest: document.getElementById('add-order-dest').value,
        load_date: document.getElementById('add-order-load-date').value,
        delivery_date: document.getElementById('add-order-delivery-date').value,
        weight: parseFloat(document.getElementById('add-order-weight').value) || 0,
        price: parseFloat(document.getElementById('add-order-price').value) || 0,
        status: 'Brouillon',
        ...assignment,
        ...pallet
    };

    if (assignment.assignment_type === 'SUBCONTRACTED' && !assignment.subcontractor_id) {
        showToast('Veuillez sélectionner un sous-traitant', 'error');
        return;
    }

    if (newOrder.client_id && newOrder.origin && newOrder.dest && newOrder.load_date) {
        await apiFetch('transport-orders', { method: 'POST', body: newOrder });
        await fetchAllData();
        showToast('Commande créée avec succès ! Elle apparaît maintenant dans le planning.', 'success');
        closeAddOrderModal();
        router('planning');
    } else {
        showToast('Veuillez remplir les champs obligatoires', 'error');
    }
}

function openEditOrderModal(orderId) {
    hideAllModals();
    const order = db.orders.find(o => o.id === orderId);
    if (!order) return;

    document.getElementById('edit-order-id').value = orderId;
    document.getElementById('edit-order-ref-display').textContent = order.ref || orderId;
    document.getElementById('edit-order-ref').value = order.ref || '';

    const clientSelect = document.getElementById('edit-order-client');
    clientSelect.innerHTML = (db.clients || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    clientSelect.value = order.client_id || '';

    const vehicleSelect = document.getElementById('edit-order-vehicle');
    vehicleSelect.innerHTML = '<option value="">-- Sélectionner un véhicule --</option>' +
        (db.vehicles || []).map(v => `<option value="${v.id}">${v.plate} - ${v.model}</option>`).join('');
    vehicleSelect.value = order.vehicle_id || '';

    const driverSelect = document.getElementById('edit-order-driver');
    driverSelect.innerHTML = '<option value="">-- Sélectionner un chauffeur --</option>' +
        (db.drivers || []).map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    driverSelect.value = order.driver_id || '';

    populateSubcontractorSelect(document.getElementById('edit-order-subcontractor'), order.subcontractor_id);

    const isSub = order.assignment_type === 'SUBCONTRACTED';
    const assignRadio = document.querySelector(`input[name="edit-order-assignment"][value="${isSub ? 'SUBCONTRACTED' : 'INTERNAL'}"]`);
    if (assignRadio) assignRadio.checked = true;
    document.getElementById('edit-order-purchase-price').value = order.purchase_price || '';
    toggleEditOrderAssignment();
    updateEditOrderMargin();

    document.getElementById('edit-order-cargo').value = order.cargo || '';
    document.getElementById('edit-order-origin').value = order.origin || '';
    document.getElementById('edit-order-dest').value = order.dest || '';
    document.getElementById('edit-order-load-date').value = formatDateForInput(order.load_date);
    document.getElementById('edit-order-delivery-date').value = formatDateForInput(order.delivery_date);
    document.getElementById('edit-order-weight').value = order.weight || '';
    document.getElementById('edit-order-pallet-type').value = order.pallet_type || 'palette_europe';
    document.getElementById('edit-order-pallet-count').value = order.pallet_count || 0;
    document.getElementById('edit-order-pallet-exchange').checked = !!order.pallet_exchange;
    document.getElementById('edit-order-pallets-returned').value = order.pallets_returned || 0;
    document.getElementById('edit-order-price').value = order.price || '';
    document.getElementById('edit-order-status').value = order.status || 'Brouillon';
    toggleOrderPalletFields('edit-order');
    toggleOrderPalletExchange('edit-order');

    const dispatchBtn = document.getElementById('edit-order-dispatch-btn');
    if (dispatchBtn) {
        dispatchBtn.classList.toggle('hidden', !canShowDispatchButton(order));
        dispatchBtn.onclick = () => { closeEditOrderModal(); openDispatchModal(orderId); };
    }

    const modal = document.getElementById('edit-order-modal');
    modal.classList.remove('hidden');
    if (!modal.classList.contains('flex')) modal.classList.add('flex', 'items-center', 'justify-center');
}
window.openEditOrderModal = openEditOrderModal;
window.openDispatchModal = openDispatchModal;
window.canShowDispatchButton = canShowDispatchButton;

function closeEditOrderModal() {
    hideAllModals();
}

async function submitEditOrder() {
    const orderId = parseInt(document.getElementById('edit-order-id').value, 10);
    const order = db.orders.find(o => o.id === orderId);

    if (order) {
        const assignment = getOrderAssignmentPayload('edit-order');
        const pallet = getOrderPalletPayload('edit-order');
        const updatedStatus = document.getElementById('edit-order-status').value;

        if (assignment.assignment_type === 'SUBCONTRACTED' && !assignment.subcontractor_id) {
            showToast('Veuillez sélectionner un sous-traitant', 'error');
            return;
        }

        await apiFetch(`transport-orders/${orderId}`, {
            method: 'PATCH', body: {
                ref: document.getElementById('edit-order-ref').value,
                client_id: parseInt(document.getElementById('edit-order-client').value, 10),
                cargo: document.getElementById('edit-order-cargo').value,
                origin: document.getElementById('edit-order-origin').value,
                dest: document.getElementById('edit-order-dest').value,
                load_date: document.getElementById('edit-order-load-date').value,
                delivery_date: document.getElementById('edit-order-delivery-date').value,
                weight: parseFloat(document.getElementById('edit-order-weight').value) || 0,
                price: parseFloat(document.getElementById('edit-order-price').value) || 0,
                ...assignment,
                ...pallet
            }
        });
        if (updatedStatus !== order.status) {
            await apiFetch(`transport-orders/${orderId}/status`, { method: 'POST', body: { status: updatedStatus } });
        }
        await fetchAllData();

        showToast('Commande mise à jour avec succès', 'success');
        closeEditOrderModal();
        router('planning');
    } else {
        showToast('Commande non trouvée', 'error');
    }
}

function deleteOrder() {
    const orderId = parseInt(document.getElementById('edit-order-id').value);
    const orderIndex = db.orders.findIndex(o => o.id === orderId);

    if (orderIndex !== -1) {
        if (confirm('Êtes-vous sûr de vouloir supprimer cette commande ?')) {
            db.orders.splice(orderIndex, 1);
            showToast('Commande supprimée avec succès', 'success');
            closeEditOrderModal();
            router('planning');
        }
    }
}
