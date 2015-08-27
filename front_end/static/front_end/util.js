var Util = {};
(function() {
    reportStart = function(sel) {
        return function() {
            if(sel) d3.select(sel).classed('loading', true);
        };
    };
    reportSuccess = function(sel, callback) {
        return function() {
            if(sel) d3.select(sel).classed('loading', false);
            callback(sel);
        };
    };
    reportError = function(sel) {
        return function() {
            if(sel) d3.select(sel).classed('loading', false);
            if(sel) d3.select(sel).classed('error', true);
        };
    };
    Util.qdeps = function(fetch, deps) {
        deps.forEach(function(dep) {
            fetch.q({
                qks     : dep.dep,
                start   : reportStart(dep.sel),
                success : reportSuccess(dep.sel, dep.fun),
                error   : reportError(dep.sel),
            });
        });
    };
})();
