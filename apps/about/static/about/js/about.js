(function () {
    "use strict";

    var config = document.getElementById("about-config").dataset;
    var stations = JSON.parse(document.getElementById("about-stations").textContent);
    var counterLabel = config.counterLabel;
    var prevLabel = config.prevLabel;
    var nextLabel = config.nextLabel;

    var mapWrap = document.getElementById("about-map-wrap");
    var cardEl = null;   // aktuell gerenderte Stations-Karte

    var currentIndex = -1;
    var countries = {};   // iso_a2 -> Feature
    var mapReady = false;
    var isMobile = window.matchMedia("(max-width: 768px)").matches;
    var popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true });

    // Kamera-Flüge: sanft (easeInOutQuint), Dauer abhängig von der
    // Zoom-Distanz — kleine Sprünge (Stadt-in-Stadt) schnell, große
    // Länder-Wechsel langsamer.
    var navSeq = 0;   // Schutz gegen veraltete Flug-Ketten bei schnellen Klicks
    var flightRAF = null;   // laufende Flug-Animation (für Abbruch)
    function easeInOutQuint(t) {
        return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
    }
    function flyDuration(z0, z1, apex) {
        var dz = Math.abs(z0 - z1);
        if (apex) dz = Math.max(dz, Math.abs(apex.zoom - z0), Math.abs(apex.zoom - z1));
        return Math.round(700 + 260 * dz);
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
                // hier erneut setzen, falls applyMapState vor dem Fetch lief.
                // Auch die Karte erneut rendern: die Anker einer
                // Länder-Station (z.B. Herkunft → DE+FI) liegen erst jetzt vor.
                var station = stations[currentIndex];
                if (mapReady) {
                    setHighlightCountries(station.map.highlight_countries);
                    if (station.map.fit_bounds) {
                        moveCamera(station, false);
                    }
                    renderStationCard(station);
                    setMarkers(stationAnchors(station));
                    // Länder-Überblicks-Kamera im Hintergrund vorberechnen
                    // (nur Herkunft), damit die animierte Navigation dorthin
                    // ohne Korrektur-Sprünge abläuft.
                    stations.forEach(function (s) {
                        if (s.map.fit_bounds) getFitCamera(s, 60);
                    });
                }
            })
            .catch(function (err) {
                console.warn("Länder-GeoJSON konnte nicht geladen werden:", err);
            });
    }

    function setMarkers(anchors) {
        var features = anchors.map(function (m) {
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

    // Länder-Zentrum aus den geladenen Polygonen (für Stations-Anker, wenn
    // keine expliziten Marker gesetzt sind — z.B. Herkunft → DE + FI).
    function countryCenter(iso) {
        var f = countries[iso];
        if (!f) return null;
        var minLng = Infinity, minLat = Infinity;
        var maxLng = -Infinity, maxLat = -Infinity;
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
        if (!isFinite(minLng)) return null;
        return { lng: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2 };
    }

    // Verankerungspunkte einer Station: explizite Marker, sonst die Zentren
    // der hervorgehobenen Länder (Länder-Karte muss dazu geladen sein).
    function stationAnchors(station) {
        var m = station.map.markers;
        if (m && m.length) return m;
        if (station.map.highlight_countries.length) {
            return station.map.highlight_countries
                .map(countryCenter)
                .filter(function (c) { return !!c; });
        }
        return [];
    }

    function midPoint(anchors) {
        var lng = 0, lat = 0;
        anchors.forEach(function (a) { lng += a.lng; lat += a.lat; });
        return { lng: lng / anchors.length, lat: lat / anchors.length };
    }

    // Stations-Karte: Bild + Text + Navigation in EINER Box, über den
    // Anker-Punkten schwebend und per gestrichelter Linie verbunden
    // (Länder-Stationen wie "Herkunft" hängen an mehreren Ankern).
    var domMarkers = [];
    var CARD_GAP = 120;   // Abstand Karten-Unterkante → Anker (Linienlänge)

    function clearDomMarkers() {
        domMarkers.forEach(function (m) { m.remove(); });
        domMarkers = [];
        cardEl = null;
    }

    // Fließtext mit optionalen Links rendern. {Text|URL}-Markierungen im
    // Stations-Text werden zu <a>-Elementen (neuer Tab), alles andere bleibt
    // reiner Text — kein HTML aus dem Datenbestand wird ausgeführt.
    function setBody(el, text) {
        var parts = text.split(/\{([^{}]+)\}/g);
        for (var i = 0; i < parts.length; i++) {
            if (i % 2 === 1) {
                var spec = parts[i].split("|");
                var a = document.createElement("a");
                a.href = spec.slice(1).join("|");
                a.target = "_blank";
                a.rel = "noopener";
                a.textContent = spec[0];
                el.appendChild(a);
            } else if (parts[i]) {
                el.appendChild(document.createTextNode(parts[i]));
            }
        }
    }

    function buildStationCard(station, i) {
        var card = document.createElement("section");
        card.className = "about-station-card" + (station.image ? "" : " no-image");
        card.setAttribute("aria-label", counterLabel + " " + (i + 1));

        if (station.image) {
            var isLogo = station.image.kind === "logo";
            var imgWrap = document.createElement("div");
            imgWrap.className = "station-card-img" + (isLogo ? " logo" : "");
            var img = document.createElement("img");
            img.src = station.image.url;
            img.alt = station.image.alt;
            imgWrap.appendChild(img);
            imgWrap.addEventListener("click", function (e) {
                e.stopPropagation();
                openStationPopup(station, firstAnchor());
            });
            card.appendChild(imgWrap);
        }

        var content = document.createElement("div");
        content.className = "station-card-content";

        var title = document.createElement("h1");
        title.className = "station-title";
        title.textContent = station.title;
        var counter = document.createElement("p");
        counter.className = "station-counter";
        counter.setAttribute("aria-live", "polite");
        counter.textContent = counterLabel + " " + (i + 1) + "/" + stations.length;
        var body = document.createElement("div");
        body.className = "station-body";
        setBody(body, station.body);
        content.appendChild(title);
        content.appendChild(counter);
        content.appendChild(body);

        var nav = document.createElement("nav");
        nav.className = "station-nav";
        var prevBtn = document.createElement("button");
        prevBtn.type = "button";
        prevBtn.setAttribute("aria-label", prevLabel);
        prevBtn.disabled = i === 0;
        prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
        prevBtn.addEventListener("click", function () { showStation(i - 1); });
        var dotsWrap = document.createElement("div");
        dotsWrap.className = "station-dots";
        dotsWrap.setAttribute("role", "tablist");
        dotsWrap.setAttribute("aria-label", counterLabel);
        for (var d = 0; d < stations.length; d++) {
            (function (idx) {
                var dot = document.createElement("button");
                dot.type = "button";
                dot.className = "station-dot" + (idx === i ? " active" : "");
                dot.setAttribute("role", "tab");
                dot.setAttribute("aria-label", counterLabel + " " + (idx + 1));
                dot.setAttribute("aria-selected", idx === i ? "true" : "false");
                dot.addEventListener("click", function () { showStation(idx); });
                dotsWrap.appendChild(dot);
            })(d);
        }
        var nextBtn = document.createElement("button");
        nextBtn.type = "button";
        nextBtn.setAttribute("aria-label", nextLabel);
        nextBtn.disabled = i === stations.length - 1;
        nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
        nextBtn.addEventListener("click", function () { showStation(i + 1); });
        nav.appendChild(prevBtn);
        nav.appendChild(dotsWrap);
        nav.appendChild(nextBtn);
        content.appendChild(nav);

        card.appendChild(content);
        return card;
    }

    function renderStationCard(station) {
        clearDomMarkers();
        hideLine();
        var card = buildStationCard(station, currentIndex);
        cardEl = card;

        // Mobile und Desktop identisch: die Karte schwebt an den Anker-Punkten
        // und ist per gestrichelter Linie mit ihnen verbunden. Bei EINEM Anker
        // schwebt sie über dem Punkt (Linie sichtbar), bei mehreren Ankern
        // (Länder-Stationen) zentriert sie den Mittelpunkt, damit kein Anker
        // hinter der Karte verschwindet.
        var anchors = stationAnchors(station);
        if (!anchors.length) return;   // z.B. Herkunft vor Laden der Länder

        var single = anchors.length === 1;
        var gap = isMobile ? 70 : CARD_GAP;
        domMarkers.push(
            new maplibregl.Marker({
                element: card,
                anchor: single ? "bottom" : "center",
                offset: single ? [0, -gap] : [0, 0],
            })
                .setLngLat([midPoint(anchors).lng, midPoint(anchors).lat])
                .addTo(map)
        );
        showLines(anchors);
    }

    // Verbindungslinien Karte ↔ Anker-Punkte (SVG-Overlay über der Karte)
    var lineSvg = null;
    var lineAnchors = null;

    function ensureLine() {
        if (lineSvg) return;
        lineSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        lineSvg.setAttribute("class", "about-marker-line");
        map.getContainer().appendChild(lineSvg);
    }

    function showLines(anchors) {
        ensureLine();
        lineAnchors = anchors;
        lineSvg.style.display = "";
        updateLine();
    }

    function hideLine() {
        lineAnchors = null;
        if (lineSvg) lineSvg.style.display = "none";
    }

    function firstAnchor() {
        var a = stationAnchors(stations[currentIndex]);
        return a.length ? [a[0].lng, a[0].lat] : null;
    }

    function updateLine() {
        if (!lineSvg || !lineAnchors || !cardEl) return;
        while (lineSvg.firstChild) lineSvg.removeChild(lineSvg.firstChild);
        var cardRect = cardEl.getBoundingClientRect();
        var cRect = map.getContainer().getBoundingClientRect();
        var top = cardRect.top - cRect.top;
        var bottom = cardRect.bottom - cRect.top;
        var left = cardRect.left - cRect.left;
        var right = cardRect.right - cRect.left;
        lineAnchors.forEach(function (a) {
            var p = map.project([a.lng, a.lat]);
            // Nächster Punkt auf dem Karten-Rand (oben/unten/links/rechts).
            // Liegt ein Anker hinter der Karte, wird die nächstgelegene Kante
            // genommen statt einer Null-Linie.
            var x2, y2;
            if (p.x >= left && p.x <= right && p.y >= top && p.y <= bottom) {
                var dL = p.x - left, dR = right - p.x, dT = p.y - top, dB = bottom - p.y;
                var m = Math.min(dL, dR, dT, dB);
                if (m === dL) { x2 = left; y2 = p.y; }
                else if (m === dR) { x2 = right; y2 = p.y; }
                else if (m === dT) { x2 = p.x; y2 = top; }
                else { x2 = p.x; y2 = bottom; }
            } else {
                x2 = Math.max(left, Math.min(right, p.x));
                y2 = Math.max(top, Math.min(bottom, p.y));
            }
            var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("stroke", "#FF9800");
            line.setAttribute("stroke-width", 2);
            line.setAttribute("stroke-dasharray", "5 5");
            line.setAttribute("x1", p.x);
            line.setAttribute("y1", p.y);
            line.setAttribute("x2", x2);
            line.setAttribute("y2", y2);
            lineSvg.appendChild(line);
        });
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

    // Auf Mobile und Desktop schwebt die Stations-Karte an den Anker-Punkten,
    // daher ist kein asymmetrisches Map-Padding nötig.

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
    function computeFitCamera(m, bounds, margin) {
        var sw = bounds[0], ne = bounds[1];
        var center = { lng: (sw[0] + ne[0]) / 2, lat: (sw[1] + ne[1]) / 2 };

        var pad = m.getPadding();
        var container = m.getContainer();
        var availW = container.clientWidth - pad.left - pad.right - 2 * margin;
        var availH = container.clientHeight - pad.top - pad.bottom - 2 * margin;

        function measure(c, z) {
            m.jumpTo({ center: c, zoom: z });
            var pts = [sw, ne, [sw[0], ne[1]], [ne[0], sw[1]]].map(function (p) {
                var pr = m.project(p);
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
            center = m.unproject([e.cx, e.cy]);
            var over = Math.max(e.w / availW, e.h / availH);
            if (over > 1) zoom -= Math.log2(over);
            zoom -= 0.02;
            e = measure(center, zoom);
        }

        return { center: center, zoom: zoom };
    }

    // Fit-Kameras werden synchron (in einem JS-Task) aus den projizierten
    // Bounds berechnet und gecacht. jumpTo/project aktualisieren die Kamera
    // sofort — die Zwischenstände werden nie gerendert, daher keine sichtbaren
    // Sprünge und kein separater Render-Frame nötig.
    var fitCameraCache = {};

    function computeFitCameraSettled(bounds, margin) {
        var startCam = { center: map.getCenter(), zoom: map.getZoom() };
        var cam = computeFitCamera(map, bounds, margin);
        for (var i = 0; i < 3; i++) {
            var next = computeFitCamera(map, bounds, margin);
            var settled = Math.abs(next.zoom - cam.zoom) < 0.001 &&
                Math.abs(next.center.lat - cam.center.lat) < 0.001 &&
                Math.abs(next.center.lng - cam.center.lng) < 0.001;
            cam = next;
            if (settled) break;
        }
        map.jumpTo(startCam);   // sichtbare Kamera wiederherstellen
        return cam;
    }

    function getFitCamera(station, margin) {
        var key = station.map.highlight_countries.join("+");
        if (fitCameraCache[key]) return fitCameraCache[key];
        var bounds = computeBounds(station.map.highlight_countries);
        if (!bounds) return null;
        try {
            fitCameraCache[key] = computeFitCameraSettled(bounds, margin);
        } catch (e) {
            return null;   // Fallback auf die Stations-Kamera
        }
        return fitCameraCache[key];
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
            // Zoom läuft dem Zentrum nach: beim Hineinzoomen erst zum Ziel
            // pannen und dann scharf stellen (direkter Anflug), beim
            // Herauszoomen früh herausgehen und dann pannen.
            var ez;
            if (target.zoom >= start.zoom) {
                ez = t * t * t;   // easeInCubic — Zoom erhöht sich erst spät
            } else {
                ez = 1 - Math.pow(1 - t, 3);   // easeOutCubic — früh heraus
            }
            var z = start.zoom + (target.zoom - start.zoom) * ez;
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
        if (flightRAF) cancelAnimationFrame(flightRAF);
        var start = { center: map.getCenter(), zoom: map.getZoom() };
        var fit = station.map.fit_bounds;
        var bounds = fit ? computeBounds(station.map.highlight_countries) : null;
        // map.center kommt als [lng, lat]-Array — für die Animation als
        // {lng, lat}-Objekt normalisieren.
        var mc = station.map.center;
        var target = { center: { lng: mc[0], lat: mc[1] }, zoom: station.map.zoom };
        var cam = fit && bounds ? getFitCamera(station, 60) : null;

        if (!animate) {
            map.jumpTo(cam || target);
            return;
        }

        // Länder-Überblick (fit_bounds): Ziel kommt aus dem (synchron
        // berechneten) Cache, dann ein durchgehender Flug ohne Ausschwenken
        // (das Ziel zeigt schon alles).
        if (cam) {
            smoothFly(start, cam, null, flyDuration(start.zoom, cam.zoom));
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
        smoothFly(start, target, apex, flyDuration(start.zoom, target.zoom, apex));
    }

    // Karten-Zustand einer Station (Karte, Marker, Highlights, Kamera, Puls)
    function applyMapState(station, animate) {
        renderStationCard(station);
        setMarkers(stationAnchors(station));
        map.setLayoutProperty("station-marker-pulse", "visibility", "visible");
        map.setLayoutProperty("station-marker-core", "visibility", "visible");
        setHighlightCountries(station.map.highlight_countries);
        var visible = station.map.highlight_countries.length > 0 ? "visible" : "none";
        map.setLayoutProperty("station-highlight-fill", "visibility", visible);
        map.setLayoutProperty("station-highlight-outline", "visibility", visible);
        moveCamera(station, animate);
        if (animate && stationAnchors(station).length > 0) {
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

        if (mapReady) {
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
        // Stations-Navigation steckt jetzt in der Stations-Karte (Buttons +
        // Dots werden beim Rendern der Karte gebunden). Hier nur die Tastatur.
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
        fitCameraCache = {};
        if (mapReady) {
            renderStationCard(stations[currentIndex]);
        }
    });

    // Deep-Link: /about/#<slug> startet direkt bei einer Station
    var initial = 0;
    var hash = location.hash.slice(1);
    for (var i = 0; i < stations.length; i++) {
        if (stations[i].slug === hash) initial = i;
    }
    showStation(initial, { animate: false });
})();
