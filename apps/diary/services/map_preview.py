"""Generate a static PNG map preview of trip routes for OG/Discord embeds."""

import io
import itertools
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from math import ceil, floor

from django.conf import settings
from PIL import Image as PILImage

from staticmap import Line, CircleMarker, StaticMap
from staticmap.staticmap import _lat_to_y, _lon_to_x, _x_to_lon, _y_to_lat


class _DarkStaticMap(StaticMap):
    """StaticMap subclass that renders onto an RGBA canvas.

    The parent StaticMap creates an RGB base image but pastes RGBA tiles onto
    it (the tiles are always converted to RGBA by the parent).  This causes a
    mode mismatch when tiles have transparency.  We work around it by
    overriding ``render()`` to use an RGBA base image instead.
    """

    def render(self):
        """Render with an RGBA base image."""
        if not (self.lines or self.markers or self.polygons):
            return PILImage.new("RGB", (self.width, self.height), self.background_color)

        extent = self.determine_extent()
        if extent is None:
            return PILImage.new("RGB", (self.width, self.height), self.background_color)

        self.zoom = self._calculate_zoom()

        # Recalculate zoom if necessary (same logic as parent)
        for z in range(17, -1, -1):
            w = (_lon_to_x(extent[2], z) - _lon_to_x(extent[0], z)) * self.tile_size
            h = (_lat_to_y(extent[1], z) - _lat_to_y(extent[3], z)) * self.tile_size
            if w <= (self.width - self.padding[0] * 2) and h <= (
                self.height - self.padding[1] * 2
            ):
                self.zoom = z
                break

        lon_center = (extent[0] + extent[2]) / 2.0
        lat_center = (extent[1] + extent[3]) / 2.0

        # ── RGBA base image (the key fix) ──────────────────────────────
        image = PILImage.new("RGBA", (self.width, self.height), (0, 0, 0, 0))

        self.x_center = _lon_to_x(lon_center, self.zoom)
        self.y_center = _lat_to_y(lat_center, self.zoom)

        self._draw_base_layer(image)
        self._draw_features(image)
        return image

    def _draw_base_layer(self, image):
        """Fetch tiles and paste onto the RGBA base image."""
        x_min = int(floor(self.x_center - (0.5 * self.width / self.tile_size)))
        y_min = int(floor(self.y_center - (0.5 * self.height / self.tile_size)))
        x_max = int(ceil(self.x_center + (0.5 * self.width / self.tile_size)))
        y_max = int(ceil(self.y_center + (0.5 * self.height / self.tile_size)))

        tiles = []
        for x in range(x_min, x_max):
            for y in range(y_min, y_max):
                max_tile = 2**self.zoom
                tile_x = (x + max_tile) % max_tile
                tile_y = (y + max_tile) % max_tile
                if self.reverse_y:
                    tile_y = ((1 << self.zoom) - tile_y) - 1
                url = self.url_template.format(z=self.zoom, x=tile_x, y=tile_y)
                tiles.append((x, y, url))

        pool = ThreadPoolExecutor(4)

        for nb_retry in itertools.count():
            if not tiles:
                break
            if nb_retry >= 3:
                break
            if nb_retry > 0 and self.delay_between_retries:
                time.sleep(self.delay_between_retries)

            failed = []
            futures = [
                pool.submit(
                    self.get,
                    t[2],
                    timeout=self.request_timeout,
                    headers=self.headers,
                )
                for t in tiles
            ]

            for tile, future in zip(tiles, futures):
                x, y, url = tile
                try:
                    status, content = future.result()
                except Exception:
                    status, content = None, None

                if status != 200:
                    failed.append(tile)
                    continue

                tile_img = PILImage.open(io.BytesIO(content))
                tile_img = tile_img.convert("RGBA")
                # @2x tiles may be larger than tile_size — resize to match
                if tile_img.size != (self.tile_size, self.tile_size):
                    tile_img = tile_img.resize(
                        (self.tile_size, self.tile_size), PILImage.LANCZOS
                    )

                box = [
                    self._x_to_px(x),
                    self._y_to_px(y),
                    self._x_to_px(x + 1),
                    self._y_to_px(y + 1),
                ]
                image.paste(tile_img, box, tile_img)

            tiles = failed


def generate_trip_preview(trip):
    """Generate a static map PNG for a trip, save next to media, return URL path.

    Returns None if the trip has no geometry to render, or rendering fails.
    """
    lines = []
    markers = []

    route_colors = {
        "train": "#1565C0",
        "car": "#9c27b0",
        "plane": "#D32F2F",
        "ferry": "#2E7D32",
    }

    for journey in [trip.outbound_journey, trip.return_journey]:
        if not journey:
            continue
        for seg in journey.segments.all():
            if seg.route_geometry:
                coords = []
                geojson = json.loads(seg.route_geometry.geojson)
                if geojson.get("type") == "LineString":
                    coords = [(c[0], c[1]) for c in geojson["coordinates"]]
                elif geojson.get("type") == "MultiLineString":
                    for line in geojson["coordinates"]:
                        coords.extend([(c[0], c[1]) for c in line])
                if coords:
                    color = route_colors.get(seg.transport_type, "#999")
                    lines.append(Line(coords, color=color, width=3))

            for wp in seg.waypoints:
                if wp.get("lat") and wp.get("lng"):
                    markers.append((wp["lng"], wp["lat"]))

    if not lines and not markers:
        return None

    sm = _DarkStaticMap(
        630,
        630,
        url_template="https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        padding_x=40,
        padding_y=40,
    )

    for line in lines:
        sm.add_line(line)

    for lng, lat in markers:
        sm.add_marker(CircleMarker((lng, lat), color="#FF9800", width=8))

    try:
        image = sm.render()
        # Composite onto dark background then flatten to RGB
        background = PILImage.new("RGBA", image.size, (15, 15, 15, 255))
        background.paste(image, (0, 0), image)
        image = background.convert("RGB")
    except Exception:
        return None

    filename = f"trip_preview_{trip.pk}.png"
    rel_path = f"trips/previews/{filename}"
    abs_path = os.path.join(settings.MEDIA_ROOT, rel_path)

    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    image.save(abs_path, "PNG")

    return settings.MEDIA_URL + rel_path
