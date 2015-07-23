from django import template
from django.template.defaultfilters import stringfilter

register = template.Library()

@register.filter
@stringfilter
def template_exists(t):
    # thanks to http://stackoverflow.com/a/18951166
    try:
        template.loader.get_template(t)
        return True
    except template.TemplateDoesNotExist:
        return False
