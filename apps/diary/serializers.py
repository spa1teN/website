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

    class Meta:
        model = Trip
        fields = ["id", "title", "subtitle", "year", "transport_types", "lat", "lng", "travel_date", "is_event"]

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

    def get_travel_date(self, obj):
        if obj.outbound_journey and obj.outbound_journey.travel_date:
            return obj.outbound_journey.travel_date.isoformat()
        if obj.event_date:
            return obj.event_date.isoformat()
        return None

    def _get_first_coords(self, obj):
        """Get coordinates from the destination (last waypoint of last outbound segment)."""
        if obj.outbound_journey:
            segments = list(obj.outbound_journey.segments.all())
            if segments:
                last_seg = segments[-1]
                if last_seg.waypoints:
                    wp = last_seg.waypoints[-1]
                    if wp.get("lat") and wp.get("lng"):
                        return {"lat": wp["lat"], "lng": wp["lng"]}
        return None
