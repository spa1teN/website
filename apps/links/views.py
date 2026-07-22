import json
import logging
import time

import requests
from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET

logger = logging.getLogger("links")

DASHBOARD_URL = "http://dashboard:8090"
CACHE_TTL = 60
_cache: dict[str, tuple[float, dict]] = {}


def _cached_fetch(key: str, url: str) -> dict:
    now = time.time()
    if key in _cache:
        ts, data = _cache[key]
        if now - ts < CACHE_TTL:
            return data
    try:
        resp = requests.get(url, timeout=5)
        resp.raise_for_status()
        data = resp.json()
        _cache[key] = (now, data)
        return data
    except Exception:
        logger.exception("Failed to fetch %s", url)
        if key in _cache:
            return _cache[key][1]
        return {"available": False, "error": "Fetch failed"}


def links(request):
    return render(request, "links/links.html", {
        "discord_user_id": settings.DISCORD_USER_ID,
    })


def _get_bot_history(series: str) -> list:
    """Fetch last 1h of log-message history from dashboard."""
    try:
        data = _cached_fetch(
            f"history_{series}",
            f"{DASHBOARD_URL}/api/history?range=1h&series={series}"
        )
        return data.get(series, [])
    except Exception:
        return []


def status(request):
    """Legacy view — kept for backward compatibility. URL now redirects to /status/."""
    return status_overview(request)


def status_overview(request):
    ts_data = _get_tausendsassa_public()
    rb_data = _get_roaringbot_public()
    ts_log = _get_bot_history("tausendsassa_log_messages_15m")
    ts_err = _get_bot_history("tausendsassa_log_errors_15m")
    rb_log = _get_bot_history("roaringbot_log_messages_15m")
    rb_err = _get_bot_history("roaringbot_log_errors_15m")
    return render(request, "links/status.html", {
        "bot_filter": None,
        "tausendsassa": ts_data,
        "roaringbot": rb_data,
        "ts_log_json": json.dumps(ts_log),
        "ts_err_json": json.dumps(ts_err),
        "rb_log_json": json.dumps(rb_log),
        "rb_err_json": json.dumps(rb_err),
        "rb_matches_json": json.dumps(rb_data.get("esports", {}).get("next_matches", [])),
    })


def status_roaringbot(request):
    rb_data = _get_roaringbot_public()
    rb_log = _get_bot_history("roaringbot_log_messages_15m")
    rb_err = _get_bot_history("roaringbot_log_errors_15m")
    return render(request, "links/status.html", {
        "bot_filter": "roaringbot",
        "tausendsassa": {"available": False},
        "roaringbot": rb_data,
        "ts_log_json": "[]",
        "ts_err_json": "[]",
        "rb_log_json": json.dumps(rb_log),
        "rb_err_json": json.dumps(rb_err),
        "rb_matches_json": json.dumps(rb_data.get("esports", {}).get("next_matches", [])),
    })


def status_tausendsassa(request):
    ts_data = _get_tausendsassa_public()
    ts_log = _get_bot_history("tausendsassa_log_messages_15m")
    ts_err = _get_bot_history("tausendsassa_log_errors_15m")
    return render(request, "links/status.html", {
        "bot_filter": "tausendsassa",
        "tausendsassa": ts_data,
        "roaringbot": {"available": False},
        "ts_log_json": json.dumps(ts_log),
        "ts_err_json": json.dumps(ts_err),
        "rb_log_json": "[]",
        "rb_err_json": "[]",
        "rb_matches_json": "[]",
    })


def _get_tausendsassa_public() -> dict:
    raw = _cached_fetch("ts_status", f"{DASHBOARD_URL}/api/tausendsassa/status")
    if not raw.get("available"):
        return {"available": False}

    stats = raw.get("stats") or {}
    feeds = raw.get("feeds") or {}
    themap = raw.get("map") or {}
    bot = raw.get("bot") or {}
    analytics = raw.get("analytics") or {}
    moderation = raw.get("moderation") or []

    return {
        "available": True,
        "stats": {
            "guild_count": stats.get("guild_count", 0),
            "total_members": stats.get("total_members", 0),
        },
        "feeds": {
            "active": (feeds.get("totals") or {}).get("active", 0),
            "posts_per_day": feeds.get("posts_per_day", []),
        },
        "calendars": {"count": len(raw.get("calendars") or [])},
        "map": {
            "total_pins": themap.get("total_pins", 0),
            "guild_count": len(themap.get("guilds") or []),
        },
        "moderation": {
            "guilds_configured": sum(
                1 for m in moderation if m.get("log_webhook_configured")
            ),
        },
        "bot": {
            "loaded_cogs": bot.get("loaded_cogs", []),
            "latency_ms": bot.get("latency_ms"),
            "gateway_status": bot.get("gateway_status"),
        },
        "counters": {
            "slash_commands_15m": (bot.get("counters") or {}).get("slash_commands", {}).get("15m", 0),
            "interactions_15m": (bot.get("counters") or {}).get("interactions", {}).get("15m", 0),
        },
        "web_views_1h": (analytics or {}).get("page_views_1h", 0),
    }


def _get_roaringbot_public() -> dict:
    raw = _cached_fetch("rb_status", f"{DASHBOARD_URL}/api/roaringbot/status")
    if not raw.get("available"):
        return {"available": False}

    bot = raw.get("bot") or {}
    esports = raw.get("esports") or {}
    moderation = raw.get("moderation") or {}

    public_matches = []
    for m in (esports.get("next_matches") or []):
        public_matches.append({
            "teams": m.get("teams"),
            "tournament": m.get("tournament"),
            "game": m.get("game"),
            "start_time": m.get("start_time"),
            "is_live": m.get("is_live"),
            "detail_url": m.get("detail_url"),
            "live_score": m.get("live_score"),
            "has_discord_event": m.get("has_discord_event", False),
            "voice_event_at": m.get("voice_event_at"),
            "voice_event_ok": m.get("voice_event_ok"),
            "reminder_at": m.get("reminder_at"),
            "reminder_ok": m.get("reminder_ok"),
            "tracking_at": m.get("tracking_at"),
            "tracking_ok": m.get("tracking_ok"),
            "cleanly_finished": m.get("cleanly_finished", False),
            "issues": m.get("issues", []),
        })

    return {
        "available": True,
        "bot": {
            "user": bot.get("user"),
            "guild_count": bot.get("guild_count", 0),
            "member_count": bot.get("member_count", 0),
            "latency_ms": bot.get("latency_ms"),
            "gateway_status": bot.get("gateway_status"),
            "loaded_cogs": [c for c in bot.get("loaded_cogs", []) if c not in ("FinanceCog", "finance")],
        },
        "esports": {
            "monitoring_enabled": esports.get("monitoring_enabled", False),
            "next_matches": public_matches,
        },
        "counters": {
            "log_messages_15m": (bot.get("counters") or {}).get("log_messages", {}).get("15m", 0),
        },
    }


@require_GET
def api_status_tausendsassa(request):
    return JsonResponse(_get_tausendsassa_public())


@require_GET
def api_status_roaringbot(request):
    return JsonResponse(_get_roaringbot_public())
