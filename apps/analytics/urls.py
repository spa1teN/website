from django.urls import path

from . import views

app_name = "analytics"

urlpatterns = [
    path("event/", views.track_event, name="track_event"),
    path("stats/", views.stats_api, name="stats_api"),
]
