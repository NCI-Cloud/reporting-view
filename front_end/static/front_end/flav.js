var Report = {}; // TODO should this only show flavours with public=1? (or should this be done at db level?)
(function($) { // TODO remove jquery dependency by rewriting sqldump

// array of
//    sel : selector for applying loading/error classes
//    dep : sqldump keys for required data (will be stored in g[key]
//    fun : function to call after all dep data loaded (will be called with deps element as argument)
var deps = [
    {
        sel : '.flavs',
        dep : ['flavours'],
        fun : report_flavs,
    },
    {
        sel : '.hypervisors',
        dep : ['hypervisors', 'live_instances', 'flavours'],
        fun : report_list,
    },
    {
        sel : '.footer',
        dep : ['last_updated'],
        fun : report_footer,
    },
];
var g = {};

var res = [
    {
        key : 'vcpus',
        format : function(u) { return u },
        accessor : {
            instances   : function(ins) { return +ins.vcpus },
            hypervisors : function(hyp) { return +hyp.cpus },
            flavours    : function(fla) { return +fla.vcpus },
        },
    },
    {
        key : 'memory',
        format : function(d) { return Formatters.si_bytes(d*1024*1024) },
        accessor : {
            instances   : function(ins) { return +ins.memory },
            hypervisors : function(hyp) { return +hyp.memory },
            flavours    : function(fla) { return +fla.memory },
        },
    },
    {
        key : 'disk',
        format : function(d) { return Formatters.si_bytes(d*1024*1024*1024) },
        accessor : {
            instances   : function(ins) { return (+ins.root) + (+ins.ephemeral) },
            hypervisors : function(hyp) { return +hyp.local_storage },
            flavours    : function(fla) { return (+fla.root) + (+fla.ephemeral) },
        },
    },
];

Report.init = function() {
    // concat all dependency query keys, then filter out duplicates (topsort would be too cool)
    var dep_keys = deps.reduce(function(val, dep) { return val.concat(dep.dep); }, []);
    dep_keys = dep_keys.filter(function(dep, i) { return dep_keys.indexOf(dep)==i; });
    deps.forEach(function(dep) { d3.select(dep.sel).classed('loading', true); });
    dep_keys.forEach(function(key) { sqldump(key,
        // get all preload data, then call success
        function(data) {
            g[key] = data;

            // check if any new report functions can now be called
            // TODO not sure if a race condition is possible here in js (single-threaded execution should be ok)
            deps.forEach(function(dep) {
                if(!dep.done && dep.dep.every(function(k) { return k in g; })) {
                    dep.done = true;
                    dep.fun(dep);
                    d3.select(dep.sel).classed('loading', false);
                }
            });
        },
        function(err) {
            // error
            deps.forEach(function(dep) {
                if(dep.dep.indexOf(key) != -1) {
                    d3.select(dep.sel).classed('loading', false);
                    d3.select(dep.sel).classed('error', true);
                    console.log('error (%i %s) for query "%s"', err.status, err.statusText, key);
                }
            });
        }
    )});
}

var dispatch = d3.dispatch('flavChanged');

// get json data from sqldump app
function sqldump(query_key, success, error) {
    $.ajax({
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

function report_flavs(dep) {
    var s = d3.select(dep.sel);

    // generate <select> for controlling pie
    var slct = s.select('select') // "select" is a word overused yet reserved
        .on('change', function() { dispatch.flavChanged(dep.sel, this.value); });
    slct.selectAll('option')
        .data(g.flavours)
      .enter().append('option')
        .attr('value', function(d) { return d.id; })
        .text(function(d) { return d.name; })

    var sumHeight = 50; // pixels
    var sum = s.select('.summary').style('height', sumHeight+'px');
    var sumScale = res.map(function(r) {
        return d3.scale.linear().domain([0, d3.max(g.flavours, r.accessor.flavours)]).range([0, sumHeight]);
    });

    dispatch.on('flavChanged.'+dep.sel, function(sel, fid) {
        var data = [];
        var f = g.flavours.find(function(f){return f.id==fid});
        if(f) {
            data = res.map(function(r) { return r.accessor.flavours(f) });
        }
        var span = sum.selectAll('div').data(data);
        span.enter().append('div');
        span
            .html(function(d, i) { return '<span title="'+res[i].key+'">'+res[i].format(d)+'</span>'; });
        span.transition()
            .style('height', function(d, i) { return sumScale[i](d)+'px' });
        span.exit().transition().style('height', '0px').remove();
    });
}

function report_list(dep) {
    var s = d3.select(dep.sel);

    // TODO join hypervisors and live_instances
    var data = g.hypervisors.map(function(ins) { // shallow copy of g.hypervisors
        var ret = {};
        for(var k in ins) {
            ret[k] = ins[k];
        }
        return ret;
    });

    res.forEach(function(r) {
        r.max = g.hypervisors.reduce(function(val, hyp) { return Math.max(val, r.accessor.hypervisors(hyp)) }, 0);
    });

    data.forEach(function(d) {
        d.instances = [];
        var running_total = res.map(function() { return 0 });
        while(true) {
            var f = g.flavours[Math.floor(Math.random()*g.flavours.length)];
            for(var i=0; i<res.length; i++) {
                if(running_total[i] + res[i].accessor.flavours(f) > res[i].accessor.hypervisors(d)) {
                    // can't fit an instance of this flavour! oh noes
                    d._allocated = running_total;
                    return; // proceed to next iteration of forEach
                }
            }
            d.instances.push({flavour : f.id}); // yes that is an instance i just pushed, and also icr if it's f.id or f.uuid
            for(var i=0; i<res.length; i++) {
                running_total[i] += res[i].accessor.flavours(f);
            }
        }
    });

    var sortKey = res[0].key, sortOrder = d3.descending;
    var sortAccessor = {'capacity' : function(d) { return +d._capacity }, 'hostname' : function(d) { return d.hostname }};
    res.forEach(function(r, i) {
        sortAccessor[r.key] = function(d) { return +d._allocated[i] };
    });

    var rowHeight = 30; //px, has to match some stuff in flav.css
    var container = s.select('div.list');
    container.style('height', g.hypervisors.length * rowHeight + 'px');

    var row = container.selectAll('div')
        .data(data);

    row.enter()
      .append('div')
        .attr('class', 'hypervisor')
        .on('mouseover', function() { d3.select(this).classed('selected', true) })
        .on('mouseout',  function() { d3.select(this).classed('selected', false) });
    row
        .html(function(d) { return '<span class="capacity"></span><span class="hostname">'+d.hostname+'</span>' })
        .style('top', function(_, i) { return i*rowHeight+'px' });

    var resources = row.append('div')
        .attr('class', 'resources');
    var header = s.select('.controls .resources');
    s.selectAll('.controls span').on('click', function() { sortBy(this.className) });
    res.forEach(function(r, i) {
        resources.append('div')
            .attr('class', r.key)
          .append('div')
            .attr('class', 'bar')
            .style('width', function(d) { return r.accessor.hypervisors(d)/r.max*100+'%' })
          .append('div')
            .html(function(d) { return r.format(d._allocated[i]) })
            .style('width', function(d) { return d._allocated[i]/r.accessor.hypervisors(d)*100+'%' }); // could use a d3 scale for this, but can't be bothered
        header.append('div')
            .attr('class', r.key)
            .html(r.key)
            .on('click', function() { sortBy(this.className); });
    });

    var sortBy = function(key, order) {
        if(order !== undefined) sortOrder = order;
        else if(sortKey === key) sortOrder = sortOrder === d3.ascending ? d3.descending : d3.ascending;
        sortKey = key;

        var s = sortAccessor[sortKey];

        data
            .sort(function(a, b) { return sortOrder(s(a), s(b)); })
            .forEach(function(d, i) { d.index = i });

        row.transition()
            .style('top', function(d) { return d.index*rowHeight+'px' });
    };

    dispatch.on('flavChanged.'+dep.sel, function(sel, fid) {
        var f = g.flavours.find(function(f){return f.id==fid});
        d3.selectAll('.deselected').classed('deselected', false);
        if(f) {
            var tot = 0;
            data.forEach(function(d) {
                var cap = Infinity; // TODO d3.min
                res.forEach(function(r, i) {
                    var remaining = r.accessor.hypervisors(d) - d._allocated[i];
                    cap = Math.min(cap, Math.floor(remaining / r.accessor.flavours(f)));
                });
                if(cap === Infinity) cap = null;
                d._capacity = cap;
                tot += cap;
            });

            row.each(function(d) {
                var t = d3.select(this);
                t.select('.capacity').html(d._capacity);
                if(d._capacity === 0) t.classed('deselected', true);
            });

            d3.select('.sum').html('Total capacity: ' + tot + ' instance' + (tot==1?'':'s'));

            sortBy('capacity', d3.descending);
        } else {
            // no flavour selected
            row.selectAll('.capacity').html('');
            d3.select('.sum').html('');
        }
    });
}

function report_footer(dep) {
    var s = d3.select(dep.sel);

    if(g.last_updated.length == 0) {
        // panic
        s.classed('error', true);
        return;
    }
    s.select('.date').html(humanize.relativeTime(g.last_updated[0].timestamp));
    s.append('p')
      .append('a')
        .html('Update now')
        .on('click', function() {
            sqldump('update', function() {
                location.reload();
            });
         });
}

})(jQuery);
