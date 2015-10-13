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

    /**
     * Boilerplate for initialising a page of reports:
     *   - ensure web storage is available
     *   - ensure auth token is set
     *   - ensure endpoint url is set
     *   - fetch data for reports described by deps, which is a list of
     *        {
     *          sel : css selector for container of report,
     *          dep : list of reports (to be requested from reporting-api) required for this section,
     *          fun : function called back after dep reports are all loaded,
     *                called as fun(sel, data) where data.x = reporting-api results for report x (for all x in dep);
     *                this function is called every time an endpoint is queried for data
     *        }
     *   - if "done" argument is specified (should be an object "f" with f.sel, f.dep and f.fun defined),
     *     set f.dep = union of f.dep, and x.dep for all x in deps
     *     and append this to deps (so done.fun will be called after everything else has been loaded)
     *     (N.B. this modifies the "deps" argument)
     */
    Util.initReport = function(deps, done) {
        if(!Util.storageAvailable('sessionStorage') || !Util.storageAvailable('localStorage')) {
            console.log('need web storage api');
            return; // TODO handle fatal error
        }
        var token = sessionStorage.getItem(Config.tokenKey);
        if(!token) {
            location.replace(Config.baseURL);
            return;
        }
        var url = localStorage.getItem(Config.endpointKey);
        if(!url || !Config.endpoints.find(function(e) { return e.url === url })) {
            // if no valid endpoint is specified, assume the user just didn't change the dropdown
            localStorage.setItem(Config.endpointKey, Config.endpoints[0].url);
        }

        if(done) {
            // concat
            done.dep = deps.reduce(function(val, x) { return val.concat(x.dep) }, done.dep);

            // remove duplicates
            done.dep = done.dep.filter(function(x, i) { return done.dep.indexOf(x) === i });

            // append to deps
            deps.push(done);
        }

        var on401 = function() {
            sessionStorage.removeItem(Config.tokenKey); // credentials no longer good, so don't keep
            sessionStorage.setItem(Config.flashKey, 'Your session has expired. Please reauthenticate.');
            location.replace(Config.baseURL);
        };
        var fetch = Fetcher(Config.endpoints, token, on401);
        fillNav(fetch);
        qdeps(fetch, deps);
        fetch(localStorage.getItem(Config.endpointKey));
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
            .on('change', function() { localStorage.setItem(Config.endpointKey, this.value); fetch(this.value) });
        var opts = slct.selectAll('option').data(Config.endpoints);
        opts.enter().append('option')
            .attr('value', function(d) { return d.url })
            .html(function(d) { return d.name });
        slct.property('value', Config.endpoints.find(function(e) { return e.url === localStorage.getItem(Config.endpointKey) }).url);

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
