var Util = {};
(function() {
    var callbacks = function(sel, callback) {
        var s = d3.select(sel);
        return {
            start : function() {
                s.classed('loading', true);
            },
            success : function() {
                d3.select(sel).classed('loading', false);
                callback(sel);
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
})();
