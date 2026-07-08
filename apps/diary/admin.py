from django.contrib.gis import admin
from .models import Trip, Journey, JourneySegment, TripImage, TripVideo


class JourneySegmentInline(admin.TabularInline):
    model = JourneySegment
    extra = 1


class TripImageInline(admin.TabularInline):
    model = TripImage
    extra = 1


@admin.register(Journey)
class JourneyAdmin(admin.GISModelAdmin):
    list_display = ["__str__", "travel_date"]
    inlines = [JourneySegmentInline]


@admin.register(Trip)
class TripAdmin(admin.GISModelAdmin):
    list_display = ["title", "year", "created_at"]
    inlines = [TripImageInline]


@admin.register(TripImage)
class TripImageAdmin(admin.GISModelAdmin):
    list_display = ["__str__", "trip", "taken_at"]


@admin.register(TripVideo)
class TripVideoAdmin(admin.GISModelAdmin):
    list_display = ["__str__", "trip", "created_at"]
