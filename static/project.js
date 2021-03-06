var Project = {};
(function() {

var pieChart, table;

Project.init = function() {
    // set up NVD3 charts
    nv.addGraph(function() {
        pieChart = nv.models.pieChart()
            .margin({top:0, right:0, bottom:0, left:0})
            .showLegend(false) // do not draw (interactive) keys above the chart, because they take up too much space :(
            .showLabels(false); // do not draw keys on the chart
        nv.utils.windowResize(function() { pieChart.update() });
        return pieChart;
    });

    // fetch data for report
    Util.initReport([
        {
            sel : '.report',
            dep : ['project?personal=0&has_instances=1', 'flavour', 'hypervisor'], // need hypervisor data for node-level filtering (until instance.availability_zone is useful)
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
    var warn = s.select('.warning');
    var project = data['project?personal=0&has_instances=1'];
    var hypervisor = data.hypervisor;
    var flavour = data.flavour;
    var az = localStorage.getItem(Util.nodeKey);

    // build mapping {trimmed hypervisor name : availability zone} for node-level filtering later on
    var hostAZ = {};
    hypervisor.forEach(function(h) {
        var trimmed = h.hostname;
        var i = trimmed.indexOf('.');
        if(i !== -1) trimmed = trimmed.substr(0, i);
        if(trimmed in hostAZ) {
            // TODO handle errors better
            if(hostAZ[trimmed] === h.availability_zone) {
                console.log('Warning: duplicate hypervisor name "'+trimmed+'" (same AZ)');
            } else {
                console.log('Error: duplicate hypervisor name "'+trimmed+'"');
            }
        }
        hostAZ[trimmed] = h.availability_zone;
    });
    // (when we have a table mapping project_id -> availability_zones, project list can be filtered here, to make sure that by default a nonempty chart is shown)

    // extract project ids, organisations, and display names, and sort
    project = project
        .filter(function(p) { return p.has_instances })
        .map(function(d) { return {id:d.id, display_name:d.display_name, organisation:d.organisation} })
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

    // gather institutions
    var inst = {}; // this will be {'Institution Name' : [pid1, pid2, ..]} (since the organisation name seems to be the only identifier for the institution, there's no id field)
    project.forEach(function(p) {
        if(!p.organisation) return; // don't try calling null.split
        p.organisation.split(';').forEach(function(o) {
            if(!inst[o]) inst[o] = [];
            inst[o].push(p.id);
        });
    });
    var organisation = Object.keys(inst).sort(); // make an array, for calling selection.data

    // generate institution <select>
    var instSelect = s.select('select#institution');
    var instOpt = instSelect.selectAll('option')
        .data(organisation);
    instOpt.enter().append('option');
    instOpt
        .attr('value', function(d) { return d })
        .text(function(d) { return d });
    instOpt.exit().remove();

    // keep in sync radio, select and label elements
    var picked = function(d, i) {
        radio.property('checked', function(dr, ir) { return ir === i });
        s.selectAll('.controls > div').classed('disabled', function(_, is) { return 1-is === i });
        update();
    };
    var radio = s.selectAll('input[type=radio]');
    radio.property('checked', function(d, i) { return i === 0 });
    radio.on('change', picked);
    s.selectAll('.controls > div').classed('disabled', function(_, i) { return i === 1 });
    s.selectAll('label').on('click', picked);
    s.selectAll('#project,#institution').on('change', picked);

    // generate resource <select>
    var resSelect = s.select('select#resource');
    var resOpt = resSelect.selectAll('option')
        .data(resources);
    resOpt.enter().append('option');
    resOpt
        .attr('value', function(d) { return d.key })
        .text(function(d) { return d.label });
    resOpt.exit().remove();

    // initialise line chart
    var chart = Charts.zoom()
        .xFn(function(d) { return d.x })
        .yDateFn(function(d) { return d.y })
        .yZoom(function(d) { return d.y });
    chart.tip().html(function(d) { return d.label })

    var progress = Charts.progress();
    var progressContainer = s.select('.progress');

    // called when a different project/institution is selected
    var update = function() {
        // create list of projects whose data should be fetched
        var pids;
        if(s.select('label[for=institution] input[type=radio]').property('checked')) {
            pids = inst[instSelect.property('value')];
        } else {
            // picking a single project: make array with length 1
            var pid = projSelect.property('value');
            pids = [pid];

            // if there's an organisation associated with this project, select it
            var o = organisation.find(function(o) {
                return inst[o].find(function(p) {
                    return p === pid
                }) !== undefined;
            });
            if(o) {
                // found matching organisation
                instSelect.property('value', o);
            }
        }

        // don't need to re-fetch data when changing displayed resource; jump straight to fetchedAll
        resSelect.on('change.pie', function() { updatePie() });

        // re-bind handler for availability zone change
        // note that this removes the default (util.js) handler,
        // which is what we want in this particular report
        // because there's no need to re-call report()
        // (and consequently reset UI state) -- just need to
        // re-call fetchedAll.
        // n.b. I ran into trouble trying to avoid this overriding:
        // doing .on('change.foo', ...) had no effect.
        // But then I realised that actually I wanted to remove
        // the default behaviour anyway, so whatever... :\
        d3.selectAll('#az select').on('change', function() {
            localStorage.setItem(Util.nodeKey, this.value); // TODO this should really be refactored (DRY, cf util.js); add Util.on dispatch object and have each report specify how it should respond to az change
            az = this.value;
            fetchedAll();
        });

        // fetch and combine all data for given projects
        var callbacks = function(pid, callback) {
            return {
                success : function(data) {
                    callback(pid, data);
                },
                error : function(error) {
                    // any error fetching data is treated as fatal
                    // alternatively we could try to carry on, using just whatever is successfully received,
                    // but this would require carefully checking any joining code to make sure it handles missing data gracefully
                    warn.style('display',null);
                    warn.append('p').html('Fatal error getting data for project id '+pid+'.');
                    progressContainer.style('display', 'none');
                },
            };
        };
        var projectAgg = [], instanceAgg = [], volumeAgg = [], activeResources; // aggregated data
        var n = 0; // count of how many projects have had data received
        var fetched = function(pid, data) { // called after fetching individual project's data;
            // combine all fetched data
            projectAgg  = projectAgg.concat(data['project?id='+pid]);
            instanceAgg = instanceAgg.concat(data['instance?project_id='+pid]);
            volumeAgg   = volumeAgg.concat(data['volume?project_id='+pid]);

            // show progress and check if we're finished
            progressContainer.call(progress.val(++n));
            if(n === pids.length) {
                progressContainer.style('display', 'none');
                fetchedAll();
            }
        };
        var fetchedAll = function() { // called after fetching all projects' data, aggregated in project and instance
            // pollute instance data with trimmed hypervisor names
            instanceAgg.forEach(function(ins) {
                var trimmed = ins.hypervisor;
                if(!trimmed) return; // will be ignored later
                var i = trimmed.indexOf('.');
                if(i > -1) trimmed = trimmed.substr(0, i);
                ins._trimmed = trimmed;
            });

            // filter by node
            var instance = instanceAgg.filter(function(ins) {
                if(!ins._trimmed) return false; // ignore instances with no hypervisor, because these are never scheduled and never used any resources
                if(ins._trimmed in hostAZ) {
                    return hostAZ[ins._trimmed].indexOf(az) === 0;
                } else {
                    // TODO handle error
                    console.log('Error: hypervisor ('+ins._trimmed+') for instance '+ins.id+' not found');
                    return az === ''; // include instances with unknown hypervisors when selected node is "all"
                }
            });
            var volume = volumeAgg.filter(function(v) { return v.availability_zone.indexOf(az) === 0 });
            var project = projectAgg.filter(function() { return true });

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

            // sort by first resource (vcpus)
            activeResources.sort(function(a, b) { return b[resources[0].key] - a[resources[0].key] });

            // prepend "Unused" element
            var warnings = []; // also keep track of any quotas exceeded
            if(az === '') {
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
                            warnings.push('Quota exceeded for '+r.key+' ('+pids.map(function(pid) { return project.find(function(p) { return p.id === pid }).display_name }).join(', ')+').');
                        } else {
                            unused[r.key] = quota - used;
                        }
                    }
                });
                activeResources.unshift(unused);
            }

            // display any quota warnings
            warn.style('display', warnings.length > 0 ? null : 'none');
            var w = warn.selectAll('p').data(warnings);
            w.enter().append('p');
            w.html(String);
            w.exit().remove();

            // fill data, array of {
            //  key    : resource.label
            //  values : [{x, y, label}]
            // }
            // i.e. the format expected by nvd3 lineWithFocusChart,
            // even though we're not using lineWithFocusChart
            // (because it doesn't let you zoom/pan arbitrarily, making it not possible
            // in general to view monthly/quarterly/etc. usage)
            var data = resources.map(function(r) { return {key : r.label, values : []} });

            // compile list of all instance/volume creation/deletion events
            var events = [];
            instance.forEach(function(i) {
                var ct = Date.parse(i.created),
                    dt = Date.parse(i.deleted);
                if(!isNaN(ct)) events.push({time:ct, mult:+1, instance:i});
                if(!isNaN(dt)) events.push({time:dt, mult:-1, instance:i});
            });
            volume.forEach(function(v) {
                var ct = Date.parse(v.created),
                    dt = Date.parse(v.deleted);
                if(!isNaN(ct)) events.push({time:ct, mult:+1, volume:v});
                if(!isNaN(dt)) events.push({time:dt, mult:-1, volume:v});
            });
            events.sort(function(e1, e2) { return e1.time - e2.time });

            // precompute indices into data/resources arrays of resources with instance/volume accessors
            var insIdx = resources.filter(function(r) { return r.instance }).map(function(r) { return data.findIndex(function(d) { return d.key === r.label }) });
            var volIdx = resources.filter(function(r) { return r.volume }).map(function(r) { return data.findIndex(function(d) { return d.key === r.label }) });

            var verb = {}; verb[+1] = 'created'; verb[-1] = 'deleted';
            events.forEach(function(e) {
                // n.b. if a resource is defined with both instance and volume accessors,
                // then this will add two data points with same x value
                if(e.instance) {
                    insIdx.forEach(function(i) {
                        var yOld = data[i].values.length ? data[i].values[data[i].values.length-1].y : 0;
                        data[i].values.push({
                            x     : e.time,
                            y     : yOld+e.mult*resources[i].instance(e.instance),
                            label : verb[e.mult]+' '+e.instance.name,
                        });
                    });
                }
                if(e.volume) {
                    volIdx.forEach(function(i) {
                        var yOld = data[i].values.length ? data[i].values[data[i].values.length-1].y : 0;
                        data[i].values.push({
                            x     : e.time,
                            y     : yOld+e.mult*resources[i].volume(e.volume),
                            label : verb[e.mult]+' '+e.volume.display_name,
                        });
                    });
                }
            });

            // append "now" data points (hack to make the graphs a bit more readable; doesn't add any extra information)
            var now = Date.now();
            data.forEach(function(d) {
                if(d.values.length > 0) {
                    var latest = d.values[d.values.length-1].y;
                    d.values.push({x:now, y:latest, label:'now'});
                }
            });

            // data now ready for plotting
            var updateLine = function() {
                var idx = resSelect.property('selectedIndex');
                chart.tickFormat(resources[idx].format);
                s.select('.chart').datum(data[idx].values).call(chart);
                chart.dispatch.zoom(null); // reset zoom
            };
            resSelect.on('change.line', updateLine);
            updatePie();
            updateLine();

            // set up DataTable
            var sTable = $('table', $(sel));
            if($.fn.dataTable.isDataTable(sTable)) {
                // cannot re-initialise DataTable; have to delete it and start again
                sTable.DataTable().clear().destroy();
            }
            var tbl = sTable.DataTable({
                //dom : 'rtp', // show only processing indicator and table
                data : instance,
                processing : true,
                paging : true,
                deferRender : true,
                columns : [
                    {
                        title : 'Instance',
                        data : 'name',
                    },
                    {
                        title : 'Created',
                        data : 'created',
                        className : 'date',
                        render : {
                            display : Formatters.relativeDateDisplay,
                        },
                    },
                    {
                        title : 'Deleted',
                        data : 'deleted',
                        className : 'date',
                        render : {
                            display : Formatters.relativeDateDisplay,
                        },
                    },
                    {
                        title : 'Project',
                        data : function(ins) {
                            return project.find(function(p){return p.id===ins.project_id;}).display_name;
                        },
                    },
                    {
                        title : 'Availability zone',
                        data : function(ins) {
                            return ins._trimmed in hostAZ ? hostAZ[ins._trimmed] : 'unknown';
                        },
                    },
                    /*
                    {
                        title : 'Wall time',
                        data : 'wall_time',
                        render : { display : Formatters.timeDisplay },
                    },
                    */
                    {
                        title : 'Flavour',
                        data : 'flavour',
                        render : {
                            display : Formatters.flavourDisplay(flavour),
                            filter : function(fid) { return flavour.find(function(f){return f.id===fid}).name; },
                        },
                    },
                    {
                        data : 'project_id',
                        className : 'project_id', // to identify column for filtering
                        visible : false,
                    },
                    {
                        data : 'id',
                        visible : false,
                    },
                ],
                order : [[1, 'desc']], // order by second col: most recently created first
                language : {
                    zeroRecords : 'No matching instances found.',
                },
            });
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
            s.select('svg')
                .datum(activeResources)
                .call(pieChart);
        };

        // reset and display progress indicator
        progress
            .max(pids.length)
            .val(0);
        progressContainer
            .style('display', null)
            .call(progress);

        // enqueue all data to be fetched
        pids.forEach(function(pid) {
            var fetch = Util.fetcher();
            var on = callbacks(pid, fetched);
            fetch.q({
                qks     : ['project?id='+pid, 'instance?project_id='+pid, 'volume?project_id='+pid],
                start   : on.start,
                success : on.success,
                error   : on.error,
            });
            fetch();
        });
    }
    update();
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
