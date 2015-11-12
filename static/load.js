var Load = {};
(function() {

var resources = [
    {
        key    : 'vcpus', // to identify and to access data
        label  : 'VCPUs', // for pretty printing
        format : d3.format('d'),
        hv     : function(hyp) { return +hyp.cpus }, // to count total resources available across all hypervisors
        hist   : function(hu) { return hu.vcpus }, // accessor into historical_usage table
    },
    {
        key    : 'memory',
        label  : 'Memory',
        format : function(mb) { return Formatters.si_bytes(mb*1024*1024) },
        hv     : function(hyp) { return +hyp.memory },
        hist   : function(hu) { return hu.memory },
    },
    {
        key    : 'local_storage',
        label  : 'Local storage',
        format : function(gb) { return Formatters.si_bytes(gb*1024*1024*1024) },
        hv     : function(hyp) { return +hyp.local_storage },
        hist   : function(hu) { return hu.local_storage },
    },
    {
        key    : 'volume_storage',
        label  : 'Volume storage',
        format : function(gb) { return Formatters.si_bytes(gb*1024*1024*1024) },
        // no hypervisor-determined limit on this, and no historical data
    },
];

var pieCharts = [], lineChart;

Load.init = function() {
    // set up NVD3 charts
    resources.forEach(function(r) {
        nv.addGraph(function() {
            var pieChart = nv.models.pieChart()
                .x(function(d) { return d.label })
                .y(function(d) { return d[r.key] })
                .margin({top:0, right:0, bottom:0, left:0})
                .donut(true)
                .donutRatio(0.35)
                .title(r.label)
                .showLegend(false) // do not draw (interactive) keys above the chart
                .showLabels(false); // do not draw keys on the chart
            pieChart
              .tooltip
                .valueFormatter(r.format);
            nv.utils.windowResize(function() { pieChart.update() });
            pieCharts.push(pieChart);
            return pieChart;
        });
    });
    nv.addGraph(function() {
        lineChart = nv.models.lineWithFocusChart();
        lineChart.x2Axis
            .tickFormat(function(d) { return d3.time.format('%b %y')(new Date(d)) });

        // set radioButtonMode, so only one series can be selected at a time
        // when the chart is actually called, the first series will be manually selected
        // (couldn't find a less hacky way of doing that)
        lineChart.legend.radioButtonMode(true);
        lineChart.legend.dispatch.on('legendClick', function(d, i) {
            lineChart.yAxis.tickFormat(resources[i].format);
        });

        // when extent changes, change scale to suit (note that data points are recorded one per day)
        lineChart.dispatch.on('brush.update', function(b) {
            var ms = b.extent[1] - b.extent[0];
            var msCutoff = 3600*24*30*1000*3; // cutoff between "day/month" and "month/year" tick formats
            lineChart.xAxis
                .tickFormat(function(d) { return d3.time.format(ms < msCutoff ? '%e %b' : '%b %y')(new Date(d)) });
        });

        nv.utils.windowResize(function() { lineChart.update() });
        return lineChart;
    });

    // fetch data for report
    Util.initReport([
        {
            sel : '.live',
            dep : ['project?personal=0', 'hypervisor', 'volume?active=1', 'instance?active=1'],
            fun : live,
        },
        {
            sel : '.historical',
            dep : ['historical_usage'],
            fun : historical,
        },
    ], {
        sel : 'footer',
        dep : ['metadata'],
        fun : footer,
    });
};

var live = function(sel, data) {
    // relabel for convenience
    var instance = data['instance?active=1'];
    var volume = data['volume?active=1'];
    var project = data['project?personal=0'];
    var s = d3.select(sel);

    // function for reducing over array of instances, extracting what we want to plot
    var agg = function(val, instance) {
        return {
            vcpus         : val.vcpus         + instance.vcpus,
            memory        : val.memory        + instance.memory,
            local_storage : val.local_storage + instance.root + instance.ephemeral,
            key           : val.key,
            label         : val.label,
        };
    };

    // instances belonging to projects with personal=1 will have organisation "undefined",
    // and instances belonging to projects with no organisatoin will get "null";
    // later on, when we would store this in an object, javascript will convert that to string
    // which gets confusing e.g. because strings "null" and "undefined" evaluate to true.
    // SO instead we define these 'pseudo-organisations' with string names that will never
    // be used by actual organisations, and compare against these
    var pseudoOrg = {'__null' : 'No organisation', '__undefined' : 'Personal trial'};

    // construct reverse mapping {project_id : "Organisation name"}
    var po = {};
    project.forEach(function(p) {
        po[p.id] = p.organisation || '__null';
    });

    // construct {"Organisation name" : [instances]}
    var oi = {};
    instance.forEach(function(i) {
        var organisation = po[i.project_id] || '__undefined';
        if(!(organisation in oi)) oi[organisation] = [];
        oi[organisation].push(i);
    });

    // reduce oi to get {"Organisation name" : {key, label, vcpus, etc.}}
    var activeResources = Object.keys(oi).map(function(o) {
        return oi[o].reduce(agg, {key:o, label:o in pseudoOrg ? pseudoOrg[o] : o, vcpus:0, memory:0, local_storage:0});
    });

    // sort ascending by first resource (vcpus)
    activeResources.sort(function(a, b) { return b[resources[0].key] - a[resources[0].key] });

    // sum each project's volume storage
    activeResources.forEach(function(res) {
        res.volume_storage = d3.sum(volume.filter(function(v) { return po[v.project_id] === res.key }), function(v) { return v.size });
    });

    // find how much of each resource is available across all hypervisors
    var capacity = resources.map(function(res) {
        return res.hv ? d3.sum(data.hypervisor, res.hv) : undefined;
    });

    // prepend 'unused' element to data
    var unused = {key:null, label:'Unused'};
    resources.forEach(function(res, i) {
        unused[res.key] = capacity[i] ? capacity[i] - d3.sum(activeResources, function(red) { return red[res.key] }) : null;
    });
    activeResources.unshift(unused);

    var updateChart = function() {
        // updateChart function is redundant (only called once) right now, but eventually the charts will be interactive again, and then it will become unredundant...
        var svg = s.selectAll('svg').data(resources);
        svg.enter().append('svg');
        svg.exit().remove();
        svg.datum(activeResources);
        svg.each(function(d, i) { d3.select(this).call(pieCharts[i]) });
    };
    updateChart();
};

var historical = function(sel, data) {
    // relabel for convenience
    var h = data.historical_usage;
    var s = d3.select(sel);

    // in the unlikely event that there's no data, don't bother trying to plot anything
    if(!h) return;

    // reorganise data for nvd3, which expects values to be an array of objects with x,y keys (goodbye efficiency)
    var rearranged = resources.filter(function(r) { return r.hist }).map(function(res) {
        return {
            key    : res.label,
            values : h.map(function(row) { return {x:Date.parse(row.day), y:row[res.key]} }),
        };
    });

    var s = d3.select(sel);
    s.select('svg').datum(rearranged).call(lineChart);

    // by default, chart shows all of its series, but in this context that is unhelpful
    // (plotting #vcpus on the same axis as memory_mb and disk_gb is confusing and looks silly)
    // so we want to show just one resource at a time (so when the chart was initialised, set radioButtonMode)
    // and couldn't find an elegant way of doing this, so manually invoke the legend's click handler
    var series = s.select('.nv-series'); // yes this is hacky :c
    if(!series.empty()) series.on('click')(series.node().__data__, 0);
};

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
