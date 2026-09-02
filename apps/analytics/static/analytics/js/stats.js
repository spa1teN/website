(function () {
    "use strict";

    var stats = window.STATS_DATA || {};
    var lang = document.documentElement.lang || "de";

    function i18n(de, en) {
        return lang === "de" ? de : en;
    }

    function escapeHtml(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function fmt(n) {
        return Number(n).toLocaleString("de-DE");
    }

    // ── City dot map ──────────────────────────────────────────────
    var mapEl = document.getElementById("stats-map");
    var points = (stats.city_points || []).filter(function (p) {
        return p.lat != null && p.lon != null;
    });

    if (mapEl && points.length) {
        var map = new maplibregl.Map({
            container: mapEl,
            style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
            center: [10, 35],
            zoom: 1.4,
            attributionControl: false,
            renderWorldCopies: false,
        });
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

        var maxCount = Math.max.apply(null, points.map(function (p) { return p.count; }));
        var geojson = {
            type: "FeatureCollection",
            features: points.map(function (p) {
                return {
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [p.lon, p.lat] },
                    properties: {
                        count: p.count,
                        label: (p.city || "") + (p.country ? ", " + p.country : "") + " — " + p.count,
                    },
                };
            }),
        };

        map.on("load", function () {
            map.addSource("cities", { type: "geojson", data: geojson });
            map.addLayer({
                id: "cities",
                type: "circle",
                source: "cities",
                paint: {
                    "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 4, maxCount, 13],
                    "circle-color": "#6c9bcf",
                    "circle-opacity": 0.85,
                    "circle-stroke-color": "rgba(255,255,255,0.45)",
                    "circle-stroke-width": 1,
                },
            });

            var tip = new maplibregl.Popup({ closeButton: false, closeOnMove: true, offset: 10 });
            map.on("mouseenter", "cities", function (e) {
                map.getCanvas().style.cursor = "pointer";
                tip.setLngLat(e.features[0].geometry.coordinates).setText(e.features[0].properties.label).addTo(map);
            });
            map.on("mouseleave", "cities", function () {
                map.getCanvas().style.cursor = "";
                tip.remove();
            });

            var lons = points.map(function (p) { return p.lon; });
            var lats = points.map(function (p) { return p.lat; });
            try {
                map.fitBounds([
                    [Math.min.apply(null, lons), Math.min.apply(null, lats)],
                    [Math.max.apply(null, lons), Math.max.apply(null, lats)],
                ], { padding: 36, maxZoom: 2.4, duration: 0 });
            } catch (e) { /* single point / bad bounds */ }
        });
    } else if (mapEl) {
        mapEl.innerHTML = '<div class="stats-empty">' + i18n("Noch keine Koordinaten erfasst", "No coordinates recorded yet") + "</div>";
    }

    // ── Breakdown bars ────────────────────────────────────────────
    function renderBreakdown(el, rows) {
        if (!el) return;
        if (!rows || !rows.length) {
            el.innerHTML = '<div class="stats-empty">' + i18n("Keine Daten", "No data") + "</div>";
            return;
        }
        var max = Math.max.apply(null, rows.map(function (r) { return r.count; }));
        var html = '<div class="breakdown">';
        rows.forEach(function (r) {
            html += '<div class="bd-row" title="' + escapeHtml(r.label) + '">' +
                '<div class="bd-label">' + escapeHtml(r.label) + "</div>" +
                '<div class="bd-track"><div class="bd-fill" style="width:' + (r.count / max * 100).toFixed(1) + '%"></div></div>' +
                '<div class="bd-count">' + escapeHtml(fmt(r.count)) + "</div>" +
                "</div>";
        });
        html += "</div>";
        el.innerHTML = html;
    }

    // ── Weekly hour-of-day heatmap ────────────────────────────────
    function renderHeatmap(el, rows) {
        if (!el) return;
        if (!rows || !rows.length) {
            el.innerHTML = '<div class="stats-empty">' + i18n("Noch nicht genug Daten", "Not enough data yet") + "</div>";
            return;
        }
        var counts = {};
        rows.forEach(function (r) { counts[r.weekday + "-" + r.hour] = r.count; });
        var max = Math.max.apply(null, rows.map(function (r) { return r.count; }));
        var DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
        var DAYS_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
        var DJANGO_WEEKDAYS = [2, 3, 4, 5, 6, 7, 1];

        var html = '<div class="heatmap">';
        DJANGO_WEEKDAYS.forEach(function (wd, i) {
            html += '<div class="hm-row"><div class="hm-day">' + DAYS[i] + '</div><div class="hm-cells">';
            for (var h = 0; h < 24; h++) {
                var c = counts[wd + "-" + h] || 0;
                var alpha = c ? (0.15 + (c / max) * 0.85).toFixed(2) : 0.05;
                html += '<div class="hm-cell" style="background:rgba(108,155,207,' + alpha + ')" data-day="' + DAYS_LONG[i] + '" data-hour="' + String(h).padStart(2, "0") + ':00" data-count="' + c + '"></div>';
            }
            html += "</div></div>";
        });
        html += '<div class="hm-row"><div class="hm-day"></div><div class="hm-cells">';
        for (var h2 = 0; h2 < 24; h2++) html += '<div class="hm-hour">' + (h2 % 3 === 0 ? h2 : "") + "</div>";
        html += "</div></div></div>";

        el.innerHTML = '<div class="heatmap-wrap">' + html + "</div>";

        var tooltip = document.createElement("div");
        tooltip.className = "hm-tooltip hidden";
        el.querySelector(".heatmap-wrap").appendChild(tooltip);
        var viewLabel = i18n("Aufrufe", "views");
        el.querySelectorAll(".hm-cell").forEach(function (cell) {
            cell.addEventListener("mouseenter", function () {
                tooltip.innerHTML = '<div class="tt-row"><span class="tt-label">' + cell.dataset.day + " " + cell.dataset.hour + "</span><span class='tt-value'>" + fmt(Number(cell.dataset.count)) + " " + viewLabel + "</span></div>";
                tooltip.classList.remove("hidden");
            });
            cell.addEventListener("mousemove", function (ev) {
                var rect = el.getBoundingClientRect();
                tooltip.style.left = Math.min(Math.max(ev.clientX - rect.left - 70, 0), rect.width - 156) + "px";
                tooltip.style.top = Math.max(0, ev.clientY - rect.top - 48) + "px";
            });
            cell.addEventListener("mouseleave", function () { tooltip.classList.add("hidden"); });
        });
    }

    renderBreakdown(document.getElementById("stats-referrers"), stats.top_referrers || []);
    renderHeatmap(document.getElementById("stats-heatmap"), stats.hourly_pattern || []);
})();