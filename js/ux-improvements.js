/**
 * Améliorations UX — templates OT, recherche globale, notifications, onboarding, densité UI
 */
(function () {
    const TEMPLATE_KEY = 'flenova_order_templates_v1';
    const ONBOARDING_KEY = 'flenova_onboarding_checklist_v1';
    const DENSITY_KEY = 'flenova_ui_density';
    const CANCEL_KEY = 'flenova_cancellation_request';

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

    // ── Templates d'ordres ──────────────────────────────────────────
    function getOrderTemplates() {
        return readJson(companyKey(TEMPLATE_KEY), []);
    }

    function saveOrderTemplates(list) {
        writeJson(companyKey(TEMPLATE_KEY), list.slice(0, 20));
    }

    function collectOrderFormSnapshot() {
        const val = (id) => document.getElementById(id)?.value ?? '';
        return {
            client_id: val('add-order-client'),
            origin: val('add-order-origin'),
            dest: val('add-order-dest'),
            price: val('add-order-price'),
            cargo: val('add-order-cargo'),
            transport_mode: val('add-order-transport-mode'),
            weight: val('add-order-weight'),
            volume: val('add-order-volume'),
            pallets: val('add-order-pallets'),
            notes: val('add-order-notes'),
            assignment_type: document.getElementById('add-order-assignment-type')?.value || 'INTERNAL'
        };
    }

    window.saveCurrentOrderAsTemplate = function () {
        const name = prompt('Nom du modèle d\'ordre récurrent :');
        if (!name || !name.trim()) return;
        const snap = collectOrderFormSnapshot();
        if (!snap.origin || !snap.dest) {
            showToast('Renseignez au moins chargement et livraison', 'error');
            return;
        }
        const list = getOrderTemplates();
        list.unshift({
            id: `tpl_${Date.now()}`,
            name: name.trim(),
            createdAt: new Date().toISOString(),
            data: snap
        });
        saveOrderTemplates(list);
        refreshOrderTemplateSelect();
        showToast('Modèle enregistré', 'success');
    };

    window.applyOrderTemplate = function (templateId) {
        const tpl = getOrderTemplates().find((t) => t.id === templateId);
        if (!tpl) return;
        const d = tpl.data || {};
        if (typeof openAddOrderModal === 'function') {
            openAddOrderModal({
                client_id: d.client_id,
                origin: d.origin,
                dest: d.dest,
                price: d.price,
                cargo: d.cargo,
                notes: d.notes
            });
        }
        const set = (id, v) => {
            const el = document.getElementById(id);
            if (el && v != null && v !== '') el.value = v;
        };
        set('add-order-transport-mode', d.transport_mode);
        set('add-order-weight', d.weight);
        set('add-order-volume', d.volume);
        set('add-order-pallets', d.pallets);
        showToast(`Modèle « ${tpl.name} » appliqué — ajustez les dates`, 'info');
    };

    window.deleteOrderTemplate = function (templateId) {
        if (!confirm('Supprimer ce modèle ?')) return;
        saveOrderTemplates(getOrderTemplates().filter((t) => t.id !== templateId));
        refreshOrderTemplateSelect();
        showToast('Modèle supprimé', 'success');
    };

    function refreshOrderTemplateSelect() {
        const sel = document.getElementById('order-template-select');
        if (!sel) return;
        const list = getOrderTemplates();
        const esc = typeof escapeHtml === 'function' ? escapeHtml : (v) => String(v ?? '');
        sel.innerHTML = `<option value="">Modèle récurrent…</option>` +
            list.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    }

    window.onOrderTemplateSelect = function () {
        const sel = document.getElementById('order-template-select');
        if (sel?.value) applyOrderTemplate(sel.value);
    };

    // ── Recherche globale ───────────────────────────────────────────
    function searchGlobal(query) {
        const q = String(query || '').trim().toLowerCase();
        if (q.length < 2) return [];
        const results = [];
        const push = (type, label, route, meta) => {
            results.push({ type, label, route, meta });
        };

        (db.orders || []).forEach((o) => {
            const hay = `${o.ref || ''} ${o.id} ${o.client_name || ''} ${o.origin || ''} ${o.dest || ''}`.toLowerCase();
            if (hay.includes(q)) {
                push('OT', o.ref || `#${o.id}`, () => {
                    if (typeof openTransportDetail === 'function') openTransportDetail(o.id);
                    else router('transports');
                }, o.status);
            }
        });
        (db.clients || []).forEach((c) => {
            const hay = `${c.name || ''} ${c.siret || ''} ${c.email || ''}`.toLowerCase();
            if (hay.includes(q)) {
                push('Client', c.name, () => router('clients'), c.siret || '');
            }
        });
        (db.sales_invoices || []).forEach((inv) => {
            const hay = `${inv.invoice_number || ''} ${inv.id} ${inv.client_name || ''}`.toLowerCase();
            if (hay.includes(q)) {
                push('Facture', inv.invoice_number || inv.id, () => {
                    if (inv.status === 'Brouillon' || inv.status === 'Draft') router('sales_invoices_draft');
                    else router('sales_invoices');
                }, inv.status);
            }
        });
        (db.vehicles || []).forEach((v) => {
            const hay = `${v.plate || ''} ${v.brand || ''} ${v.model || ''}`.toLowerCase();
            if (hay.includes(q)) {
                push('Véhicule', v.plate || v.id, () => router('fleet'), v.brand || '');
            }
        });
        (db.drivers || []).forEach((d) => {
            const hay = `${d.name || ''} ${d.phone || ''}`.toLowerCase();
            if (hay.includes(q)) {
                push('Chauffeur', d.name, () => router('drivers'), d.phone || '');
            }
        });

        return results.slice(0, 12);
    }

    window.renderGlobalSearchResults = function (query) {
        const box = document.getElementById('global-search-results');
        if (!box) return;
        const results = searchGlobal(query);
        const esc = typeof escapeHtml === 'function' ? escapeHtml : (v) => String(v ?? '');
        if (!query || query.trim().length < 2) {
            box.classList.add('hidden');
            box.innerHTML = '';
            return;
        }
        if (!results.length) {
            box.innerHTML = `<p class="px-3 py-2 text-sm text-gray-500">Aucun résultat</p>`;
            box.classList.remove('hidden');
            return;
        }
        box.innerHTML = results.map((r, i) => `
            <button type="button" class="global-search-item w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center gap-2 border-b border-gray-50 last:border-0"
                data-idx="${i}">
                <span class="text-[10px] uppercase font-bold text-gray-400 w-14 shrink-0">${esc(r.type)}</span>
                <span class="text-sm text-gray-800 truncate flex-1">${esc(r.label)}</span>
                <span class="text-xs text-gray-400 truncate max-w-[7rem]">${esc(r.meta || '')}</span>
            </button>
        `).join('');
        box._results = results;
        box.classList.remove('hidden');
        box.querySelectorAll('.global-search-item').forEach((btn) => {
            btn.addEventListener('click', () => {
                const item = box._results?.[Number(btn.dataset.idx)];
                box.classList.add('hidden');
                document.getElementById('global-search-input').value = '';
                if (typeof item?.route === 'function') item.route();
            });
        });
    };

    // ── Centre de notifications ─────────────────────────────────────
    function buildNotifications() {
        const items = [];
        const now = Date.now();
        const day = 86400000;

        (db.subcontractors || []).forEach((s) => {
            ['rc_pro_expiry', 'urssaf_expiry', 'kbis_expiry'].forEach((field) => {
                if (!s[field]) return;
                const exp = new Date(s[field]).getTime();
                if (Number.isNaN(exp)) return;
                const label = field === 'rc_pro_expiry' ? 'RC Pro' : field === 'urssaf_expiry' ? 'URSSAF' : 'KBIS';
                if (exp < now) {
                    items.push({
                        tone: 'danger',
                        title: `${s.name} — ${label} expiré`,
                        action: () => router('subcontractors')
                    });
                } else if (exp < now + 30 * day) {
                    items.push({
                        tone: 'warning',
                        title: `${s.name} — ${label} expire bientôt`,
                        action: () => router('subcontractors')
                    });
                }
            });
        });

        const aff = window.cachedSubscription?.affretementUsage;
        if (aff?.limit != null) {
            const used = aff.sendsThisMonth || 0;
            if (used >= aff.limit) {
                items.push({
                    tone: 'warning',
                    title: `Quota affrètement atteint (${used}/${aff.limit}) — envois hors quota facturés`,
                    action: () => router('pricing')
                });
            } else if (used >= Math.ceil(aff.limit * 0.8)) {
                items.push({
                    tone: 'info',
                    title: `Quota affrètement à ${used}/${aff.limit} (≥ 80 %)`,
                    action: () => router('pricing')
                });
            }
        }

        if (window.cachedSubscription?.isOverdue || window.cachedSubscription?.status === 'past_due') {
            items.push({
                tone: 'danger',
                title: 'Facture d\'abonnement en retard',
                action: () => router('pricing')
            });
        }

        const toPrefacture = (db.orders || []).filter((o) => o.status === 'Validé' && !o.invoice_draft_id).length;
        if (toPrefacture > 0) {
            items.push({
                tone: 'info',
                title: `${toPrefacture} transport(s) à préfacturer`,
                action: () => router('preinvoicing')
            });
        }

        return items.slice(0, 15);
    }

    window.toggleNotificationCenter = function () {
        const panel = document.getElementById('notification-center-panel');
        if (!panel) return;
        if (!panel.classList.contains('hidden')) {
            panel.classList.add('hidden');
            return;
        }
        const items = buildNotifications();
        const esc = typeof escapeHtml === 'function' ? escapeHtml : (v) => String(v ?? '');
        const toneClass = {
            danger: 'border-l-red-500 bg-red-50',
            warning: 'border-l-amber-500 bg-amber-50',
            info: 'border-l-blue-500 bg-blue-50'
        };
        panel.innerHTML = `
            <div class="p-3 border-b flex justify-between items-center">
                <span class="text-sm font-bold text-gray-800">Notifications</span>
                <span class="text-xs text-gray-500">${items.length}</span>
            </div>
            <div class="max-h-80 overflow-y-auto">
                ${items.length ? items.map((it, i) => `
                    <button type="button" class="notif-item w-full text-left px-3 py-2.5 border-l-4 ${toneClass[it.tone] || toneClass.info} hover:brightness-95"
                        data-idx="${i}">
                        <span class="text-sm text-gray-800">${esc(it.title)}</span>
                    </button>
                `).join('') : `<p class="px-3 py-6 text-sm text-gray-500 text-center">Rien à signaler</p>`}
            </div>`;
        panel._items = items;
        panel.querySelectorAll('.notif-item').forEach((btn) => {
            btn.addEventListener('click', () => {
                const item = panel._items?.[Number(btn.dataset.idx)];
                panel.classList.add('hidden');
                if (typeof item?.action === 'function') item.action();
            });
        });
        panel.classList.remove('hidden');
        const badge = document.getElementById('notification-badge');
        if (badge) {
            badge.textContent = String(items.length);
            badge.classList.toggle('hidden', items.length === 0);
        }
    };

    window.refreshNotificationBadge = function () {
        const badge = document.getElementById('notification-badge');
        if (!badge) return;
        const n = buildNotifications().length;
        badge.textContent = String(n);
        badge.classList.toggle('hidden', n === 0);
    };

    // ── Onboarding checklist ────────────────────────────────────────
    function getOnboardingState() {
        return readJson(companyKey(ONBOARDING_KEY), {});
    }

    function markOnboarding(step) {
        const st = getOnboardingState();
        st[step] = true;
        writeJson(companyKey(ONBOARDING_KEY), st);
        renderOnboardingChecklist();
    }

    window.dismissOnboardingChecklist = function () {
        writeJson(companyKey(ONBOARDING_KEY), { ...getOnboardingState(), dismissed: true });
        document.getElementById('onboarding-checklist')?.remove();
    };

    function renderOnboardingChecklist() {
        const host = document.getElementById('onboarding-checklist-mount');
        if (!host) return;
        const st = getOnboardingState();
        if (st.dismissed) {
            host.innerHTML = '';
            return;
        }
        const steps = [
            { id: 'order', label: 'Créer un premier ordre de transport', go: () => openAddOrderModal() },
            { id: 'assign', label: 'Affecter un chauffeur ou affréter', go: () => router('planning') },
            { id: 'invoice', label: 'Générer une préfacture', go: () => router('preinvoicing') },
            { id: 'pricing', label: 'Vérifier mon forfait / quotas', go: () => router('pricing') }
        ];
        // Auto-detect progress from data
        if ((db.orders || []).length) st.order = true;
        if ((db.orders || []).some((o) => o.driver_id || o.subcontractor_id || o.assignment_type === 'SUBCONTRACTED')) st.assign = true;
        if ((db.orders || []).some((o) => o.invoice_draft_id) || (db.sales_invoices || []).length) st.invoice = true;
        if (window.cachedSubscription?.plan) st.pricing = true;
        writeJson(companyKey(ONBOARDING_KEY), st);

        const done = steps.filter((s) => st[s.id]).length;
        if (done >= steps.length) {
            host.innerHTML = '';
            return;
        }

        host.innerHTML = `
            <div id="onboarding-checklist" class="mb-4 rounded-xl border border-blue-100 bg-blue-50/80 p-4">
                <div class="flex justify-between items-start gap-2 mb-2">
                    <div>
                        <p class="text-sm font-bold text-blue-900">Démarrage rapide (${done}/${steps.length})</p>
                        <p class="text-xs text-blue-800/80">Checklist pour activer votre essai en conditions réelles</p>
                    </div>
                    <button type="button" onclick="dismissOnboardingChecklist()" class="text-xs text-blue-700 hover:underline">Masquer</button>
                </div>
                <ul class="space-y-1.5">
                    ${steps.map((s) => `
                        <li>
                            <button type="button" class="w-full flex items-center gap-2 text-left text-sm px-2 py-1.5 rounded hover:bg-white/70 ${st[s.id] ? 'text-green-700' : 'text-blue-900'}"
                                onclick="(${st[s.id] ? 'null' : `() => { (${s.go.toString()})(); }`} )()">
                                <i class="fa-solid ${st[s.id] ? 'fa-circle-check' : 'fa-circle'} w-4"></i>
                                <span class="${st[s.id] ? 'line-through opacity-70' : ''}">${s.label}</span>
                            </button>
                        </li>
                    `).join('')}
                </ul>
            </div>`;

        // Fix onclick handlers properly
        host.querySelectorAll('ul button').forEach((btn, i) => {
            const step = steps[i];
            if (!step || st[step.id]) return;
            btn.onclick = () => step.go();
        });
    }

    // ── Densité UI ──────────────────────────────────────────────────
    window.applyUiDensity = function (mode) {
        const m = mode === 'compact' ? 'compact' : 'comfortable';
        document.body.classList.toggle('ui-density-compact', m === 'compact');
        document.body.classList.toggle('ui-density-comfortable', m === 'comfortable');
        writeJson(DENSITY_KEY, m);
        const sel = document.getElementById('ui-density-select');
        if (sel) sel.value = m;
    };

    window.initUiDensity = function () {
        const saved = readJson(DENSITY_KEY, 'comfortable');
        applyUiDensity(saved === 'compact' ? 'compact' : 'comfortable');
    };

    // ── Résiliation self-service (demande locale + email intent) ────
    window.requestSubscriptionCancellation = function () {
        const sub = window.cachedSubscription || {};
        const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
        if (!user || user.role !== 'admin') {
            showToast('Réservé à l\'administrateur de l\'entreprise', 'error');
            return;
        }
        const effect = new Date();
        effect.setMonth(effect.getMonth() + 1);
        const effectStr = effect.toISOString().slice(0, 10);
        if (!confirm(
            `Demander la résiliation avec préavis d'1 mois ?\n` +
            `Date d'effet estimée : ${effectStr} (fin de période mensuelle).\n` +
            `Tout mois entamé reste dû (CGV).`
        )) return;

        const payload = {
            requestedAt: new Date().toISOString(),
            effectDate: effectStr,
            companyId: user.company_id,
            companyName: user.company_name,
            email: user.email,
            plan: sub.planName || sub.plan
        };
        writeJson(companyKey(CANCEL_KEY), payload);

        const subject = encodeURIComponent(`Résiliation abonnement Flenova — ${user.company_name || ''}`);
        const body = encodeURIComponent(
            `Bonjour,\n\nJe souhaite résilier l'abonnement Flenova de ${user.company_name || 'mon entreprise'}.\n` +
            `Forfait : ${payload.plan || '—'}\n` +
            `Date de demande : ${payload.requestedAt}\n` +
            `Date d'effet souhaitée (préavis 1 mois) : ${effectStr}\n\n` +
            `Cordialement,\n${user.name || ''} (${user.email || ''})`
        );
        window.open(`mailto:support@flenova.fr?subject=${subject}&body=${body}`, '_blank');
        showToast(`Demande enregistrée — effet estimé le ${effectStr}`, 'success');
        if (typeof router === 'function') router('pricing');
    };

    window.getCancellationRequest = function () {
        return readJson(companyKey(CANCEL_KEY), null);
    };

    // ── Init hooks ──────────────────────────────────────────────────
    window.initUxImprovements = function () {
        initUiDensity();
        refreshOrderTemplateSelect();
        refreshNotificationBadge();
        renderOnboardingChecklist();
    };

    document.addEventListener('click', (e) => {
        const panel = document.getElementById('notification-center-panel');
        const btn = document.getElementById('notification-center-btn');
        if (panel && !panel.classList.contains('hidden') && !panel.contains(e.target) && !btn?.contains(e.target)) {
            panel.classList.add('hidden');
        }
        const searchBox = document.getElementById('global-search-results');
        const searchInput = document.getElementById('global-search-input');
        if (searchBox && !searchBox.classList.contains('hidden') && !searchBox.contains(e.target) && e.target !== searchInput) {
            searchBox.classList.add('hidden');
        }
    });
})();
