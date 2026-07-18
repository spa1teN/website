---
name: run-website
description: Run, smoke-test, screenshot, and deploy the casparsadenius.de website (Django + PostGIS). Use when asked to run, start, test, verify, restart, or screenshot the website, diary map, or its APIs.
---

# Run: Website (casparsadenius.de)

Django 5.2 + PostGIS travel-diary site. **The `web` and `db` containers are
managed by the dashboard stack** (`/root/dashboard/docker-compose.yml`);
`~/website/docker-compose.yml` only runs nginx + certbot. Code is live-mounted
into the container (`/root/website:/app`) — no image rebuild for code changes.
Paths below are relative to `/root/website/`.

## Smoke test (agent path — run this first)

```bash
.claude/skills/run-website/smoke.sh            # full run incl. screenshots (~45 s)
SKIP_UI=1 .claude/skills/run-website/smoke.sh  # containers + HTTP + ORM only (~10 s)
```

Checks containers, public HTTPS endpoints (`/`, `/diary/`, diary APIs),
`manage.py check`, a read-only ORM query, and renders `/diary/` headless
(screenshot → `/tmp/shots/website-diary.png`, blank-detection, MapLibre
`<canvas>` present in DOM — WebGL works via SwiftShader in `zenika/alpine-chrome`).

## Direct invocation (most backend changes need only this)

```bash
docker exec website-web python manage.py shell -c \
  "from apps.diary.models import Trip; print(Trip.objects.count())"
docker exec website-web python manage.py check
```

The container runs the live working tree, so an edited module is importable
immediately — but **running Gunicorn workers keep old code until restarted**
(see Deploy). `manage.py shell` starts a fresh process, so it always sees your
edit.

## Deploy a code change

Documented path (from CLAUDE.md + compose ownership; restart not re-run in the
authoring session — it briefly interrupts the live site):

```bash
cd /root/dashboard && docker compose restart web     # note: dashboard dir, not ~/website
```

- Needed for: any `.py` change (Gunicorn), any template change (cached loader
  in production).
- Migrations + `collectstatic` run automatically on container start (compose
  `command`).
- What IS verified from the authoring session: recreating `web` via the
  dashboard stack brings the site back healthy (HTTP 200) within seconds.

## Gotchas

- **`cd ~/website && docker compose restart web` does not work** — `web` is not
  in that compose file (its own CLAUDE.md deployment section predates the move
  to the dashboard stack). Use `/root/dashboard`.
- A plain `docker compose up -d --build` in `/root/dashboard` rebuilds the
  website image and recreates the live `web` container whenever
  `/root/website` changed. Scope compose commands to one service.
- Media files live in the named volume `website_media_volume`, not in
  `~/website/media/`.
- `/tmp/shots` must be `chmod 777` (Chrome runs as uid 1000).
- `/admin/`, `/diary/manage/` are nginx basic-auth'd — smoke only covers public
  routes; management UI testing needs the user's browser.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Public URLs 502 | `docker logs website-web --tail 50` — Gunicorn may still be starting after a restart |
| ORM query prints nothing | Run without `tail -1` to see the traceback; check `DJANGO_SETTINGS_MODULE=config.settings.production` |
| Diary screenshot blank | Raise `--virtual-time-budget` (map tiles + GeoJSON take a few seconds) |
