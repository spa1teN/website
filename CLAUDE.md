# Website — casparsadenius.de

Persönliche Website mit Reisetagebuch (interaktive Karte), About-Seite und anonymem Analytics-Tracking. Mehrsprachig (DE/EN/FI).

## Stack

| Layer | Tech |
|---|---|
| Backend | Django 5.2, Python 3.13, Django REST Framework |
| Datenbank | PostgreSQL 16 + PostGIS 3.4 |
| Frontend | Django Templates, MapLibre GL JS v5, Vanilla JS |
| Routing | OSRM (Auto), BRouter (Zug), Great-Circle (Flug), Straight-Line (Fähre) |
| Reverse Proxy | Nginx 1.27 (betreibt auch Tausendsassa, Nextcloud, Dashboard, Collabora) |
| Deployment | Docker Compose |
| Server | STRATO VPS, Ubuntu 22.04 |

## Projektstruktur

```
website/
├── config/                          # Django-Projektconfig
│   ├── settings/
│   │   ├── base.py                  # Gemeinsame Settings
│   │   ├── development.py           # DEBUG=True, ALLOWED_HOSTS=*
│   │   └── production.py            # Aus .env, im Docker verwendet
│   ├── urls.py                      # Root-URLs
│   ├── wsgi.py
│   └── middleware.py                # NginxRemoteUserMiddleware, PersistentRemoteUserMiddleware
├── apps/
│   ├── core/                        # Home, Login, Sprache, Admin-Index
│   │   ├── views.py                 # home, privacy, set_language, admin_index
│   │   ├── urls.py
│   │   ├── context_processors.py    # LANG + OTHER_LANGS für Templates
│   │   ├── templatetags/
│   │   │   └── i18n_extra.py        # {% t de en fi %} Template-Tag
│   │   ├── static/core/
│   │   │   ├── css/style.css        # Globales CSS + Navigation + Mobile
│   │   │   ├── js/analytics.js      # Client-seitiges Analytics (sendBeacon)
│   │   │   └── favicon.png
│   │   └── templates/core/
│   │       ├── base.html            # Basis-Template mit Nav, Footer, Sprache
│   │       ├── home.html, login.html, privacy.html
│   │       ├── admin.html           # Admin-Übersicht
│   │       └── admin_sidebar.html
│   ├── links/                       # About-Seite (Social Links + Discord-Status)
│   │   ├── views.py                 # Übergibt DISCORD_USER_ID ans Template
│   │   ├── urls.py
│   │   └── templates/links/links.html
│   ├── diary/                       # Reisetagebuch (Hauptfeature)
│   │   ├── models.py                # Trip, Journey, JourneySegment, TripImage, TripVideo
│   │   ├── views.py                 # Kartenansicht, Trip-Detail, Admin-CRUD
│   │   ├── api_views.py             # GeoJSON REST API (DRF)
│   │   ├── api_urls.py              # /api/diary/{routes,images,videos,trips,stats,visited-countries,states}/
│   │   ├── serializers.py           # DRF-GIS GeoJSON Serializer + TripListSerializer
│   │   ├── forms.py                 # TripForm
│   │   ├── urls.py                  # Frontend-URLs (/diary/...)
│   │   ├── services/
│   │   │   ├── exif.py              # EXIF GPS-Extraktion (Pillow)
│   │   │   ├── routing.py           # OSRM/BRouter/Great-Circle/Straight-Line
│   │   │   ├── geocoding.py         # IATA-Auflösung + Photon-Stationssuche
│   │   │   ├── stats.py             # Statistik-Aggregate (Geo-Index, Distanzen, Länder)
│   │   │   └── map_preview.py       # Statische PNG-Kartenvorschau für OG/Discord-Embeds
│   │   ├── management/commands/
│   │   │   └── generate_thumbnails.py
│   │   ├── data/
│   │   │   ├── airports.json        # ~65 Flughäfen (IATA → Koordinaten)
│   │   │   ├── stations.json        # Bahnhöfe-Cache
│   │   │   ├── countries.geojson    # Natural Earth Länderdaten
│   │   │   └── states.geojson       # Admin-1 Subdivisionen
│   │   ├── static/diary/
│   │   │   ├── css/map.css          # Karten-Layout + Mobile Slide-Panels
│   │   │   └── js/map.js            # MapLibre GL JS: Filter, Marker, Lightbox, Stats
│   │   └── templates/diary/
│   │       ├── map.html             # Interaktive Karte (öffentlich)
│   │       ├── trip_detail.html     # Reise-Detailseite mit Galerie + OG-Metadaten
│   │       ├── trip_form.html       # Reise anlegen/bearbeiten
│   │       ├── trip_delete.html     # Lösch-Bestätigung
│   │       └── dashboard.html       # Admin-Übersicht (Tabelle aller Reisen)
│   └── analytics/                   # Anonymes Pageview/Click-Tracking
│       ├── models.py                # AnalyticsEvent
│       ├── views.py                 # track_event (POST), stats_api (GET)
│       ├── urls.py                  # /api/analytics/{event,stats}/
│       ├── admin.py                 # Read-only Django-Admin
│       ├── geoip.py                 # MaxMind GeoLite2 GeoIP-Auflösung
│       └── useragent.py             # User-Agent-Parsing (user-agents)
├── nginx/                           # Nginx Dockerfile + Config
│   ├── Dockerfile
│   ├── nginx.conf                   # Reverse-Proxy für 5 Subdomains
│   └── .htpasswd
├── docker-compose.yml               # Nginx + Certbot (web/db sind im Dashboard-Stack)
├── Dockerfile
├── requirements.txt
├── manage.py
├── init-letsencrypt.sh
├── DATA_INTERFACE.md                # Analytics-Datenschema für externe Consumer
└── .env                             # Secrets (gitignored)
```

## Docker Compose

Das Website-Repository definiert **zwei** Services:

| Service | Rolle |
|---|---|
| `nginx` | TLS-Terminierung + Reverse Proxy für alle Domains |
| `certbot` | Let's Encrypt Zertifikate (auto-renew alle 12h) |

Die Services `web` (Django/Gunicorn) und `db` (PostGIS) werden vom **Dashboard-Stack** (`/root/dashboard/docker-compose.yml`) verwaltet, da sie dort im selben internen Netzwerk mit dem Dashboard liegen.

### Networks (nginx)

```yaml
networks:
  website_default:     # intern — nginx ↔ web:8000
  tausendsassa:        # external — Tausendsassa Webapp
  nextcloud:           # external — Nextcloud
  dashboard:           # external — Dashboard :8090
```

### Volumes

Alle Volumes sind `external: true` (vom Dashboard-Stack erstellt):

- `website_static_volume` — collectstatic Output (`/app/staticfiles`)
- `website_media_volume` — Hochgeladene Bilder/Videos (`/app/media`)
- `website_certbot_certs` — Let's Encrypt Zertifikate
- `website_certbot_www` — Certbot Challenge-Dateien

**Wichtig:** `media_volume` ist ein Docker Named Volume — Bilder gehen NICHT nach `~/website/media/` auf dem Host, sondern nach `/var/lib/docker/volumes/website_media_volume/_data/`. Für Sync zwischen Umgebungen immer `tar` via Container verwenden.

## Datenmodelle

### Trip
- `title`, `subtitle`, `description`
- `is_event` (bool) — Events haben kein Routing, nur ein Datum
- `event_date` (DateField, optional)
- `outbound_journey` (FK→Journey, SET_NULL)
- `return_journey` (FK→Journey, SET_NULL)
- `embed_images` (M2M→TripImage, max. 3 für Discord/OG-Embeds)
- Properties: `year`, `transport_types`, `outbound_distance_km`, `return_distance_km`
- Cache-Invalidierung: `post_save`/`post_delete` Signals löschen `diary_stats_*`, `diary_geo_index`, `diary_state_index`

### Journey
- `travel_date`, `notes`, `created_at`

### JourneySegment
- `journey` (FK), `order`, `transport_type` (train/car/plane/ferry)
- `waypoints` (JSONField: `[{name, lat, lng}, ...]`)
- `route_geometry` (LineStringField, SRID 4326)
- `origin_code`, `destination_code` (IATA-Codes für Flüge)

### TripImage
- `trip` (FK), `image`, `thumbnail` (auto 800px), `micro_thumbnail` (auto 150px)
- `location` (PointField) — aus EXIF oder manuell gesetzt
- `caption`, `taken_at` (aus EXIF DateTimeOriginal)
- Beim ersten Speichern: EXIF-Extraktion + Thumbnail-Generierung via Pillow

### TripVideo
- `trip` (FK), `video` (FileField), `location` (PointField), `caption`

## URLs

### Öffentlich
| Pfad | Beschreibung |
|---|---|
| `/` | Home-Seite |
| `/about/` | Social-Media-Links + Discord-Status |
| `/datenschutz/` | Datenschutzerklärung |
| `/set-language/<lang>/` | Sprache setzen (de/en/fi) |
| `/diary/` | Interaktive Karte (öffentlich) |
| `/diary/trip/<id>/` | Reise-Detailseite (öffentlich) |

### Geschützt (nginx basic auth)
| Pfad | Beschreibung |
|---|---|
| `/manage/` | Admin-Übersicht |
| `/diary/manage/` | Reise-Dashboard (Tabelle) |
| `/diary/manage/trip/new/` | Neue Reise anlegen |
| `/diary/manage/trip/<id>/edit/` | Reise bearbeiten |
| `/diary/manage/trip/<id>/delete/` | Reise löschen |
| `/diary/manage/resolve-route/` | AJAX: Route aus Wegpunkten berechnen |
| `/diary/manage/resolve-airport/` | AJAX: IATA-Code → Koordinaten |
| `/diary/manage/search-stations/` | AJAX: Ortssuche via Photon |
| `/diary/manage/image/<id>/set-location/` | AJAX: Bild-GPS manuell setzen |
| `/admin/` | Django-Admin |
| `/accounts/login/` | Login (RemoteUser via nginx) |

### APIs
| Pfad | Beschreibung |
|---|---|
| `/api/diary/routes/` | GeoJSON FeatureCollection der Routen |
| `/api/diary/images/` | GeoJSON FeatureCollection der Bilder |
| `/api/diary/videos/` | GeoJSON FeatureCollection der Videos |
| `/api/diary/trips/` | JSON-Liste aller Trips (mit Metadaten) |
| `/api/diary/stats/` | Aggregierte Statistiken |
| `/api/diary/visited-countries/` | GeoJSON der besuchten Länder |
| `/api/diary/states/` | GeoJSON der Bundesländer/Regionen |
| `/api/analytics/event/` | Analytics-Event empfangen (POST, CSRF-exempt) |
| `/api/analytics/stats/` | Aggregierte Analytics-Daten (GET, X-API-Key) |

### API-Filter (Query-Parameter)

- `/api/diary/routes/?year=2024&transport_type=train&trip_id=5`
- `/api/diary/images/?trip_id=5&year=2024`
- `/api/diary/videos/?trip_id=5`
- `/api/diary/stats/?year=2024&transport=train&transport=car&type=journey&country=DE`
- `/api/diary/visited-countries/?year=2024&transport=train&type=journey`
- `/api/diary/states/?country=DE&year=2024`

## Routing-Logik (`services/routing.py`)

- **Auto:** OSRM `/route/v1/driving/`
- **Zug:** BRouter public API (Profil `rail`), Wegpunkte werden via Overpass API auf nächste Bahnhöfe gesnapped; Fallback auf Straight-Line
- **Flugzeug:** Geodätischer Great-Circle-Bogen (50 Punkte, kein API-Call)
- **Fähre:** Gerade Linie zwischen Wegpunkten
- Routen werden beim Speichern aufgelöst und in `route_geometry` gecacht

## Statistik-Services (`services/stats.py`)

- `compute_stats(lang, years, transports, types, countries)` → `{images_by_country, distance_by_transport, summary}` — 1h Cache bei ungefilterten Requests
- `compute_geo_index()` → `{trip_countries, all_countries}` — Point-in-Polygon Länderauflösung aus Natural-Earth-Daten + Trip-Destination-Fallback
- `compute_visited_countries_geojson(lang, ...)` → GeoJSON FeatureCollection
- `compute_states_geojson(lang, country_iso_a2, ...)` → Regionen-GeoJSON

## Map Preview (`services/map_preview.py`)

Generiert statische 630×630 PNG-Karten für OG/Discord-Embeds. Nutzt die `staticmap`-Library mit CartoDB-Dark-Tiles. Rendert alle Routen-Segmente in Transportfarben plus orangene Waypoint-Marker. Wird bei `trip_detail` als `og:image` verwendet.

## Formulareingabe (`trip_form.html`)

- **Typ-Auswahl:** Reise oder Event (Radio-Buttons)
- **Event:** Nur Datum (`event_date`), keine Journeys
- **Reise:** Hinreise + Rückreise mit mehreren Segmenten
- **Flug:** IATA-Codes für Start/Ziel (z.B. `TXL`, `LIS`), Autovervollständigung aus `airports.json`
- **Zug/Auto/Fähre:** Wegpunkte per Textsuche (Photon-API) oder Kartenklick
- **Bild-Upload:** EXIF-Extraktion automatisch; manuelles Setzen via Pin-Button

## Analytics (`apps/analytics/`)

Anonymes Pageview- und Click-Tracking — keine IP-Adressen, Cookies oder Session-IDs.

- **AnalyticsEvent:** `event_type` (pageview/click), `path`, `target`, `referrer_domain`, `country`, `city`, `latitude`, `longitude`, `device_type` (desktop/mobile/tablet/bot), `browser`, `os`, `language`, `screen_bucket`
- **GeoIP:** MaxMind GeoLite2-City (optional, Pfad in `.env`)
- **Client:** `apps/core/static/core/js/analytics.js` — sendet Events per `navigator.sendBeacon()`
- **Stats API:** `/api/analytics/stats/` mit `X-API-Key`-Header (vom Dashboard konsumiert)
- **Ausschluss:** Authentifizierte User, Pfade mit `/admin`/`/staticfiles`/`/media`/`/api`/`/accounts`/`/diary/manage`
- Daten sind read-only im Django-Admin

## Authentifizierung

Nginx Basic Auth + Django `RemoteUserBackend`:

1. Nginx prüft Basic Auth für geschützte Pfade (`/admin/`, `/diary/manage/`, `/manage/`)
2. `NginxRemoteUserMiddleware` kopiert `HTTP_REMOTE_USER` → `REMOTE_USER` in `request.META`
3. `PersistentRemoteUserMiddleware` (mit `force_logout_if_no_header = False`) hält die Session auf öffentlichen Seiten
4. Django erstellt/aktualisiert den User automatisch — kein separates Login-Formular

## Mehrsprachigkeit

Drei Sprachen: DE (default), EN, FI. Sprache wird per Session (`request.session["lang"]`) gespeichert. Umschaltung via `/set-language/<lang>/`. Das `{% t "DE" "EN" "FI" %}` Template-Tag rendert den passenden String. Die Karten-API endpoints akzeptieren `?lang=` für lokalisierte Labels.

## Deployment

```bash
# Lokal entwickeln (docker-compose v1)
docker-compose up -d                    # Nur nginx + certbot
docker-compose exec -T web python manage.py migrate
docker-compose exec -T web python manage.py makemigrations

# Server (docker compose v2)
ssh root@87.106.242.207 "cd ~/website && git pull && docker compose restart web"

# Mit Migration:
ssh root@87.106.242.207 "cd ~/website && git pull && docker compose exec -T web python manage.py migrate && docker compose restart web"
```

- `.env` ist in `.gitignore` — bleibt auf dem Server
- `apps/*/static/` ist in Git — wird mit `git pull` aktualisiert
- `staticfiles/` (collectstatic-Output) ist im Docker Named Volume
- Production nutzt cached Template Loader (`DEBUG=False`) → nach Template-Änderungen: `docker compose restart web`
- Settings-Modul im Docker: `config.settings.production`

## Umgebungsvariablen (`.env`)

- `SECRET_KEY` — Django Secret Key
- `DEBUG` — 0 oder 1
- `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`
- `OSRM_API_URL` — Default: `https://router.project-osrm.org`
- `DISCORD_USER_ID` — Discord-User-ID für Lanyard-Status auf `/about/`
- `ALLOWED_HOSTS` — Kommagetrennte Liste
- `ANALYTICS_GEOIP_DB_PATH` — Pfad zur MaxMind GeoLite2-City.mmdb (optional)
- `ANALYTICS_DASHBOARD_API_KEY` — Shared Secret für die Stats-API

## Wichtige Hinweise

- Nginx ist der **einzige** Reverse Proxy für alle Domains (`casparsadenius.de`, `tausendsassa.casparsadenius.de`, `nextcloud.casparsadenius.de`, `dashboard.casparsadenius.de`, `collabora.casparsadenius.de`)
- Die `web`- und `db`-Container werden vom Dashboard-Stack gestartet (nicht von diesem Compose-File)
- `web`-Container hat Volume-Mount `/root/website:/app` (Live-Code, kein Image-Rebuild nötig bei Code-Änderungen)
- `LOCALE_PATHS` ist nicht gesetzt → Django nutzt `USE_L10N=True` mit deutschem Locale. Bei Zahlenformatierung in Templates `|stringformat:'.6f'` nutzen (z.B. für GPS-Koordinaten), da `{{ value }}` im deutschen Locale Kommas statt Punkte rendert
- `TripImage.save()` macht EXIF-Extraktion + Thumbnail-Generierung nur beim ersten Speichern (`is_new = pk is None`)
- Stats/Geo-Indizes sind via Django-Cache gecached (1h TTL), invalidiert durch Model-Signals
- `DATA_INTERFACE.md` dokumentiert das Analytics-Datenschema für externe Consumer (Dashboard)
