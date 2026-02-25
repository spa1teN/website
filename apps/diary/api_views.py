from django.db.models import Q
from rest_framework.generics import ListAPIView

from .models import JourneySegment, Trip, TripImage
from .serializers import ImageMarkerSerializer, RouteSerializer, TripListSerializer


class RouteListView(ListAPIView):
    serializer_class = RouteSerializer

    def get_queryset(self):
        qs = JourneySegment.objects.filter(
            route_geometry__isnull=False
        ).select_related("journey")

        year = self.request.query_params.get("year")
        if year:
            qs = qs.filter(journey__travel_date__year=year)

        transport_type = self.request.query_params.get("transport_type")
        if transport_type:
            qs = qs.filter(transport_type=transport_type)

        trip_id = self.request.query_params.get("trip_id")
        if trip_id:
            qs = qs.filter(
                Q(journey__outbound_for_trips__id=trip_id)
                | Q(journey__return_for_trips__id=trip_id)
            )

        return qs


class ImageMarkerListView(ListAPIView):
    serializer_class = ImageMarkerSerializer

    def get_queryset(self):
        qs = TripImage.objects.filter(
            location__isnull=False
        ).select_related("trip")

        trip_id = self.request.query_params.get("trip_id")
        if trip_id:
            qs = qs.filter(trip_id=trip_id)

        year = self.request.query_params.get("year")
        if year:
            qs = qs.filter(
                Q(trip__outbound_journey__travel_date__year=year)
                | Q(trip__return_journey__travel_date__year=year)
                | Q(trip__event_date__year=year)
            )

        return qs


class TripListView(ListAPIView):
    serializer_class = TripListSerializer
    queryset = Trip.objects.select_related("outbound_journey").order_by(
        "-outbound_journey__travel_date", "-event_date"
    )
