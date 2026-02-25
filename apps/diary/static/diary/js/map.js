(function () {
    "use strict";

    var config = document.getElementById("map-config").dataset;

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
        style: {
            version: 8,
            projection: { type: "globe" },
            sources: {
                "carto-dark": {
                    type: "raster",
                    tiles: [
                        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
                        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
                        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
                        "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
                    ],
                    tileSize: 256,
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
                },
            },
            layers: [
                {
                    id: "carto-dark-layer",
                    type: "raster",
                    source: "carto-dark",
                },
            ],
        },
        center: [10.4515, 51.1657],
        zoom: 5,
        attributionControl: true,
    });

    // State
    var allTrips = [];
    var imageMarkers = [];
    var activeFilters = {
        transport: { train: true, car: true, plane: true, ferry: true },
        year: "",
        tripId: "",
        showJourneys: true,
        showEvents: true,
    };
    var currentPopup = null;

    // --- Data fetching ---

    function loadTrips() {
        fetch(config.tripsUrl)
            .then(function (r) { return r.json(); })
            .then(function (trips) {
                allTrips = trips;
                populateFilters(trips);
                loadRoutes();
                showTripMarkers();
            });
    }

    function loadRoutes(callback) {
        var params = new URLSearchParams();
        if (activeFilters.year) params.set("year", activeFilters.year);
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
            .then(function (geojson) { renderImages(geojson); });
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
                "circle-radius": 3.5,
                "circle-color": ["case", ["get", "isEvent"], "#FF9800", "#ffffff"],
                "circle-stroke-width": 3,
                "circle-stroke-color": ["case", ["get", "isEvent"], "#c8660a", "#6c9bcf"],
            },
        });

        map.addLayer({
            id: "trip-labels",
            type: "symbol",
            source: "trips-source",
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

    function showTripMarkers(shouldZoom) {
        clearImageMarkers();

        var filteredTrips = allTrips.filter(function (t) {
            if (activeFilters.year && String(t.year) !== activeFilters.year) return false;
            if (t.is_event && !activeFilters.showEvents) return false;
            if (!t.is_event && !activeFilters.showJourneys) return false;
            return true;
        });

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
        if (map.getLayer("images-layer")) map.removeLayer("images-layer");
        if (map.getSource("images")) map.removeSource("images");

        if (!geojson || !geojson.features || geojson.features.length === 0) return;

        var offsets = computeImageOffsets(geojson.features);

        geojson.features.forEach(function (feature, i) {
            if (!feature.geometry || !feature.geometry.coordinates) return;
            var coords = feature.geometry.coordinates;
            var props = feature.properties;
            var imgUrl = props.image_url || "";
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
            img.src = imgUrl;
            img.alt = caption;
            img.style.width = "100%";
            img.style.height = "100%";
            img.style.objectFit = "cover";
            el.appendChild(img);

            el.addEventListener("click", function (e) {
                e.stopPropagation();
                openLightbox(imgUrl);
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
                "line-width": type === "plane" ? 1.5 : 2,
                "line-opacity": 0.9,
            };
            if (ROUTE_DASH[type]) {
                paint["line-dasharray"] = ROUTE_DASH[type];
            }

            map.addLayer({
                id: "route-" + type,
                type: "line",
                source: "routes-" + type,
                paint: paint,
                layout: {
                    visibility: (activeFilters.showJourneys && activeFilters.transport[type]) ? "visible" : "none",
                },
            }, map.getLayer("trip-circles") ? "trip-circles" : undefined);
        });

        ["train", "car", "plane", "ferry"].forEach(function (type) {
            if (!map.getLayer("route-" + type)) return;

            map.on("click", "route-" + type, function (e) {
                var props = e.features[0].properties;
                var html = "<b>" + (props.trip_title || "Reise") + "</b><br>" + transportLabel(props.transport_type);
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
    }

    // --- Trip Info Box ---

    function showTripInfo(trip) {
        var infoEl = document.getElementById("trip-info");
        var transportBadges = (trip.transport_types || []).map(function (t) {
            return '<span style="display:inline-block;padding:0.1rem 0.4rem;border-radius:3px;font-size:0.7rem;margin-right:0.25rem;background:' +
                (ROUTE_COLORS[t] || "#999") + '33;color:' + (ROUTE_COLORS[t] || "#999") + '">' +
                transportLabel(t) + '</span>';
        }).join("");

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
        }

        document.querySelectorAll(".trip-item").forEach(function (el) {
            el.classList.toggle("active", el.dataset.tripId === String(tripId));
        });

        if (!tripId) {
            clearImageMarkers();
            loadRoutes();
            showTripMarkers();
            hideTripInfo();
            return;
        }

        clearTripMarkers();
        loadRoutes();
        loadImagesForTrip(tripId);

        var trip = allTrips.find(function (t) { return t.id === tripId; });
        if (trip) {
            showTripInfo(trip);
        }

        zoomToTripContent(tripId);
    }

    function zoomToTripContent(tripId) {
        var imageUrl = config.imagesUrl + "?trip_id=" + tripId;

        fetch(imageUrl).then(function (r) { return r.json(); }).then(function (imageGeoJSON) {
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
                map.fitBounds(bounds, { padding: 60, maxZoom: 12 });
            }
        });
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

    function renderTripList(trips) {
        var tripList = document.getElementById("trip-list");
        tripList.innerHTML = "";

        var allItem = document.createElement("div");
        allItem.className = "trip-item" + (activeFilters.tripId === "" ? " active" : "");
        allItem.textContent = "Alle";
        allItem.dataset.tripId = "";
        allItem.addEventListener("click", function () { selectTrip(""); });
        tripList.appendChild(allItem);

        var filtered = trips.filter(function (t) {
            if (t.is_event && !activeFilters.showEvents) return false;
            if (!t.is_event && !activeFilters.showJourneys) return false;
            return true;
        });

        filtered.sort(function (a, b) {
            var da = a.travel_date || "";
            var db = b.travel_date || "";
            return da > db ? -1 : da < db ? 1 : 0;
        });

        filtered.forEach(function (t) { tripList.appendChild(_makeTripItem(t)); });
    }

    // --- Filters ---

    function _repopulateYears() {
        var years = {};
        allTrips.forEach(function (t) {
            if (t.is_event && !activeFilters.showEvents) return;
            if (!t.is_event && !activeFilters.showJourneys) return;
            if (t.year) years[t.year] = true;
        });
        var yearSelect = document.getElementById("year-filter");
        var currentYear = yearSelect.value;
        while (yearSelect.options.length > 1) yearSelect.remove(1);
        Object.keys(years).sort().reverse().forEach(function (y) {
            var opt = document.createElement("option");
            opt.value = y;
            opt.textContent = y;
            yearSelect.appendChild(opt);
        });
        if (years[currentYear]) {
            yearSelect.value = currentYear;
        } else {
            yearSelect.value = "";
            activeFilters.year = "";
        }
    }

    function populateFilters(trips) {
        _repopulateYears();
        renderTripList(trips);
    }

    // Type checkboxes
    function _applyTypeFilter() {
        _repopulateYears();
        var filtered = allTrips.filter(function (t) {
            return !activeFilters.year || String(t.year) === activeFilters.year;
        });
        renderTripList(filtered);
        showTripMarkers(false);
    }

    document.getElementById("filter-type-journey").addEventListener("change", function () {
        activeFilters.showJourneys = this.checked;
        var transportSection = document.getElementById("transport-filter-section");
        if (transportSection) {
            transportSection.style.display = activeFilters.showJourneys ? "" : "none";
        }
        ["train", "car", "plane", "ferry"].forEach(function (type) {
            if (map.getLayer("route-" + type)) {
                var visible = activeFilters.showJourneys && activeFilters.transport[type];
                map.setLayoutProperty("route-" + type, "visibility", visible ? "visible" : "none");
            }
        });
        _applyTypeFilter();
    });

    document.getElementById("filter-type-event").addEventListener("change", function () {
        activeFilters.showEvents = this.checked;
        _applyTypeFilter();
    });

    // Transport checkboxes
    document.querySelectorAll("[data-transport]").forEach(function (cb) {
        cb.addEventListener("change", function () {
            var type = this.dataset.transport;
            activeFilters.transport[type] = this.checked;
            if (map.getLayer("route-" + type)) {
                map.setLayoutProperty("route-" + type, "visibility", this.checked ? "visible" : "none");
            }
        });
    });

    // Year select
    document.getElementById("year-filter").addEventListener("change", function () {
        activeFilters.year = this.value;
        activeFilters.tripId = "";
        var filtered = allTrips.filter(function (t) {
            return !activeFilters.year || String(t.year) === activeFilters.year;
        });
        renderTripList(filtered);
        loadRoutes(function (geojson) {
            var bounds = new maplibregl.LngLatBounds();
            // Include route geometries only when journeys are visible
            if (activeFilters.showJourneys && geojson && geojson.features) {
                geojson.features.forEach(function (f) {
                    if (!f.geometry || !f.geometry.coordinates) return;
                    f.geometry.coordinates.forEach(function (c) { bounds.extend(c); });
                });
            }
            // Include visible trip/event marker positions
            filtered.forEach(function (t) {
                if (!t.lat || !t.lng) return;
                if (t.is_event && !activeFilters.showEvents) return;
                if (!t.is_event && !activeFilters.showJourneys) return;
                bounds.extend([t.lng, t.lat]);
            });
            if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60 });
        });
        showTripMarkers(false);
    });

    // --- Helpers ---

    function transportLabel(type) {
        var labels = { train: "Zug", car: "Auto", plane: "Flugzeug", ferry: "Fähre" };
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

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeLightbox();
    });

    // Mobile: filter drawer toggle
    (function () {
        if (!window.matchMedia("(max-width: 768px)").matches) return;
        var panel = document.getElementById("filter-panel");
        panel.querySelector("h3").addEventListener("click", function () {
            panel.classList.toggle("filter-open");
        });
    })();

    // --- Init ---
    map.on("load", function () {
        map.addImage("label-bg", {
            width: 1, height: 1,
            data: new Uint8Array([14, 14, 14, 224]),
        });
        loadTrips();
    });
})();
