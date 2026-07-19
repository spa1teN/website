(function () {
    "use strict";

    var config = document.getElementById("map-config").dataset;
    var LANG = (config.lang === "en" || config.lang === "fi") ? config.lang : "de";

    function tr(de, en, fi) {
        if (LANG === "en") return en;
        if (LANG === "fi") return fi !== undefined ? fi : en;
        return de;
    }

    var ROUTE_COLORS = {
        train: "#1565C0",
        car:   "#9c27b0",
        plane: "#D32F2F",
        ferry: "#2E7D32",
    };

    var ROUTE_DASH = {
        train: [8, 3],
        plane: [5, 10],
        ferry: [8, 8],
    };

    var map = new maplibregl.Map({
        container: "map",
        style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
        center: [10.4515, 51.1657],
        zoom: 5,
        attributionControl: false,
    });

    map.on("style.load", function () {
        map.setProjection({ type: "globe" });
        try { map.setSky({ "atmosphere-blend": 0.85 }); } catch (e) {}
    });

    // State
    var allTrips = [];
    var allRoutesGeoJSON = null;
    var imageMarkers = [];
    var videoMarkers = [];
    var activeFilters = {
        types: new Set(),
        transport: new Set(),
        years: new Set(),
        countries: new Set(),
        tripId: "",
    };
    var currentPopup = null;
    var currentMode = "detailed";
    var refreshStatsIfOpen = function () {};
    var routeWidthMultiplier = 1.0;

    function _buildStatsParams() {
        var params = new URLSearchParams();
        activeFilters.years.forEach(function (y) { params.append("year", y); });
        activeFilters.transport.forEach(function (t) { params.append("transport", t); });
        activeFilters.types.forEach(function (ty) { params.append("type", ty); });
        activeFilters.countries.forEach(function (c) { params.append("country", c); });
        return params;
    }
    var _buildFilterParams = _buildStatsParams;

    // --- Data fetching ---

    function loadTrips() {
        Promise.all([
            fetch(config.tripsUrl).then(function (r) { return r.json(); }),
            fetch(config.routesUrl).then(function (r) { return r.json(); }),
        ]).then(function (results) {
            var trips = results[0];
            var routes = results[1];
            allTrips = trips;
            allRoutesGeoJSON = routes;
            populateFilters(trips);
            applyFilters(); // also zooms to fit the (initially unfiltered) content
        });
    }

    function loadRoutes(callback) {
        var params = new URLSearchParams();
        if (activeFilters.tripId) params.set("trip_id", activeFilters.tripId);
        var qs = params.toString();
        var url = config.routesUrl + (qs ? "?" + qs : "");
        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (geojson) {
                renderRoutes(geojson);
                if (callback) callback(geojson);
            });
    }

    function loadImagesForTrip(tripId) {
        var url = config.imagesUrl + "?trip_id=" + tripId;
        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (geojson) {
                renderImages(geojson);
                zoomToTripContent(geojson);
            });
    }

    function loadVideosForTrip(tripId) {
        var url = config.videosUrl + "?trip_id=" + tripId;
        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (geojson) { renderVideos(geojson); });
    }

    // --- Trip Markers (overview) via GL layers ---

    function _setTripSource(features) {
        var data = { type: "FeatureCollection", features: features };

        if (map.getSource("trips-source")) {
            map.getSource("trips-source").setData(data);
            return;
        }

        map.addSource("trips-source", { type: "geojson", data: data });

        map.addLayer({
            id: "trip-circles",
            type: "circle",
            source: "trips-source",
            paint: {
                "circle-radius": 2,
                "circle-color": ["case", ["get", "isEvent"], "#FF9800", "#ffffff"],
                "circle-stroke-width": 1.5,
                "circle-stroke-color": ["case", ["get", "isEvent"], "#c8660a", "#6c9bcf"],
            },
        });

        map.addLayer({
            id: "trip-labels",
            type: "symbol",
            source: "trips-source",
            minzoom: 3,
            layout: {
                "icon-image": "label-bg",
                "icon-text-fit": "both",
                "icon-text-fit-padding": [4, 8, 4, 8],
                "icon-allow-overlap": false,
                "text-field": ["case",
                    ["!=", ["get", "subtitle"], ""],
                    ["format",
                        ["get", "title"], {"font-scale": 1.0},
                        "\n", {},
                        ["get", "subtitle"], {"font-scale": 0.8}
                    ],
                    ["get", "title"]
                ],
                "text-size": 13,
                "text-anchor": "top",
                "text-offset": [0, 1.1],
                "text-allow-overlap": false,
                "text-optional": true,
            },
            paint: {
                "text-color": "#e0e0e0",
                "icon-opacity": 1,
            },
        });

        map.on("click", "trip-circles", function (e) {
            selectTrip(e.features[0].properties.id);
        });
        map.on("click", "trip-labels", function (e) {
            selectTrip(e.features[0].properties.id);
        });
        map.on("mouseenter", "trip-circles", function () {
            map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "trip-circles", function () {
            map.getCanvas().style.cursor = "";
        });
        map.on("mouseenter", "trip-labels", function () {
            map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "trip-labels", function () {
            map.getCanvas().style.cursor = "";
        });
    }

    function showTripMarkers(filteredTrips, shouldZoom) {
        clearImageMarkers();

        var features = filteredTrips
            .filter(function (t) { return t.lat && t.lng; })
            .map(function (t) {
                return {
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [t.lng, t.lat] },
                    properties: {
                        id: t.id,
                        title: t.title,
                        subtitle: t.subtitle || "",
                        isEvent: t.is_event || false,
                    },
                };
            });

        _setTripSource(features);

        if (shouldZoom !== false && features.length > 0) {
            var bounds = new maplibregl.LngLatBounds();
            features.forEach(function (f) { bounds.extend(f.geometry.coordinates); });
            if (!bounds.isEmpty()) {
                map.fitBounds(bounds, { padding: 60, maxZoom: 8 });
            }
        }
    }

    function clearTripMarkers() {
        _setTripSource([]);
    }

    // --- Image Markers (trip detail view) ---

    function computeImageOffsets(features) {
        var groups = {};
        features.forEach(function (f, i) {
            if (!f.geometry || !f.geometry.coordinates) return;
            var c = f.geometry.coordinates;
            var key = Math.round(c[0] * 1000) + "," + Math.round(c[1] * 1000);
            if (!groups[key]) groups[key] = [];
            groups[key].push(i);
        });
        var offsets = features.map(function () { return [0, 0]; });
        Object.keys(groups).forEach(function (key) {
            var indices = groups[key];
            var n = indices.length;
            if (n <= 1) return;
            var r = 28 + Math.max(0, n - 2) * 8;
            indices.forEach(function (idx, k) {
                var angle = (2 * Math.PI / n) * k - Math.PI / 2;
                offsets[idx] = [Math.round(r * Math.cos(angle)), Math.round(r * Math.sin(angle))];
            });
        });
        return offsets;
    }

    function renderImages(geojson) {
        clearImageMarkers();

        if (!geojson || !geojson.features || geojson.features.length === 0) return;

        // Show ALL images as DOM thumbnails immediately (no clustering,
        // no zoom threshold). Offsets spread overlapping markers apart.
        var offsets = computeImageOffsets(geojson.features);

        geojson.features.forEach(function (feature, i) {
            if (!feature.geometry || !feature.geometry.coordinates) return;
            var coords = feature.geometry.coordinates;
            var props = feature.properties;
            var imgUrl = props.image_url || "";
            var thumbUrl = props.thumb_url || imgUrl;
            var caption = props.caption || "";

            var el = document.createElement("div");
            el.style.width = "48px";
            el.style.height = "48px";
            el.style.borderRadius = "6px";
            el.style.overflow = "hidden";
            el.style.border = "2px solid #FF9800";
            el.style.cursor = "pointer";
            el.style.boxShadow = "0 2px 6px rgba(0,0,0,0.4)";

            var img = document.createElement("img");
            img.src = thumbUrl;
            img.alt = caption;
            img.style.width = "100%";
            img.style.height = "100%";
            img.style.objectFit = "cover";
            el.appendChild(img);

            el.addEventListener("click", function (e) {
                e.stopPropagation();
                window.openLightbox(imgUrl);
            });

            var marker = new maplibregl.Marker({ element: el, offset: offsets[i] })
                .setLngLat(coords)
                .addTo(map);

            imageMarkers.push(marker);
        });
    }

    function clearImageMarkers() {
        imageMarkers.forEach(function (m) { m.remove(); });
        imageMarkers = [];
        // Clean up any stale cluster layer/source artifacts (from old code)
        var layers = ["images-layer", "images-cluster", "images-cluster-count", "images-unclustered"];
        layers.forEach(function (id) {
            if (map.getLayer(id)) map.removeLayer(id);
        });
        if (map.getSource("images")) map.removeSource("images");
    }

    function renderVideos(geojson) {
        clearVideoMarkers();
        if (!geojson || !geojson.features || geojson.features.length === 0) return;

        var offsets = computeImageOffsets(geojson.features);

        geojson.features.forEach(function (feature, i) {
            if (!feature.geometry || !feature.geometry.coordinates) return;
            var coords = feature.geometry.coordinates;
            var props = feature.properties;
            var videoUrl = props.video_url || "";

            var el = document.createElement("div");
            el.style.width = "48px";
            el.style.height = "48px";
            el.style.borderRadius = "6px";
            el.style.overflow = "hidden";
            el.style.border = "2px solid #29B6F6";
            el.style.cursor = "pointer";
            el.style.boxShadow = "0 2px 6px rgba(0,0,0,0.4)";
            el.style.background = "#0d1b2a";
            el.style.display = "flex";
            el.style.alignItems = "center";
            el.style.justifyContent = "center";
            el.style.fontSize = "22px";
            el.style.color = "#29B6F6";
            el.textContent = "\u25B6";

            el.addEventListener("click", function (e) {
                e.stopPropagation();
                openVideoPlayer(videoUrl);
            });

            var marker = new maplibregl.Marker({ element: el, offset: offsets[i] })
                .setLngLat(coords)
                .addTo(map);

            videoMarkers.push(marker);
        });
    }

    function clearVideoMarkers() {
        videoMarkers.forEach(function (m) { m.remove(); });
        videoMarkers = [];
    }

    // --- Routes ---

    function renderRoutes(geojson) {
        if (!geojson || !geojson.features) return;

        ["train", "car", "plane", "ferry"].forEach(function (type) {
            if (map.getLayer("route-" + type)) map.removeLayer("route-" + type);
            if (map.getSource("routes-" + type)) map.removeSource("routes-" + type);
        });

        var grouped = { train: [], car: [], plane: [], ferry: [] };
        geojson.features.forEach(function (feature) {
            if (!feature.geometry) return;
            var type = feature.properties.transport_type;
            if (grouped[type]) grouped[type].push(feature);
        });

        ["train", "car", "plane", "ferry"].forEach(function (type) {
            var features = grouped[type];
            if (features.length === 0) return;

            map.addSource("routes-" + type, {
                type: "geojson",
                data: { type: "FeatureCollection", features: features },
            });

            var paint = {
                "line-color": ROUTE_COLORS[type] || "#999",
                "line-width": (type === "plane" ? 0.75 : 1) * routeWidthMultiplier,
                "line-opacity": 0.6,
            };
            if (ROUTE_DASH[type]) {
                paint["line-dasharray"] = ROUTE_DASH[type];
            }

            map.addLayer({
                id: "route-" + type,
                type: "line",
                source: "routes-" + type,
                paint: paint,
            }, map.getLayer("trip-circles") ? "trip-circles" : undefined);
        });
    }

    function renderRoutesFiltered(matchingTripIds) {
        if (!allRoutesGeoJSON || !allRoutesGeoJSON.features) return;
        var features = allRoutesGeoJSON.features.filter(function (f) {
            return matchingTripIds.has(f.properties.trip_id) &&
                (activeFilters.transport.size === 0 || activeFilters.transport.has(f.properties.transport_type));
        });
        renderRoutes({ type: "FeatureCollection", features: features });
    }

    function _initRouteInteractions() {
        ["train", "car", "plane", "ferry"].forEach(function (type) {
            map.on("click", "route-" + type, function (e) {
                var props = e.features[0].properties;
                var fallbackTitle = tr("Reise", "Trip", "Matka");
                var html = "<b>" + (props.trip_title || fallbackTitle) + "</b><br>" + transportLabel(props.transport_type);
                if (props.trip_id) {
                    html += '<br><a href="/diary/trip/' + props.trip_id + '/">Details &rarr;</a>';
                }
                if (currentPopup) currentPopup.remove();
                currentPopup = new maplibregl.Popup({ maxWidth: "250px" })
                    .setLngLat(e.lngLat)
                    .setHTML(html)
                    .addTo(map);
            });

            map.on("mouseenter", "route-" + type, function () {
                map.getCanvas().style.cursor = "pointer";
            });
            map.on("mouseleave", "route-" + type, function () {
                map.getCanvas().style.cursor = "";
            });
        });

        map.on("click", "visited-countries-fill", function (e) {
            var props = e.features[0].properties;
            showStatesForCountry(props.iso_a2, props.name);
        });
        map.on("mouseenter", "visited-countries-fill", function () {
            map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "visited-countries-fill", function () {
            map.getCanvas().style.cursor = "";
        });

        map.on("click", "states-fill", function (e) {
            var props = e.features[0].properties;
            if (currentPopup) currentPopup.remove();
            currentPopup = new maplibregl.Popup({ maxWidth: "220px" })
                .setLngLat(e.lngLat)
                .setHTML("<b>" + props.name + "</b>")
                .addTo(map);
        });
        map.on("mouseenter", "states-fill", function () {
            map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "states-fill", function () {
            map.getCanvas().style.cursor = "";
        });
    }

    // --- Visited Countries mode (main map) ---

    function ensureVisitedCountriesLayer(geojson) {
        if (map.getSource("visited-countries")) {
            map.getSource("visited-countries").setData(geojson);
            return;
        }
        map.addSource("visited-countries", { type: "geojson", data: geojson });
        map.addLayer({
            id: "visited-countries-fill",
            type: "fill",
            source: "visited-countries",
            layout: { visibility: "none" },
            paint: { "fill-color": "#6c9bcf", "fill-opacity": 0.55 },
        }, map.getLayer("trip-circles") ? "trip-circles" : undefined);
        map.addLayer({
            id: "visited-countries-outline",
            type: "line",
            source: "visited-countries",
            layout: { visibility: "none" },
            paint: { "line-color": "#6c9bcf", "line-width": 0.75 },
        }, map.getLayer("trip-circles") ? "trip-circles" : undefined);
    }

    function loadFilteredVisitedCountries(callback) {
        // Respects the active Transport/Year filters - used for the main map layer.
        if (!config.visitedCountriesUrl) return;
        var params = new URLSearchParams();
        activeFilters.years.forEach(function (y) { params.append("year", y); });
        activeFilters.transport.forEach(function (t) { params.append("transport", t); });
        var qs = params.toString();
        var url = config.visitedCountriesUrl + (qs ? "?" + qs : "");
        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (geojson) {
                ensureVisitedCountriesLayer(geojson);
                if (callback) callback(geojson);
            });
    }

    function countryFlag(iso2) {
        if (!iso2 || iso2.length !== 2) return "";
        var upper = iso2.toUpperCase();
        var base = 127397;
        return String.fromCodePoint(upper.charCodeAt(0) + base, upper.charCodeAt(1) + base);
    }

    function setOverviewLayersVisibility(visible) {
        var vis = visible ? "visible" : "none";
        ["trip-circles", "trip-labels"].forEach(function (id) {
            if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
        });
        ["train", "car", "plane", "ferry"].forEach(function (type) {
            var id = "route-" + type;
            if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
        });
    }

    function setVisitedLayerVisibility(visible) {
        var vis = visible ? "visible" : "none";
        if (map.getLayer("visited-countries-fill")) map.setLayoutProperty("visited-countries-fill", "visibility", vis);
        if (map.getLayer("visited-countries-outline")) map.setLayoutProperty("visited-countries-outline", "visibility", vis);
    }

    function ensurePhotoHeatmapLayer(geojson) {
        if (map.getSource("photo-heatmap")) {
            map.getSource("photo-heatmap").setData(geojson);
            return;
        }
        map.addSource("photo-heatmap", { type: "geojson", data: geojson });
        map.addLayer({
            id: "photo-heatmap-layer",
            type: "heatmap",
            source: "photo-heatmap",
            maxzoom: 15,
            paint: {
                "heatmap-weight": 1,
                "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 9, 3],
                "heatmap-color": [
                    "interpolate", ["linear"], ["heatmap-density"],
                    0, "rgba(33,102,172,0)",
                    0.2, "rgb(103,169,207)",
                    0.4, "rgb(209,229,240)",
                    0.6, "rgb(253,219,199)",
                    0.8, "rgb(239,138,98)",
                    1, "rgb(178,24,43)"
                ],
                "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 12, 9, 24],
                "heatmap-opacity": 0.85,
            },
        }, map.getLayer("trip-circles") ? "trip-circles" : undefined);
    }

    function setHeatmapLayerVisibility(visible) {
        var vis = visible ? "visible" : "none";
        if (map.getLayer("photo-heatmap-layer")) map.setLayoutProperty("photo-heatmap-layer", "visibility", vis);
    }

    function loadPhotoHeatmap(callback) {
        if (!config.heatmapUrl) return;
        var qs = _buildFilterParams().toString();
        fetch(config.heatmapUrl + (qs ? "?" + qs : ""))
            .then(function (r) { return r.json(); })
            .then(function (geojson) {
                ensurePhotoHeatmapLayer(geojson);
                if (callback) callback(geojson);
            });
    }

    function renderVisitedList(geojson) {
        var list = document.getElementById("stats-visited-list");
        if (!list) return;
        list.innerHTML = "";
        var entries = geojson.features
            .map(function (f) { return f.properties; })
            .sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
        if (!entries.length) {
            var empty = document.createElement("div");
            empty.className = "stats-empty";
            empty.textContent = tr("Noch keine Daten.", "No data yet.", "Ei vielä tietoja.");
            list.appendChild(empty);
            return;
        }
        entries.forEach(function (props) {
            var chip = document.createElement("span");
            chip.className = "stats-visited-chip";
            chip.title = props.name;
            var flag = countryFlag(props.iso_a2);
            if (flag) {
                chip.textContent = flag;
            } else {
                chip.classList.add("stats-visited-chip--text");
                chip.textContent = props.name;
            }
            list.appendChild(chip);
        });
    }

    function refreshVisitedLayerIfActive() {
        if (currentMode !== "visited" || currentCountryIso) return;
        loadFilteredVisitedCountries(function (geojson) {
            if (currentMode !== "visited") return;
            setVisitedLayerVisibility(true);
        });
    }

    function _computeContentBounds() {
        // Bounds from actual trip markers + route geometries - NOT country/state
        // polygon extents, which would drag in remote territories (e.g. French
        // Guiana counted as part of France, Svalbard as part of Norway).
        var bounds = new maplibregl.LngLatBounds();
        allTrips.forEach(function (t) {
            if (t.lat && t.lng) bounds.extend([t.lng, t.lat]);
        });
        if (allRoutesGeoJSON && allRoutesGeoJSON.features) {
            allRoutesGeoJSON.features.forEach(function (f) {
                if (!f.geometry || !f.geometry.coordinates) return;
                f.geometry.coordinates.forEach(function (c) { bounds.extend(c); });
            });
        }
        return bounds;
    }

    function _fitToContentBounds(opts) {
        var bounds = _computeContentBounds();
        if (!bounds.isEmpty()) {
            map.fitBounds(bounds, opts || { padding: 60, maxZoom: 8 });
        }
    }

    function _computeFilteredBounds(matchingTrips, matchingIds) {
        var bounds = new maplibregl.LngLatBounds();
        matchingTrips.forEach(function (t) {
            if (t.lat && t.lng) bounds.extend([t.lng, t.lat]);
        });
        if (allRoutesGeoJSON && allRoutesGeoJSON.features) {
            allRoutesGeoJSON.features.forEach(function (f) {
                if (!f.geometry || !f.geometry.coordinates) return;
                if (!matchingIds.has(f.properties.trip_id)) return;
                if (activeFilters.transport.size && !activeFilters.transport.has(f.properties.transport_type)) return;
                f.geometry.coordinates.forEach(function (c) { bounds.extend(c); });
            });
        }
        return bounds;
    }

    function _tripBoundsForCountry(iso) {
        var bounds = new maplibregl.LngLatBounds();
        var tripIds = new Set();
        allTrips.forEach(function (t) {
            if (t.destination_country && t.destination_country.iso_a2 === iso) {
                tripIds.add(t.id);
                if (t.lat && t.lng) bounds.extend([t.lng, t.lat]);
            }
        });
        if (allRoutesGeoJSON && allRoutesGeoJSON.features) {
            allRoutesGeoJSON.features.forEach(function (f) {
                if (!f.geometry || !f.geometry.coordinates) return;
                if (!tripIds.has(f.properties.trip_id)) return;
                f.geometry.coordinates.forEach(function (c) { bounds.extend(c); });
            });
        }
        return bounds;
    }

    function setMapMode(mode) {
        if (mode === currentMode) return;
        currentMode = mode;

        document.querySelectorAll(".map-mode-btn").forEach(function (b) {
            b.classList.toggle("active", b.dataset.mode === mode);
        });

        var isSpecial = mode === "visited" || mode === "heatmap";
        ["type-filter-section", "country-filter-section", "entries-section"].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.classList.toggle("hidden", isSpecial);
        });

        var subdivisionsToggle = document.getElementById("subdivisions-toggle");
        if (subdivisionsToggle) subdivisionsToggle.classList.toggle("hidden", mode !== "visited");

        setVisitedLayerVisibility(false);
        setHeatmapLayerVisibility(false);

        if (mode === "visited") {
            selectTrip("");
            setOverviewLayersVisibility(false);
            loadFilteredVisitedCountries(function (geojson) {
                if (currentMode !== "visited") return;
                setVisitedLayerVisibility(true);
            });
            _fitToContentBounds({ padding: 60, maxZoom: 8 });
        } else if (mode === "heatmap") {
            selectTrip("");
            setOverviewLayersVisibility(false);
            loadPhotoHeatmap(function (geojson) {
                if (currentMode !== "heatmap") return;
                setHeatmapLayerVisibility(true);
                var bounds = new maplibregl.LngLatBounds();
                if (geojson.features && geojson.features.length) {
                    geojson.features.forEach(function (f) {
                        bounds.extend(f.geometry.coordinates);
                    });
                    map.fitBounds(bounds, { padding: 60, maxZoom: 10 });
                }
            });
        } else {
            hideStatesView();
            setOverviewLayersVisibility(true);
            applyFilters();
        }
    }

    document.querySelectorAll(".map-mode-btn").forEach(function (btn) {
        btn.addEventListener("click", function () { setMapMode(btn.dataset.mode); });
    });

    // --- States / Bundesländer drill-down ---

    var currentCountryIso = null;
    var subdivisionsGlobal = false;

    function ensureStatesLayer(geojson) {
        if (map.getSource("states")) {
            map.getSource("states").setData(geojson);
            return;
        }
        map.addSource("states", { type: "geojson", data: geojson });
        map.addLayer({
            id: "states-fill",
            type: "fill",
            source: "states",
            paint: {
                "fill-color": ["case", ["get", "visited"], "#6c9bcf", "#888888"],
                "fill-opacity": ["case", ["get", "visited"], 0.6, 0.08],
            },
        }, map.getLayer("trip-circles") ? "trip-circles" : undefined);
        map.addLayer({
            id: "states-outline",
            type: "line",
            source: "states",
            paint: {
                "line-color": ["case", ["get", "visited"], "#6c9bcf", "rgba(255,255,255,0.25)"],
                "line-width": 0.5,
            },
        }, map.getLayer("trip-circles") ? "trip-circles" : undefined);
    }

    function setStatesLayerVisibility(visible) {
        var vis = visible ? "visible" : "none";
        ["states-fill", "states-outline"].forEach(function (id) {
            if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
        });
    }

    function loadStatesGeoJSON(iso, callback) {
        if (!config.statesUrl) return;
        var params = new URLSearchParams();
        params.set("country", iso);
        activeFilters.years.forEach(function (y) { params.append("year", y); });
        activeFilters.transport.forEach(function (t) { params.append("transport", t); });
        fetch(config.statesUrl + "?" + params.toString())
            .then(function (r) { return r.json(); })
            .then(function (geojson) {
                ensureStatesLayer(geojson);
                if (callback) callback(geojson);
            });
    }

    function loadAllStatesGeoJSON(callback) {
        if (!config.statesUrl) return;
        var params = new URLSearchParams();
        activeFilters.years.forEach(function (y) { params.append("year", y); });
        activeFilters.transport.forEach(function (t) { params.append("transport", t); });
        var qs = params.toString();
        fetch(config.statesUrl + (qs ? "?" + qs : ""))
            .then(function (r) { return r.json(); })
            .then(function (geojson) {
                ensureStatesLayer(geojson);
                if (callback) callback(geojson);
            });
    }

    function showStatesForCountry(iso, name) {
        if (!iso) return;
        subdivisionsGlobal = false;
        var toggleBtn = document.getElementById("subdivisions-toggle");
        if (toggleBtn) toggleBtn.classList.remove("active");

        currentCountryIso = iso;
        setVisitedLayerVisibility(false);
        loadStatesGeoJSON(iso, function (geojson) {
            if (currentCountryIso !== iso) return;
            setStatesLayerVisibility(true);
        });
        var countryBounds = _tripBoundsForCountry(iso);
        if (!countryBounds.isEmpty()) {
            map.fitBounds(countryBounds, { padding: 60, maxZoom: 8 });
        }

        var backBtn = document.getElementById("states-back-btn");
        if (backBtn) backBtn.classList.remove("hidden");
    }

    function toggleGlobalSubdivisions() {
        subdivisionsGlobal = !subdivisionsGlobal;
        var toggleBtn = document.getElementById("subdivisions-toggle");
        if (toggleBtn) toggleBtn.classList.toggle("active", subdivisionsGlobal);

        if (subdivisionsGlobal) {
            currentCountryIso = null;
            var backBtn = document.getElementById("states-back-btn");
            if (backBtn) backBtn.classList.add("hidden");
            setVisitedLayerVisibility(false);
            loadAllStatesGeoJSON(function () {
                if (!subdivisionsGlobal) return;
                setStatesLayerVisibility(true);
            });
            _fitToContentBounds({ padding: 60, maxZoom: 8 });
        } else {
            setStatesLayerVisibility(false);
            if (currentMode === "visited") {
                setVisitedLayerVisibility(true);
            }
        }
        _updateTransportSectionVisibility();
    }

    function refreshStatesLayerIfActive() {
        if (currentCountryIso) {
            loadStatesGeoJSON(currentCountryIso, function () {
                setStatesLayerVisibility(true);
            });
        } else if (subdivisionsGlobal) {
            loadAllStatesGeoJSON(function () {
                setStatesLayerVisibility(true);
            });
        }
    }

    function hideStatesView() {
        if (!currentCountryIso && !subdivisionsGlobal) return;
        currentCountryIso = null;
        subdivisionsGlobal = false;
        var toggleBtn = document.getElementById("subdivisions-toggle");
        if (toggleBtn) toggleBtn.classList.remove("active");
        setStatesLayerVisibility(false);
        var backBtn = document.getElementById("states-back-btn");
        if (backBtn) backBtn.classList.add("hidden");
        if (currentMode === "visited") {
            setVisitedLayerVisibility(true);
            loadFilteredVisitedCountries(function () {});
            _fitToContentBounds({ padding: 60, maxZoom: 8 });
        }
        _updateTransportSectionVisibility();
    }

    var tripBackBtn = document.getElementById("trip-back-btn");
    if (tripBackBtn) {
        tripBackBtn.addEventListener("click", function () { selectTrip(""); });
    }

    var statesBackBtn = document.getElementById("states-back-btn");
    if (statesBackBtn) {
        statesBackBtn.addEventListener("click", hideStatesView);
    }

    var subdivisionsToggleBtn = document.getElementById("subdivisions-toggle");
    if (subdivisionsToggleBtn) {
        subdivisionsToggleBtn.addEventListener("click", toggleGlobalSubdivisions);
    }

    // --- Trip Info Box ---

    function showTripInfo(trip) {
        var infoEl = document.getElementById("trip-info");
        var transportBadges = (trip.transport_types || []).map(function (t) {
            return '<span style="display:inline-block;padding:0.1rem 0.4rem;border-radius:3px;font-size:0.7rem;margin-right:0.25rem;background:' +
                (ROUTE_COLORS[t] || "#999") + '33;color:' + (ROUTE_COLORS[t] || "#999") + '">' +
                transportLabel(t) + '</span>';
        }).join("");

        var statsHtml = "";
        var stats = [];
        if (trip.total_distance_km) stats.push('<span>' + tr('Strecke', 'Distance', 'Matka') + ': <strong>' + trip.total_distance_km + ' km</strong></span>');
        if (trip.duration_days) stats.push('<span>' + tr('Dauer', 'Duration', 'Kesto') + ': <strong>' + trip.duration_days + ' ' + tr('Tage', 'days', 'pv') + '</strong></span>');
        if (trip.country_count) stats.push('<span>' + tr('Länder', 'Countries', 'Maita') + ': <strong>' + trip.country_count + '</strong></span>');
        if (trip.photo_count) stats.push('<span>' + tr('Fotos', 'Photos', 'Kuvia') + ': <strong>' + trip.photo_count + '</strong></span>');
        if (stats.length) statsHtml = '<div class="trip-info-stats">' + stats.join(' &middot; ') + '</div>';

        infoEl.innerHTML =
            '<h4>' + trip.title + '</h4>' +
            (trip.subtitle ? '<div class="trip-info-subtitle">' + trip.subtitle + '</div>' : '') +
            (trip.year || transportBadges
                ? '<div class="trip-info-meta">' +
                  (trip.year ? trip.year : '') +
                  (trip.year && transportBadges ? ' &nbsp;' : '') +
                  transportBadges +
                  '</div>'
                : '') +
            statsHtml +
            '<a href="/diary/trip/' + trip.id + '/" class="trip-info-link">Details &rarr;</a>';

        infoEl.classList.remove("hidden");
    }

    function hideTripInfo() {
        var infoEl = document.getElementById("trip-info");
        infoEl.classList.add("hidden");
        infoEl.innerHTML = "";
    }

    // --- Trip Selection ---

    function selectTrip(tripId) {
        activeFilters.tripId = tripId;

        if (window.matchMedia("(max-width: 768px)").matches) {
            document.getElementById("filter-panel").classList.remove("filter-open");
            var ftb = document.getElementById("filter-toggle-btn");
            if (ftb) ftb.classList.remove("filter-open");
        }

        document.querySelectorAll(".trip-item").forEach(function (el) {
            el.classList.toggle("active", el.dataset.tripId === String(tripId));
        });

        var tripBackBtn = document.getElementById("trip-back-btn");
        if (tripBackBtn) tripBackBtn.classList.toggle("hidden", !tripId);

        if (!tripId) {
            clearImageMarkers();
            clearVideoMarkers();
            hideTripInfo();
            applyFilters();
            return;
        }

        clearTripMarkers();
        loadRoutes();
        loadImagesForTrip(tripId);
        loadVideosForTrip(tripId);

        var trip = allTrips.find(function (t) { return t.id === tripId; });
        if (trip) {
            showTripInfo(trip);
        }
    }

    var GERMANY_BOUNDS = [[5.87, 47.27], [15.04, 55.06]];

    function _maxZoomForGermanyHeight() {
        try {
            var cam = map.cameraForBounds(GERMANY_BOUNDS, { padding: 60 });
            if (cam && typeof cam.zoom === "number") return cam.zoom;
        } catch (e) { /* fall through to default */ }
        return 6;
    }

    function zoomToTripContent(imageGeoJSON) {
        var bounds = new maplibregl.LngLatBounds();
        var hasContent = false;

        if (imageGeoJSON && imageGeoJSON.features) {
            imageGeoJSON.features.forEach(function (f) {
                if (f.geometry && f.geometry.coordinates) {
                    bounds.extend(f.geometry.coordinates);
                    hasContent = true;
                }
            });
        }

        if (hasContent && !bounds.isEmpty()) {
            map.fitBounds(bounds, { padding: 60, maxZoom: _maxZoomForGermanyHeight(), duration: 1000 });
        }
    }

    // --- Trip List ---

    function _makeTripItem(t) {
        var item = document.createElement("div");
        item.className = "trip-item" + (String(activeFilters.tripId) === String(t.id) ? " active" : "");
        item.dataset.tripId = t.id;
        item.addEventListener("click", function () { selectTrip(t.id); });

        var titleEl = document.createElement("div");
        titleEl.textContent = t.title + (t.year ? " (" + t.year + ")" : "");
        item.appendChild(titleEl);

        if (t.subtitle) {
            var subEl = document.createElement("div");
            subEl.className = "trip-item-subtitle";
            subEl.textContent = t.subtitle;
            item.appendChild(subEl);
        }
        return item;
    }

    function renderTripList(filteredTrips) {
        var tripList = document.getElementById("trip-list");
        tripList.innerHTML = "";

        var allItem = document.createElement("div");
        allItem.className = "trip-item" + (activeFilters.tripId === "" ? " active" : "");
        allItem.textContent = tr("Alle", "All", "Kaikki");
        allItem.dataset.tripId = "";
        allItem.addEventListener("click", function () { selectTrip(""); });
        tripList.appendChild(allItem);

        var sorted = filteredTrips.slice().sort(function (a, b) {
            var da = a.travel_date || "";
            var db = b.travel_date || "";
            return da > db ? -1 : da < db ? 1 : 0;
        });

        if (sorted.length === 0) {
            var empty = document.createElement("div");
            empty.className = "ms-dropdown-menu-empty";
            empty.textContent = tr("Keine passenden Einträge.", "No matching entries.", "Ei vastaavia merkintöjä.");
            tripList.appendChild(empty);
        }

        sorted.forEach(function (t) { tripList.appendChild(_makeTripItem(t)); });
    }

    // --- Filters ---

    function tripMatchesFilters(t) {
        var type = t.is_event ? "event" : "journey";
        if (activeFilters.types.size && !activeFilters.types.has(type)) return false;

        if (t.year != null && activeFilters.years.size && !activeFilters.years.has(String(t.year))) {
            return false;
        }

        if (activeFilters.countries.size &&
            !(t.destination_country && activeFilters.countries.has(t.destination_country.name))) {
            return false;
        }

        // Events have no transport types — exclude when transport filter is active
        if (t.is_event && activeFilters.transport.size) return false;

        if (!t.is_event && t.transport_types && t.transport_types.length && activeFilters.transport.size) {
            var hasMatch = t.transport_types.some(function (tt) { return activeFilters.transport.has(tt); });
            if (!hasMatch) return false;
        }

        return true;
    }

    function _updateTransportSectionVisibility() {
        var transportSection = document.getElementById("transport-filter-section");
        if (!transportSection) return;
        var show;
        if (currentMode === "visited") {
            show = false;
        } else {
            show = activeFilters.types.size === 0 || activeFilters.types.has("journey");
        }
        transportSection.classList.toggle("hidden", !show);
    }

    function applyFilters() {
        var matchingTrips = allTrips.filter(tripMatchesFilters);
        var matchingIds = new Set(matchingTrips.map(function (t) { return t.id; }));

        renderTripList(matchingTrips);
        showTripMarkers(matchingTrips, false);
        renderRoutesFiltered(matchingIds);
        if (currentMode === "visited") {
            setOverviewLayersVisibility(false);
            refreshVisitedLayerIfActive();
            refreshStatesLayerIfActive();
        } else if (!activeFilters.tripId) {
            var filteredBounds = _computeFilteredBounds(matchingTrips, matchingIds);
            if (!filteredBounds.isEmpty()) {
                map.fitBounds(filteredBounds, { padding: 60, maxZoom: 8 });
            }
        }

        _updateTransportSectionVisibility();
        _updateFilterResetVisibility();
        refreshStatsIfOpen();
    }

    function _filtersAreDefault() {
        return activeFilters.types.size === 0 &&
            activeFilters.transport.size === 0 &&
            activeFilters.years.size === 0 &&
            activeFilters.countries.size === 0;
    }

    function _updateFilterResetVisibility() {
        var btn = document.getElementById("filter-reset-btn");
        if (btn) btn.classList.toggle("hidden", _filtersAreDefault());
    }

    function resetFilters() {
        ["filter-type", "filter-transport", "filter-year", "filter-country"].forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            var menu = el.querySelector(".ms-dropdown-menu");
            if (!menu) return;
            menu.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
                cb.checked = (cb.value === "__all__");
            });
            _syncLabelStates(menu);
        });

        activeFilters.types = new Set();
        activeFilters.transport = new Set();
        activeFilters.years = new Set();
        activeFilters.countries = new Set();

        _updateDropdownLabel(document.getElementById("filter-type"), tr("Alle", "All", "Kaikki"));
        _updateDropdownLabel(document.getElementById("filter-transport"), tr("Alle", "All", "Kaikki"));
        _updateDropdownLabel(document.getElementById("filter-year"), tr("Alle Jahre", "All years", "Kaikki vuodet"));
        _updateDropdownLabel(document.getElementById("filter-country"), tr("Alle Länder", "All countries", "Kaikki maat"));

        // Reset map options
        var hideBorders = document.getElementById("opt-hide-borders");
        var hideLabels = document.getElementById("opt-hide-labels");
        if (hideBorders) { hideBorders.checked = false; bordersHidden = false; applyBorders(); }
        if (hideLabels) { hideLabels.checked = false; labelsHidden = false; applyLabels(); }
        // Reset map display dropdown label and check states
        var mdMenu = document.getElementById("map-display-menu");
        if (mdMenu) { _syncLabelStates(mdMenu); _updateMapDisplayLabel(); }
        if (document.getElementById("filter-route-width")) {
            var menu = document.getElementById("route-width-menu");
            var normalRb = menu.querySelector('input[value="1.0"]');
            if (normalRb) { normalRb.checked = true; _syncRadioLabels(menu); }
            routeWidthMultiplier = 1.0;
            _updateDropdownLabel(document.getElementById("filter-route-width"), "Normal");
        }

        applyFilters();
    }

    var filterResetBtn = document.getElementById("filter-reset-btn");
    if (filterResetBtn) {
        filterResetBtn.addEventListener("click", resetFilters);
    }

    // --- Multi-select dropdowns ---

    function _readCheckedValues(menuEl) {
        var s = new Set();
        menuEl.querySelectorAll('input[type="checkbox"]:checked').forEach(function (cb) {
            if (cb.value !== "__all__") s.add(cb.value);
        });
        return s;
    }

    function _syncLabelStates(menu) {
        menu.querySelectorAll("label").forEach(function (label) {
            var cb = label.querySelector('input[type="checkbox"]');
            if (!cb) return;
            label.classList.toggle("selected", cb.checked);
            if (label.dataset.color) {
                label.style.setProperty("--label-color", label.dataset.color);
            }
        });
    }

    function _syncRadioLabels(menu) {
        menu.querySelectorAll("label").forEach(function (label) {
            var rb = label.querySelector('input[type="radio"]');
            if (!rb) return;
            label.classList.toggle("selected", rb.checked);
        });
    }

    function _updateDropdownLabel(el, allLabel) {
        var menu = el.querySelector(".ms-dropdown-menu");
        var allCb = menu.querySelector('input[value="__all__"]');
        var checkboxes = menu.querySelectorAll('input[type="checkbox"]');
        var labelEl = el.querySelector(".ms-dropdown-label");

        if (checkboxes.length === 0) {
            labelEl.textContent = tr("Keine vorhanden", "None available", "Ei saatavilla");
            return;
        }

        var checked = Array.from(menu.querySelectorAll('input[type="checkbox"]:checked'))
            .filter(function (cb) { return cb.value !== "__all__"; });

        if (!checked.length || (allCb && allCb.checked)) {
            labelEl.textContent = allLabel;
        } else if (checked.length <= 2) {
            var labels = [];
            checked.forEach(function (cb) { labels.push(cb.parentElement.textContent.trim()); });
            labelEl.textContent = labels.join(", ");
        } else {
            labelEl.textContent = checked.length + tr(" ausgewählt", " selected", " valittu");
        }
    }

    function _initDropdown(id, allLabel, onChange) {
        var el = document.getElementById(id);
        if (!el) return;
        var toggle = el.querySelector(".ms-dropdown-toggle");
        var menu = el.querySelector(".ms-dropdown-menu");
        var allCb = menu.querySelector('input[value="__all__"]');

        toggle.addEventListener("click", function (e) {
            e.stopPropagation();
            document.querySelectorAll(".ms-dropdown.open").forEach(function (d) {
                if (d !== el) d.classList.remove("open");
            });
            el.classList.toggle("open");
        });

        menu.addEventListener("click", function (e) { e.stopPropagation(); });
        menu.addEventListener("change", function (e) {
            if (!e.target.matches('input[type="checkbox"]')) return;
            var cb = e.target;

            if (cb.value === "__all__") {
                if (cb.checked) {
                    menu.querySelectorAll('input[type="checkbox"]').forEach(function (other) {
                        if (other !== cb) other.checked = false;
                    });
                } else if (allCb) {
                    // "Alle" can't be manually unchecked without picking something else
                    cb.checked = true;
                }
            } else {
                if (cb.checked && allCb) {
                    allCb.checked = false;
                } else if (!cb.checked) {
                    var anyChecked = Array.from(menu.querySelectorAll('input[type="checkbox"]:not([value="__all__"])'))
                        .some(function (c) { return c.checked; });
                    if (!anyChecked && allCb) allCb.checked = true;
                }
            }

            _updateDropdownLabel(el, allLabel);
            _syncLabelStates(menu);
            onChange(_readCheckedValues(menu));
        });

        _updateDropdownLabel(el, allLabel);
        _syncLabelStates(menu);
    }

    document.addEventListener("click", function () {
        document.querySelectorAll(".ms-dropdown.open").forEach(function (d) { d.classList.remove("open"); });
    });

    _initDropdown("filter-type", tr("Alle", "All", "Kaikki"), function (values) {
        activeFilters.types = values;
        applyFilters();
    });

    _initDropdown("filter-transport", tr("Alle", "All", "Kaikki"), function (values) {
        activeFilters.transport = values;
        applyFilters();
    });

    function _appendCheckSpan(label) {
        var check = document.createElement("span");
        check.className = "ms-check";
        check.textContent = "✓";
        label.appendChild(check);
    }

    function _appendAllOption(menu, allText, extraClass) {
        var label = document.createElement("label");
        if (extraClass) label.classList.add(extraClass);
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = "__all__";
        cb.checked = true;
        label.appendChild(cb);
        label.appendChild(document.createTextNode(allText));
        _appendCheckSpan(label);
        menu.appendChild(label);
    }

    function _populateYearOptions() {
        var years = {};
        allTrips.forEach(function (t) { if (t.year) years[t.year] = true; });
        var sortedYears = Object.keys(years).sort().reverse();

        var menu = document.getElementById("filter-year-menu");
        menu.innerHTML = "";
        _appendAllOption(menu, tr("Alle Jahre", "All years", "Kaikki vuodet"));
        sortedYears.forEach(function (y) {
            var label = document.createElement("label");
            var cb = document.createElement("input");
            cb.type = "checkbox";
            cb.value = y;
            label.appendChild(cb);
            label.appendChild(document.createTextNode(y));
            _appendCheckSpan(label);
            menu.appendChild(label);
        });

        _initDropdown("filter-year", tr("Alle Jahre", "All years", "Kaikki vuodet"), function (values) {
            activeFilters.years = values;
            applyFilters();
        });
    }

    function _populateCountryOptions() {
        var countries = {};
        allTrips.forEach(function (t) {
            if (t.destination_country) countries[t.destination_country.name] = t.destination_country.iso_a2;
        });
        var sortedNames = Object.keys(countries).sort();

        var menu = document.getElementById("filter-country-menu");
        menu.innerHTML = "";
        _appendAllOption(menu, tr("Alle", "All", "Kaikki"), "ms-flag-grid-fallback");
        sortedNames.forEach(function (name) {
            var label = document.createElement("label");
            label.title = name;
            var cb = document.createElement("input");
            cb.type = "checkbox";
            cb.value = name;
            label.appendChild(cb);
            var flag = countryFlag(countries[name]);
            if (flag) {
                label.appendChild(document.createTextNode(flag));
            } else {
                label.classList.add("ms-flag-grid-fallback");
                label.appendChild(document.createTextNode(name));
            }
            _appendCheckSpan(label);
            menu.appendChild(label);
        });

        _initDropdown("filter-country", tr("Alle Länder", "All countries", "Kaikki maat"), function (values) {
            activeFilters.countries = values;
            applyFilters();
        });
    }

    function populateFilters(trips) {
        _populateYearOptions();
        _populateCountryOptions();
    }

    // --- Helpers ---

    function transportLabel(type) {
        var labelsByLang = {
            de: { train: "Zug", car: "Auto", plane: "Flugzeug", ferry: "Fähre" },
            en: { train: "Train", car: "Car / Bus", plane: "Plane", ferry: "Ferry" },
            fi: { train: "Juna", car: "Auto / Bussi", plane: "Lentokone", ferry: "Lautta" },
        };
        var labels = labelsByLang[LANG] || labelsByLang.de;
        return labels[type] || type;
    }

    // --- Lightbox ---

    window.openLightbox = function (url) {
        document.getElementById("lightbox-img").src = url;
        document.getElementById("lightbox").classList.remove("hidden");
    };

    window.closeLightbox = function () {
        document.getElementById("lightbox").classList.add("hidden");
        document.getElementById("lightbox-img").src = "";
    };

    // --- Video Player ---

    window.openVideoPlayer = function (url) {
        var vid = document.getElementById("video-player-el");
        vid.src = url;
        document.getElementById("video-player").classList.remove("hidden");
        vid.play();
    };

    window.closeVideoPlayer = function () {
        var vid = document.getElementById("video-player-el");
        vid.pause();
        vid.src = "";
        document.getElementById("video-player").classList.add("hidden");
    };

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
            closeLightbox();
            closeVideoPlayer();
        }
    });

    // Mobile: filter drawer toggle (same slide pattern as stats toggle)
    (function () {
        var toggleBtn = document.getElementById("filter-toggle-btn");
        var panel = document.getElementById("filter-panel");
        if (toggleBtn && panel) {
            toggleBtn.addEventListener("click", function () {
                panel.classList.toggle("filter-open");
                toggleBtn.classList.toggle("filter-open");
            });
        }
    })();

    // --- Stats Panel ---
    (function () {
        var panel = document.getElementById("stats-panel");
        var toggle = document.getElementById("stats-toggle");
        if (!panel || !toggle) return;

        function formatNumber(n) {
            return n.toLocaleString(LANG === "en" ? "en-US" : (LANG === "fi" ? "fi-FI" : "de-DE"));
        }

        function renderBars(container, items, opts) {
            container.innerHTML = "";
            if (!items.length) {
                var empty = document.createElement("div");
                empty.className = "stats-empty";
                empty.textContent = tr("Noch keine Daten.", "No data yet.", "Ei vielä tietoja.");
                container.appendChild(empty);
                return;
            }
            var max = Math.max.apply(null, items.map(function (i) { return opts.value(i); }));
            items.forEach(function (item) {
                var value = opts.value(item);

                var row = document.createElement("div");
                row.className = "stats-bar-row";

                var labels = document.createElement("div");
                labels.className = "stats-bar-row-labels";
                var name = document.createElement("span");
                name.className = "stats-bar-row-name";
                name.textContent = opts.name(item);
                var val = document.createElement("span");
                val.className = "stats-bar-row-value";
                val.textContent = opts.formatValue(value);
                labels.appendChild(name);
                labels.appendChild(val);

                var track = document.createElement("div");
                track.className = "stats-bar-track";
                var fill = document.createElement("div");
                fill.className = "stats-bar-fill";
                fill.style.width = (max > 0 ? (value / max) * 100 : 0) + "%";
                if (opts.color) fill.style.background = opts.color(item);
                track.appendChild(fill);

                row.appendChild(labels);
                row.appendChild(track);
                container.appendChild(row);
            });
        }

        function renderSummary(summary) {
            var container = document.getElementById("stats-summary");
            container.innerHTML = "";
            var tiles = [
                { value: formatNumber(summary.total_distance_km) + " km", label: tr("Gesamtstrecke", "Total Distance", "Kokonaismatka") },
                { value: summary.countries_visited, label: tr("Länder", "Countries", "Maat") },
                { value: summary.total_trips, label: tr("Reisen", "Trips", "Matkat") },
                { value: summary.total_photos, label: tr("Fotos", "Photos", "Kuvat") },
            ];
            tiles.forEach(function (t) {
                var tile = document.createElement("div");
                tile.className = "stat-tile";
                var value = document.createElement("div");
                value.className = "stat-value";
                value.textContent = t.value;
                var label = document.createElement("div");
                label.className = "stat-label";
                label.textContent = t.label;
                tile.appendChild(value);
                tile.appendChild(label);
                container.appendChild(tile);
            });
        }

        function loadStats() {
            if (!config.statsUrl) return;
            var qs = _buildStatsParams().toString();

            fetch(config.statsUrl + (qs ? "?" + qs : ""))
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    renderSummary(data.summary);
                    renderBars(document.getElementById("stats-countries"), data.images_by_country, {
                        name: function (i) { return i.country; },
                        value: function (i) { return i.count; },
                        formatValue: function (v) { return formatNumber(v); },
                    });
                    renderBars(
                        document.getElementById("stats-transport"),
                        data.distance_by_transport.filter(function (i) { return i.km > 0; }),
                        {
                            name: function (i) { return i.label; },
                            value: function (i) { return i.km; },
                            formatValue: function (v) { return formatNumber(v) + " km"; },
                            color: function (i) { return i.color; },
                        }
                    );
                    if (data.yearly_stats && data.yearly_stats.length > 1) {
                        var yearlyMode = document.getElementById("stats-yearly")._mode || "trips";
                        document.getElementById("stats-yearly")._data = data.yearly_stats;
                        renderYearlyBars(data.yearly_stats, yearlyMode);
                        var yearlySection = document.getElementById("stats-yearly").parentElement;
                        var existingToggle = yearlySection.querySelector(".yearly-toggle");
                        if (!existingToggle) {
                            var btn = document.createElement("button");
                            btn.type = "button";
                            btn.className = "yearly-toggle";
                            btn.style.cssText = "font-size:0.75rem;padding:2px 8px;border:1px solid var(--color-border);border-radius:4px;background:var(--color-surface);color:var(--color-text);cursor:pointer;margin-bottom:0.5rem;";
                            btn.textContent = tr("km", "km", "km");
                            btn.addEventListener("click", function() {
                                var current = document.getElementById("stats-yearly")._mode || "trips";
                                var next = current === "trips" ? "km" : "trips";
                                document.getElementById("stats-yearly")._mode = next;
                                btn.textContent = next === "trips" ? tr("km", "km", "km") : tr("Reisen", "Trips", "Matkat");
                                renderYearlyBars(document.getElementById("stats-yearly")._data, next);
                            });
                            var heading = yearlySection.querySelector("h4");
                            if (heading) heading.appendChild(btn);
                        }
                    }

                    function renderYearlyBars(stats, mode) {
                        renderBars(document.getElementById("stats-yearly"), stats, {
                            name: function (i) { return i.year; },
                            value: function (i) { return mode === "km" ? (i.distance_km || 0) : i.trips; },
                            formatValue: function (v) { return mode === "km" ? formatNumber(v) + " km" : v + " " + tr("Reisen", "trips", "matkaa"); },
                        });
                    }
                });

            if (config.visitedCountriesUrl) {
                fetch(config.visitedCountriesUrl + (qs ? "?" + qs : ""))
                    .then(function (r) { return r.json(); })
                    .then(renderVisitedList);
            }
        }

        refreshStatsIfOpen = function () {
            if (panel.classList.contains("stats-open")) loadStats();
        };

        toggle.addEventListener("click", function () {
            var willOpen = !panel.classList.contains("stats-open");
            panel.classList.toggle("stats-open");
            if (willOpen) {
                loadStats();
            }
        });
    })();

    // --- Map Options (borders, labels, route thickness) ---
    (function () {
        var borderLayers = [];
        var labelLayers = [];

        // Discover border and label layers from the style
        function discoverLayers() {
            var style = map.getStyle();
            if (!style || !style.layers) return;
            borderLayers = [];
            labelLayers = [];
            style.layers.forEach(function (layer) {
                var id = layer.id || "";
                // Carto dark-matter-gl style uses these naming conventions
                if (id.indexOf("admin") !== -1 || id.indexOf("boundary") !== -1) {
                    borderLayers.push(id);
                }
                if (id.indexOf("label") !== -1 || id.indexOf("place") !== -1 || id.indexOf("road") !== -1) {
                    // Only match text/symbol label layers, not line layers
                    if (layer.type === "symbol") {
                        labelLayers.push(id);
                    }
                }
            });
        }

        var bordersHidden = false;
        var labelsHidden = false;

        function applyBorders() {
            if (borderLayers.length === 0) discoverLayers();
            borderLayers.forEach(function (id) {
                if (map.getLayer(id)) {
                    map.setLayoutProperty(id, "visibility", bordersHidden ? "none" : "visible");
                }
            });
        }

        function applyLabels() {
            if (labelLayers.length === 0) discoverLayers();
            labelLayers.forEach(function (id) {
                if (map.getLayer(id)) {
                    map.setLayoutProperty(id, "visibility", labelsHidden ? "none" : "visible");
                }
            });
        }

        var hideBorders = document.getElementById("opt-hide-borders");
        var hideLabels = document.getElementById("opt-hide-labels");

        // Map display options dropdown (borders + labels checkboxes)
        var mdDropdown = document.getElementById("filter-map-display");
        var mdMenu = document.getElementById("map-display-menu");
        if (mdDropdown && mdMenu) {
            var mdToggle = mdDropdown.querySelector(".ms-dropdown-toggle");
            mdToggle.addEventListener("click", function (e) {
                e.stopPropagation();
                document.querySelectorAll(".ms-dropdown.open").forEach(function (d) { d.classList.remove("open"); });
                mdDropdown.classList.toggle("open");
            });
            mdMenu.addEventListener("click", function (e) { e.stopPropagation(); });
            mdMenu.addEventListener("change", function () {
                _syncLabelStates(mdMenu);
                _updateMapDisplayLabel();
            });
        }

        function _updateMapDisplayLabel() {
            if (!mdDropdown) return;
            var checked = [];
            if (hideBorders && hideBorders.checked) checked.push(1);
            if (hideLabels && hideLabels.checked) checked.push(1);
            var labelEl = mdDropdown.querySelector(".ms-dropdown-label");
            if (!labelEl) return;
            if (checked.length === 0) {
                labelEl.textContent = tr("Standard", "Default", "Oletus");
            } else if (checked.length === 1) {
                labelEl.textContent = tr("1 Option aktiv", "1 option active", "1 valinta aktiivinen");
            } else {
                labelEl.textContent = checked.length + " " + tr("Optionen aktiv", "options active", "valintaa aktiivisena");
            }
        }

        if (hideBorders) {
            hideBorders.addEventListener("change", function () {
                bordersHidden = hideBorders.checked;
                applyBorders();
                _updateMapDisplayLabel();
            });
        }

        if (hideLabels) {
            hideLabels.addEventListener("change", function () {
                labelsHidden = hideLabels.checked;
                applyLabels();
                _updateMapDisplayLabel();
            });
        }

        // Route width dropdown (radio buttons)
        var rwDropdown = document.getElementById("filter-route-width");
        if (rwDropdown) {
            var rwToggle = rwDropdown.querySelector(".ms-dropdown-toggle");
            var rwMenu = document.getElementById("route-width-menu");
            rwToggle.addEventListener("click", function (e) {
                e.stopPropagation();
                document.querySelectorAll(".ms-dropdown.open").forEach(function (d) { d.classList.remove("open"); });
                rwDropdown.classList.toggle("open");
            });
            rwMenu.addEventListener("click", function (e) { e.stopPropagation(); });
            rwMenu.addEventListener("change", function () {
                var checked = rwMenu.querySelector('input[name="route-width"]:checked');
                if (checked) {
                    routeWidthMultiplier = parseFloat(checked.value);
                    _syncRadioLabels(rwMenu);
                    _updateDropdownLabel(rwDropdown, checked.parentElement.textContent.trim());
                    if (allRoutesGeoJSON) applyFilters();
                }
            });
        }

        // Discover layers once the style is loaded
        map.on("style.load", function () {
            discoverLayers();
        });
    })();

    // --- Init ---
    map.on("load", function () {
        map.addImage("label-bg", {
            width: 1, height: 1,
            data: new Uint8Array([14, 14, 14, 224]),
        });
        _initRouteInteractions();
        loadTrips();
    });
})();
