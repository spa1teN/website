from django import template

register = template.Library()


@register.simple_tag(takes_context=True)
def t(context, de, en, fi=None):
    """Return the string matching the current request language (de/en/fi)."""
    lang = context.get("LANG")
    if lang == "en":
        return en
    if lang == "fi":
        return fi if fi is not None else en
    return de
