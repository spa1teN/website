from django.shortcuts import render
from django.templatetags.static import static

from .stations import STATIONS


def index(request):
    lang = request.session.get("lang", "de")
    if lang not in ("de", "en"):
        lang = "de"

    stations = []
    for s in STATIONS:
        image = s.get("image")
        if image:
            image = dict(image)
            image["url"] = static(image["url"])
            image["alt"] = image["alt"][lang]
        stations.append({
            "slug": s["slug"],
            "title": s["title"][lang],
            "body": s["body"][lang],
            "image": image,
            "map": s["map"],
        })
    return render(request, "about/about.html", {
        "stations": stations,
        "station_range": range(len(STATIONS)),
    })
