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

def login(request):
    print(request.POST)
    context = {}
    k = 'some key identifying the returned keystone token' # TODO find out what this is once rcshibboleth return-path works
    if k in request.POST:
        context['token'] = request.POST[k]
    return render(request, 'front_end/login.html', context)
