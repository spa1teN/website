from rest_framework import serializers
from rest_framework_gis.serializers import GeoFeatureModelSerializer

from .models import JourneySegment, Trip, TripImage, TripVideo


class RouteSerializer(GeoFeatureModelSerializer):
    trip_id = serializers.SerializerMethodField()
    trip_title = serializers.SerializerMethodField()
    year = serializers.SerializerMethodField()

    class Meta:
        model = JourneySegment
        geo_field = "route_geometry"
        fields = [
            "id",
            "transport_type",
            "trip_id",
            "trip_title",
            "year",
        ]

    def _get_trip(self, obj):
        trips = list(obj.journey.outbound_for_trips.all())
        if trips:
            return trips[0]
        trips = list(obj.journey.return_for_trips.all())
        if trips:
            return trips[0]
        return None

    def get_trip_id(self, obj):
        trip = self._get_trip(obj)
        return trip.id if trip else None

    def get_trip_title(self, obj):
        trip = self._get_trip(obj)
        return trip.title if trip else None

    def get_year(self, obj):
        return obj.journey.travel_date.year if obj.journey.travel_date else None


class ImageMarkerSerializer(GeoFeatureModelSerializer):
    trip_id = serializers.IntegerField(source="trip.id", read_only=True)
    trip_title = serializers.CharField(source="trip.title", read_only=True)
    image_url = serializers.SerializerMethodField()
    thumb_url = serializers.SerializerMethodField()

    class Meta:
        model = TripImage
        geo_field = "location"
        fields = [
            "id",
            "caption",
            "image_url",
            "thumb_url",
            "trip_id",
            "trip_title",
            "taken_at",
        ]

    def get_image_url(self, obj):
        if obj.image:
            return obj.image.url
        return None

    def get_thumb_url(self, obj):
        if obj.micro_thumbnail:
            return obj.micro_thumbnail.url
        if obj.thumbnail:
            return obj.thumbnail.url
        if obj.image:
            return obj.image.url
        return None


class VideoMarkerSerializer(GeoFeatureModelSerializer):
    trip_id = serializers.IntegerField(source="trip.id", read_only=True)
    trip_title = serializers.CharField(source="trip.title", read_only=True)
    video_url = serializers.SerializerMethodField()

    class Meta:
        model = TripVideo
        geo_field = "location"
        fields = [
            "id",
            "caption",
            "video_url",
            "trip_id",
            "trip_title",
        ]

    def get_video_url(self, obj):
        if obj.video:
            return obj.video.url
        return None


class TripListSerializer(serializers.ModelSerializer):
    year = serializers.SerializerMethodField()
    transport_types = serializers.SerializerMethodField()
    lat = serializers.SerializerMethodField()
    lng = serializers.SerializerMethodField()
    travel_date = serializers.SerializerMethodField()
    destination_country = serializers.SerializerMethodField()
    total_distance_km = serializers.SerializerMethodField()
    photo_count = serializers.SerializerMethodField()
    duration_days = serializers.SerializerMethodField()
    country_count = serializers.SerializerMethodField()

    class Meta:
        model = Trip
        fields = [
            "id", "title", "subtitle", "year", "transport_types", "lat", "lng",
            "travel_date", "is_event", "destination_country",
            "total_distance_km", "photo_count", "duration_days", "country_count",
        ]

    def get_total_distance_km(self, obj):
        from .services.stats import _segment_length_km

        total = 0.0
        for journey in (obj.outbound_journey, obj.return_journey):
            if not journey:
                continue
            for seg in journey.segments.all():
                if seg.route_geometry:
                    total += _segment_length_km(seg.route_geometry)
        return round(total)

    def get_photo_count(self, obj):
        if hasattr(obj, "_images_count"):
            return obj._images_count
        return obj.images.count()

    def get_duration_days(self, obj):
        start_date = end_date = None
        if obj.outbound_journey and obj.outbound_journey.travel_date:
            start_date = obj.outbound_journey.travel_date
        elif obj.event_date:
            start_date = obj.event_date
        if obj.return_journey and obj.return_journey.travel_date:
            end_date = obj.return_journey.travel_date
        if start_date and end_date and end_date >= start_date:
            return (end_date - start_date).days + 1
        return None

    def get_country_count(self, obj):
        if hasattr(obj, "_country_count"):
            return obj._country_count
        return None

    def get_year(self, obj):
        return obj.year

    def get_transport_types(self, obj):
        return list(obj.transport_types)

    def get_lat(self, obj):
        coords = self._get_first_coords(obj)
        return coords["lat"] if coords else None

    def get_lng(self, obj):
        coords = self._get_first_coords(obj)
        return coords["lng"] if coords else None

    def get_destination_country(self, obj):
        from .services.stats import resolve_trip_destination_country

        lang = self.context.get("lang", "de")
        country = resolve_trip_destination_country(obj)
        if not country:
            return None
        return {
            "name": country["name_de"] if lang == "de" else country["name"],
            "iso_a2": country.get("iso_a2"),
        }

    def get_travel_date(self, obj):
        if obj.outbound_journey and obj.outbound_journey.travel_date:
            return obj.outbound_journey.travel_date.isoformat()
        if obj.event_date:
            return obj.event_date.isoformat()
        return None

    def _get_first_coords(self, obj):
        """Get coordinates from the destination (last waypoint of last outbound
        segment). For events (no journeys), fall back to the first geotagged image."""
        if obj.outbound_journey:
            segments = list(obj.outbound_journey.segments.all())
            if segments:
                last_seg = segments[-1]
                if last_seg.waypoints:
                    wp = last_seg.waypoints[-1]
                    if wp.get("lat") and wp.get("lng"):
                        return {"lat": wp["lat"], "lng": wp["lng"]}
        # Fallback for events: use first image with GPS data
        img = obj.images.exclude(location__isnull=True).first()
        if img:
            return {"lat": img.location.y, "lng": img.location.x}
        return None
