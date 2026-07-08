def language(request):
    lang = request.session.get("lang", "de")
    if lang not in ("de", "en"):
        lang = "de"
    return {"LANG": lang}
