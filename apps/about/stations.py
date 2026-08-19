"""Lebensstationen für die interaktive About-Seite.

Jede Station hat Titel/Text auf DE/EN, optional ein Bild und eine
Karten-Konfiguration (center, zoom, marker, hervorgehobene Länder).
"""

STATIONS = [
    {
        "slug": "birth",
        "title": {"de": "Geburt", "en": "Birth"},
        "body": {
            "de": "geboren am 26. April 2004 um 7:55 Uhr im Elim-Krankenhaus "
                  "in Hamburg-Eimsbüttel (heute Agaplesion)",
            "en": "born 26th April 2004 at 7:55 AM in the Elim hospital in "
                  "Hamburg-Eimsbüttel (nowadays Agaplesion)",
        },
        "image": {
            "url": "about/img/elim-hospital.webp",
            "kind": "photo",
            "alt": {
                "de": "Historische Postkarte des Elim-Krankenhauses in Hamburg-Eimsbüttel",
                "en": "Historic postcard of the Elim hospital in Hamburg-Eimsbüttel",
            },
        },
        "map": {
            "center": [9.9673, 53.5682],
            "zoom": 12,
            "markers": [{"lng": 9.9673, "lat": 53.5682}],
            "highlight_countries": [],
            "fit_bounds": False,
        },
    },
    {
        "slug": "parents",
        "title": {"de": "Herkunft", "en": "Heritage"},
        "body": {
            "de": "Eltern: finnische Auswanderin und Deutscher. Beide "
                  "Staatsbürgerschaften von Geburt an.",
            "en": "Parents: Finnish expat and German. Acquired both "
                  "nationalities by birth.",
        },
        "image": None,
        "map": {
            "center": [18.75, 58.7],  # Fallback; fit_bounds gewinnt
            "zoom": 3.5,
            "markers": [],
            "highlight_countries": ["DE", "FI"],
            "fit_bounds": True,
        },
    },
    {
        "slug": "fff",
        "title": {"de": "Fridays for Future Hamburg", "en": "Fridays for Future Hamburg"},
        "body": {
            "de": "Im Herbst 2019 aktiv bei Fridays for Future Hamburg.",
            "en": "Engaged with Fridays for Future Hamburg in autumn 2019.",
        },
        "image": {
            "url": "about/img/fff-hamburg.webp",
            "kind": "photo",
            "alt": {
                "de": "Klimastreik-Demonstration von Fridays for Future in Hamburg",
                "en": "Climate strike demonstration by Fridays for Future in Hamburg",
            },
        },
        "map": {
            "center": [9.9698, 53.5509],
            "zoom": 13,
            "markers": [{"lng": 9.96984145927467, "lat": 53.55087166070938}],
            "highlight_countries": [],
            "fit_bounds": False,
        },
    },
    {
        "slug": "desy",
        "title": {"de": "Praktikum bei DESY", "en": "Internship at DESY"},
        "body": {
            "de": "Juli 2021: Praktikum am Deutschen Elektronen-Synchrotron "
                  "(DESY) in Hamburg-Bahrenfeld.",
            "en": "July 2021: internship at Deutsches Elektronen-Synchrotron "
                  "(DESY) in Hamburg-Bahrenfeld.",
        },
        "image": {
            "url": "about/img/desy-logo.svg",
            "kind": "logo",
            "alt": {
                "de": "Logo des Deutschen Elektronen-Synchrotrons DESY",
                "en": "Logo of the Deutsches Elektronen-Synchrotron DESY",
            },
        },
        "map": {
            "center": [9.8794, 53.5758],
            "zoom": 13,
            "markers": [{"lng": 9.87944, "lat": 53.57583}],
            "highlight_countries": [],
            "fit_bounds": False,
        },
    },
    {
        "slug": "abitur",
        "title": {"de": "Abitur", "en": "Abitur"},
        "body": {
            "de": "2023: Abitur an der Rudolf Steiner Schule Hamburg-Nienstedten.",
            "en": "2023: Abitur at the Rudolf Steiner School Hamburg-Nienstedten.",
        },
        "image": {
            "url": "about/img/steiner-schule.webp",
            "kind": "photo",
            "alt": {
                "de": "Altbau der Rudolf Steiner Schule Hamburg-Nienstedten",
                "en": "Historic building of the Rudolf Steiner School Hamburg-Nienstedten",
            },
        },
        "map": {
            "center": [9.8566, 53.5498],
            "zoom": 13,
            "markers": [{"lng": 9.8566493, "lat": 53.5497749}],
            "highlight_countries": [],
            "fit_bounds": False,
        },
    },
    {
        "slug": "hpi",
        "title": {"de": "Studium am HPI", "en": "Studies at HPI"},
        "body": {
            "de": "Seit 2023: Studium am Hasso-Plattner-Institut in Potsdam.",
            "en": "Since 2023: studies at the Hasso Plattner Institute in Potsdam.",
        },
        "image": {
            "url": "about/img/hpi-logo.svg",
            "kind": "logo",
            "alt": {
                "de": "Logo des Hasso-Plattner-Instituts (HPI)",
                "en": "Logo of the Hasso Plattner Institute (HPI)",
            },
        },
        "map": {
            "center": [13.0597, 52.3951],
            "zoom": 12.5,
            "markers": [{"lng": 13.0596603, "lat": 52.3951124}],
            "highlight_countries": [],
            "fit_bounds": False,
        },
    },
]
