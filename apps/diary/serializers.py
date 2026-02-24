from rest_framework import serializers
from rest_framework_gis.serializers import GeoFeatureModelSerializer

from .models import JourneySegment, Trip, TripImage


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
        trip = (
            obj.journey.outbound_for_trips.first()
            or obj.journey.return_for_trips.first()
        )
        return trip

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

    class Meta:
        model = TripImage
        geo_field = "location"
        fields = [
            "id",
            "caption",
            "image_url",
            "trip_id",
            "trip_title",
            "taken_at",
        ]

    def get_image_url(self, obj):
        if obj.image:
            return obj.image.url
        return None


class TripListSerializer(serializers.ModelSerializer):
    year = serializers.SerializerMethodField()
    transport_types = serializers.SerializerMethodField()
    lat = serializers.SerializerMethodField()
    lng = serializers.SerializerMethodField()
    travel_date = serializers.SerializerMethodField()

    class Meta:
        model = Trip
        fields = ["id", "title", "year", "transport_types", "lat", "lng", "travel_date"]

    def get_year(self, obj):
        return obj.year

    def get_transport_types(self, obj):
        return list(obj.transport_types)

    def get_lat(self, obj):
        coords = self._geocode(obj)
        return coords["lat"] if coords else None

    def get_lng(self, obj):
        coords = self._geocode(obj)
        return coords["lng"] if coords else None

    def get_travel_date(self, obj):
        if obj.outbound_journey and obj.outbound_journey.travel_date:
            return obj.outbound_journey.travel_date.isoformat()
        return None

    def _geocode(self, obj):
        cache = self.context.get("_geocode_cache")
        if cache is None:
            cache = {}
            self.context["_geocode_cache"] = cache
        if obj.pk not in cache:
            from .services.geocoding import geocode_place
            cache[obj.pk] = geocode_place(obj.title)
        return cache[obj.pk]
