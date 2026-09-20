/**
 * UX différée — DnD planning tactile, reporting hebdo, tours guidés.
 * Connecteurs comptables : formats côté Backend + UI export.
 */
(function () {
    const TOUR_KEY = 'flenova_guided_tours_v1';
    const WEEKLY_PREF_KEY = 'flenova_weekly_report_pref_v1';

    function companyKey(suffix) {
        const uid = (typeof getCurrentUser === 'function' ? getCurrentUser()?.company_id : null) || 'anon';
        return `${suffix}_${uid}`;
    }

    function readJson(key, fallback) {
        try {
            return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
        } catch {
            return fallback;
        }
    }

    function writeJson(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch { /* ignore */ }
    }

    function esc(v) {
        return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '');
    }

    // ═══════════════════════════════════════════════════════════════
    // Planning — drag & drop (souris + tactile)
    // ═══════════════════════════════════════════════════════════════
    let dndBusy = false;
    let touchState = null;

    function planningMonday() {
        const current = new Date(window.planningDate || new Date());
        const day = current.getDay();
        const diff = current.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(current);
        monday.setDate(diff);
        monday.setHours(0, 0, 0, 0);
        return monday;
    }

    function isoDateForDayName(dayName) {
        const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
        const idx = days.indexOf(dayName);
        if (idx < 0) return null;
        const d = planningMonday();
        d.setDate(d.getDate() + idx);
        return d.toISOString().slice(0, 10);
    }

    async function applyPlanningDrop({ orderId, loadDate, driverId }) {
        if (dndBusy || !orderId) return;
        const existing = (db.orders || []).find((o) => String(o.id) === String(orderId));
        if (existing && typeof canEditPlanningOrder === 'function' && !canEditPlanningOrder(existing)) {
            showToast('Ce transport ne peut plus être déplacé', 'error');
            return;
        }
        dndBusy = true;
        try {
            const body = {};
            if (loadDate) body.load_date = loadDate;
            if (driverId !== undefined) {
                if (driverId === null || driverId === '' || driverId === 'none') {
                    body.driver_id = null;
                } else {
                    body.driver_id = Number(driverId);
                    body.assignment_type = 'INTERNAL';
                }
            }
            if (!Object.keys(body).length) return;

            const res = await apiFetch(`transport-orders/${orderId}`, {
                method: 'PATCH',
                body
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showToast(err.error || err.message || 'Déplacement impossible', 'error');
                return;
            }
            showToast(
                loadDate && driverId !== undefined
                    ? 'Date et chauffeur mis à jour'
                    : loadDate
                        ? 'Date de chargement mise à jour'
                        : 'Chauffeur mis à jour',
                'success'
            );
            if (existing) {
                if (loadDate) existing.load_date = loadDate;
                if (driverId !== undefined) {
                    existing.driver_id = driverId === null || driverId === '' || driverId === 'none' ? null : Number(driverId);
                    if (existing.driver_id) {
                        const d = (db.drivers || []).find((x) => x.id === existing.driver_id);
                        existing.driver_name = d?.name || existing.driver_name;
                        existing.assignment_type = 'INTERNAL';
                    } else {
                        existing.driver_name = null;
                    }
                }
            }
            if (typeof router === 'function') router('planning');
        } catch (e) {
            showToast(e.message || 'Erreur réseau', 'error');
        } finally {
            dndBusy = false;
        }
    }

    function clearDropHighlights() {
        document.querySelectorAll('.planning-drop-active').forEach((el) => {
            el.classList.remove('planning-drop-active');
        });
    }

    function resolveDropTarget(el) {
        if (!el || !el.closest) return null;
        const dayZone = el.closest('[data-drop-day]');
        if (dayZone) {
            return { loadDate: isoDateForDayName(dayZone.getAttribute('data-drop-day')) };
        }
        const driverZone = el.closest('[data-drop-driver]');
        if (driverZone) {
            const raw = driverZone.getAttribute('data-drop-driver');
            return { driverId: raw === 'none' ? null : raw };
        }
        return null;
    }

    window.initPlanningDnD = function () {
        const root = document.getElementById('app-content') || document;
        const cards = root.querySelectorAll('[data-planning-order-id][data-planning-draggable="1"]');
        if (!cards.length) return;

        cards.forEach((card) => {
            if (card.dataset.dndBound) return;
            card.dataset.dndBound = '1';
            card.setAttribute('draggable', 'true');

            card.addEventListener('dragstart', (e) => {
                const id = card.getAttribute('data-planning-order-id');
                e.dataTransfer.setData('text/plain', id);
                e.dataTransfer.effectAllowed = 'move';
                card.classList.add('opacity-60');
                card.dataset.wasDragged = '1';
            });
            card.addEventListener('dragend', () => {
                card.classList.remove('opacity-60');
                clearDropHighlights();
                setTimeout(() => { card.dataset.wasDragged = '0'; }, 120);
            });

            // Tactile — long-press 200 ms puis drag (évite conflit scroll)
            card.addEventListener('touchstart', (e) => {
                if (e.touches.length !== 1) return;
                const t = e.touches[0];
                const orderId = card.getAttribute('data-planning-order-id');
                touchState = {
                    orderId,
                    startX: t.clientX,
                    startY: t.clientY,
                    moved: false,
                    armed: false,
                    ghost: null,
                    holdTimer: null
                };
                touchState.holdTimer = setTimeout(() => {
                    if (touchState && touchState.orderId === orderId) {
                        touchState.armed = true;
                        card.classList.add('ring-2', 'ring-indigo-400');
                        if (navigator.vibrate) try { navigator.vibrate(12); } catch { /* ignore */ }
                    }
                }, 200);
            }, { passive: true });

            card.addEventListener('touchmove', (e) => {
                if (!touchState || touchState.orderId !== card.getAttribute('data-planning-order-id')) return;
                const t = e.touches[0];
                const dx = t.clientX - touchState.startX;
                const dy = t.clientY - touchState.startY;
                const dist = Math.hypot(dx, dy);

                // Annule le long-press si l'utilisateur scrolle avant 200 ms
                if (!touchState.armed) {
                    if (dist > 10 && touchState.holdTimer) {
                        clearTimeout(touchState.holdTimer);
                        touchState.holdTimer = null;
                        touchState = null;
                    }
                    return;
                }

                if (!touchState.moved && dist < 8) return;
                touchState.moved = true;
                card.dataset.wasDragged = '1';
                if (e.cancelable) e.preventDefault();

                if (!touchState.ghost) {
                    const ghost = card.cloneNode(true);
                    ghost.id = 'planning-dnd-ghost';
                    ghost.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;opacity:0.9;width:180px;box-shadow:0 8px 24px rgba(0,0,0,.2);border-radius:8px;background:#fff;';
                    document.body.appendChild(ghost);
                    touchState.ghost = ghost;
                }
                touchState.ghost.style.left = `${t.clientX - 90}px`;
                touchState.ghost.style.top = `${t.clientY - 24}px`;

                clearDropHighlights();
                const under = document.elementFromPoint(t.clientX, t.clientY);
                const zone = under?.closest?.('[data-drop-day],[data-drop-driver]');
                if (zone) zone.classList.add('planning-drop-active');
            }, { passive: false });

            card.addEventListener('touchend', async (e) => {
                if (!touchState) return;
                const state = touchState;
                touchState = null;
                if (state.holdTimer) clearTimeout(state.holdTimer);
                card.classList.remove('ring-2', 'ring-indigo-400');
                if (state.ghost) state.ghost.remove();
                clearDropHighlights();
                if (!state.armed || !state.moved) return;
                const t = e.changedTouches[0];
                const under = document.elementFromPoint(t.clientX, t.clientY);
                const drop = resolveDropTarget(under);
                if (drop) await applyPlanningDrop({ orderId: state.orderId, ...drop });
            });

            card.addEventListener('touchcancel', () => {
                if (!touchState) return;
                if (touchState.holdTimer) clearTimeout(touchState.holdTimer);
                if (touchState.ghost) touchState.ghost.remove();
                card.classList.remove('ring-2', 'ring-indigo-400');
                clearDropHighlights();
                touchState = null;
            });

            // Click détail : ignorer si drag
            card.addEventListener('click', (e) => {
                if (card.dataset.wasDragged === '1') {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }, true);
        });

        root.querySelectorAll('[data-drop-day],[data-drop-driver]').forEach((zone) => {
            if (zone.dataset.dropBound) return;
            zone.dataset.dropBound = '1';
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                zone.classList.add('planning-drop-active');
            });
            zone.addEventListener('dragleave', () => zone.classList.remove('planning-drop-active'));
            zone.addEventListener('drop', async (e) => {
                e.preventDefault();
                zone.classList.remove('planning-drop-active');
                const orderId = e.dataTransfer.getData('text/plain');
                const drop = resolveDropTarget(zone);
                if (orderId && drop) await applyPlanningDrop({ orderId, ...drop });
            });
        });
    };

    // ═══════════════════════════════════════════════════════════════
    // Reporting — export Excel (CSV) CA / marge ST / occupation
    // ═══════════════════════════════════════════════════════════════
    function weekBounds(refDate = new Date()) {
        const d = new Date(refDate);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d);
        monday.setDate(diff);
        monday.setHours(0, 0, 0, 0);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        sunday.setHours(23, 59, 59, 999);
        return { monday, sunday };
    }

    function computeWeeklyKpis(from = weekBounds().monday, to = weekBounds().sunday) {
        const orders = (db.orders || []).filter((o) => {
            const d = new Date(o.load_date || o.date_chargement || o.delivery_date || 0);
            return d >= from && d <= to;
        });
        const invoices = (db.sales_invoices || []).filter((inv) => {
            const d = new Date(inv.date || inv.invoice_date || inv.created_at || 0);
            return d >= from && d <= to && !String(inv.status || '').toLowerCase().includes('annul');
        });

        const ca = invoices.reduce((s, inv) => s + (Number(inv.amount) || 0), 0)
            || orders.reduce((s, o) => s + (Number(o.price) || 0), 0);
        const stOrders = orders.filter((o) =>
            o.assignment_type === 'SUBCONTRACTED' || o.status === 'Affrété' || o.subcontractor_id
        );
        const stPurchase = stOrders.reduce((s, o) => s + (Number(o.purchase_price) || 0), 0);
        const stRevenue = stOrders.reduce((s, o) => s + (Number(o.price) || 0), 0);
        const margeSt = stRevenue - stPurchase;
        const drivers = (db.drivers || []).filter((d) => d.status !== 'Inactif');
        const assignedDriverIds = new Set(
            orders.filter((o) => o.driver_id).map((o) => o.driver_id)
        );
        const occupation = drivers.length
            ? Math.round((assignedDriverIds.size / drivers.length) * 100)
            : 0;

        return {
            from: from.toISOString().slice(0, 10),
            to: to.toISOString().slice(0, 10),
            orderCount: orders.length,
            ca,
            margeSt,
            stCount: stOrders.length,
            occupation,
            driverCount: drivers.length,
            assignedDrivers: assignedDriverIds.size,
            lines: orders.map((o) => ({
                ref: o.ref || o.id,
                client: o.client_name || '',
                load: (o.load_date || '').toString().slice(0, 10),
                status: o.status || '',
                price: Number(o.price) || 0,
                purchase: Number(o.purchase_price) || 0,
                margin: (Number(o.price) || 0) - (Number(o.purchase_price) || 0),
                mode: o.assignment_type === 'SUBCONTRACTED' ? 'ST' : 'Interne'
            }))
        };
    }

    function downloadCsv(filename, rows) {
        const sep = ';';
        const escape = (v) => {
            const s = String(v ?? '');
            if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
            return s;
        };
        const csv = `\uFEFF${rows.map((r) => r.map(escape).join(sep)).join('\r\n')}`;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    window.exportWeeklyExcelReport = async function () {
        const kpi = computeWeeklyKpis();

        try {
            const res = await apiFetch('dashboard/report/export', {
                method: 'POST',
                body: {
                    startDate: kpi.from,
                    endDate: kpi.to,
                    reportName: `Rapport hebdo ${kpi.from} → ${kpi.to}`,
                    format: 'xlsx'
                }
            });
            if (res.ok) {
                const blob = await res.blob();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `flenova_rapport_hebdo_${kpi.from}_${kpi.to}.xlsx`;
                a.click();
                URL.revokeObjectURL(a.href);
                showToast('Export Excel (.xlsx) téléchargé', 'success');
                return;
            }
        } catch { /* fallback local CSV */ }

        const rows = [
            ['Rapport hebdomadaire Flenova'],
            ['Période', `${kpi.from} → ${kpi.to}`],
            ['CA HT (€)', String(kpi.ca).replace('.', ',')],
            ['Marge sous-traitance (€)', String(kpi.margeSt).replace('.', ',')],
            ['Taux occupation chauffeurs (%)', String(kpi.occupation)],
            ['Chauffeurs affectés / total', `${kpi.assignedDrivers} / ${kpi.driverCount}`],
            ['Nb OT', String(kpi.orderCount)],
            ['Nb OT affrétés', String(kpi.stCount)],
            [],
            ['Réf', 'Client', 'Chargement', 'Statut', 'Mode', 'Prix HT', 'Achat ST', 'Marge']
        ];
        kpi.lines.forEach((l) => {
            rows.push([
                l.ref, l.client, l.load, l.status, l.mode,
                String(l.price).replace('.', ','),
                String(l.purchase).replace('.', ','),
                String(l.margin).replace('.', ',')
            ]);
        });
        downloadCsv(`flenova_rapport_hebdo_${kpi.from}_${kpi.to}.csv`, rows);
        showToast('Export CSV (fallback) téléchargé', 'info');
    };

    window.getWeeklyReportPref = function () {
        return readJson(companyKey(WEEKLY_PREF_KEY), { enabled: false, email: '' });
    };

    window.saveWeeklyReportPref = async function () {
        const enabled = document.getElementById('weekly-report-enabled')?.checked;
        const email = document.getElementById('weekly-report-email')?.value?.trim() || '';
        const pref = { enabled: Boolean(enabled), email, updatedAt: new Date().toISOString() };
        writeJson(companyKey(WEEKLY_PREF_KEY), pref);

        try {
            await apiFetch('reports/weekly-prefs', {
                method: 'PUT',
                body: pref
            });
        } catch { /* backend optionnel */ }

        showToast(
            pref.enabled
                ? `Envoi hebdo activé${pref.email ? ` → ${pref.email}` : ''}`
                : 'Envoi hebdo désactivé',
            'success'
        );
    };

    window.emailWeeklyReportNow = async function () {
        const pref = getWeeklyReportPref();
        const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
        const to = pref.email || user?.email;
        if (!to) {
            showToast('Indiquez un e-mail destinataire', 'error');
            return;
        }

        try {
            const res = await apiFetch('reports/weekly/send-now', {
                method: 'POST',
                body: { email: to }
            });
            if (res.ok) {
                showToast('Rapport hebdo envoyé par e-mail', 'success');
                return;
            }
        } catch { /* fallback mailto */ }

        const kpi = computeWeeklyKpis();
        const subject = encodeURIComponent(`Rapport hebdo Flenova ${kpi.from} → ${kpi.to}`);
        const body = encodeURIComponent(
            `CA HT : ${kpi.ca} €\nMarge ST : ${kpi.margeSt} €\nOccupation : ${kpi.occupation} %\nOT : ${kpi.orderCount}\n\n(Export CSV disponible depuis le tableau de bord.)`
        );
        window.open(`mailto:${to}?subject=${subject}&body=${body}`, '_blank');
        showToast('Ouverture du client mail (SMTP indisponible)', 'info');
    };

    window.renderWeeklyReportPanel = function () {
        const pref = getWeeklyReportPref();
        const kpi = computeWeeklyKpis();
        const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
        return `
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4" id="weekly-report-panel">
                <div class="flex flex-wrap justify-between gap-3 items-start">
                    <div>
                        <h3 class="font-bold text-gray-800 text-sm"><i class="fa-solid fa-chart-line text-indigo-600 mr-2"></i>Pilotage hebdo</h3>
                        <p class="text-xs text-gray-500 mt-0.5">${esc(kpi.from)} → ${esc(kpi.to)} · CA ${Number(kpi.ca).toLocaleString('fr-FR')} € · Marge ST ${Number(kpi.margeSt).toLocaleString('fr-FR')} € · Occup. ${kpi.occupation} %</p>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <button type="button" onclick="exportWeeklyExcelReport()" class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
                            <i class="fa-solid fa-file-excel mr-1"></i>Export Excel
                        </button>
                        <button type="button" onclick="emailWeeklyReportNow()" class="px-3 py-1.5 text-xs font-semibold rounded-lg border border-indigo-200 text-indigo-800 hover:bg-indigo-50">
                            <i class="fa-solid fa-envelope mr-1"></i>Envoyer maintenant
                        </button>
                    </div>
                </div>
                <div class="mt-3 flex flex-wrap items-end gap-3 border-t pt-3">
                    <label class="flex items-center gap-2 text-xs text-gray-700">
                        <input type="checkbox" id="weekly-report-enabled" ${pref.enabled ? 'checked' : ''}>
                        E-mail automatique chaque lundi
                    </label>
                    <label class="text-xs text-gray-500 flex-1 min-w-[12rem]">
                        Destinataire
                        <input type="email" id="weekly-report-email" value="${esc(pref.email || user?.email || '')}"
                            class="block w-full mt-0.5 border rounded-lg px-2 py-1.5 text-sm" placeholder="direction@entreprise.fr">
                    </label>
                    <button type="button" onclick="saveWeeklyReportPref()" class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-800 text-white hover:bg-gray-900">
                        Enregistrer
                    </button>
                </div>
            </div>`;
    };

    // ═══════════════════════════════════════════════════════════════
    // Tours guidés (spotlight)
    // ═══════════════════════════════════════════════════════════════
    function getTourState() {
        return readJson(companyKey(TOUR_KEY), {});
    }

    function markTourDone(id) {
        const st = getTourState();
        st[id] = true;
        writeJson(companyKey(TOUR_KEY), st);
    }

    const TOURS = {
        first_order: {
            id: 'first_order',
            title: 'Créer votre premier OT',
            steps: [
                { sel: '[data-tour="first_order_cta"], #app-action-rail button, [onclick*="openAddOrderModal"]', text: 'Cliquez sur « Créer OT » pour ouvrir le formulaire d’ordre de transport.' },
                { sel: '[data-tour="order_templates"], #order-template-select, #add-order-modal', text: 'Renseignez client, trajet et dates. Vous pouvez aussi appliquer un modèle récurrent.' },
                { sel: '[data-tour="order_submit"], #add-order-modal button[type="submit"], #add-order-modal .bg-blue-600', text: 'Enregistrez — l’OT apparaît ensuite dans Transports et Planning.' }
            ]
        },
        first_affretement: {
            id: 'first_affretement',
            title: 'Premier affrètement',
            steps: [
                { sel: '[data-tour="nav_affretement"], [onclick*="chartered_transports"], [data-nav-route="chartered_transports"]', text: 'Ouvrez « Affréter » pour les transports à sous-traiter.' },
                { sel: '[data-tour="dispatch_action"], [onclick*="openDispatchModal"], .fa-handshake', text: 'Choisissez un OT puis Affréter — vérifiez le quota (≥ 80 % = alerte coût).' },
                { sel: '[data-tour="notifications"], #notification-center-btn, [onclick*="pricing"]', text: 'Le centre de notifications rappelle le quota et les ST expirants.' }
            ]
        },
        first_invoice: {
            id: 'first_invoice',
            title: 'Première préfacture',
            steps: [
                { sel: '[data-tour="nav_prefacture"], [onclick*="preinvoicing"], [data-nav-route="preinvoicing"]', text: 'Allez dans « À préfacturer » pour les livraisons non facturées.' },
                { sel: '[data-tour="prefacture_bulk"], #prefacture-bulk-btn, #prefacture-select-all, [onclick*="bulkCreateInvoiceDrafts"]', text: 'Filtrez par client/période, cochez plusieurs OT et validez en masse.' },
                { sel: '[data-tour="nav_accounting"], [data-nav-route="accounting_export"], [onclick*="accounting_export"]', text: 'Exportez ensuite le CSV comptable pour l’importer dans votre logiciel de comptabilité.' }
            ]
        }
    };

    function removeTourOverlay() {
        document.getElementById('guided-tour-overlay')?.remove();
    }

    function highlightEl(sel) {
        const el = document.querySelector(sel);
        if (!el) return null;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const rect = el.getBoundingClientRect();
        return rect;
    }

    window.startGuidedTour = function (tourId) {
        const tour = TOURS[tourId];
        if (!tour) return;
        removeTourOverlay();
        let step = 0;

        const render = () => {
            removeTourOverlay();
            if (step >= tour.steps.length) {
                markTourDone(tour.id);
                showToast(`Tour « ${tour.title} » terminé`, 'success');
                return;
            }
            const s = tour.steps[step];
            const rect = highlightEl(s.sel);
            const overlay = document.createElement('div');
            overlay.id = 'guided-tour-overlay';
            overlay.className = 'guided-tour-overlay';
            const hole = rect
                ? `clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.left - 8}px ${rect.top - 8}px, ${rect.left - 8}px ${rect.bottom + 8}px, ${rect.right + 8}px ${rect.bottom + 8}px, ${rect.right + 8}px ${rect.top - 8}px, ${rect.left - 8}px ${rect.top - 8}px);`
                : '';
            overlay.innerHTML = `
                <div class="guided-tour-backdrop" style="${hole}"></div>
                ${rect ? `<div class="guided-tour-spotlight" style="top:${rect.top - 8}px;left:${rect.left - 8}px;width:${rect.width + 16}px;height:${rect.height + 16}px"></div>` : ''}
                <div class="guided-tour-card">
                    <p class="text-xs font-bold uppercase text-indigo-600 mb-1">${esc(tour.title)} · ${step + 1}/${tour.steps.length}</p>
                    <p class="text-sm text-gray-800 mb-4">${esc(s.text)}</p>
                    <div class="flex justify-between gap-2">
                        <button type="button" class="text-xs text-gray-500 hover:underline" data-tour-skip>Passer</button>
                        <div class="flex gap-2">
                            ${step > 0 ? '<button type="button" class="px-3 py-1.5 text-xs rounded border" data-tour-prev>Précédent</button>' : ''}
                            <button type="button" class="px-3 py-1.5 text-xs rounded bg-indigo-600 text-white" data-tour-next>
                                ${step === tour.steps.length - 1 ? 'Terminer' : 'Suivant'}
                            </button>
                        </div>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            overlay.querySelector('[data-tour-skip]').onclick = () => {
                markTourDone(tour.id);
                removeTourOverlay();
            };
            overlay.querySelector('[data-tour-prev]')?.addEventListener('click', () => {
                step -= 1;
                render();
            });
            overlay.querySelector('[data-tour-next]').onclick = () => {
                step += 1;
                render();
            };
        };

        // Navigation contextuelle avant le tour
        if (tourId === 'first_order') {
            if (typeof router === 'function') router('dashboard');
        } else if (tourId === 'first_affretement') {
            if (typeof router === 'function') router('chartered_transports');
        } else if (tourId === 'first_invoice') {
            if (typeof router === 'function') router('preinvoicing');
        }
        setTimeout(render, 350);
    };

    window.offerGuidedToursIfNeeded = function () {
        const st = getTourState();
        const host = document.getElementById('onboarding-checklist-mount');
        if (!host || st.tours_offered) return;
        const hasOrder = (db.orders || []).length > 0;
        if (hasOrder && st.first_order) return;

        // Propose once via small buttons under checklist — injected by enhanceOnboarding
    };

    window.enhanceOnboardingWithTours = function () {
        const host = document.getElementById('onboarding-checklist');
        if (!host || host.querySelector('.tour-launchers')) return;
        const st = getTourState();
        const bar = document.createElement('div');
        bar.className = 'tour-launchers mt-3 pt-3 border-t border-blue-100 flex flex-wrap gap-2';
        bar.innerHTML = `
            <span class="text-[10px] uppercase font-bold text-blue-700 w-full">Tours guidés</span>
            ${!st.first_order ? `<button type="button" onclick="startGuidedTour('first_order')" class="text-xs px-2 py-1 rounded bg-white border border-blue-200 text-blue-800">1er OT</button>` : ''}
            ${!st.first_affretement ? `<button type="button" onclick="startGuidedTour('first_affretement')" class="text-xs px-2 py-1 rounded bg-white border border-blue-200 text-blue-800">1er affrètement</button>` : ''}
            ${!st.first_invoice ? `<button type="button" onclick="startGuidedTour('first_invoice')" class="text-xs px-2 py-1 rounded bg-white border border-blue-200 text-blue-800">1ère facture</button>` : ''}
        `;
        if (bar.querySelectorAll('button').length) host.appendChild(bar);
    };

    // Hook après init UX
    const prevInit = window.initUxImprovements;
    window.initUxImprovements = function () {
        if (typeof prevInit === 'function') prevInit();
        setTimeout(() => enhanceOnboardingWithTours(), 100);
    };

    // Raccourcis clavier N / ? /
    document.addEventListener('keydown', (e) => {
        const tag = (e.target && e.target.tagName) || '';
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target?.isContentEditable) return;
        if (!window.isAuthenticated && typeof isAuthenticated !== 'undefined' && !isAuthenticated) return;
        if (e.key === 'n' || e.key === 'N') {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (typeof canWriteTransport === 'function' && !canWriteTransport()) return;
            e.preventDefault();
            if (typeof openAddOrderModal === 'function') openAddOrderModal();
        } else if (e.key === '/') {
            e.preventDefault();
            if (typeof toggleMobileGlobalSearch === 'function') toggleMobileGlobalSearch();
            else document.getElementById('global-search-input')?.focus();
        } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
            e.preventDefault();
            document.getElementById('keyboard-help-modal')?.classList.remove('hidden');
        } else if (e.key === 'Escape') {
            document.getElementById('keyboard-help-modal')?.classList.add('hidden');
            document.getElementById('notification-center-panel')?.classList.add('hidden');
            document.getElementById('global-search-results')?.classList.add('hidden');
            if (typeof closeMobileGlobalSearch === 'function') closeMobileGlobalSearch();
            if (typeof closeAccountMenu === 'function') closeAccountMenu();
        }
    });
})();
