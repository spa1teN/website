from django.urls import path

from . import api_views

urlpatterns = [
    path("routes/", api_views.RouteListView.as_view(), name="routes"),
    path("images/", api_views.ImageMarkerListView.as_view(), name="images"),
    path("videos/", api_views.VideoMarkerListView.as_view(), name="videos"),
    path("trips/", api_views.TripListView.as_view(), name="trips"),
    path("stats/", api_views.StatsView.as_view(), name="stats"),
    path("visited-countries/", api_views.VisitedCountriesView.as_view(), name="visited_countries"),
    path("states/", api_views.StatesView.as_view(), name="states"),
]
