# Analytics Data Interface

This document describes the schema of the anonymous analytics events collected
by `apps/analytics`, so that the data can be queried and analyzed later without
having to re-read the implementation.

## What gets logged, and how

Every page view and every click on an element carrying a `data-track="..."`
attribute sends one HTTP POST to `/api/analytics/event/`
(`apps/analytics/views.py:track_event`). Each request becomes exactly one row
in the `analytics_analyticsevent` table (model: `apps.analytics.models.AnalyticsEvent`).

There is **no cookie, session id, or user identifier** involved anywhere in
this pipeline. Two rows can never be proven to come from the same visitor -
each row is a standalone, isolated data point. The client-side IP address is
read once per request (`apps/analytics/geoip.py:resolve_geo`) purely to derive
a coarse country/city, and is never written to the database, a log file, or
passed anywhere else.

Logged-in users (i.e. the site owner) are excluded entirely, both client-side
(the tracking script isn't even loaded when `user.is_authenticated`) and
server-side (`track_event` also short-circuits for authenticated requests, as
defense in depth). Requests to `/admin/`, `/diary/manage/`, `/api/`,
`/accounts/`, `/static/`, `/staticfiles/`, and `/media/` are never logged.

## Table: `analytics_analyticsevent`

| Column | Type | Example | Meaning |
|---|---|---|---|
| `id` | int | `1421` | Primary key, no meaning beyond ordering. |
| `created_at` | datetime (UTC) | `2026-07-09 14:32:01` | When the event was recorded. |
| `event_type` | `"pageview"` \| `"click"` | `"pageview"` | Whether this is a page load or a tracked click. |
| `path` | string | `"/diary/"` | The page's path at the time of the event. |
| `target` | string | `"social:instagram"` | Only set for `click` events - see "Click targets" below. Empty for pageviews. |
| `referrer_domain` | string | `"google.com"` | Bare domain the visitor came from (from `document.referrer`). Empty string means either a direct visit (no referrer sent) or internal navigation within this site (internal referrers are deliberately blanked out, since they're not meaningful). |
| `country` | string (ISO 3166-1 alpha-2) | `"DE"` | Resolved from the request IP via GeoIP; empty if GeoIP is not configured or the lookup failed (see "GeoIP setup" below). |
| `city` | string | `"Hamburg"` | Resolved together with `country`. Empty under the same conditions. |
| `latitude` / `longitude` | float or null | `53.55`, `10.0` | GeoLite2-City's resolved point for the city (city-level precision, not the visitor's exact location). Added later than `country`/`city` - rows recorded before that rollout have `null` here even if `country`/`city` are set. Null under the same conditions as `country`/`city` (no GeoIP configured, private/loopback IP, lookup failure). |
| `device_type` | `"desktop"` \| `"mobile"` \| `"tablet"` \| `"bot"` \| `""` | `"mobile"` | Parsed from the User-Agent header. |
| `browser` | string | `"Safari"` | Browser family only, no version number. |
| `os` | string | `"iOS"` | OS family only, no version number. |
| `language` | `"de"` \| `"en"` \| `"fi"` \| `""` | `"de"` | The site's active UI language at the time of the event (from `<html lang="...">`, i.e. `apps.core.context_processors.language`) - not the browser's `Accept-Language`. |
| `screen_bucket` | `"mobile"` \| `"tablet"` \| `"desktop"` \| `"desktop-large"` \| `""` | `"desktop"` | Bucketed `window.innerWidth` at event time: `<600`, `600–1024`, `1024–1600`, `>1600`. Not the exact resolution (avoids contributing to browser fingerprinting). |

## Click targets currently wired up

Defined via `data-track="..."` attributes in templates. Currently only the
social/profile links on the "About Me" page
(`apps/links/templates/links/links.html`) are instrumented:

`social:linkedin`, `social:github`, `social:instagram`, `social:twitter`,
`social:bluesky`, `social:reddit`, `social:twitch`, `social:youtube`,
`social:steam`, `social:wikipedia`, `social:discord_bot_discovery`,
`social:tausendsassa_interface`.

To track a new element, add `data-track="some:label"` to it in the template -
no JS changes needed, `apps/core/static/core/js/analytics.js` picks up any
element with that attribute via a delegated click listener.

## GeoIP setup

`country`/`city` require a MaxMind GeoLite2-City database, which is **not**
bundled with the repo (its license doesn't allow redistribution). Without it,
every event simply has `country = "" ` and `city = ""` - nothing breaks.

To enable it:
1. Create a free MaxMind account and generate a license key: https://www.maxmind.com/en/geolite2/signup
2. Download `GeoLite2-City.mmdb` and place it at `website/geoip/GeoLite2-City.mmdb`
   (or point `ANALYTICS_GEOIP_DB_PATH` in `.env` at a different path).
3. `docker compose restart web` - no code changes needed, `apps/analytics/geoip.py`
   picks the file up automatically on the next request.

## Querying the data for analysis

Simplest path: Django admin at `/admin/analytics/analyticsevent/` - filterable
by event type, device, country, language, browser, with a date drill-down.
Read-only by design (rows can't be added/edited through the admin, only viewed
and, if needed, deleted).

For actual analysis (aggregations, correlating referrer with clicks, etc.),
go through the ORM/DB directly, e.g.:

```bash
docker compose exec -T web python manage.py shell
```
```python
from apps.analytics.models import AnalyticsEvent
from django.db.models import Count

# Clicks on social links, grouped by target and country
(AnalyticsEvent.objects
    .filter(event_type="click", target__startswith="social:")
    .values("target", "country")
    .annotate(n=Count("id"))
    .order_by("-n"))

# Where pageview traffic comes from
(AnalyticsEvent.objects
    .filter(event_type="pageview")
    .exclude(referrer_domain="")
    .values("referrer_domain")
    .annotate(n=Count("id"))
    .order_by("-n"))
```

Or export to CSV/pandas via `docker compose exec -T web python manage.py dbshell`
and `\copy (SELECT * FROM analytics_analyticsevent) TO STDOUT WITH CSV HEADER`.

## Read-only JSON aggregates for external tools (dashboard)

`GET /api/analytics/stats/` (`apps/analytics/views.py:stats_api`) returns a
single JSON object with pre-aggregated numbers, for external tools like the
ops dashboard at `~/dashboard/` that shouldn't need direct DB/ORM access.

- Auth: header `X-API-Key: <value>` must match `ANALYTICS_DASHBOARD_API_KEY`
  (set in `.env`, read via `settings.ANALYTICS_DASHBOARD_API_KEY`). Missing or
  wrong key → `401 {"detail": "unauthorized"}`. No cookie/session auth.
- Read-only, no query params, whole-history aggregates (not time-windowed).
- Each breakdown row is `{"value": <raw DB value>, "label": <human label>,
  "count": <n>, "pct": <0-100, relative to the top row>}` — `value` is the raw
  stored value (e.g. ISO country code `"DE"`, or the exact `path` string),
  `label` applies the same choice-label translation the HTML dashboard uses
  (only for `device_type`/`language`/`screen_bucket`; everything else's
  `label` equals `value`, or a fallback string like "Unbekannt" if blank).

```jsonc
{
  "generated_at": "2026-07-09T14:32:01.123456+00:00",
  "total_pageviews": 4213,
  "total_clicks": 187,
  "top_pages": [{"value": "/diary/", "label": "/diary/", "count": 812, "pct": 100}],       // top 10
  "top_referrers": [{"value": "google.com", "label": "google.com", "count": 340, "pct": 100}], // top 10, excludes blank (direct/internal)
  "top_click_targets": [{"value": "social:instagram", "label": "social:instagram", "count": 52, "pct": 100}], // top 15, excludes blank; see "Click targets currently wired up" above for the full list (currently only About-Me social links)
  "countries": [{"value": "DE", "label": "DE", "count": 2100, "pct": 100}],                 // top 15, excludes blank (no GeoIP match)
  "cities": [{"value": "Hamburg", "label": "Hamburg", "count": 400, "pct": 100}],            // top 15, excludes blank
  "city_points": [{"city": "Hamburg", "country": "DE", "lat": 53.55, "lon": 10.0, "count": 400}], // top 50 by count, only rows with resolved coordinates (see latitude/longitude in the table schema above - only populated after that field was added)
  "hourly_pattern": [{"weekday": 2, "hour": 14, "count": 38}],                               // pageviews only, ALL history (not time-windowed like the rest), bucketed by local (Europe/Berlin) weekday+hour. weekday follows Django's ExtractWeekDay convention: Sunday=1 .. Saturday=7. Up to 168 rows (7*24), sparse (no zero-count rows).
  "devices": [{"value": "desktop", "label": "Desktop", "count": 3000, "pct": 100}],          // top 10
  "browsers": [{"value": "Safari", "label": "Safari", "count": 1200, "pct": 100}],           // top 10
  "os": [{"value": "iOS", "label": "iOS", "count": 900, "pct": 100}],                        // top 10
  "languages": [{"value": "de", "label": "Deutsch", "count": 3500, "pct": 100}],             // top 10
  "screen_buckets": [{"value": "desktop", "label": "1024–1600px", "count": 2200, "pct": 100}] // top 10
}
```

## Explicitly not possible with this data

By design, this schema cannot answer questions that require linking multiple
events to "the same visitor" over time - e.g. "did the same person view a trip
and then click Instagram?", or "how many *unique* visitors did we have?". Doing
that would require a persistent per-visitor identifier (cookie/localStorage/
fingerprint hash), which was intentionally left out so that no consent banner
is required. If that trade-off ever changes, it needs a new opt-in consent flow
before any such identifier is introduced.
