from django.contrib.gis.db import models as gis_models
from django.db import models


class Journey(models.Model):
    travel_date = models.DateField()
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-travel_date"]

    def __str__(self):
        return f"Reise am {self.travel_date}"


class JourneySegment(models.Model):
    class TransportType(models.TextChoices):
        TRAIN = "train", "Zug"
        CAR = "car", "Auto"
        PLANE = "plane", "Flugzeug"
        FERRY = "ferry", "Fähre"

    journey = models.ForeignKey(
        Journey, on_delete=models.CASCADE, related_name="segments"
    )
    order = models.PositiveIntegerField()
    transport_type = models.CharField(
        max_length=10, choices=TransportType.choices
    )
    waypoints = models.JSONField(
        default=list,
        help_text="Liste von Wegpunkten: [{name, lat, lng}, ...]",
    )
    route_geometry = gis_models.LineStringField(
        srid=4326, null=True, blank=True
    )
    origin_code = models.CharField(max_length=10, blank=True)
    destination_code = models.CharField(max_length=10, blank=True)

    class Meta:
        ordering = ["journey", "order"]

    def __str__(self):
        return f"{self.get_transport_type_display()} Abschnitt #{self.order}"


class Trip(models.Model):
    title = models.CharField(max_length=255)
    subtitle = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    is_event = models.BooleanField(default=False)
    event_date = models.DateField(null=True, blank=True)
    outbound_journey = models.ForeignKey(
        Journey,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="outbound_for_trips",
    )
    return_journey = models.ForeignKey(
        Journey,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="return_for_trips",
    )
    embed_images = models.ManyToManyField(
        "TripImage",
        blank=True,
        related_name="embed_for_trips",
        help_text="Bilder die im Discord/OG-Embed angezeigt werden (max. 3)",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title

    @property
    def year(self):
        if self.outbound_journey and self.outbound_journey.travel_date:
            return self.outbound_journey.travel_date.year
        if self.event_date:
            return self.event_date.year
        return None

    @property
    def transport_types(self):
        types = set()
        for journey in [self.outbound_journey, self.return_journey]:
            if journey:
                types.update(
                    journey.segments.values_list("transport_type", flat=True)
                )
        return types

    @property
    def outbound_distance_km(self):
        from .services.stats import _segment_length_km

        if not self.outbound_journey:
            return None
        total = sum(
            _segment_length_km(seg.route_geometry)
            for seg in self.outbound_journey.segments.all()
            if seg.route_geometry
        )
        return round(total) if total > 0 else None

    @property
    def return_distance_km(self):
        from .services.stats import _segment_length_km

        if not self.return_journey:
            return None
        total = sum(
            _segment_length_km(seg.route_geometry)
            for seg in self.return_journey.segments.all()
            if seg.route_geometry
        )
        return round(total) if total > 0 else None


class TripImage(models.Model):
    trip = models.ForeignKey(
        Trip, on_delete=models.CASCADE, related_name="images"
    )
    image = models.ImageField(upload_to="trips/%Y/%m/")
    thumbnail = models.ImageField(upload_to="trips/thumbs/%Y/%m/", null=True, blank=True)
    micro_thumbnail = models.ImageField(upload_to="trips/micro/%Y/%m/", null=True, blank=True)
    location = gis_models.PointField(srid=4326, null=True, blank=True)
    caption = models.CharField(max_length=255, blank=True)
    taken_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.caption or f"Bild zu {self.trip.title}"

    def _generate_thumbnail(self):
        import os
        from io import BytesIO

        from django.core.files.base import ContentFile
        from PIL import Image as PILImage

        self.image.open()
        img = PILImage.open(self.image)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        base_name = os.path.basename(self.image.name)

        thumb = img.copy()
        thumb.thumbnail((800, 800), PILImage.LANCZOS)
        output = BytesIO()
        thumb.save(output, format="JPEG", quality=80)
        self.thumbnail.save("thumb_" + base_name + ".jpg", ContentFile(output.getvalue()), save=False)

        micro = img.copy()
        micro.thumbnail((150, 150), PILImage.LANCZOS)
        output = BytesIO()
        micro.save(output, format="JPEG", quality=75)
        self.micro_thumbnail.save("micro_" + base_name + ".jpg", ContentFile(output.getvalue()), save=False)

    def save(self, *args, **kwargs):
        is_new = self.pk is None
        super().save(*args, **kwargs)
        if is_new and self.image:
            from .services.exif import extract_gps_data

            self.image.open()
            gps_data = extract_gps_data(self.image)
            update_fields = []
            if gps_data["point"]:
                self.location = gps_data["point"]
                update_fields.append("location")
            if gps_data["taken_at"]:
                self.taken_at = gps_data["taken_at"]
                update_fields.append("taken_at")
            try:
                self._generate_thumbnail()
                update_fields.append("thumbnail")
                update_fields.append("micro_thumbnail")
            except Exception:
                pass
            if update_fields:
                super().save(update_fields=update_fields)


class TripVideo(models.Model):
    trip = models.ForeignKey(
        Trip, on_delete=models.CASCADE, related_name="videos"
    )
    video = models.FileField(upload_to="trips/%Y/%m/")
    location = gis_models.PointField(srid=4326, null=True, blank=True)
    caption = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.caption or f"Video zu {self.trip.title}"


def _invalidate_stats_cache(*args, **kwargs):
    from django.core.cache import cache

    cache.delete("diary_stats_de")
    cache.delete("diary_stats_en")
    cache.delete("diary_geo_index")
    cache.delete("diary_state_index")


for _model in (Trip, JourneySegment, TripImage, TripVideo):
    models.signals.post_save.connect(_invalidate_stats_cache, sender=_model)
    models.signals.post_delete.connect(_invalidate_stats_cache, sender=_model)
