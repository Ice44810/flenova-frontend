/**
 * Flenova - Application JavaScript (SPA TMS + site public)
 */

// --- MOCK DATABASE ---
let db = { orders: [], clients: [], missions: [], drivers: [], vehicles: [], users: [], sales_invoices: [], purchase_invoices: [], subcontractors: [] };
let subcontractorFilters = { search: '', status: '', compliance: '' };
let purchaseInvoiceFilter = { subcontractor_id: '', type: '' };
let affretementConfirmationOrderId = null;
let cmrPreviewOrderId = null;

let salesChartInstance = null;
let invoiceLines = [];
let editingInvoiceId = null;

function formatDateForInput(value) {
    if (!value) return new Date().toISOString().split('T')[0];
    const s = String(value);
    if (s.includes('T')) return s.split('T')[0];
    return s.slice(0, 10);
}

function getInvoiceAmount(inv) {
    if (!inv) return 0;
    const raw = inv.amount ?? inv.total ?? inv.total_ttc ?? inv.total_ht;
    if (raw != null && raw !== '') {
        const n = Number(raw);
        if (Number.isFinite(n)) return n;
    }
    if (Array.isArray(inv.items) && inv.items.length) {
        return inv.items.reduce((sum, line) => {
            const qty = Number(line.qty ?? line.quantity ?? 1) || 1;
            const price = Number(line.price ?? line.unit_price ?? 0) || 0;
            return sum + qty * price;
        }, 0);
    }
    return 0;
}

function sumInvoiceAmounts(invoices, predicate) {
    return (Array.isArray(invoices) ? invoices : []).reduce((acc, inv) => {
        if (predicate && !predicate(inv)) return acc;
        const amount = getInvoiceAmount(inv);
        return acc + (inv.type === 'Credit Note' ? -amount : amount);
    }, 0);
}

function formatEuro(value) {
    const n = Number(value);
    return (Number.isFinite(n) ? n : 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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
    if (typeof resolveProtectedUploadUrl === 'function') {
        return resolveProtectedUploadUrl(url);
    }
    if (url.startsWith('/uploads/')) return `/api${url}`;
    const match = url.match(/\/uploads\/[^\s?#]+/);
    return match ? `/api${match[0]}` : url;
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
        'invoice-modal', 'transport-detail-modal', 'credit-note-modal', 'dashboard-advanced-filter-modal'
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
const PUBLIC_ROUTES = ['home', 'fonctionnalites', 'tarifs', 'contact', 'privacy', 'legal', 'terms', 'cookies', 'tracking'];
let isAuthenticated = false;
let publicReviewsTimer = null;

function escapePublicHtml(value) {
    if (typeof escapeHtml === 'function') return escapeHtml(value);
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

const PUBLIC_FAQ_ITEMS = [
    {
        q: 'Qu\'est-ce qu\'un TMS et à quoi sert Flenova ?',
        a: 'Un TMS (Transport Management System) centralise vos ordres de transport, planning, exécution terrain et facturation. Flenova est conçu pour les PME et indépendants : une seule plateforme web + mobile, sans ERP lourd.'
    },
    {
        q: 'Puis-je créer mes propres rapports de performance ?',
        a: 'Oui. Le filtre avancé du tableau de bord permet de choisir une période, un client, un chauffeur ou un statut, puis d\'afficher uniquement les indicateurs qui vous intéressent (CA par client, taux d\'annulation, statuts…) directement sur le tableau de bord.'
    },
    {
        q: 'Comment fonctionne l\'essai gratuit ?',
        a: 'À l\'inscription, vous bénéficiez de 30 jours d\'essai Premium avec toutes les fonctionnalités débloquées. Ensuite, choisissez votre forfait (à partir de 129 €/mois HT) et payez par virement bancaire.'
    },
    {
        q: 'Flenova remplace-t-il GedMouv pour les documents sous-traitants ?',
        a: 'Pour la conformité courante — assurance RC Pro, attestation URSSAF, alertes d\'expiration et blocage à l\'affrètement — oui, c\'est intégré dans Flenova. Vous évitez un abonnement séparé dédié à la gestion documentaire sous-traitants.'
    },
    {
        q: 'La facture achat affrètement est-elle créée automatiquement ?',
        a: 'Oui. Dès que vous affrétez un transport à un sous-traitant, Flenova génère la confirmation PDF Factur-X et une facture achat brouillon pré-remplie (fournisseur, montant, lien transport). Aucune ressaisie manuelle.'
    },
    {
        q: 'La facturation électronique et Factur-X sont-ils inclus ?',
        a: 'Oui. Flenova génère vos factures clients au format Factur-X et propose un export comptable CSV pour votre expert-comptable — prêt pour les évolutions réglementaires 2026.'
    },
    {
        q: 'L\'application mobile chauffeur est-elle incluse ?',
        a: 'Oui. Vos chauffeurs consultent leurs missions, confirment les arrivées, collectent les signatures et envoient les preuves de livraison depuis leur smartphone.'
    },
    {
        q: 'Flenova convient-il aux petites structures ?',
        a: 'Absolument. Le forfait Indépendant démarre à 129 €/mois HT pour 1 utilisateur et 3 chauffeurs mobiles. Suppléments disponibles si vous dépassez ces quotas.'
    },
    {
        q: 'Quelle différence entre Indépendant, PME et Premium ?',
        a: 'Indépendant (129 €) couvre l\'exploitation transport et l\'affrètement (20 confirmations/mois). PME (269 €) ajoute sous-traitants complets, marges, palettes et RSE pour 5 PC et 25 mobiles. Premium (449 €) inclut multi-agences, admin et confirmations illimitées. Suppléments : +29 €/PC, +19 €/mobile, +1,50 €/confirmation affrètement au-delà du quota.'
    }
];

const PUBLIC_MVP_STEPS = [
    { n: 1, title: 'Créer', desc: 'Ordre de transport, client, trajet et tarif' },
    { n: 2, title: 'Affecter', desc: 'Chauffeur interne ou sous-traitant' },
    { n: 3, title: 'Exécuter', desc: 'Suivi terrain et preuves de livraison' },
    { n: 4, title: 'Valider', desc: 'Contrôle exploitant avant facturation' },
    { n: 5, title: 'Préfacturer', desc: 'Brouillon facture et export comptable' }
];

function renderPublicAnnouncement() {
    return `<div class="public-announcement" role="note">
        <div class="public-announcement-inner">
            <i class="fa-solid fa-bolt" aria-hidden="true"></i>
            <span><strong>2026 :</strong> Factur-X &amp; export comptable intégrés — anticipez la facturation électronique</span>
            <button type="button" class="public-announcement-link" onclick="publicRouter('fonctionnalites')">Découvrir</button>
        </div>
    </div>`;
}

function renderPublicSocialProof() {
    const logos = ['LogiTrans Ouest', 'Transports MD', 'Routage Express', 'KB Fret', 'PME Routière'];
    return `<section class="public-social-proof" aria-label="Transporteurs qui nous font confiance">
        <div class="public-social-proof-inner">
            <p class="public-social-proof-lead">Des transporteurs PME centralisent déjà leur exploitation avec Flenova</p>
            <div class="public-social-proof-logos">
                ${logos.map((name) => `<span class="public-social-logo">${escapePublicHtml(name)}</span>`).join('')}
            </div>
        </div>
    </section>`;
}

function renderPublicPainPoints() {
    const items = [
        { icon: 'fa-table', title: 'Vous jonglez entre Excel SMS', desc: 'Plannings sur tableur, ressaisies multiples, infos dispersées… Centralisez tout dans un TMS unique.' },
        { icon: 'fa-mobile-screen', title: 'Vos chauffeurs sont déconnectés du bureau', desc: 'L\'app mobile relie le terrain à l\'exploitation : statuts, signatures et documents en temps réel.' },
        { icon: 'fa-file-invoice', title: 'La facturation traîne après la livraison', desc: 'Passez de l\'exécution à la préfacturation sans ressaisie. Factur-X et export comptable inclus.' }
    ];
    return `<section class="public-pain-section">
        <div class="public-section-inner">
            <h2 class="public-section-title">Flenova est fait pour vous si…</h2>
            <div class="public-pain-grid">
                ${items.map((item) => `
                    <article class="public-pain-card">
                        <div class="public-pain-icon"><i class="fa-solid ${item.icon}" aria-hidden="true"></i></div>
                        <h3>${escapePublicHtml(item.title)}</h3>
                        <p>${escapePublicHtml(item.desc)}</p>
                    </article>
                `).join('')}
            </div>
        </div>
    </section>`;
}

function renderPublicProductPillars() {
    const pillars = [
        { icon: 'fa-truck-ramp-box', tag: 'Exploitation', title: 'Commandes &amp; planning', desc: 'Ordres de transport, affectation chauffeurs, app mobile et suivi client — affrètement &amp; marges dès le forfait PME.', link: 'fonctionnalites' },
        { icon: 'fa-mobile-screen-button', tag: 'Mobile', title: 'App chauffeurs', desc: 'Missions, arrivée GPS, signatures et preuves de livraison depuis le smartphone.', link: 'fonctionnalites' },
        { icon: 'fa-file-invoice-dollar', tag: 'Facturation', title: 'Factur-X &amp; compta', desc: 'Préfacturation, factures clients, achats et export CSV pour votre expert-comptable.', link: 'fonctionnalites' }
    ];
    return `<section class="public-pillars-section">
        <div class="public-section-inner">
            <h2 class="public-section-title">Tout votre transport, en 3 piliers</h2>
            <p class="public-section-lead">Une plateforme tout-en-un — pas une suite de modules séparés à assembler.</p>
            <div class="public-pillars-grid">
                ${pillars.map((p) => `
                    <article class="public-pillar-card">
                        <span class="public-pillar-tag">${p.tag}</span>
                        <div class="public-pillar-icon"><i class="fa-solid ${p.icon}" aria-hidden="true"></i></div>
                        <h3>${p.title}</h3>
                        <p>${escapePublicHtml(p.desc)}</p>
                        <button type="button" class="public-pillar-link" onclick="publicRouter('${p.link}')">En savoir plus <i class="fa-solid fa-arrow-right"></i></button>
                    </article>
                `).join('')}
            </div>
        </div>
    </section>`;
}

function renderPublicMvpCycle(compact) {
    const steps = PUBLIC_MVP_STEPS.map((s, i) => `
        <div class="public-mvp-step">
            <div class="public-mvp-step-num">${s.n}</div>
            <strong>${escapePublicHtml(s.title)}</strong>
            <p>${escapePublicHtml(s.desc)}</p>
            ${i < PUBLIC_MVP_STEPS.length - 1 ? '<span class="public-mvp-arrow" aria-hidden="true"><i class="fa-solid fa-chevron-right"></i></span>' : ''}
        </div>
    `).join('');
    return `<section class="public-mvp-section${compact ? ' public-mvp-section--compact' : ''}">
        <div class="public-section-inner">
            <h2 class="public-section-title">Du transport à la facture en 5 étapes</h2>
            ${compact ? '' : '<p class="public-section-lead">Chaque étape met à jour le planning, le tableau de bord et la préfacturation automatiquement.</p>'}
            <div class="public-mvp-flow">${steps}</div>
        </div>
    </section>`;
}

function renderPublicDifferentiators() {
    const items = [
        {
            icon: 'fa-shield-halved',
            badge: 'SANS SURCOÛT',
            title: 'Documents sous-traitants intégrés',
            desc: 'Déposez les attestations assurance RC Pro et URSSAF, recevez des alertes avant expiration et bloquez l\'affrètement si un document est périmé — le tout dans Flenova, sans payer une plateforme dédiée.'
        },
        {
            icon: 'fa-file-circle-check',
            badge: 'Petit plus Flenova',
            title: 'Facture achat affrètement auto',
            desc: 'À chaque affrètement, Flenova génère la confirmation PDF Factur-X et la facture achat brouillon pré-remplie (fournisseur, montant, transport). Zéro ressaisie.'
        },
        {
            icon: 'fa-chart-line',
            badge: 'Reporting intégré',
            title: 'Filtre avancé tableau de bord',
            desc: 'Choisissez vos filtres (période, client, statut…) et les indicateurs à afficher — le tableau de bord ne montre que ce qui compte pour vous, sans scroll inutile.'
        }
    ];
    return `<section class="public-diff-section">
        <div class="public-section-inner">
            <h2 class="public-section-title">Ce qui fait gagner du temps — et de l'argent</h2>
            <p class="public-section-lead">Trois atouts que les TMS généralistes ne couvrent pas, inclus dans votre abonnement Flenova.</p>
            <div class="public-diff-grid public-diff-grid--three">
                ${items.map((item) => `
                    <article class="public-diff-card">
                        <span class="public-diff-badge">${escapePublicHtml(item.badge)}</span>
                        <div class="public-diff-icon"><i class="fa-solid ${item.icon}" aria-hidden="true"></i></div>
                        <h3>${escapePublicHtml(item.title)}</h3>
                        <p>${escapePublicHtml(item.desc)}</p>
                    </article>
                `).join('')}
            </div>
        </div>
    </section>`;
}

function renderPublicWhyFlenova() {
    const items = [
        { icon: 'fa-euro-sign', title: 'Abordable', desc: 'Dès 129 €/mois HT. Pas de devis opaque ni de licence enterprise.' },
        { icon: 'fa-wand-magic-sparkles', title: 'Simple', desc: 'Interface pensée pour les PME. Prise en main rapide, sans intégrateur.' },
        { icon: 'fa-layer-group', title: 'Complet', desc: 'Web + mobile + facturation + export compta — du solo (129 €) au multi-agences (449 €).' }
    ];
    return `<section class="public-why-section">
        <div class="public-section-inner">
            <h2 class="public-section-title">Pourquoi choisir Flenova ?</h2>
            <div class="public-why-grid">
                ${items.map((item) => `
                    <article class="public-why-card">
                        <div class="public-why-icon"><i class="fa-solid ${item.icon}" aria-hidden="true"></i></div>
                        <h3>${escapePublicHtml(item.title)}</h3>
                        <p>${escapePublicHtml(item.desc)}</p>
                    </article>
                `).join('')}
            </div>
        </div>
    </section>`;
}

function renderPublicFaq() {
    const items = PUBLIC_FAQ_ITEMS.map((item, i) => `
        <details class="public-faq-item"${i === 0 ? ' open' : ''}>
            <summary>${escapePublicHtml(item.q)}</summary>
            <p>${escapePublicHtml(item.a)}</p>
        </details>
    `).join('');
    return `<section class="public-faq-section" id="faq">
        <div class="public-section-inner public-faq-inner">
            <h2 class="public-section-title">Questions fréquentes</h2>
            <div class="public-faq-list">${items}</div>
        </div>
    </section>`;
}

function renderPublicCtaBand(title, subtitle) {
    return `<section class="public-cta-band">
        <div class="public-cta-band-inner">
            <h2>${escapePublicHtml(title)}</h2>
            <p>${escapePublicHtml(subtitle)}</p>
            <div class="public-cta-band-actions">
                <a href="register.html" class="public-btn-primary">Essai gratuit 30 jours</a>
                <button type="button" class="public-btn-secondary" onclick="publicRouter('contact')">Demander une démo</button>
            </div>
        </div>
    </section>`;
}

function renderPublicModuleDetail(module) {
    const bullets = module.bullets.map((b) => `<li><i class="fa-solid fa-check" aria-hidden="true"></i>${escapePublicHtml(b)}</li>`).join('');
    return `<section class="public-module-section${module.reverse ? ' public-module-section--reverse' : ''}">
        <div class="public-module-inner">
            <div class="public-module-content">
                <span class="public-module-tag">${escapePublicHtml(module.tag)}</span>
                <h2>${module.title}</h2>
                <p class="public-module-lead">${escapePublicHtml(module.lead)}</p>
                <ul class="public-module-bullets">${bullets}</ul>
                <div class="public-module-actions">
                    <a href="register.html" class="public-btn-primary public-btn-primary--sm">Essayer gratuitement</a>
                    <button type="button" class="public-pillar-link" onclick="publicRouter('contact')">Planifier une démo</button>
                </div>
            </div>
            <div class="public-module-visual" aria-hidden="true">
                <div class="public-module-mock">
                    <i class="fa-solid ${module.icon}"></i>
                    <span>${escapePublicHtml(module.visualLabel)}</span>
                </div>
            </div>
        </div>
    </section>`;
}

function renderPublicHome() {
    return `<div class="public-landing fade-in">
        ${renderPublicAnnouncement()}
        <section class="public-hero">
            <div class="public-hero-bg-shape public-hero-bg-shape-1" aria-hidden="true"></div>
            <div class="public-hero-bg-shape public-hero-bg-shape-2" aria-hidden="true"></div>
            <div class="public-hero-inner">
                <div>
                    <p class="public-hero-eyebrow">TMS SaaS · Transport routier · France</p>
                    <h1 class="public-hero-title">Le TMS pensé pour les transporteurs PME</h1>
                    <p class="public-hero-subtitle">Moins de ressaisie, plus de visibilité, plus de marge. Centralisez commandes, planning, mobile chauffeurs et facturation.</p>
                    <div class="public-hero-cta">
                        <a href="register.html" class="public-btn-primary">Essai gratuit 30 jours</a>
                        <button type="button" class="public-btn-secondary" onclick="publicRouter('contact')">Demander une démo</button>
                    </div>
                    <p class="public-hero-note">À partir de <strong>129 €/mois HT</strong> · Sans engagement · Premium offert à l'inscription</p>
                </div>
                <div class="public-hero-image-wrap">
                    <img src="assets/public-hero-illustration.png" alt="Tableau de bord TMS Flenova — cartes, statistiques et flotte" class="public-hero-image" width="1024" height="622">
                </div>
            </div>
        </section>

        ${renderPublicSocialProof()}
        ${renderPublicPainPoints()}
        ${renderPublicProductPillars()}
        ${renderPublicDifferentiators()}
        ${renderPublicMvpCycle(false)}
        <div id="public-plans-mount" class="public-plans-mount">
            <section class="public-plans-section public-plans-section--loading">
                <div class="public-section-inner text-center py-16 text-gray-500">
                    <i class="fa-solid fa-spinner fa-spin text-2xl" aria-hidden="true"></i>
                    <p class="mt-3 text-sm">Chargement des forfaits…</p>
                </div>
            </section>
        </div>
        ${renderPublicWhyFlenova()}
        ${renderPublicReviewsLoading()}
        ${renderPublicFaq()}
        ${renderPublicCtaBand('Prêt à passer la vitesse supérieure ?', 'Rejoignez les transporteurs qui ont quitté Excel pour un TMS simple et complet.')}
    </div>`;
}

function renderPublicFeatures() {
    const modules = [
        {
            tag: 'Exploitation',
            title: 'Commandes, planning &amp; affrètement',
            lead: 'Créez vos ordres de transport, planifiez sur un calendrier hebdomadaire et pilotez vos marges en temps réel.',
            bullets: ['Ordres de transport et gestion des statuts', 'Planning visuel et affectation chauffeurs / véhicules', 'Affrètement sous-traitant avec confirmation PDF Factur-X', 'Documents sous-traitants : RC Pro, URSSAF et alertes d\'expiration', 'Tableau de bord CA, marges et indicateurs clés'],
            icon: 'fa-calendar-days',
            visualLabel: 'Planning & transports',
            reverse: false
        },
        {
            tag: 'Mobile chauffeur',
            title: 'L\'exécution terrain connectée au bureau',
            lead: 'Vos chauffeurs adoptent une app simple : missions, arrivée GPS, signatures et preuves de livraison.',
            bullets: ['Consultation des missions assignées', 'Confirmation d\'arrivée chargement / livraison', 'Signature électronique et POD', 'Documents scannés remontés instantanément'],
            icon: 'fa-mobile-screen-button',
            visualLabel: 'App mobile chauffeur',
            reverse: true
        },
        {
            tag: 'Facturation',
            title: 'De la livraison à la facture, sans ressaisie',
            lead: 'Validez le transport, générez le brouillon facture et exportez vers votre comptabilité.',
            bullets: ['Préfacturation depuis les transports validés', 'Factures clients Factur-X et avoirs', 'Facture achat affrètement générée automatiquement', 'Export comptable CSV paramétrable'],
            icon: 'fa-file-invoice-dollar',
            visualLabel: 'Factur-X & export CSV',
            reverse: false
        }
    ];

    const extras = [
        { icon: 'fa-chart-pie', title: 'Tableau de bord', desc: 'CA, marges, transports en cours et alertes en un coup d\'œil.' },
        { icon: 'fa-truck', title: 'Gestion de flotte', desc: 'Véhicules, maintenance, assurance et kilométrage.' },
        { icon: 'fa-building-user', title: 'Clients & CRM', desc: 'Fiches clients, contacts et historique des transports.' },
        { icon: 'fa-pallet', title: 'Palettes Europe', desc: 'Suivi des échanges et retours de palettes (forfaits PME+).' },
        { icon: 'fa-handshake-angle', title: 'Sous-traitants', desc: 'Assurance, URSSAF, rappels d\'échéance — pas besoin de GedMouv en plus.' },
        { icon: 'fa-users-gear', title: 'Multi-utilisateurs', desc: 'Rôles exploitant, manager, compta — droits par forfait.' }
    ];

    return `<div class="public-features-page fade-in">
        <div class="public-page-header py-12">
            <div class="max-w-6xl mx-auto px-4 lg:px-8 text-center">
                <p class="public-page-eyebrow">Fonctionnalités</p>
                <h1 class="text-4xl font-extrabold text-blue-900 mb-4">Tout votre transport, une seule plateforme</h1>
                <p class="text-lg text-gray-600 max-w-2xl mx-auto">De la prise de commande à la facturation : exploitation, mobile chauffeurs et compta réunis dans un TMS pensé pour les PME.</p>
            </div>
        </div>

        ${modules.map(renderPublicModuleDetail).join('')}

        <section class="public-extras-section">
            <div class="public-section-inner">
                <h2 class="public-section-title">Et aussi…</h2>
                <div class="public-extras-grid">
                    ${extras.map((e) => `
                        <article class="public-extra-card">
                            <div class="public-extra-icon"><i class="fa-solid ${e.icon}" aria-hidden="true"></i></div>
                            <h3>${escapePublicHtml(e.title)}</h3>
                            <p>${escapePublicHtml(e.desc)}</p>
                        </article>
                    `).join('')}
                </div>
            </div>
        </section>

        ${renderPublicMvpCycle(true)}
        ${renderPublicFaq()}
        ${renderPublicCtaBand('Testez Flenova gratuitement pendant 30 jours', 'Premium offert à l\'inscription — toutes les fonctionnalités débloquées, sans carte bancaire.')}
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
                        <p>support@flenova.fr</p>
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
        case 'privacy':
        case 'legal':
        case 'terms':
        case 'cookies':
            container.innerHTML = typeof renderLegalPage === 'function'
                ? renderLegalPage(route === 'legal' ? 'legal' : route)
                : '<p class="p-8 text-center text-gray-500">Page indisponible</p>';
            break;
        case 'tracking':
            container.innerHTML = '<div class="py-16 text-center text-gray-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>';
            renderPublicTrackingPage().then(html => { container.innerHTML = html; });
            break;
        default:
            container.innerHTML = renderPublicHome();
            loadPublicReviews();
            if (typeof hydratePublicPlansSection === 'function') hydratePublicPlansSection();
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

    const legalFooter = document.getElementById('public-legal-footer');
    if (legalFooter && typeof renderLegalFooterLinks === 'function') {
        legalFooter.innerHTML = renderLegalFooterLinks('justify-center text-xs');
    }

    const hash = (window.location.hash || '').replace('#', '').trim();
    const trackingCode = new URLSearchParams(window.location.search).get('code');
    const initialRoute = (hash && PUBLIC_ROUTES.includes(hash))
        ? hash
        : (trackingCode ? 'tracking' : 'home');
    publicRouter(initialRoute);

    window.addEventListener('hashchange', () => {
        if (isAuthenticated) return;
        const next = (window.location.hash || '').replace('#', '').trim();
        publicRouter(PUBLIC_ROUTES.includes(next) ? next : 'home');
    });
}

// --- BOOTSTRAP ---
function updateAppCompanyHeader(user) {
    const el = document.getElementById('header-company-name');
    if (!el) return;
    const name = user?.company_name || currentUser?.company_name;
    if (name) {
        el.textContent = name;
        el.classList.remove('hidden');
    } else {
        el.textContent = '';
        el.classList.add('hidden');
    }
}
window.updateAppCompanyHeader = updateAppCompanyHeader;

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
            if (typeof updateAppCompanyHeader === 'function') updateAppCompanyHeader(data.user);
            isAuthenticated = true;
        } else {
            throw new Error('Session expirée ou invalide');
        }
    } catch (e) {
        console.warn("Échec de l'authentification au démarrage:", e.message);
        if (typeof clearUserCache === 'function') clearUserCache();
        currentUser = null;
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
    if (typeof applyDemoBanner === 'function') applyDemoBanner();

    const hashRoute = (window.location.hash || '').replace('#', '').split('&')[0].trim();
    const initialRoute = hashRoute || 'dashboard';
    if (ok) {
        router(initialRoute);
    }
    window.addEventListener('hashchange', () => {
        if (!isAuthenticated) return;
        const next = (window.location.hash || '').replace('#', '').split('&')[0].trim();
        if (next && next !== window.currentAppRoute) {
            router(next);
        }
    });
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
const DASHBOARD_METRIC_OPTIONS = [
    { id: 'kpi_activity', label: 'Activité (transports actifs, livrés, à préfacturer)' },
    { id: 'kpi_financial', label: 'Synthèse financière (CA, dépenses, économies)' },
    { id: 'operational_rates', label: 'Taux opérationnels (annulation, livraison…)' },
    { id: 'client_revenue', label: 'CA par client' },
    { id: 'status_distribution', label: 'Répartition des statuts' },
    { id: 'client_volume', label: 'Volume expéditions par client' },
    { id: 'revenue_evolution', label: 'Évolution CA mensuel' },
    { id: 'cost_breakdown', label: 'Propre vs affrètement' },
    { id: 'geo_performance', label: 'Top destinations' },
    { id: 'fill_rate', label: 'Taux remplissage flotte' },
    { id: 'carbon', label: 'Empreinte carbone CO2e' }
];

function getDefaultDashboardFilters() {
    const year = new Date().getFullYear();
    return {
        periodPreset: 'year',
        startDate: `${year}-01-01`,
        endDate: new Date().toISOString().split('T')[0],
        clientId: null,
        driverId: null,
        vehicleId: null,
        trailerId: null,
        country: null,
        originCountry: null,
        destCountry: null,
        activity: null,
        region: null,
        status: null,
        assignmentType: null,
        cargoType: null,
        missionRef: null,
        invoicedOnly: false,
        paidOnly: false,
        cockpitMode: typeof getDefaultCockpitMode === 'function' ? getDefaultCockpitMode() : 'dirigeant',
        reportName: null,
        metrics: []
    };
}

window.dashboardFilters = getDefaultDashboardFilters();
window.dashboardCustomView = false;
window.dashboardSavedViews = [];
window.dashboardFiltersExpanded = false;
window._dashFilterDebounce = null;
window._dashFilterListenersBound = false;

const DASHBOARD_PERIOD_PRESETS = {
    today: 'Aujourd\'hui',
    week: 'Cette semaine',
    month: 'Ce mois',
    quarter: 'Ce trimestre',
    year: 'Cette année',
    custom: 'Personnalisé'
};

const DASHBOARD_COCKPIT_MODES = {
    dirigeant: { label: 'Dirigeant', icon: 'fa-chart-pie' },
    exploitant: { label: 'Exploitant', icon: 'fa-truck-fast' },
    comptabilite: { label: 'Comptable', icon: 'fa-file-invoice-dollar' },
    flotte: { label: 'Responsable flotte', icon: 'fa-gears' }
};

const COCKPIT_SECTIONS = {
    dirigeant: { financial: true, exploitation: false, drivers: false, vehicles: false, clients: true, alerts: true, footer: true, kpiSecondary: true },
    exploitant: { financial: false, exploitation: true, drivers: true, vehicles: true, clients: false, alerts: true, footer: true, kpiSecondary: true },
    comptabilite: { financial: true, exploitation: false, drivers: false, vehicles: false, clients: true, alerts: true, footer: false, kpiSecondary: false },
    flotte: { financial: false, exploitation: true, drivers: false, vehicles: true, clients: false, alerts: true, footer: true, kpiSecondary: true }
};

function getDefaultCockpitMode() {
    const role = typeof getUserRole === 'function' ? getUserRole() : 'lecture';
    if (role === 'comptabilite') return 'comptabilite';
    if (role === 'exploitant') return 'exploitant';
    if (role === 'chauffeur') return 'exploitant';
    if (role === 'admin') return 'dirigeant';
    return 'dirigeant';
}

function isCockpitSectionVisible(section) {
    const profile = getDefaultCockpitMode();
    const layout = COCKPIT_SECTIONS[profile] || COCKPIT_SECTIONS.dirigeant;
    return layout[section] !== false;
}

function getVehiclesByType(type) {
    return (db.vehicles || []).filter(v => (v.vehicle_type || 'TRUCK') === type);
}

function populateDriverFleetSelects(selectedVehicleId, selectedTrailerId) {
    const vehicleSelect = document.getElementById('driver-default-vehicle');
    const trailerSelect = document.getElementById('driver-default-trailer');
    if (vehicleSelect) {
        vehicleSelect.innerHTML = '<option value="">— Aucun —</option>' +
            getVehiclesByType('TRUCK').map(v => `<option value="${v.id}">${v.plate}${v.model ? ` — ${v.model}` : ''}</option>`).join('');
        if (selectedVehicleId) vehicleSelect.value = String(selectedVehicleId);
    }
    if (trailerSelect) {
        trailerSelect.innerHTML = '<option value="">— Aucune —</option>' +
            getVehiclesByType('TRAILER').map(v => `<option value="${v.id}">${v.plate}${v.model ? ` — ${v.model}` : ''}</option>`).join('');
        if (selectedTrailerId) trailerSelect.value = String(selectedTrailerId);
    }
}

function populateOrderFleetSelects(prefix, { vehicleId, trailerId } = {}) {
    const vehicleSelect = document.getElementById(`${prefix}-vehicle`);
    const trailerSelect = document.getElementById(`${prefix}-trailer`);
    if (vehicleSelect) {
        vehicleSelect.innerHTML = '<option value="">-- Auto / manuel --</option>' +
            getVehiclesByType('TRUCK').map(v => `<option value="${v.id}">${v.plate} - ${v.model || 'Camion'}</option>`).join('');
        if (vehicleId) vehicleSelect.value = String(vehicleId);
    }
    if (trailerSelect) {
        trailerSelect.innerHTML = '<option value="">-- Auto / manuel --</option>' +
            getVehiclesByType('TRAILER').map(v => `<option value="${v.id}">${v.plate} - ${v.model || 'Remorque'}</option>`).join('');
        if (trailerId) trailerSelect.value = String(trailerId);
    }
}

function applyDriverFleetToOrder(prefix) {
    const driverId = document.getElementById(`${prefix}-driver`)?.value;
    if (!driverId) return;
    const driver = (db.drivers || []).find(d => String(d.id) === String(driverId));
    if (!driver) return;
    const vehicleSelect = document.getElementById(`${prefix}-vehicle`);
    const trailerSelect = document.getElementById(`${prefix}-trailer`);
    if (vehicleSelect && driver.default_vehicle_id) {
        vehicleSelect.value = String(driver.default_vehicle_id);
    }
    if (trailerSelect && driver.default_trailer_id) {
        trailerSelect.value = String(driver.default_trailer_id);
    }
}
window.applyDriverFleetToOrder = applyDriverFleetToOrder;

async function loadDashboardSavedViewsFromServer() {
    try {
        const res = await apiFetch('dashboard/saved-views');
        if (res.ok) {
            window.dashboardSavedViews = await res.json();
        } else {
            window.dashboardSavedViews = [];
        }
    } catch {
        window.dashboardSavedViews = [];
    }
}

function resolvePeriodDates(preset) {
    const now = new Date();
    const fmt = (d) => d.toISOString().split('T')[0];
    const start = new Date(now);
    if (preset === 'today') return { startDate: fmt(now), endDate: fmt(now) };
    if (preset === 'week') {
        const day = now.getDay() || 7;
        start.setDate(now.getDate() - day + 1);
        return { startDate: fmt(start), endDate: fmt(now) };
    }
    if (preset === 'month') return { startDate: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: fmt(now) };
    if (preset === 'quarter') {
        const q = Math.floor(now.getMonth() / 3) * 3;
        return { startDate: fmt(new Date(now.getFullYear(), q, 1)), endDate: fmt(now) };
    }
    if (preset === 'year') return { startDate: `${now.getFullYear()}-01-01`, endDate: fmt(now) };
    return null;
}

function isDashboardMetricEnabled(key) {
    if (!window.dashboardCustomView) return true;
    const metrics = window.dashboardFilters?.metrics;
    if (!metrics || !metrics.length) return false;
    return metrics.includes(key);
}

function hasActiveDashboardFilters() {
    return !!window.dashboardCustomView;
}

function normalizeDashboardFilters(raw = {}) {
    const norm = (v) => (v === '' || v === undefined ? null : v);
    return {
        ...raw,
        periodPreset: raw.periodPreset || 'custom',
        clientId: norm(raw.clientId),
        driverId: norm(raw.driverId),
        vehicleId: norm(raw.vehicleId),
        trailerId: norm(raw.trailerId),
        country: norm(raw.country),
        originCountry: norm(raw.originCountry),
        destCountry: norm(raw.destCountry),
        activity: norm(raw.activity),
        region: norm(raw.region),
        status: norm(raw.status),
        assignmentType: norm(raw.assignmentType),
        cargoType: norm(raw.cargoType),
        missionRef: norm(raw.missionRef),
        agencyId: norm(raw.agencyId),
        invoicedOnly: !!raw.invoicedOnly,
        paidOnly: !!raw.paidOnly,
        cockpitMode: raw.cockpitMode || getDefaultCockpitMode(),
        reportName: norm(raw.reportName),
        startDate: norm(raw.startDate),
        endDate: norm(raw.endDate),
        metrics: Array.isArray(raw.metrics) ? raw.metrics.filter(Boolean) : []
    };
}

async function refreshDashboardView(options = {}) {
    const { preserveScroll = true } = options;
    const scrollTop = preserveScroll ? document.getElementById('app-content')?.scrollTop : 0;
    destroyAllChartInstances();
    const appContent = document.getElementById('app-content');
    if (!appContent) return;

    await loadDashboardSavedViewsFromServer();
    appContent.innerHTML = renderDashboard();
    window._dashFilterListenersBound = false;
    const loadingEl = document.getElementById('dash-kpi-loading');
    if (loadingEl) loadingEl.classList.remove('hidden');

    try {
        const res = await apiFetch(`dashboard/stats${buildDashboardQueryString()}`);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Erreur ${res.status}`);
        }
        const stats = await res.json();
        appContent.innerHTML = renderDashboard(stats);
        window._dashFilterListenersBound = false;
        initDashboardFilterAutoApply();
        if (window.activeDashboardTab === 'pallets' && !window.dashboardCustomView) {
            loadDashboardPallets();
        } else {
            initDashboardCharts(stats);
        }
        if (preserveScroll && scrollTop) appContent.scrollTop = scrollTop;
    } catch (err) {
        console.warn('Statistiques indisponibles', err);
        showToast(err.message || 'Impossible de charger les KPI filtrés', 'error');
    }
}

function buildDashboardQueryString() {
    const f = window.dashboardFilters || {};
    const p = new URLSearchParams();
    if (f.startDate) p.append('startDate', f.startDate);
    if (f.endDate) p.append('endDate', f.endDate);
    if (f.clientId) p.append('clientId', f.clientId);
    if (f.driverId) p.append('driverId', f.driverId);
    if (f.vehicleId) p.append('vehicleId', f.vehicleId);
    if (f.trailerId) p.append('trailerId', f.trailerId);
    if (f.country) p.append('country', f.country);
    if (f.originCountry) p.append('originCountry', f.originCountry);
    if (f.destCountry) p.append('destCountry', f.destCountry);
    if (f.activity) p.append('activity', f.activity);
    if (f.region) p.append('region', f.region);
    if (f.cargoType) p.append('cargoType', f.cargoType);
    if (f.missionRef) p.append('missionRef', f.missionRef);
    if (f.invoicedOnly) p.append('invoicedOnly', 'true');
    if (f.paidOnly) p.append('paidOnly', 'true');
    if (f.status) p.append('status', f.status);
    if (f.assignmentType) p.append('assignmentType', f.assignmentType);
    if (f.agencyId) p.append('agencyId', f.agencyId);
    if (f.reportName) p.append('reportName', f.reportName);
    if (f.metrics?.length) p.append('metrics', f.metrics.join(','));
    const qs = p.toString();
    return qs ? `?${qs}` : '';
}

function getDashboardFilterSummaryText() {
    const f = window.dashboardFilters || {};
    const parts = [];
    if (f.reportName) parts.push(f.reportName);
    if (f.startDate || f.endDate) parts.push(`${f.startDate || '…'} → ${f.endDate || '…'}`);
    if (f.clientId) {
        const c = (db.clients || []).find(x => String(x.id) === String(f.clientId));
        if (c) parts.push(`Client: ${c.name}`);
    }
    if (f.driverId) {
        const d = (db.drivers || []).find(x => String(x.id) === String(f.driverId));
        if (d) parts.push(`Chauffeur: ${d.name}`);
    }
    if (f.status) parts.push(`Statut: ${f.status}`);
    if (f.assignmentType === 'INTERNAL') parts.push('Flotte propre');
    if (f.assignmentType === 'SUBCONTRACTED') parts.push('Affrètement');
    const metricCount = f.metrics?.length || 0;
    if (metricCount) parts.push(`${metricCount} indicateur${metricCount > 1 ? 's' : ''}`);
    return parts.join(' · ') || 'Période par défaut (année en cours)';
}

function renderDashboardMetricCheckboxes() {
    const box = document.getElementById('dash-filter-metrics');
    if (!box) return;
    const selected = new Set(window.dashboardFilters?.metrics || []);
    box.innerHTML = DASHBOARD_METRIC_OPTIONS.map(m => `
        <label class="flex items-center gap-2 p-2 rounded border border-gray-100 hover:bg-gray-50 cursor-pointer">
            <input type="checkbox" class="dash-metric-cb rounded" value="${m.id}" ${selected.has(m.id) ? 'checked' : ''}>
            <span>${m.label}</span>
        </label>`).join('');
}

function populateDashboardFilterSelects() {
    const clientSel = document.getElementById('dash-filter-client');
    if (clientSel) {
        const cur = window.dashboardFilters.clientId || '';
        clientSel.innerHTML = '<option value="">Tous</option>' + (db.clients || []).map(c =>
            `<option value="${c.id}" ${String(c.id) === String(cur) ? 'selected' : ''}>${c.name}</option>`
        ).join('');
    }
    const driverSel = document.getElementById('dash-filter-driver');
    if (driverSel) {
        const cur = window.dashboardFilters.driverId || '';
        driverSel.innerHTML = '<option value="">Tous</option>' + (db.drivers || []).map(d =>
            `<option value="${d.id}" ${String(d.id) === String(cur) ? 'selected' : ''}>${d.name}</option>`
        ).join('');
    }
}

window.openDashboardAdvancedFilter = function () {
    hideAllModals();
    const f = window.dashboardFilters || getDefaultDashboardFilters();
    document.getElementById('dash-filter-report-name').value = f.reportName || '';
    document.getElementById('dash-filter-start').value = f.startDate || '';
    document.getElementById('dash-filter-end').value = f.endDate || '';
    document.getElementById('dash-filter-status').value = f.status || '';
    document.getElementById('dash-filter-assignment').value = f.assignmentType || '';
    populateDashboardFilterSelects();
    renderDashboardMetricCheckboxes();
    const modal = document.getElementById('dashboard-advanced-filter-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
};

window.closeDashboardAdvancedFilter = function () {
    document.getElementById('dashboard-advanced-filter-modal')?.classList.add('hidden');
};

function readDashboardFilterForm() {
    const metrics = [...document.querySelectorAll('.dash-metric-cb:checked')].map(el => el.value);
    return {
        reportName: document.getElementById('dash-filter-report-name')?.value?.trim() || null,
        startDate: document.getElementById('dash-filter-start')?.value || null,
        endDate: document.getElementById('dash-filter-end')?.value || null,
        clientId: document.getElementById('dash-filter-client')?.value || null,
        driverId: document.getElementById('dash-filter-driver')?.value || null,
        status: document.getElementById('dash-filter-status')?.value || null,
        assignmentType: document.getElementById('dash-filter-assignment')?.value || null,
        metrics
    };
}

window.applyDashboardAdvancedFilter = async function () {
    const filters = normalizeDashboardFilters(readDashboardFilterForm());
    if (!filters.metrics?.length) {
        showToast('Sélectionnez au moins un indicateur à afficher', 'warning');
        return;
    }
    window.dashboardFilters = filters;
    window.dashboardCustomView = true;
    window.activeDashboardTab = 'general';
    closeDashboardAdvancedFilter();
    await refreshDashboardView();
    showToast('Vue filtrée appliquée', 'success');
    document.getElementById('app-content')?.scrollTo?.({ top: 0, behavior: 'smooth' });
};

window.resetDashboardFilters = async function () {
    window.dashboardFilters = getDefaultDashboardFilters();
    window.dashboardCustomView = false;
    closeDashboardAdvancedFilter();
    await refreshDashboardView();
};

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
            if (res.status === 402) {
                console.warn(`Abonnement requis pour ${url}`);
                return [];
            }
            if (!res.ok) return [];
            const data = await res.json();
            if (Array.isArray(data)) return data;
            if (data.data && Array.isArray(data.data)) return data.data;
            const resourceKey = url.split('/')[0].replace('-', '_');
            return (data[resourceKey] && Array.isArray(data[resourceKey])) ? data[resourceKey] : [];
        };
        const mayView = (module) => (typeof can !== 'function') || can(module, 'view');

        const [orders, clients, missions, drivers, vehicles, users, sales, purchase, subcontractors, agencies] = await Promise.all([
            mayView('transports') ? fetchJson('transport-orders') : Promise.resolve([]),
            mayView('clients') ? fetchJson('clients') : Promise.resolve([]),
            mayView('transports') ? fetchJson('missions') : Promise.resolve([]),
            mayView('carriers') ? fetchJson('drivers') : Promise.resolve([]),
            mayView('carriers') ? fetchJson('vehicles') : Promise.resolve([]),
            (typeof canManageUsers === 'function' && canManageUsers()) ? fetchJson('users') : Promise.resolve([]),
            mayView('billing') ? fetchJson('sales-invoices') : Promise.resolve([]),
            mayView('billing') ? fetchJson('purchase-invoices') : Promise.resolve([]),
            mayView('carriers') ? fetchJson('subcontractors') : Promise.resolve([]),
            (typeof canManageUsers === 'function' && canManageUsers()) ? fetchJson('agencies') : Promise.resolve([])
        ]);
        db = { orders, clients, missions, drivers, vehicles, users, sales_invoices: sales, purchase_invoices: purchase, subcontractors, agencies: agencies || [] };
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

// --- DASHBOARD V2 (onglet Général — maquette TMS) ---

function dashMapStatusClass(status) {
    if (['Livré', 'Validé', 'Clôturé', 'Terminé'].includes(status)) return 'status-done';
    if (['En cours', 'Pris en charge', 'Affrété'].includes(status)) return 'status-progress';
    if (status === 'Annulé') return 'status-late';
    return 'status-wait';
}

function dashMapPosition(city, index) {
    const norm = (city || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const map = {
        paris: [48, 28], lille: [48, 12], lyon: [58, 48], marseille: [62, 72],
        bordeaux: [28, 58], nantes: [22, 38], toulouse: [32, 68], strasbourg: [78, 32],
        rennes: [18, 32], nice: [72, 70], montpellier: [42, 72], rouen: [38, 22]
    };
    for (const [key, pos] of Object.entries(map)) {
        if (norm.includes(key)) return { left: pos[0] + '%', top: pos[1] + '%' };
    }
    return { left: (18 + (index * 19) % 62) + '%', top: (22 + (index * 17) % 58) + '%' };
}

function dashV2Kpi(icon, bg, label, value, trend, trendClass) {
    return `<div class="dash-v2-kpi">
        <div class="dash-v2-kpi-icon" style="background:${bg}20;color:${bg}"><i class="fa-solid ${icon}"></i></div>
        <div class="dash-v2-kpi-value">${value}</div>
        <div class="dash-v2-kpi-label">${label}</div>
        ${trend ? `<div class="dash-v2-kpi-trend ${trendClass || 'neutral'}">${trend}</div>` : ''}
    </div>`;
}

function renderDashboardFiltersBody() {
    const f = window.dashboardFilters || getDefaultDashboardFilters();
    const clients = db.clients || [];
    const drivers = db.drivers || [];
    const trucks = getVehiclesByType('TRUCK');
    const trailers = getVehiclesByType('TRAILER');
    const agencies = db.agencies || [];
    const isAdminUser = typeof canManageUsers === 'function' && canManageUsers();
    const preset = f.periodPreset || 'year';
    const presetOpts = Object.entries(DASHBOARD_PERIOD_PRESETS).map(([k, lbl]) =>
        `<option value="${k}" ${preset === k ? 'selected' : ''}>${lbl}</option>`
    ).join('');
    const countries = ['France', 'Belgique', 'Espagne', 'Allemagne', 'Italie', 'Pays-Bas', 'Portugal'];
    const countryOptions = (selected) => countries.map(c =>
        `<option value="${c}" ${selected === c ? 'selected' : ''}>${c}</option>`
    ).join('');

    return `
        <div class="dash-v2-filters-toolbar">
            <div class="dash-v2-filters-toolbar-left">
                <div class="dash-v2-filter-field dash-v2-filter-field--period">
                    <label>Période</label>
                    <select id="dash-inline-preset">${presetOpts}</select>
                </div>
                <div class="dash-v2-filter-dates ${preset === 'custom' ? '' : 'dash-v2-filter-dates--hidden'}" id="dash-inline-dates-wrap">
                    <input type="date" id="dash-inline-start" value="${f.startDate || ''}">
                    <span>→</span>
                    <input type="date" id="dash-inline-end" value="${f.endDate || ''}">
                </div>
            </div>
        </div>
        <div class="dash-v2-filters-grid">
            <div><label>Client</label><select id="dash-inline-client"><option value="">Tous</option>${clients.map(c => `<option value="${c.id}" ${String(c.id) === String(f.clientId) ? 'selected' : ''}>${c.name}</option>`).join('')}</select></div>
            <div><label>Conducteur</label><select id="dash-inline-driver"><option value="">Tous</option>${drivers.map(d => `<option value="${d.id}" ${String(d.id) === String(f.driverId) ? 'selected' : ''}>${d.name}</option>`).join('')}</select></div>
            <div><label>Véhicule</label><select id="dash-inline-vehicle"><option value="">Tous</option>${trucks.map(v => `<option value="${v.id}" ${String(v.id) === String(f.vehicleId) ? 'selected' : ''}>${v.plate || v.model}</option>`).join('')}</select></div>
            <div><label>Remorque</label><select id="dash-inline-trailer"><option value="">Toutes</option>${trailers.map(v => `<option value="${v.id}" ${String(v.id) === String(f.trailerId) ? 'selected' : ''}>${v.plate || v.model}</option>`).join('')}</select></div>
            <div><label>Activité</label><select id="dash-inline-activity"><option value="">Toutes</option><option value="national" ${f.activity === 'national' ? 'selected' : ''}>National</option><option value="international" ${f.activity === 'international' ? 'selected' : ''}>International</option></select></div>
            <div><label>Agence</label><select id="dash-inline-agency" ${isAdminUser ? '' : 'disabled'}><option value="">Toutes</option>${agencies.map(a => `<option value="${a.id}" ${String(a.id) === String(f.agencyId) ? 'selected' : ''}>${a.code} — ${a.name}</option>`).join('')}</select></div>
            <div><label>Type mission</label><select id="dash-inline-assignment"><option value="">Tous</option><option value="INTERNAL" ${f.assignmentType === 'INTERNAL' ? 'selected' : ''}>Flotte propre</option><option value="SUBCONTRACTED" ${f.assignmentType === 'SUBCONTRACTED' ? 'selected' : ''}>Affrètement</option></select></div>
            <div><label>Statut</label><select id="dash-inline-status"><option value="">Tous</option><option value="Livré" ${f.status === 'Livré' ? 'selected' : ''}>Livré</option><option value="En cours" ${f.status === 'En cours' ? 'selected' : ''}>En cours</option><option value="Planifié" ${f.status === 'Planifié' ? 'selected' : ''}>Planifié</option><option value="Validé" ${f.status === 'Validé' ? 'selected' : ''}>Validé</option><option value="Annulé" ${f.status === 'Annulé' ? 'selected' : ''}>Annulé</option></select></div>
            <div><label>Départ</label><select id="dash-inline-origin"><option value="">Tous</option>${countryOptions(f.originCountry)}</select></div>
            <div><label>Destination</label><select id="dash-inline-dest"><option value="">Toutes</option>${countryOptions(f.destCountry)}</select></div>
            <div><label>Région</label><input type="text" id="dash-inline-region" placeholder="Ex. Île-de-France" value="${f.region || ''}"></div>
            <div><label>Marchandise</label><select id="dash-inline-cargo"><option value="">Toutes</option><option value="standard" ${f.cargoType === 'standard' ? 'selected' : ''}>Standard</option><option value="frigo" ${f.cargoType === 'frigo' ? 'selected' : ''}>Frigorifique</option><option value="adr" ${f.cargoType === 'adr' ? 'selected' : ''}>ADR</option></select></div>
            <div><label>N° mission</label><input type="text" id="dash-inline-mission-ref" placeholder="Réf." value="${f.missionRef || ''}"></div>
        </div>
        <div class="dash-v2-filters-footer">
            <label class="dash-v2-checkbox"><input type="checkbox" id="dash-inline-invoiced" ${f.invoicedOnly ? 'checked' : ''}> Afficher uniquement les missions facturées</label>
            <label class="dash-v2-checkbox"><input type="checkbox" id="dash-inline-paid" ${f.paidOnly ? 'checked' : ''}> Uniquement factures payées</label>
            <div class="dash-v2-filters-footer-actions">
                <button type="button" class="dash-v2-btn-save-view dash-v2-btn-save-view--footer" onclick="promptSaveDashboardView()"><i class="fa-solid fa-star"></i> Enregistrer la vue actuelle</button>
                <button type="button" class="dash-v2-btn-reset" onclick="resetDashboardInlineFilters()">Réinitialiser</button>
            </div>
        </div>`;
}

function renderDashboardFiltersBar() {
    const cockpit = getDefaultCockpitMode();
    const cockpitMeta = DASHBOARD_COCKPIT_MODES[cockpit] || DASHBOARD_COCKPIT_MODES.dirigeant;
    const savedViews = window.dashboardSavedViews || [];
    const expanded = !!window.dashboardFiltersExpanded;

    return `<div class="dash-v2-filters-bar">
        <button type="button" class="dash-v2-filters-toggle" onclick="toggleDashboardFilters()" aria-expanded="${expanded}">
            <i class="fa-solid fa-filter"></i> Filtres KPI
            <i class="fa-solid fa-chevron-${expanded ? 'up' : 'down'} dash-v2-filters-chevron"></i>
        </button>
        <span class="dash-v2-cockpit-badge" title="Vue adaptée à votre profil"><i class="fa-solid ${cockpitMeta.icon}"></i> Cockpit ${cockpitMeta.label}</span>
        <div class="dash-v2-filters-bar-actions">
            <label class="dash-v2-saved-view-label">Vues enregistrées</label>
            <select id="dash-inline-saved-view" class="dash-v2-saved-view-select" title="Charger une vue enregistrée">
                <option value="">${savedViews.length ? '— Choisir une vue —' : 'Aucune vue enregistrée'}</option>
                ${savedViews.map(v => `<option value="${v.id}">⭐ ${v.name}</option>`).join('')}
            </select>
            <button type="button" class="dash-v2-btn-save-view" onclick="promptSaveDashboardView()"><i class="fa-solid fa-star"></i> Enregistrer la vue</button>
            <button type="button" class="dash-v2-btn-delete-view" onclick="deleteDashboardSavedView()" title="Supprimer la vue sélectionnée"><i class="fa-solid fa-trash"></i></button>
            <button type="button" class="dash-v2-btn-refresh" onclick="refreshDashboardStatsOnly()" title="Actualiser"><i class="fa-solid fa-arrows-rotate"></i></button>
        </div>
    </div>`;
}

window.toggleDashboardFilters = function () {
    window.dashboardFiltersExpanded = !window.dashboardFiltersExpanded;
    const panel = document.getElementById('dash-filters-panel');
    if (panel) panel.classList.toggle('dash-v2-filters-panel--hidden', !window.dashboardFiltersExpanded);
    const btn = document.querySelector('.dash-v2-filters-toggle');
    if (btn) {
        btn.setAttribute('aria-expanded', window.dashboardFiltersExpanded ? 'true' : 'false');
        const chevron = btn.querySelector('.dash-v2-filters-chevron');
        if (chevron) chevron.className = `fa-solid fa-chevron-${window.dashboardFiltersExpanded ? 'up' : 'down'} dash-v2-filters-chevron`;
    }
};

function readDashboardInlineFilters() {
    const preset = document.getElementById('dash-inline-preset')?.value || 'custom';
    let startDate = document.getElementById('dash-inline-start')?.value || null;
    let endDate = document.getElementById('dash-inline-end')?.value || null;
    if (preset !== 'custom') {
        const resolved = resolvePeriodDates(preset);
        if (resolved) { startDate = resolved.startDate; endDate = resolved.endDate; }
    }
    return normalizeDashboardFilters({
        ...window.dashboardFilters,
        periodPreset: preset,
        startDate,
        endDate,
        clientId: document.getElementById('dash-inline-client')?.value || null,
        driverId: document.getElementById('dash-inline-driver')?.value || null,
        vehicleId: document.getElementById('dash-inline-vehicle')?.value || null,
        trailerId: document.getElementById('dash-inline-trailer')?.value || null,
        originCountry: document.getElementById('dash-inline-origin')?.value || null,
        destCountry: document.getElementById('dash-inline-dest')?.value || null,
        activity: document.getElementById('dash-inline-activity')?.value || null,
        region: document.getElementById('dash-inline-region')?.value?.trim() || null,
        assignmentType: document.getElementById('dash-inline-assignment')?.value || null,
        status: document.getElementById('dash-inline-status')?.value || null,
        cargoType: document.getElementById('dash-inline-cargo')?.value || null,
        missionRef: document.getElementById('dash-inline-mission-ref')?.value?.trim() || null,
        agencyId: document.getElementById('dash-inline-agency')?.value || null,
        invoicedOnly: !!document.getElementById('dash-inline-invoiced')?.checked,
        paidOnly: !!document.getElementById('dash-inline-paid')?.checked,
        cockpitMode: getDefaultCockpitMode(),
        metrics: []
    });
}

function scheduleDashboardFilterRefresh() {
    clearTimeout(window._dashFilterDebounce);
    window._dashFilterDebounce = setTimeout(() => refreshDashboardStatsOnly(), 400);
}

function initDashboardFilterAutoApply() {
    if (window._dashFilterListenersBound) return;
    const root = document.getElementById('dash-filters-wrap');
    if (!root) return;
    window._dashFilterListenersBound = true;

    root.addEventListener('change', (e) => {
        const t = e.target;
        if (t.id === 'dash-inline-preset') {
            const wrap = document.getElementById('dash-inline-dates-wrap');
            if (wrap) wrap.classList.toggle('dash-v2-filter-dates--hidden', t.value !== 'custom');
            if (t.value !== 'custom') {
                const resolved = resolvePeriodDates(t.value);
                if (resolved) {
                    const s = document.getElementById('dash-inline-start');
                    const en = document.getElementById('dash-inline-end');
                    if (s) s.value = resolved.startDate;
                    if (en) en.value = resolved.endDate;
                }
            }
        }
        if (t.id === 'dash-inline-saved-view' && t.value) loadDashboardSavedView(t.value);
        if (t.id !== 'dash-inline-saved-view') scheduleDashboardFilterRefresh();
    });
    root.addEventListener('input', (e) => {
        if (['dash-inline-region', 'dash-inline-mission-ref'].includes(e.target.id)) scheduleDashboardFilterRefresh();
    });
}

window.promptSaveDashboardView = async function () {
    const name = prompt('Nom de la vue enregistrée (ex. Mes KPI France, KPI Client Amazon) :');
    if (!name || !name.trim()) return;
    window.dashboardFilters = readDashboardInlineFilters();
    try {
        const res = await apiFetch('dashboard/saved-views', {
            method: 'POST',
            body: { name: name.trim(), filters: window.dashboardFilters }
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Erreur ${res.status}`);
        }
        await loadDashboardSavedViewsFromServer();
        showToast(`Vue « ${name.trim()} » enregistrée`, 'success');
        window._dashFilterListenersBound = false;
        await refreshDashboardView();
    } catch (err) {
        showToast(err.message || 'Impossible d\'enregistrer la vue', 'error');
    }
};

window.loadDashboardSavedView = async function (viewId) {
    const view = (window.dashboardSavedViews || []).find(v => String(v.id) === String(viewId));
    if (!view) return;
    window.dashboardFilters = normalizeDashboardFilters(view.filters);
    window.dashboardCustomView = true;
    window._dashFilterListenersBound = false;
    await refreshDashboardView();
};

window.deleteDashboardSavedView = async function () {
    const id = document.getElementById('dash-inline-saved-view')?.value;
    if (!id) {
        showToast('Sélectionnez une vue à supprimer', 'info');
        return;
    }
    const view = (window.dashboardSavedViews || []).find(v => String(v.id) === String(id));
    if (!confirm(`Supprimer la vue « ${view?.name || ''} » ?`)) return;
    try {
        const res = await apiFetch(`dashboard/saved-views/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Erreur ${res.status}`);
        }
        await loadDashboardSavedViewsFromServer();
        showToast('Vue supprimée', 'success');
        window._dashFilterListenersBound = false;
        await refreshDashboardView();
    } catch (err) {
        showToast(err.message || 'Impossible de supprimer la vue', 'error');
    }
};

async function refreshDashboardStatsOnly() {
    window.dashboardFilters = readDashboardInlineFilters();
    window.dashboardCustomView = true;
    const loadingEl = document.getElementById('dash-kpi-loading');
    if (loadingEl) loadingEl.classList.remove('hidden');

    try {
        const res = await apiFetch(`dashboard/stats${buildDashboardQueryString()}`);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Erreur ${res.status}`);
        }
        const stats = await res.json();
        const root = document.getElementById('dash-kpi-root');
        if (root) {
            destroyAllChartInstances();
            root.innerHTML = renderDashboardKpiBody(stats);
            initDashboardCharts(stats);
        } else {
            await refreshDashboardView();
        }
    } catch (err) {
        showToast(err.message || 'Impossible de mettre à jour les KPI', 'error');
    } finally {
        if (loadingEl) loadingEl.classList.add('hidden');
    }
}

window.refreshDashboardStatsOnly = refreshDashboardStatsOnly;
window.applyDashboardInlineFilters = refreshDashboardStatsOnly;

window.resetDashboardInlineFilters = async function () {
    window.dashboardFilters = getDefaultDashboardFilters();
    window.dashboardCustomView = false;
    window._dashFilterListenersBound = false;
    await refreshDashboardView();
};

function renderDashboardCostBars(categories = []) {
    if (!categories.length) return '<p class="text-gray-400 italic text-sm py-4 text-center">Aucune donnée de coûts</p>';
    return categories.map(c => `<div class="dash-v2-cost-bar">
        <div class="dash-v2-cost-bar-head"><span>${c.label}</span><span>${c.percent ?? 0} %</span></div>
        <div class="dash-v2-cost-bar-track"><div class="dash-v2-cost-bar-fill" style="width:${c.percent ?? 0}%"></div></div>
    </div>`).join('');
}

function renderDashboardMissionCounts(counts = {}) {
    const rows = [
        ['Livrées', counts.delivered ?? 0],
        ['En cours', counts.inProgress ?? 0],
        ['Retards', counts.late ?? 0],
        ['Annulées', counts.cancelled ?? 0]
    ];
    return rows.map(([label, val]) => `<div class="dash-v2-mission-count"><span>${label}</span><strong>${val}</strong></div>`).join('');
}

function renderDashboardKpiBody(stats = {}) {
    const cockpit = getDefaultCockpitMode();
    const revenue = stats.filteredTransportRevenue ?? stats.totalRevenue ?? 0;
    const trends = stats.kpiTrends || {};
    const perf = stats.missionPerformance || {};
    const counts = perf.counts || {};
    const today = stats.todayStats || {};
    const fleet = stats.fleetAvailability || { vehicles: {}, drivers: {} };
    const mapMissions = stats.activeMissionsMap || [];
    const costCats = stats.costCategories || [];
    const fillRate = stats.fillRate ?? stats.avgLoadFactor ?? 0;
    const alertCount = (stats.alerts || []).length;

    const mapDots = mapMissions.map((m, i) => {
        const pos = dashMapPosition(m.dest || m.origin, i);
        const cls = dashMapStatusClass(m.status);
        return `<div class="dash-v2-map-dot ${cls}" style="left:${pos.left};top:${pos.top}" title="${m.ref || ''} ${m.origin || ''} → ${m.dest || ''}"><i class="fa-solid fa-truck"></i></div>`;
    }).join('');

    const topDrivers = stats.topDrivers || [];
    const topVehicles = stats.topVehicles || [];
    const topClients = stats.topClients || [];
    const alerts = stats.alerts || [];

    let primaryRow = '';
    if (cockpit === 'comptabilite') {
        primaryRow = `
            ${dashV2Kpi('fa-file-invoice-dollar', '#2563eb', 'CA facturé', `${Number(stats.totalRevenue || revenue).toLocaleString('fr-FR')} €`, '', 'neutral')}
            ${dashV2Kpi('fa-hand-holding-dollar', '#dc2626', 'Encours clients', `${Number(stats.outstandingAmount || 0).toLocaleString('fr-FR')} €`, '', 'down')}
            ${dashV2Kpi('fa-clock', '#d97706', 'Factures en attente', stats.pendingInvoiceValidation ?? 0, '', 'neutral')}
            ${dashV2Kpi('fa-chart-line', '#059669', 'Marge brute', `${Number(stats.grossMargin || 0).toLocaleString('fr-FR')} €`, trends.margin ? `${trends.margin > 0 ? '+' : ''}${trends.margin}%` : '', 'up')}
            ${dashV2Kpi('fa-basket-shopping', '#7c3aed', 'Panier moyen', `${Number(stats.avgOrderValue || 0).toLocaleString('fr-FR')} €`, '', 'neutral')}`;
    } else if (cockpit === 'exploitant') {
        primaryRow = `
            ${dashV2Kpi('fa-truck-fast', '#2563eb', 'Missions en cours', counts.inProgress ?? 0, '', 'neutral')}
            ${dashV2Kpi('fa-triangle-exclamation', '#dc2626', 'Retards', counts.late ?? 0, '', counts.late > 0 ? 'down' : 'neutral')}
            ${dashV2Kpi('fa-truck', '#059669', 'Véhicules dispo', `${fleet.vehicles?.available ?? 0} / ${fleet.vehicles?.total ?? 0}`, '', 'up')}
            ${dashV2Kpi('fa-clipboard-check', '#7c3aed', 'Livrées', counts.delivered ?? 0, trends.missions || '', 'up')}
            ${dashV2Kpi('fa-bell', '#d97706', 'Incidents / alertes', alertCount, '', alertCount > 0 ? 'down' : 'neutral')}`;
    } else if (cockpit === 'flotte') {
        primaryRow = `
            ${dashV2Kpi('fa-road', '#ea580c', 'Km parcourus', `${Number(stats.totalKm || 0).toLocaleString('fr-FR')} km`, trends.km || '', 'up')}
            ${dashV2Kpi('fa-gas-pump', '#2563eb', 'Taux remplissage', `${fillRate} %`, '', 'up')}
            ${dashV2Kpi('fa-truck', '#059669', 'Disponibilité flotte', `${fleet.vehicles?.available ?? 0} / ${fleet.vehicles?.total ?? 0}`, '', 'up')}
            ${dashV2Kpi('fa-route', '#64748b', 'Km à vide', `${Number(stats.emptyKm || 0).toLocaleString('fr-FR')} km`, '', 'neutral')}
            ${dashV2Kpi('fa-wrench', '#d97706', 'Alertes maintenance', alertCount, '', alertCount > 0 ? 'down' : 'neutral')}`;
    } else {
        primaryRow = `
            ${dashV2Kpi('fa-euro-sign', '#2563eb', "Chiffre d'affaires", `${Number(revenue).toLocaleString('fr-FR')} €`, trends.revenue ? `${trends.revenue > 0 ? '+' : ''}${trends.revenue}%` : '', trends.revenue > 0 ? 'up' : 'neutral')}
            ${dashV2Kpi('fa-chart-line', '#059669', 'Marge brute', `${Number(stats.grossMargin || 0).toLocaleString('fr-FR')} €`, trends.margin ? `${trends.margin > 0 ? '+' : ''}${trends.margin}%` : '', 'up')}
            ${dashV2Kpi('fa-clipboard-check', '#7c3aed', 'Nb missions', stats.completedMissions ?? counts.delivered ?? 0, trends.missions || '', 'up')}
            ${dashV2Kpi('fa-road', '#ea580c', 'Km parcourus', `${Number(stats.totalKm || 0).toLocaleString('fr-FR')} km`, trends.km || '', 'up')}
            ${dashV2Kpi('fa-gauge-high', '#0891b2', 'CA / km', `${stats.revenuePerKm ?? 0} €/km`, trends.revenuePerKm || '', 'neutral')}`;
    }

    const secondaryRow = isCockpitSectionVisible('kpiSecondary') ? `
    <div class="dash-v2-kpi-grid dash-v2-kpi-grid--secondary">
        ${dashV2Kpi('fa-route', '#64748b', 'Km à vide', `${Number(stats.emptyKm || 0).toLocaleString('fr-FR')} km`, '', 'neutral')}
        ${dashV2Kpi('fa-boxes-stacked', '#8b5cf6', 'Taux de remplissage', `${fillRate} %`, '', 'up')}
        ${dashV2Kpi('fa-coins', '#d97706', 'Coût moyen / mission', `${Number(stats.avgCostPerMission || 0).toLocaleString('fr-FR')} €`, '', 'neutral')}
        ${dashV2Kpi('fa-basket-shopping', '#db2777', 'Panier moyen mission', `${Number(stats.avgOrderValue || 0).toLocaleString('fr-FR')} €`, trends.avgOrder || '', 'up')}
    </div>` : '';

    const financialSection = isCockpitSectionVisible('financial') ? `
    <h3 class="dash-v2-section-title">Performance financière</h3>
    <div class="dash-v2-mid-grid">
        <div class="dash-v2-card">
            <div class="flex justify-between items-center mb-2">
                <h4 class="dash-v2-card-title mb-0">Évolution CA</h4>
                <span class="text-xs text-gray-400">${new Date().getFullYear()}</span>
            </div>
            <div class="dash-v2-chart-h"><canvas id="dashRevChart"></canvas></div>
        </div>
        <div class="dash-v2-card">
            <h4 class="dash-v2-card-title">Répartition des coûts</h4>
            ${renderDashboardCostBars(costCats)}
            <div class="dash-v2-chart-h dash-v2-chart-h--sm mt-2"><canvas id="dashCostChart"></canvas></div>
        </div>
    </div>` : '';

    const exploitationSection = isCockpitSectionVisible('exploitation') ? `
    <h3 class="dash-v2-section-title">Performance exploitation</h3>
    <div class="dash-v2-exploit-grid">
        <div class="dash-v2-card">
            <h4 class="dash-v2-card-title">Missions réalisées</h4>
            ${renderDashboardMissionCounts(counts)}
        </div>
        <div class="dash-v2-card dash-v2-card--map">
            <h4 class="dash-v2-card-title">Carte opérationnelle</h4>
            <div class="dash-v2-map">
                <div class="dash-v2-map-fr"></div>
                ${mapDots || '<p class="dash-v2-map-empty">Aucune mission active sur la période</p>'}
                <div class="dash-v2-map-legend">
                    <span class="lg-available">🟢 Camions dispo (${fleet.vehicles?.available ?? 0})</span>
                    <span class="lg-progress">🔵 Missions en cours</span>
                    <span class="lg-wait">🟠 Chargements</span>
                    <span class="lg-late">🔴 Retards</span>
                </div>
            </div>
        </div>
        <div class="dash-v2-card">
            <h4 class="dash-v2-card-title">Taux de remplissage</h4>
            <div class="dash-v2-gauge-wrap">
                <canvas id="dashFillGauge"></canvas>
                <span class="dash-v2-gauge-value">${fillRate}%</span>
            </div>
        </div>
    </div>` : '';

    const lowerCards = [];
    if (isCockpitSectionVisible('drivers')) {
        lowerCards.push(`<div class="dash-v2-card">
            <h4 class="dash-v2-card-title">Conducteurs</h4>
            <table class="dash-v2-table">
                <thead><tr><th>Conducteur</th><th>Miss.</th><th>CA</th><th>Marge</th><th>Retards</th></tr></thead>
                <tbody>${topDrivers.length ? topDrivers.map(d => `<tr><td>${d.name}</td><td>${d.missions}</td><td>${Number(d.revenue).toLocaleString('fr-FR')} €</td><td>${Number(d.margin).toLocaleString('fr-FR')} €</td><td>${d.delays ?? 0}</td></tr>`).join('') : '<tr><td colspan="5" class="text-gray-400 italic py-4 text-center">Aucune donnée</td></tr>'}</tbody>
            </table>
        </div>`);
    }
    if (isCockpitSectionVisible('vehicles')) {
        lowerCards.push(`<div class="dash-v2-card">
            <h4 class="dash-v2-card-title">Véhicules</h4>
            <table class="dash-v2-table">
                <thead><tr><th>Camion</th><th>Km</th><th>Miss.</th><th>Conso</th><th>Dispo</th></tr></thead>
                <tbody>${topVehicles.length ? topVehicles.map(v => `<tr><td>${v.name}</td><td>${Number(v.km).toLocaleString('fr-FR')}</td><td>${v.missions}</td><td>${v.avgConsumption != null ? v.avgConsumption + ' L' : '—'}</td><td>${v.availability}%</td></tr>`).join('') : '<tr><td colspan="5" class="text-gray-400 italic py-4 text-center">Aucune donnée</td></tr>'}</tbody>
            </table>
        </div>`);
    }
    if (isCockpitSectionVisible('clients')) {
        lowerCards.push(`<div class="dash-v2-card">
            <h4 class="dash-v2-card-title">Top clients</h4>
            ${topClients.length ? topClients.map(c => `<div class="dash-v2-client-bar"><div class="dash-v2-client-bar-head"><span>${c.name}</span><span>${c.share}%</span></div><div class="dash-v2-client-bar-track"><div class="dash-v2-client-bar-fill" style="width:${c.share}%"></div></div></div>`).join('') : '<p class="text-gray-400 italic text-sm py-4 text-center">Aucune donnée</p>'}
        </div>`);
    }
    if (isCockpitSectionVisible('alerts')) {
        lowerCards.push(`<div class="dash-v2-card">
            <h4 class="dash-v2-card-title">Alertes</h4>
            ${alerts.length ? alerts.map(a => `<div class="dash-v2-alert ${a.type}"><i class="fa-solid ${a.icon}"></i><span>${a.text}</span></div>`).join('') : '<p class="text-gray-400 italic text-sm py-2">Aucune alerte</p>'}
        </div>`);
    }

    const lowerSection = lowerCards.length ? `<div class="dash-v2-lower-grid dash-v2-lower-grid--${lowerCards.length}">${lowerCards.join('')}</div>` : '';

    const footerSection = isCockpitSectionVisible('footer') ? `
    <div class="dash-v2-footer-bar">
        <span><i class="fa-solid fa-truck text-blue-500 mr-1"></i> Véhicules disponibles : <strong>${fleet.vehicles?.available ?? 0} / ${fleet.vehicles?.total ?? 0}</strong></span>
        <span><i class="fa-solid fa-user text-indigo-500 mr-1"></i> Conducteurs disponibles : <strong>${fleet.drivers?.available ?? 0} / ${fleet.drivers?.total ?? 0}</strong></span>
        <span><i class="fa-solid fa-clipboard-list text-purple-500 mr-1"></i> Missions aujourd'hui : <strong>${today.missions ?? 0}</strong></span>
        <span><i class="fa-solid fa-box text-teal-500 mr-1"></i> Livraisons aujourd'hui : <strong>${today.deliveries ?? 0}</strong></span>
        <span><i class="fa-solid fa-road text-orange-500 mr-1"></i> Km aujourd'hui : <strong>${Number(today.km || 0).toLocaleString('fr-FR')} km</strong></span>
        <span><i class="fa-solid fa-euro-sign text-green-600 mr-1"></i> CA aujourd'hui : <strong>${Number(today.revenue || 0).toLocaleString('fr-FR')} €</strong></span>
    </div>` : '';

    return `
    <div id="dash-kpi-loading" class="dash-v2-loading hidden"><i class="fa-solid fa-spinner fa-spin"></i> Mise à jour…</div>
    <div class="dash-v2-kpi-grid dash-v2-kpi-grid--primary">${primaryRow}</div>
    ${secondaryRow}
    ${financialSection}
    ${exploitationSection}
    ${lowerSection}
    ${footerSection}`;
}

function renderDashboardGeneralV2(stats = {}) {
    const expanded = !!window.dashboardFiltersExpanded;
    return `
    <div id="dash-filters-wrap" class="dash-v2-filters-wrap">
        ${renderDashboardFiltersBar()}
        <div id="dash-filters-panel" class="dash-v2-filters-panel ${expanded ? '' : 'dash-v2-filters-panel--hidden'}">
            ${renderDashboardFiltersBody()}
        </div>
    </div>
    <div id="dash-kpi-root">${renderDashboardKpiBody(stats)}</div>`;
}

// --- RENDER: Dashboard & transports ---
function renderDashboard(stats = {}) {
    let activeTab = window.activeDashboardTab || 'general';
    if (activeTab === 'pallets' && typeof planHasFeature === 'function' && !planHasFeature('pallets')) {
        window.activeDashboardTab = 'general';
        activeTab = 'general';
    }

    const f = window.dashboardFilters || getDefaultDashboardFilters();
    const periodLabel = `${f.startDate ? formatDisplayDate(f.startDate) : '…'} – ${f.endDate ? formatDisplayDate(f.endDate) : '…'}`;

    const palletsTabBtn = (typeof planHasFeature === 'function' && planHasFeature('pallets'))
        ? `<button onclick="window.switchDashboardTab('pallets')" class="px-6 py-2 ${activeTab === 'pallets' ? 'bg-gray-100 border-t-2 border-teal-500 font-bold text-teal-700' : 'text-gray-400 font-bold hover:bg-gray-50'} text-xs uppercase tracking-wider"><i class="fa-solid fa-pallet mr-1"></i> Palettes Europe</button>`
        : '';

    const tabsHtml = `
        <div class="flex gap-1 border-b border-gray-200 mb-4">
            <button onclick="window.switchDashboardTab('general')" class="px-6 py-2 ${activeTab === 'general' ? 'bg-gray-100 border-t-2 border-blue-500 font-bold text-blue-600' : 'text-gray-400 font-bold hover:bg-gray-50'} text-xs uppercase tracking-wider">Général</button>
            <button onclick="window.switchDashboardTab('quotations')" class="px-6 py-2 ${activeTab === 'quotations' ? 'bg-gray-100 border-t-2 border-blue-500 font-bold text-blue-600' : 'text-gray-400 font-bold hover:bg-gray-50'} text-xs uppercase tracking-wider">Cotations</button>
            <button onclick="window.switchDashboardTab('invoicing')" class="px-6 py-2 ${activeTab === 'invoicing' ? 'bg-gray-100 border-t-2 border-blue-500 font-bold text-blue-600' : 'text-gray-400 font-bold hover:bg-gray-50'} text-xs uppercase tracking-wider">Facturation</button>
            ${palletsTabBtn}
        </div>
    `;

    let tabContent = '';

    if (activeTab === 'general') {
        tabContent = renderDashboardGeneralV2(stats);
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
        const invoices = Array.isArray(db.sales_invoices) ? db.sales_invoices : [];
        const isDraft = (inv) => ['Brouillon', 'Draft', 'En attente'].includes(inv.status);
        const isOutstanding = (inv) => !['Payée', 'Paid', 'Annulée', 'Cancelled'].includes(inv.status);
        const isValidatedRevenue = (inv) => ['Validée', 'Validated', 'Payée', 'Paid'].includes(inv.status);

        const totalInvoiced = stats.totalRevenue != null
            ? Number(stats.totalRevenue) || 0
            : sumInvoiceAmounts(invoices, isValidatedRevenue);
        const pendingValidation = stats.pendingInvoiceValidation != null
            ? Number(stats.pendingInvoiceValidation) || 0
            : invoices.filter(isDraft).length;
        const outstanding = stats.outstandingAmount != null
            ? Number(stats.outstandingAmount) || 0
            : sumInvoiceAmounts(invoices, isOutstanding);

        tabContent = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-gray-700">${formatEuro(totalInvoiced)} €</h3>
                <p class="text-gray-400 text-sm">Montant total facturé</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-orange-600">${pendingValidation}</h3>
                <p class="text-gray-400 text-sm">Factures en attente validation</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                <h3 class="text-3xl font-bold text-red-600">${formatEuro(outstanding)} €</h3>
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
    <div class="fade-in dash-v2">
        <div class="flex flex-wrap justify-between items-start gap-3 mb-4">
            <div>
                <p class="dash-v2-subtitle">Vue d'ensemble de votre activité</p>
            </div>
            <div class="dash-v2-period"><i class="fa-regular fa-calendar mr-1"></i> Période ${periodLabel}</div>
        </div>
        ${tabsHtml}
        ${tabContent}
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
            const isSub = isOrderSubcontracted(m);
            const subName = m.subcontractor_name || (db.subcontractors.find(s => s.id === m.subcontractor_id) || {}).name;
            const driverName = m.driver_name || (db.drivers.find(d => d.id === m.driver_id) || {}).name;
            const dispatchBtn = canShowDispatchButton(m) ? `<button onclick="event.stopPropagation(); openDispatchModal(${m.id})" class="text-[10px] text-purple-600 hover:underline ml-1" title="Affréter"><i class="fa-solid fa-handshake"></i></button>` : '';
            const editBtn = canEditPlanningOrder(m)
                ? `<button onclick="event.stopPropagation(); openEditOrderModal(${m.id})" class="text-[10px] text-blue-600 hover:underline ml-1" title="Modifier l'affectation"><i class="fa-solid fa-pencil"></i> Modifier</button>`
                : '';
            return `<div class="bg-white p-3 rounded shadow-sm border border-gray-100 text-xs ${getStatusColor(m.status)} hover:shadow-md transition cursor-pointer relative group" onclick="openTransportDetail(${m.id})">
                                <div class="font-bold text-gray-800 mb-1">#${m.ref || m.id}${isSub ? ' <span class="text-purple-600 text-[10px]"><i class="fa-solid fa-handshake"></i></span>' : ''}</div>
                                <div class="text-gray-500 truncate text-[10px]">${m.origin} <i class="fa-solid fa-arrow-right mx-1"></i> ${m.dest}</div>
                                ${isSub && subName ? `<div class="text-[10px] text-purple-600 truncate"><i class="fa-solid fa-handshake mr-1"></i>${subName}</div>` : ''}
                                ${!isSub && driverName ? `<div class="text-[10px] text-blue-600 truncate"><i class="fa-solid fa-user mr-1"></i>${driverName}</div>` : ''}
                                <div class="mt-1 text-xs text-gray-400"><i class="fa-regular fa-clock mr-1"></i>${formatDisplayDate(m.delivery_date) || '--/--'}</div>
                                <div class="mt-2 flex justify-between items-center">
                                    <span class="bg-gray-100 px-1 rounded text-[10px]">${m.price}€</span>
                                    <span class="text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition flex items-center gap-1">${dispatchBtn}${editBtn}</span>
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

function isOrderSubcontracted(order) {
    if (!order) return false;
    return order.assignment_type === 'SUBCONTRACTED' || order.status === 'Affrété';
}

function canEditPlanningOrder(order) {
    if (!order) return false;
    if (typeof canWriteTransport === 'function' && !canWriteTransport()) return false;
    return !['Validé', 'Clôturé', 'Terminé', 'Annulé'].includes(order.status);
}

function canShowDispatchButton(order) {
    if (typeof planHasFeature === 'function' && !planHasFeature('affretement')) return false;
    if (!order || typeof canDispatchSubcontractor !== 'function' || !canDispatchSubcontractor()) return false;
    if (isOrderSubcontracted(order)) return false;
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
        <div id="affretement-quota-banner" class="hidden mb-4 p-3 rounded-lg text-sm border"></div>
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
            const agencyPart = data.agency?.code
                ? ` — Agence ${data.agency.code}${data.agency.name ? ` (${data.agency.name})` : ''}`
                : '';
            subtitle.textContent = `Commande ${data.orderRef} — ${data.subcontractor?.name || 'Sous-traitant'}${agencyPart}`;
        }
        if (preview) preview.innerHTML = data.html || '<p class="p-8 text-center text-gray-400">Aucun contenu</p>';
        if (emailInput) emailInput.value = data.subcontractor?.email || '';

        const quotaEl = document.getElementById('affretement-quota-banner');
        const quota = data.affretementQuota;
        if (quotaEl && quota) {
            if (quota.limit == null) {
                quotaEl.classList.add('hidden');
            } else {
                const atLimit = quota.remaining === 0;
                quotaEl.className = `mb-4 p-3 rounded-lg text-sm border ${atLimit ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-blue-50 border-blue-100 text-blue-900'}`;
                const overageNote = atLimit
                    ? `Quota mensuel atteint — prochains envois facturés <strong>${String(quota.unitPrice).replace('.', ',')} € HT</strong> chacun.`
                    : `<strong>${quota.remaining}</strong> confirmation(s) incluse(s) restante(s) sur ${quota.limit} ce mois (${quota.sendsThisMonth} utilisée(s)).`;
                quotaEl.innerHTML = `<i class="fa-solid fa-envelope-circle-check mr-1"></i> ${overageNote}`;
                quotaEl.classList.remove('hidden');
            }
        }

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
        showToast(payload.data?.message || 'Confirmation envoyée', payload.data?.usage?.billable ? 'info' : (payload.data?.simulated ? 'info' : 'success'));
        await loadAffretementConfirmationPage();
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        if (sendBtn) sendBtn.disabled = false;
    }
}

window.openAffretementConfirmation = openAffretementConfirmation;
window.sendAffretementConfirmation = sendAffretementConfirmation;

function renderSecureHtmlPreview(container, html, emptyMessage) {
    if (!container) return;
    container.replaceChildren();
    if (!html) {
        const empty = document.createElement('p');
        empty.className = 'p-8 text-center text-gray-400';
        empty.textContent = emptyMessage || 'Aucun contenu';
        container.appendChild(empty);
        return;
    }
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-same-origin');
    iframe.setAttribute('title', 'Aperçu document');
    iframe.className = 'w-full min-h-[800px] border-0';
    iframe.srcdoc = html;
    container.appendChild(iframe);
}

function renderCmrPreviewShell() {
    return `<div class="fade-in h-full flex flex-col">
        <div class="flex flex-wrap justify-between items-center gap-3 mb-4">
            <div>
                <button onclick="router('planning')" class="text-sm text-gray-600 hover:text-blue-600 mb-1"><i class="fa-solid fa-arrow-left mr-1"></i>Retour au planning</button>
                <h3 class="font-bold text-lg text-gray-800">Lettre de voiture internationale (CMR)</h3>
                <p class="text-xs text-gray-500" id="cmr-page-subtitle">Chargement…</p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <a id="cmr-pdf-link" href="#" target="_blank" class="hidden px-3 py-2 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50">
                    <i class="fa-solid fa-file-pdf mr-1 text-red-500"></i>Télécharger PDF
                </a>
                <button id="cmr-generate-btn" onclick="generateTransportCmr()" class="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
                    <i class="fa-solid fa-file-circle-plus mr-1"></i>Générer / Régénérer PDF
                </button>
            </div>
        </div>
        <div class="flex-1 overflow-auto bg-slate-100 rounded-xl border border-gray-200 p-4">
            <div id="cmr-preview" class="bg-white rounded-xl shadow-sm mx-auto max-w-5xl">
                <p class="p-8 text-center text-gray-400">Chargement de la lettre de voiture…</p>
            </div>
        </div>
    </div>`;
}

async function loadCmrPreviewPage() {
    const orderId = cmrPreviewOrderId;
    const preview = document.getElementById('cmr-preview');
    const subtitle = document.getElementById('cmr-page-subtitle');
    const pdfLink = document.getElementById('cmr-pdf-link');
    const generateBtn = document.getElementById('cmr-generate-btn');

    if (!orderId) {
        if (preview) preview.innerHTML = '<p class="p-8 text-center text-red-500">Aucun transport sélectionné.</p>';
        return;
    }

    try {
        const res = await apiFetch(`transport-orders/${orderId}/cmr`);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'CMR introuvable');
        }
        const { data } = await res.json();

        if (subtitle) {
            subtitle.textContent = `Transport ${data.orderRef}${data.hasSignatures ? ' — signatures présentes' : ''}`;
        }
        renderSecureHtmlPreview(preview, data.html, 'Aucun contenu');

        if (pdfLink && data.pdfUrl) {
            pdfLink.href = normalizeUploadUrl(data.pdfUrl);
            pdfLink.classList.remove('hidden');
        } else if (pdfLink) {
            pdfLink.classList.add('hidden');
        }

        if (generateBtn) generateBtn.disabled = false;
    } catch (e) {
        if (preview) preview.innerHTML = `<p class="p-8 text-center text-red-500">${e.message}</p>`;
        showToast(e.message, 'error');
    }
}

function openTransportCmr(orderId) {
    cmrPreviewOrderId = parseInt(orderId, 10);
    router('cmr_preview');
}

async function generateTransportCmr() {
    const orderId = cmrPreviewOrderId;
    if (!orderId) return;

    const generateBtn = document.getElementById('cmr-generate-btn');
    if (generateBtn) generateBtn.disabled = true;

    try {
        const res = await apiFetch(`transport-orders/${orderId}/cmr`, { method: 'POST' });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(payload.error || 'Génération impossible');
        }
        showToast('Lettre de voiture générée', 'success');
        await loadCmrPreviewPage();
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        if (generateBtn) generateBtn.disabled = false;
    }
}

window.openTransportCmr = openTransportCmr;
window.generateTransportCmr = generateTransportCmr;

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
                    <tr><th class="px-4 py-3">Chauffeur</th><th class="px-4 py-3">Contact</th><th class="px-4 py-3">Flotte</th><th class="px-4 py-3">Permis</th><th class="px-4 py-3">Mobile</th><th class="px-4 py-3">Statut</th><th class="px-4 py-3">Actions</th></tr>
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
        const fleetLabel = [d.default_vehicle_plate, d.default_trailer_plate].filter(Boolean).join(' + ')
            || '<span class="text-gray-400 text-xs">—</span>';
        return `<tr class="bg-white border-b hover:bg-gray-50">
                            <td class="px-4 py-3 font-medium text-gray-900 flex items-center gap-2">
                                <div class="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-500">
                                    ${d.name ? d.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : '?'}
                                </div>
                                ${d.name || 'N/A'}
                            </td>
                            <td class="px-4 py-3">${d.phone}</td>
                            <td class="px-4 py-3 text-xs font-mono text-gray-700">${fleetLabel}</td>
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
    const list = [...(db.vehicles || [])].sort((a, b) => {
        const typeOrder = (v) => ((v.vehicle_type || 'TRUCK') === 'TRAILER' ? 1 : 0);
        const byType = typeOrder(a) - typeOrder(b);
        if (byType !== 0) return byType;
        return String(a.plate || '').localeCompare(String(b.plate || ''), 'fr');
    });

    return `<div class="h-full flex flex-col fade-in">
        <div class="flex flex-wrap justify-between items-center gap-3 mb-4">
            <div class="flex items-center gap-3">
                <h3 class="font-bold text-lg text-gray-800">Gestion de la Flotte</h3>
                <span class="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">${list.length} véhicule${list.length > 1 ? 's' : ''}</span>
            </div>
            <button onclick="openAddVehicleModal()" class="bg-blue-600 text-white px-4 py-2 rounded text-sm shadow hover:bg-blue-700"><i class="fa-solid fa-plus mr-2"></i>Ajouter un véhicule</button>
        </div>
        <div class="flex-1 overflow-x-auto bg-white rounded-xl shadow-sm border border-gray-200">
            ${list.length ? `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
                ${list.map(v => {
        const statusColor = v.status === 'Disponible' ? 'border-green-500' : (v.status === 'Garage' ? 'border-red-500' : 'border-blue-500');
        const isTrailer = (v.vehicle_type || 'TRUCK') === 'TRAILER';
        const typeBadge = isTrailer ? 'Remorque' : 'Camion';
        return `<div onclick="openEditVehicleModal(${v.id})" class="border rounded-xl p-5 hover:shadow-md transition relative overflow-hidden cursor-pointer">
                        <div class="absolute top-0 left-0 w-full h-1 ${statusColor}"></div>
                        <div class="flex justify-between items-start mb-4">
                            <div><h4 class="font-bold text-gray-800">${v.plate}</h4><p class="text-xs text-gray-500">${v.model || typeBadge}</p></div>
                            <span class="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs font-bold uppercase">${v.status}</span>
                        </div>
                        <div class="space-y-3 text-sm">
                            <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-500">Chauffeur</span><span class="font-medium">${v.driver_name || '<span class="text-gray-400">Aucun</span>'}</span></div>
                            <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-500">Type</span><span class="font-medium">${typeBadge}</span></div>
                            <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-500">Maintenance</span><span class="font-medium">${formatDisplayDate(v.next_maintenance) || v.next_maintenance || '—'}</span></div>
                        </div>
                    </div>`;
    }).join('')}
            </div>` : `<p class="text-center text-gray-400 italic py-16">Aucun véhicule enregistré</p>`}
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
                    <tr><th class="px-4 py-3">N° Pièce</th><th class="px-4 py-3">Fournisseur</th><th class="px-4 py-3">Sous-traitant / Commande</th><th class="px-4 py-3">Agence</th><th class="px-4 py-3">Type</th><th class="px-4 py-3">Montant TTC</th><th class="px-4 py-3">Statut</th><th class="px-4 py-3">Doc</th></tr>
                </thead>
                <tbody>
                    ${invoices.length ? invoices.map(inv => {
        const isAutoAff = inv.type === 'Sous-traitance' && inv.order_id && String(inv.id).startsWith('ACH-AFF-');
        const agencyLabel = inv.agency_code
            ? `${inv.agency_code} — ${inv.agency_name || ''}`
            : (inv.agency_name || '—');
        return `<tr class="bg-white border-b hover:bg-gray-50">
                        <td class="px-4 py-3 font-medium text-gray-900">${inv.id}${isAutoAff ? '<br><span class="text-[10px] text-indigo-600 font-semibold">Auto affrètement</span>' : ''}</td>
                        <td class="px-4 py-3">${inv.supplier}</td>
                        <td class="px-4 py-3 text-xs">${inv.subcontractor_name || '-'}${inv.order_ref ? `<br><span class="text-gray-400">Cmd. ${inv.order_ref}</span>` : ''}</td>
                        <td class="px-4 py-3 text-xs text-gray-600">${agencyLabel}</td>
                        <td class="px-4 py-3">${inv.type}</td>
                        <td class="px-4 py-3 font-bold text-gray-700">-${Number(inv.amount || 0).toLocaleString()} €</td>
                        <td class="px-4 py-3"><span class="${inv.status === 'Payée' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'} px-2 py-1 rounded text-xs font-semibold">${inv.status}</span></td>
                        <td class="px-4 py-3">${inv.file ? `<a href="${normalizeUploadUrl(inv.file)}" target="_blank" class="text-blue-600 hover:underline text-xs"><i class="fa-solid fa-file-pdf"></i></a>` : '-'}</td>
                    </tr>`;
    }).join('') : '<tr><td colspan="8" class="px-4 py-10 text-center text-gray-400 italic">Aucune facture d\'achat</td></tr>'}
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

function isValidatedForPaSubmission(inv) {
    if (!inv || isCreditNoteType(inv)) return false;
    const status = (inv.status || '').toString().trim().toLowerCase();
    return status.includes('valid') || status === 'validated' || status === 'validée' || status === 'validee';
}

function canSubmitToPA(inv) {
    if (!canManageInvoices() || !inv || isCreditNoteType(inv)) return false;
    if (inv.iopole_invoice_id) return false;
    return isValidatedForPaSubmission(inv);
}

const EINVOICE_STATUS_LABELS = {
    SUBMITTED: 'Transmise à la PA',
    IN_HAND: 'En traitement PA',
    APPROVED: 'Acceptée par le destinataire',
    PARTIALLY_APPROVED: 'Partiellement acceptée',
    DISPUTED: 'En litige',
    SUSPENDED: 'Suspendue',
    COMPLETED: 'Traitement terminé',
    REFUSED: 'Refusée par le destinataire',
    PAYMENT_SENT: 'Paiement envoyé',
    PAYMENT_RECEIVED: 'Paiement reçu'
};

function formatEinvoiceStatusLabel(code) {
    if (!code) return 'Non transmise';
    return EINVOICE_STATUS_LABELS[code] || String(code).replace(/_/g, ' ').toLowerCase();
}

function getPaStatusBadgeClass(code) {
    if (!code || code === 'SUBMITTED') return 'bg-sky-100 text-sky-800';
    if (['APPROVED', 'COMPLETED', 'PAYMENT_RECEIVED'].includes(code)) return 'bg-green-100 text-green-800';
    if (['REFUSED', 'DISPUTED'].includes(code)) return 'bg-red-100 text-red-800';
    if (['IN_HAND', 'SUSPENDED', 'PARTIALLY_APPROVED'].includes(code)) return 'bg-orange-100 text-orange-800';
    return 'bg-emerald-100 text-emerald-800';
}

function renderPaStatusBadge(inv) {
    if (isCreditNoteType(inv)) return '<span class="text-gray-300">—</span>';
    if (inv.iopole_invoice_id) {
        const code = inv.einvoice_status || 'SUBMITTED';
        return `<span class="px-2 py-0.5 rounded text-xs font-semibold ${getPaStatusBadgeClass(code)}" title="ID PA: ${inv.iopole_invoice_id}">${formatEinvoiceStatusLabel(code)}</span>`;
    }
    if (isValidatedForPaSubmission(inv)) {
        return '<span class="px-2 py-0.5 rounded text-xs font-semibold bg-gray-100 text-gray-600">Non transmise</span>';
    }
    return '<span class="text-gray-300">—</span>';
}

let currentInvoiceModalId = null;

window.submitEinvoiceToPA = async function (invoiceId) {
    const id = invoiceId || currentInvoiceModalId;
    if (!id) return showToast('Facture introuvable', 'error');
    if (!canManageInvoices()) return showToast('Action non autorisée', 'error');

    const inv = db.sales_invoices.find(i => String(i.id) === String(id));
    if (!canSubmitToPA(inv)) {
        return showToast('Seules les factures validées non encore transmises peuvent être envoyées à la PA', 'error');
    }
    if (!confirm('Transmettre cette facture à la Plateforme Agréée Iopole (Factur-X) ?')) return;

    const submitBtn = document.getElementById('submit-einvoice-btn');
    const headerBtn = document.getElementById('submit-einvoice-header-btn');
    if (submitBtn) submitBtn.disabled = true;
    if (headerBtn) headerBtn.disabled = true;

    showToast('Transmission à la PA en cours…', 'info');
    try {
        const res = await apiFetch(`sales-invoices/${id}/submit-einvoice`, { method: 'POST' });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            showToast(payload.error || payload.message || 'Échec de la transmission à la PA', 'error');
            return;
        }
        showToast('Facture transmise à la Plateforme Agréée', 'success');
        await fetchAllData();
        openInvoiceModal(id);
    } catch (e) {
        console.error(e);
        showToast('Erreur de communication avec le serveur', 'error');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (headerBtn) headerBtn.disabled = false;
    }
};

function updateInvoiceModalPaUi(inv) {
    currentInvoiceModalId = inv?.id || null;
    const actionBar = document.getElementById('einvoice-action-bar');
    const statusLabel = document.getElementById('modal-einvoice-status-label');
    const submittedAtEl = document.getElementById('modal-einvoice-submitted-at');
    const submitBtn = document.getElementById('submit-einvoice-btn');
    const headerBtn = document.getElementById('submit-einvoice-header-btn');
    const showPa = inv && !isCreditNoteType(inv);

    if (actionBar) actionBar.classList.toggle('hidden', !showPa);

    if (!showPa) {
        if (submitBtn) submitBtn.classList.add('hidden');
        if (headerBtn) headerBtn.classList.add('hidden');
        return;
    }

    const submitted = Boolean(inv.iopole_invoice_id);
    const canSubmit = canSubmitToPA(inv);
    const statusText = submitted
        ? formatEinvoiceStatusLabel(inv.einvoice_status || 'SUBMITTED')
        : (isValidatedForPaSubmission(inv) ? 'Prête pour transmission PA' : 'Validez la facture avant transmission');

    if (statusLabel) statusLabel.textContent = statusText;
    if (submittedAtEl) {
        if (inv.einvoice_submitted_at) {
            submittedAtEl.textContent = `Transmise le ${formatDisplayDate(inv.einvoice_submitted_at)}`;
            submittedAtEl.classList.remove('hidden');
        } else {
            submittedAtEl.classList.add('hidden');
            submittedAtEl.textContent = '';
        }
    }

    if (submitBtn) {
        submitBtn.classList.toggle('hidden', !canSubmit);
        submitBtn.disabled = !canSubmit;
    }
    if (headerBtn) {
        headerBtn.classList.toggle('hidden', !canSubmit);
        headerBtn.onclick = () => submitEinvoiceToPA(inv.id);
    }
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
                        <th class="px-4 py-3">PA</th>
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
                            <td class="px-4 py-3">${renderPaStatusBadge(inv)}</td>
                            <td class="px-4 py-3 whitespace-nowrap">
                                <button onclick="openInvoiceModal('${inv.id}')" class="text-blue-600 hover:underline mr-2">Voir</button>
                                ${canSubmitToPA(inv) ? `<button onclick="submitEinvoiceToPA('${inv.id}')" class="text-emerald-600 hover:underline mr-2" title="Transmettre à la PA Iopole"><i class="fa-solid fa-paper-plane mr-1"></i>PA</button>` : ''}
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

    updateInvoiceModalPaUi(inv);

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
                                     onerror="this.src='assets/flenova_icon_512.jpg'">
                                <p class="text-xs text-gray-500">Modifiable dans <button type="button" onclick="router('admin')" class="text-blue-600 hover:underline font-medium">Paramètres entreprise</button>.</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="space-y-4">
                    <h3 class="flex items-center font-bold text-emerald-700 uppercase text-xs tracking-wider">
                        <i class="fa-solid fa-building-shield mr-2"></i> Plateforme Agréée — Iopole
                    </h3>
                    <div id="iopole-config-panel" class="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-gray-700">
                        <p class="text-gray-500"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Vérification de la connexion PA…</p>
                    </div>
                    <p class="text-xs text-gray-500 leading-relaxed">
                        Les identifiants OAuth (<code class="text-[11px] bg-gray-100 px-1 rounded">IOPOLE_CLIENT_ID</code>,
                        <code class="text-[11px] bg-gray-100 px-1 rounded">IOPOLE_CLIENT_SECRET</code>) et l'identifiant client
                        (<code class="text-[11px] bg-gray-100 px-1 rounded">IOPOLE_CUSTOMER_ID</code>, header <strong>customer-id</strong>)
                        se configurent dans <code class="text-[11px] bg-gray-100 px-1 rounded">Backend/.env</code> sur le serveur.
                    </p>
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

window.refreshIopoleConfigPanel = async function () {
    const panel = document.getElementById('iopole-config-panel');
    if (!panel) return;

    try {
        const res = await apiFetch('e-invoicing/status');
        const payload = await res.json().catch(() => ({}));
        const data = payload.data || {};

        if (!data.configured) {
            panel.innerHTML = `
                <div class="flex items-start gap-3">
                    <span class="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-700"><i class="fa-solid fa-triangle-exclamation"></i></span>
                    <div>
                        <p class="font-semibold text-amber-900">Configuration incomplète</p>
                        <p class="mt-1 text-sm text-amber-800">${data.message || 'Complétez Backend/.env (credentials + Customer ID).'}</p>
                        <ul class="mt-2 text-xs text-amber-900/80 list-disc pl-4 space-y-1">
                            <li>Credentials OAuth : ${data.credentialsConfigured ? '✓' : '✗ manquant'}</li>
                            <li>Identifiant client (Customer ID) : ${data.customerIdConfigured ? '✓' : '✗ manquant'}</li>
                        </ul>
                    </div>
                </div>`;
            return;
        }

        if (!data.connected) {
            panel.innerHTML = `
                <div class="flex items-start gap-3">
                    <span class="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-red-700"><i class="fa-solid fa-plug-circle-xmark"></i></span>
                    <div>
                        <p class="font-semibold text-red-900">Connexion PA échouée</p>
                        <p class="mt-1 text-sm text-red-800">${data.message || 'Vérifiez les credentials dans Backend/.env'}</p>
                        ${data.customerId ? `<p class="mt-2 text-xs font-mono text-red-900/80">Customer ID : ${data.customerId}</p>` : ''}
                    </div>
                </div>`;
            return;
        }

        panel.innerHTML = `
            <div class="flex items-start gap-3">
                <span class="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><i class="fa-solid fa-circle-check"></i></span>
                <div class="min-w-0 flex-1">
                    <p class="font-semibold text-emerald-900">Connexion PA active</p>
                    <dl class="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                        <div><dt class="text-gray-500 uppercase tracking-wide">Identifiant client</dt><dd class="mt-0.5 font-mono text-emerald-950 break-all">${data.customerId || '—'}</dd></div>
                        <div><dt class="text-gray-500 uppercase tracking-wide">Mode</dt><dd class="mt-0.5 font-semibold uppercase text-emerald-900">${(data.mode || 'push').toUpperCase()}</dd></div>
                        <div class="sm:col-span-2"><dt class="text-gray-500 uppercase tracking-wide">API</dt><dd class="mt-0.5 font-mono text-emerald-950 break-all">${data.apiUrl || '—'}</dd></div>
                    </dl>
                </div>
            </div>`;
    } catch (e) {
        panel.innerHTML = `<p class="text-red-700"><i class="fa-solid fa-circle-xmark mr-2"></i>Impossible de lire la configuration PA (${e.message || 'erreur réseau'}).</p>`;
    }
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
            const result = await response.json();
            window.cachedBankSettings = result.data || null;
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
                <p class="text-[9px] text-gray-400 uppercase tracking-widest">Aperçu généré par Flenova TMS - Ce document n'a pas de valeur légale tant qu'il n'est pas validé.</p>
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
    if (!logoPath) return 'assets/flenova_icon_512.jpg';
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
function formatBankSettingsDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function renderAdmin(bankSettings = null) {
    const isAdminUser = typeof canManageUsers === 'function' && canManageUsers();
    const emailEnabled = currentUser?.company_notifications === 1;
    const logoSrc = resolveCompanyLogoUrl(currentUser?.company_logo);
    const bank = bankSettings || window.cachedBankSettings || null;
    const bankUpdatedLabel = bank?.updated_at ? formatBankSettingsDate(bank.updated_at) : '';

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

            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 class="font-bold text-gray-700 mb-4 uppercase text-xs tracking-wider">Agences / Dépôts</h3>
                <p class="text-xs text-gray-500 mb-4">Multi-agences : chaque exploitant ne voit que les transports de son agence. L'administrateur voit tout.</p>
                <table class="w-full text-sm text-left mb-4">
                    <thead class="border-b"><tr><th class="pb-2">Code</th><th class="pb-2">Nom</th><th class="pb-2">Adresse</th></tr></thead>
                    <tbody>
                        ${(db.agencies || []).map(a => `<tr class="border-b last:border-0">
                            <td class="py-2 font-mono text-xs">${a.code}</td>
                            <td class="py-2">${a.name}</td>
                            <td class="py-2 text-gray-500">${[a.address, a.city].filter(Boolean).join(', ') || '—'}</td>
                        </tr>`).join('') || '<tr><td colspan="3" class="py-4 text-gray-400 italic">Aucune agence</td></tr>'}
                    </tbody>
                </table>
                ${isAdminUser ? `<form onsubmit="event.preventDefault(); createAgencyFromAdmin(); return false;" class="grid grid-cols-2 gap-2">
                    <input type="text" id="admin-agency-code" class="border rounded p-2 text-sm uppercase" placeholder="Code" required>
                    <input type="text" id="admin-agency-name" class="border rounded p-2 text-sm" placeholder="Nom agence" required>
                    <input type="text" id="admin-agency-city" class="border rounded p-2 text-sm" placeholder="Ville">
                    <input type="text" id="admin-agency-address" class="border rounded p-2 text-sm" placeholder="Adresse">
                    <button type="submit" class="col-span-2 py-2 bg-teal-600 text-white rounded text-sm font-bold hover:bg-teal-700">+ Créer une agence</button>
                </form>` : '<p class="text-xs text-gray-400">Seul un administrateur peut gérer les agences.</p>'}
            </div>

            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-6">
                <div>
                    <h3 class="font-bold text-gray-700 mb-4 uppercase text-xs tracking-wider">Identité Légale de la Compagnie</h3>
                    <form onsubmit="event.preventDefault(); updateCompanyInfo(); return false;" class="space-y-4">
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
                        <button type="submit" class="w-full py-2 bg-blue-600 text-white rounded text-sm font-bold hover:bg-blue-700 transition shadow-sm">
                            <i class="fa-solid fa-save mr-2"></i>Sauvegarder les informations
                        </button>
                    </form>
                </div>

                <div class="pt-6 border-t">
                    <h3 class="font-bold text-gray-700 mb-4 uppercase text-xs tracking-wider">Coordonnées bancaires</h3>
                    <p class="text-xs text-gray-500 mb-4">Ces informations apparaissent sur vos factures clients et documents de paiement.</p>
                    <form onsubmit="event.preventDefault(); saveAdminBankSettings(); return false;" class="space-y-4">
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">Mode de règlement</label>
                            <input type="text" id="admin-bank-method" class="w-full border p-2 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" value="${escapeHtml(bank?.method || 'Virement Bancaire')}" placeholder="Virement Bancaire">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">IBAN</label>
                            <input type="text" id="admin-bank-iban" class="w-full border p-2 rounded text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none" value="${escapeHtml(bank?.iban || '')}" placeholder="FR76 3000 6000 0001 2345 6789 X01">
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">Code BIC / SWIFT</label>
                                <input type="text" id="admin-bank-bic" class="w-full border p-2 rounded text-sm font-mono uppercase focus:ring-2 focus:ring-blue-500 outline-none" value="${escapeHtml(bank?.bic || '')}" placeholder="BNPAFRPP">
                            </div>
                            <div>
                                <label class="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nom de la banque</label>
                                <input type="text" id="admin-bank-name" class="w-full border p-2 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" value="${escapeHtml(bank?.bank_name || '')}" placeholder="BNP PARIBAS">
                            </div>
                        </div>
                        ${bankUpdatedLabel ? `<p class="text-[10px] text-gray-400">Dernière mise à jour : ${escapeHtml(bankUpdatedLabel)}</p>` : ''}
                        <button type="submit" class="w-full py-2 bg-blue-600 text-white rounded text-sm font-bold hover:bg-blue-700 transition shadow-sm">
                            <i class="fa-solid fa-building-columns mr-2"></i>Sauvegarder les coordonnées bancaires
                        </button>
                    </form>
                </div>

                <div class="pt-6 border-t">
                    <h3 class="font-bold text-gray-700 mb-4 uppercase text-xs tracking-wider">Logo de l'entreprise</h3>
                    <p class="text-xs text-gray-500 mb-4">Ce logo apparaît sur vos factures clients, brouillons et documents PDF.</p>
                    <div class="flex flex-col sm:flex-row items-start gap-4">
                        <div class="w-28 h-28 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center bg-gray-50 overflow-hidden shrink-0">
                            <img id="admin-company-logo-preview" src="${logoSrc}" alt="Logo entreprise"
                                 class="max-w-full max-h-full object-contain p-2"
                                 onerror="this.src='assets/flenova_icon_512.jpg'">
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
            if (typeof updateAppCompanyHeader === 'function') updateAppCompanyHeader(currentUser);
            const appContent = document.getElementById('app-content');
            if (appContent && window.currentAppRoute === 'admin') {
                appContent.innerHTML = renderAdmin(window.cachedBankSettings);
            }
            showToast("Informations de la compagnie enregistrées", "success");
        } else {
            const errorData = await response.json().catch(() => ({}));
            showToast(errorData.error || "Échec de la sauvegarde", "error");
        }
    } catch (err) {
        showToast("Erreur de communication avec le serveur", "error");
    }
};

window.saveAdminBankSettings = async function () {
    const payload = {
        method: document.getElementById('admin-bank-method')?.value?.trim() || 'Virement Bancaire',
        iban: document.getElementById('admin-bank-iban')?.value?.trim() || '',
        bic: document.getElementById('admin-bank-bic')?.value?.trim() || '',
        bank_name: document.getElementById('admin-bank-name')?.value?.trim() || ''
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
            const result = await response.json();
            window.cachedBankSettings = result.data || null;
            if (currentUser) {
                currentUser.company_iban = window.cachedBankSettings?.iban || null;
                currentUser.company_bank = window.cachedBankSettings?.bank_name || null;
                currentUser.company_bic = window.cachedBankSettings?.bic || null;
                currentUser.company_payment_method = window.cachedBankSettings?.method || null;
                setCurrentUser(currentUser);
            }
            const appContent = document.getElementById('app-content');
            if (appContent && window.currentAppRoute === 'admin') {
                appContent.innerHTML = renderAdmin(window.cachedBankSettings);
            }
            showToast('Coordonnées bancaires enregistrées', 'success');
        } else {
            const errorData = await response.json().catch(() => ({}));
            showToast(errorData.error || 'Échec de la sauvegarde bancaire', 'error');
        }
    } catch (err) {
        showToast('Erreur de communication avec le serveur', 'error');
    }
};

window.createAgencyFromAdmin = async function () {
    const code = document.getElementById('admin-agency-code')?.value?.trim();
    const name = document.getElementById('admin-agency-name')?.value?.trim();
    const city = document.getElementById('admin-agency-city')?.value?.trim();
    const address = document.getElementById('admin-agency-address')?.value?.trim();
    if (!code || !name) {
        showToast('Code et nom requis', 'error');
        return;
    }
    try {
        const res = await apiFetch('agencies', { method: 'POST', body: { code, name, city, address } });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Création impossible');
        }
        await fetchAllData();
        router('admin');
        showToast('Agence créée', 'success');
    } catch (e) {
        showToast(e.message || 'Erreur', 'error');
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
            const appContent = document.getElementById('app-content');
            if (appContent && window.currentAppRoute === 'admin') {
                appContent.innerHTML = renderAdmin(window.cachedBankSettings);
            }
        }
    } catch (err) {
        showToast("Erreur lors de la modification des notifications", "error");
    }
};

// --- RENDER: Durabilité & RSE ---
let sustainabilityStatsCache = null;
let csrdReportsCache = [];

function formatCo2Kg(val) {
    const n = Number(val) || 0;
    return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function renderSustainability(stats = null) {
    const s = stats?.summary || sustainabilityStatsCache?.summary || {};
    const recent = stats?.recent || sustainabilityStatsCache?.recent || [];
    const topClients = stats?.topClients || sustainabilityStatsCache?.topClients || [];
    const canGreen = typeof planHasFeature === 'function' && planHasFeature('green_optimization');

    return `<div class="space-y-6 fade-in">
        <div class="flex flex-wrap justify-between items-start gap-4">
            <div>
                <h2 class="text-2xl font-bold text-gray-800"><i class="fa-solid fa-leaf text-green-600 mr-2"></i>Durabilité</h2>
                <p class="text-sm text-gray-500 mt-1">Calcul carbone GLEC Framework 2.0 — Scope 3 par expédition, avec consommation réelle et taux de remplissage.</p>
            </div>
            <button type="button" onclick="recalculateAllCarbon()" class="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700">
                <i class="fa-solid fa-rotate mr-1"></i>Recalculer tous les transports
            </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div class="bg-white p-5 rounded-xl border border-green-100 shadow-sm">
                <p class="text-xs uppercase text-gray-400 font-semibold">CO2e total</p>
                <p class="text-3xl font-bold text-green-700 mt-1">${formatCo2Kg(s.totalCo2Kg)} <span class="text-sm font-normal">kg</span></p>
            </div>
            <div class="bg-white p-5 rounded-xl border shadow-sm">
                <p class="text-xs uppercase text-gray-400 font-semibold">Scope 1 (flotte)</p>
                <p class="text-2xl font-bold text-gray-800 mt-1">${formatCo2Kg(s.scope1Kg)} kg</p>
            </div>
            <div class="bg-white p-5 rounded-xl border shadow-sm">
                <p class="text-xs uppercase text-gray-400 font-semibold">Scope 3 (affrètement)</p>
                <p class="text-2xl font-bold text-purple-700 mt-1">${formatCo2Kg(s.scope3Kg)} kg</p>
            </div>
            <div class="bg-white p-5 rounded-xl border shadow-sm">
                <p class="text-xs uppercase text-gray-400 font-semibold">Taux remplissage moy.</p>
                <p class="text-2xl font-bold text-blue-700 mt-1">${s.avgLoadFactor ? Math.round(Number(s.avgLoadFactor) * 100) : 0}%</p>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div class="bg-white p-6 rounded-xl border shadow-sm">
                <h3 class="font-bold text-gray-800 mb-4">Émissions par client (Scope 3)</h3>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead class="text-xs uppercase text-gray-500 border-b"><tr><th class="py-2 text-left">Client</th><th class="py-2 text-right">Expéd.</th><th class="py-2 text-right">CO2e kg</th></tr></thead>
                        <tbody>
                            ${topClients.length ? topClients.map(c => `<tr class="border-b"><td class="py-2">${c.client_name || '—'}</td><td class="py-2 text-right">${c.shipments}</td><td class="py-2 text-right font-semibold text-green-700">${formatCo2Kg(c.co2_kg)}</td></tr>`).join('') : '<tr><td colspan="3" class="py-6 text-center text-gray-400 italic">Aucune donnée — recalculez les transports</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="bg-white p-6 rounded-xl border shadow-sm">
                <h3 class="font-bold text-gray-800 mb-2">Optimisation « Green »</h3>
                <p class="text-xs text-gray-500 mb-4">Arbitrage coût / délai / impact carbone — 3 scénarios comparés (GLEC).</p>
                ${canGreen ? `
                <div class="space-y-3">
                    <input type="text" id="green-origin" placeholder="Origine" class="w-full border rounded px-3 py-2 text-sm">
                    <input type="text" id="green-dest" placeholder="Destination" class="w-full border rounded px-3 py-2 text-sm">
                    <div class="grid grid-cols-2 gap-3">
                        <input type="number" id="green-weight" placeholder="Poids kg" value="5000" class="border rounded px-3 py-2 text-sm">
                        <input type="number" id="green-price" placeholder="Prix €" value="850" class="border rounded px-3 py-2 text-sm">
                    </div>
                    <div class="grid grid-cols-3 gap-2 text-xs">
                        <label>Poids coût <input type="range" id="green-w-cost" min="0" max="100" value="40" class="w-full" oninput="document.getElementById('green-w-cost-val').textContent=this.value+'%'"><span id="green-w-cost-val">40%</span></label>
                        <label>Poids délai <input type="range" id="green-w-time" min="0" max="100" value="30" class="w-full" oninput="document.getElementById('green-w-time-val').textContent=this.value+'%'"><span id="green-w-time-val">30%</span></label>
                        <label>Poids carbone <input type="range" id="green-w-carbon" min="0" max="100" value="30" class="w-full" oninput="document.getElementById('green-w-carbon-val').textContent=this.value+'%'"><span id="green-w-carbon-val">30%</span></label>
                    </div>
                    <button type="button" onclick="runGreenOptimization()" class="w-full bg-emerald-600 text-white py-2 rounded-lg text-sm hover:bg-emerald-700">Comparer les scénarios</button>
                </div>
                <div id="green-scenarios-result" class="mt-4 space-y-2"></div>
                ` : `<p class="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-3">Disponible à partir du forfait PME — arbitrage coût / délai / carbone.</p>`}
            </div>
        </div>

        <div class="bg-white p-6 rounded-xl border shadow-sm">
            <h3 class="font-bold text-gray-800 mb-4">Dernières expéditions — empreinte carbone</h3>
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left">
                    <thead class="text-xs uppercase text-gray-500 border-b bg-gray-50">
                        <tr>
                            <th class="px-3 py-2">Réf.</th><th class="px-3 py-2">Client</th><th class="px-3 py-2">Trajet</th>
                            <th class="px-3 py-2 text-right">Dist. km</th><th class="px-3 py-2 text-right">Rempliss.</th>
                            <th class="px-3 py-2 text-right">CO2e kg</th><th class="px-3 py-2">Scope</th><th class="px-3 py-2">Méthode</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${recent.length ? recent.map(r => `
                            <tr class="border-b hover:bg-gray-50">
                                <td class="px-3 py-2 font-medium">${r.ref || r.id}</td>
                                <td class="px-3 py-2">${r.client_name || '—'}</td>
                                <td class="px-3 py-2 text-xs">${r.origin || '—'} → ${r.dest || '—'}</td>
                                <td class="px-3 py-2 text-right">${r.distance_km != null ? Number(r.distance_km).toFixed(0) : '—'}</td>
                                <td class="px-3 py-2 text-right">${r.load_factor != null ? Math.round(Number(r.load_factor) * 100) + '%' : '—'}</td>
                                <td class="px-3 py-2 text-right font-semibold text-green-700">${r.co2_kg != null ? formatCo2Kg(r.co2_kg) : '—'}</td>
                                <td class="px-3 py-2 text-xs">${r.co2_scope || '—'}</td>
                                <td class="px-3 py-2 text-xs text-gray-500">${r.co2_method || '—'}</td>
                            </tr>`).join('') : '<tr><td colspan="8" class="px-3 py-8 text-center text-gray-400 italic">Aucun calcul carbone — créez des transports ou lancez un recalcul</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    </div>`;
}

function renderRseCompliance(reports = csrdReportsCache) {
    const canCsrd = typeof planHasFeature === 'function' && planHasFeature('csrd_reporting');
    const year = new Date().getFullYear();

    return `<div class="space-y-6 fade-in">
        <div>
            <h2 class="text-2xl font-bold text-gray-800"><i class="fa-solid fa-scale-balanced text-indigo-600 mr-2"></i>Conformité RSE</h2>
            <p class="text-sm text-gray-500 mt-1">Reporting automatisé CSRD / ESRS E1 pour chargeurs et transporteurs — généré depuis vos expéditions Flenova.</p>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div class="lg:col-span-2 bg-white p-6 rounded-xl border shadow-sm">
                <h3 class="font-bold text-gray-800 mb-3">Générer un rapport CSRD</h3>
                <p class="text-sm text-gray-600 mb-4">Export CSV structuré : synthèse Scope 1 &amp; 3, détail par client et par expédition, note méthodologique GLEC 2.0.</p>
                ${canCsrd ? `
                <div class="flex flex-wrap gap-3 items-end">
                    <div><label class="block text-xs text-gray-500 mb-1">Début</label><input type="date" id="csrd-start" value="${year}-01-01" class="border rounded px-3 py-2 text-sm"></div>
                    <div><label class="block text-xs text-gray-500 mb-1">Fin</label><input type="date" id="csrd-end" value="${year}-12-31" class="border rounded px-3 py-2 text-sm"></div>
                    <button type="button" onclick="generateCsrdReport()" class="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700"><i class="fa-solid fa-file-export mr-1"></i>Générer le rapport</button>
                </div>
                ` : `<p class="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-3">Rapports CSRD disponibles à partir du forfait PME.</p>`}
            </div>
            <div class="bg-indigo-50 border border-indigo-100 p-6 rounded-xl">
                <h4 class="font-bold text-indigo-900 text-sm mb-2">Contenu ESRS E1</h4>
                <ul class="text-xs text-indigo-800 space-y-2 list-disc pl-4">
                    <li>Émissions totales CO2e (kg)</li>
                    <li>Scope 3 — transport amont (Cat. 4)</li>
                    <li>Taux de remplissage &amp; tonnes-km</li>
                    <li>Détail auditable par expédition</li>
                </ul>
            </div>
        </div>

        <div class="bg-white p-6 rounded-xl border shadow-sm">
            <h3 class="font-bold text-gray-800 mb-4">Historique des rapports</h3>
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead class="text-xs uppercase text-gray-500 border-b bg-gray-50">
                        <tr><th class="px-3 py-2 text-left">Période</th><th class="px-3 py-2 text-right">CO2e kg</th><th class="px-3 py-2 text-right">Scope 3</th><th class="px-3 py-2 text-right">Expéd.</th><th class="px-3 py-2">Généré le</th><th class="px-3 py-2"></th></tr>
                    </thead>
                    <tbody>
                        ${reports.length ? reports.map(r => `
                            <tr class="border-b">
                                <td class="px-3 py-2">${r.period_start} → ${r.period_end}</td>
                                <td class="px-3 py-2 text-right font-semibold">${formatCo2Kg(r.total_co2_kg)}</td>
                                <td class="px-3 py-2 text-right">${formatCo2Kg(r.scope3_kg)}</td>
                                <td class="px-3 py-2 text-right">${r.shipment_count || 0}</td>
                                <td class="px-3 py-2 text-xs text-gray-500">${r.created_at ? String(r.created_at).slice(0, 16).replace('T', ' ') : '—'}</td>
                                <td class="px-3 py-2 text-right"><button type="button" onclick="downloadCsrdReport(${r.id})" class="text-indigo-600 hover:underline text-xs"><i class="fa-solid fa-download mr-1"></i>CSV</button></td>
                            </tr>`).join('') : '<tr><td colspan="6" class="px-3 py-8 text-center text-gray-400 italic">Aucun rapport généré</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    </div>`;
}

async function loadSustainabilityStats() {
    const res = await apiFetch('sustainability/stats');
    if (!res.ok) throw new Error('Stats durabilité indisponibles');
    const json = await res.json();
    sustainabilityStatsCache = json.data;
    return sustainabilityStatsCache;
}

async function recalculateAllCarbon() {
    try {
        const res = await apiFetch('sustainability/carbon/recalculate-all', { method: 'POST' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Recalcul impossible');
        showToast(`${json.data?.updated || 0} transport(s) recalculé(s)`, 'success');
        await refreshData();
        const stats = await loadSustainabilityStats();
        document.getElementById('app-content').innerHTML = renderSustainability(stats);
    } catch (e) {
        showToast(e.message || 'Erreur recalcul carbone', 'error');
    }
}

async function runGreenOptimization() {
    const payload = {
        origin: document.getElementById('green-origin')?.value,
        dest: document.getElementById('green-dest')?.value,
        weight: Number(document.getElementById('green-weight')?.value) || 5000,
        basePrice: Number(document.getElementById('green-price')?.value) || 0,
        weights: {
            cost: (Number(document.getElementById('green-w-cost')?.value) || 40) / 100,
            time: (Number(document.getElementById('green-w-time')?.value) || 30) / 100,
            carbon: (Number(document.getElementById('green-w-carbon')?.value) || 30) / 100
        }
    };
    if (!payload.origin || !payload.dest) {
        showToast('Renseignez origine et destination', 'error');
        return;
    }
    try {
        const res = await apiFetch('sustainability/optimize/green', { method: 'POST', body: payload });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Optimisation impossible');
        const box = document.getElementById('green-scenarios-result');
        if (!box) return;
        const scenarios = json.data?.scenarios || [];
        box.innerHTML = scenarios.map(sc => `
            <div class="border rounded-lg p-3 ${sc.recommended ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200'}">
                <div class="flex justify-between items-start gap-2">
                    <div>
                        <p class="font-semibold text-sm">${sc.label}${sc.recommended ? ' <span class="text-emerald-700 text-xs">(recommandé)</span>' : ''}</p>
                        <p class="text-xs text-gray-500 mt-1">${sc.description}</p>
                    </div>
                    <span class="text-xs font-bold text-emerald-700">Score ${sc.greenScore}</span>
                </div>
                <div class="grid grid-cols-3 gap-2 mt-2 text-xs">
                    <span><strong>${formatCo2Kg(sc.co2Kg)}</strong> kg CO2e</span>
                    <span><strong>${Number(sc.costEur).toLocaleString()} €</strong></span>
                    <span><strong>${sc.durationHours} h</strong></span>
                </div>
            </div>`).join('');
    } catch (e) {
        showToast(e.message || 'Erreur optimisation green', 'error');
    }
}

async function loadCsrdReports() {
    const res = await apiFetch('sustainability/csrd/reports');
    if (!res.ok) return [];
    const json = await res.json();
    csrdReportsCache = json.data || [];
    return csrdReportsCache;
}

async function generateCsrdReport() {
    const startDate = document.getElementById('csrd-start')?.value;
    const endDate = document.getElementById('csrd-end')?.value;
    try {
        const res = await apiFetch('sustainability/csrd/reports/generate', {
            method: 'POST',
            body: { startDate, endDate }
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Génération impossible');
        showToast('Rapport CSRD généré', 'success');
        await loadCsrdReports();
        document.getElementById('app-content').innerHTML = renderRseCompliance(csrdReportsCache);
    } catch (e) {
        showToast(e.message || 'Erreur génération CSRD', 'error');
    }
}

async function downloadCsrdReport(id) {
    try {
        const res = await apiFetch(`sustainability/csrd/reports/${id}/download`);
        if (!res.ok) throw new Error('Téléchargement impossible');
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `CSRD_ESRS_E1_${id}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    } catch (e) {
        showToast(e.message || 'Erreur téléchargement', 'error');
    }
}

window.recalculateAllCarbon = recalculateAllCarbon;
window.runGreenOptimization = runGreenOptimization;
window.generateCsrdReport = generateCsrdReport;
window.downloadCsrdReport = downloadCsrdReport;

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
            <h2 class="text-2xl font-bold mb-4">Prêt à simplifier votre gestion ?</h2>
            <p class="text-blue-100">Utilisez le menu pour accéder à toutes les fonctionnalités de votre espace Flenova.</p>
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
                <p class="text-gray-600">support@flenova.fr</p>
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
            <h2 class="text-3xl font-bold text-gray-900 mb-2">À propos de Flenova</h2>
            <p class="text-gray-600">Votre solution de gestion de transport</p>
        </div>
        <div class="space-y-6 text-gray-700">
            <p>Flenova est une application de gestion de transport (TMS) complète conçue pour simplifier la planification, 
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
            <div class="bg-gray-50 p-4 rounded-lg text-sm">
                <p><strong>Entreprise :</strong> ${typeof FLENOVA_LEGAL !== 'undefined' ? FLENOVA_LEGAL.company : 'Flenova SAS'}</p>
                <p><strong>SIRET :</strong> ${typeof FLENOVA_LEGAL !== 'undefined' ? FLENOVA_LEGAL.siret : '—'}</p>
                <p><strong>TVA :</strong> ${typeof FLENOVA_LEGAL !== 'undefined' ? FLENOVA_LEGAL.tva : '—'}</p>
                <p><strong>Adresse :</strong> ${typeof FLENOVA_LEGAL !== 'undefined' ? FLENOVA_LEGAL.address : '—'}</p>
                <p class="mt-3"><strong>Données personnelles :</strong> <a href="#" onclick="router('privacy'); return false;" class="text-blue-600 hover:underline">Mes données</a></p>
            </div>
            ${typeof renderLegalFooterLinks === 'function' ? renderLegalFooterLinks('mt-4 text-sm') : ''}
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

function computeTaxableWeightFrontend(input = {}) {
    const gross = Number(input.grossWeightKg) || 0;
    const volume = Number(input.volumeM3) || 0;
    const heightCm = Number(input.heightCm) || 0;
    const lengthM = Number(input.lengthM) || 0;
    const widthM = Number(input.widthM) || 0;
    const stackable = input.stackable != null ? !!input.stackable : (heightCm <= 0 || heightCm <= 120);

    let volumetric = gross;
    let method = 'volume_333';
    if (stackable && volume > 0) {
        volumetric = Math.round(volume * 333);
        method = 'volume_333';
    } else if (!stackable && lengthM > 0 && widthM > 0) {
        volumetric = Math.round(((lengthM * widthM) / 2.4) * 1750);
        method = 'ldm_1750';
    } else if (volume > 0) {
        volumetric = Math.round(volume * 333);
    }

    const taxable = Math.max(gross, volumetric);
    return {
        grossWeightKg: Math.round(gross),
        volumetricWeightKg: volumetric,
        taxableWeightKg: Math.round(taxable),
        isStackable: stackable,
        method
    };
}

async function renderPublicTrackingPage() {
    const params = new URLSearchParams(window.location.search);
    const hashQuery = (window.location.hash || '').includes('?')
        ? window.location.hash.split('?')[1] : '';
    const hashParams = new URLSearchParams(hashQuery);
    const code = (params.get('code') || hashParams.get('code') || '').trim().toUpperCase();

    if (!code) {
        return `<div class="max-w-xl mx-auto py-20 px-6">
            <h1 class="text-2xl font-bold text-gray-800 mb-4">Suivi transport en temps réel</h1>
            <p class="text-gray-600 mb-6">Saisissez le code reçu lors de la création de votre commande (ex. TRK-XXXXXXXX).</p>
            <div class="flex gap-2">
                <input type="text" id="public-tracking-input" class="flex-1 border rounded-lg px-4 py-3 font-mono uppercase" placeholder="TRK-XXXXXXXX">
                <button type="button" onclick="publicTrackByCode()" class="bg-blue-600 text-white px-5 py-3 rounded-lg font-bold">Suivre</button>
            </div>
        </div>`;
    }

    try {
        const res = await fetch(`/api/public/tracking/${encodeURIComponent(code)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Transport introuvable');

        const timeline = (data.timeline || []).map(h => `
            <div class="flex gap-3 text-sm border-b pb-2 mb-2">
                <span class="text-gray-400 font-mono text-xs">${h.changed_at ? new Date(h.changed_at).toLocaleString('fr-FR') : '—'}</span>
                <span class="font-semibold">${h.status}</span>
                ${h.comment ? `<span class="text-gray-500">${h.comment}</span>` : ''}
            </div>`).join('') || '<p class="text-gray-400 italic">Aucun événement</p>';

        const pos = data.lastPosition;
        const mapLink = pos
            ? `https://www.google.com/maps?q=${pos.latitude},${pos.longitude}`
            : null;

        return `<div class="max-w-2xl mx-auto py-12 px-6 fade-in">
            <div class="bg-white rounded-2xl shadow-lg border p-8">
                <p class="text-xs uppercase text-gray-400 font-bold">Suivi donneur d'ordre</p>
                <h1 class="text-2xl font-black text-gray-900 mt-1">${data.ref || 'Transport'}</h1>
                <p class="font-mono text-teal-700 mt-2">${data.trackingCode}</p>
                <div class="mt-6 grid grid-cols-2 gap-4 text-sm">
                    <div><span class="text-gray-400 text-xs uppercase">Statut</span><p class="font-bold">${data.status}</p></div>
                    <div><span class="text-gray-400 text-xs uppercase">Mode</span><p>${data.transportMode || '—'}</p></div>
                    <div class="col-span-2"><span class="text-gray-400 text-xs uppercase">Trajet</span><p>${data.origin || '—'} → ${data.destination || '—'}</p></div>
                    <div><span class="text-gray-400 text-xs uppercase">Poids taxé</span><p>${data.taxableWeightKg ? `${data.taxableWeightKg} kg` : '—'}</p></div>
                    <div><span class="text-gray-400 text-xs uppercase">Km PL</span><p>${data.routeKmHgv ? `${data.routeKmHgv} km` : '—'}</p></div>
                    <div><span class="text-gray-400 text-xs uppercase">Chauffeur</span><p>${data.driverName || '—'}</p></div>
                    <div><span class="text-gray-400 text-xs uppercase">Véhicule</span><p>${data.vehiclePlate || '—'}</p></div>
                </div>
                ${mapLink ? `<a href="${mapLink}" target="_blank" rel="noopener" class="mt-6 inline-flex items-center gap-2 text-blue-600 font-semibold text-sm"><i class="fa-solid fa-location-dot"></i> Dernière position véhicule</a>` : ''}
                <div class="mt-8">
                    <h2 class="text-xs uppercase text-gray-500 font-bold mb-3">Historique</h2>
                    ${timeline}
                </div>
                <button type="button" onclick="publicRouter('tracking')" class="mt-6 text-sm text-gray-500 hover:text-gray-800">← Nouveau code</button>
            </div>
        </div>`;
    } catch (e) {
        return `<div class="max-w-xl mx-auto py-20 px-6 text-center">
            <p class="text-red-600 font-semibold mb-4">${e.message}</p>
            <button type="button" onclick="publicRouter('tracking')" class="text-blue-600">Réessayer</button>
        </div>`;
    }
}

window.publicTrackByCode = function () {
    const code = document.getElementById('public-tracking-input')?.value?.trim();
    if (!code) return;
    window.location.hash = 'tracking';
    const base = `${window.location.pathname}${window.location.search.split('?')[0]}`;
    history.replaceState(null, '', `${base}?code=${encodeURIComponent(code.toUpperCase())}#tracking`);
    publicRouter('tracking');
};

function renderQuotationCalculator() {
    return `
    <div class="max-w-4xl mx-auto bg-white rounded-xl shadow-sm border border-gray-100 p-8 fade-in">
        <h2 class="text-2xl font-bold text-gray-800 mb-6"><i class="fa-solid fa-calculator mr-2 text-indigo-600"></i>Calculateur de Cotation (Trinôme)</h2>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div class="space-y-6">
                <div class="p-4 bg-indigo-50 rounded-lg border border-indigo-200">
                    <h4 class="font-bold text-indigo-900 mb-3 text-sm uppercase tracking-wider">0. Poids taxé (terrestre)</h4>
                    <div class="grid grid-cols-2 gap-3">
                        <div><label class="block text-xs text-gray-500 mb-1">Poids réel (kg)</label>
                            <input type="number" id="q-gross-kg" value="0" class="w-full border rounded p-2 text-sm" oninput="updateQuotation()"></div>
                        <div><label class="block text-xs text-gray-500 mb-1">Volume (m³)</label>
                            <input type="number" id="q-volume-m3" step="0.01" value="0" class="w-full border rounded p-2 text-sm" oninput="updateQuotation()"></div>
                        <div><label class="block text-xs text-gray-500 mb-1">Hauteur (cm)</label>
                            <input type="number" id="q-height-cm" value="120" class="w-full border rounded p-2 text-sm" oninput="updateQuotation()"></div>
                        <div><label class="block text-xs text-gray-500 mb-1">Long. × larg. (m)</label>
                            <div class="flex gap-1"><input type="number" id="q-length-m" step="0.01" value="0" class="w-1/2 border rounded p-2 text-sm" oninput="updateQuotation()"><input type="number" id="q-width-m" step="0.01" value="0" class="w-1/2 border rounded p-2 text-sm" oninput="updateQuotation()"></div></div>
                    </div>
                    <label class="flex items-center gap-2 mt-3 text-xs text-gray-700 cursor-pointer">
                        <input type="checkbox" id="q-stackable" checked onchange="updateQuotation()" class="rounded text-indigo-600"> Gerbable (h ≤ 120 cm)
                    </label>
                    <p id="q-taxable-preview" class="mt-3 text-xs text-indigo-900 bg-white border border-indigo-100 rounded p-2">Poids taxé : 0 kg</p>
                    <p class="mt-2 text-[10px] text-gray-400">Facturation = max(poids réel, poids volumétrique). Non gerbable : (L×l/2,4)×1750 kg/LDM.</p>
                </div>

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
                            <span>Poids taxé</span>
                            <span id="res-taxable" class="font-bold">0 kg</span>
                        </div>
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
                
                <button onclick="saveQuotation()" class="mt-4 w-full py-3 bg-white text-indigo-900 rounded-xl font-bold hover:bg-indigo-50 transition shadow-lg">
                    Générer Offre Commerciale
                </button>
                <button type="button" onclick="createOrderFromQuotation()" class="mt-3 w-full py-3 bg-indigo-500 text-white rounded-xl font-bold hover:bg-indigo-400 transition border border-indigo-400">
                    <i class="fa-solid fa-file-circle-plus mr-1"></i> Créer une commande
                </button>
            </div>
        </div>
    </div>`;
}

function updateQuotation() {
    const taxableEl = document.getElementById('q-taxable-preview');
    const resTaxable = document.getElementById('res-taxable');
    if (document.getElementById('q-gross-kg')) {
        const tw = computeTaxableWeightFrontend({
            grossWeightKg: parseFloat(document.getElementById('q-gross-kg').value) || 0,
            volumeM3: parseFloat(document.getElementById('q-volume-m3').value) || 0,
            heightCm: parseFloat(document.getElementById('q-height-cm').value) || 0,
            lengthM: parseFloat(document.getElementById('q-length-m').value) || 0,
            widthM: parseFloat(document.getElementById('q-width-m').value) || 0,
            stackable: document.getElementById('q-stackable')?.checked
        });
        const txt = `Vol. ${tw.volumetricWeightKg.toLocaleString()} kg → Taxé ${tw.taxableWeightKg.toLocaleString()} kg`;
        if (taxableEl) taxableEl.textContent = txt;
        if (resTaxable) resTaxable.textContent = `${tw.taxableWeightKg.toLocaleString()} kg`;
    }

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
                    <p style="margin: 5px 0; font-weight: bold;">${currentUser?.company_name || 'Flenova'} - Votre partenaire transport</p>
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
                <p style="margin: 5px 0 0 0;">Cette simulation a été générée via Flenova TMS. Les prix sont indiqués Hors Taxes.</p>
            </div>
        </div>
    `;

    const opt = {
        margin: [0.5, 0.5],
        filename: `Offre_Commerciale_Flenova_${Date.now().toString().slice(-6)}.pdf`,
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
    window.currentAppRoute = route;
    const appContent = document.getElementById('app-content');
    const pageTitle = document.getElementById('page-title');

    // Sync URL hash (évite qu'un ancien #contact réapparaisse au clic sur href="#")
    try {
        const base = `${window.location.pathname}${window.location.search}`;
        const desiredHash = route === 'dashboard' ? '' : `#${route}`;
        if (window.location.hash !== desiredHash) {
            history.replaceState(null, '', base + desiredHash);
        }
    } catch (_) { /* ignore */ }

    // Active nav — correspondance exacte (évite transports / inprogress_transports / completed_transports)
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        const navRoute = item.closest('[data-nav-route]')?.dataset?.navRoute;
        const onclickMatch = item.getAttribute('onclick')?.match(/router\('([^']+)'\)/);
        const itemRoute = navRoute || onclickMatch?.[1];
        if (itemRoute === route) item.classList.add('active');
    });

    let content = '';
    let title = '';

    switch (route) {
        case 'dashboard':
            title = 'Tableau de bord';
            await refreshDashboardView();
            break;
        case 'transports':
            title = transportFilters.view === 'trash' ? 'Corbeille transports' : 'Transports';
            if (transportFilters.view === 'trash' && typeof loadDeletedTransports === 'function') {
                await loadDeletedTransports();
            }
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
        case 'sustainability':
            title = 'Durabilité';
            content = renderSustainability();
            loadSustainabilityStats()
                .then(stats => {
                    document.getElementById('app-content').innerHTML = renderSustainability(stats);
                })
                .catch(err => console.warn('Durabilité:', err));
            break;
        case 'rse_compliance':
            title = 'Conformité RSE';
            content = renderRseCompliance();
            loadCsrdReports()
                .then(reports => {
                    document.getElementById('app-content').innerHTML = renderRseCompliance(reports);
                })
                .catch(err => console.warn('CSRD:', err));
            break;
        case 'affretement_confirmation':
            title = 'Confirmation d\'affrètement';
            content = renderAffretementConfirmationShell();
            setTimeout(() => loadAffretementConfirmationPage(), 0);
            break;
        case 'cmr_preview':
            title = 'Lettre de voiture (CMR)';
            content = renderCmrPreviewShell();
            setTimeout(() => loadCmrPreviewPage(), 0);
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
            setTimeout(() => {
                loadBankSettingsIntoForm();
                refreshIopoleConfigPanel();
            }, 0);
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
            try {
                const bankRes = await apiFetch('bank-settings');
                if (bankRes.ok) {
                    const bankJson = await bankRes.json();
                    window.cachedBankSettings = bankJson.data || null;
                } else {
                    window.cachedBankSettings = null;
                }
            } catch (e) {
                window.cachedBankSettings = null;
            }
            content = renderAdmin(window.cachedBankSettings);
            break;
        case 'tracking':
            title = 'Suivi transport';
            content = '<div class="fade-in p-8 text-center text-gray-400"><i class="fa-solid fa-spinner fa-spin"></i></div>';
            renderPublicTrackingPage().then(html => {
                const el = document.getElementById('app-content');
                if (el && window.currentAppRoute === 'tracking') el.innerHTML = html;
            });
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
        case 'privacy':
            title = 'Mes données personnelles';
            content = typeof renderPrivacySettingsPage === 'function' ? renderPrivacySettingsPage() : '';
            break;
        case 'legal_page':
            title = 'Informations légales';
            content = typeof renderLegalPage === 'function'
                ? renderLegalPage(window._legalPageType || 'privacy')
                : '';
            break;
        case 'quotation':
            title = 'Calculateur de Cotation';
            content = renderQuotationCalculator();
            setTimeout(updateQuotation, 50);
            break;
        default:
            title = 'Tableau de bord';
            await refreshDashboardView();
            break;
    }

    if (content) {
        appContent.innerHTML = content;
    }

    pageTitle.textContent = title;
    if (typeof applyRoleBasedNav === 'function') applyRoleBasedNav();
    if (typeof applyDemoBanner === 'function') applyDemoBanner();
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

    const icon = document.createElement('i');
    icon.className = `fa-solid ${icons[type] || icons.info} text-${type === 'success' ? 'green' : type === 'error' ? 'red' : 'blue'}-500 text-xl mr-3`;

    const text = document.createElement('span');
    text.className = 'text-sm text-gray-700';
    text.textContent = String(message ?? '');

    toast.appendChild(icon);
    toast.appendChild(text);
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
        const chartOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } };
        const revCtx = document.getElementById('dashRevChart');
        if (revCtx) {
            chartInstances.dashRevChart = new Chart(revCtx, {
                type: 'line',
                data: {
                    labels: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'],
                    datasets: [{
                        label: 'CA (€)',
                        data: stats.revenueChart || new Array(12).fill(0),
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(37, 99, 235, 0.12)',
                        fill: true,
                        tension: 0.35,
                        pointRadius: 3
                    }]
                },
                options: chartOpts
            });
        }

        const costCtx = document.getElementById('dashCostChart');
        if (costCtx) {
            const cats = stats.costCategories || [];
            const labels = cats.length ? cats.map(c => c.label) : ['Aucune donnée'];
            const data = cats.length ? cats.map(c => c.value) : [1];
            chartInstances.dashCostChart = new Chart(costCtx, {
                type: 'doughnut',
                data: {
                    labels,
                    datasets: [{ data, backgroundColor: ['#2563eb', '#059669', '#f59e0b', '#8b5cf6', '#ec4899', '#94a3b8'] }]
                },
                options: { ...chartOpts, plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } } }
            });
        }

        const perfCtx = document.getElementById('dashMissionPerfChart');
        if (perfCtx) {
            const mp = stats.missionPerformance || {};
            chartInstances.dashMissionPerfChart = new Chart(perfCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Livrées', 'En cours', 'En attente', 'Retards', 'Annulées'],
                    datasets: [{
                        data: [mp.delivered || 0, mp.inProgress || 0, mp.pending || 0, mp.late || 0, mp.cancelled || 0],
                        backgroundColor: ['#059669', '#2563eb', '#f59e0b', '#dc2626', '#94a3b8']
                    }]
                },
                options: { ...chartOpts, plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } } }
            });
        }

        const fillCtx = document.getElementById('dashFillGauge');
        if (fillCtx) {
            const fillRate = stats.fillRate || 0;
            chartInstances.dashFillGauge = new Chart(fillCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Rempli', 'Libre'],
                    datasets: [{ data: [fillRate, Math.max(0, 100 - fillRate)], backgroundColor: ['#2563eb', '#e2e8f0'], borderWidth: 0, circumference: 180, rotation: 270 }]
                },
                options: { ...chartOpts, cutout: '75%', plugins: { legend: { display: false }, tooltip: { enabled: false } } }
            });
        }

        // Legacy charts (autres vues / compat)
        const revLegacy = document.getElementById('revenueEvolutionChart');
        if (revLegacy) {
            chartInstances.revenueEvolutionChart = new Chart(revLegacy, {
                type: 'bar',
                data: {
                    labels: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'],
                    datasets: [{ label: 'CA (€)', data: stats.revenueChart || new Array(12).fill(0), backgroundColor: '#3b82f6' }]
                },
                options: commonOptions
            });
        }

        // Propre vs Affrètement
        const costLegacyCtx = document.getElementById('costBreakdownChart');
        if (costLegacyCtx) {
            const own = stats.costBreakdown ? stats.costBreakdown[0] : 0;
            const chartered = stats.costBreakdown ? stats.costBreakdown[1] : 0;
            const data = (own === 0 && chartered === 0) ? [1, 1] : [own, chartered];
            const labels = (own === 0 && chartered === 0) ? ['Aucune donnée'] : ['Transport Propre', 'Affrètement'];

            chartInstances.costBreakdownChart = new Chart(costLegacyCtx, {
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

        // CA par client
        const clientRevCtx = document.getElementById('clientRevenueChart');
        if (clientRevCtx) {
            const revLabels = stats.clientRevenue?.length
                ? stats.clientRevenue.map(item => item.client_name)
                : ['Aucune donnée'];
            const revData = stats.clientRevenue?.length
                ? stats.clientRevenue.map(item => item.revenue)
                : [0];
            chartInstances.clientRevenueChart = new Chart(clientRevCtx, {
                type: 'bar',
                data: {
                    labels: revLabels,
                    datasets: [{
                        label: 'CA (€)',
                        data: revData,
                        backgroundColor: '#059669',
                        borderRadius: 6
                    }]
                },
                options: {
                    ...commonOptions,
                    indexAxis: 'y',
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => `${Number(ctx.raw).toLocaleString()} €`
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: {
                                callback: (v) => `${Number(v).toLocaleString()} €`
                            }
                        }
                    }
                }
            });
        }

        // Répartition statuts
        const statusCtx = document.getElementById('statusDistributionChart');
        if (statusCtx) {
            const statusPalette = {
                'Annulé': '#ef4444',
                'Brouillon': '#94a3b8',
                'À planifier': '#cbd5e1',
                'Planifié': '#60a5fa',
                'Pris en charge': '#3b82f6',
                'En cours': '#2563eb',
                'Affrété': '#8b5cf6',
                'Livré': '#14b8a6',
                'Validé': '#10b981',
                'Clôturé': '#047857',
                'Terminé': '#059669'
            };
            const dist = stats.statusDistribution || [];
            const labels = dist.length ? dist.map(item => item.status) : ['Aucune donnée'];
            const data = dist.length ? dist.map(item => item.count) : [1];
            const colors = dist.length
                ? dist.map(item => statusPalette[item.status] || chartColors[0])
                : ['#e2e8f0'];
            chartInstances.statusDistributionChart = new Chart(statusCtx, {
                type: 'doughnut',
                data: {
                    labels,
                    datasets: [{ data, backgroundColor: colors, borderWidth: 0, cutout: '55%' }]
                },
                options: { ...commonOptions, plugins: { legend: { display: true, position: 'right' } } }
            });
        }

        // Taux opérationnels
        const opCtx = document.getElementById('operationalRatesChart');
        if (opCtx) {
            const rates = stats.operationalRates || {};
            chartInstances.operationalRatesChart = new Chart(opCtx, {
                type: 'bar',
                data: {
                    labels: ['Annulation', 'Livraison', 'Validation', 'En cours'],
                    datasets: [{
                        label: 'Taux (%)',
                        data: [
                            rates.cancellationRate || 0,
                            rates.deliveryRate || 0,
                            rates.validationRate || 0,
                            rates.inProgressRate || 0
                        ],
                        backgroundColor: ['#ef4444', '#14b8a6', '#6366f1', '#f59e0b'],
                        borderRadius: 6
                    }]
                },
                options: {
                    ...commonOptions,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: { label: (ctx) => `${ctx.raw}%` }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 100,
                            ticks: { callback: (v) => `${v}%` }
                        }
                    }
                }
            });
        }

        // Expéditions par client
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
        if (invCtx) {
            const overdue = Number(stats.overdueInvoiceAmount) || 0;
            const outstanding = Number(stats.outstandingAmount) || 0;
            const pending = Math.max(0, outstanding - overdue);
            const statusSums = {
                'Payée': stats.totalRevenue || 0,
                'En attente': pending,
                'Facture échue': overdue
            };
            const labels = Object.keys(statusSums);
            const data = Object.values(statusSums);

            chartInstances.invoicingStatusChart = new Chart(invCtx, {
                type: 'pie',
                data: {
                    labels: labels,
                    datasets: [{ data: data, backgroundColor: ['#10b981', '#f59e0b', '#ef4444'] }]
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
    vehicleSelect.innerHTML = getVehiclesByType('TRUCK').map(v => `<option value="${v.id}">${v.plate} - ${v.model}</option>`).join('');
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
        vehicleSelect.innerHTML = getVehiclesByType('TRUCK').map(v => `<option value="${v.id}">${v.plate} - ${v.model}</option>`).join('');

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
            <div class="flex justify-between border-b pb-2"><span class="text-gray-500">Camion</span><span class="font-medium font-mono">${driver.default_vehicle_plate || '—'}</span></div>
            <div class="flex justify-between border-b pb-2"><span class="text-gray-500">Remorque</span><span class="font-medium font-mono">${driver.default_trailer_plate || '—'}</span></div>
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
    const addOrderModal = document.getElementById('add-order-modal');
    if (addOrderModal) {
        addOrderModal.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                submitAddOrder();
            }
        });
    }
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
    populateDriverFleetSelects(null, null);
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
    populateDriverFleetSelects(driver.default_vehicle_id, driver.default_trailer_id);
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
        notes: document.getElementById('driver-notes').value,
        default_vehicle_id: document.getElementById('driver-default-vehicle')?.value || null,
        default_trailer_id: document.getElementById('driver-default-trailer')?.value || null
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
let isSubmittingDispatch = false;

function setDispatchSubmitting(busy) {
    isSubmittingDispatch = busy;
    const btn = document.getElementById('dispatch-submit-btn');
    if (btn) {
        btn.disabled = busy;
        btn.innerHTML = busy
            ? '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Affrètement en cours…'
            : '<i class="fa-solid fa-handshake mr-2"></i>Confirmer l\'affrètement';
        btn.classList.toggle('opacity-60', busy);
        btn.classList.toggle('cursor-not-allowed', busy);
    }
}

function openDispatchModal(orderId) {
    hideAllModals();

    const order = db.orders.find(o => o.id === orderId);
    if (!order) return;

    if (isOrderSubcontracted(order)) {
        const openExisting = confirm(
            `La commande ${order.ref || orderId} est déjà affrétée.\n\n`
            + 'OK : ouvrir la confirmation existante\n'
            + 'Annuler : modifier l\'affrètement (mise à jour facture achat, sans doublon)'
        );
        if (openExisting) {
            openAffretementConfirmation(orderId);
            return;
        }
    }

    document.getElementById('dispatch-order-id').value = orderId;
    document.getElementById('dispatch-order-ref').textContent = order.ref || '#' + orderId;
    document.getElementById('dispatch-order-price').textContent = (order.price || 0) + '€';
    document.getElementById('dispatch-purchase-price').value = order.purchase_price || '';

    const warningBanner = document.getElementById('dispatch-already-affrete-banner');
    if (warningBanner) {
        if (isOrderSubcontracted(order)) {
            warningBanner.classList.remove('hidden');
            warningBanner.textContent = 'Cette commande est déjà affrétée : une nouvelle confirmation mettra à jour la facture d\'achat existante (pas de doublon).';
        } else {
            warningBanner.classList.add('hidden');
            warningBanner.textContent = '';
        }
    }

    // Populate valid subcontractors only
    const select = document.getElementById('dispatch-subcontractor');
    const validSubcontractors = db.subcontractors.filter(s =>
        s.status === 'ACTIF' &&
        (!s.rc_pro_expiry || new Date(s.rc_pro_expiry) >= new Date())
    );
    select.innerHTML = '<option value="">-- Sélectionner --</option>' +
        validSubcontractors.map(s => `<option value="${s.id}" ${String(order.subcontractor_id) === String(s.id) ? 'selected' : ''}>${s.name}</option>`).join('');

    // Also add expired ones with warning
    const expired = db.subcontractors.filter(s =>
        s.status === 'ACTIF' && s.rc_pro_expiry && new Date(s.rc_pro_expiry) < new Date()
    );
    if (expired.length > 0) {
        select.innerHTML += '<option disabled>--- Expirés (attention) ---</option>' +
            expired.map(s => `<option value="${s.id}" class="text-red-500">${s.name} ⚠️</option>`).join('');
    }

    setDispatchSubmitting(false);
    calculateDispatchMargin();
    checkSubcontractorValidity();
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
    if (isSubmittingDispatch) return;

    const orderId = parseInt(document.getElementById('dispatch-order-id').value, 10);
    const subcontractorId = parseInt(document.getElementById('dispatch-subcontractor').value, 10);
    const purchasePrice = parseFloat(document.getElementById('dispatch-purchase-price').value);

    if (!orderId || !subcontractorId || !purchasePrice || purchasePrice <= 0) {
        showToast('Veuillez sélectionner un sous-traitant et saisir un prix d\'achat valide', 'error');
        return;
    }

    const order = (db.orders || []).find(o => o.id === orderId);
    if (order && isOrderSubcontracted(order)
        && Number(order.subcontractor_id) === subcontractorId
        && Number(order.purchase_price) === purchasePrice) {
        const reuse = confirm(
            'Cette commande est déjà affrétée avec les mêmes paramètres.\n\n'
            + 'Confirmer quand même pour régénérer la confirmation ?\n'
            + '(La facture d\'achat sera mise à jour, sans doublon.)'
        );
        if (!reuse) {
            openAffretementConfirmation(orderId);
            closeDispatchModal();
            return;
        }
    }

    setDispatchSubmitting(true);
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
            const msg = result.data?.message
                || (result.data?.purchaseInvoiceCreated === false
                    ? 'Affrètement mis à jour — facture d\'achat actualisée'
                    : 'Affrètement confirmé — ouverture de la confirmation');
            showToast(msg, 'success');
            closeDispatchModal();
            if (typeof refreshAfterMvpStep === 'function') {
                await refreshAfterMvpStep({ orderId, step: 'assign', status: 'Affrété', route: window.currentAppRoute || 'planning' });
            } else {
                await fetchAllData();
            }
            openAffretementConfirmation(orderId);
        } else {
            const errorData = await response.json().catch(() => ({}));
            showToast(errorData.error || 'Erreur lors de l\'affrètement', 'error');
        }
    } catch (error) {
        showToast('Erreur réseau', 'error');
    } finally {
        setDispatchSubmitting(false);
    }
}

// --- VEHICLE MODALS ---
function syncVehicleTypeFields(prefix) {
    const typeEl = document.getElementById(`${prefix}-vehicle-type`);
    const isTrailer = typeEl?.value === 'TRAILER';
    const fuelWrap = document.getElementById(`${prefix}-vehicle-fuel-wrap`);
    const driverWrap = document.getElementById(`${prefix}-vehicle-driver-wrap`);
    const driverLabel = driverWrap?.querySelector('label');
    const modelInput = document.getElementById(`${prefix}-vehicle-model`);
    if (fuelWrap) fuelWrap.classList.toggle('hidden', isTrailer);
    if (driverWrap) driverWrap.classList.remove('hidden');
    if (driverLabel) {
        driverLabel.textContent = isTrailer ? 'Chauffeur assigné (remorque)' : 'Chauffeur assigné';
    }
    if (modelInput) {
        modelInput.placeholder = isTrailer ? 'Schmit Cargobull' : 'Volvo FH';
    }
}

function buildVehiclePayload(prefix, existingVehicle = null) {
    const vehicleType = document.getElementById(`${prefix}-vehicle-type`)?.value
        || existingVehicle?.vehicle_type
        || 'TRUCK';
    const isTrailer = vehicleType === 'TRAILER';
    const driverSelect = document.getElementById(`${prefix}-vehicle-driver`);
    const maintenanceRaw = document.getElementById(`${prefix}-vehicle-maintenance`)?.value;

    return {
        plate: document.getElementById(`${prefix}-vehicle-plate`)?.value?.trim(),
        model: document.getElementById(`${prefix}-vehicle-model`)?.value?.trim(),
        vehicle_type: vehicleType,
        fuel: isTrailer ? null : (document.getElementById(`${prefix}-vehicle-fuel`)?.value || 'Diesel'),
        mileage: parseInt(document.getElementById(`${prefix}-vehicle-mileage`)?.value, 10) || 0,
        next_maintenance: maintenanceRaw || null,
        status: document.getElementById(`${prefix}-vehicle-status`)?.value
            || existingVehicle?.status
            || 'Disponible',
        driver_id: driverSelect?.value ? parseInt(driverSelect.value, 10) : null,
        insurance_expiry: existingVehicle?.insurance_expiry
            ? formatDateForInput(existingVehicle.insurance_expiry)
            : null
    };
}

window.syncVehicleTypeFields = syncVehicleTypeFields;

function openAddVehicleModal() {
    hideAllModals();
    document.getElementById('add-vehicle-modal-title').textContent = 'Ajouter un véhicule';
    document.getElementById('add-vehicle-type').value = 'TRUCK';
    document.getElementById('add-vehicle-plate').value = '';
    document.getElementById('add-vehicle-model').value = '';
    document.getElementById('add-vehicle-fuel').value = 'Diesel';
    document.getElementById('add-vehicle-mileage').value = '';
    document.getElementById('add-vehicle-maintenance').value = '';
    syncVehicleTypeFields('add');
    document.getElementById('add-vehicle-modal').classList.remove('hidden');
}


function closeAddVehicleModal() {
    hideAllModals();
}

async function submitAddVehicle() {
    const vehicleType = document.getElementById('add-vehicle-type')?.value || 'TRUCK';
    const isTrailer = vehicleType === 'TRAILER';
    const newVehicle = {
        plate: document.getElementById('add-vehicle-plate').value,
        model: document.getElementById('add-vehicle-model').value,
        fuel: isTrailer ? null : document.getElementById('add-vehicle-fuel').value,
        mileage: parseInt(document.getElementById('add-vehicle-mileage').value, 10) || 0,
        next_maintenance: document.getElementById('add-vehicle-maintenance').value,
        status: 'Disponible',
        driver_id: null,
        insurance_expiry: '2025-12-31',
        vehicle_type: vehicleType
    };

    if (newVehicle.plate && newVehicle.model) {
        try {
            const response = await apiFetch('vehicles', { method: 'POST', body: newVehicle });

            if (response.ok) {
                await fetchAllData();
                showToast('Véhicule ajouté avec succès', 'success');
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
    document.getElementById('edit-vehicle-type').value = vehicle.vehicle_type || 'TRUCK';
    document.getElementById('edit-vehicle-fuel').value = vehicle.fuel || 'Diesel';
    document.getElementById('edit-vehicle-mileage').value = vehicle.mileage || 0;
    document.getElementById('edit-vehicle-maintenance').value = formatDateForInput(vehicle.next_maintenance) || '';
    document.getElementById('edit-vehicle-status').value = vehicle.status || 'Disponible';

    // Populate driver select if it exists in the modal
    const driverSelect = document.getElementById('edit-vehicle-driver');
    if (driverSelect) {
        driverSelect.innerHTML = '<option value="">-- Aucun --</option>' +
            db.drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
        driverSelect.value = vehicle.driver_id || '';
    }

    syncVehicleTypeFields('edit');
    document.getElementById('edit-vehicle-modal').classList.remove('hidden');
}

function closeEditVehicleModal() {
    hideAllModals();
}

async function submitEditVehicle() {
    const vehicleId = parseInt(document.getElementById('edit-vehicle-id').value, 10);
    const vehicle = db.vehicles.find(v => v.id === vehicleId);

    if (!vehicle) {
        showToast('Véhicule non trouvé', 'error');
        return;
    }

    const payload = buildVehiclePayload('edit', vehicle);
    if (!payload.plate || !payload.model) {
        showToast('Veuillez remplir l\'immatriculation et le modèle', 'error');
        return;
    }

    try {
        const response = await apiFetch(`vehicles/${vehicleId}`, { method: 'PUT', body: payload });
        if (response.ok) {
            await fetchAllData();
            showToast('Véhicule mis à jour avec succès', 'success');
            closeEditVehicleModal();
            router('fleet');
        } else {
            const errorData = await response.json().catch(() => ({}));
            showToast(errorData.error || `Erreur ${response.status}`, 'error');
        }
    } catch (error) {
        showToast('Erreur réseau - Vérifiez le serveur Backend', 'error');
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

    if (type === 'Sous-traitance' && orderId) {
        const dup = (db.purchase_invoices || []).find(inv =>
            inv.type === 'Sous-traitance' && Number(inv.order_id) === orderId
        );
        if (dup) {
            showToast(`Facture affrètement déjà existante pour cette commande (${dup.id}).`, 'error');
            return;
        }
    }

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
            vehicle_id: null,
            trailer_id: null
        };
    }
    const driverVal = document.getElementById(`${prefix}-driver`)?.value;
    const vehicleVal = document.getElementById(`${prefix}-vehicle`)?.value;
    const trailerVal = document.getElementById(`${prefix}-trailer`)?.value;
    return {
        assignment_type: 'INTERNAL',
        subcontractor_id: null,
        purchase_price: 0,
        margin: 0,
        driver_id: driverVal ? parseInt(driverVal, 10) : null,
        vehicle_id: vehicleVal ? parseInt(vehicleVal, 10) : null,
        trailer_id: trailerVal ? parseInt(trailerVal, 10) : null
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

function getOrderCmrPayload(prefix) {
    const ref = document.getElementById(`${prefix}-ref`)?.value?.trim() || '';
    const shipperRef = document.getElementById(`${prefix}-shipper-ref`)?.value?.trim() || ref || null;
    const adrEnabled = document.getElementById(`${prefix}-adr`)?.checked;
    const volumeRaw = document.getElementById(`${prefix}-volume`)?.value;
    const unloadDriverVal = document.getElementById(`${prefix}-unload-driver`)?.value;
    return {
        consignee_name: document.getElementById(`${prefix}-consignee`)?.value?.trim() || null,
        shipper_ref: shipperRef,
        temperature_controlled: !!document.getElementById(`${prefix}-temperature`)?.checked,
        adr_class: adrEnabled ? (document.getElementById(`${prefix}-adr-class`)?.value?.trim() || null) : null,
        adr_un: adrEnabled ? (document.getElementById(`${prefix}-adr-un`)?.value?.trim() || null) : null,
        volume: volumeRaw !== '' && volumeRaw != null ? parseFloat(volumeRaw) : null,
        origin_country: document.getElementById(`${prefix}-origin-country`)?.value?.trim() || 'France',
        dest_country: document.getElementById(`${prefix}-dest-country`)?.value?.trim() || 'France',
        notes: document.getElementById(`${prefix}-notes`)?.value?.trim() || null,
        unload_driver_id: unloadDriverVal ? parseInt(unloadDriverVal, 10) : null
    };
}

function populateOrderUnloadDriverSelect(selectEl, selectedId) {
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="">-- Même chauffeur --</option>' +
        (db.drivers || []).map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    if (selectedId) selectEl.value = String(selectedId);
}

function resetOrderCmrFields(prefix) {
    const setVal = (id, value) => {
        const el = document.getElementById(`${prefix}-${id}`);
        if (el) el.value = value;
    };
    const setChecked = (id, checked) => {
        const el = document.getElementById(`${prefix}-${id}`);
        if (el) el.checked = checked;
    };
    setVal('consignee', '');
    setVal('shipper-ref', '');
    setVal('origin-country', 'France');
    setVal('dest-country', 'France');
    setVal('volume', '');
    setVal('adr-class', '');
    setVal('adr-un', '');
    setVal('notes', '');
    setChecked('temperature', false);
    setChecked('adr', false);
    populateOrderUnloadDriverSelect(document.getElementById(`${prefix}-unload-driver`));
    toggleOrderAdrFields(prefix);
}

function populateOrderCmrFields(prefix, order) {
    if (!order) return;
    const setVal = (id, value) => {
        const el = document.getElementById(`${prefix}-${id}`);
        if (el) el.value = value ?? '';
    };
    const setChecked = (id, checked) => {
        const el = document.getElementById(`${prefix}-${id}`);
        if (el) el.checked = !!checked;
    };
    setVal('consignee', order.consignee_name || '');
    setVal('shipper-ref', order.shipper_ref || order.ref || '');
    setVal('origin-country', order.origin_country || 'France');
    setVal('dest-country', order.dest_country || 'France');
    setVal('volume', order.volume ?? '');
    setVal('adr-class', order.adr_class || '');
    setVal('adr-un', order.adr_un || '');
    setVal('notes', order.notes || '');
    setChecked('temperature', order.temperature_controlled);
    setChecked('adr', !!(order.adr_class || order.adr_un));
    populateOrderUnloadDriverSelect(document.getElementById(`${prefix}-unload-driver`), order.unload_driver_id);
    toggleOrderAdrFields(prefix);
}

window.toggleOrderAdrFields = function (prefix) {
    const enabled = document.getElementById(`${prefix}-adr`)?.checked;
    document.getElementById(`${prefix}-adr-fields`)?.classList.toggle('hidden', !enabled);
    if (!enabled) {
        const classEl = document.getElementById(`${prefix}-adr-class`);
        const unEl = document.getElementById(`${prefix}-adr-un`);
        if (classEl) classEl.value = '';
        if (unEl) unEl.value = '';
    }
};

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

function getOrderQuickPrefs() {
    try {
        return JSON.parse(localStorage.getItem('flenova_order_quick_prefs') || '{}');
    } catch {
        return {};
    }
}

function saveOrderQuickPrefs(prefs) {
    try {
        localStorage.setItem('flenova_order_quick_prefs', JSON.stringify({ ...getOrderQuickPrefs(), ...prefs }));
    } catch { /* ignore */ }
}

function getClientsSortedForOrders() {
    const clients = [...(db.clients || [])];
    const lastByClient = {};
    (db.orders || []).forEach((o) => {
        if (!o.client_id) return;
        const t = new Date(o.load_date || o.created_at || 0).getTime();
        if (!lastByClient[o.client_id] || t > lastByClient[o.client_id]) lastByClient[o.client_id] = t;
    });
    return clients.sort((a, b) => {
        const score = (lastByClient[b.id] || 0) - (lastByClient[a.id] || 0);
        if (score !== 0) return score;
        return String(a.name || '').localeCompare(String(b.name || ''), 'fr');
    });
}

function populateAddOrderClientSelect(selectedId) {
    const clientSelect = document.getElementById('add-order-client');
    if (!clientSelect) return;
    const clients = getClientsSortedForOrders();
    clientSelect.innerHTML = clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    const prefs = getOrderQuickPrefs();
    if (selectedId) clientSelect.value = String(selectedId);
    else if (prefs.lastClientId && clients.some(c => c.id === prefs.lastClientId)) {
        clientSelect.value = String(prefs.lastClientId);
    }
}

function setAddOrderMode(mode) {
    window.addOrderFormMode = mode;
    const isQuick = mode !== 'full';
    document.getElementById('add-order-advanced-sections')?.classList.toggle('hidden', isQuick);
    document.getElementById('add-order-assignment-subcontractor-toggle')?.classList.toggle('hidden', isQuick);
    document.getElementById('add-order-vehicle-wrap')?.classList.toggle('hidden', isQuick);
    document.getElementById('add-order-trailer-wrap')?.classList.toggle('hidden', isQuick);

    const quickBtn = document.getElementById('add-order-mode-quick-btn');
    const fullBtn = document.getElementById('add-order-mode-full-btn');
    if (quickBtn && fullBtn) {
        quickBtn.classList.toggle('bg-blue-600', isQuick);
        quickBtn.classList.toggle('text-white', isQuick);
        quickBtn.classList.toggle('text-gray-600', !isQuick);
        quickBtn.classList.toggle('hover:bg-gray-100', !isQuick);
        fullBtn.classList.toggle('bg-blue-600', !isQuick);
        fullBtn.classList.toggle('text-white', !isQuick);
        fullBtn.classList.toggle('text-gray-600', isQuick);
        fullBtn.classList.toggle('hover:bg-gray-100', isQuick);
    }
    document.getElementById('add-order-quick-hint')?.classList.toggle('hidden', !isQuick);
    saveOrderQuickPrefs({ formMode: mode });
}
window.setAddOrderMode = setAddOrderMode;

function applyClientHintsToOrderForm() {
    const clientId = parseInt(document.getElementById('add-order-client')?.value, 10);
    if (!clientId) return;
    const client = (db.clients || []).find(c => c.id === clientId);
    const originEl = document.getElementById('add-order-origin');
    const destEl = document.getElementById('add-order-dest');
    if (originEl && !originEl.value.trim() && client?.address) {
        originEl.value = client.address;
    }
    const lastForClient = [...(db.orders || [])]
        .filter(o => o.client_id === clientId && o.dest)
        .sort((a, b) => new Date(b.load_date || 0) - new Date(a.load_date || 0))[0];
    if (destEl && !destEl.value.trim() && lastForClient?.dest) {
        destEl.value = lastForClient.dest;
    }
}
window.applyClientHintsToOrderForm = applyClientHintsToOrderForm;

function applyAddOrderPrefill(prefill = {}) {
    const setVal = (id, value) => {
        const el = document.getElementById(id);
        if (el && value != null && value !== '') el.value = value;
    };
    if (prefill.client_id) {
        populateAddOrderClientSelect(prefill.client_id);
    }
    setVal('add-order-origin', prefill.origin);
    setVal('add-order-dest', prefill.dest);
    setVal('add-order-cargo', prefill.cargo);
    setVal('add-order-price', prefill.price);
    setVal('add-order-weight', prefill.weight);
    setVal('add-order-volume', prefill.volume);
    if (prefill.driver_id) {
        const driverSelect = document.getElementById('add-order-driver');
        if (driverSelect) driverSelect.value = String(prefill.driver_id);
    }
}

function prefillAddOrderFromLast() {
    const last = [...(db.orders || [])].sort((a, b) => {
        const ta = new Date(a.created_at || a.load_date || 0).getTime();
        const tb = new Date(b.created_at || b.load_date || 0).getTime();
        return tb - ta;
    })[0];
    if (!last) {
        showToast('Aucune commande précédente', 'info');
        return;
    }
    applyAddOrderPrefill({
        client_id: last.client_id,
        origin: last.origin,
        dest: last.dest,
        cargo: last.cargo,
        price: last.price,
        weight: last.weight,
        volume: last.volume,
        driver_id: last.driver_id
    });
    showToast(`Reprise de ${last.ref || `T${last.id}`}`, 'success');
}
window.prefillAddOrderFromLast = prefillAddOrderFromLast;

window.createOrderFromQuotation = function () {
    const totalText = document.getElementById('res-total')?.textContent || '0';
    const price = parseFloat(String(totalText).replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
    openAddOrderModal({
        price,
        weight: parseFloat(document.getElementById('q-gross-kg')?.value) || 0,
        volume: parseFloat(document.getElementById('q-volume-m3')?.value) || 0,
        fullMode: false
    });
};

function openAddOrderModal(prefill = {}) {
    hideAllModals();
    populateAddOrderClientSelect(prefill.client_id);

    populateOrderFleetSelects('add-order');

    const driverSelect = document.getElementById('add-order-driver');
    if (driverSelect) {
        driverSelect.innerHTML = '<option value="">— Plus tard —</option>' +
            (db.drivers || []).map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    }

    populateSubcontractorSelect(document.getElementById('add-order-subcontractor'));

    const agencySelect = document.getElementById('add-order-agency');
    if (agencySelect) {
        const agencies = db.agencies || [];
        agencySelect.innerHTML = '<option value="">— Par défaut —</option>' +
            agencies.map(a => `<option value="${a.id}">${a.code} — ${a.name}</option>`).join('');
        if (currentUser?.agency_id) agencySelect.value = String(currentUser.agency_id);
    }
    const agencyWrap = document.getElementById('add-order-agency-wrap');
    if (agencyWrap && typeof canManageUsers === 'function' && !canManageUsers()) {
        agencyWrap.classList.add('hidden');
    } else if (agencyWrap) {
        agencyWrap.classList.remove('hidden');
    }

    document.getElementById('add-order-origin').value = '';
    document.getElementById('add-order-dest').value = '';
    document.getElementById('add-order-cargo').value = '';
    document.getElementById('add-order-price').value = '';
    document.getElementById('add-order-weight').value = '';
    const transportMode = document.getElementById('add-order-transport-mode');
    if (transportMode) transportMode.value = 'FTL';
    const volumeInput = document.getElementById('add-order-volume');
    if (volumeInput) volumeInput.value = '';

    const internalRadio = document.querySelector('input[name="add-order-assignment"][value="INTERNAL"]');
    if (internalRadio) internalRadio.checked = true;
    toggleAddOrderAssignment();

    document.getElementById('add-order-load-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('add-order-delivery-date').value = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    const refInput = document.getElementById('add-order-ref');
    const refDisplay = document.getElementById('add-order-ref-display');
    if (refInput) refInput.value = '…';
    if (refDisplay) refDisplay.textContent = '…';
    apiFetch('transport-orders/next-ref')
        .then(res => res.ok ? res.json() : null)
        .then(json => {
            const ref = json?.data?.ref;
            if (refInput && ref) refInput.value = ref;
            if (refDisplay && ref) refDisplay.textContent = ref;
        })
        .catch(() => {
            const fallback = `CMD-${new Date().getFullYear()}-${String((db.orders || []).length + 1).padStart(3, '0')}`;
            if (refInput) refInput.value = fallback;
            if (refDisplay) refDisplay.textContent = fallback;
        });

    document.getElementById('add-order-pallet-type').value = 'palette_europe';
    document.getElementById('add-order-pallet-count').value = '0';
    document.getElementById('add-order-pallet-exchange').checked = false;
    document.getElementById('add-order-pallets-returned').value = '0';
    document.getElementById('add-order-purchase-price').value = '';
    toggleOrderPalletFields('add-order');
    toggleOrderPalletExchange('add-order');
    resetOrderCmrFields('add-order');
    updateAddOrderMargin();

    applyAddOrderPrefill(prefill);
    const prefs = getOrderQuickPrefs();
    if (!prefill.driver_id && prefs.lastDriverId && driverSelect) {
        driverSelect.value = String(prefs.lastDriverId);
    }
    if (prefill.client_id || prefs.lastClientId) {
        applyClientHintsToOrderForm();
    }

    setAddOrderMode(prefill.fullMode ? 'full' : (prefs.formMode || 'quick'));

    const modal = document.getElementById('add-order-modal');
    modal.classList.remove('hidden');
    if (!modal.classList.contains('flex')) modal.classList.add('flex', 'items-center', 'justify-center');
    setTimeout(() => document.getElementById('add-order-client')?.focus(), 50);
}
window.openAddOrderModal = openAddOrderModal;

function closeAddOrderModal() {
    hideAllModals();
}

let isSubmittingOrder = false;

async function submitAddOrder() {
    if (isSubmittingOrder) return;
    const assignment = getOrderAssignmentPayload('add-order');
    const pallet = getOrderPalletPayload('add-order');
    const cmr = getOrderCmrPayload('add-order');
    const volumeVal = parseFloat(document.getElementById('add-order-volume')?.value);
    const agencyVal = document.getElementById('add-order-agency')?.value;
    const newOrder = {
        ref: document.getElementById('add-order-ref').value,
        client_id: parseInt(document.getElementById('add-order-client').value, 10),
        cargo: document.getElementById('add-order-cargo').value?.trim() || 'Marchandises générales',
        origin: document.getElementById('add-order-origin').value,
        dest: document.getElementById('add-order-dest').value,
        load_date: document.getElementById('add-order-load-date').value,
        delivery_date: document.getElementById('add-order-delivery-date').value,
        weight: parseFloat(document.getElementById('add-order-weight').value) || 0,
        transport_mode: document.getElementById('add-order-transport-mode')?.value || 'FTL',
        agency_id: agencyVal ? parseInt(agencyVal, 10) : null,
        volume: Number.isFinite(volumeVal) ? volumeVal : null,
        price: parseFloat(document.getElementById('add-order-price').value) || 0,
        status: 'Brouillon',
        ...assignment,
        ...pallet,
        ...cmr
    };

    if (assignment.assignment_type === 'SUBCONTRACTED' && !assignment.subcontractor_id) {
        showToast('Veuillez sélectionner un sous-traitant', 'error');
        return;
    }

    if (newOrder.client_id && newOrder.origin && newOrder.dest && newOrder.load_date) {
        isSubmittingOrder = true;
        const res = await apiFetch('transport-orders', { method: 'POST', body: newOrder });
        isSubmittingOrder = false;
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Erreur lors de la création', 'error');
            return;
        }
        const created = await res.json().catch(() => ({}));
        const orderId = created?.id || created?.data?.id;
        const trackingCode = created?.tracking_code || created?.data?.tracking_code;
        if (created?.ref) {
            const refInput = document.getElementById('add-order-ref');
            if (refInput) refInput.value = created.ref;
        }
        if (trackingCode) {
            showToast(`Commande créée — Code suivi : ${trackingCode}`, 'success');
        } else {
            showToast('Commande créée avec succès !', 'success');
        }
        saveOrderQuickPrefs({
            lastClientId: newOrder.client_id,
            lastDriverId: assignment.driver_id || null
        });
        closeAddOrderModal();
        if (typeof refreshAfterMvpStep === 'function') {
            await refreshAfterMvpStep({ orderId, step: 'create', route: 'planning', reopenDetail: false });
        } else {
            await fetchAllData();
            router('planning');
        }
    } else {
        showToast('Veuillez remplir les champs obligatoires', 'error');
    }
}

function populateEditOrderStatusSelect(order) {
    const select = document.getElementById('edit-order-status');
    const readonlyEl = document.getElementById('edit-order-status-readonly');
    const wrap = document.getElementById('edit-order-status-wrap');
    if (!select || !order) return;

    const terminal = ['Validé', 'Clôturé', 'Terminé', 'Annulé'];
    const current = order.status || 'Brouillon';

    if (terminal.includes(current)) {
        select.classList.add('hidden');
        select.disabled = true;
        if (readonlyEl) {
            readonlyEl.textContent = `Statut verrouillé : ${current}`;
            readonlyEl.classList.remove('hidden');
        }
        select.innerHTML = `<option value="${current}">${current}</option>`;
        select.value = current;
        return;
    }

    select.classList.remove('hidden');
    select.disabled = false;
    if (readonlyEl) readonlyEl.classList.add('hidden');

    const nextStatuses = typeof getNextStatuses === 'function' ? getNextStatuses(current) : [];
    const options = [current, ...nextStatuses.filter(s => s !== current)];
    select.innerHTML = options.map(s => `<option value="${s}">${s}</option>`).join('');
    select.value = current;
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
    populateOrderFleetSelects('edit-order', { vehicleId: order.vehicle_id, trailerId: order.trailer_id });

    const driverSelect = document.getElementById('edit-order-driver');
    driverSelect.innerHTML = '<option value="">-- Sélectionner un chauffeur --</option>' +
        (db.drivers || []).map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    driverSelect.value = order.driver_id || '';

    populateSubcontractorSelect(document.getElementById('edit-order-subcontractor'), order.subcontractor_id);

    const isSub = isOrderSubcontracted(order);
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
    populateEditOrderStatusSelect(order);
    toggleOrderPalletFields('edit-order');
    toggleOrderPalletExchange('edit-order');
    populateOrderCmrFields('edit-order', order);

    const dispatchBtn = document.getElementById('edit-order-dispatch-btn');
    if (dispatchBtn) {
        dispatchBtn.classList.toggle('hidden', !canShowDispatchButton(order));
        dispatchBtn.onclick = () => { closeEditOrderModal(); openDispatchModal(orderId); };
    }

    const modal = document.getElementById('edit-order-modal');
    modal.classList.remove('hidden');
    if (!modal.classList.contains('flex')) modal.classList.add('flex', 'items-center', 'justify-center');
}
window.populateEditOrderStatusSelect = populateEditOrderStatusSelect;
window.openEditOrderModal = openEditOrderModal;
window.openDispatchModal = openDispatchModal;
window.canShowDispatchButton = canShowDispatchButton;
window.isOrderSubcontracted = isOrderSubcontracted;
window.canEditPlanningOrder = canEditPlanningOrder;

function closeEditOrderModal() {
    hideAllModals();
}

async function submitEditOrder() {
    const orderId = parseInt(document.getElementById('edit-order-id').value, 10);
    const order = db.orders.find(o => o.id === orderId);

    if (order) {
        const assignment = getOrderAssignmentPayload('edit-order');
        const pallet = getOrderPalletPayload('edit-order');
        const cmr = getOrderCmrPayload('edit-order');
        const statusSelect = document.getElementById('edit-order-status');
        const statusLocked = statusSelect?.disabled || statusSelect?.classList.contains('hidden');
        const updatedStatus = statusLocked ? order.status : statusSelect.value;

        if (assignment.assignment_type === 'SUBCONTRACTED' && !assignment.subcontractor_id) {
            showToast('Veuillez sélectionner un sous-traitant', 'error');
            return;
        }
        if (assignment.assignment_type === 'SUBCONTRACTED' && !(assignment.purchase_price > 0)) {
            showToast('Indiquez le prix d\'achat pour l\'affrètement', 'error');
            return;
        }
        if (assignment.assignment_type === 'INTERNAL' && isOrderSubcontracted(order) && !assignment.driver_id) {
            showToast('Sélectionnez un chauffeur de votre flotte pour la réaffectation interne', 'error');
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
                ...pallet,
                ...cmr
            }
        });
        if (updatedStatus !== order.status) {
            await apiFetch(`transport-orders/${orderId}/status`, { method: 'POST', body: { status: updatedStatus } });
        }
        showToast('Commande mise à jour avec succès', 'success');
        closeEditOrderModal();
        if (typeof refreshAfterMvpStep === 'function') {
            await refreshAfterMvpStep({ orderId, step: 'create', route: 'planning', reopenDetail: false });
        } else {
            await fetchAllData();
            router('planning');
        }
    } else {
        showToast('Commande non trouvée', 'error');
    }
}

async function deleteOrder() {
    const orderId = parseInt(document.getElementById('edit-order-id').value, 10);
    const order = db.orders.find(o => o.id === orderId);
    if (!order) {
        showToast('Commande non trouvée', 'error');
        return;
    }
    if (typeof transportCanDelete === 'function' && !transportCanDelete(order)) {
        showToast('Ce transport ne peut pas être supprimé (Validé ou Clôturé)', 'error');
        return;
    }
    if (!confirm('Déplacer cette commande vers la corbeille ?')) return;

    try {
        const res = await apiFetch(`transport-orders/${orderId}`, { method: 'DELETE' });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            showToast(payload.error || 'Échec de la suppression', 'error');
            return;
        }
        showToast('Commande déplacée vers la corbeille', 'success');
        closeEditOrderModal();
        if (typeof fetchAllData === 'function') await fetchAllData();
        router('planning');
    } catch (e) {
        showToast('Erreur serveur', 'error');
    }
}
