#!/bin/bash
# authelia-user — User in Authelia (users.yml) anlegen/Passwort setzen.
#
# Nutzung:
#   authelia-user add <benutzername>          # Passwort wird interaktiv abgefragt
#   authelia-user add <benutzername> <pw>     # Passwort direkt angeben
#   authelia-user del <benutzername>
#   authelia-user list
#
# Passwörter werden als Argon2id-Hash gespeichert (empfohlener Authelia-Algorithmus).
# Nach Änderungen den Authelia-Container neu starten: docker compose restart authelia

set -euo pipefail

CONFIG_DIR="${AUTHELIA_CONFIG_DIR:-/root/website/authelia/config}"
USERS_FILE="$CONFIG_DIR/users.yml"
EMAIL_DOMAIN="${AUTHELIA_EMAIL_DOMAIN:-sadenius.eu}"
IMAGE="authelia/authelia:4.39"

usage() {
    sed -n '2,9p' "$0"
    exit 1
}

cmd_add() {
    local user="${1:-}"
    [ -z "$user" ] && usage
    local pw="${2:-}"
    if [ -z "$pw" ]; then
        read -rsp "Passwort für $user: " pw; echo
    fi
    [ ${#pw} -lt 8 ] && { echo "FEHLER: Passwort muss min. 8 Zeichen haben" >&2; exit 1; }

    local hash
    hash=$(docker run --rm "$IMAGE" authelia crypto hash generate argon2 --password "$pw" 2>/dev/null | grep -oE 'Digest: \$argon2id.*$' | sed 's/^Digest: //')
    [ -z "$hash" ] && { echo "FEHLER: Hash konnte nicht erzeugt werden" >&2; exit 1; }

    if grep -qE "^  ${user}:" "$USERS_FILE"; then
        # Bestehenden User: nur Passwort ersetzen
        python3 - "$USERS_FILE" "$user" "$hash" <<'PYEOF'
import sys
path, user, hash = sys.argv[1:]
lines = open(path).read().splitlines()
out, in_user = [], False
for ln in lines:
    if ln.startswith("  " + user + ":"):
        in_user = True
        out.append(ln)
        out.append(f"    password: \"{hash}\"")
    elif in_user:
        if ln.startswith("  ") and not ln.startswith("    "):
            in_user = False
            out.append(ln)
        elif ln.strip().startswith("password:"):
            continue  # überspringen, neu kommt oben
        else:
            out.append(ln)
    else:
        out.append(ln)
open(path, "w").write("\n".join(out) + "\n")
PYEOF
        echo "Passwort von '$user' aktualisiert"
    else
        cat >> "$USERS_FILE" <<EOF
  $user:
    displayname: "$user"
    password: "$hash"
    email: $user@$EMAIL_DOMAIN
    groups: []
EOF
        echo "User '$user' angelegt (Email: $user@$EMAIL_DOMAIN)"
    fi
    echo "→ Container neu starten: cd /root/website && docker compose restart authelia"
}

cmd_del() {
    local user="${1:-}"
    [ -z "$user" ] && usage
    python3 - "$USERS_FILE" "$user" <<'PYEOF'
import sys
path, user = sys.argv[1:]
lines = open(path).read().splitlines()
out, skip = [], False
for ln in lines:
    if ln.startswith("  " + user + ":"):
        skip = True
        continue
    if skip:
        if ln.startswith("  ") and not ln.startswith("    "):
            skip = False
        else:
            continue
    out.append(ln)
open(path, "w").write("\n".join(out) + "\n")
PYEOF
    echo "User '$user' entfernt → docker compose restart authelia"
}

cmd_list() {
    grep -E '^  [a-z0-9_-]+:' "$USERS_FILE" | sed 's/://;s/^  //'
}

case "${1:-}" in
    add) cmd_add "${2:-}" "${3:-}" ;;
    del) cmd_del "${2:-}" ;;
    list) cmd_list ;;
    *) usage ;;
esac