import ipaddress

from django.conf import settings

_reader = None
_reader_load_attempted = False


def _get_reader():
    """Lazily open the MaxMind GeoLite2-City database, if one is configured.

    Returns None (and stays None) if no db path is set or the file can't be
    opened - callers must degrade gracefully, geolocation is a best-effort
    enrichment, not a hard requirement.
    """
    global _reader, _reader_load_attempted
    if _reader is not None or _reader_load_attempted:
        return _reader
    _reader_load_attempted = True

    db_path = getattr(settings, "ANALYTICS_GEOIP_DB_PATH", None)
    if not db_path:
        return None
    try:
        import geoip2.database
        _reader = geoip2.database.Reader(db_path)
    except Exception:
        _reader = None
    return _reader


def resolve_geo(ip):
    """Resolve (country_iso, city, latitude, longitude) for an IP address.

    The IP is used only for this in-memory lookup and is never written to the
    database or any log file by this function or its callers.
    """
    if not ip:
        return "", "", None, None
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return "", "", None, None
    if addr.is_private or addr.is_loopback:
        return "", "", None, None

    reader = _get_reader()
    if reader is None:
        return "", "", None, None
    try:
        result = reader.city(ip)
    except Exception:
        return "", "", None, None

    country = result.country.iso_code or ""
    city = result.city.name or ""
    latitude = result.location.latitude
    longitude = result.location.longitude
    return country, city, latitude, longitude
