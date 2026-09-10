/**
 * Carte opérationnelle MapLibre — suivi GPS temps réel chauffeurs.
 * Fond : OpenFreeMap / Carto / TomTom selon GET /api/maps/config.
 */
(function (global) {
    const FRANCE_CENTER = [2.3522, 48.8566];
    const DEFAULT_ZOOM = 5.6;

    let mapsConfig = null;
    let mapLibreReady = null;
    let operationalMap = null;
    let operationalMarkers = new Map();
    let followMarker = null;
    let trailSourceId = 'order-trail';
    let pollTimer = null;
    let followOrderId = null;
    let publicMap = null;
    let publicPollTimer = null;
    let publicFitted = false;
    let publicEndpoints = { origin: null, dest: null };
    let followEndpoints = { origin: null, dest: null };
    const plannedSourceId = 'planned-route';
    const plannedLayerId = 'planned-route-line';

    function statusColor(status) {
        if (['En cours', 'Pris en charge', 'Affrété'].includes(status)) return '#2563eb';
        if (['Livré', 'Validé', 'Clôturé', 'Terminé'].includes(status)) return '#059669';
        if (status === 'Annulé') return '#dc2626';
        return '#f59e0b';
    }

    async function loadMapsConfig() {
        if (mapsConfig) return mapsConfig;
        const res = await fetch('/api/maps/config');
        mapsConfig = await res.json();
        return mapsConfig;
    }

    function loadMapLibre() {
        if (global.maplibregl) return Promise.resolve();
        if (mapLibreReady) return mapLibreReady;
        mapLibreReady = new Promise((resolve, reject) => {
            if (!document.querySelector('link[data-maplibre]')) {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = '/assets/vendor/maplibre-gl/maplibre-gl.css';
                link.setAttribute('data-maplibre', '1');
                document.head.appendChild(link);
            }
            const script = document.createElement('script');
            script.src = '/assets/vendor/maplibre-gl/maplibre-gl.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Impossible de charger MapLibre'));
            document.head.appendChild(script);
        });
        return mapLibreReady;
    }

    function buildStyle(config) {
        if (config.styleUrl) return config.styleUrl;
        if (config.rasterTileUrl) {
            // Proxy relatif (/api/maps/tiles) → URL absolue pour MapLibre.
            const tileUrl = config.rasterTileUrl.startsWith('/')
                ? `${global.location.origin}${config.rasterTileUrl}`
                : config.rasterTileUrl;
            const sourceId = config.provider === 'tomtom' ? 'tomtom' : 'basemap';
            return {
                version: 8,
                sources: {
                    [sourceId]: {
                        type: 'raster',
                        tiles: [tileUrl],
                        tileSize: 256,
                        attribution: config.attribution || '© OpenStreetMap'
                    }
                },
                layers: [{ id: `${sourceId}-raster`, type: 'raster', source: sourceId }]
            };
        }
        // Dernier recours : OpenFreeMap (évite tile.openstreetmap.org en prod).
        return 'https://tiles.openfreemap.org/styles/liberty';
    }

    function esc(value) {
        if (typeof escapeHtml === 'function') return escapeHtml(value);
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function createEndpointEl(color, icon, title) {
        const el = document.createElement('div');
        el.className = 'flenova-live-marker';
        el.style.background = color;
        el.title = title || '';
        el.innerHTML = `<i class="fa-solid ${icon}"></i>`;
        return el;
    }

    function clearEndpointMarkers(store) {
        if (!store) return;
        if (store.origin) {
            try { store.origin.remove(); } catch (_) { /* ignore */ }
            store.origin = null;
        }
        if (store.dest) {
            try { store.dest.remove(); } catch (_) { /* ignore */ }
            store.dest = null;
        }
    }

    function setEndpointMarkers(map, store, data) {
        clearEndpointMarkers(store);
        if (!map) return;
        const origin = data.originCoords;
        const dest = data.destCoords;
        if (origin) {
            store.origin = new maplibregl.Marker({
                element: createEndpointEl('#dc2626', 'fa-warehouse', data.origin || 'Chargement')
            }).setLngLat([origin.longitude, origin.latitude]).addTo(map);
        }
        if (dest) {
            store.dest = new maplibregl.Marker({
                element: createEndpointEl('#0f766e', 'fa-flag-checkered', data.destination || data.dest || 'Livraison')
            }).setLngLat([dest.longitude, dest.latitude]).addTo(map);
        }
    }

    function removeLayerSource(map, layerId, sourceId) {
        if (!map || !map.getStyle()) return;
        try {
            if (map.getLayer(layerId)) map.removeLayer(layerId);
            if (map.getSource(sourceId)) map.removeSource(sourceId);
        } catch (_) { /* ignore */ }
    }

    function upsertLine(map, sourceId, layerId, coordinates, paint) {
        if (!map || !map.isStyleLoaded() || !Array.isArray(coordinates) || coordinates.length < 2) return;
        const data = {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates }
        };
        const existing = map.getSource(sourceId);
        if (existing) {
            existing.setData(data);
            return;
        }
        map.addSource(sourceId, { type: 'geojson', data });
        map.addLayer({ id: layerId, type: 'line', source: sourceId, paint });
    }

    function fitTrackingView(map, data, { force = false, userMovedFlag } = {}) {
        if (!map || (userMovedFlag && map[userMovedFlag] && !force)) return;
        const bounds = new maplibregl.LngLatBounds();
        let n = 0;
        const add = (lng, lat) => {
            if (lng == null || lat == null || Number.isNaN(Number(lng)) || Number.isNaN(Number(lat))) return;
            bounds.extend([Number(lng), Number(lat)]);
            n += 1;
        };
        (data.plannedRoute?.coordinates || []).forEach((pair) => add(pair[0], pair[1]));
        if (data.originCoords) add(data.originCoords.longitude, data.originCoords.latitude);
        if (data.destCoords) add(data.destCoords.longitude, data.destCoords.latitude);
        if (data.lastPosition) add(data.lastPosition.longitude, data.lastPosition.latitude);
        (data.trail || []).forEach((t) => add(t.longitude, t.latitude));
        if (n >= 2) {
            map.fitBounds(bounds, { padding: 48, maxZoom: 12, duration: 600 });
        } else if (n === 1 && data.lastPosition) {
            map.easeTo({
                center: [data.lastPosition.longitude, data.lastPosition.latitude],
                zoom: 12,
                duration: 500
            });
        }
    }

    function createTruckEl(color, label) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'flenova-live-marker';
        el.style.background = color;
        el.title = label || '';
        el.innerHTML = '<i class="fa-solid fa-truck"></i>';
        return el;
    }

    function clearOperationalMarkers() {
        operationalMarkers.forEach((m) => m.remove());
        operationalMarkers.clear();
    }

    function stopOperationalPoll() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function updateFollowPanel(mission) {
        const panel = document.getElementById('dash-live-follow-panel');
        if (!panel) return;
        if (!mission) {
            panel.classList.add('hidden');
            panel.innerHTML = '';
            return;
        }
        const pos = mission.position || mission.lastPosition;
        const age = pos?.recordedAt || pos?.recorded_at
            ? new Date(pos.recordedAt || pos.recorded_at).toLocaleTimeString('fr-FR')
            : '—';
        panel.classList.remove('hidden');
        panel.innerHTML = `
            <div class="dash-live-follow-head">
                <strong>${esc(mission.ref || 'Mission')}</strong>
                <button type="button" class="dash-live-unfollow" onclick="LiveMap.unfollow()">✕</button>
            </div>
            <p class="dash-live-follow-meta">${esc(mission.status || '')} · ${esc(mission.driverName || 'Chauffeur n/a')} · ${esc(mission.vehiclePlate || '—')}</p>
            <p class="dash-live-follow-route">${esc(mission.origin || '—')} → ${esc(mission.dest || '—')}</p>
            <p class="dash-live-follow-pos"><i class="fa-solid fa-satellite-dish"></i> ${pos ? `${Number(pos.latitude).toFixed(5)}, ${Number(pos.longitude).toFixed(5)}` : 'Pas encore de GPS'} · ${esc(age)}</p>
            ${mission.trackingCode ? `<a class="dash-live-public-link" href="?code=${encodeURIComponent(mission.trackingCode)}#tracking" target="_blank">Suivi public ${esc(mission.trackingCode)}</a>` : ''}
        `;
    }

    async function refreshOperationalPositions() {
        if (!operationalMap) return;
        try {
            const res = await fetch('/api/tracking/live', {
                credentials: 'include',
                headers: { Accept: 'application/json' }
            });
            if (!res.ok) return;
            const payload = await res.json();
            const missions = payload?.data?.missions || [];
            const withGps = missions.filter((m) => m.position);

            clearOperationalMarkers();
            const bounds = new maplibregl.LngLatBounds();
            let hasBounds = false;

            for (const m of withGps) {
                const color = statusColor(m.status);
                const el = createTruckEl(color, `${m.ref} — ${m.driverName || ''}`);
                el.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    followOrder(m.id);
                });
                const marker = new maplibregl.Marker({ element: el })
                    .setLngLat([m.position.longitude, m.position.latitude])
                    .setPopup(new maplibregl.Popup({ offset: 18 }).setHTML(
                        `<strong>${esc(m.ref || 'Mission')}</strong><br>${esc(m.driverName || '—')} · ${esc(m.vehiclePlate || '—')}<br>${esc(m.origin || '')} → ${esc(m.dest || '')}<br><button type="button" onclick="LiveMap.follow(${Number(m.id)})" class="dash-live-popup-btn">Suivre</button>`
                    ))
                    .addTo(operationalMap);
                operationalMarkers.set(m.id, marker);
                bounds.extend([m.position.longitude, m.position.latitude]);
                hasBounds = true;
            }

            const empty = document.getElementById('dash-live-map-empty');
            if (empty) {
                empty.classList.toggle('hidden', withGps.length > 0);
                empty.textContent = withGps.length
                    ? ''
                    : (missions.length
                        ? 'Missions actives sans GPS — le chauffeur doit ouvrir la mission sur l\'app mobile'
                        : 'Aucune mission active');
            }

            if (followOrderId) {
                const followed = missions.find((m) => m.id === followOrderId);
                updateFollowPanel(followed || null);
                if (followed?.position) {
                    operationalMap.easeTo({
                        center: [followed.position.longitude, followed.position.latitude],
                        zoom: Math.max(operationalMap.getZoom(), 11),
                        duration: 600
                    });
                }
            } else if (hasBounds && !operationalMap._flenovaUserMoved) {
                operationalMap.fitBounds(bounds, { padding: 40, maxZoom: 12, duration: 500 });
            }

            const countEl = document.getElementById('dash-live-gps-count');
            if (countEl) countEl.textContent = `${withGps.length}/${missions.length} GPS`;
        } catch (err) {
            console.warn('[LiveMap] refresh:', err.message);
        }
    }

    async function followOrder(orderId) {
        followOrderId = orderId;
        try {
            const res = await fetch(`/api/tracking/orders/${orderId}/live`, {
                credentials: 'include',
                headers: { Accept: 'application/json' }
            });
            if (!res.ok) throw new Error('Suivi indisponible');
            const payload = await res.json();
            const data = payload.data;
            updateFollowPanel(data);

            if (!operationalMap) return;
            const trail = data.trail || [];
            upsertLine(operationalMap, trailSourceId, 'order-trail-line', trail.map((p) => [p.longitude, p.latitude]), {
                'line-color': '#2563eb',
                'line-width': 3,
                'line-opacity': 0.7
            });
            upsertLine(
                operationalMap,
                plannedSourceId,
                plannedLayerId,
                data.plannedRoute?.coordinates || [],
                {
                    'line-color': '#64748b',
                    'line-width': 3,
                    'line-dasharray': [2, 2],
                    'line-opacity': 0.85
                }
            );
            setEndpointMarkers(operationalMap, followEndpoints, data);

            if (followMarker) followMarker.remove();
            if (data.lastPosition) {
                const el = createTruckEl('#0f766e', data.ref);
                el.classList.add('flenova-live-marker--follow');
                followMarker = new maplibregl.Marker({ element: el })
                    .setLngLat([data.lastPosition.longitude, data.lastPosition.latitude])
                    .addTo(operationalMap);
            }
            fitTrackingView(operationalMap, data, { force: !operationalMap._flenovaFollowFitted });
            operationalMap._flenovaFollowFitted = true;
        } catch (err) {
            console.warn('[LiveMap] follow:', err.message);
            if (typeof showToast === 'function') showToast(err.message, 'error');
        }
    }

    function unfollow() {
        followOrderId = null;
        updateFollowPanel(null);
        if (followMarker) {
            followMarker.remove();
            followMarker = null;
        }
        clearEndpointMarkers(followEndpoints);
        removeLayerSource(operationalMap, 'order-trail-line', trailSourceId);
        removeLayerSource(operationalMap, plannedLayerId, plannedSourceId);
        if (operationalMap) operationalMap._flenovaFollowFitted = false;
    }

    async function initOperationalMap(containerId = 'dash-live-map') {
        stopOperationalPoll();
        unfollow();
        const container = document.getElementById(containerId);
        if (!container) return;

        try {
            const config = await loadMapsConfig();
            if (!config.configured && !config.styleUrl && !config.rasterTileUrl) {
                container.innerHTML = '<p class="dash-live-map-error">Fournisseur de cartes non configuré (MAPS_PROVIDER)</p>';
                return;
            }
            await loadMapLibre();

            if (operationalMap) {
                try { operationalMap.remove(); } catch (_) { /* ignore */ }
                operationalMap = null;
            }
            clearOperationalMarkers();

            operationalMap = new maplibregl.Map({
                container,
                style: buildStyle(config),
                center: FRANCE_CENTER,
                zoom: DEFAULT_ZOOM,
                attributionControl: false
            });
            operationalMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
            operationalMap._flenovaUserMoved = false;
            operationalMap.on('dragstart', () => { operationalMap._flenovaUserMoved = true; });
            operationalMap.on('load', () => refreshOperationalPositions());

            const interval = config.pollIntervalMs || 15000;
            pollTimer = setInterval(refreshOperationalPositions, interval);
        } catch (err) {
            console.error('[LiveMap] init:', err);
            container.innerHTML = `<p class="dash-live-map-error">${err.message || 'Carte indisponible'}</p>`;
        }
    }

    async function initPublicTrackingMap(containerId, trackingData) {
        if (publicPollTimer) {
            clearInterval(publicPollTimer);
            publicPollTimer = null;
        }
        const container = document.getElementById(containerId);
        if (!container || !trackingData) return;

        try {
            const config = await loadMapsConfig();
            await loadMapLibre();
            if (publicMap) {
                clearEndpointMarkers(publicEndpoints);
                try { publicMap.remove(); } catch (_) { /* ignore */ }
                publicMap = null;
            }

            const pos = trackingData.lastPosition;
            const start = trackingData.originCoords || pos;
            publicFitted = false;
            publicMap = new maplibregl.Map({
                container,
                style: buildStyle(config),
                center: start ? [start.longitude, start.latitude] : FRANCE_CENTER,
                zoom: start ? 10 : DEFAULT_ZOOM
            });
            publicMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

            const draw = (data) => {
                if (!publicMap || !publicMap.isStyleLoaded()) return;
                const p = data.lastPosition;
                const trail = data.trail || [];
                upsertLine(publicMap, 'public-trail', 'public-trail-line', trail.map((t) => [t.longitude, t.latitude]), {
                    'line-color': '#0d9488',
                    'line-width': 3
                });
                upsertLine(publicMap, plannedSourceId, plannedLayerId, data.plannedRoute?.coordinates || [], {
                    'line-color': '#64748b',
                    'line-width': 3,
                    'line-dasharray': [2, 2],
                    'line-opacity': 0.85
                });
                setEndpointMarkers(publicMap, publicEndpoints, data);
                if (window._publicDriverMarker) window._publicDriverMarker.remove();
                if (p) {
                    const el = createTruckEl('#0d9488', data.ref);
                    window._publicDriverMarker = new maplibregl.Marker({ element: el })
                        .setLngLat([p.longitude, p.latitude])
                        .addTo(publicMap);
                }
                if (!publicFitted) {
                    fitTrackingView(publicMap, data, { force: true });
                    publicFitted = true;
                }
                const stamp = document.getElementById('public-live-stamp');
                if (stamp && p?.recorded_at) {
                    stamp.textContent = `MAJ ${new Date(p.recorded_at).toLocaleTimeString('fr-FR')}`;
                }
            };

            publicMap.on('load', () => draw(trackingData));

            const code = trackingData.trackingCode;
            if (code) {
                publicPollTimer = setInterval(async () => {
                    try {
                        const res = await fetch(`/api/public/tracking/${encodeURIComponent(code)}`);
                        if (!res.ok) return;
                        const data = await res.json();
                        draw(data);
                    } catch (_) { /* ignore */ }
                }, config.pollIntervalMs || 15000);
            }
        } catch (err) {
            container.innerHTML = `<p class="text-sm text-gray-500 p-4">${err.message}</p>`;
        }
    }

    let assignmentMap = null;
    let assignmentMarkers = [];
    let assignmentResizeObserver = null;
    let assignmentResizeTimers = [];

    function clearAssignmentMarkers() {
        assignmentMarkers.forEach((m) => m.remove());
        assignmentMarkers = [];
    }

    function clearAssignmentResizeTimers() {
        assignmentResizeTimers.forEach((id) => clearTimeout(id));
        assignmentResizeTimers = [];
    }

    function resizeAssignmentMap() {
        if (!assignmentMap) return;
        try { assignmentMap.resize(); } catch (_) { /* ignore */ }
    }

    function scheduleAssignmentMapResize() {
        if (!assignmentMap) return;
        resizeAssignmentMap();
        requestAnimationFrame(() => {
            resizeAssignmentMap();
            assignmentResizeTimers.push(setTimeout(resizeAssignmentMap, 80));
            assignmentResizeTimers.push(setTimeout(resizeAssignmentMap, 250));
        });
    }

    function bindAssignmentMapResize(container) {
        if (assignmentResizeObserver) {
            assignmentResizeObserver.disconnect();
            assignmentResizeObserver = null;
        }
        if (typeof ResizeObserver === 'undefined' || !container) return;
        assignmentResizeObserver = new ResizeObserver(() => resizeAssignmentMap());
        assignmentResizeObserver.observe(container);
    }

    async function renderAssignmentMap(containerId, orderId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '<p class="text-sm text-gray-500 p-4">Chargement carte…</p>';

        try {
            await loadMapLibre();
            const config = await loadMapsConfig();
            const res = await fetch(`/api/tracking/orders/${orderId}/assignment-map`, {
                credentials: 'include',
                headers: { Accept: 'application/json' }
            });
            if (!res.ok) throw new Error('Carte indisponible');
            const payload = await res.json();
            const data = payload.data;
            const loading = data.loadingPoint;
            const drivers = data.drivers || [];

            container.innerHTML = '';
            if (assignmentMap) {
                try { assignmentMap.remove(); } catch (_) { /* ignore */ }
                assignmentMap = null;
            }
            clearAssignmentMarkers();
            clearAssignmentResizeTimers();

            assignmentMap = new maplibregl.Map({
                container,
                style: buildStyle(config),
                center: loading ? [loading.longitude, loading.latitude] : FRANCE_CENTER,
                zoom: loading ? 9 : DEFAULT_ZOOM
            });
            assignmentMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
            bindAssignmentMapResize(container);
            scheduleAssignmentMapResize();

            assignmentMap.on('load', () => {
                scheduleAssignmentMapResize();
                if (loading) {
                    const loadEl = document.createElement('div');
                    loadEl.className = 'flenova-live-marker';
                    loadEl.style.background = '#dc2626';
                    loadEl.innerHTML = '<i class="fa-solid fa-warehouse"></i>';
                    loadEl.title = data.order?.origin || 'Chargement';
                    const loadMarker = new maplibregl.Marker({ element: loadEl })
                        .setLngLat([loading.longitude, loading.latitude])
                        .addTo(assignmentMap);
                    assignmentMarkers.push(loadMarker);
                }

                const bounds = new maplibregl.LngLatBounds();
                if (loading) bounds.extend([loading.longitude, loading.latitude]);

                drivers.forEach((d) => {
                    if (!d.position) return;
                    const el = createTruckEl('#2563eb', d.name);
                    const marker = new maplibregl.Marker({ element: el })
                        .setLngLat([d.position.longitude, d.position.latitude])
                        .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(
                            `<strong>${esc(d.name)}</strong><br>${d.distanceKm != null ? esc(d.distanceKm) + ' km' : '—'}${d.etaMinutes ? ' · ~' + esc(d.etaMinutes) + ' min' : ''}<br>Score ${esc(d.scores?.combined ?? '—')}`
                        ))
                        .addTo(assignmentMap);
                    assignmentMarkers.push(marker);
                    bounds.extend([d.position.longitude, d.position.latitude]);
                });

                if (loading && drivers.some((d) => d.position)) {
                    assignmentMap.fitBounds(bounds, { padding: 48, maxZoom: 11 });
                }
            });

            assignmentMap.once('idle', () => scheduleAssignmentMapResize());

            return data;
        } catch (err) {
            container.textContent = '';
            const errP = document.createElement('p');
            errP.className = 'text-sm text-red-500 p-4';
            errP.textContent = err.message || 'Carte indisponible';
            container.appendChild(errP);
            return null;
        }
    }

    function destroyAssignmentMap() {
        clearAssignmentResizeTimers();
        if (assignmentResizeObserver) {
            assignmentResizeObserver.disconnect();
            assignmentResizeObserver = null;
        }
        clearAssignmentMarkers();
        if (assignmentMap) {
            try { assignmentMap.remove(); } catch (_) { /* ignore */ }
            assignmentMap = null;
        }
    }

    function destroyOperationalMap() {
        stopOperationalPoll();
        unfollow();
        clearOperationalMarkers();
        if (operationalMap) {
            try { operationalMap.remove(); } catch (_) { /* ignore */ }
            operationalMap = null;
        }
    }

    global.LiveMap = {
        initOperationalMap,
        initPublicTrackingMap,
        renderAssignmentMap,
        resizeAssignmentMap: scheduleAssignmentMapResize,
        destroyAssignmentMap,
        follow: followOrder,
        unfollow,
        refresh: refreshOperationalPositions,
        destroyOperationalMap
    };
})(window);
