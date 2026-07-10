LANGUAGES = [
    {"code": "de", "flag": "🇩🇪", "label": "Deutsch", "aria": "Auf Deutsch wechseln"},
    {"code": "en", "flag": "🇬🇧", "label": "English", "aria": "Switch to English"},
    {"code": "fi", "flag": "🇫🇮", "label": "Suomi", "aria": "Vaihda suomeksi"},
]


def language(request):
    lang = request.session.get("lang", "de")
    if lang not in ("de", "en", "fi"):
        lang = "de"
    other_langs = [entry for entry in LANGUAGES if entry["code"] != lang]
    return {"LANG": lang, "OTHER_LANGS": other_langs}
