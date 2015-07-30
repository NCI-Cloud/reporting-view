from django.conf.urls import url

from . import views
from . import sqldump

urlpatterns = [
    url(r'^$', views.index),
    url(r'^dump/', sqldump.dump, name='dump'),
]
