import math

import requests
from django.conf import settings
from django.contrib.gis.geos import LineString


def resolve_route(waypoints, transport_type):
    """
    Resolve a route geometry from waypoints.

    Args:
        waypoints: list of dicts with 'lat' and 'lng' keys
        transport_type: one of 'car', 'train', 'plane', 'ferry'

    Returns:
        LineString geometry or None
    """
    if len(waypoints) < 2:
        return None

    if transport_type == "plane":
        return _great_circle_arc(waypoints[0], waypoints[-1])
    elif transport_type == "ferry":
        return _straight_line(waypoints)
    elif transport_type == "train":
        result = _brouter_rail(waypoints)
        return result if result else _straight_line(waypoints)
    else:
        return _osrm_route(waypoints)


def _osrm_route(waypoints):
    """Get route from OSRM (works for car and train approximation)."""
    coords_str = ";".join(
        f"{wp['lng']},{wp['lat']}" for wp in waypoints
    )
    url = f"{settings.OSRM_API_URL}/route/v1/driving/{coords_str}"
    params = {"geometries": "geojson", "overview": "full"}

    try:
        response = requests.get(
            url,
            params=params,
            headers={"User-Agent": "TravelDiary/1.0"},
            timeout=10,
        )
        if response.status_code == 200:
            data = response.json()
            if data.get("code") == "Ok" and data.get("routes"):
                coords = data["routes"][0]["geometry"]["coordinates"]
                return LineString(coords, srid=4326)
    except requests.RequestException:
        pass

    return None


def _great_circle_arc(origin, destination, num_points=50):
    """Generate a geodesic great-circle arc between two points."""
    lat1 = math.radians(origin["lat"])
    lng1 = math.radians(origin["lng"])
    lat2 = math.radians(destination["lat"])
    lng2 = math.radians(destination["lng"])

    d = math.acos(
        math.sin(lat1) * math.sin(lat2)
        + math.cos(lat1) * math.cos(lat2) * math.cos(lng2 - lng1)
    )

    if d < 1e-10:
        return None

    points = []
    for i in range(num_points + 1):
        f = i / num_points
        a = math.sin((1 - f) * d) / math.sin(d)
        b = math.sin(f * d) / math.sin(d)
        x = a * math.cos(lat1) * math.cos(lng1) + b * math.cos(lat2) * math.cos(lng2)
        y = a * math.cos(lat1) * math.sin(lng1) + b * math.cos(lat2) * math.sin(lng2)
        z = a * math.sin(lat1) + b * math.sin(lat2)
        lat = math.degrees(math.atan2(z, math.sqrt(x * x + y * y)))
        lng = math.degrees(math.atan2(y, x))
        points.append((lng, lat))

    return LineString(points, srid=4326)


def _snap_waypoints_to_stations(waypoints):
    """Snap all waypoints to nearest railway stations in a single Overpass query.
    Filters for train stations only (excludes subway/metro/tram)."""
    unions = []
    for wp in waypoints:
        unions.append(
            f'node["railway"="station"]["train"="yes"](around:5000,{wp["lat"]},{wp["lng"]});'
            f'node["railway"="halt"]["train"="yes"](around:5000,{wp["lat"]},{wp["lng"]});'
            f'node["railway"="station"][!"station"](around:5000,{wp["lat"]},{wp["lng"]});'
            f'node["railway"="halt"][!"station"](around:5000,{wp["lat"]},{wp["lng"]});'
        )
    query = "[out:json];(" + "".join(unions) + ");out;"
    try:
        resp = requests.get(
            "https://overpass-api.de/api/interpreter",
            params={"data": query},
            headers={"User-Agent": "TravelDiary/1.0"},
            timeout=15,
        )
        if resp.status_code != 200:
            return waypoints
        elements = resp.json().get("elements", [])
        if not elements:
            return waypoints
    except requests.RequestException:
        return waypoints

    # Filter out subway/metro/tram stations
    rail_elements = [
        e for e in elements
        if e.get("tags", {}).get("station", "") not in ("subway", "light_rail")
    ]
    if not rail_elements:
        rail_elements = elements

    snapped = []
    for wp in waypoints:
        best = min(
            rail_elements,
            key=lambda e: (e["lat"] - wp["lat"]) ** 2
            + (e["lon"] - wp["lng"]) ** 2,
        )
        dist_sq = (best["lat"] - wp["lat"]) ** 2 + (best["lon"] - wp["lng"]) ** 2
        if dist_sq < 0.01:  # ~1km threshold
            snapped.append({"lat": best["lat"], "lng": best["lon"]})
        else:
            snapped.append(wp)
    return snapped


def _brouter_rail(waypoints):
    """Get rail route from BRouter public API. Snaps waypoints to nearest
    railway station first for better results. Falls back to None."""
    snapped = _snap_waypoints_to_stations(waypoints)
    result = _brouter_rail_request(snapped)
    if result:
        return result

    # If snapping changed coords but BRouter still failed, try originals
    if snapped != waypoints:
        return _brouter_rail_request(waypoints)

    return None


def _brouter_rail_request(waypoints):
    """Send a BRouter rail routing request."""
    lonlats = "|".join(f"{wp['lng']},{wp['lat']}" for wp in waypoints)
    url = "https://brouter.de/brouter"
    params = {
        "lonlats": lonlats,
        "profile": "rail",
        "alternativeidx": "0",
        "format": "geojson",
    }

    try:
        response = requests.get(
            url,
            params=params,
            headers={"User-Agent": "TravelDiary/1.0"},
            timeout=30,
        )
        if response.status_code == 200:
            data = response.json()
            features = data.get("features", [])
            if features and features[0].get("geometry"):
                coords = features[0]["geometry"]["coordinates"]
                # Strip Z dimension (BRouter returns [lon, lat, alt])
                coords_2d = [(c[0], c[1]) for c in coords]
                return LineString(coords_2d, srid=4326)
    except requests.RequestException:
        pass

    return None


def _straight_line(waypoints):
    """Simple straight line between waypoints."""
    if len(waypoints) < 2:
        return None
    points = [(wp["lng"], wp["lat"]) for wp in waypoints]
    return LineString(points, srid=4326)
