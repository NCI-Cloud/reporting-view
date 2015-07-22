from django.conf.urls import url

from . import views
from . import sqldump

urlpatterns = [
    url(r'^$', views.base, name="base"),
    url(r'^project/(?P<project_id>[0-9a-z-]*)', views.project, name="project"),
    url(r'^dump/', sqldump.dump, name='dump'),
]
