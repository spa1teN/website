from modeltranslation.translator import TranslationOptions, register
from .models import Journey, Trip, TripImage, TripVideo


@register(Trip)
class TripTranslationOptions(TranslationOptions):
    fields = ("title", "subtitle", "description")


@register(Journey)
class JourneyTranslationOptions(TranslationOptions):
    fields = ("notes",)


@register(TripImage)
class TripImageTranslationOptions(TranslationOptions):
    fields = ("caption",)


@register(TripVideo)
class TripVideoTranslationOptions(TranslationOptions):
    fields = ("caption",)
