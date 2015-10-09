var Project = {};
(function() {

var pieChart, lineChart, table;

Project.init = function() {
    // set up NVD3 charts
    nv.addGraph(function() {
        pieChart = nv.models.pieChart()
            .margin({top:0, right:0, bottom:0, left:0})
            .showLegend(true) // draw (interactive) keys above the chart
            .showLabels(false); // do not draw keys on the chart
        nv.utils.windowResize(function() { pieChart.update() });
        return pieChart;
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

        nv.utils.windowResize(lineChart.update);
        return lineChart;
    });

    // fetch data for report
    Util.initReport([
        {
            sel : '.report',
            dep : ['project'],
            fun : report,
        },
    ], {
        sel : 'footer',
        dep : ['metadata'],
        fun : footer,
    });
};

var resources = [
    {
        key      : 'vcpus', // to identify and to access data
        label    : 'VCPUs', // for pretty printing
        format   : d3.format('d'),
        quota    : function(project) { return project.quota_vcpus }, // if specified, will be shown in pie chart
        instance : function(instance) { return instance.vcpus }, // if specified, sum(instance) with this accessor will be shown in line chart
        //volume : if specified, sum(volume) with this accessor will be added to sum(instance) and shown in line chart
    },
    {
        key      : 'memory',
        label    : 'Memory',
        format   : function(mb) { return Formatters.si_bytes(mb*1024*1024) },
        quota    : function(project) { return project.quota_memory },
        instance : function(instance) { return instance.memory },
    },
    {
        key      : 'ephemeral',
        label    : 'Ephemeral storage',
        format   : function(gb) { return Formatters.si_bytes(gb*1024*1024*1024) },
        instance : function(instance) { return instance.ephemeral },
    },
    {
        key      : 'volume',
        label    : 'Volume storage',
        format   : function(gb) { return Formatters.si_bytes(gb*1024*1024*1024) },
        volume   : function(volume) { return volume.size },
        quota    : function(project) { return project.quota_volume_total },
    },
];

var report = function(sel, data) {
    // relabel for convenience
    var s = d3.select(sel);

    // make shallow copy of data, for sorting without altering original
    var project = data.project
        .map(function(d) { return {id:d.id, display_name:d.display_name} })
        .sort(function(a, b) { return d3.ascending(a.display_name.toLowerCase(), b.display_name.toLowerCase()) });

    // generate project <select>
    var projSelect = s.select('select#project');
    var projectOpt = projSelect.selectAll('option')
        .data(project);
    projectOpt.enter().append('option');
    projectOpt
        .attr('value', function(d) { return d.id })
        .text(function(d) { return d.display_name });
    projectOpt.exit().remove();

    // TODO gather institutions
    var inst = [{id:'id', name:'coming Soon\u2122'}, {id:'2',name:'2'}];

    // generate institution <select>
    var instSelect = s.select('select#institution');
    var instOpt = instSelect.selectAll('option')
        .data(inst);
    instOpt.enter().append('option');
    instOpt
        .attr('value', function(d) { return d.id })
        .attr('disabled', '')
        .text(function(d) { return d.name });
    instOpt.exit().remove();

    // keep in sync radio, select and label elements
    var picked = function(d, i) {
        radio.property('checked', function(dr, ir) { return ir === i });
        update();
    };
    var radio = s.selectAll('input[type=radio]');
    radio.property('checked', function(d, i) { return i===0 });
    radio.on('change', picked);
    s.selectAll('label').on('click', picked);
    s.selectAll('select').on('change', picked); // this sets select#resources on change too, but that gets overridden later

    // generate resource <select>
    var resSelect = s.select('select#resource');
    var resOpt = resSelect.selectAll('option')
        .data(resources);
    resOpt.enter().append('option');
    resOpt
        .attr('value', function(d) { return d.key })
        .text(function(d) { return d.label });
    resOpt.exit().remove();

    // we will have our own Fetcher, which we want to share the user-selected endpoint
    var ep = d3.select('nav select');
    ep.on('change.project', update); // ep.on('change') is set in util.js; setting here without namespace would override

    var update = function() {
        // create list of projects whose data should be fetched
        var pids = [];
        if(s.select('label[for=institution] input[type=radio]').property('checked')) {
            // TODO append all projects for this institution
            var inst = instSelect.property('value');
            console.log('inst', inst);
        } else {
            pids.push(projSelect.property('value'));
        }

        // don't need to re-fetch data when changing displayed resource; jump straight to fetchedAll
        resSelect.on('change', function() { updatePie() });

        // fetch and combine all data for given projects
        var on401 = function() {
            // TODO handle unexpected unauthorised
            console.log('session (probably) expired');
        };
        var callbacks = function(pid, callback) { // TODO enhance these to show pretty progress/error indicators
            return {
                start : function() {
                    console.log('fetching',pid);
                },
                success : function(data) {
                    console.log('fetched',pid);
                    callback(pid, data);
                },
                error : function() {
                    console.log('error for',pid);
                },
            };
        };
        var project = [], instance = [], volume = [], activeResources; // aggregated data
        var n = 0; // count of how many projects have had data received
        var fetched = function(pid, data) { // called after fetching individual project's data;
            // combine all fetched data
            data['project?id='+pid].forEach(function(d) { project.push(d) });
            data['instance?project_id='+pid].forEach(function(d) { instance.push(d) });
            data['volume?project_id='+pid].forEach(function(d) { volume.push(d) });

            // check if we're finished
            n += 1;
            if(n === pids.length) fetchedAll();
        };
        var fetchedAll = function() { // called after fetching all projects' data, aggregated in project and instance
            // fill activeResources, array of {
            //  pid    : project id,
            //  label  : for pretty printing,
            //  vcpus  : total over active instances and volumes
            //  memory : total over active instances and volumes
            //  etc    : for other elements of resources arrray
            // }
            var activeInstance  = instance.filter(function(i) { return i.active });
            var activeVolume    = volume.filter(function(v) { return v.active });
            activeResources = pids.map(function(pid) {
                var ret = {pid : pid, label : project.find(function(p) { return p.id === pid }).display_name};
                resources.forEach(function(r) {
                    // TODO would it be better to store the aggregated data by project_id, to avoid filtering here
                    ret[r.key] = 0;
                    if(r.instance) ret[r.key] += d3.sum(activeInstance.filter(function(i) { return i.project_id === pid }), r.instance);
                    if(r.volume) ret[r.key] += d3.sum(activeVolume.filter(function(v) { return v.project_id === pid }), r.volume);
                });
                return ret;
            });

            // prepend "Unused" element
            var unused = {pid:null, label:'Unused'};
            resources.forEach(function(r, i) {
                unused[r.key] = null; // chart breaks if keys are missing, but works with null values
                if(r.quota) { // if quota function is defined for this resource, sum over all projects
                    if(project.some(function(p) { return r.quota(p) < 0 })) {
                        // some project has unlimited quota (quota=-1), so "unused" segment cannot be drawn
                        return;
                    }
                    var quota = d3.sum(project, r.quota);
                    var used = d3.sum(activeResources, function(ar) { return ar[r.key] });
                    if(used > quota) {
                        // some project has gone over quota...
                        console.log(r.key,'quota exceeded for some project',pids);
                    } else {
                        unused[r.key] = quota - used;
                    }
                }
            });
            activeResources.unshift(unused);

            // data now ready for plotting
            updatePie();
        };
        var updatePie = function() {
            var key = resSelect.property('value');
            pieChart
                .x(function(d) { return d.label })
                .y(function(d) { return d[key] })
              .tooltip
                .valueFormatter(resources.find(function(r) { return r.key === key }).format);
            var svg = s.select('svg');
            var div = d3.select(svg.node().parentNode);
            /*
            pieChart
                .width(parseInt(div.style('width')))
                .height(parseInt(div.style('height')));
                */
            s.select('svg')
                /*
                .attr('width', pieChart.width())
                .attr('height', pieChart.height())
                .attr('viewBox', '0 0 '+pieChart.width()+' '+pieChart.height()) // scale svg to fit viewport
                .attr('preserveAspectRatio', 'xMinYMin meet')                   // and keep 
                */
                .datum(activeResources)
                .call(pieChart);
        };
        pids.forEach(function(pid) { // enqueue all data to be fetched
            console.log('===',pid);
            var fetch = Fetcher(Config.endpoints, sessionStorage.getItem(Config.tokenKey), on401);
            var on = callbacks(pid, fetched);
            fetch.q({
                qks     : ['project?id='+pid, 'instance?project_id='+pid, 'volume?project_id='+pid],
                start   : on.start,
                success : on.success,
                error   : on.error,
            });
            fetch(ep.property('value'));
        });
    }
    update();
};

var footer = function(sel, data) {
    // we only care about updates of tables listed in "data", not all tables in the database
    var tables = Object.keys(data);
    var md = data.metadata.filter(function(m) { return tables.indexOf(m.table_name) >= 0 });

    // convert oldest timestamp from milliseconds to seconds
    var t = d3.min(md, function(m) { return Date.parse(m.last_update) }) * 0.001;

    // pretty print
    var s = d3.select(sel).select('.date').text(humanize.relativeTime(t));
};

})();
