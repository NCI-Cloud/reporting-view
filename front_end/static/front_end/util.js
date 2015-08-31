var Util = {};
(function() {
    var callbacks = function(sel, callback) {
        var s = d3.select(sel);
        return {
            start : function() {
                s.classed('loading', true);
            },
            success : function(data) {
                d3.select(sel).classed('loading', false);
                callback(sel, data);
            },
            error : function() {
                d3.select(sel).classed('loading', false);
                d3.select(sel).classed('error', true);
            },
        };
    };

    Util.qdeps = function(fetch, deps) {
        deps.forEach(function(dep) {
            var on = callbacks(dep.sel, dep.fun);
            fetch.q({
                qks     : dep.dep,
                start   : on.start,
                success : on.success,
                error   : on.error,
            });
        });
    };

    Util.fillNav = function(fetch) {
        var nav = d3.select('nav');

        // make endpoints dropdown
        var slct = nav.select('select')
            .on('change', function() { fetch(this.value) });
        var opts = slct.selectAll('option').data(Config.endpoints);
        opts.enter().append('option')
            .attr('value', function(d) { return d.name })
            .html(function(d) { return d.name });
        slct.property('value', Config.endpoints.find(function(e) { return e.name === Config.defaultEndpoint }).name);

        // make nav links
        var ul = nav.select('ul');
        var li = ul.selectAll('li').data(Config.reports);
        li.enter().append('li')
            .attr('class', function(d) { return d.url === location.pathname ? 'current' : '' })
          .append('a')
            .attr('href', function(d) { return d.url })
            .html(function(d) { return d.name });
    };
})();
