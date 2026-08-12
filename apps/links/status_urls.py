from django.urls import path
from . import views

app_name = "status"

urlpatterns = [
    path("", views.status_overview, name="overview"),
    path("roaringbot/", views.status_roaringbot, name="roaringbot"),
    path("tausendsassa/", views.status_tausendsassa, name="tausendsassa"),
    path("api/", views.status_api_docs, name="api_docs"),
]
