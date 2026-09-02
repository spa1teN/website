from django.contrib.auth.decorators import login_required
from django.http import HttpResponseRedirect
from django.shortcuts import render
from django.utils.http import url_has_allowed_host_and_scheme

from apps.analytics.models import AnalyticsEvent


def home(request):
    visitor_number = AnalyticsEvent.objects.filter(event_type="pageview").count()
    return render(request, "core/home.html", {"visitor_number": visitor_number})


def privacy(request):
    return render(request, "core/privacy.html")


@login_required
def admin_index(request):
    return render(request, "core/admin.html")


def set_language(request, lang):
    if lang not in ("de", "en"):
        lang = "de"
    request.session["lang"] = lang

    next_url = request.META.get("HTTP_REFERER", "/")
    if not url_has_allowed_host_and_scheme(
        next_url, allowed_hosts={request.get_host()}, require_https=request.is_secure()
    ):
        next_url = "/"
    return HttpResponseRedirect(next_url)
