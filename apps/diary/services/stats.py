import json
import math
import os

from django.core.cache import cache

_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
_EARTH_RADIUS_KM = 6371.0088

_countries_cache = None
_country_lookup_cache = {}

TRANSPORT_ORDER = ["train", "car", "plane", "ferry"]
TRANSPORT_COLORS = {
    "train": "#1565C0",
    "car": "#9c27b0",
    "plane": "#D32F2F",
    "ferry": "#2E7D32",
}
TRANSPORT_LABELS = {
    "de": {"train": "Zug", "car": "Auto", "plane": "Flugzeug", "ferry": "Fähre"},
    "en": {"train": "Train", "car": "Car / Bus", "plane": "Plane", "ferry": "Ferry"},
}

# Natural Earth leaves iso_a2 as "-99" for a handful of well-known countries
# (disputed/administrative quirks). Patch the ones we're likely to actually visit.
_ISO_A2_OVERRIDES = {
    "France": "FR",
    "Norway": "NO",
    "Kosovo": "XK",
}


def _load_countries():
    global _countries_cache
    if _countries_cache is None:
        from django.contrib.gis.geos import GEOSGeometry

        with open(os.path.join(_DATA_DIR, "countries.geojson")) as f:
            data = json.load(f)
        countries = []
        for feature in data["features"]:
            geom = GEOSGeometry(json.dumps(feature["geometry"]))
            props = feature["properties"]
            iso = props.get("iso_a2")
            if not iso or len(iso) != 2:
                iso = _ISO_A2_OVERRIDES.get(props.get("name"))
            props["iso_a2"] = iso
            countries.append((geom, props))
        _countries_cache = countries
    return _countries_cache


def resolve_country(lat, lng):
    """Offline point-in-polygon country lookup (Natural Earth 10m, simplified).
    Returns dict with 'name' (EN) and 'name_de', or None if no match nearby."""
    key = (round(lat, 3), round(lng, 3))
    if key in _country_lookup_cache:
        return _country_lookup_cache[key]

    from django.contrib.gis.geos import Point

    point = Point(lng, lat)
    countries = _load_countries()

    result = None
    nearest_props = None
    nearest_dist = None
    for geom, props in countries:
        if geom.intersects(point):
            result = props
            break
        d = geom.distance(point)
        if nearest_dist is None or d < nearest_dist:
            nearest_dist = d
            nearest_props = props

    if result is None and nearest_dist is not None and nearest_dist < 0.5:
        result = nearest_props

    value = (
        {"name": result["name"], "name_de": result["name_de"], "iso_a2": result.get("iso_a2")}
        if result
        else None
    )
    _country_lookup_cache[key] = value
    return value


def resolve_trip_destination_country(trip):
    """Destination country for a trip, resolved from the last waypoint of the
    last outbound segment (the trip's actual destination)."""
    if not trip.outbound_journey:
        return None
    segments = list(trip.outbound_journey.segments.all())
    if not segments:
        return None
    last_seg = segments[-1]
    if not last_seg.waypoints:
        return None
    wp = last_seg.waypoints[-1]
    lat, lng = wp.get("lat"), wp.get("lng")
    if not lat or not lng:
        return None
    return resolve_country(lat, lng)


def _collect_geo_points(trip_ids=None):
    """Yields (trip_id, lat, lng) for every meaningful geo point across all trips:
    photo locations, video locations, and journey waypoints (the named stops
    entered when creating the trip). Route geometry is intentionally NOT sampled -
    merely passing through a country/region between waypoints doesn't count as
    "visited".
    If trip_ids is given, only points belonging to those trips are yielded."""
    from ..models import JourneySegment, TripImage, TripVideo

    images = TripImage.objects.exclude(location__isnull=True).only("trip_id", "location")
    if trip_ids is not None:
        images = images.filter(trip_id__in=trip_ids)
    for img in images:
        yield img.trip_id, img.location.y, img.location.x

    videos = TripVideo.objects.exclude(location__isnull=True).only("trip_id", "location")
    if trip_ids is not None:
        videos = videos.filter(trip_id__in=trip_ids)
    for vid in videos:
        yield vid.trip_id, vid.location.y, vid.location.x

    segments = JourneySegment.objects.select_related("journey").prefetch_related(
        "journey__outbound_for_trips", "journey__return_for_trips"
    )
    for seg in segments:
        seg_trip_ids = {t.id for t in seg.journey.outbound_for_trips.all()}
        seg_trip_ids.update(t.id for t in seg.journey.return_for_trips.all())
        if trip_ids is not None:
            seg_trip_ids &= trip_ids
        if not seg_trip_ids:
            continue

        points = []
        for wp in seg.waypoints:
            if wp.get("lat") and wp.get("lng"):
                points.append((wp["lat"], wp["lng"]))

        for trip_id in seg_trip_ids:
            for lat, lng in points:
                yield trip_id, lat, lng


def _matching_trip_ids(years=None, transports=None, types=None, countries=None):
    """Trip ids matching the given filters (same semantics as the frontend's own
    filter logic: trips without transport data always pass the transport
    filter). Returns None if no filter is active."""
    if not years and not transports and not types and not countries:
        return None

    from ..models import Trip

    ids = set()
    trips = Trip.objects.prefetch_related(
        "outbound_journey__segments", "return_journey__segments"
    )
    for t in trips:
        if years:
            y = t.year
            if y is None or str(y) not in years:
                continue
        if types:
            type_ = "event" if t.is_event else "journey"
            if type_ not in types:
                continue
        if transports:
            trip_transport_types = t.transport_types
            if not trip_transport_types or not (trip_transport_types & transports):
                continue
        if countries:
            country = resolve_trip_destination_country(t)
            if not country or not ({country["name"], country["name_de"]} & countries):
                continue
        ids.add(t.id)
    return ids


def _build_geo_index(trip_ids=None):
    trip_countries = {}
    all_countries = {}
    for trip_id, lat, lng in _collect_geo_points(trip_ids=trip_ids):
        country = resolve_country(lat, lng)
        if not country:
            continue
        key = (country["name"], country["name_de"], country["iso_a2"])
        trip_countries.setdefault(trip_id, set()).add(key)
        all_countries[key] = True

    # Also include destination countries (resolved from journey waypoints),
    # so countries are counted even without photos/videos/stops resolving there.
    from ..models import Trip

    trips = Trip.objects.all()
    if trip_ids is not None:
        trips = trips.filter(id__in=trip_ids)
    for t in trips:
        country = resolve_trip_destination_country(t)
        if country:
            key = (country["name"], country["name_de"], country["iso_a2"])
            all_countries[key] = True
            trip_countries.setdefault(t.id, set()).add(key)

    return {
        "trip_countries": {tid: sorted(v) for tid, v in trip_countries.items()},
        "all_countries": sorted(all_countries.keys()),
    }


def compute_geo_index():
    """Cached: which countries (name, name_de, iso_a2) each trip touched, and the
    overall set of visited countries, derived from photos, videos, and waypoints
    (actual stops, not merely transited)."""
    cache_key = "diary_geo_index"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    result = _build_geo_index()
    cache.set(cache_key, result, timeout=3600)
    return result


_states_cache = None
_states_by_country_cache = None
_state_lookup_cache = {}


def _load_states():
    global _states_cache
    if _states_cache is None:
        from django.contrib.gis.geos import GEOSGeometry

        with open(os.path.join(_DATA_DIR, "states.geojson")) as f:
            data = json.load(f)
        states = []
        for feature in data["features"]:
            geom = GEOSGeometry(json.dumps(feature["geometry"]))
            states.append((geom, feature["properties"]))
        _states_cache = states
    return _states_cache


def _states_by_country():
    global _states_by_country_cache
    if _states_by_country_cache is None:
        grouped = {}
        for geom, props in _load_states():
            iso = props.get("iso_a2")
            grouped.setdefault(iso, []).append((geom, props))
        _states_by_country_cache = grouped
    return _states_by_country_cache


def resolve_state(lat, lng, country_iso_a2):
    """Offline point-in-polygon admin-1 (state/province) lookup, scoped to the
    given country for speed. Returns dict with 'name' (local/EN) and 'name_de',
    or None if no match nearby."""
    if not country_iso_a2:
        return None
    key = (round(lat, 3), round(lng, 3), country_iso_a2)
    if key in _state_lookup_cache:
        return _state_lookup_cache[key]

    from django.contrib.gis.geos import Point

    point = Point(lng, lat)
    candidates = _states_by_country().get(country_iso_a2, [])

    result = None
    nearest_props = None
    nearest_dist = None
    for geom, props in candidates:
        if geom.intersects(point):
            result = props
            break
        d = geom.distance(point)
        if nearest_dist is None or d < nearest_dist:
            nearest_dist = d
            nearest_props = props

    if result is None and nearest_dist is not None and nearest_dist < 0.3:
        result = nearest_props

    value = {"name": result["name"], "name_de": result["name_de"]} if result else None
    _state_lookup_cache[key] = value
    return value


def _build_state_index(trip_ids=None):
    """Which states/provinces (keyed by country iso_a2 + name) were actually
    visited, derived from the same points as the country index (no route
    sampling - only real stops count)."""
    visited = {}
    for trip_id, lat, lng in _collect_geo_points(trip_ids=trip_ids):
        country = resolve_country(lat, lng)
        if not country or not country.get("iso_a2"):
            continue
        state = resolve_state(lat, lng, country["iso_a2"])
        if not state:
            continue
        visited[(country["iso_a2"], state["name"])] = True
    return visited


def compute_state_index():
    cache_key = "diary_state_index"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    result = _build_state_index()
    cache.set(cache_key, result, timeout=3600)
    return result


def compute_states_geojson(lang, country_iso_a2, years=None, transports=None):
    """All states/provinces of the given country, each flagged whether visited."""
    if not country_iso_a2:
        return {"type": "FeatureCollection", "features": []}

    if not years and not transports:
        visited = compute_state_index()
    else:
        trip_ids = _matching_trip_ids(years=years, transports=transports)
        visited = _build_state_index(trip_ids=trip_ids)

    features = []
    for geom, props in _states_by_country().get(country_iso_a2, []):
        features.append({
            "type": "Feature",
            "properties": {
                "name": props["name_de"] if lang == "de" else props["name"],
                "visited": (country_iso_a2, props["name"]) in visited,
            },
            "geometry": json.loads(geom.geojson),
        })

    return {"type": "FeatureCollection", "features": features}


def compute_all_states_geojson(lang, years=None, transports=None):
    """States/provinces of every visited country in one FeatureCollection, each
    flagged whether visited - used for the global 'show subdivisions' toggle."""
    if not years and not transports:
        country_index = compute_geo_index()
        state_index = compute_state_index()
    else:
        trip_ids = _matching_trip_ids(years=years, transports=transports)
        country_index = _build_geo_index(trip_ids=trip_ids)
        state_index = _build_state_index(trip_ids=trip_ids)

    country_isos = {iso for name, name_de, iso in country_index["all_countries"] if iso}

    features = []
    for iso in country_isos:
        for geom, props in _states_by_country().get(iso, []):
            features.append({
                "type": "Feature",
                "properties": {
                    "name": props["name_de"] if lang == "de" else props["name"],
                    "visited": (iso, props["name"]) in state_index,
                },
                "geometry": json.loads(geom.geojson),
            })

    return {"type": "FeatureCollection", "features": features}


def compute_visited_countries_geojson(lang, years=None, transports=None, types=None, countries=None):
    if not years and not transports and not types and not countries:
        geo_index = compute_geo_index()
    else:
        trip_ids = _matching_trip_ids(years=years, transports=transports, types=types, countries=countries)
        geo_index = _build_geo_index(trip_ids=trip_ids)
    visited_names = {name for name, name_de, iso_a2 in geo_index["all_countries"]}

    features = []
    for geom, props in _load_countries():
        if props["name"] not in visited_names:
            continue
        features.append({
            "type": "Feature",
            "properties": {
                "name": props["name_de"] if lang == "de" else props["name"],
                "iso_a2": props.get("iso_a2"),
            },
            "geometry": json.loads(geom.geojson),
        })

    return {"type": "FeatureCollection", "features": features}


def _haversine_km(lat1, lon1, lat2, lon2):
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def _segment_length_km(route_geometry):
    coords = list(route_geometry.coords)
    total = 0.0
    for i in range(len(coords) - 1):
        lon1, lat1 = coords[i][0], coords[i][1]
        lon2, lat2 = coords[i + 1][0], coords[i + 1][1]
        total += _haversine_km(lat1, lon1, lat2, lon2)
    return total


def compute_images_by_country(lang, trip_ids=None):
    from ..models import TripImage

    counts = {}
    meta = {}
    unresolved = 0
    images = TripImage.objects.exclude(location__isnull=True)
    if trip_ids is not None:
        images = images.filter(trip_id__in=trip_ids)
    for img in images:
        country = resolve_country(img.location.y, img.location.x)
        if country:
            key = country["name"]
            counts[key] = counts.get(key, 0) + 1
            meta[key] = country
        else:
            unresolved += 1

    result = []
    for key, count in counts.items():
        country = meta[key]
        result.append({
            "country": country["name_de"] if lang == "de" else country["name"],
            "iso_a2": country.get("iso_a2"),
            "count": count,
        })
    result.sort(key=lambda x: -x["count"])

    if unresolved:
        labels = {"de": "Unbekannt", "en": "Unknown", "fi": "Tuntematon"}
        result.append({"country": labels.get(lang, "Unknown"), "iso_a2": None, "count": unresolved})

    return result, len(counts)


def compute_distance_by_transport(lang, trip_ids=None):
    from ..models import JourneySegment

    totals = {t: 0.0 for t in TRANSPORT_ORDER}
    segments = JourneySegment.objects.exclude(route_geometry__isnull=True)
    if trip_ids is not None:
        segments = segments.select_related("journey").prefetch_related(
            "journey__outbound_for_trips", "journey__return_for_trips"
        )
    for seg in segments:
        if seg.transport_type not in totals:
            continue
        if trip_ids is not None:
            seg_trip_ids = {t.id for t in seg.journey.outbound_for_trips.all()}
            seg_trip_ids.update(t.id for t in seg.journey.return_for_trips.all())
            if not (seg_trip_ids & trip_ids):
                continue
        totals[seg.transport_type] += _segment_length_km(seg.route_geometry)

    labels = TRANSPORT_LABELS.get(lang, TRANSPORT_LABELS["de"])
    result = []
    for t in TRANSPORT_ORDER:
        result.append({
            "type": t,
            "label": labels[t],
            "km": round(totals[t]),
            "color": TRANSPORT_COLORS[t],
        })
    result.sort(key=lambda x: -x["km"])
    return result, sum(totals.values())


def compute_stats(lang, years=None, transports=None, types=None, countries=None):
    filtered = bool(years or transports or types or countries)
    cache_key = f"diary_stats_{lang}"
    if not filtered:
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

    from ..models import Trip, TripImage

    trip_ids = (
        _matching_trip_ids(years=years, transports=transports, types=types, countries=countries)
        if filtered
        else None
    )

    images_by_country, _ = compute_images_by_country(lang, trip_ids=trip_ids)
    distance_by_transport, total_distance_km = compute_distance_by_transport(lang, trip_ids=trip_ids)
    geo_index = _build_geo_index(trip_ids=trip_ids) if filtered else compute_geo_index()

    trips_qs = Trip.objects.filter(is_event=False)
    images_qs = TripImage.objects.all()
    if trip_ids is not None:
        trips_qs = trips_qs.filter(id__in=trip_ids)
        images_qs = images_qs.filter(trip_id__in=trip_ids)

    summary = {
        "total_distance_km": round(total_distance_km),
        "countries_visited": len(geo_index["all_countries"]),
        "total_trips": trips_qs.count(),
        "total_photos": images_qs.count(),
    }

    data = {
        "images_by_country": images_by_country,
        "distance_by_transport": distance_by_transport,
        "summary": summary,
    }
    if not filtered:
        cache.set(cache_key, data, timeout=3600)
    return data
