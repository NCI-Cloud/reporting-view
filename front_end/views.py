from django.shortcuts import render
from django.http import HttpResponse
from django.template import RequestContext, loader

def base(request):
    template = loader.get_template('front_end/overview.html')
    context = RequestContext(request, {
        'overview': Overview(),
    })
    return HttpResponse(template.render(context))

def project(request, project_id):
    conn = sqlite3.connect(dbfile)
    conn.row_factory = sqlite3.Row
    template = loader.get_template('front_end/project.html')
    p = Project.from_db(conn, project_id)
    p.instances_from_db(conn)
    p.get_aggregates()
    context = RequestContext(request, {
        'project': p,
    })
    return HttpResponse(template.render(context))

def index(request):
    from sqldump.models import Query
    return render(
        request,
        'front_end/index.html',
        context = {
            'preload' : ['projects'],
            'queries' : ['live_instances']
        }
    )
