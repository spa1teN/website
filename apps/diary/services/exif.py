from datetime import datetime

from django.contrib.gis.geos import Point
from PIL import Image as PILImage
from PIL.ExifTags import GPSTAGS, TAGS


def _convert_to_degrees(value):
    """Convert GPS coordinates from EXIF DMS format to decimal degrees."""
    d, m, s = value
    return float(d) + float(m) / 60.0 + float(s) / 3600.0


def extract_gps_data(image_file):
    """
    Extract GPS coordinates and datetime from an image file's EXIF data.

    Returns dict with keys 'point' (Point or None) and 'taken_at' (datetime or None).
    """
    result = {"point": None, "taken_at": None}

    try:
        img = PILImage.open(image_file)
        exif_data = img._getexif()
        if not exif_data:
            return result

        for tag_id, value in exif_data.items():
            tag = TAGS.get(tag_id, tag_id)
            if tag == "DateTimeOriginal":
                try:
                    result["taken_at"] = datetime.strptime(
                        value, "%Y:%m:%d %H:%M:%S"
                    )
                except (ValueError, TypeError):
                    pass

        gps_info = {}
        if 34853 in exif_data:
            for key, val in exif_data[34853].items():
                tag = GPSTAGS.get(key, key)
                gps_info[tag] = val

        if "GPSLatitude" in gps_info and "GPSLongitude" in gps_info:
            lat = _convert_to_degrees(gps_info["GPSLatitude"])
            lng = _convert_to_degrees(gps_info["GPSLongitude"])

            if gps_info.get("GPSLatitudeRef", "N") == "S":
                lat = -lat
            if gps_info.get("GPSLongitudeRef", "E") == "W":
                lng = -lng

            result["point"] = Point(lng, lat, srid=4326)
    except Exception:
        pass

    return result
