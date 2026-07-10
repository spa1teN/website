from django.contrib import admin

from .models import AnalyticsEvent


@admin.register(AnalyticsEvent)
class AnalyticsEventAdmin(admin.ModelAdmin):
    list_display = [
        "created_at", "event_type", "path", "target",
        "country", "city", "device_type", "browser", "os",
        "language", "screen_bucket", "referrer_domain",
    ]
    list_filter = ["event_type", "device_type", "country", "language", "browser", "screen_bucket"]
    search_fields = ["path", "target", "referrer_domain", "city"]
    date_hierarchy = "created_at"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
