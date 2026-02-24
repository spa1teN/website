from django.urls import path
from . import views

app_name = "diary"

urlpatterns = [
    path("", views.map_view, name="map"),
    path("trip/<int:pk>/", views.trip_detail, name="trip_detail"),
    path("manage/", views.dashboard, name="dashboard"),
    path("manage/trip/new/", views.trip_create, name="trip_create"),
    path("manage/trip/<int:pk>/edit/", views.trip_edit, name="trip_edit"),
    path("manage/trip/<int:pk>/delete/", views.trip_delete, name="trip_delete"),
    path("manage/resolve-route/", views.resolve_route_ajax, name="resolve_route"),
    path("manage/resolve-airport/", views.resolve_airport_ajax, name="resolve_airport"),
    path("manage/search-stations/", views.search_stations_ajax, name="search_stations"),
    path("manage/image/<int:pk>/set-location/", views.image_set_location, name="image_set_location"),
]
