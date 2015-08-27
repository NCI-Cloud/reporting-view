/*
 * Example usage:
 *    var f = Fetcher()
 *      .q({ // we need key1 and key2 data to perform some_fn
 *          qks     : ['key1', 'key2'],
 *          success : some_fn,
 *          error   : another_fn,
 *        })
 *      .q({ // we need key2 data to perfom foo
 *          qks     : ['key2'],
 *          success : foo,
 *          error   : another_fn,
 *        });
 *    f(endpoint); // grab all the data from specified endpoint, making callbacks asap
 *    // now f.data(endpoint) is filled, and e.g. when foo is called, f.data(endpoint).key2 will be defined
 *    f(endpoint); // re-fetch data
 *    f(another_endpoint); // get data from another node; keeps data from first endpoint, and does not update it
 */
function Fetcher() {
    // TODO these need to be defined SOMEWHERE but idk if hard-coding them here is the Best
    // will eventually want to add some kind of abstraction for virtual endpoints, in order to define 'All nodes' endpoint with aggregation which would be defined per report
    var endpoints = [
            {
                'name' : 'Testjin', // this could maybe be served by reporting-api instead of defined here
                'url'  : 'http://130.56.247.248:9494',
            },
            {
                'name' : 'Tenjin',
                'url'  : 'http://130.56.247.245:9494',
            },
        ];
    var queue = []; // list of objects with keys: qks, success, error
    var data = endpoints.map(function(e) { return {} }); // for all i: data[i] fetched from endpoints[i]

    /// fetch data from endpoint with given name
    function fetcher(ep_name) {
        var epIdx = endpoints.findIndex(function(e) { return e.name === ep_name });
        if(epIdx === -1) {
            console.log('no endpoint ' + ep_name);
            queue.forEach(function(q) { q.error() });
            return;
        }
        
        // get rid of any old data (idk if js garbage collectors are smart but data[epIdx] could be quite large so definitely get rid of it pls)
        delete data[epIdx];
        data[epIdx] = {};

        // let everybdoy know that fetching has begun
        queue.forEach(function(q) { if(q.start) q.start() });

        // concat all dependency query keys, then filter out duplicates (topsort would be too cool)
        var qks = queue.reduce(function(val, q) { return val.concat(q.qks) }, []);
        qks = qks.filter(function(qk, i) { return qks.indexOf(qk) === i });
        qks.forEach(function(qk) { sqldump(qk, // TODO sqldump url should be endpoint-dependent (when using reporting-api)
            function(qk_data) {
                data[epIdx][qk] = qk_data;

                // check if any items in queue now have all necessary data loaded
                queue.forEach(function(q) {
                    if(!q.done && q.qks.every(function(qk) { return qk in data[epIdx] })) {
                        q.done = true;
                        q.success();
                    }
                });
            },
            function(err) {
                console.log('error (%i %s) for query "%s"', err.status, err.statusText, qk);
                queue.forEach(function(q) {
                    if(q.qks.some(function(q_qk) { return q_qk === qk })) {
                        q.error();
                    }
                });
            }
        )});
    };

    /// return data fetched from endpoint with given name
    fetcher.data = function(ep_name) {
        var epIdx = endpoints.findIndex(function(e) { return e.name === ep_name });
        if(epIdx === -1) {
            console.log('no endpoint ' + ep_name);
        } else {
            return data[epIdx];
        }
    }

    /// enqueue an object with properties:
    ///   qks     : list of qk (query key) to be fetched
    ///   success : callback after all qks are fetched;
    ///   error   : callback if fetching any qk fails
    ///   start   : callback when fetching starts (optional)
    fetcher.q = function(d) {
        if(! arguments.length) return queue;
        queue.push(d);
        return fetcher; // so we can chain Fetcher().q(d1).q(d2)...(); idk it looks cool
    }

    return fetcher;
}

// TODO use reporting-api
/// get json data from sqldump app
function sqldump(query_key, success, error) {
    if(query_key === 'live_instances') {
        // TODO want to make a live_instances view and a separate report, so this hackery becomes unnecessary
        query_key = 'instances';
        var success_o = success;
        success = function(all_instances) {
            success_o(all_instances.filter(function(ins) { return ins.deleted === 'None' })); // TODO ===null for reporting-api
        };
    } else if(query_key === 'last_updated') {
        // TODO this will be more cleanly done in the report code, not here (but keeping it here for now to avoid breaking older code)
        query_key = 'metadata';
        var success_o = success;
        success = function(metadata) {
            success_o([{timestamp : d3.min(metadata, function(m) { return Date.parse(m.ts)*0.001 /* because nromally we expect seconds, not ms */ })}]);
        };
    }
        
    jQuery.ajax({
        url : '/dump/q/' + query_key, // TODO fragile
        headers : {
            'accept' : 'application/json',
        },
        success : success,
        error : error != undefined ? error : function(data) {
            console.log("Couldn't get sqldump for key '"+query_key+"'");
        },
    });
}
