from django.urls import path

from . import api_views

urlpatterns = [
    path("routes/", api_views.RouteListView.as_view(), name="routes"),
    path("images/", api_views.ImageMarkerListView.as_view(), name="images"),
    path("trips/", api_views.TripListView.as_view(), name="trips"),
]
