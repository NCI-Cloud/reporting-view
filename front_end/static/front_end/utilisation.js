var Report = {};
(function($) {

/// event broadcasting
var dispatch = d3.dispatch('optionChanged', 'projectChanged', 'datesChanged');

Report.init = function() {
    Util.initReport([
        {
            sel : null,
            dep : ['instance'],
            fun : preprocess_instance, // Fetcher will invoke callbacks in the order they're queued, so this comes before anything else depending on projects
        },
        {
            sel : '.resources',
            dep : ['project', 'hypervisor', 'live_instance', 'volume'],
            fun : report_resources,
        },
        {
            sel : '.overview',
            dep : ['project', 'live_instance'],
            fun : report_overview,
        },
        {
            sel : '.live',
            dep : ['project', 'flavour', 'live_instance'],
            fun : report_live,
        },
        {
            sel : '.historical',
            dep : ['project', 'flavour', 'instance'],
            fun : report_historical,
        },
        {
            sel : '.footer',
            dep : ['last_updated'],
            fun : report_footer,
        },
    ]);
};

function arcTween(arc) {
    return function(pie_d) { // return a tween from current datum (._current) to final datum pie_d
        var i = d3.interpolate(this._current, pie_d); // object interpolator, interpolating {start,end}Angle
        this._current = pie_d; // save final state (for next transition)
        return function(t) {
            return arc(i(t));
        };
    }
}

/* make tooltips perpendicular to circle, i.e. if an arc's (mean) angle is
 * in [pi/4, 3pi/4] (using d3's left-handed, "12 o'clock is zero" convention)
 * then render the tooltip to the east
 */
function pie_tip_direction(pie_d) {
    var angle = (0.5*(pie_d.startAngle+pie_d.endAngle) + 0.25*Math.PI) % (2*Math.PI); // rotate pi/4 clockwise
    if(angle <   Math.PI*0.5) return 'n';
    if(angle < 2*Math.PI*0.5) return 'e';
    if(angle <3 *Math.PI*0.5) return 's';
    return 'w';
}

/* get cartesian coordinates for target of tooltip of pie datum d
 * where (0,0) is the centre of the pie chart and r is its radius
 */
function pie_tip_x(r, d) {
    return -r * Math.cos(-0.5*Math.PI - 0.5*(d.startAngle+d.endAngle));
}
function pie_tip_y(r, d) {
    return  r * Math.sin(-0.5*Math.PI - 0.5*(d.startAngle+d.endAngle));
}

var instance_by_puuid;
/// rearrange instance data so we can efficiently group by project
function preprocess_instance(_, g) {
    instance_by_puuid = {}; // make sure this function can be called multiple times (e.g. with different endpoints) without littering the global
    g.instance.forEach(function(ins) {
        if(! (ins.project_id in instance_by_puuid)) {
            instance_by_puuid[ins.project_id] = [];
        }

        // pollute data by preparsing dates
        ins._c_time = Date.parse(ins.created);
        ins._d_time = Date.parse(ins.deleted);

        instance_by_puuid[ins.project_id].push(ins);
    });
}

function report_overview(sel, g) {
    var s = d3.select(sel);
    // chart synchronisation is implemented by matching keys with report_resources
    var aggs = [
        {
            key    : 'vcpus',
            title  : 'vCPU',
            use_fn : function(val, ins) { return val + (+ins.vcpus); },
            format : function(n) { return n + ' vcpus'; },
        },
        {
            key    : 'memory',
            title  : 'Memory',
            use_fn : function(val, ins) { return val + (+ins.memory); },
            format : function(mem_mb) { return Formatters.si_bytes(mem_mb*1024*1024); },
        },
        {
            key    : 'local',
            title  : 'Local storage',
            use_fn : function(val, ins) { return val + (+ins.root) + (+ins.ephemeral); },
            format : function(disk_gb) { return Formatters.si_bytes(disk_gb*1024*1024*1024); },
        },
        {
            key    : 'allocation_time',
            title  : 'Allocation time',
            use_fn : function(val, ins) { return val + (+ins.allocation_time); },
            format : Formatters.timeDisplay,
        },
        {
            key    : 'wall_time',
            title  : 'Wall time', // TODO values for this currently are all 0, which breaks the pie chart
            use_fn : function(val, ins) { return val + (+ins.wall_time); },
            format : Formatters.timeDisplay,
        },
    ];

    // generate <select> for controlling pie
    var slct = s.select('select')
        .on('change', function() { dispatch.optionChanged(sel, this.value); });
    slct.selectAll('option')
        .data(aggs)
      .enter().append('option')
        .attr('value', function(d) { return d.key; })
        .text(function(d) { return d.title; })

    // aggregate data
    var agg_live_instance = g.project.map(function(p) {
        var ret = {puuid : p.id}; // TODO rename puuid
        aggs.forEach(function(f) {
            ret[f.key] = g.live_instance.filter(function(ins) { return ins.project_id == p.id; }).reduce(f.use_fn, 0);
        });
        return ret;
    });

    // set up chart
    var pie = Charts.pie()
        .key(function(d) { return d.puuid })
        .pathClass(function(d) { return 'project-'+d.puuid });
    var sPie = s.select('.chart').datum(agg_live_instance);
    pie.dispatch.on('click.'+sel, function(d, i) {
        // if corresponding path element has "selected" class, remove project selection; else select clicked project
        dispatch.projectChanged(sel, d3.select(sPie.selectAll('path')[0][i]).classed('selected') ? null : d.puuid);
    });

    var updateChart = function() {
        var dk = slct.property('value');
        var ps = g.project;
        pie
            .val(function(d) { return d[dk] })
            .tip(function(d) {
                var p = g.project.find(function(p) { return p.id == d.puuid });
                var pname = p ? p.display_name : '?('+d.puuid+')';
                var a = aggs.find(function(a) { return a.key == dk });
                return pname + ': <span>' + a.format(d[dk]) + '</span>';
             });
        // TODO given datum() is called above, don't really need to re-call it here, except if chart breaks
        // (which happens all the time with wall_time = 0 bug)
        sPie.datum(agg_live_instance).call(pie);
    };

    updateChart();
    s.classed('loading', false);

    dispatch.on('optionChanged.'+sel, function(sender_sel, data_key) {
        if(sel!==sender_sel && !should_lock_charts()) return;
        if(aggs.find(function(a){return a.key===data_key})) { // check if data_key makes sense in this context
            slct.property('value', data_key);
            updateChart();
        }
    });
    dispatch.on('projectChanged.'+sel, function(sender_sel, puuid) {
        // apply "selected" class to pie piece corresponding to puuid, if it has nonzero value (i.e. don't confuse user by selecting invisible data)
        if(sel!==sender_sel && !should_lock_charts()) return;
        s.selectAll('path').classed('selected', false); // deselect everything
        var field = s.select('select').property('value'); // what field are we looking at
        var d = agg_live_instance.find(function(i){return i.puuid===puuid}); // find datum with given puuid
        if(d && d[field]) { // datum exists (expected), and has nonzero value of field, so can be selected on pie chart
            s.selectAll('path.project-'+puuid).classed('selected', true);
            s.select('.instructions p.selected').style('display', 'block');
            s.select('.instructions p:not(.selected)').style('display', 'none');
        } else {
            s.select('.instructions p.selected').style('display', 'none');
            s.select('.instructions p:not(.selected)').style('display', 'block');
        }
    });
}

function report_live(sel, g) {
    var s = $(sel);
    var sTable = $('table', s);
    if($.fn.dataTable.isDataTable(sTable)) {
        // cannot re-initialise DataTable; have to delete it and start again
        sTable.DataTable().clear().destroy();
    }
    var tbl = sTable.DataTable({
        dom : 'rtp', // show only processing indicator and table
        data : g.live_instance,
        processing : true,
        paging : true,
        columns : [
            {
                title : 'Created',
                data : 'created',
                className : 'date',
                render : {
                    display : Formatters.relativeDateDisplay,
                },
            },
            {
                title : 'Project',
                data : function(live_instance) {
                    return g.project.find(function(p){return p.id==live_instance.project_id;}).display_name;
                },
            },
            {
                title : 'Wall time',
                data : 'wall_time',
                render : { display : Formatters.timeDisplay },
            },
            {
                title : 'CPU time',
                data : 'cpu_time',
                render : { display : Formatters.timeDisplay },
            },
            {
                title : 'Name',
                data : 'name',
            },
            {
                title : 'Flavour',
                data : 'flavour',
                render : {
                    display : Formatters.flavourDisplay(g.flavour),
                    filter : function(flavour_id) { return g.flavour.find(function(f){return f.id==flavour_id;}).name; },
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
        order : [[0, 'desc']], // order by first col: most recently created first
        language : {
            zeroRecords : 'No matching live instances found.',
        },
    });
    s.removeClass('loading');

    dispatch.on('projectChanged.'+sel, function(sender_sel, puuid) {
        if(!should_lock_charts()) return;
        tbl.column('.project_id').search(puuid ? puuid : '').draw();
    });
}

function report_resources(sel, g) {
    var s = d3.select(sel);

    // compute mapping of project_id => total volume size
    var vol = {}, vol_t = 0;
    g.project.forEach(function(p) { vol[p.id] = 0 });
    g.volume.forEach(function(v) { if(v.deleted == 'None'/* TODO this is buggy and wrong; need live_volume report */) { vol[v.project_id] += +v.size; vol_t += +v.size }});

    var aggs = [ // pls don't use key "key"
        {
            key      : 'vcpus',
            title    : 'vCPU',
            format   : function(n) { return n===null ? '(no quota)' :  n + ' vcpus'; },
            quota    : function(project) { return (project.quota_vcpus === null || isNaN(+project.quota_vcpus) || +project.quota_vcpus===-1) ? null : +project.quota_vcpus },
            accessor : {
                hypervisor : function(h) { return +h.cpus },
                instance   : function(i) { return +i.vcpus },
            },
        },
        {
            key      : 'memory',
            title    : 'Memory',
            format   : function(mem_mb) { return mem_mb===null ? '(no quota)' : Formatters.si_bytes(mem_mb*1024*1024); },
            quota    : function(project) { return (project.quota_vcpus === null || isNaN(+project.quota_memory) || +project.quota_memory===-1) ? null : +project.quota_memory },
            accessor : {
                hypervisor : function(h) { return +h.memory },
                instance   : function(i) { return +i.memory },
            },
        },
        {
            key      : 'local',
            title    : 'Local storage',
            format   : function(disk_gb) { return disk_gb===null ? '(no quota)' : Formatters.si_bytes(disk_gb*1024*1024*1024); },
            quota    : function() { return null }, /* because there are no such quotas in openstack */
            accessor : {
                hypervisor : function(h) { return +h.local_storage },
                instance   : function(i) { return (+i.root) + (+i.ephemeral) },
            },
        },
        {
            key      : 'volume',
            title    : 'Allocated storage',
            format   : function(disk_gb) { return disk_gb===null ? '(no quota)' : Formatters.si_bytes(disk_gb*1024*1024*1024); },
            quota    : function(project) { return (project.quota_vcpus === null || isNaN(+project.quota_volume_total) || +project.quota_volume_total===-1) ? null : +project.quota_volume_total },
            accessor : {
                hypervisor : function() { return 0 },
                instance   : function(ins) {
                    // this is dirty and wrong but makes calculations below uniform, rather than having 'volume' as special case
                    var project_instance = g.live_instance.filter(function(i){return i.project_id==ins.project_id}).length;
                    return vol[ins.project_id]/project_instance; // so that when summed over all instances, we get back vol[puuid] -_-
                },
            },
        },
    ];

    // for pretty printing
    var pretty_key = {'used' : 'Allocated', 'free' : 'Available'};

    // store aggregated values, using title as key
    var res_tot = {}, res_used = {key:'used'}, res_free = {key:'free'};
    aggs.forEach(function(agg) {
        res_tot[agg.key]  = g.hypervisor.reduce(function(val, hyp) { return val + agg.accessor.hypervisor(hyp) }, 0);
        res_used[agg.key] = g.live_instance.reduce(function(val, ins) { return val + agg.accessor.instance(ins) }, 0);
        res_free[agg.key] = res_tot[agg.key] - res_used[agg.key];
    });
    var data = {'':[res_used, res_free]}; // indexed by project id, where '' (no project) is node-wide data

    // include project-level data
    g.project.forEach(function(p) { // initialise data[project_id] = [used, free]
        data[p.id] = [{key:'used'}, {key:'free'}];
        aggs.forEach(function(a) {
            data[p.id][0][a.key] = 0;          // used=0
            data[p.id][1][a.key] = a.quota(p); // free=quota
        });
    });
    g.live_instance.forEach(function(i) { // reduce g.live_instance, populating "used" object
        aggs.forEach(function(a) {
            data[i.project_id][0][a.key] += a.accessor.instance(i); // increase used
        });
    });
    g.project.forEach(function(p) { // calculate "free" based on quota and "used"
        aggs.forEach(function(a) {
            var quota = data[p.id][1][a.key];
            if(quota === null) {
                data[p.id][1][a.key] = null;
            } else {
                data[p.id][1][a.key] = quota - data[p.id][0][a.key];
            }
        });
    });

    // we can almost treat the 'volume' case the same as the others, but not quite... :C
    data[''][0].volume = vol_t; // necessary in case there are volumes allocated to projects with no live instances, which wouldn't be picked up above
    data[''][1].volume = null; // because, unlike vcpus/memory/local, there is no (meaningful) limit on how much external storage we may allocate

    // generate <select>s for controlling pie
    var data_key_sel = s.select('select.option')
        .on('change', function() { dispatch.optionChanged(sel, this.value); });
    data_key_sel.selectAll('option')
        .data(aggs)
      .enter().append('option')
        .attr('value', function(d) { return d.key; })
        .text(function(d) { return d.title; })
    var project_sel = s.select('select.project')
        .on('change', function() { dispatch.projectChanged(sel, this.value); });
    project_sel.select("option[value='']").remove(); // avoid creating duplicate 'All projects' options
    var psopt = project_sel.selectAll('option').data(g.project);
    psopt.enter().append('option');
    psopt
        .attr('value', function(d) { return d.id; })
        .text(function(d) { return d.display_name; });
    psopt.exit().remove();
    project_sel.insert('option', 'option')
        .attr('value', '')
        .attr('selected', '')
        .text('All projects');

    // set up pie chart
    var pie = Charts.pie()
        .key(function(d) { return d.key });
    var sPie = s.select('.chart');
    var updateChart = function() {
        var pid = project_sel.property('value');
        var dk  = data_key_sel.property('value');
        pie
            .val(function(d) { return d[dk] })
            .tip(function(d) {
                return pretty_key[d.key] + ': <span>' + aggs.find(function(a){return a.key==dk}).format(d[dk]) + '</span>';
             });
        sPie.datum(data[pid]).call(pie);
    }

    // done loading pie chart now
    updateChart();
    s.classed('loading', false);

    // listen for option change events
    dispatch.on('optionChanged.'+sel, function(sender_sel, data_key) {
        if(sel!==sender_sel && !should_lock_charts()) return;
        if(aggs.find(function(a){return a.key===data_key})) { // check if data_key makes sense in this context
            data_key_sel.property('value', data_key);
            updateChart();
        }
    });

    dispatch.on('projectChanged.'+sel, function(sender_sel, project) {
        if(sender_sel!==sel && !should_lock_charts()) return;
        project_sel.property('value', project?project:''/*workaround because <option value=null> isn't possible*/);
        updateChart();
    });
}

function report_historical(sel, g) {
    var s = d3.select(sel);
    var aggs = [ // pls don't use key "time" or "id"
        {
            key        : 'vcpus',
            title      : 'vCPU',
            tickFormat : d3.format('d'),
            intFormat  : d3.format('.2s'),
            accessor   : function(d) { return +d.vcpus },
        },
        {
            key        : 'memory',
            title      : 'Memory',
            tickFormat : function(d) { return d ? Formatters.si_bytes(d*1024*1024) : '0' },
            intFormat  : function(d) { return Formatters.si_bytes(d*1024*1024) },
            accessor   : function(d) { return +d.memory },
        },
        {
            key        : 'local',
            title      : 'Local storage',
            tickFormat : function(d) { return d ? Formatters.si_bytes(d*1024*1024*1024) : '0' },
            intFormat  : function(d) { return Formatters.si_bytes(d*1024*1024*1024) },
            accessor   : function(d) { return (+d.root) + (+d.ephemeral); },
        },
        {
            key        : 'count',
            title      : 'Instance count',
            tickFormat : d3.format('d'),
            intFormat  : d3.format('.2s'),
            accessor   : function(d) { return 1 },
        },
    ];
    var data_key = aggs[0].key;

    var slct = s.select('select.option')
        .on('change', function() { dispatch.optionChanged(sel, this.value); });
    slct.selectAll('option')
        .data(aggs)
      .enter().append('option')
        .attr('value', function(d) { return d.key })
        .text(function(d) { return d.title });

    var ps = s.select('select.project')
        .on('change', function() { dispatch.projectChanged(sel, this.value); });
    ps.selectAll('option[disabled]').remove(); // avoid creating extra placeholder options every time data changes
    var psopt = ps.selectAll('option').data(g.project);
    psopt.enter().append('option');
    psopt
        .attr('value', function(d) { return d.id; })
        .text(function(d) { return d.display_name; });
    psopt.exit().remove();
    ps.insert('option', 'option') // placeholder
        .attr('value', '')
        .attr('disabled', '')
        .attr('selected', '')
        .style('display', 'none')
        .text('Select project...');

    var sTable = $('table', $(sel));
    if($.fn.dataTable.isDataTable(sTable)) {
        // if the table is already drawn, clear existing data and get rid of DataTables instance so it can be remade
        sTable.DataTable().clear().destroy();
    }
    var tbl = sTable.DataTable({
        sel : sel,
        columns : [
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
                title : 'Allocation time',
                data : 'allocation_time',
                render : { display : Formatters.timeDisplay },
            },
            {
                title : 'Wall time',
                data : 'wall_time',
                render : { display : Formatters.timeDisplay },
            },
            {
                title : 'CPU time',
                data : 'cpu_time',
                render : { display : Formatters.timeDisplay },
            },
            {
                title : 'Name',
                data : 'name',
            },
            {
                title : 'Flavour',
                data : 'flavour',
                render : {
                    display : Formatters.flavourDisplay(g.flavour),
                    filter : function(flavour_id) { return g.flavour.find(function(f){return f.id==flavour_id;}).name; },
                },
            },
            {
                data : 'id',
                visible : false,
            },
        ],
        order : [[0, 'asc']], // order by first col: most recently created last
        processing : true,
        language : {
            zeroRecords : 'Selected project had no instances over specified date range.',
        },
    });

    // highlight points in chart when mousing over table
    $('tbody', sel).on('mouseover', 'tr', function () {
        // trying to separate jquery and d3, but jquery addClass doesn't work on svg elements
        var id = tbl.row(this).data().id;
        chart.dispatch.highlight('instance-'+id);
    });
    $('tbody', sel).on('mouseout', 'tr', function () {
        var id = tbl.row(this).data().id;
        chart.dispatch.highlight(null);
    });

    // project-level data
    var data = [], ts_data = [], ts_events = [];

    // how to sort data
    var ts_accessor = function(e) { return e.time };

    // what's currently being displayed; null means all data being shown
    var extent = null;

    // set up chart
    var sChart = s.select('.chart');
    var chart = Charts.zoom();
    chart.pointClass(function(d) { return d._meta ? 'instance-'+d._meta.id : null }); // use instance id as class name, for highlighting data points
    chart.tip().html(function(d) { return d._meta ? (d._meta.mult == 1 ? 'created ' : 'deleted ') + d._meta.name : 'now' });
    chart.dispatch.on('zoom.'+sel, function(ext) {
        dispatch.datesChanged(sChart, ext); // propagate event
    });

    // hide chart and table, for when no project is selected
    var hide = function() {
        s.selectAll('.hide').style('display', 'none');
    };

    // chart won't actually get drawn until a project is selected; so for now we're done
    hide();
    s.classed('loading', false);

    var redraw = function(skip_chart) {
        if(ts_data.length === 0) return hide();
        s.selectAll('.hide').style('display', null);

        if(!skip_chart) sChart.datum(ts_data).call(chart);
        tbl.draw();

        // calculate integral (sum rectangles' areas) over extent
        var integral = 0; // units are data_key units * milliseconds (since js dates use ms)
        var bisect = d3.bisector(ts_accessor);
        var lb = extent ? bisect.left(ts_data, extent[0]) : 0;
        var ub = extent ? bisect.right(ts_data, extent[1]) : ts_data.length;
        var working_set = ts_data.slice(lb, ub);
        if(working_set.length) {
            if(extent) {
                if(lb > 0) {
                    // include rect before first datapoint (if first datapoint is after ts_data[0])
                    // (first datapoint === working_set[0] === ts_data[lb])
                    integral += (ts_accessor(ts_data[lb]) - extent[0]) * ts_data[lb-1][data_key];
                }
                // include rect after final datapoint (reduces to zero when final datapoint is at extent[1])
                // (final datapoint === working_set[working_set.length - 1] === ts_data[ub - 1])
                integral += (extent[1] - ts_accessor(ts_data[ub-1])) * ts_data[ub-1][data_key]
            }

            // integrate over working_set time range (which is a subset of extent)
            for(var i=0; i<working_set.length-1; i++) {
                integral += (ts_accessor(working_set[i+1]) - ts_accessor(working_set[i])) * working_set[i][data_key];
            }
        } else if(ts_data.length && extent) {
            // even when no data points are in the selected domain, the integral may be nonzero.
            // empty working_set implies lb > 0 (because if lb==0, working_set must include first data point)
            integral += (extent[1]-extent[0]) * ts_data[lb-1][data_key];
        }
        s.select('span.integral').html(aggs.find(function(a){return a.key==data_key}).intFormat(integral/3600000.0)+' hours');
    };

    dispatch.on('datesChanged.'+sel, function(sender_sel, ext) {
        if(sel!==sender_sel && sender_sel!==sChart && !should_lock_charts()) return;

        // keep track of what dates are being displayed
        extent = ext;

        // add a filter function to our DataTable https://datatables.net/examples/plug-ins/range_filtering.html
        $.fn.dataTable.ext.search.pop(); // assumes there is only one DataTable with a search function
        if(ext) {
            $.fn.dataTable.ext.search.push(function(settings, _, _, instance) {
                if(settings.oInit.sel !== sel) return true; // only want to filter our own table
                // don't show instance if it was deleted before the time interval, or created after
                return !(instance._d_time < ext[0] || instance._c_time > ext[1]);
            });
        }

        // update chart
        if(sender_sel !== sChart) {
            // event has not come from chart, so this won't create an infinite loop:
            chart.dispatch.zoom(extent); // (redraws chart)
        }

        // redraw, skipping chart (that's what "true" means) because it redraws itself on chart.dispatch.zoom
        redraw(true);
    });

    dispatch.on('optionChanged.'+sel, function(sender_sel, dk) {
        if(sel!==sender_sel && sel!==sChart && !should_lock_charts()) return;
        var agg = aggs.find(function(a){return a.key===dk});
        if(agg) {
            data_key = dk;
            slct.property('value', data_key);
            chart.yZoom(function(d) { return d[data_key] });
            //TODO update chart instead of: zoom_y.domain(d3.extent(ts_data, function(d) { return d[data_key] }));
        }
        redraw();
    });

    dispatch.on('projectChanged.'+sel, function(sender_sel, puuid) {
        if(sender_sel!==sel && !should_lock_charts()) return;
        if(!puuid) {
            s.select('select').property('value', '');
            tbl.clear(); // clear table

            // remove everything from the two charts
            data = []; ts_data = []; ts_events = [];
            dispatch.datesChanged(sel, null);

            redraw();
            return;
        }
        s.classed('loading', true);
        s.select('select').property('value', puuid);

        var instances = instance_by_puuid[puuid];

        // fill data table
        tbl.clear().rows.add(instances);

        // generate time series data for this project
        ts_events = [];
        instances.forEach(function(instance) {
            var f = g.flavour.find(function(f){ return f.id===instance.flavour });
            if(! isNaN(instance._c_time)) ts_events.push({time:instance._c_time, mult:+1, instance:instance, flavour:f});
            if(! isNaN(instance._d_time)) ts_events.push({time:instance._d_time, mult:-1, instance:instance, flavour:f});
        });
        ts_events.sort(function(e1, e2) { return ts_accessor(e1) - ts_accessor(e2) });
        var context = {};
        aggs.forEach(function(agg) {
            context[agg.key] = 0;
        });
        ts_data = ts_events.map( // compute cumulative sum of ts_events
            function(e) {
                var t = this, ret = {time:e.time, _meta:{name:e.instance.name, mult:e.mult, id:e.instance.id}};
                aggs.forEach(function(agg) {
                    t[agg.key] += e.mult * agg.accessor(e.instance);
                    ret[agg.key] = t[agg.key];
                });
                return ret;
            },
            context
        );
        if(ts_data) { // append "now" data point (hack to make the graphs a bit more readable; doesn't add any extra information)
            var latest = ts_data[ts_data.length-1], now = {};
            Object.keys(latest).forEach(function(k) {
                now[k] = latest[k];
            });
            now._meta = null; // so nobody thinks there is any real instance information associated with this datapoint
            now.time = Date.now();
            ts_data.push(now);
        }

        // done
        s.classed('loading', false);
        redraw();
    });
}

function report_footer(dep, g) {
    if(g.last_updated.length == 0) {
        // panic
        d3.select(dep.sel).classed('error', true);
        return;
    }
    d3.select(dep.sel).select('.date').html(humanize.relativeTime(g.last_updated[0].timestamp));
}

function should_lock_charts() {
    return d3.select('#pielock').node().checked;
}

})(jQuery);
