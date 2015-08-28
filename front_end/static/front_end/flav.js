var Report = {};
(function() {

/// reference to data from current endpoint
var g = {};

/// event broadcasting
var dispatch = d3.dispatch('flavChanged');

/// resources associated with flavours
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

// TODO refactor to avoid duplicating this code between reports
Report.init = function() {
    var fetch = Fetcher(Config.endpoints);
    Util.fillNav(fetch);
    Util.qdeps(fetch, [
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
            sel : '.historical',
            dep : ['instances'],
            fun : report_historical,
        },
        {
            sel : '.footer',
            dep : ['last_updated'],
            fun : report_footer,
        },
    ]);
    var ep_name = Config.defaultEndpoint;
    fetch(ep_name);
    g = fetch.data(ep_name)
}

function report_flavs(sel) {
    var s = d3.select(sel);

    // generate <select> for controlling pie
    var slct = s.select('select') // "select" is a word overused yet reserved
        .on('change', function() { var fid = this.value; dispatch.flavChanged(sel, g.flavours.find(function(f){ return f.id==fid })); });
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

    dispatch.on('flavChanged.'+sel, function(sel, f) {
        var data = [];
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

function report_list(sel) {
    var s = d3.select(sel);

    // TODO join hypervisors and live_instances
    var data = g.hypervisors.map(function(ins) { // shallow copy of g.hypervisors
        var ret = {};
        for(var k in ins) {
            ret[k] = ins[k];
        }
        ret._allocated = res.map(function() { return 0 });
        return ret;
    });

    resMax = res.map(function(r) { return d3.max(g.hypervisors, r.accessor.hypervisors); });

    g.live_instances.forEach(function(ins) {
        // assume that instances.hypervisor matches substr of hypervisors.hostname from start to before '.'
        var hyp = data.find(function(h) {
            var dIdx = h.hostname.indexOf('.');
            return ins.hypervisor === (dIdx === -1 ? h.hostname : h.hostname.substr(0, dIdx));
        });
        if(hyp) {
            res.forEach(function(r, i) {
                hyp._allocated[i] += r.accessor.instances(ins);
            });
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
            .style('width', function(d) { return r.accessor.hypervisors(d)/resMax[i]*100+'%' })
          .append('div')
            .html(function(d) { return r.format(d._allocated[i]) })
            .style('width', function(d) { return d._allocated[i]/r.accessor.hypervisors(d)*100+'%' }) // could use a d3 scale for this, but can't be bothered
            .attr('class', function(d) { return d._allocated[i] > r.accessor.hypervisors(d) ? 'oversubscribed' : '' });
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

    dispatch.on('flavChanged.'+sel, function(sel, f) {
        d3.selectAll('.deselected').classed('deselected', false);
        if(f) {
            var tot = 0;
            data.forEach(function(d) {
                var cap = Infinity;
                res.forEach(function(r, i) {
                    var remaining = Math.max(0, r.accessor.hypervisors(d) - d._allocated[i]);
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

function report_historical(sel) {
    var s = d3.select(sel);
    dispatch.on('flavChanged.'+sel, function(_, f) {
        console.log('draw chart for flav %o', f);
    });
}

function report_footer(sel) {
    if(g.last_updated.length == 0) {
        // panic
        d3.select(sel).classed('error', true);
        return;
    }
    d3.select(sel).select('.date').html(humanize.relativeTime(g.last_updated[0].timestamp));
}

})();
