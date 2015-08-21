from django import template
from django.shortcuts import render
from django.http import Http404

# just casually using django to serve (almost) static html
def report(request, report):
    report = 'front_end/{}.html'.format(report)
    try:
        template.loader.get_template(report)
        return render(request, report)
    except template.TemplateDoesNotExist:
        raise Http404('oops')
