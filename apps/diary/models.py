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
    description = models.TextField(blank=True)
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


class TripImage(models.Model):
    trip = models.ForeignKey(
        Trip, on_delete=models.CASCADE, related_name="images"
    )
    image = models.ImageField(upload_to="trips/%Y/%m/")
    location = gis_models.PointField(srid=4326, null=True, blank=True)
    caption = models.CharField(max_length=255, blank=True)
    taken_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.caption or f"Bild zu {self.trip.title}"

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
            if update_fields:
                super().save(update_fields=update_fields)
