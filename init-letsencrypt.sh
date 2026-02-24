#!/bin/bash
# Erstes SSL-Zertifikat von Let's Encrypt holen.
# Einmalig auf dem Server ausführen, BEVOR docker-compose up -d.
#
# Voraussetzungen:
#   - Domain bereits auf Server-IP gezeigt (DNS propagiert)
#   - DOMAIN und EMAIL unten angepasst
#   - Docker und docker-compose installiert

set -e

DOMAIN="DEINE-DOMAIN.de"
EMAIL="DEINE-EMAIL@beispiel.de"
STAGING=0  # Zum Testen auf 1 setzen (kein Rate-Limit), für Produktion: 0

# Pfade
CERT_PATH="/etc/letsencrypt/live/$DOMAIN"
DATA_PATH="./certbot_data"  # temporär, wird in Docker-Volume geschrieben

echo "### Erstelle temporäres Dummy-Zertifikat für $DOMAIN ..."
docker-compose run --rm --entrypoint "\
  openssl req -x509 -nodes -newkey rsa:4096 -days 1 \
    -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
    -out /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
    -subj '/CN=localhost'" certbot

echo "### Lade TLS-Parameter (DH params + options) ..."
docker-compose run --rm --entrypoint "\
  sh -c 'curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf \
    > /etc/letsencrypt/options-ssl-nginx.conf && \
  openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048'" certbot

echo "### Starte nginx mit Dummy-Zertifikat ..."
docker-compose up -d nginx

echo "### Warte kurz auf nginx ..."
sleep 3

echo "### Hole echtes Let's Encrypt Zertifikat ..."
STAGING_ARG=""
if [ "$STAGING" = "1" ]; then
  STAGING_ARG="--staging"
fi

docker-compose run --rm --entrypoint "\
  certbot certonly --webroot \
    --webroot-path=/var/www/certbot \
    $STAGING_ARG \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email \
    -d $DOMAIN \
    -d www.$DOMAIN" certbot

echo "### Lade nginx mit echtem Zertifikat neu ..."
docker-compose exec nginx nginx -s reload

echo ""
echo "Fertig! Die Website läuft jetzt unter https://$DOMAIN"
echo "Alle 12h prüft der certbot-Container automatisch auf Erneuerung."
