# spa1teN – Persönliche Website

## Tech-Stack
- **Backend:** Django 5.2, Python 3.13
- **Datenbank:** PostgreSQL 16 + PostGIS 3.4
- **Frontend:** Django Templates, Leaflet.js 1.9.4, Vanilla JS
- **Routing:** OSRM (Auto), BRouter (Zug), Great-Circle (Flug), gerade Linie (Fähre)
- **Deployment:** Docker Compose
- **Reverse Proxy:** Nginx 1.27
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
│   ├── core/                   # Home-Seite, base.html, Navigation, Login
│   ├── links/                  # Social-Media-Links + Discord-Status
│   └── diary/                  # Reisetagebuch (Kernfeature)
│       ├── models.py           # Trip, Journey, JourneySegment, TripImage
│       ├── views.py            # Kartenansicht + Admin-CRUD
│       ├── api_views.py        # GeoJSON REST API
│       ├── api_urls.py         # /api/diary/{routes,images,trips}/
│       ├── serializers.py      # DRF-GIS GeoJSON Serializer
│       ├── forms.py            # TripForm
│       ├── services/
│       │   ├── exif.py         # EXIF GPS-Extraktion (Pillow)
│       │   ├── routing.py      # Routing-Logik (OSRM/BRouter/Great-Circle)
│       │   └── geocoding.py    # IATA-Auflösung + Photon-Stationssuche
│       ├── data/airports.json  # ~65 Flughäfen (IATA → Koordinaten)
│       ├── data/stations.json  # Bahnhöfe-Cache
│       └── static/diary/js/
│           └── map.js          # Leaflet-Karte, Filter, Lightbox
├── nginx/                      # Nginx Dockerfile + Config
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
├── init-letsencrypt.sh         # Einmaliges SSL-Bootstrap-Skript
└── .env                        # Secrets, DB-Config, OSRM-URL, Discord-ID
```

## Docker
### Lokal (docker-compose v1)
- **Befehl:** `docker-compose` (v1-Syntax)
- **Starten:** `docker-compose up -d`
- **Stoppen:** `docker-compose down`
- **Rebuild:** `docker-compose build && docker-compose up -d`
- **Logs:** `docker-compose logs -f web`
- **DB-Port:** Extern 5433 → Intern 5432 (Port 5432 auf Host belegt)
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

## Deployment-Workflow
```bash
# Lokal ändern, committen, pushen:
git add . && git commit -m "..." && git push

# Auf Server deployen:
ssh root@87.106.242.207 "cd ~/website && git pull && docker compose restart web"

# Als Einzeiler:
git push && ssh root@87.106.242.207 "cd ~/website && git pull && docker compose restart web"
```
- `.env` und `media/` sind in `.gitignore` — werden nie gepusht, bleiben auf dem Server

## Datenmodelle (apps/diary/models.py)
- **Trip:** title, description, outbound_journey (FK→Journey), return_journey (FK→Journey)
- **Journey:** travel_date
- **JourneySegment:** journey (FK), order, transport_type (train/car/plane/ferry), waypoints (JSONField), route_geometry (LineStringField), origin_code, destination_code
- **TripImage:** trip (FK), image (ImageField), location (PointField, aus EXIF oder manuell), caption, taken_at

## URLs
| Pfad | Beschreibung |
|------|-------------|
| `/` | Home-Seite |
| `/links/` | Social-Media-Links + Discord-Status |
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
| `/api/diary/trips/` | JSON-Liste aller Trips |
| `/accounts/login/` | Login-Seite |
| `/admin/` | Django-Admin |

## API-Filter
- `/api/diary/routes/?year=2024&transport_type=train&trip_id=5`
- `/api/diary/images/?trip_id=5&year=2024`

## Routing-Logik (services/routing.py)
- **Auto:** OSRM `/route/v1/driving/`
- **Zug:** BRouter public API (Profil `rail`), Wegpunkte werden via Overpass API auf nächste Bahnhöfe gesnapped; Fallback auf gerade Linie
- **Flugzeug:** Geodätischer Great-Circle-Bogen (50 Punkte, kein API-Call)
- **Fähre:** Gerade Linie zwischen Wegpunkten (Eingabe per Textsuche oder Kartenklick)
- Routen werden beim Speichern aufgelöst und in `route_geometry` gecacht

## Formulareingabe (trip_form.html)
- **Flug:** IATA-Codes für Start/Ziel (z.B. `TXL`, `LIS`)
- **Zug/Auto/Fähre:** Wegpunkte per Textsuche (Photon-API) oder Kartenklick

## EXIF-Extraktion (services/exif.py)
- Automatisch beim Erstellen eines TripImage
- Extrahiert GPS-Koordinaten → `location` (PointField)
- Extrahiert DateTimeOriginal → `taken_at`
- Manuelles Setzen möglich via Pin-Button in der Bearbeitungsansicht

## Admin-Zugang
- **Benutzername:** `admin`
- **Passwort:** `admin`
- Vor öffentlichem Deployment ändern!

## Umgebungsvariablen (.env)
- `SECRET_KEY` – Django Secret Key
- `DEBUG` – 0 oder 1
- `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`
- `OSRM_API_URL` – Default: `https://router.project-osrm.org`
- `DISCORD_USER_ID` – `485051896655249419`
- `ALLOWED_HOSTS` – Kommagetrennte Liste

## Wichtige Hinweise
- Static Files werden via Nginx unter `/staticfiles/` ausgeliefert
- Media Files (Bilder) unter `/media/` — im Docker-Volume, nicht im Git
- `STATIC_ROOT` = `/app/staticfiles` (im Container)
- Das Volume `.:/app` mountet den Code live in den Container
- Bei Modelländerungen: `makemigrations` → `migrate` → ggf. Container neustarten
- SSL-Zertifikat via Let's Encrypt (certbot), automatische Erneuerung alle 12h
