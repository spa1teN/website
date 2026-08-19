#!/bin/bash
# Read-only smoke test for casparsadenius.de (Django 5.2 + PostGIS).
#
# IMPORTANT: the web+db containers belong to the DASHBOARD stack
# (/root/dashboard/docker-compose.yml) — ~/website's own compose file only
# runs nginx + certbot. Nothing is restarted here; safe to run anytime.
#
#   .claude/skills/run-website/smoke.sh            # full run (~45 s)
#   SKIP_UI=1 .claude/skills/run-website/smoke.sh  # no screenshots (~10 s)
#
# Screenshots land in /tmp/shots/.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
FAIL=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAIL=1; }

# 1. containers (web/db live in the dashboard stack; nginx in the website stack)
for c in website-web website-db website-nginx-1; do
  [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ] \
    && pass "container $c running" || fail "container $c running"
done

# 2. public HTTPS endpoints through nginx
for url in "https://casparsadenius.de/" \
           "https://casparsadenius.de/trips/" \
           "https://casparsadenius.de/links/" \
           "https://casparsadenius.de/about/" \
           "https://casparsadenius.de/api/diary/stats/" \
           "https://casparsadenius.de/api/diary/trips/"; do
  curl -sf -m 15 -o /dev/null "$url" && pass "GET $url" || fail "GET $url"
done

# 2b. legacy URLs must 301 to the new locations (no -L: we want the redirect itself)
# (/about/ itself is the CV page since 2026-08, only nested paths redirect)
for old in "/diary/" "/diary/trip/1/" "/about/foo/"; do
  case "$old" in
    /diary*) want="/trips${old#/diary}" ;;
    /about*) want="/links${old#/about}" ;;
  esac
  got=$(curl -s -o /dev/null -m 15 -w '%{http_code} %{redirect_url}' "https://casparsadenius.de$old")
  case "$got" in
    "301 https://casparsadenius.de$want") pass "redirect $old -> $want" ;;
    *)                                    fail "redirect $old -> $want (got: $got)" ;;
  esac
done

# 3. Django system check (inside the live container)
docker exec website-web python manage.py check >/dev/null 2>&1 \
  && pass "manage.py check" || fail "manage.py check"

# 4. direct ORM invocation — the layer most backend changes should be tested at
TRIPS=$(docker exec website-web python manage.py shell -c \
  "from apps.diary.models import Trip; print(Trip.objects.count())" 2>/dev/null | tail -1)
case "$TRIPS" in
  ''|*[!0-9]*) fail "ORM query (got: '$TRIPS')" ;;
  *)           pass "ORM query: $TRIPS trips" ;;
esac

# 5. UI render check: trips map page (MapLibre GL)
if [ "${SKIP_UI:-0}" != 1 ]; then
  mkdir -p /tmp/shots && chmod 777 /tmp/shots   # chrome runs as uid 1000
  docker run --rm -v /tmp/shots:/out zenika/alpine-chrome \
    --no-sandbox --headless --disable-gpu --hide-scrollbars \
    --window-size=1600,1000 --virtual-time-budget=15000 \
    --screenshot=/out/website-diary.png https://casparsadenius.de/trips/ >/dev/null 2>&1
  python3 "$HERE/verify_png.py" /tmp/shots/website-diary.png \
    && pass "trips screenshot non-blank -> /tmp/shots/website-diary.png" \
    || fail "trips screenshot non-blank"

  N=$(docker run --rm zenika/alpine-chrome --no-sandbox --headless --disable-gpu \
      --virtual-time-budget=15000 --dump-dom https://casparsadenius.de/trips/ 2>/dev/null \
      | grep -c "<canvas")
  [ "${N:-0}" -ge 1 ] && pass "MapLibre canvas present in DOM" \
                      || fail "MapLibre canvas present in DOM"
fi

if [ "$FAIL" = 0 ]; then echo "ALL CHECKS PASSED"; else echo "SOME CHECKS FAILED"; fi
exit "$FAIL"
