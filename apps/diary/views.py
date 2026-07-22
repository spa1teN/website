import json

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from .forms import TripForm
from django.contrib.gis.geos import Point

from .models import Journey, JourneySegment, Trip, TripImage, TripVideo
from .services.geocoding import resolve_airport, search_stations
from .services.routing import resolve_route


def map_view(request):
    return render(request, "diary/map.html")


def trip_detail(request, pk):
    trip = get_object_or_404(Trip, pk=pk)
    images = trip.images.all()
    videos = trip.videos.all()

    segments = []
    for journey_attr in ["outbound_journey", "return_journey"]:
        journey = getattr(trip, journey_attr)
        if journey:
            for seg in journey.segments.all():
                segments.append(seg)

    route_data = []
    waypoint_data = []
    for seg in segments:
        if seg.route_geometry:
            route_data.append({
                "type": "Feature",
                "geometry": json.loads(seg.route_geometry.geojson),
                "properties": {"transport_type": seg.transport_type},
            })
        for wp in seg.waypoints:
            if wp.get("lat") and wp.get("lng"):
                waypoint_data.append({
                    "name": wp.get("name", ""),
                    "lat": wp["lat"],
                    "lng": wp["lng"],
                })

    image_data = []
    for img in images:
        entry = {
            "url": img.image.url,
            "thumb": img.thumbnail.url if img.thumbnail else img.image.url,
            "caption": img.caption,
        }
        if img.location:
            entry["lat"] = img.location.y
            entry["lng"] = img.location.x
        image_data.append(entry)

    video_data = []
    for vid in videos:
        entry = {"url": vid.video.url, "caption": vid.caption}
        if vid.location:
            entry["lat"] = vid.location.y
            entry["lng"] = vid.location.x
        video_data.append(entry)

    lang = request.session.get("lang", "de")
    if lang == "fi":
        transport_labels = {"train": "Juna", "car": "Auto / Bussi", "plane": "Lentokone", "ferry": "Lautta"}
        journey_labels = [("Menomatka", "outbound_journey"), ("Paluumatka", "return_journey")]
    elif lang == "en":
        transport_labels = {"train": "Train", "car": "Car / Bus", "plane": "Plane", "ferry": "Ferry"}
        journey_labels = [("Outbound", "outbound_journey"), ("Return", "return_journey")]
    else:
        transport_labels = {"train": "Zug", "car": "Auto", "plane": "Flugzeug", "ferry": "Fähre"}
        journey_labels = [("Hinreise", "outbound_journey"), ("Rückreise", "return_journey")]

    journey_info = []
    for label, journey_attr in journey_labels:
        journey = getattr(trip, journey_attr)
        if journey:
            segs = []
            for seg in journey.segments.all():
                names = [wp.get("name", "") for wp in seg.waypoints if wp.get("name")]
                segs.append({
                    "type_key": seg.transport_type,
                    "type_label": transport_labels.get(seg.transport_type, seg.transport_type),
                    "route_desc": " → ".join(names) if names else (
                        f"{seg.origin_code} → {seg.destination_code}" if seg.origin_code else ""
                    ),
                })
            journey_info.append({
                "label": label,
                "date": journey.travel_date,
                "segments": segs,
            })

    # Compute stats for the hero header
    from .services.stats import _segment_length_km
    total_km = 0.0
    for seg in segments:
        if seg.route_geometry:
            total_km += _segment_length_km(seg.route_geometry)

    duration_days = None
    if trip.outbound_journey and trip.outbound_journey.travel_date:
        start = trip.outbound_journey.travel_date
        end = None
        if trip.return_journey and trip.return_journey.travel_date:
            end = trip.return_journey.travel_date
        if end and end >= start:
            duration_days = (end - start).days + 1

    stats = {
        "total_distance_km": round(total_km) if total_km > 0 else None,
        "duration_days": duration_days,
        "photo_count": images.count(),
        "country_count": None,  # would need geo lookup; skip for now
    }

    # Compute date range string for display and OG description
    date_range_str = None
    if trip.outbound_journey and trip.outbound_journey.travel_date:
        start = trip.outbound_journey.travel_date
        if trip.return_journey and trip.return_journey.travel_date:
            end = trip.return_journey.travel_date
            if end >= start:
                date_range_str = f"{start.strftime('%d.%m.')} – {end.strftime('%d.%m.%Y')}"
            else:
                date_range_str = start.strftime('%d.%m.%Y')
        else:
            date_range_str = start.strftime('%d.%m.%Y')
    elif trip.is_event and trip.event_date:
        date_range_str = trip.event_date.strftime('%d.%m.%Y')

    # Build og_description (always include date_range, even without description)
    og_description = None
    if trip.description:
        og_description = trip.description[:180]
        if date_range_str:
            og_description += f" · {date_range_str}"
    elif date_range_str:
        og_description = date_range_str

    # Build og_images list: map preview first, then embed_images, then fallback
    og_images = []

    # Add map preview if it exists
    import os
    from django.conf import settings
    preview_path = f"trips/previews/trip_preview_{trip.pk}.png"
    if os.path.isfile(os.path.join(settings.MEDIA_ROOT, preview_path)):
        og_images.append({
            "url": settings.MEDIA_URL + preview_path,
            "thumb": settings.MEDIA_URL + preview_path,
            "width": 630,
            "height": 630,
        })

    # Add manually selected embed images
    embed_qs = trip.embed_images.all()
    for img in embed_qs:
        og_images.append({
            "url": img.image.url,
            "thumb": img.thumbnail.url if img.thumbnail else img.image.url,
            "width": 630,
            "height": 630,
        })

    # If no embed images selected, use up to 3 random images as fallback
    if len(og_images) <= 1:  # only map preview, no manual images
        import random
        img_list = list(images)
        random.shuffle(img_list)
        for img in img_list[:3]:
            og_images.append({
                "url": img.image.url,
                "thumb": img.thumbnail.url if img.thumbnail else img.image.url,
                "width": 630,
                "height": 630,
            })

    return render(request, "diary/trip_detail.html", {
        "trip": trip,
        "stats": stats,
        "images": images,
        "videos": videos,
        "route_geojson": json.dumps({"type": "FeatureCollection", "features": route_data}),
        "image_data": json.dumps(image_data),
        "video_data": json.dumps(video_data),
        "waypoint_data": json.dumps(waypoint_data),
        "journey_info": journey_info,
        "og_images": og_images,
        "og_description": og_description,
        "date_range": date_range_str,
    })


@login_required
def dashboard(request):
    sort = request.GET.get("sort", "date_desc")
    trips = Trip.objects.select_related(
        "outbound_journey", "return_journey"
    ).prefetch_related(
        "outbound_journey__segments", "return_journey__segments"
    ).all()

    sort_options = {
        "date_asc": "outbound_journey__travel_date",
        "date_desc": "-outbound_journey__travel_date",
        "title_asc": "title_de",
        "title_desc": "-title_de",
        "created_asc": "created_at",
        "created_desc": "-created_at",
    }
    order_by = sort_options.get(sort, "-created_at")
    trips = trips.order_by(order_by)

    return render(request, "diary/dashboard.html", {
        "trips": trips,
        "current_sort": sort,
    })


@login_required
def trip_create(request):
    if request.method == "POST":
        return _save_trip(request)
    form = TripForm()
    return render(request, "diary/trip_form.html", {"form": form, "editing": False})


@login_required
def trip_edit(request, pk):
    trip = get_object_or_404(Trip, pk=pk)
    if request.method == "POST":
        return _save_trip(request, trip)
    form = TripForm(instance=trip)
    trip_data = _trip_to_json(trip)
    existing_images = trip.images.all()
    existing_videos = trip.videos.all()
    return render(request, "diary/trip_form.html", {
        "form": form,
        "editing": True,
        "trip": trip,
        "trip_data": json.dumps(trip_data),
        "existing_images": existing_images,
        "existing_videos": existing_videos,
    })


@login_required
def trip_delete(request, pk):
    trip = get_object_or_404(Trip, pk=pk)
    if request.method == "POST":
        # Clean up journeys
        for j in [trip.outbound_journey, trip.return_journey]:
            if j:
                j.delete()
        trip.delete()
        return redirect("diary:dashboard")
    return render(request, "diary/trip_delete.html", {"trip": trip})


@login_required
def resolve_route_ajax(request):
    """AJAX endpoint to preview a route from waypoints."""
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        data = json.loads(request.body)
        waypoints = data.get("waypoints", [])
        transport_type = data.get("transport_type", "car")
        geometry = resolve_route(waypoints, transport_type)
        if geometry:
            return JsonResponse({"geometry": json.loads(geometry.geojson)})
        return JsonResponse({"geometry": None})
    except (json.JSONDecodeError, Exception) as e:
        return JsonResponse({"error": str(e)}, status=400)


@login_required
def resolve_airport_ajax(request):
    """AJAX endpoint to resolve an IATA airport code."""
    code = request.GET.get("code", "")
    result = resolve_airport(code)
    if result:
        return JsonResponse(result)
    return JsonResponse({"error": "Airport not found"}, status=404)


@login_required
def search_stations_ajax(request):
    """AJAX endpoint to search stations by name."""
    query = request.GET.get("q", "")
    results = search_stations(query)
    return JsonResponse(results, safe=False)


@login_required
@require_POST
def image_set_location(request, pk):
    img = get_object_or_404(TripImage, pk=pk)
    data = json.loads(request.body)
    img.location = Point(float(data["lng"]), float(data["lat"]))
    img.save(update_fields=["location"])
    return JsonResponse({"ok": True})


def _save_trip(request, trip=None):
    """Save a trip with its journeys, segments, and images."""
    form = TripForm(request.POST, instance=trip)
    if not form.is_valid():
        return JsonResponse(
            {"error": "Formular ungültig", "details": form.errors.get_json_data()},
            status=400,
        )

    try:
        trip_obj = form.save(commit=False)
        is_event = request.POST.get("is_event") == "1"
        trip_obj.is_event = is_event

        if is_event:
            # Clear journeys if converting from trip to event
            old_outbound = trip_obj.outbound_journey
            old_return = trip_obj.return_journey
            trip_obj.outbound_journey = None
            trip_obj.return_journey = None
            raw_date = request.POST.get("event_date", "")
            if raw_date:
                from datetime import datetime
                try:
                    trip_obj.event_date = datetime.strptime(raw_date, "%d.%m.%Y").date()
                except ValueError:
                    trip_obj.event_date = None
            else:
                trip_obj.event_date = None
            trip_obj.save()
            if old_outbound:
                old_outbound.delete()
            if old_return:
                old_return.delete()
        else:
            # Journey data comes as JSON string in FormData field
            journey_data_raw = request.POST.get("journey_data", "")
            if journey_data_raw:
                try:
                    journey_data = json.loads(journey_data_raw)
                except json.JSONDecodeError:
                    return JsonResponse(
                        {"error": "Ungültige Reisedaten (JSON)"},
                        status=400,
                    )

                outbound_data = journey_data.get("outbound_journey")
                if outbound_data:
                    trip_obj.outbound_journey = _save_journey(
                        outbound_data, trip_obj.outbound_journey
                    )

                return_data = journey_data.get("return_journey")
                if return_data:
                    trip_obj.return_journey = _save_journey(
                        return_data, trip_obj.return_journey
                    )

            trip_obj.save()

        # Handle deletion of existing images
        delete_images = request.POST.getlist("delete_images")
        if delete_images:
            TripImage.objects.filter(id__in=delete_images, trip=trip_obj).delete()

        # Process uploaded images
        for img_file in request.FILES.getlist("images"):
            TripImage.objects.create(trip=trip_obj, image=img_file)

        # Handle deletion of existing videos
        delete_videos = request.POST.getlist("delete_videos")
        if delete_videos:
            TripVideo.objects.filter(id__in=delete_videos, trip=trip_obj).delete()

        # Process uploaded videos
        for vid_file in request.FILES.getlist("videos"):
            TripVideo.objects.create(trip=trip_obj, video=vid_file)

        # Handle embed images selection
        embed_image_ids = request.POST.getlist("embed_images")
        if embed_image_ids:
            # Only keep at most 3 embed images that belong to this trip
            valid_ids = TripImage.objects.filter(
                id__in=embed_image_ids, trip=trip_obj
            ).values_list("id", flat=True)[:3]
            trip_obj.embed_images.set(valid_ids)

        # Generate static map preview for OG/Discord (best-effort)
        if not is_event:
            try:
                from .services.map_preview import generate_trip_preview
                generate_trip_preview(trip_obj)
            except Exception:
                pass

        return JsonResponse({"success": True, "redirect": "/diary/manage/"})

    except Exception as e:
        return JsonResponse(
            {"error": f"Fehler beim Speichern: {e}"},
            status=500,
        )


def _save_journey(journey_data, existing_journey=None):
    """Save a journey with its segments."""
    if existing_journey:
        journey = existing_journey
        journey.travel_date = journey_data["travel_date"]
        journey.save()
        journey.segments.all().delete()
    else:
        journey = Journey.objects.create(
            travel_date=journey_data["travel_date"]
        )

    for i, seg_data in enumerate(journey_data.get("segments", [])):
        waypoints = seg_data.get("waypoints", [])
        transport_type = seg_data.get("transport_type", "car")
        route_geometry = resolve_route(waypoints, transport_type)

        JourneySegment.objects.create(
            journey=journey,
            order=i,
            transport_type=transport_type,
            waypoints=waypoints,
            route_geometry=route_geometry,
            origin_code=seg_data.get("origin_code", ""),
            destination_code=seg_data.get("destination_code", ""),
        )

    return journey


def _trip_to_json(trip):
    """Convert a trip to JSON for the edit form."""
    result = {
        "title": trip.title,
        "title_en": trip.title_en or "",
        "title_fi": trip.title_fi or "",
        "subtitle": trip.subtitle,
        "subtitle_en": trip.subtitle_en or "",
        "subtitle_fi": trip.subtitle_fi or "",
        "description": trip.description,
        "description_en": trip.description_en or "",
        "description_fi": trip.description_fi or "",
        "is_event": trip.is_event,
        "event_date": trip.event_date.strftime("%d.%m.%Y") if trip.event_date else "",
        "outbound_journey": None,
        "return_journey": None,
        "embed_image_ids": list(trip.embed_images.values_list("id", flat=True)),
    }

    for key, journey in [
        ("outbound_journey", trip.outbound_journey),
        ("return_journey", trip.return_journey),
    ]:
        if journey:
            result[key] = {
                "travel_date": journey.travel_date.isoformat(),
                "segments": [
                    {
                        "transport_type": seg.transport_type,
                        "waypoints": seg.waypoints,
                        "origin_code": seg.origin_code,
                        "destination_code": seg.destination_code,
                    }
                    for seg in journey.segments.all()
                ],
            }

    return result
