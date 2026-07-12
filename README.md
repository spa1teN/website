# spa1teN – Persönliche Website

## Tech-Stack

- **Backend:** Django 5.2, Python 3.13
- **Datenbank:** PostgreSQL 16 + PostGIS 3.4
- **Frontend:** Django Templates, MapLibre GL JS v5, Vanilla JS
- **Routing:** OSRM (Auto), BRouter (Zug), Great-Circle (Flug), gerade Linie (Fähre)
- **Deployment:** Docker Compose
- **Reverse Proxy:** Nginx 1.27 (auch für Tausendsassa, Nextcloud, Dashboard, Collabora)
- **Produktionsserver:** `casparsadenius.de` (STRATO VPS, Ubuntu 22.04)

## Projektstruktur

```
website/
├── config/                     # Django-Projektconfig
│   ├── settings/
│   │   ├── base.py             # Gemeinsame Settings
│   │   ├── development.py      # DEBUG=True, ALLOWED_HOSTS=*
│   │   └── production.py       # Aus .env, wird im Docker verwendet
│   ├── urls.py                 # Root-URLs
│   └── wsgi.py
├── apps/
│   ├── core/                   # Home-Seite, base.html, Navigation, Login, Datenschutz
│   │   ├── views.py            # home, privacy, set_language
│   │   │   static/core/
│   │   │   ├── css/style.css   # Globales CSS + Mobile-Responsive
│   │   │   └── js/analytics.js # Client-seitiges Analytics-Tracking
│   │   └── templates/core/
│   │       ├── base.html, home.html, login.html, privacy.html
│   ├── links/                  # Social-Media-Links + Discord-Status (gemounted unter /about/)
│   │   ├── views.py            # Übergibt DISCORD_USER_ID ans Template
│   │   └── templates/links/links.html
│   ├── diary/                  # Reisetagebuch (Kernfeature)
│   │   ├── models.py           # Trip, Journey, JourneySegment, TripImage, TripVideo
│   │   ├── views.py            # Kartenansicht + Admin-CRUD
│   │   ├── api_views.py        # GeoJSON REST API
│   │   ├── api_urls.py         # /api/diary/{routes,images,videos,trips,stats,visited-countries,states}/
│   │   ├── serializers.py      # DRF-GIS GeoJSON Serializer
│   │   ├── forms.py            # TripForm
│   │   ├── services/
│   │   │   ├── exif.py         # EXIF GPS-Extraktion (Pillow)
│   │   │   ├── routing.py      # Routing-Logik (OSRM/BRouter/Great-Circle)
│   │   │   ├── geocoding.py    # IATA-Auflösung + Photon-Stationssuche
│   │   │   └── stats.py        # Statistik-Aggregate für die Karte
│   │   ├── data/
│   │   │   ├── airports.json   # ~65 Flughäfen (IATA → Koordinaten)
│   │   │   ├── stations.json   # Bahnhöfe-Cache
│   │   │   ├── countries.geojson, states.geojson
│   │   └── static/diary/
│   │       ├── css/map.css     # Karten-Layout + Mobile Bottom Drawer
│   │       └── js/map.js       # MapLibre GL JS: Filter, Marker, Lightbox
│   └── analytics/              # Anonymes Pageview/Click-Tracking
│       ├── models.py           # AnalyticsEvent
│       ├── views.py            # track_event (POST), stats_api (GET)
│       ├── urls.py             # /api/analytics/{event,stats}/
│       ├── admin.py            # Read-only Django-Admin
│       ├── geoip.py            # MaxMind GeoLite2 GeoIP-Auflösung
│       └── useragent.py        # User-Agent-Parsing (user-agents)
├── nginx/                      # Nginx Dockerfile + Config
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
├── init-letsencrypt.sh         # Einmaliges SSL-Bootstrap-Skript
└── .env                        # Secrets, DB-Config, OSRM-URL, Discord-ID, Analytics
```

## Docker

### Lokal (docker-compose v1)

- **Befehl:** `docker-compose` (v1-Syntax)
- **Starten:** `docker-compose up -d`
- **Stoppen:** `docker-compose down`
- **Rebuild:** `docker-compose build && docker-compose up -d`
- **Logs:** `docker-compose logs -f web`
- **Migrationen:** `docker-compose exec -T web python manage.py migrate`
- **Neue Migrationen:** `docker-compose exec -T web python manage.py makemigrations`
- **Shell:** `docker-compose exec -T web python manage.py shell`

### Server (docker compose v2)

- **Befehl:** `docker compose` (v2-Syntax, kein Bindestrich)
- Gleiche Unterbefehle wie oben, nur ohne Bindestrich

### Gemeinsam

- Settings-Modul im Docker: `config.settings.production`
- Settings-Modul lokal: `config.settings.development`
- Web: Port 80/443 (Nginx) → Port 8000 (Gunicorn)
- Nginx reverse-proxy: betreibt auch `tausendsassa.casparsadenius.de`,
  `nextcloud.casparsadenius.de`, `dashboard.casparsadenius.de` und
  `collabora.casparsadenius.de` (alle über externe Docker-Netzwerke)

## Docker Volumes — WICHTIG

```yaml
- .:/app                        # Code (bind-mount, direkt vom Host)
- static_volume:/app/staticfiles  # Gesammelte Static Files (collectstatic)
- media_volume:/app/media        # Hochgeladene Bilder (NICHT im Host-Verzeichnis!)
```

- **`media_volume`** ist ein Docker Named Volume — Bilder gehen NICHT nach
  `~/website/media/` auf dem Host, sondern in
  `/var/lib/docker/volumes/website_media_volume/_data/`
- `~/website/media/` auf dem Host wird vom Container ignoriert (Named Volume
  hat Vorrang)
- Für Media-Sync zwischen Umgebungen **immer tar+pipe via Container**
  verwenden (kein rsync auf Host-Verzeichnis):

  ```bash
  # Lokal → Server (alle Medien):
  docker-compose exec -T web tar -C /app/media -czf - trips/ | \
    ssh root@87.106.242.207 "cd ~/website && docker compose exec -T web tar -C /app/media -xzf -"
  ```

## Deployment-Workflow

```bash
# Lokal ändern, committen, pushen:
git add . && git commit -m "..." && git push

# Auf Server deployen (mit Migration falls nötig):
ssh root@87.106.242.207 "cd ~/website && git pull && docker compose exec -T web python manage.py migrate && docker compose restart web"

# Als Einzeiler (ohne Migration):
git push && ssh root@87.106.242.207 "cd ~/website && git pull && docker compose restart web"
```

- `.env` ist in `.gitignore` — wird nie gepusht, bleibt auf dem Server
- `apps/*/static/` (CSS, JS) **ist in Git** — wird mit `git pull` aktualisiert
- `staticfiles/` (collectstatic-Output) ist in `.gitignore` und im Docker Named Volume

## Datenmodelle (`apps/diary/models.py`)

- **Trip:** title, subtitle, description, is_event (bool), event_date,
  outbound_journey (FK→Journey), return_journey (FK→Journey), created_at,
  updated_at
- **Journey:** travel_date, notes, created_at
- **JourneySegment:** journey (FK), order, transport_type
  (train/car/plane/ferry), waypoints (JSONField), route_geometry
  (LineStringField), origin_code, destination_code
- **TripImage:** trip (FK), image (ImageField), thumbnail (ImageField,
  auto-generiert 800px), micro_thumbnail (ImageField, auto-generiert 150px),
  location (PointField, aus EXIF oder manuell), caption, taken_at
- **TripVideo:** trip (FK), video (FileField), location (PointField),
  caption, created_at

Thumbnails werden beim ersten Speichern eines TripImage via Pillow generiert
(`TripImage._generate_thumbnail()`). EXIF-Daten (GPS, DateTimeOriginal) werden
automatisch via `services/exif.py` extrahiert und als `location`/`taken_at`
gespeichert.

## URLs

| Pfad | Beschreibung |
|------|-------------|
| `/` | Home-Seite |
| `/about/` | Social-Media-Links + Discord-Status |
| `/datenschutz/` | Datenschutzerklärung |
| `/set-language/<lang>/` | Sprache setzen (de/en/fi) |
| `/diary/` | Interaktive Karte (öffentlich) |
| `/diary/trip/<id>/` | Reise-Detailseite |
| `/diary/manage/` | Admin-Dashboard (login_required) |
| `/diary/manage/trip/new/` | Neue Reise anlegen |
| `/diary/manage/trip/<id>/edit/` | Reise bearbeiten |
| `/diary/manage/trip/<id>/delete/` | Reise löschen |
| `/diary/manage/resolve-route/` | AJAX: Route aus Wegpunkten berechnen |
| `/diary/manage/resolve-airport/` | AJAX: IATA-Code → Koordinaten |
| `/diary/manage/search-stations/` | AJAX: Ortssuche via Photon |
| `/diary/manage/image/<id>/set-location/` | AJAX: Bild-GPS manuell setzen |
| `/api/diary/routes/` | GeoJSON FeatureCollection der Routen |
| `/api/diary/images/` | GeoJSON FeatureCollection der Bilder |
| `/api/diary/videos/` | GeoJSON FeatureCollection der Videos |
| `/api/diary/trips/` | JSON-Liste aller Trips |
| `/api/diary/stats/` | Aggregierte Statistiken |
| `/api/diary/visited-countries/` | GeoJSON der besuchten Länder |
| `/api/diary/states/` | GeoJSON der Bundesländer |
| `/api/analytics/event/` | Analytics-Event empfangen (POST, CSRF-exempt) |
| `/api/analytics/stats/` | Aggregierte Analytics-Daten (GET, X-API-Key) |
| `/accounts/login/` | Login-Seite |
| `/accounts/logout/` | Logout |
| `/admin/` | Django-Admin |

## API-Filter

- `/api/diary/routes/?year=2024&transport_type=train&trip_id=5`
- `/api/diary/images/?trip_id=5&year=2024`
- `/api/diary/videos/?trip_id=5`

## Routing-Logik (`services/routing.py`)

- **Auto:** OSRM `/route/v1/driving/`
- **Zug:** BRouter public API (Profil `rail`), Wegpunkte werden via Overpass
  API auf nächste Bahnhöfe gesnapped; Fallback auf gerade Linie
- **Flugzeug:** Geodätischer Great-Circle-Bogen (50 Punkte, kein API-Call)
- **Fähre:** Gerade Linie zwischen Wegpunkten (Eingabe per Textsuche oder
  Kartenklick)
- Routen werden beim Speichern aufgelöst und in `route_geometry` gecacht

## Formulareingabe (`trip_form.html`)

- **Typ-Auswahl:** Reise oder Event (Radio-Buttons)
- **Event:** Nur Datum (event_date), keine Journeys
- **Flug:** IATA-Codes für Start/Ziel (z.B. `TXL`, `LIS`)
- **Zug/Auto/Fähre:** Wegpunkte per Textsuche (Photon-API) oder Kartenklick

## EXIF-Extraktion (`services/exif.py`)

- Automatisch beim Erstellen eines TripImage
- Extrahiert GPS-Koordinaten → `location` (PointField)
- Extrahiert DateTimeOriginal → `taken_at`
- Manuelles Setzen möglich via Pin-Button in der Bearbeitungsansicht

## Analytics (`apps/analytics/`)

Anonymes Pageview- und Click-Tracking. Keine IP-Adressen, Cookies oder
Session-IDs werden gespeichert — jede Zeile ist ein eigenständiger Datenpunkt
ohne Verknüpfbarkeit.

- **AnalyticsEvent-Modell:** event_type (pageview/click), path, target,
  referrer_domain, country, city, latitude, longitude, device_type
  (desktop/mobile/tablet/bot), browser, os, language, screen_bucket
- **GeoIP:** Grobe GeoIP-Auflösung via MaxMind GeoLite2-City (wenn vorhanden)
- **User-Agent:** Parsing via `user-agents`-Library
- **Client:** `apps/core/static/core/js/analytics.js` – sendet Events per
  `navigator.sendBeacon()` an `/api/analytics/event/`
- **Stats API:** `/api/analytics/stats/` liefert aggregierte Daten an das
  externe Dashboard; geschützt via `X-API-Key`-Header und
  `ANALYTICS_DASHBOARD_API_KEY`
- **Ausschluss:** Authentifizierte User (Site-Owner), Paths mit
  `/admin`/`/staticfiles`/`/media`/`/api`/`/accounts` werden nicht getrackt
- In der Datenbank: read-only im Django-Admin

## Admin-Zugang

- **Benutzername:** `admin`
- **Passwort:** `admin`
- Vor öffentlichem Deployment ändern!

## Umgebungsvariablen (`.env`)

- `SECRET_KEY` – Django Secret Key
- `DEBUG` – 0 oder 1
- `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`
- `OSRM_API_URL` – Default: `https://router.project-osrm.org`
- `DISCORD_USER_ID` – Discord-User-ID für Lanyard-Status auf `/about/`
- `ALLOWED_HOSTS` – Kommagetrennte Liste
- `ANALYTICS_GEOIP_DB_PATH` – Pfad zur MaxMind GeoLite2-City.mmdb (optional)
- `ANALYTICS_DASHBOARD_API_KEY` – Shared Secret für die externe Stats-API

## Wichtige Hinweise

- Static Files werden via Nginx unter `/staticfiles/` ausgeliefert
- Media Files (Bilder) unter `/media/` — im Docker Named Volume
  `media_volume`, nicht im Git und nicht im Host-Verzeichnis
- `STATIC_ROOT` = `/app/staticfiles` (im Container, Named Volume
  `static_volume`)
- Das Volume `.:/app` mountet den Code live in den Container
- Bei Modelländerungen: `makemigrations` → `migrate` → ggf. Container
  neustarten
- SSL-Zertifikat via Let's Encrypt (certbot), automatische Erneuerung alle 12h
- Production nutzt cached Template Loader (DEBUG=False) → nach
  Template-Änderungen `docker compose restart web`
- Nginx bedient auch `tausendsassa.casparsadenius.de`,
  `nextcloud.casparsadenius.de`, `dashboard.casparsadenius.de` und
  `collabora.casparsadenius.de` (externe Docker-Netzwerke:
  `tausendsassa-network`, `nextcloud_default`, `dashboard-network`)
- Sprache wird per Session (`request.session["lang"]`) gespeichert;
  Cookie-basierte Umschaltung via `/set-language/<lang>/`
