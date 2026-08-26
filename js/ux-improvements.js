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

    // ── Templates d'ordres (API entreprise + migration localStorage) ─
    let cachedTemplates = [];
    let templatesLoaded = false;

    function getLocalOrderTemplates() {
        return readJson(companyKey(TEMPLATE_KEY), []);
    }

    function clearLocalOrderTemplates() {
        try { localStorage.removeItem(companyKey(TEMPLATE_KEY)); } catch { /* ignore */ }
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

    function applyTemplateData(d) {
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
        if (d.assignment_type) set('add-order-assignment-type', d.assignment_type);
    }

    async function migrateLocalTemplatesIfNeeded() {
        const local = getLocalOrderTemplates();
        if (!local.length) return;
        try {
            const res = await apiFetch('transport-orders/templates/import', {
                method: 'POST',
                body: { templates: local }
            });
            if (res.ok) {
                clearLocalOrderTemplates();
                const payload = await res.json().catch(() => ({}));
                if (payload.imported > 0) {
                    showToast(`${payload.imported} modèle(s) local(aux) synchronisé(s)`, 'info');
                }
            }
        } catch { /* offline — garde local */ }
    }

    window.loadOrderTemplates = async function () {
        try {
            await migrateLocalTemplatesIfNeeded();
            const [tplRes, sugRes] = await Promise.all([
                apiFetch('transport-orders/templates'),
                apiFetch('transport-orders/templates/suggestions?minCount=3')
            ]);
            const templates = tplRes.ok ? ((await tplRes.json()).data || []) : [];
            const suggestions = sugRes.ok ? ((await sugRes.json()).data || []) : [];
            cachedTemplates = [
                ...templates,
                ...suggestions.map((s) => ({ ...s, id: s.id, suggested: true }))
            ];
            templatesLoaded = true;
        } catch {
            cachedTemplates = getLocalOrderTemplates();
            templatesLoaded = true;
        }
        refreshOrderTemplateSelect();
        return cachedTemplates;
    };

    window.saveCurrentOrderAsTemplate = async function () {
        const name = prompt('Nom du modèle d\'ordre récurrent :');
        if (!name || !name.trim()) return;
        const snap = collectOrderFormSnapshot();
        if (!snap.origin || !snap.dest) {
            showToast('Renseignez au moins chargement et livraison', 'error');
            return;
        }
        try {
            const res = await apiFetch('transport-orders/templates', {
                method: 'POST',
                body: { name: name.trim(), data: snap }
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload.error || 'Enregistrement impossible');
            showToast('Modèle synchronisé pour toute l\'entreprise', 'success');
            await loadOrderTemplates();
        } catch (e) {
            // Fallback local
            const list = getLocalOrderTemplates();
            list.unshift({
                id: `tpl_${Date.now()}`,
                name: name.trim(),
                createdAt: new Date().toISOString(),
                data: snap
            });
            writeJson(companyKey(TEMPLATE_KEY), list.slice(0, 20));
            cachedTemplates = list;
            refreshOrderTemplateSelect();
            showToast(e.message || 'Modèle enregistré en local (hors-ligne)', 'info');
        }
    };

    window.applyOrderTemplate = function (templateId) {
        const tpl = cachedTemplates.find((t) => String(t.id) === String(templateId));
        if (!tpl) return;
        const d = tpl.data || {};
        applyTemplateData(d);
        showToast(
            tpl.suggested
                ? `Suggestion « ${tpl.name} » appliquée — ajustez les dates`
                : `Modèle « ${tpl.name} » appliqué — ajustez les dates`,
            'info'
        );
    };

    window.deleteOrderTemplate = async function (templateId) {
        const tpl = cachedTemplates.find((t) => String(t.id) === String(templateId));
        if (tpl?.suggested) {
            showToast('Les suggestions ne se suppriment pas — créez un modèle si besoin', 'info');
            return;
        }
        if (!confirm('Supprimer ce modèle pour toute l\'entreprise ?')) return;
        try {
            const res = await apiFetch(`transport-orders/templates/${templateId}`, { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Suppression impossible');
            }
            showToast('Modèle supprimé', 'success');
            await loadOrderTemplates();
        } catch (e) {
            const list = getLocalOrderTemplates().filter((t) => String(t.id) !== String(templateId));
            writeJson(companyKey(TEMPLATE_KEY), list);
            cachedTemplates = list;
            refreshOrderTemplateSelect();
            showToast(e.message || 'Modèle retiré en local', 'info');
        }
    };

    function refreshOrderTemplateSelect() {
        const sel = document.getElementById('order-template-select');
        if (!sel) return;
        const list = cachedTemplates.length ? cachedTemplates : getLocalOrderTemplates();
        const esc = typeof escapeHtml === 'function' ? escapeHtml : (v) => String(v ?? '');
        const saved = list.filter((t) => !t.suggested);
        const suggested = list.filter((t) => t.suggested);
        let html = `<option value="">Modèle récurrent…</option>`;
        if (saved.length) {
            html += `<optgroup label="Modèles entreprise">` +
                saved.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('') +
                `</optgroup>`;
        }
        if (suggested.length) {
            html += `<optgroup label="Suggestions (trajets fréquents ≥ 3×)">` +
                suggested.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('') +
                `</optgroup>`;
        }
        sel.innerHTML = html;
    }

    window.onOrderTemplateSelect = function () {
        const sel = document.getElementById('order-template-select');
        if (sel?.value) applyOrderTemplate(sel.value);
    };

    window.deleteSelectedOrderTemplate = function () {
        const sel = document.getElementById('order-template-select');
        if (!sel?.value) {
            showToast('Sélectionnez un modèle à supprimer', 'info');
            return;
        }
        void deleteOrderTemplate(sel.value);
    };

    window.getOrderTemplatesCache = () => cachedTemplates;

    // ── Recherche globale (serveur + fallback local) ────────────────
    let searchDebounceTimer = null;
    let searchSeq = 0;

    function searchGlobalLocal(query) {
        const q = String(query || '').trim().toLowerCase();
        if (q.length < 2) return [];
        const results = [];
        const push = (type, label, route, meta, detailId) => {
            results.push({ type, label, route, meta, detailId });
        };

        (db.orders || []).forEach((o) => {
            const hay = `${o.ref || ''} ${o.id} ${o.client_name || ''} ${o.origin || ''} ${o.dest || ''}`.toLowerCase();
            if (hay.includes(q)) {
                push('OT', o.ref || `#${o.id}`, 'transports', o.status, o.id);
            }
        });
        (db.clients || []).forEach((c) => {
            const hay = `${c.name || ''} ${c.siret || ''} ${c.email || ''}`.toLowerCase();
            if (hay.includes(q)) {
                push('Client', c.name, 'clients', c.siret || '');
            }
        });
        (db.sales_invoices || []).forEach((inv) => {
            const hay = `${inv.invoice_number || ''} ${inv.id} ${inv.client_name || ''}`.toLowerCase();
            if (hay.includes(q)) {
                const draft = inv.status === 'Brouillon' || inv.status === 'Draft';
                push('Facture', inv.invoice_number || inv.id, draft ? 'sales_invoices_draft' : 'sales_invoices', inv.status);
            }
        });
        (db.vehicles || []).forEach((v) => {
            const hay = `${v.plate || ''} ${v.brand || ''} ${v.model || ''}`.toLowerCase();
            if (hay.includes(q)) {
                push('Véhicule', v.plate || v.id, 'fleet', v.brand || '');
            }
        });
        (db.drivers || []).forEach((d) => {
            const hay = `${d.name || ''} ${d.phone || ''}`.toLowerCase();
            if (hay.includes(q)) {
                push('Chauffeur', d.name, 'drivers', d.phone || '');
            }
        });

        return results.slice(0, 12);
    }

    function navigateSearchHit(item) {
        if (!item) return;
        if (item.type === 'OT' && item.detailId && typeof openTransportDetail === 'function') {
            openTransportDetail(item.detailId);
            return;
        }
        if (typeof item.route === 'function') {
            item.route();
            return;
        }
        if (item.route && typeof router === 'function') router(item.route);
    }

    async function searchGlobalServer(query) {
        const res = await apiFetch(`search?q=${encodeURIComponent(query)}&limit=12`);
        if (!res.ok) throw new Error('search_failed');
        const payload = await res.json().catch(() => ({}));
        return (payload.data || []).map((r) => ({
            type: r.type,
            label: r.label,
            meta: r.meta,
            route: r.route,
            detailId: r.detailId || (r.type === 'OT' ? r.id : null)
        }));
    }

    window.renderGlobalSearchResults = function (query) {
        const box = document.getElementById('global-search-results');
        if (!box) return;
        const q = String(query || '').trim();
        if (q.length < 2) {
            box.classList.add('hidden');
            box.innerHTML = '';
            return;
        }

        clearTimeout(searchDebounceTimer);
        const seq = ++searchSeq;
        box.innerHTML = `<p class="px-3 py-2 text-sm text-gray-400">Recherche…</p>`;
        box.classList.remove('hidden');

        searchDebounceTimer = setTimeout(async () => {
            let results = searchGlobalLocal(q);
            try {
                results = await searchGlobalServer(q);
            } catch {
                /* garde le fallback local */
            }
            if (seq !== searchSeq) return;
            paintSearchResults(box, results, q);
        }, 220);
    };

    function paintSearchResults(box, results, query) {
        const esc = typeof escapeHtml === 'function' ? escapeHtml : (v) => String(v ?? '');
        if (!results.length) {
            box.innerHTML = `<p class="px-3 py-2 text-sm text-gray-500">Aucun résultat pour « ${esc(query)} »</p>`;
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
                navigateSearchHit(item);
            });
        });
    }

    // ── Push web (opt-in si VAPID configuré) ─────────────────────────
    async function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(base64);
        return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
    }

    window.initWebPushIfAvailable = async function () {
        if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
            return;
        }
        try {
            const res = await apiFetch('push/config');
            if (!res.ok) return;
            const { data } = await res.json();
            if (!data?.enabled || !data.publicKey) return;
            if (Notification.permission === 'denied') return;

            const reg = await navigator.serviceWorker.register('/sw-push.js').catch(() => null);
            if (!reg) return;

            if (Notification.permission === 'default') {
                // Ne pas forcer — bouton optionnel dans le centre notifs
                window.__flenovaPushReady = { publicKey: data.publicKey, reg };
                return;
            }
            await subscribeWebPush(data.publicKey, reg);
        } catch { /* ignore */ }
    };

    async function subscribeWebPush(publicKey, reg) {
        const existing = await reg.pushManager.getSubscription();
        const sub = existing || await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: await urlBase64ToUint8Array(publicKey)
        });
        await apiFetch('push/subscribe', {
            method: 'POST',
            body: { subscription: sub.toJSON() }
        });
    }

    window.enableWebPushNotifications = async function () {
        try {
            const res = await apiFetch('push/config');
            const { data } = await res.json();
            if (!data?.enabled) {
                showToast('Push non configuré côté serveur (VAPID)', 'info');
                return;
            }
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') {
                showToast('Permission notifications refusée', 'info');
                return;
            }
            const reg = await navigator.serviceWorker.register('/sw-push.js');
            await subscribeWebPush(data.publicKey, reg);
            showToast('Notifications push activées', 'success');
        } catch (e) {
            showToast(e.message || 'Activation push impossible', 'error');
        }
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

    function placeFixedPanelNear(anchorEl, panel, { offset = 8, preferRight = true } = {}) {
        if (!anchorEl || !panel) return;
        const rect = anchorEl.getBoundingClientRect();
        const margin = 12;
        // Mesure après affichage (pas hidden)
        const pw = panel.offsetWidth || 320;
        const ph = panel.offsetHeight || 200;
        let top = rect.bottom + offset;
        let left = preferRight ? rect.right - pw : rect.left;
        left = Math.min(left, window.innerWidth - pw - margin);
        left = Math.max(margin, left);
        if (top + ph > window.innerHeight - margin) {
            top = Math.max(margin, rect.top - ph - offset);
        }
        panel.style.top = `${Math.round(top)}px`;
        panel.style.left = `${Math.round(left)}px`;
        panel.style.right = 'auto';
    }

    window.toggleNotificationCenter = function () {
        const panel = document.getElementById('notification-center-panel');
        const btn = document.getElementById('notification-center-btn');
        if (!panel) return;
        if (!panel.classList.contains('hidden')) {
            panel.classList.add('hidden');
            return;
        }
        if (typeof closeAccountMenu === 'function') closeAccountMenu();
        const items = buildNotifications();
        const esc = typeof escapeHtml === 'function' ? escapeHtml : (v) => String(v ?? '');
        const toneClass = {
            danger: 'border-l-red-500 bg-red-50',
            warning: 'border-l-amber-500 bg-amber-50',
            info: 'border-l-blue-500 bg-blue-50'
        };
        panel.innerHTML = `
            <div class="p-3 border-b flex justify-between items-center gap-2">
                <span class="text-sm font-bold text-gray-800">Notifications</span>
                <div class="flex items-center gap-2">
                    <button type="button" onclick="enableWebPushNotifications()" class="text-[10px] font-semibold text-indigo-700 hover:underline" title="Activer les notifications navigateur">
                        Push
                    </button>
                    <button type="button" onclick="document.getElementById('notification-center-panel')?.classList.add('hidden')"
                        class="text-gray-400 hover:text-gray-600" aria-label="Fermer">
                        <i class="fa-solid fa-times" aria-hidden="true"></i>
                    </button>
                    <span class="text-xs text-gray-500">${items.length}</span>
                </div>
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
        panel.querySelectorAll('.notif-item').forEach((el) => {
            el.addEventListener('click', () => {
                const item = panel._items?.[Number(el.dataset.idx)];
                panel.classList.add('hidden');
                if (typeof item?.action === 'function') item.action();
            });
        });
        panel.classList.remove('hidden');
        placeFixedPanelNear(btn, panel, { preferRight: true });
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

    // ── Header : menu compte + barre d'actions (option 1) ───────────
    const ACTION_RAIL_ROUTES = new Set([
        'dashboard', 'transports', 'planning',
        'inprogress_transports', 'completed_transports', 'closed_transports',
        'cancelled_transports', 'chartered_transports', 'preinvoicing', 'create_order'
    ]);

    window.closeAccountMenu = function () {
        const panel = document.getElementById('account-menu-panel');
        const btn = document.getElementById('account-menu-btn');
        panel?.classList.add('hidden');
        btn?.setAttribute('aria-expanded', 'false');
    };

    window.toggleAccountMenu = function () {
        const panel = document.getElementById('account-menu-panel');
        const btn = document.getElementById('account-menu-btn');
        if (!panel) return;
        const open = panel.classList.contains('hidden');
        document.getElementById('notification-center-panel')?.classList.add('hidden');
        if (open) {
            panel.classList.remove('hidden');
            btn?.setAttribute('aria-expanded', 'true');
            placeFixedPanelNear(btn, panel, { preferRight: true });
        } else {
            closeAccountMenu();
        }
    };

    window.toggleMobileGlobalSearch = function () {
        const wrap = document.getElementById('global-search-wrap');
        const input = document.getElementById('global-search-input');
        if (!wrap) return;
        const isDesktop = window.matchMedia('(min-width: 640px)').matches;
        if (isDesktop) {
            input?.focus();
            return;
        }
        const open = wrap.classList.contains('mobile-search-open');
        if (open) {
            wrap.classList.remove('mobile-search-open');
            wrap.classList.add('hidden');
        } else {
            wrap.classList.remove('hidden');
            wrap.classList.add('mobile-search-open');
            setTimeout(() => input?.focus(), 30);
        }
    };

    window.updateAppActionRail = function (route) {
        const rail = document.getElementById('app-action-rail');
        if (!rail) return;
        const sub = window.cachedSubscription;
        const suspended = !!(sub?.accessSuspended || (sub?.needsPayment && !sub?.gracePeriod && !sub?.isDemo && !sub?.isActive));
        const r = route || window.currentAppRoute || 'dashboard';
        const show = !suspended && !currentUser?.isPlatformAdmin && ACTION_RAIL_ROUTES.has(r);
        rail.classList.toggle('hidden', !show);
    };

    // ── Résiliation self-service (demande locale + email intent) ────
    window.requestSubscriptionCancellation = async function () {
        const sub = window.cachedSubscription || {};
        const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
        if (!user || user.role !== 'admin') {
            showToast('Réservé à l\'administrateur de l\'entreprise', 'error');
            return;
        }
        if (sub.cancellationEffectDate) {
            showToast(`Résiliation déjà demandée — effet le ${sub.cancellationEffectDate}`, 'info');
            return;
        }
        const effect = new Date();
        effect.setMonth(effect.getMonth() + 1);
        const effectStr = effect.toISOString().slice(0, 10);
        if (!confirm(
            `Demander la résiliation avec préavis d'1 mois ?\n` +
            `Date d'effet estimée : ${effectStr}.\n` +
            `Tout mois entamé reste dû (CGV).`
        )) return;

        try {
            const res = await apiFetch('subscription/cancel-request', { method: 'POST', body: {} });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload.error || 'Demande impossible');
            if (payload.data) window.cachedSubscription = payload.data;
            const date = payload.data?.cancellationEffectDate || effectStr;
            writeJson(companyKey(CANCEL_KEY), {
                requestedAt: new Date().toISOString(),
                effectDate: date,
                companyId: user.company_id
            });
            showToast(`Demande enregistrée — effet estimé le ${date}. Un e-mail de confirmation a été envoyé.`, 'success');
            if (typeof router === 'function') router('pricing');
        } catch (e) {
            // Fallback mailto
            const subject = encodeURIComponent(`Résiliation abonnement Flenova — ${user.company_name || ''}`);
            const body = encodeURIComponent(
                `Bonjour,\n\nJe souhaite résilier l'abonnement Flenova de ${user.company_name || 'mon entreprise'}.\n` +
                `Date d'effet souhaitée (préavis 1 mois) : ${effectStr}\n\nCordialement,\n${user.name || ''} (${user.email || ''})`
            );
            window.open(`mailto:support@flenova.fr?subject=${subject}&body=${body}`, '_blank');
            showToast(e.message || 'Demande ouverte par e-mail', 'info');
        }
    };

    window.getCancellationRequest = function () {
        return readJson(companyKey(CANCEL_KEY), null);
    };

    // ── Init hooks ──────────────────────────────────────────────────
    window.initUxImprovements = function () {
        initUiDensity();
        refreshNotificationBadge();
        renderOnboardingChecklist();
        if (typeof loadOrderTemplates === 'function') {
            void loadOrderTemplates();
        } else {
            refreshOrderTemplateSelect();
        }
        void initWebPushIfAvailable();
        if (typeof updateAppActionRail === 'function') {
            updateAppActionRail(window.currentAppRoute || 'dashboard');
        }
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
        const accountPanel = document.getElementById('account-menu-panel');
        const accountBtn = document.getElementById('account-menu-btn');
        if (accountPanel && !accountPanel.classList.contains('hidden')
            && !accountPanel.contains(e.target) && !accountBtn?.contains(e.target)) {
            closeAccountMenu();
        }
    });
})();
