/*
 * Example usage:
 *    var f = Fetcher('http://reporting-api-endpoint:1234', token)
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
 *    f(); // grab all the data
 */
function Fetcher(ep, token, on401) { // "unauthorised" gets special mention because it is a status we always handle the same way (namely, asking user to re-authenticate, assuming token has expired)
    var endpoint = ep; // reporting-api base url
    var queue = []; // list of objects with keys: qks, success, error

    /// fetch data
    function fetcher() {
        var data = {};

        // let everybdoy know that fetching has begun
        queue.forEach(function(q) {
            q.done = false;
            if(q.start) q.start();
        });

        // concat all dependency query keys, then filter out duplicates (topsort would be too cool)
        var qks = queue.reduce(function(val, q) { return val.concat(q.qks) }, []);
        qks = qks.filter(function(qk, i) { return qks.indexOf(qk) === i });
        qks.forEach(function(qk, i) {
            sqldump(
                endpoint,
                qk,
                function(qk_data) {
                    data[qk] = qk_data;

                    // check if any items in queue now have all necessary data loaded
                    queue.forEach(function(q) {
                        if(!q.done && q.qks.every(function(qk) { return qk in data })) {
                            q.done = true;
                            var deps = {};
                            q.qks.forEach(function(qk) {
                                deps[qk] = data[qk];
                            });
                            q.success(deps);
                        }
                    });
                },
                function(error) {
                    if(error.status === 401) on401();
                    console.log('Error (%i %s) for query "%s"', error.status, error.statusText, qk);
                    queue.forEach(function(q) {
                        if(q.qks.some(function(q_qk) { return q_qk === qk })) {
                            q.error();
                        }
                    });
                }
            );
        });
    };

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
    var sqldump = function(ep, qk, success, error) {
        d3.json(ep + '/v1/reports/' + qk)
            .header('x-auth-token', token)
            .on('load', success)
            .on('error', error)
            .get();
    };

    return fetcher;
}
