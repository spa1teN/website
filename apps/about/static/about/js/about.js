(function () {
    "use strict";

    var config = document.getElementById("about-config").dataset;
    var stations = JSON.parse(document.getElementById("about-stations").textContent);
    var counterLabel = config.counterLabel;

    var storyPanel = document.getElementById("story-panel");
    var stationTitle = document.getElementById("station-title");
    var stationCounter = document.getElementById("station-counter");
    var stationBody = document.getElementById("station-body");
    var prevBtn = document.getElementById("station-prev");
    var nextBtn = document.getElementById("station-next");
    var dotsWrap = document.getElementById("station-dots");
    var dots = dotsWrap.getElementsByClassName("station-dot");

    var currentIndex = -1;
    var countries = {};   // iso_a2 -> Feature
    var mapReady = false;
    var isMobile = window.matchMedia("(max-width: 768px)").matches;
    var popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true });

    // Kamera-Flüge: lang und sanft (easeInOutQuint)
    var MOVE_DURATION = 3000;
    var navSeq = 0;   // Schutz gegen veraltete Flug-Ketten bei schnellen Klicks
    var flightRAF = null;   // laufende Flug-Animation (für Abbruch)
    function easeInOutQuint(t) {
        return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
    }

    // Statische Karte: Gesten und Tastatur sind deaktiviert (Pfeiltasten bleiben
    // frei für die Stations-Navigation), Marker sind aber anklickbar.
    var map = new maplibregl.Map({
        container: "about-map",
        style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
        center: stations[0].map.center,
        zoom: stations[0].map.zoom,
        scrollZoom: false,
        dragPan: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchZoomRotate: false,
        doubleClickZoom: false,
        keyboard: false,
        attributionControl: false,
        renderWorldCopies: false,
    });

    map.on("style.load", function () {
        map.setProjection({ type: "globe" });
        try { map.setSky({ "atmosphere-blend": 0.85 }); } catch (e) {}
    });

    // Verbindungslinie bei jeder Kamerabewegung mitziehen
    map.on("move", updateLine);
    map.on("render", updateLine);

    map.on("load", function () {
        map.addSource("station-countries", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
        });
        map.addSource("station-markers", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
        });

        // Länder-Hervorhebung (unter den Markern)
        map.addLayer({
            id: "station-highlight-fill",
            type: "fill",
            source: "station-countries",
            layout: { visibility: "none" },
            paint: {
                "fill-color": "#6c9bcf",
                "fill-opacity": 0.55,
            },
        });
        map.addLayer({
            id: "station-highlight-outline",
            type: "line",
            source: "station-countries",
            layout: { visibility: "none" },
            paint: {
                "line-color": "#6c9bcf",
                "line-width": 0.75,
            },
        });

        // Marker: Pulsring + Kern
        map.addLayer({
            id: "station-marker-pulse",
            type: "circle",
            source: "station-markers",
            paint: {
                "circle-color": "#FF9800",
                "circle-radius": 4,
                "circle-opacity": 0,
            },
        });
        map.addLayer({
            id: "station-marker-core",
            type: "circle",
            source: "station-markers",
            paint: {
                "circle-color": "#FF9800",
                "circle-radius": 4,
                "circle-stroke-color": "#ffffff",
                "circle-stroke-width": 2,
            },
        });

        // Klick auf einen Punkt-Marker öffnet ein Popup mit dem Stations-Bild
        map.on("click", function (e) {
            var station = stations[currentIndex];
            var hits = map.queryRenderedFeatures(e.point, { layers: ["station-marker-core"] });
            if (hits.length > 0) {
                openStationPopup(station, hits[0].geometry.coordinates);
            } else {
                popup.remove();
            }
        });
        map.on("mouseenter", "station-marker-core", function () {
            map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "station-marker-core", function () {
            map.getCanvas().style.cursor = "";
        });

        mapReady = true;
        updateMapPadding();
        // Panel wird schon vor dem Karten-Load gerendert — hier folgt die Karte
        applyMapState(stations[currentIndex], false);
        loadCountries();
    });

    function loadCountries() {
        fetch(config.countriesUrl)
            .then(function (res) { return res.json(); })
            .then(function (fc) {
                fc.features.forEach(function (f) {
                    countries[f.properties.iso_a2] = f;
                });
                // fit_bounds-Stationen brauchen die Polygon-Bounds; Highlights
                // hier erneut setzen, falls applyMapState vor dem Fetch lief
                var station = stations[currentIndex];
                if (mapReady) {
                    setHighlightCountries(station.map.highlight_countries);
                    if (station.map.fit_bounds) {
                        moveCamera(station, false);
                    }
                }
            })
            .catch(function (err) {
                console.warn("Länder-GeoJSON konnte nicht geladen werden:", err);
            });
    }

    function setMarkers(markers) {
        var features = markers.map(function (m) {
            return {
                type: "Feature",
                geometry: { type: "Point", coordinates: [m.lng, m.lat] },
                properties: {},
            };
        });
        map.getSource("station-markers").setData({
            type: "FeatureCollection",
            features: features,
        });
    }

    // Stationen mit Bild: Thumbnail als Callout über dem Marker-Punkt, mit einer
    // Linie verbunden. Der Punkt-Marker bleibt sichtbar.
    var domMarkers = [];
    var THUMB_GAP = 28;   // Abstand Bild-Unterkante → Marker-Punkt (Linienlänge)

    function clearDomMarkers() {
        domMarkers.forEach(function (m) { m.remove(); });
        domMarkers = [];
    }

    function renderMarkerElements(station) {
        clearDomMarkers();
        hideLine();
        if (!station.image || !station.map.markers) return;
        station.map.markers.forEach(function (m) {
            var wrap = document.createElement("div");
            wrap.className = "about-marker-wrap";

            var isLogo = station.image.kind === "logo";
            var thumb = document.createElement("div");
            thumb.className = "about-marker-thumb" + (isLogo ? " logo" : "");
            thumb.style.transform = "translateY(-" + THUMB_GAP + "px)";

            var img = document.createElement("img");
            img.src = station.image.url;
            img.alt = station.image.alt;
            img.className = isLogo ? "logo" : "";
            thumb.appendChild(img);
            wrap.appendChild(thumb);

            wrap.addEventListener("click", function (e) {
                e.stopPropagation();
                openStationPopup(station, [m.lng, m.lat]);
            });

            domMarkers.push(
                new maplibregl.Marker({ element: wrap, anchor: "bottom" })
                    .setLngLat([m.lng, m.lat])
                    .addTo(map)
            );

            showLine([m.lng, m.lat]);
        });
    }

    // Verbindungslinie Bild ↔ Marker-Punkt (SVG-Overlay über der Karte)
    var lineSvg = null;
    var lineEl = null;
    var lineAnchor = null;

    function ensureLine() {
        if (lineSvg) return;
        lineSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        lineSvg.setAttribute("class", "about-marker-line");
        lineEl = document.createElementNS("http://www.w3.org/2000/svg", "line");
        lineEl.setAttribute("stroke", "#FF9800");
        lineEl.setAttribute("stroke-width", 2);
        lineEl.setAttribute("stroke-dasharray", "5 5");
        lineSvg.appendChild(lineEl);
        map.getContainer().appendChild(lineSvg);
    }

    function showLine(lngLat) {
        ensureLine();
        lineAnchor = lngLat;
        lineSvg.style.display = "";
        updateLine();
    }

    function hideLine() {
        lineAnchor = null;
        if (lineSvg) lineSvg.style.display = "none";
    }

    function updateLine() {
        if (!lineSvg || !lineAnchor) return;
        var p = map.project(lineAnchor);
        lineEl.setAttribute("x1", p.x);
        lineEl.setAttribute("y1", p.y - THUMB_GAP);
        lineEl.setAttribute("x2", p.x);
        lineEl.setAttribute("y2", p.y);
    }

    function openStationPopup(station, lngLat) {
        if (!station.image) return;
        var img = document.createElement("img");
        img.src = station.image.url;
        img.alt = station.image.alt;
        img.className = "station-popup-img" + (station.image.kind === "logo" ? " logo" : "");
        popup.setDOMContent(img).setLngLat(lngLat).addTo(map);
    }

    function setHighlightCountries(isoList) {
        var features = isoList
            .map(function (iso) { return countries[iso]; })
            .filter(function (f) { return !!f; });
        map.getSource("station-countries").setData({
            type: "FeatureCollection",
            features: features,
        });
    }

    // Auf Mobile liegt das Story-Panel als Bottom-Sheet über der Karte.
    // Asymmetrisches Map-Padding hält Marker/Länder im sichtbaren Bereich.
    function updateMapPadding() {
        if (isMobile) {
            map.setPadding({ top: 0, right: 0, bottom: storyPanel.offsetHeight, left: 0 });
        } else {
            map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
        }
    }

    function computeBounds(isoList) {
        var minLng = Infinity, minLat = Infinity;
        var maxLng = -Infinity, maxLat = -Infinity;
        var found = false;
        isoList.forEach(function (iso) {
            var f = countries[iso];
            if (!f) return;
            found = true;
            f.geometry.coordinates.forEach(function (polygon) {
                polygon.forEach(function (ring) {
                    ring.forEach(function (c) {
                        if (c[0] < minLng) minLng = c[0];
                        if (c[0] > maxLng) maxLng = c[0];
                        if (c[1] < minLat) minLat = c[1];
                        if (c[1] > maxLat) maxLat = c[1];
                    });
                });
            });
        });
        if (!found) return null;
        return [[minLng, minLat], [maxLng, maxLat]];
    }

    // Kamera für hervorgehobene Länder. map.fitBounds ist Mercator-basiert und
    // platziert auf der Globe-Projektion schief (ungleiche Ränder). Stattdessen
    // wird die Zoomstufe per Messung der projizierten Bounds gesucht und die
    // Kamera auf die Mitte der Bounds zentriert — so sind die Ränder symmetrisch.
    // Kamera so berechnen, dass die Bounds symmetrisch und innerhalb der Ränder
    // liegen. Auf der Globe-Projektion liefert die erste Messung von einer stark
    // abweichenden Kamera ein verzerrtes Ergebnis — mehrfach wiederholen, bis
    // die Kamera konvergiert. Hinterlässt die Karte auf der berechneten Kamera.
    function computeFitCamera(bounds, margin) {
        var sw = bounds[0], ne = bounds[1];
        var center = { lng: (sw[0] + ne[0]) / 2, lat: (sw[1] + ne[1]) / 2 };

        var pad = map.getPadding();
        var container = map.getContainer();
        var availW = container.clientWidth - pad.left - pad.right - 2 * margin;
        var availH = container.clientHeight - pad.top - pad.bottom - 2 * margin;

        function measure(c, z) {
            map.jumpTo({ center: c, zoom: z });
            var pts = [sw, ne, [sw[0], ne[1]], [ne[0], sw[1]]].map(function (p) {
                var pr = map.project(p);
                return [pr.x, pr.y];
            });
            var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            pts.forEach(function (p) {
                if (p[0] < minX) minX = p[0];
                if (p[0] > maxX) maxX = p[0];
                if (p[1] < minY) minY = p[1];
                if (p[1] > maxY) maxY = p[1];
            });
            return { w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
        }

        // Grobe Start-Zoomstufe: größte Zoomstufe, bei der die Bounds (um die
        // geografische Mitte) in den verfügbaren Bereich passen.
        var lo = 0, hi = 22;
        for (var i = 0; i < 14; i++) {
            var midz = (lo + hi) / 2;
            var em = measure(center, midz);
            if (em.w <= availW && em.h <= availH) lo = midz;
            else hi = midz;
        }
        var zoom = lo;
        var e = measure(center, zoom);

        // Globe-Projektion ist nicht linear: zentrieren und Zoom nachjustieren,
        // bis die Bounds symmetrisch und innerhalb der Ränder liegen.
        for (var it = 0; it < 4; it++) {
            center = map.unproject([e.cx, e.cy]);
            var over = Math.max(e.w / availW, e.h / availH);
            if (over > 1) zoom -= Math.log2(over);
            zoom -= 0.02;
            e = measure(center, zoom);
        }

        return { center: center, zoom: zoom };
    }

    // Kamera für Bounds per Messung ermitteln (mehrere Frames, bis stabil).
    // Liefert ein Promise mit der berechneten Kamera; hinterlässt die Karte
    // auf dieser Kamera.
    function refineCamera(bounds, margin, seq) {
        return new Promise(function (resolve) {
            function next(prev, pass) {
                map.once("render", function () {
                    var cam = computeFitCamera(bounds, margin);
                    var settled = Math.abs(cam.zoom - prev.zoom) < 0.001 &&
                        Math.abs(cam.center.lat - prev.center.lat) < 0.001 &&
                        Math.abs(cam.center.lng - prev.center.lng) < 0.001;
                    if (settled || pass >= 3) {
                        resolve(cam);
                    } else {
                        map.jumpTo(cam);
                        next(cam, pass + 1);
                    }
                });
            }
            map.once("render", function () {
                var cam = computeFitCamera(bounds, margin);
                map.jumpTo(cam);
                next(cam, 0);
            });
            map.triggerRepaint();
        });
    }

    // Kamera, die beide Punkte zusammen zeigt (analytische Näherung, ohne die
    // Karte zu bewegen — nur als Durchflugspunkt für die Animation gedacht).
    function computeApex(src, dest) {
        var center = { lng: (src[0] + dest[0]) / 2, lat: (src[1] + dest[1]) / 2 };
        var midLat = center.lat * Math.PI / 180;
        var spanDeg = Math.max(
            Math.abs(src[0] - dest[0]) * Math.cos(midLat),
            Math.abs(src[1] - dest[1])
        );
        var pad = map.getPadding();
        var avail = Math.min(
            map.getContainer().clientWidth - 2 * 60,
            map.getContainer().clientHeight - pad.bottom - 2 * 60
        );
        var zoom = Math.log2(avail * 360 / (256 * spanDeg));
        return { center: center, zoom: zoom };
    }

    // Ein kontinuierlicher, flüssiger Flug: Start → Ziel in einem Zug, mit
    // sanftem Ausschwenken zur Überblicks-Kamera (beide Orte sichtbar) in der
    // Mitte. Landet exakt auf der Zielkamera. Kein Pause, kein zweiter Flug.
    function smoothFly(start, target, apex, duration) {
        if (flightRAF) cancelAnimationFrame(flightRAF);
        var t0 = performance.now();
        function frame(now) {
            var t = Math.min(1, (now - t0) / duration);
            var e = easeInOutQuint(t);
            var center = {
                lng: start.center.lng + (target.center.lng - start.center.lng) * e,
                lat: start.center.lat + (target.center.lat - start.center.lat) * e,
            };
            var z = start.zoom + (target.zoom - start.zoom) * e;
            // Ausschwenken nur, wenn der Überblick deutlich weiter draußen liegt.
            // sin²(πt): Steigung 0 an Start/Ziel → sanfter, nahtloser Abflug
            // und Landung (die Zoom-Geschwindigkeit ist überall stetig).
            if (apex && apex.zoom < Math.min(start.zoom, target.zoom) - 0.4) {
                var bump = Math.sin(Math.PI * t) * Math.sin(Math.PI * t);
                var midZ = (start.zoom + target.zoom) / 2;
                z -= bump * (midZ - apex.zoom);
            }
            map.jumpTo({ center: center, zoom: z });
            if (t < 1) {
                flightRAF = requestAnimationFrame(frame);
            } else {
                flightRAF = null;
            }
        }
        flightRAF = requestAnimationFrame(frame);
    }

    function moveCamera(station, animate) {
        navSeq++;
        var seq = navSeq;
        if (flightRAF) cancelAnimationFrame(flightRAF);
        var start = { center: map.getCenter(), zoom: map.getZoom() };
        var fit = station.map.fit_bounds;
        var bounds = fit ? computeBounds(station.map.highlight_countries) : null;
        // map.center kommt als [lng, lat]-Array — für die Animation als
        // {lng, lat}-Objekt normalisieren.
        var mc = station.map.center;
        var target = { center: { lng: mc[0], lat: mc[1] }, zoom: station.map.zoom };

        if (!animate) {
            if (fit && bounds) {
                refineCamera(bounds, 60, seq);  // lässt die Karte auf der Kamera stehen
            } else {
                map.jumpTo(target);
            }
            return;
        }

        // Länder-Überblick (fit_bounds): Ziel per Messung ermitteln, dann ein
        // durchgehender Flug ohne Ausschwenken (Ziel zeigt schon alles).
        if (fit && bounds) {
            refineCamera(bounds, 60, seq).then(function (t) {
                if (seq !== navSeq) return;
                map.jumpTo(start);
                smoothFly(start, t, null, MOVE_DURATION);
            });
            return;
        }

        // Punkt-zu-Punkt: im Mittelflug ausschwenken, sodass Start und Ziel
        // gemeinsam sichtbar sind, dann hinein — als EINE Bewegung.
        var dest = station.map.markers && station.map.markers.length ? station.map.markers[0] : null;
        var apex = null;
        if (dest) {
            var src = [start.center.lng, start.center.lat];
            apex = computeApex(src, [dest.lng, dest.lat]);
        }
        smoothFly(start, target, apex, MOVE_DURATION);
    }

    function renderPanel(station, i) {
        stationTitle.textContent = station.title;
        stationCounter.textContent = counterLabel + " " + (i + 1) + "/" + stations.length;
        stationBody.textContent = station.body;
    }

    function updateNav() {
        prevBtn.disabled = currentIndex === 0;
        nextBtn.disabled = currentIndex === stations.length - 1;
        for (var i = 0; i < dots.length; i++) {
            var active = i === currentIndex;
            dots[i].classList.toggle("active", active);
            dots[i].setAttribute("aria-selected", active ? "true" : "false");
        }
    }

    // Karten-Zustand einer Station (Marker, Highlights, Kamera, Puls)
    function applyMapState(station, animate) {
        renderMarkerElements(station);
        setMarkers(station.map.markers);
        map.setLayoutProperty("station-marker-pulse", "visibility", "visible");
        map.setLayoutProperty("station-marker-core", "visibility", "visible");
        setHighlightCountries(station.map.highlight_countries);
        var visible = station.map.highlight_countries.length > 0 ? "visible" : "none";
        map.setLayoutProperty("station-highlight-fill", "visibility", visible);
        map.setLayoutProperty("station-highlight-outline", "visibility", visible);
        moveCamera(station, animate);
        if (animate && station.map.markers.length > 0) {
            startPulse();
        }
    }

    function showStation(i, opts) {
        opts = opts || {};
        if (i < 0) i = 0;
        if (i >= stations.length) i = stations.length - 1;
        currentIndex = i;
        popup.remove();
        var station = stations[i];

        // Panel sofort rendern — unabhängig vom Karten-Ladezustand
        renderPanel(station, i);
        updateNav();
        storyPanel.scrollTop = 0;

        if (mapReady) {
            updateMapPadding();
            applyMapState(station, opts.animate !== false);
        }
    }

    // Pulsring um den aktiven Marker (~1.5s, danach stoppt der Loop)
    var pulseActive = false;
    var pulseStart = 0;
    function startPulse() {
        pulseActive = true;
        pulseStart = performance.now();
        requestAnimationFrame(pulseFrame);
    }
    function pulseFrame(now) {
        if (!pulseActive) return;
        var t = (now - pulseStart) / 1500;
        if (t >= 1) {
            map.setPaintProperty("station-marker-pulse", "circle-radius", 4);
            map.setPaintProperty("station-marker-pulse", "circle-opacity", 0);
            pulseActive = false;
            return;
        }
        var ease = 1 - Math.pow(1 - t, 3);   // easeOutCubic
        map.setPaintProperty("station-marker-pulse", "circle-radius", 4 + 18 * ease);
        map.setPaintProperty("station-marker-pulse", "circle-opacity", 0.45 * (1 - t));
        requestAnimationFrame(pulseFrame);
    }

    function bindControls() {
        prevBtn.addEventListener("click", function () {
            showStation(currentIndex - 1);
        });
        nextBtn.addEventListener("click", function () {
            showStation(currentIndex + 1);
        });
        dotsWrap.addEventListener("click", function (e) {
            var dot = e.target.closest(".station-dot");
            if (!dot) return;
            showStation(parseInt(dot.dataset.index, 10));
        });
        document.addEventListener("keydown", function (e) {
            if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
            var tag = document.activeElement ? document.activeElement.tagName : "";
            if (tag === "INPUT" || tag === "TEXTAREA") return;
            if (e.key === "ArrowLeft") {
                e.preventDefault();
                showStation(currentIndex - 1);
            } else if (e.key === "ArrowRight") {
                e.preventDefault();
                showStation(currentIndex + 1);
            }
        });
    }

    bindControls();

    window.addEventListener("resize", function () {
        isMobile = window.matchMedia("(max-width: 768px)").matches;
        if (mapReady) updateMapPadding();
    });

    // Deep-Link: /about/#<slug> startet direkt bei einer Station
    var initial = 0;
    var hash = location.hash.slice(1);
    for (var i = 0; i < stations.length; i++) {
        if (stations[i].slug === hash) initial = i;
    }
    showStation(initial, { animate: false });
})();
