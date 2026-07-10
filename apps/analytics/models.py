from django.db import models


class AnalyticsEvent(models.Model):
    """An anonymous pageview or click event.

    No IP address, cookie, session id, or user identifier is ever stored here -
    each row is a standalone data point that cannot be linked to any other row
    as belonging to "the same visitor". See DATA_INTERFACE.md for the full
    schema description and analysis guide.
    """

    EVENT_TYPES = [
        ("pageview", "Pageview"),
        ("click", "Click"),
    ]

    DEVICE_TYPES = [
        ("desktop", "Desktop"),
        ("mobile", "Mobile"),
        ("tablet", "Tablet"),
        ("bot", "Bot"),
    ]

    SCREEN_BUCKETS = [
        ("mobile", "< 600px"),
        ("tablet", "600–1024px"),
        ("desktop", "1024–1600px"),
        ("desktop-large", "> 1600px"),
    ]

    LANGUAGES = [
        ("de", "Deutsch"),
        ("en", "English"),
        ("fi", "Suomi"),
    ]

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    event_type = models.CharField(max_length=10, choices=EVENT_TYPES, db_index=True)
    path = models.CharField(max_length=500, db_index=True)
    target = models.CharField(max_length=200, blank=True)
    referrer_domain = models.CharField(max_length=255, blank=True)
    country = models.CharField(max_length=2, blank=True)
    city = models.CharField(max_length=100, blank=True)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    device_type = models.CharField(max_length=10, choices=DEVICE_TYPES, blank=True)
    browser = models.CharField(max_length=50, blank=True)
    os = models.CharField(max_length=50, blank=True)
    language = models.CharField(max_length=2, choices=LANGUAGES, blank=True)
    screen_bucket = models.CharField(max_length=20, choices=SCREEN_BUCKETS, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["event_type", "created_at"]),
            models.Index(fields=["path"]),
            models.Index(fields=["country"]),
        ]

    def __str__(self):
        label = self.target if self.event_type == "click" else self.path
        return f"{self.event_type}: {label} @ {self.created_at:%Y-%m-%d %H:%M}"
