from django import template

register = template.Library()


@register.simple_tag(takes_context=True)
def t(context, de, en):
    """Return the string matching the current request language (de/en)."""
    lang = context.get("LANG")
    if lang == "en":
        return en
    return de
