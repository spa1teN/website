from django.db.models import Q
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import JourneySegment, Trip, TripImage, TripVideo
from .serializers import ImageMarkerSerializer, RouteSerializer, TripListSerializer, VideoMarkerSerializer
from .services.stats import (
    compute_all_states_geojson,
    compute_states_geojson,
    compute_stats,
    compute_visited_countries_geojson,
)


def _request_lang(request):
    lang = request.session.get("lang", "de")
    return lang if lang in ("de", "en", "fi") else "de"


class RouteListView(ListAPIView):
    serializer_class = RouteSerializer

    def get_queryset(self):
        qs = JourneySegment.objects.filter(
            route_geometry__isnull=False
        ).select_related("journey").prefetch_related(
            "journey__outbound_for_trips",
            "journey__return_for_trips",
        )

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


class VideoMarkerListView(ListAPIView):
    serializer_class = VideoMarkerSerializer

    def get_queryset(self):
        qs = TripVideo.objects.filter(
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
    queryset = Trip.objects.select_related(
        "outbound_journey", "return_journey"
    ).prefetch_related(
        "outbound_journey__segments",
        "return_journey__segments",
        "images",
    ).order_by("-outbound_journey__travel_date", "-event_date")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["lang"] = _request_lang(self.request)
        return context


class StatsView(APIView):
    def get(self, request):
        years = set(request.GET.getlist("year"))
        transports = set(request.GET.getlist("transport"))
        types = set(request.GET.getlist("type"))
        countries = set(request.GET.getlist("country"))
        data = compute_stats(
            _request_lang(request),
            years=years or None,
            transports=transports or None,
            types=types or None,
            countries=countries or None,
        )
        return Response(data)


class VisitedCountriesView(APIView):
    def get(self, request):
        years = set(request.GET.getlist("year"))
        transports = set(request.GET.getlist("transport"))
        types = set(request.GET.getlist("type"))
        countries = set(request.GET.getlist("country"))
        data = compute_visited_countries_geojson(
            _request_lang(request),
            years=years or None,
            transports=transports or None,
            types=types or None,
            countries=countries or None,
        )
        return Response(data)


class StatesView(APIView):
    def get(self, request):
        country = request.GET.get("country")
        years = set(request.GET.getlist("year"))
        transports = set(request.GET.getlist("transport"))
        lang = _request_lang(request)
        if country:
            data = compute_states_geojson(lang, country, years=years or None, transports=transports or None)
        else:
            data = compute_all_states_geojson(lang, years=years or None, transports=transports or None)
        return Response(data)
