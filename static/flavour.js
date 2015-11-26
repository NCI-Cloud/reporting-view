var Flavour = {};
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

Flavour.init = function() {
    Util.initReport([
        {
            sel : '.flavs',
            dep : ['flavour'],
            fun : report_flavs,
        },
        {
            sel : '.hypervisors',
            dep : ['hypervisor', 'instance?active=1', 'flavour'],
            fun : report_list,
        },
    ], {
        sel : 'footer',
        dep : ['metadata'],
        fun : footer,
    });
};

function report_flavs(sel, g) {
    // relabel
    var flavour = g.flavour;
    var s = d3.select(sel);

    var slct = s.select('select.flavours') // "select" is a word overused yet reserved
        .on('change', function() { var fid = this.value; dispatch.flavChanged(sel, g.flavour.find(function(f){ return f.id==fid })); });
    var makeSelect = function() {
        // show just m2 range, or all?
        var flavs;
        if(s.select('.allflav input').property('checked')) {
            flavs = flavour.filter(function() { return true }); // shallow copy for sorting
            flavs.sort(function(a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0 }); // sort lexicographically
        } else {
            flavs = flavour.filter(function(f) { return f.name.indexOf('m2.')===0 });
            flavs.sort(function(a, b) { return a.vcpus - b.vcpus }); // sort by vcpus
        }

        // remove any old placeholders before doing data join
        slct.selectAll('option[disabled]').remove();

        // create <option>s
        var opts = slct.selectAll('option').data(flavs);
        opts.enter().append('option');
        opts
            .attr('value', function(d) { return d.id; })
            .text(function(d) { return d.name; });
        opts.exit().remove();

        // add placeholder for no project selected
        slct.insert('option', 'option')
            .attr('value', '')
            .attr('disabled', '')
            .attr('selected', '')
            .style('display', 'none')
            .text('Select flavour...');

        // the value of the <select> has been reset, so reset anything that might use it
        dispatch.flavChanged(sel, null);
    };
    makeSelect();
    s.select('.allflav input').on('change', makeSelect);

    var sumHeight = 50; // pixels
    var sum = s.select('.summary').style('height', sumHeight+'px');
    var sumScale = res.map(function(r) {
        return d3.scale.linear().domain([0, d3.max(flavour, r.accessor.flavour)]).range([0, sumHeight]);
    });

    dispatch.on('flavChanged.'+sel, function(sel, f) {
        var data = [];
        if(f) {
            data = res.map(function(r) { return r.accessor.flavour(f) });
            slct.property('value', f.id);
        } else {
            slct.property('value', ''); // select hidden 'Select flavour...' placeholder
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
    // relabel for convenience
    var s = d3.select(sel);
    var instance = g['instance?active=1'];
    var hypervisor = g.hypervisor;

    // filter by availability zone
    var az = localStorage.getItem(Config.nodeKey);
    hypervisor = hypervisor.filter(function(h) { return h.availability_zone.indexOf(az) === 0 });
    // (don't really need to filter instance; won't show any instances belonging to filtered-out hypervisors)

    // make shallow copy of hypervisor array, with additional:
    //   _allocated array corresponding to global "res"
    //   _trimmed   substring of hostname, before first '.' ("cn34.qld.nectar.org.au" -> "cn34")
    var trimmed = {}; // to make sure _trimmed are all unique...
    var data = hypervisor
        .map(function(hyp) {
            // copy all hypervisor attributes
            var ret = {};
            for(var k in hyp) {
                ret[k] = hyp[k];
            }

            // trim hypervisor names
            ret._trimmed = hyp.hostname;
            var i = ret._trimmed.indexOf('.');
            if(i > -1) ret._trimmed = ret._trimmed.substr(0, i);
            if(ret._trimmed in trimmed) {
                // TODO handle errors better...
                console.log('Error: duplicate trimmed hostname for "'+hyp.hostname+'"');
            }
            trimmed[ret._trimmed] = true;

            // will keep running count of resources allocated
            ret._allocated = res.map(function() { return 0 });

            return ret;
        });

    // calculate totals of allocated resources on each hypervisor
    instance.forEach(function(ins) {
        if(!ins.hypervisor) return; // ignore hypervisor=null, since those are not running anyway

        // match instance.hypervisor and hypervisor.hostname by trimming both and comparing
        var trimmed = ins.hypervisor;
        var i = trimmed.indexOf('.');
        if(i > -1) trimmed = trimmed.substr(0, i);
        var hyp = data.find(function(h) { return h._trimmed === trimmed })
        if(hyp) {
            res.forEach(function(r, i) {
                hyp._allocated[i] += r.accessor.instance(ins);
            });
        }
    });

    // sortAccessor elements must be ordered matching DOM order (dom elements must have class "th")
    var sortIdx = 0, sortOrder = d3.descending;
    var sortAccessor = [
        function(d) { return +d._capacity },
        function(d) { return d.hostname },
    ];
    res.forEach(function(r, i) {
        sortAccessor.push(function(d) { return +d._allocated[i] });
    });

    var rowHeight = 30; //px, has to match some stuff in flavour.css
    var container = s.select('div.list');
    container.style('height', data.length * rowHeight + 'px');

    var row = container.selectAll('div.hypervisor')
        .data(data);

    row.enter()
      .append('div')
        .attr('class', 'hypervisor')
        .on('mouseover', function() { d3.select(this).classed('selected', true) })
        .on('mouseout',  function() { d3.select(this).classed('selected', false) });
    row
        .html(function(d) { return '<span class="capacity"></span><span class="hostname" title="'+d.hostname+'">'+d.hostname+'</span>' })
        .style('top', function(_, i) { return i*rowHeight+'px' });
    row.exit().remove();

    var resources = row.append('div')
        .attr('class', 'resources');
    var header = s.select('.controls .resources');
    s.selectAll('.controls span');
    var h = header.selectAll('div').data(res);
    h.enter().append('div')
        .attr('class', function(d) { return 'th ' + d.key })
        .html(function(d) { return d.key });

    // bind column sorting
    var th = s.selectAll('.th');
    th.on('click', function(_, i) { sortBy(i) });

    // add columns for resources
    res.forEach(function(r, i) {
        resources.append('div')
            .attr('class', r.key)
          .append('div')
            .attr('class', 'bar')
          .append('div')
            .html(function(d) { return r.format(d._allocated[i])+' / '+r.format(r.accessor.hypervisor(d)) })
            .style('width', function(d) { return d._allocated[i]/r.accessor.hypervisor(d)*100+'%' }) // could use a d3 scale for this, but can't be bothered
            .attr('class', function(d) { return d._allocated[i] > r.accessor.hypervisor(d) ? 'oversubscribed' : '' });
    });

    // sort rows according to sortAccessor[i]
    var sortBy = function(i, order) {
        if(order !== undefined) sortOrder = order;
        else if(sortIdx === i) sortOrder = sortOrder === d3.ascending ? d3.descending : d3.ascending;
        sortIdx = i;

        // apply classes to draw sort direction arrow
        th.classed('ascending', function(_, i) { return i === sortIdx && sortOrder === d3.ascending });
        th.classed('descending', function(_, i) { return i === sortIdx && sortOrder === d3.descending });

        var sa = sortAccessor[sortIdx];
        data
            .sort(function(a, b) { return sortOrder(sa(a), sa(b)); })
            .forEach(function(d, i) { d.index = i });

        // rearrange rows
        row.transition()
            .style('top', function(d) { return d.index*rowHeight+'px' });
    };

    dispatch.on('flavChanged.'+sel, function(sel, f) {
        d3.selectAll('.deselected').classed('deselected', false);
        var sum = d3.select('.sum');
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

            sum.style('display', null);
            sum.select('span').html(tot + ' instance' + (tot===1 ? '':'s'));

            // sort by first column (capacity)
            sortBy(0, d3.descending);
        } else {
            // no flavour selected
            row.selectAll('.capacity').html('');
            sum.style('display', 'none');
        }
    });
}

var footer = function(sel, data) {
    // we only care about updates of tables listed in "data", not all tables in the database
    var tables = Object.keys(data).map(function(qk) {
        var i = qk.indexOf('?'); // remove any query parameters from table names
        return i === -1 ? qk : qk.substring(0, i);
    });
    var md = data.metadata.filter(function(m) { return tables.indexOf(m.table_name) >= 0 });

    // convert oldest timestamp from milliseconds to seconds
    var t = d3.min(md, function(m) { return Date.parse(m.last_update) }) * 0.001;

    // pretty print
    var s = d3.select(sel).select('.date').text(humanize.relativeTime(t));
};

})();
