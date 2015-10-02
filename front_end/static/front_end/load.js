var Load = {};
(function() {

var pieChart;

Load.init = function() {
    // set up NVD3 charts
    nv.addGraph(function() {
        pieChart = nv.models.pieChart()
            .margin({top:0, right:0, bottom:0, left:0})
            .donut(true)
            .donutRatio(0.35)
            .showLegend(true)
            .showLabels(false);
        nv.utils.windowResize(pieChart.update);
        return pieChart;
    });

    // fetch data for report
    Util.initReport([
        {
            sel : '.live',
            dep : ['project', 'hypervisor', 'volume?active=1', 'instance?active=1'],
            fun : live,
        },
        {
            sel : '.historical',
            dep : ['project', 'instance'],
            fun : historical,
        },
    ], {
        sel : 'footer',
        dep : ['metadata'],
        fun : footer,
    });
};

var resources = [
    {
        key    : 'vcpus', // to identify and to access data
        label  : 'VCPUs', // for pretty printing
        format : d3.format('d'),
        hv     : function(hyp) { return +hyp.cpus }, // to count total resources available across all hypervisors
    },
    {
        key    : 'memory',
        label  : 'Memory',
        format : function(mb) { return Formatters.si_bytes(mb*1024*1024) },
        hv     : function(hyp) { return +hyp.memory },
    },
    {
        key    : 'local',
        label  : 'Local storage',
        format : function(gb) { return Formatters.si_bytes(gb*1024*1024*1024) },
        hv     : function(hyp) { return +hyp.local_storage },
    },
    {
        key    : 'alloc',
        label  : 'Allocated storage',
        format : function(gb) { return Formatters.si_bytes(gb*1024*1024*1024) },
        // no hypervisor-determined limit on this
    },
];

var live = function(sel, data) {
    // relabel for convenience
    var instance = data['instance?active=1'];
    var volume = data['volume?active=1'];
    var s = d3.select(sel);

    // generate <select> for controlling pie
    var resourceSelect = s.select('select.resource')
        .on('change', function() { updateChart() });
    resourceSelect.selectAll('option')
        .data(resources)
      .enter().append('option')
        .attr('value', function(d) { return d.key })
        .text(function(d) { return d.label });
    var modeSelect = s.select('select.mode')
        .on('change', function() { updateChart() });

    // we will sum fields [vcpus, memory, local] over instances
    var agg = function(val, instance) {
        return {
            vcpus   : val.vcpus  + instance.vcpus,
            memory  : val.memory + instance.memory,
            local   : val.local  + instance.root + instance.ephemeral,
            key     : val.key,
            label   : val.label,
        };
    };

    // create array of {
    //  key     : project id,
    //  label   : project display name,
    //  vcpus   : total over active instances,
    //  memory  : total over active instances,
    //  local   : total over active instances
    // }
    var activeResources = data.project.map(function(p) {
        return instance
            .filter(function(ins) { return ins.project_id === p.id })
            .reduce(agg, {key:p.id, label:p.display_name, vcpus:0, memory:0, local:0});
    });

    // sum each project's allocated storage
    activeResources.forEach(function(res) {
        res.alloc = d3.sum(volume.filter(function(v) { return v.project_id === res.key }), function(v) { return v.size });
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
        var key = resourceSelect.property('value');
        var mod = modeSelect.property('value');

        pieChart
            .x(function(d) { return d.label })
            .y(function(d) { return d[key] })
          .tooltip
            .valueFormatter(resources.find(function(r) { return r.key === key }).format);
        s.select('svg')
            .datum(activeResources)
            .call(pieChart);
    };
    updateChart();
};

var historical = function(sel, data) {
    console.log('historical');
};

var footer = function(sel, data) {
    // we only care about updates of tables listed in "data", not all tables in the database
    var tables = Object.keys(data);
    var md = data.metadata.filter(function(m) { return tables.indexOf(m.table_name) >= 0 });

    // convert oldest timestamp from milliseconds to seconds
    var t = d3.min(md, function(m) { return Date.parse(m.last_update) }) * 0.001;

    // pretty print
    var s = d3.select(sel).select('.date').html(humanize.relativeTime(t));
};

})();
