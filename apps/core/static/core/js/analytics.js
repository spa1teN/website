(function () {
    "use strict";

    var ENDPOINT = "/api/analytics/event/";

    function screenBucket() {
        var w = window.innerWidth;
        if (w < 600) return "mobile";
        if (w < 1024) return "tablet";
        if (w < 1600) return "desktop";
        return "desktop-large";
    }

    function send(payload) {
        var body = JSON.stringify(payload);
        if (navigator.sendBeacon) {
            navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
        } else {
            fetch(ENDPOINT, {
                method: "POST",
                body: body,
                headers: { "Content-Type": "application/json" },
                keepalive: true,
            }).catch(function () {});
        }
    }

    function basePayload(eventType) {
        return {
            event_type: eventType,
            path: location.pathname,
            referrer: document.referrer || "",
            language: document.documentElement.lang || "",
            screen_bucket: screenBucket(),
        };
    }

    send(basePayload("pageview"));

    document.addEventListener("click", function (e) {
        var el = e.target.closest("[data-track]");
        if (!el) return;
        var payload = basePayload("click");
        payload.target = el.getAttribute("data-track");
        send(payload);
    });
})();
