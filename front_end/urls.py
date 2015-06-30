from django.conf.urls import url

from . import views

urlpatterns = [
	url(r'^$', views.base, name="base"),
	url(r'^project/(?P<project_id>[0-9a-z-]*)', views.project, name="project"),
]
