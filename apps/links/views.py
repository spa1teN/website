from django.shortcuts import render
from django.conf import settings


def links(request):
    return render(request, "links/links.html", {
        "discord_user_id": settings.DISCORD_USER_ID,
    })
