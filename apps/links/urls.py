from django.urls import path
from . import views

app_name = "links"

urlpatterns = [
    path("", views.links, name="links"),
    path("status/", views.status, name="status"),
    path("api/status/tausendsassa/", views.api_status_tausendsassa, name="api_status_tausendsassa"),
    path("api/status/roaringbot/", views.api_status_roaringbot, name="api_status_roaringbot"),
]
