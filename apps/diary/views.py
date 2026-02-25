import json

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from .forms import TripForm
from django.contrib.gis.geos import Point

from .models import Journey, JourneySegment, Trip, TripImage
from .services.geocoding import resolve_airport, search_stations
from .services.routing import resolve_route


def map_view(request):
    return render(request, "diary/map.html")


def trip_detail(request, pk):
    trip = get_object_or_404(Trip, pk=pk)
    images = trip.images.all()

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
        entry = {"url": img.image.url, "caption": img.caption}
        if img.location:
            entry["lat"] = img.location.y
            entry["lng"] = img.location.x
        image_data.append(entry)

    transport_labels = {"train": "Zug", "car": "Auto", "plane": "Flugzeug", "ferry": "Fähre"}
    journey_info = []
    for label, journey_attr in [("Hinreise", "outbound_journey"), ("Rückreise", "return_journey")]:
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

    return render(request, "diary/trip_detail.html", {
        "trip": trip,
        "images": images,
        "route_geojson": json.dumps({"type": "FeatureCollection", "features": route_data}),
        "image_data": json.dumps(image_data),
        "waypoint_data": json.dumps(waypoint_data),
        "journey_info": journey_info,
    })


@login_required
def dashboard(request):
    trips = Trip.objects.select_related(
        "outbound_journey", "return_journey"
    ).all()
    return render(request, "diary/dashboard.html", {"trips": trips})


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
    return render(request, "diary/trip_form.html", {
        "form": form,
        "editing": True,
        "trip": trip,
        "trip_data": json.dumps(trip_data),
        "existing_images": existing_images,
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
        "description": trip.description,
        "is_event": trip.is_event,
        "event_date": trip.event_date.strftime("%d.%m.%Y") if trip.event_date else "",
        "outbound_journey": None,
        "return_journey": None,
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
