import json
import os

import requests

_airports_cache = None
_stations_cache = None
_geocode_cache = {}

_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")

PHOTON_API_URL = "https://photon.komoot.io/api/"


def _load_airports():
    global _airports_cache
    if _airports_cache is None:
        with open(os.path.join(_DATA_DIR, "airports.json")) as f:
            _airports_cache = json.load(f)
    return _airports_cache


def _load_stations():
    global _stations_cache
    if _stations_cache is None:
        with open(os.path.join(_DATA_DIR, "stations.json")) as f:
            _stations_cache = json.load(f)
    return _stations_cache


def resolve_airport(iata_code):
    """
    Resolve an IATA airport code to coordinates.

    Returns dict with 'name', 'lat', 'lng' or None.
    """
    airports = _load_airports()
    code = iata_code.upper().strip()
    if code in airports:
        ap = airports[code]
        return {"name": ap["name"], "lat": ap["lat"], "lng": ap["lng"]}
    return None


def geocode_place(name):
    """Geocode a place name to coordinates via Photon API.
    Results are cached in-memory per process."""
    name = name.strip()
    if not name:
        return None

    if name in _geocode_cache:
        return _geocode_cache[name]

    try:
        response = requests.get(
            PHOTON_API_URL,
            params={"q": name, "limit": 1, "lang": "de"},
            headers={"User-Agent": "TravelDiary/1.0"},
            timeout=5,
        )
        if response.status_code == 200:
            features = response.json().get("features", [])
            if features:
                coords = features[0]["geometry"]["coordinates"]
                result = {"lat": coords[1], "lng": coords[0]}
                _geocode_cache[name] = result
                return result
    except requests.RequestException:
        pass

    _geocode_cache[name] = None
    return None


def search_stations(query):
    """
    Search places via Photon geocoding API (OpenStreetMap data).
    Falls back to local stations.json if the API is unreachable.

    Returns list of dicts with 'name', 'lat', 'lng'.
    """
    query = query.strip()
    if not query:
        return []

    try:
        response = requests.get(
            PHOTON_API_URL,
            params={"q": query, "limit": 10, "lang": "de"},
            headers={"User-Agent": "TravelDiary/1.0"},
            timeout=5,
        )
        if response.status_code == 200:
            data = response.json()
            results = []
            for feature in data.get("features", []):
                props = feature.get("properties", {})
                geom = feature.get("geometry", {})
                coords = geom.get("coordinates", [])
                if len(coords) < 2:
                    continue
                name = props.get("name", "")
                if not name:
                    continue
                # Build a descriptive label: Name, City, Country
                parts = [name]
                city = props.get("city", "")
                if city and city != name:
                    parts.append(city)
                country = props.get("country", "")
                if country:
                    parts.append(country)
                results.append({
                    "name": ", ".join(parts),
                    "lat": coords[1],
                    "lng": coords[0],
                })
            if results:
                return results
    except requests.RequestException:
        pass

    # Fallback to local stations.json
    return _search_stations_local(query)


def _search_stations_local(query):
    """Fallback: search local stations.json."""
    stations = _load_stations()
    query_lower = query.lower()
    results = []
    for name, coords in stations.items():
        if query_lower in name.lower():
            results.append({"name": name, "lat": coords["lat"], "lng": coords["lng"]})
    return results[:10]
