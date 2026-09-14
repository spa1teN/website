# Website — casparsadenius.de

Persönliche Website mit Reisetagebuch (interaktive Karte), About-Seite und anonymem Analytics-Tracking. Mehrsprachig (DE/EN).

## Stack

| Layer | Tech |
|---|---|
| Backend | Django 5.2, Python 3.13, Django REST Framework |
| Datenbank | PostgreSQL 16 + PostGIS 3.4 |
| Frontend | Django Templates, MapLibre GL JS v5, Vanilla JS |
| Routing | OSRM (Auto), BRouter (Zug), Great-Circle (Flug), Straight-Line (Fähre) |
| Reverse Proxy | Nginx 1.27 (betreibt auch Tausendsassa, Nextcloud, Dashboard) |
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
│   └── middleware.py                # NginxRemoteUserMiddleware, PersistentRemoteUserMiddleware, SessionLanguageMiddleware, NoCacheHtmlMiddleware
├── apps/
│   ├── core/                        # Home, Login, Sprache, Admin-Index
│   │   ├── views.py                 # home, privacy, set_language, admin_index
│   │   ├── urls.py
│   │   ├── context_processors.py    # LANG + OTHER_LANGS für Templates
│   │   ├── templatetags/
│   │   │   └── i18n_extra.py        # {% t de en %} Template-Tag
│   │   ├── static/core/
│   │   │   ├── css/style.css        # Globales CSS + Navigation + Mobile
│   │   │   ├── js/analytics.js      # Client-seitiges Analytics (sendBeacon)
│   │   │   └── favicon.png
│   │   └── templates/core/
│   │       ├── base.html            # Basis-Template mit Nav, Footer (Kontakt links, Admin rechts, Sprache)
│   │       ├── home.html            # Startseite mit Link-Karten zu /about/, /status/ und Besucherstatistik
│   │       ├── login.html, privacy.html
│   │       ├── admin.html           # Admin-Übersicht
│   │       └── admin_sidebar.html
│   ├── links/                       # Links-Seite + Bot-Status (Social Links, Discord, Tausendsassa/RoaringBot)
│   │   ├── views.py                 # links, status_overview/status_roaringbot/status_tausendsassa (Dashboard-API)
│   │   ├── urls.py
│   │   ├── status_urls.py           # /status/ (app_name="status"), /status/roaringbot/, /status/tausendsassa/
│   │   └── templates/links/
│   │       ├── links.html           # "Finde mich hier": Social-Links (Icons + Username, 3er-Raster), Spotify, Discord-Karte + Lanyard-Status
│   │       ├── status.html          # Bot-Status-Karten (Tausendsassa, RoaringBot, Match-Previews)
│   │       └── status_api.html      # API-Doku für die Dashboard-Endpoints
│   ├── about/                       # Interaktiver Lebenslauf (Karte + integrierte Stations-Karten)
│   │   ├── views.py                 # index — lokalisiert STATIONS (DE/EN) und übergibt JSON
│   │   ├── urls.py                  # /about/ (app_name="about")
│   │   ├── stations.py              # STATIONS-Daten (Titel/Text pro Sprache, Karten-Konfig, {Text|URL}-Links)
│   │   ├── templates/about/about.html
│   │   └── static/about/
│   │       ├── css/about.css        # Textbox unten fixiert, Bild-Marker am Ort, Herkunfts-Kamera, Mobile
│   │       ├── js/about.js          # MapLibre: Bild-Marker am Ort, Textbox unten, smoothFly-Übergänge, Links
│   │       └── data/fi-de.geojson   # FI+DE Polygone (aus diary/data/countries.geojson extrahiert)
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
│   │   │   ├── js/map.js            # MapLibre GL JS: Filter, Marker, Lightbox, Stats, Modi Reisen/Besuchte Länder
│   │   └── templates/diary/
│   │       ├── map.html             # Interaktive Karte (öffentlich, kein Heatmap-Modus mehr)
│   │       ├── trip_detail.html     # Reise-Detailseite mit Galerie + OG-Metadaten
│   │       ├── trip_form.html       # Reise anlegen/bearbeiten
│   │       ├── trip_delete.html     # Lösch-Bestätigung
│   │       └── dashboard.html       # Admin-Übersicht (Tabelle aller Reisen)
│   └── analytics/                   # Anonymes Pageview/Click-Tracking
│       ├── models.py                # AnalyticsEvent
│       ├── views.py                 # track_event (POST), stats_api (GET), stats_page (/statistics/)
│       ├── urls.py                  # /api/analytics/{event,stats}/
│       ├── admin.py                 # Read-only Django-Admin
│       ├── geoip.py                 # MaxMind GeoLite2 GeoIP-Auflösung
│       ├── useragent.py             # User-Agent-Parsing (user-agents)
│       ├── static/analytics/        # stats.css, stats.js (Karte, Heatmap, Breakdowns)
│       └── templates/analytics/     # stats_page.html
├── nginx/                           # Nginx Dockerfile + Config
│   ├── Dockerfile
│   ├── nginx.conf                   # Reverse-Proxy für 8 Subdomains
│   └── .htpasswd
├── docker-compose.yml               # Einheitlicher Stack: nginx, certbot, trilium, open-webui, dashboard, dawarich, immich, web, db
├── Dockerfile
├── requirements.txt
├── manage.py
├── init-letsencrypt.sh
├── DATA_INTERFACE.md                # Analytics-Datenschema für externe Consumer
└── .env                             # Secrets (gitignored)
```

## Docker Compose

Das Website-Repository definiert den **einheitlichen Stack** — alle
Selfhosted-Dienste in einem einzigen Compose-Projekt (Netzwerk `website_default`):

| Service | Rolle |
|---|---|
| `nginx` | TLS-Terminierung + Reverse Proxy für alle Domains |
| `certbot` | Let's Encrypt Zertifikate (auto-renew alle 12h) |
| `trilium` | TriliumNext Notes (Markdown + KaTeX-LaTeX), unter `notes.casparsadenius.de` |
| `open-webui` | Chat-Interface (Open WebUI), unter `chat.casparsadenius.de` |
| `dashboard` | Ops-Dashboard (FastAPI), unter `dash.casparsadenius.de` (Basic Auth) |
| `dawarich_app` / `dawarich_sidekiq` / `dawarich_db` / `dawarich_redis` | Dawarich (Zeitstrahl/Location-Tracking), unter `map.sadenius.eu` |
| `immich-server` / `immich-machine-learning` / `immich-redis` / `immich-database` | Immich (Foto-/Video-Bibliothek), unter `fotos.sadenius.eu` |
| `web` | Django/Gunicorn Website |
| `db` | PostGIS 16 Datenbank |

Der Dashboard-Header zeigt nur **einen** Stack-Pill ("Stack") plus separate Pills
für Nextcloud/RoaringBot/Tausendsassa — alle Stack-Container tragen das gleiche
`com.docker.compose.project=website`-Label. Es gibt **kein separates
Dashboard-Compose** mehr (gelöscht), der Dashboard-Code liegt in
`/root/dashboard/`.

### Trilium Notes

- Image `triliumnext/trilium:stable` (Port 8080, kein Host-Port-Mapping — nur über nginx)
- Daten im Docker-Volume `website_trilium_data` (external, `/home/node/trilium-data`)
- Einzel-User mit Passwort (Setup-Page beim ersten Aufruf), LaTeX via KaTeX (`$...$`)
- nginx-config ist **im Image gebacken** → nach Änderungen an `nginx/nginx.conf`: `docker compose up -d --build nginx`
- Neues Let's Encrypt Zertifikat: erst HTTP-Serverblock (ACME) in nginx.conf, dann `docker compose run --rm --entrypoint "certbot certonly --webroot --webroot-path=/var/www/certbot -d <sub>.casparsadenius.de" certbot`, dann HTTPS-Serverblock + `--build nginx`
- **Share-Proxy-Cache:** `bot.wannspieltbig.de` wird via `proxy_cache share_cache` gecacht (`X-Proxy-Cache`-Header: `MISS`/`HIT`). Wiederholte Social-Crawls (WhatsApp/X/…) werden von nginx bedient, ohne den `wannspieltbig-social-preview`-Container zu berühren. Requests mit Cache-Buster-Query (`?v=…`) sind neue Cache-Keys und laufen immer am Cache vorbei. Cache-Zone: `proxy_cache_path … keys_zone=share_cache:10m` (oben in nginx.conf).

### Networks (nginx)

```yaml
networks:
  website_default:     # intern — nginx ↔ web:8000, dashboard:8090, trilium:8080, open-webui:8080
  website_dawarich:    # Dawarich intern — nginx ↔ dawarich_app:3000, DB/Redis nicht exponiert
  website_immich:      # Immich intern — nginx ↔ immich-server:2283, DB/Redis nicht exponiert
  tausendsassa:        # external — Tausendsassa Webapp
  nextcloud:           # external — Nextcloud
  dashboard-network:   # bridge — Dashboard :8090 + social-preview (bot.wannspieltbig.de)
```

### Dawarich (map.sadenius.eu)

- 4 Container: `dawarich_app` (Rails/Puma, Port 3000, kein Host-Port-Mapping — nur über nginx), `dawarich_sidekiq` (Background-Jobs), `dawarich_db` (PostGIS 17, `postgis/postgis:17-3.5-alpine`), `dawarich_redis` (Redis 7.4, Persistenz im `dawarich_shared`-Volume)
- Eigene Datenbank/Redis im isolierten Netz `website_dawarich` — getrennt von der Website-DB (`db`). Secrets in `.env`: `DAWARICH_DB_PASSWORD`, `DAWARICH_SECRET_KEY_BASE`
- `APPLICATION_HOSTS: map.sadenius.eu,...`, `APPLICATION_PROTOCOL: https`, `DOMAIN: map.sadenius.eu`
- Default-Zugang: `privat@casparsadenius.de` / `safepassword` (bei Erst-Login ändern)
- **Wichtig — Healthcheck:** Wegen `APPLICATION_PROTOCOL=https` erzwingt Rails `force_ssl` und redirectet interne http-Requests → https (Puma macht kein SSL). Der Healthcheck sendet daher `X-Forwarded-Proto: https` (sonst hängt `health: starting`).
- Volumes: `dawarich_db_data`, `dawarich_shared`, `dawarich_public`, `dawarich_watched`, `dawarich_storage` (alle im website-Projekt)
- **Backup:** DB-Dump + `dawarich_app:/var/app/storage` + `/var/app/public`-Tars → Nextcloud `Backups/dawarich/`, Retention 14 Tage (via Dashboard `backup.py`)
- **RAM:** Nach einem kompletten Neustart (oder langem Ausfall) rechnet Dawarich das Reverse-Geocoding für die komplette Timeline nach — das drückt den RAM mehrere Stunden/Wochen lang hoch (Ursache für den VPS-Reboot am 13.09.2026). Nach Abschluss entspannt sich die Last wieder. Ggf. währenddessen die Alert-Schwelle für Swap/RAM im Dashboard beachten (Mails sind zu erwarten).
- Update: `docker compose pull dawarich_app dawarich_sidekiq && docker compose up -d dawarich_app dawarich_sidekiq`

### Immich (fotos.sadenius.eu)

- 4 Container: `immich-server` (Node/NestJS, Port 2283, kein Host-Port-Mapping — nur über nginx), `immich-machine-learning` (Port 3003, Modell-Cache im `immich_model_cache`-Volume), `immich-redis` (Valkey 9), `immich-database` (Postgres 14 + vectorchord, `ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0`)
- Eigene DB/Redis im isolierten Netz `website_immich`. Secret in `.env`: `IMMICH_DB_PASSWORD`
- **Wichtig:** `DB_HOSTNAME: immich-database` und `REDIS_HOSTNAME: immich-redis` müssen gesetzt sein — Immich erwartet standardmäßig `database`/`redis` als Hostnamen, unsere Service-Namen heißen anders (sonst Crash mit `ENOTFOUND`)
- nginx: `client_max_body_size 50000M`, `proxy_request_buffering off`, WebSocket-Upgrade-Header, 600s Timeouts
- **RAM:** `MACHINE_LEARNING_WORKERS: "1"` gesetzt (sonst Default = alle CPUs, drückt das 7.7-GiB-System in Memory-Pressure → VPS-Reboot). Bei ML-Workloads beobachten: Faces/Smart-Search stoßen den Worker kurz auf ~1.5 GiB hoch
- Volumes: `immich_library` (Uploads, `/data`), `immich_postgres`, `immich_model_cache` (alle im website-Projekt)
- **Backup:** DB-Dump + `immich_server:/data`-Volume-Tar → Nextcloud `Backups/immich/`, Retention 2 Tage (via Dashboard `backup.py`)
- Setup: erster Aufruf von `https://fotos.sadenius.eu` → Admin-Konto anlegen
- Update: `docker compose pull immich-server immich-machine-learning && docker compose up -d immich-server immich-machine-learning`

### Open WebUI — Web-Loader (Playwright)

- `WEB_LOADER_ENGINE: playwright` + `PLAYWRIGHT_BROWSERS_PATH: /app/backend/data/cache/playwright` im Compose. `start.sh` installiert Chromium nur, wenn die **Env-Variable** `WEB_LOADER_ENGINE=playwright` gesetzt ist (die DB-Einstellung `web.loader.engine` allein genügt nicht).
- Browser liegt im persistenten `open-webui`-Volume → überlebt Container-Rebuilds.
- Neue Container-Recreation lädt Chromium beim Start herunter (dauert ~1–2 min, dann `health: starting` bis fertig).

### Volumes

Alle Volumes sind `external: true`:

- `website_static_volume` — collectstatic Output (`/app/staticfiles`)
- `website_media_volume` — Hochgeladene Bilder/Videos (`/app/media`)
- `website_certbot_certs` — Let's Encrypt Zertifikate
- `website_certbot_www` — Certbot Challenge-Dateien
- `website_trilium_data` — Trilium-Daten
- `website_postgres_data` — PostGIS-Daten
- `dashboard_history` — SQLite-History des Dashboards (name: `dashboard_dashboard_history`)
- `open-webui` — Open-WebUI-Daten
- `dawarich_db_data`, `dawarich_shared`, `dawarich_public`, `dawarich_watched`, `dawarich_storage` — Dawarich-Daten
- `immich_library` — Immich-Uploads (`/data`), `immich_postgres`, `immich_model_cache`

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
| `/links/` | Social-Media-Links (Icons + Username) + Discord-Status |
| `/statistics/` | Besucherstatistik (Karte, Referrer, Zeit-Heatmap) |
| `/status/` | Bot-Status (Tausendsassa, RoaringBot, Match-Previews) |
| `/about/` | Interaktiver Lebenslauf (Karte + Stations-Karten, Deep-Links `#slug`) |
| `/datenschutz/` | Datenschutzerklärung |
| `/set-language/<lang>/` | Sprache setzen (de/en) |
| `/trips/` | Interaktive Karte (öffentlich) |
| `/trips/trip/<id>/` | Reise-Detailseite (öffentlich) |

### Geschützt (nginx basic auth)
| Pfad | Beschreibung |
|---|---|
| `/manage/` | Admin-Übersicht (Footer-Link immer sichtbar, per Basic Auth geschützt) |
| `/trips/manage/` | Reise-Dashboard (Tabelle) |
| `/trips/manage/trip/new/` | Neue Reise anlegen |
| `/trips/manage/trip/<id>/edit/` | Reise bearbeiten |
| `/trips/manage/trip/<id>/delete/` | Reise löschen |
| `/trips/manage/resolve-route/` | AJAX: Route aus Wegpunkten berechnen |
| `/trips/manage/resolve-airport/` | AJAX: IATA-Code → Koordinaten |
| `/trips/manage/search-stations/` | AJAX: Ortssuche via Photon |
| `/trips/manage/image/<id>/set-location/` | AJAX: Bild-GPS manuell setzen |
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
| `/api/diary/photo-heatmap/` | GeoJSON der Bildpunkte (Heatmap-API, kein Frontend mehr) |
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

## About-Seite (`apps/about/`)

Interaktiver Lebenslauf auf einer statischen (nicht pannbaren) dunklen Karte. Jede Station hat eine Textbox am unteren Rand; das Stations-Bild (falls vorhanden) liegt als kleine Karte direkt am geografischen Ort.

- **Stations-Textbox:** Titel + Text + Navigation (Pfeile + Dots) in einer Box, `position:absolute` unten fixiert (`.about-station-card-bottom`, zentriert, 640px bzw. 320px für Text-only). Die Kamera bekommt Bottom-Padding (Textbox-Höhe + `BOTTOM_GAP`), damit Ort/Bild oberhalb der Textbox sichtbar bleiben.
- **Bild am Ort:** Bei Stationen mit Bild liegt das Bild als kleiner Marker direkt am geografischen Punkt (`.station-map-img`, anchor bottom + `CARD_GAP`, 150×110px; Logos mit `object-fit:contain`). Mehrfach-Anker-Stationen (Herkunft: DE+FI) haben kein Bild.
- **Punkt-Marker:** Der orangene Puls-/Kern-Marker (Source `station-markers`) erscheint **nur** bei Stationen mit explizitem Ort (`map.markers`), nicht bei reinen Länder-Stationen — DE+FI zeigen nur die Länder-Hervorhebung ohne Punkte.
- **Karten-Popup:** Klick auf den Punkt-Marker öffnet ein Popup mit dem Stations-Bild (`openStationPopup`).
- **Herkunfts-Kamera:** Länder-Überblick wird **synchron** berechnet (`computeFitCameraSettled`, Cache in `getFitCamera`, Key inkl. Textbox-Höhe). Das Bottom-Padding räumt die Bounds automatisch über die Textbox — DE+FI bleiben frei sichtbar, die Textbox liegt darunter im Nordsee-Gebiet (Schottland/Norwegen).
- **Übergänge:** `smoothFly` — Flugdauer zoom-relativ (`flyDuration` = 700 + 260·Δz), Zoom hinkt beim Reinzoomen hinterher / führt beim Rauszoomen (pan-then-zoom-Gefühl), Apex-Bump nur wenn nötig.
- **Navigation:** Pfeiltasten + Kartenklick, Deep-Links `/about/#<slug>` starten direkt bei einer Station, Start-Puls-Marker.
- **Links im Fließtext:** `{Text|URL}`-Marker in `stations.py` werden serverseitig geliefert und clientseitig zu `<a target="_blank" rel="noopener">` (kein HTML aus Daten, DOM-basiert).

## Status-Seite (`apps/links/status*`)

Bot-Status-Seite unter `/status/` (Details unter `/status/roaringbot/` und `/status/tausendsassa/`). Die Views fetchen vom internen Dashboard (`http://dashboard:8090`, 60s Cache via `_cached_fetch`) die Public-Status-Endpoints `/api/tausendsassa/status`, `/api/roaringbot/status` und `/api/social-preview/status`.

- **Cog-Chips:** geladene Cogs der Bots. Tausendsassa-Cogs werden capitalisiert (z.B. `feeds` → `Feeds`); RoaringBot-Cogs bekommen das `Cog`-Suffix entfernt (z.B. `ModerationCog` → `Moderation`) und interne Cogs (`FinanceCog`, `BirthdayCog`) werden ausgefiltert. Alle Chips haben einen Status-Dot; der `Previews`-Chip spiegelt die Health von `bot.wannspieltbig.de`.
- **Match-Cards:** RoaringBot `next_matches` werden clientseitig gerendert (LIVE-Badge, Score, Status-Dots für Discord-Event/Reminder/Tracker, Preview-Bilder via `bot.wannspieltbig.de/<match_id>/image.jpg`).
- **Sparklines:** duale Verlaufsdiagramme (Messages/Errors) aus `/api/history` auf Canvas.
- **API-Doku:** `/status/api/` (`status_api.html`) beschreibt die vier Dashboard-Status-Endpoints.

## Analytics (`apps/analytics/`)

Anonymes Pageview- und Click-Tracking — keine IP-Adressen, Cookies oder Session-IDs.

- **AnalyticsEvent:** `event_type` (pageview/click), `path`, `target`, `referrer_domain`, `country`, `city`, `latitude`, `longitude`, `device_type` (desktop/mobile/tablet/bot), `browser`, `os`, `language`, `screen_bucket`
- **GeoIP:** MaxMind GeoLite2-City (optional, Pfad in `.env`)
- **Client:** `apps/core/static/core/js/analytics.js` — sendet Events per `navigator.sendBeacon()`
- **Stats API:** `/api/analytics/stats/` mit `X-API-Key`-Header (vom Dashboard konsumiert)
- **Stats-Seite:** Öffentliche `/statistics/`-Seite (`stats_page` in `views.py`) zeigt KPI-Zeile, MapLibre-Karte, Referrer und Zeit-Heatmap. Aggregat-Berechnung ist via Django-Cache 60s gecached. Der Home-Card „Du bist Besucher Nr. X" nutzt `total_pageviews`. Der Karten-Popup ist per `stats.css` auf das Dark-Theme gemappt (`.maplibregl-popup-content`-Overrides — sonst wäre der Default-Popup weiß).
- **Ausschluss:** Authentifizierte User, Pfade mit `/admin`/`/staticfiles`/`/media`/`/api`/`/accounts`/`/trips/manage`
- Daten sind read-only im Django-Admin

## Authentifizierung

Nginx Basic Auth + Django `RemoteUserBackend`:

1. Nginx prüft Basic Auth für geschützte Pfade (`/admin/`, `/trips/manage/`, `/manage/`)
2. `NginxRemoteUserMiddleware` kopiert `HTTP_REMOTE_USER` → `REMOTE_USER` in `request.META`
3. `PersistentRemoteUserMiddleware` (mit `force_logout_if_no_header = False`) hält die Session auf öffentlichen Seiten
4. Django erstellt/aktualisiert den User automatisch — kein separates Login-Formular

## Mehrsprachigkeit

Zwei Sprachen: DE (default), EN. Sprache wird per Session (`request.session["lang"]`) gespeichert. Umschaltung via `/set-language/<lang>/`. Das `{% t "DE" "EN" %}` Template-Tag rendert den passenden String. Die Karten-API endpoints akzeptieren `?lang=` für lokalisierte Labels. Die About-Seite lokalisiert ihre Stations-Texte serverseitig in `apps/about/views.py` (gleiche de/en-Logik wie `{% t %}`).

## Deployment

```bash
# Lokal entwickeln (docker-compose v1)
docker-compose up -d                    # Kompletter Stack
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
- `DISCORD_USER_ID` — Discord-User-ID für Lanyard-Status auf `/links/`
- `ALLOWED_HOSTS` — Kommagetrennte Liste
- `ANALYTICS_GEOIP_DB_PATH` — Pfad zur MaxMind GeoLite2-City.mmdb (optional)
- `ANALYTICS_DASHBOARD_API_KEY` — Shared Secret für die Stats-API
- `OPEN_WEBUI_SECRET_KEY` — Secret für den Open-WebUI-Container
- `DAWARICH_DB_PASSWORD`, `DAWARICH_SECRET_KEY_BASE` — Secrets für Dawarich (eigene DB im `website_dawarich`-Netz)
- `IMMICH_DB_PASSWORD` — Secret für Immich (eigene DB im `website_immich`-Netz)

## Wichtige Hinweise

- Nginx ist der **einzige** Reverse Proxy für alle Domains (`casparsadenius.de`, `tausendsassa.casparsadenius.de`, `cloud.sadenius.eu`, `dash.casparsadenius.de`, `notes.casparsadenius.de`, `chat.casparsadenius.de`, `map.sadenius.eu`, `fotos.sadenius.eu`)
- Alle Stack-Services (`nginx`, `certbot`, `trilium`, `open-webui`, `dashboard`, `dawarich_*`, `immich-*`, `web`, `db`) werden von **diesem** Compose-File gestartet
- `web`-Container hat Volume-Mount `/root/website:/app` (Live-Code, kein Image-Rebuild nötig bei Code-Änderungen)
- `LOCALE_PATHS` ist nicht gesetzt → Django nutzt `USE_L10N=True` mit deutschem Locale. Bei Zahlenformatierung in Templates `|stringformat:'.6f'` nutzen (z.B. für GPS-Koordinaten), da `{{ value }}` im deutschen Locale Kommas statt Punkte rendert
- `TripImage.save()` macht EXIF-Extraktion + Thumbnail-Generierung nur beim ersten Speichern (`is_new = pk is None`)
- Stats/Geo-Indizes sind via Django-Cache gecached (1h TTL), invalidiert durch Model-Signals
- `DATA_INTERFACE.md` dokumentiert das Analytics-Datenschema für externe Consumer (Dashboard)
