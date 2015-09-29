var Report = {};
(function() {

/// event broadcasting
var dispatch = d3.dispatch('flavChanged');

/// resources associated with flavours
var res = [
    {
        key : 'vcpus',
        format : function(u) { return u },
        accessor : {
            instance   : function(ins) { return +ins.vcpus },
            hypervisor : function(hyp) { return +hyp.cpus },
            flavour    : function(fla) { return +fla.vcpus },
        },
    },
    {
        key : 'memory',
        format : function(d) { return Formatters.si_bytes(d*1024*1024) },
        accessor : {
            instance   : function(ins) { return +ins.memory },
            hypervisor : function(hyp) { return +hyp.memory },
            flavour    : function(fla) { return +fla.memory },
        },
    },
    {
        key : 'disk',
        format : function(d) { return Formatters.si_bytes(d*1024*1024*1024) },
        accessor : {
            instance   : function(ins) { return (+ins.root) + (+ins.ephemeral) },
            hypervisor : function(hyp) { return +hyp.local_storage },
            flavour    : function(fla) { return (+fla.root) + (+fla.ephemeral) },
        },
    },
];

Report.init = function() {
    Util.initReport([
        {
            sel : '.flavs',
            dep : ['flavour'],
            fun : report_flavs,
        },
        {
            sel : '.hypervisors',
            dep : ['hypervisor', 'live_instance', 'flavour'],
            fun : report_list,
        },
        {
            sel : '.footer',
            dep : ['last_updated'],
            fun : report_footer,
        },
    ]);
};

function report_flavs(sel, g) {
    var s = d3.select(sel);

    // generate <select> for controlling pie
    var slct = s.select('select') // "select" is a word overused yet reserved
        .on('change', function() { var fid = this.value; dispatch.flavChanged(sel, g.flavour.find(function(f){ return f.id==fid })); });
    var opts = slct.selectAll('option').data(g.flavour);
    opts.enter().append('option');
    opts
        .attr('value', function(d) { return d.id; })
        .text(function(d) { return d.name; });
    opts.exit().remove();
    dispatch.flavChanged(sel, null);

    var sumHeight = 50; // pixels
    var sum = s.select('.summary').style('height', sumHeight+'px');
    var sumScale = res.map(function(r) {
        return d3.scale.linear().domain([0, d3.max(g.flavour, r.accessor.flavour)]).range([0, sumHeight]);
    });

    dispatch.on('flavChanged.'+sel, function(sel, f) {
        var data = [];
        if(f) {
            data = res.map(function(r) { return r.accessor.flavour(f) });
            // TODO set <option selected>
        } else {
            // TODO pick "select flavour" option
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

function report_list(sel, g) {
    var s = d3.select(sel);

    // TODO join hypervisors and live_instances
    var data = g.hypervisor.map(function(ins) { // shallow copy of g.hypervisor
        var ret = {};
        for(var k in ins) {
            ret[k] = ins[k];
        }
        ret._allocated = res.map(function() { return 0 });
        return ret;
    });

    resMax = res.map(function(r) { return d3.max(g.hypervisor, r.accessor.hypervisor); });

    g.live_instance.forEach(function(ins) {
        // assume that instance.hypervisor matches substr of hypervisor.hostname from start to before '.'
        var hyp = data.find(function(h) {
            var dIdx = h.hostname.indexOf('.');
            return ins.hypervisor === (dIdx === -1 ? h.hostname : h.hostname.substr(0, dIdx));
        });
        if(hyp) {
            res.forEach(function(r, i) {
                hyp._allocated[i] += r.accessor.instance(ins);
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
    container.style('height', g.hypervisor.length * rowHeight + 'px');

    var row = container.selectAll('div.hypervisor')
        .data(data);

    row.enter()
      .append('div')
        .attr('class', 'hypervisor')
        .on('mouseover', function() { d3.select(this).classed('selected', true) })
        .on('mouseout',  function() { d3.select(this).classed('selected', false) });
    row
        .html(function(d) { return '<span class="capacity"></span><span class="hostname">'+d.hostname+'</span>' })
        .style('top', function(_, i) { return i*rowHeight+'px' });
    row.exit().remove();

    var resources = row.append('div')
        .attr('class', 'resources');
    var header = s.select('.controls .resources');
    s.selectAll('.controls span');
    var h = header.selectAll('div').data(res);
    h.enter().append('div')
        .attr('class', function(d) { return d.key })
        .html(function(d) { return d.key })
        .on('click', function() { sortBy(this.className) });

    // TODO is there a bug here?
    // i'd have thought that this code would never clean up the <div>s it creates,
    // so flicking between endpoints would result in 3, 6, 9... resources.
    // but this doesn't acutally seem to happen so what is going on
    res.forEach(function(r, i) {
        resources.append('div')
            .attr('class', r.key)
          .append('div')
            .attr('class', 'bar')
            .style('width', function(d) { return r.accessor.hypervisor(d)/resMax[i]*100+'%' })
          .append('div')
            .html(function(d) { return r.format(d._allocated[i]) })
            .style('width', function(d) { return d._allocated[i]/r.accessor.hypervisor(d)*100+'%' }) // could use a d3 scale for this, but can't be bothered
            .attr('class', function(d) { return d._allocated[i] > r.accessor.hypervisor(d) ? 'oversubscribed' : '' });
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
                    var remaining = Math.max(0, r.accessor.hypervisor(d) - d._allocated[i]);
                    cap = Math.min(cap, Math.floor(remaining / r.accessor.flavour(f)));
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

function report_footer(sel, g) {
    if(g.last_updated.length == 0) {
        // panic
        d3.select(sel).classed('error', true);
        return;
    }
    d3.select(sel).select('.date').html(humanize.relativeTime(g.last_updated[0].timestamp));
}

})();
