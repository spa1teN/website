"""Bridge nginx REMOTE-USER header into Django's RemoteUserBackend.

nginx basic-auth sets the ``Remote-User`` HTTP header. Django's built-in
``RemoteUserMiddleware`` expects ``REMOTE_USER`` in ``request.META``, not
``HTTP_REMOTE_USER`` (the WSGI-mangled form of the header). This middleware
copies the header into the key Django expects, so the standard auth machinery
works without subclassing.
"""


class NginxRemoteUserMiddleware:
    """Copy ``HTTP_REMOTE_USER`` → ``REMOTE_USER`` in ``request.META``.

    Must be placed BEFORE ``django.contrib.auth.middleware.RemoteUserMiddleware``
    in the MIDDLEWARE list.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        remote = request.META.get("HTTP_REMOTE_USER")
        if remote:
            request.META["REMOTE_USER"] = remote
        return self.get_response(request)


from django.contrib.auth.middleware import RemoteUserMiddleware as _BaseRemoteUserMiddleware


class PersistentRemoteUserMiddleware(_BaseRemoteUserMiddleware):
    """Like RemoteUserMiddleware but does NOT log out when the header is absent.

    Django's default ``RemoteUserMiddleware.force_logout_if_no_header = True``
    removes the authenticated user on every request that lacks the
    ``REMOTE_USER`` header — i.e. on all public pages.  This subclass keeps
    the session alive so admin buttons are visible everywhere once the user has
    authenticated via nginx basic-auth on a protected path.
    """

    force_logout_if_no_header = False


from django.utils import translation as dj_translation


class SessionLanguageMiddleware:
    """Activate django-modeltranslation language from the session ``lang`` key.

    Placed after ``SessionMiddleware`` so ``request.session`` is available.
    Calls ``translation.activate(lang)`` to make ``obj.translated_field``
    return the visitor's chosen language, then deactivates after the response.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        lang = request.session.get("lang", "de")
        if lang not in ("de", "en", "fi"):
            lang = "de"
        dj_translation.activate(lang)
        response = self.get_response(request)
        dj_translation.deactivate()
        return response
