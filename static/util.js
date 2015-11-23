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
     * Handle 401 (from reporting-api) by assuming token has expired, and
     * prompting user to re-authenticate.
     *
     * This process cannot be automated because authentication via AAF is
     * an interactive process.
     */
    Util.on401 = function() {
        sessionStorage.removeItem(Config.tokenKey); // credentials no longer good, so don't keep
        sessionStorage.setItem(Config.flashKey, 'Your session has expired. Please reauthenticate.');
        location.replace(Config.baseURL);
    };

    /**
     * Boilerplate for initialising a page of reports:
     *   - ensure web storage is available
     *   - ensure auth token is set
     *   - fetch data for reports described by deps, which is a list of
     *        {
     *          sel : css selector for container of report,
     *          dep : list of reports (to be requested from reporting-api) required for this section,
     *          fun : function called back after dep reports are all loaded,
     *                called as fun(sel, data) where data.x = reporting-api results for report x (for all x in dep);
     *                this function is called every time the endpoint is queried for data
     *        }
     *   - if "done" argument is specified (should be an object "f" with f.sel, f.dep and f.fun defined),
     *     set f.dep = union of f.dep, and x.dep for all x in deps
     *     and append this to deps (so done.fun will be called after everything else has been loaded)
     *     (N.B. this modifies the "deps" argument)
     */
    Util.initReport = function(deps, done) {
        var token = sessionStorage.getItem(Config.tokenKey);
        if(!token) {
            location.replace(Config.baseURL);
            return;
        }

        if(done) {
            // concat
            done.dep = deps.reduce(function(val, x) { return val.concat(x.dep) }, done.dep);

            // remove duplicates
            done.dep = done.dep.filter(function(x, i) { return done.dep.indexOf(x) === i });

            // append to deps
            deps.push(done);
        }

        var fetch = Fetcher(Config.endpoint, token, Util.on401);

        // before any reporting can be done, the list of availability zones must be fetched
        // so that node-level filtering can be done on any subsequent data
        var selector = '#az'; // gross hard-coded string, what can ya do
        var on = callbacks(selector, function(_, g) {
            fetch.clear(); // empty queue, to avoid infinite loop

            // populate the list of AZs, then queue and fetch everything else
            fillNodes(selector, g.hypervisor, fetch);
            qdeps(fetch, deps);
            fetch();
        });
        fetch.q({
            qks     : ['hypervisor'],
            start   : on.start,
            success : on.success,
            error   : on.error,
        })();
        fillNav(fetch);
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

    /**
     * Populate div#az select with availability zones.
     * Is this just the currently used one? or will it (preferably) use fetch to fill all?
     */
    var fillNodes = function(sel, hyp, fetch) {
        var s = d3.select(sel);

        // extract all availability zones
        var azs = hyp.map(function(h) {
            var i = h.availability_zone.indexOf('!'); // only care about top level cell in az, not subcell
            return i === -1 ? h.availability_zone : h.availability_zone.substr(0, i);
        });
        azs = azs
            .filter(function(az, i) { return azs.indexOf(az) === i }) // filter unique
            .sort();
        azs.unshift(''); // add empty entry for "all nodes" (using null sounds better, but <option value=null> isn't a thing

        // generate <select>
        var slct = s.select('select');
        if(slct.empty()) return; // no node-level filter on this report
        slct.on('change', function() { localStorage.setItem(Config.nodeKey, this.value); fetch.call() });
        var opt = slct.selectAll('option').data(azs);
        opt.enter().append('option');
        opt.exit().remove();
        opt
            .attr('value', function(az) { return az || '' })
            .text(function(az) { return az || 'All' });
        slct.property('value', localStorage.getItem(Config.nodeKey));
    };

    var fillNav = function(fetch) {
        var nav = d3.select('nav');

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
