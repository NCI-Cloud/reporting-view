try: # there surely is a neater way to do this...
    from django.http import HttpResponse
    from sqldump.models import Query
    from . import views
    def dump(request):
        """
        Extract sql from global string variables in views.py (those listed in
        views.QUERIES) and update Query models accordingly.
        """
        for key in views.QUERIES:
            # make sure all the listed queries are actually given in views.py
            # want to do this before meddling with the db, to make this function atomic
            if not hasattr(views, key):
                return HttpResponse('could not find query "{0}" in views'.format(key))

        # grab all the existing Query objects and make any new ones we need
        queries, new_queries, updated_queries = Query.objects.all(), [], []
        for key in views.QUERIES:
            sql = getattr(views, key)
            try:
                q = queries.get(key=key)
                if sql != q.sql:
                    q.sql = getattr(views, key)
                    updated_queries.append(q)
                q.save()
            except Query.DoesNotExist:
                # time for a new query
                q = Query(key=key, sql=sql, root='root', row='row')
                new_queries.append(q)
                q.save()

        def queries_summary(qs):
            if qs:
                return '{n} ({keys})'.format(n=len(qs), keys=', '.join(q.key for q in qs))
            else:
                return '0'

        return HttpResponse('<pre>Created: {c}\nUpdated: {u}\nTotal:   {t}</pre>'.format(
            c = queries_summary(new_queries),
            u = queries_summary(updated_queries),
            t = len(Query.objects.all()),
        ))
except ImportError:
    def dump(request):
        return HttpResponse('need sqldump app')
