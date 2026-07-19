import hmac
import ipaddress
import json
from urllib.parse import urlparse

from django.conf import settings
from django.db.models import Count
from django.db.models.functions import ExtractHour, ExtractWeekDay
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from .geoip import resolve_geo
from .models import AnalyticsEvent
from .useragent import parse_user_agent

# Never log traffic to these areas - admin/management tooling and raw
# static/media/API requests are not "visitor" activity worth analyzing.
_EXCLUDED_PATH_PREFIXES = (
    "/admin/",
    "/diary/manage/",
    "/api/",
    "/accounts/",
    "/static/",
    "/staticfiles/",
    "/media/",
)

_VALID_LANGUAGES = {code for code, _ in AnalyticsEvent.LANGUAGES}
_VALID_SCREEN_BUCKETS = {code for code, _ in AnalyticsEvent.SCREEN_BUCKETS}


def _referrer_domain(referrer, request):
    if not referrer:
        return ""
    try:
        host = urlparse(referrer).hostname or ""
    except ValueError:
        return ""
    host = host.lower()
    if host.startswith("www."):
        host = host[4:]
    # Internal navigation within our own site isn't a meaningful "referrer".
    if host == request.get_host().split(":")[0].lower():
        return ""
    return host[:255]


@csrf_exempt
@require_POST
def track_event(request):
    # Don't log the site owner's own browsing/testing sessions.
    if request.user.is_authenticated:
        return JsonResponse({"ok": True})

    try:
        data = json.loads(request.body or b"{}")
    except ValueError:
        return JsonResponse({"ok": False}, status=400)

    event_type = data.get("event_type")
    if event_type not in ("pageview", "click"):
        return JsonResponse({"ok": False}, status=400)

    path = str(data.get("path") or "")[:500]
    if path.startswith(_EXCLUDED_PATH_PREFIXES):
        return JsonResponse({"ok": True})

    language = data.get("language") or ""
    if language not in _VALID_LANGUAGES:
        language = ""

    screen_bucket = data.get("screen_bucket") or ""
    if screen_bucket not in _VALID_SCREEN_BUCKETS:
        screen_bucket = ""

    ip = request.META.get("HTTP_X_REAL_IP") or request.META.get("REMOTE_ADDR")

    # Exclude Tailscale network traffic (100.64.0.0/10) — the admin's own
    # devices connected via Tailscale would otherwise inflate the stats.
    try:
        if ipaddress.ip_address(ip) in ipaddress.ip_network("100.64.0.0/10"):
            return JsonResponse({"ok": True})
    except ValueError:
        pass  # malformed IP, let it through to geo resolution

    # nginx sits in front as a reverse proxy (see nginx/nginx.conf), so
    # REMOTE_ADDR is nginx's own container IP, not the visitor's. The real
    # client IP arrives via X-Real-IP, set by nginx for every vhost.
    # The IP is read only to resolve a coarse country/city, then discarded -
    # it is not passed to AnalyticsEvent.objects.create() below.
    country, city, latitude, longitude = resolve_geo(ip)

    ua_string = request.META.get("HTTP_USER_AGENT", "")
    device_type, browser, os_name = parse_user_agent(ua_string)

    AnalyticsEvent.objects.create(
        event_type=event_type,
        path=path,
        target=str(data.get("target") or "")[:200],
        referrer_domain=_referrer_domain(str(data.get("referrer") or ""), request),
        country=country,
        city=city,
        latitude=latitude,
        longitude=longitude,
        device_type=device_type,
        browser=browser,
        os=os_name,
        language=language,
        screen_bucket=screen_bucket,
    )
    return JsonResponse({"ok": True})


_CHOICE_LABELS = {
    "device_type": dict(AnalyticsEvent.DEVICE_TYPES),
    "language": dict(AnalyticsEvent.LANGUAGES),
    "screen_bucket": dict(AnalyticsEvent.SCREEN_BUCKETS),
}

_BLANK_LABELS = {
    "path": "(unbekannter Pfad)",
    "target": "(kein Ziel)",
    "referrer_domain": "Direktzugriff / kein Referrer",
    "country": "Unbekannt",
    "device_type": "Unbekannt",
    "browser": "Unbekannt",
    "os": "Unbekannt",
    "language": "Unbekannt",
    "screen_bucket": "Unbekannt",
}


def _breakdown(qs, field, limit=10):
    """Top values of `field` in `qs`, as bars scaled to the largest count."""
    rows = list(
        qs.values(field)
        .annotate(n=Count("id"))
        .order_by("-n")[:limit]
    )
    if not rows:
        return []
    choice_labels = _CHOICE_LABELS.get(field, {})
    max_n = rows[0]["n"]
    result = []
    for row in rows:
        raw = row[field]
        label = choice_labels.get(raw, raw) if raw else None
        result.append({
            "value": raw,
            "label": label or _BLANK_LABELS.get(field, "Unbekannt"),
            "count": row["n"],
            "pct": round(row["n"] / max_n * 100) if max_n else 0,
        })
    return result


def _check_api_key(request):
    expected = settings.ANALYTICS_DASHBOARD_API_KEY
    provided = request.META.get("HTTP_X_API_KEY", "")
    return bool(expected) and hmac.compare_digest(provided, expected)


def _city_points(events, limit=50):
    """Distinct (city, country) pairs with resolved coordinates, for a dot map."""
    rows = (
        events.exclude(latitude__isnull=True)
        .values("city", "country", "latitude", "longitude")
        .annotate(n=Count("id"))
        .order_by("-n")[:limit]
    )
    return [
        {"city": r["city"], "country": r["country"], "lat": r["latitude"], "lon": r["longitude"], "count": r["n"]}
        for r in rows
    ]


def _hourly_pattern(pageviews):
    """Pageview counts bucketed by (weekday, hour) in local time, across all history.

    TIME_ZONE is Europe/Berlin, and Django's Extract* DB functions operate in
    that zone, so this is already German local time with no manual conversion.
    ExtractWeekDay follows Django/Postgres convention: Sunday=1 .. Saturday=7.
    """
    rows = (
        pageviews
        .annotate(weekday=ExtractWeekDay("created_at"), hour=ExtractHour("created_at"))
        .values("weekday", "hour")
        .annotate(n=Count("id"))
    )
    return [{"weekday": r["weekday"], "hour": r["hour"], "count": r["n"]} for r in rows]


@require_GET
def stats_api(request):
    """Read-only JSON aggregates for the external ops dashboard. See DATA_INTERFACE.md."""
    if not _check_api_key(request):
        return JsonResponse({"detail": "unauthorized"}, status=401)

    events = AnalyticsEvent.objects.all()
    pageviews = events.filter(event_type="pageview")
    clicks = events.filter(event_type="click")

    return JsonResponse({
        "generated_at": timezone.now().isoformat(),
        "total_pageviews": pageviews.count(),
        "total_clicks": clicks.count(),
        "top_pages": _breakdown(pageviews, "path", limit=10),
        "top_referrers": _breakdown(pageviews.exclude(referrer_domain=""), "referrer_domain", limit=10),
        "top_click_targets": _breakdown(clicks.exclude(target=""), "target", limit=15),
        "countries": _breakdown(events.exclude(country=""), "country", limit=15),
        "cities": _breakdown(events.exclude(city=""), "city", limit=15),
        "city_points": _city_points(events),
        "hourly_pattern": _hourly_pattern(pageviews),
        "devices": _breakdown(events, "device_type", limit=10),
        "browsers": _breakdown(events, "browser", limit=10),
        "os": _breakdown(events, "os", limit=10),
        "languages": _breakdown(events, "language", limit=10),
        "screen_buckets": _breakdown(events, "screen_bucket", limit=10),
    })
