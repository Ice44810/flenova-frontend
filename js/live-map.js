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
                <strong>${mission.ref || 'Mission'}</strong>
                <button type="button" class="dash-live-unfollow" onclick="LiveMap.unfollow()">✕</button>
            </div>
            <p class="dash-live-follow-meta">${mission.status || ''} · ${mission.driverName || 'Chauffeur n/a'} · ${mission.vehiclePlate || '—'}</p>
            <p class="dash-live-follow-route">${mission.origin || '—'} → ${mission.dest || '—'}</p>
            <p class="dash-live-follow-pos"><i class="fa-solid fa-satellite-dish"></i> ${pos ? `${Number(pos.latitude).toFixed(5)}, ${Number(pos.longitude).toFixed(5)}` : 'Pas encore de GPS'} · ${age}</p>
            ${mission.trackingCode ? `<a class="dash-live-public-link" href="?code=${encodeURIComponent(mission.trackingCode)}#tracking" target="_blank">Suivi public ${mission.trackingCode}</a>` : ''}
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
                        `<strong>${m.ref || 'Mission'}</strong><br>${m.driverName || '—'} · ${m.vehiclePlate || '—'}<br>${m.origin || ''} → ${m.dest || ''}<br><button type="button" onclick="LiveMap.follow(${m.id})" class="dash-live-popup-btn">Suivre</button>`
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
            if (operationalMap.getSource(trailSourceId)) {
                operationalMap.getSource(trailSourceId).setData({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: trail.map((p) => [p.longitude, p.latitude])
                    }
                });
            } else if (trail.length >= 2) {
                operationalMap.addSource(trailSourceId, {
                    type: 'geojson',
                    data: {
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: trail.map((p) => [p.longitude, p.latitude])
                        }
                    }
                });
                operationalMap.addLayer({
                    id: 'order-trail-line',
                    type: 'line',
                    source: trailSourceId,
                    paint: { 'line-color': '#2563eb', 'line-width': 3, 'line-opacity': 0.7 }
                });
            }

            if (followMarker) followMarker.remove();
            if (data.lastPosition) {
                const el = createTruckEl('#0f766e', data.ref);
                el.classList.add('flenova-live-marker--follow');
                followMarker = new maplibregl.Marker({ element: el })
                    .setLngLat([data.lastPosition.longitude, data.lastPosition.latitude])
                    .addTo(operationalMap);
                operationalMap.flyTo({
                    center: [data.lastPosition.longitude, data.lastPosition.latitude],
                    zoom: 12,
                    essential: true
                });
            }
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
        if (operationalMap?.getLayer('order-trail-line')) {
            operationalMap.removeLayer('order-trail-line');
        }
        if (operationalMap?.getSource(trailSourceId)) {
            operationalMap.removeSource(trailSourceId);
        }
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
                try { publicMap.remove(); } catch (_) { /* ignore */ }
                publicMap = null;
            }

            const pos = trackingData.lastPosition;
            publicMap = new maplibregl.Map({
                container,
                style: buildStyle(config),
                center: pos ? [pos.longitude, pos.latitude] : FRANCE_CENTER,
                zoom: pos ? 12 : DEFAULT_ZOOM
            });
            publicMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

            const draw = (data) => {
                const p = data.lastPosition;
                const trail = data.trail || [];
                if (publicMap.getLayer('public-trail-line')) publicMap.removeLayer('public-trail-line');
                if (publicMap.getSource('public-trail')) publicMap.removeSource('public-trail');
                if (trail.length >= 2) {
                    publicMap.addSource('public-trail', {
                        type: 'geojson',
                        data: {
                            type: 'Feature',
                            geometry: {
                                type: 'LineString',
                                coordinates: trail.map((t) => [t.longitude, t.latitude])
                            }
                        }
                    });
                    publicMap.addLayer({
                        id: 'public-trail-line',
                        type: 'line',
                        source: 'public-trail',
                        paint: { 'line-color': '#0d9488', 'line-width': 3 }
                    });
                }
                if (window._publicDriverMarker) window._publicDriverMarker.remove();
                if (p) {
                    const el = createTruckEl('#0d9488', data.ref);
                    window._publicDriverMarker = new maplibregl.Marker({ element: el })
                        .setLngLat([p.longitude, p.latitude])
                        .addTo(publicMap);
                    publicMap.easeTo({ center: [p.longitude, p.latitude], zoom: 12, duration: 500 });
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

    function clearAssignmentMarkers() {
        assignmentMarkers.forEach((m) => m.remove());
        assignmentMarkers = [];
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

            assignmentMap = new maplibregl.Map({
                container,
                style: buildStyle(config),
                center: loading ? [loading.longitude, loading.latitude] : FRANCE_CENTER,
                zoom: loading ? 9 : DEFAULT_ZOOM
            });
            assignmentMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

            assignmentMap.on('load', () => {
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
                            `<strong>${d.name}</strong><br>${d.distanceKm != null ? d.distanceKm + ' km' : '—'}${d.etaMinutes ? ' · ~' + d.etaMinutes + ' min' : ''}<br>Score ${d.scores?.combined ?? '—'}`
                        ))
                        .addTo(assignmentMap);
                    assignmentMarkers.push(marker);
                    bounds.extend([d.position.longitude, d.position.latitude]);
                });

                if (loading && drivers.some((d) => d.position)) {
                    assignmentMap.fitBounds(bounds, { padding: 48, maxZoom: 11 });
                }
            });

            return data;
        } catch (err) {
            container.innerHTML = `<p class="text-sm text-red-500 p-4">${err.message}</p>`;
            return null;
        }
    }

    function destroyAssignmentMap() {
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
        destroyAssignmentMap,
        follow: followOrder,
        unfollow,
        refresh: refreshOperationalPositions,
        destroyOperationalMap
    };
})(window);
