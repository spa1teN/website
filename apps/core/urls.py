from django.urls import path
from . import views

app_name = "core"

urlpatterns = [
    path("", views.home, name="home"),
    path("manage/", views.admin_index, name="admin_index"),
    path("set-language/<str:lang>/", views.set_language, name="set_language"),
    path("datenschutz/", views.privacy, name="privacy"),
]
