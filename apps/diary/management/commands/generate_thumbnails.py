from django.core.management.base import BaseCommand
from django.db.models import Q

from apps.diary.models import TripImage


class Command(BaseCommand):
    help = "Generate thumbnails and micro-thumbnails for all TripImages that are missing one"

    def handle(self, *args, **options):
        qs = TripImage.objects.filter(
            Q(thumbnail__isnull=True) | Q(thumbnail="") |
            Q(micro_thumbnail__isnull=True) | Q(micro_thumbnail="")
        )
        total = qs.count()
        self.stdout.write(f"{total} Bilder ohne Thumbnail gefunden.")

        for i, img in enumerate(qs, 1):
            try:
                img._generate_thumbnail()
                TripImage.objects.filter(pk=img.pk).update(
                    thumbnail=img.thumbnail,
                    micro_thumbnail=img.micro_thumbnail,
                )
                self.stdout.write(f"  [{i}/{total}] OK: {img.image.name}")
            except Exception as e:
                self.stdout.write(self.style.WARNING(f"  [{i}/{total}] Fehler bei {img.image.name}: {e}"))

        self.stdout.write(self.style.SUCCESS("Fertig."))
