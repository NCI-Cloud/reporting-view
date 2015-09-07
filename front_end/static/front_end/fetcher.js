/*
 * Example usage:
 *    var f = Fetcher([{name:'endpoint1',url:'whatever'}, {name:'endpoint2',url:'something'}])
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
 *    f('endpoint1'); // grab all the data from endpoint1, making callbacks asap
 *    // now f.data('endpoint1') is filled, and e.g. when foo is called, f.data('endpoint1').key2 will be defined
 *    f('endpoint1'); // re-fetch data
 *    f('endpoint2'); // get data from another node; keeps data from first endpoint, and does not update it
 */
function Fetcher(eps) {
    var endpoints = eps; // list of objects with keys: name, url
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
        queue.forEach(function(q) {
            q.done = false;
            if(q.start) q.start();
        });

        // concat all dependency query keys, then filter out duplicates (topsort would be too cool)
        var qks = queue.reduce(function(val, q) { return val.concat(q.qks) }, []);
        qks = qks.filter(function(qk, i) { return qks.indexOf(qk) === i });
        qks.forEach(function(qk, i) {
            sqldump(epIdx, qk,
                function(qk_data) {
                    data[epIdx][qk] = qk_data;

                    // check if any items in queue now have all necessary data loaded
                    queue.forEach(function(q) {
                        if(!q.done && q.qks.every(function(qk) { return qk in data[epIdx] })) {
                            q.done = true;
                            var deps = {};
                            q.qks.forEach(function(qk) {
                                deps[qk] = data[epIdx][qk];
                            });
                            q.success(deps);
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
            );
        });
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

    /// retrieve json data
    var sqldump = function(epIdx, qk, success, error) {
        if(qk === 'live_instance') {
            // TODO want to make a live_instances view and a separate report, so this hackery becomes unnecessary
            qk = 'instance';
            var success_o = success;
            success = function(all_instances) {
                success_o(all_instances.filter(function(ins) { return ins.deleted === (endpoints[epIdx].name==='sqldump'?'None':null)}));
            };
        } else if(qk === 'last_updated') {
            // TODO this will be more cleanly done in the report code, not here (but keeping it here for now to avoid breaking older code)
            qk = 'metadata';
            var success_o = success;
            success = function(metadata) {
                success_o([{timestamp : d3.min(metadata, function(m) { return Date.parse(m.last_update)*0.001 /* because normally we expect seconds, not ms */ })}]);
            };
        }

        var url = endpoints[epIdx].url + (endpoints[epIdx].name === 'sqldump' ? '/q/' : '/v1/reports/') + qk; // fragile

        jQuery.ajax({
            url : url,
            headers : {
                'accept' : 'application/json',
            },
            success : success,
            error : error != undefined ? error : function(data) {
                console.log("Couldn't get sqldump for key '"+qk+"'");
            },
        });
    };

    return fetcher;
}
