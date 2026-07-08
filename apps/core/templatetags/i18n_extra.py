from django import template

register = template.Library()


@register.simple_tag(takes_context=True)
def t(context, de, en):
    """Return `en` if the current request language is English, else `de`."""
    return en if context.get("LANG") == "en" else de
