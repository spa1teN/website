from django.contrib.auth.decorators import login_required
from django.http import HttpResponseRedirect
from django.shortcuts import render
from django.utils.http import url_has_allowed_host_and_scheme


def home(request):
    return render(request, "core/home.html")


def privacy(request):
    return render(request, "core/privacy.html")


@login_required
def admin_index(request):
    return render(request, "core/admin.html")


def set_language(request, lang):
    if lang not in ("de", "en", "fi"):
        lang = "de"
    request.session["lang"] = lang

    next_url = request.META.get("HTTP_REFERER", "/")
    if not url_has_allowed_host_and_scheme(
        next_url, allowed_hosts={request.get_host()}, require_https=request.is_secure()
    ):
        next_url = "/"
    return HttpResponseRedirect(next_url)
