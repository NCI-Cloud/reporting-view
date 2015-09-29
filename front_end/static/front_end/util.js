var Util = {};
(function() {
    var callbacks = function(sel, callback) {
        var s = d3.select(sel);
        return {
            start : function() {
                d3.select(sel).classed('error', false);
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

    Util.initReport = function(deps) {
        if(!Util.storageAvailable('sessionStorage')) {
            console.log('need web storage api');
            return; // TODO handle fatal error
        }
        var token = sessionStorage.getItem('token');
        if(!token) {
            location.replace(Config.baseURL);
            return;
        }
        var fetch = Fetcher(Config.endpoints, token);
        fillNav(fetch);
        qdeps(fetch, deps);
        fetch(Config.defaultEndpoint);
    }

    var qdeps = function(fetch, deps) {
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

    var fillNav = function(fetch) {
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
            .attr('class', function(d) { return location.pathname.endsWith(d.url) ? 'current' : '' })
          .append('a')
            .attr('href', function(d) { return Config.baseURL + d.url })
            .html(function(d) { return d.name });
    };

    /// check if browser supports web storage api
    /// courtesy of https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API
    Util.storageAvailable = function(type) {
        try {
            var storage = window[type],
                x = '__storage_test__';
            storage.setItem(x, x);
            storage.removeItem(x);
            return true;
        }
        catch(e) {
            return false;
        }
    };
})();
