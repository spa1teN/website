from django.core.management.base import BaseCommand
from django.db.models import Q

from apps.diary.models import TripImage, TripVideo


class Command(BaseCommand):
    help = "Generate thumbnails for all TripImages/TripVideos that are missing one"

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

        vqs = TripVideo.objects.filter(
            Q(thumbnail__isnull=True) | Q(thumbnail="")
        )
        total_v = vqs.count()
        self.stdout.write(f"{total_v} Videos ohne Thumbnail gefunden.")

        for i, vid in enumerate(vqs, 1):
            try:
                vid._generate_thumbnail()
                TripVideo.objects.filter(pk=vid.pk).update(
                    thumbnail=vid.thumbnail,
                )
                self.stdout.write(f"  [{i}/{total_v}] OK: {vid.video.name}")
            except Exception as e:
                self.stdout.write(self.style.WARNING(f"  [{i}/{total_v}] Fehler bei {vid.video.name}: {e}"))

        self.stdout.write(self.style.SUCCESS("Fertig."))
