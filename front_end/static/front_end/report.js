var Report = {};
(function($) {

// array of
//    sel : selector for applying loading/error classes
//    dep : sqldump keys for required data (will be stored in g[key]
//    fun : function to call after all dep data loaded (will be called with deps element as argument)
var deps = [
    {
        sel : '.resources',
        dep : ['projects', 'hypervisors', 'live_instances'],
        fun : report_resources,
    },
    {
        sel : '.overview',
        dep : ['projects', 'live_instances'],
        fun : report_overview,
    },
    {
        sel : '.live',
        dep : ['projects', 'flavours', 'live_instances'],
        fun : report_live,
    },
    {
        sel : '.historical',
        dep : ['projects', 'flavours'],
        fun : report_historical,
    },
    {
        sel : '.footer',
        dep : ['last_updated'],
        fun : report_footer,
    },
];
var g = {};

Report.init = function() {
    // concat all dependency query keys, then filter out duplicates (topsort would be too cool)
    var dep_keys = deps.reduce(function(val, dep) { return val.concat(dep.dep); }, []);
    dep_keys = dep_keys.filter(function(dep, i) { return dep_keys.indexOf(dep)==i; });
    deps.forEach(function(dep) { $(dep.sel).addClass('loading'); });
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
                }
            });
        },
        function(err) {
            // error
            deps.forEach(function(dep) {
                if(dep.dep.indexOf(key) != -1) {
                    $(dep.sel).removeClass('loading');
                    $(dep.sel).addClass('error');
                    console.log('error (%i %s) for query "%s"', err.status, err.statusText, key);
                }
            });
        }
    )});
}

var on = {
    optionChanged  : new signals.Signal(),  // when changing "vcpus", "memory", etc.
    projectChanged : new signals.Signal(),
    datesChanged   : new signals.Signal(),
};

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

function report_overview(dep) {
    var s = d3.select(dep.sel);
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
    var sel = s.select('select')
        .on('change', function() { on.optionChanged.dispatch(dep.sel, this.value); });
    sel.selectAll('option')
        .data(aggs)
      .enter().append('option')
        .attr('value', function(d) { return d.key; })
        .text(function(d) { return d.title; })

    // aggregate data
    var agg_live_instances = g.projects.map(function(p) {
        var ret = {puuid : p.uuid};
        aggs.forEach(function(f) {
            ret[f.key] = g.live_instances.filter(function(ins) { return ins.project_id == p.uuid; }).reduce(f.use_fn, 0);
        });
        return ret;
    });

    // generate pie chart; thanks to http://bl.ocks.org/mbostock/1346410
    var width = 300, height = 300, radius = Math.min(width, height)*0.5; // TODO responsive svg

    var color = d3.scale.category20();

    var pie = d3.layout.pie().sort(null);

    var arc = d3.svg.arc()
        .innerRadius(0)
        .outerRadius(radius - 10);

    var svg = s.select('.chart').append('svg') // insert after heading
        .attr('width', width)
        .attr('height', height);
    var chart = svg.append('g')
        .attr('transform', 'translate(' + width*0.5 + ',' + height*0.5 + ')');
    var path = chart.datum(agg_live_instances).selectAll('path');

    var handles_g = svg.append('g')
        .attr('class', 'handles')
        .attr('transform', 'translate(' + width*0.5 + ',' + height*0.5 + ')')
        .datum(agg_live_instances);
    var handles = handles_g.selectAll('circle');
    var tip = d3.tip()
        .attr('class', 'd3-tip')
        .direction(pie_tip_direction)
        .html(function(d) {
            var data_key = s.select('select').property('value');
            return g.projects.find(function(p) { return p.uuid == d.data.puuid }).display_name
                  + ': <span>'+aggs.find(function(a){return a.key==data_key}).format(d.data[data_key])+'</span>';
         });
    handles_g.call(tip);

    var updateChart = function() {
        pie.value(function(d) { return d[sel.property('value')] });

        handles = handles.data(pie);
        handles.enter().append('circle')
            .attr('r', 1); // r=0 gets drawn at (0,0) in firefox, so can't be used as anchor
        handles
            .attr('cx', function(d) { return pie_tip_x(arc.outerRadius()(d), d) })
            .attr('cy', function(d) { return pie_tip_y(arc.outerRadius()(d), d) });

        path = path.data(pie);
        path.enter().append('path')
            .attr('class', function(d) { return 'project-' + d.data.puuid })
            .attr('fill', function(d, i) { return color(i); })
            .on('mouseover', function(d, i) { tip.show(d, handles[0][i]) })
            .on('mouseout', tip.hide)
            .on('click', function(d) { on.projectChanged.dispatch(dep.sel, d3.select(this).classed('selected') ? null : d.data.puuid); })
            .each(function(d) { this._current = d; }); // store initial angles
        path.transition()
            .attrTween('d', arcTween(arc)); // arcTween(arc) is a tweening function to transition 'd' element
    };

    updateChart();
    s.classed('loading', false);

    on.optionChanged.add(function(sender_sel, data_key) {
        if(dep.sel!==sender_sel && !should_lock_charts()) return;
        if(aggs.find(function(a){return a.key===data_key})) { // check if data_key makes sense in this context
            sel.property('value', data_key);
            updateChart();
        }
        path.selectAll('title')
            .text(function(d) { return g.projects.find(function(p){return p.uuid==d.data.puuid;}).display_name+': '+d.data[d3.select('div.overview select').property('value')]; });
    });
    on.projectChanged.add(function(sender_sel, puuid) {
        // apply "selected" class to pie piece corresponding to puuid, if it has nonzero value (i.e. don't confuse user by selecting invisible data)
        if(dep.sel!==sender_sel && !should_lock_charts()) return;
        s.selectAll('path').classed('selected', false); // deselect everything
        var field = s.select('select').property('value'); // what field are we looking at
        var d = agg_live_instances.find(function(i){return i.puuid===puuid}); // find datum with given puuid
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

function report_live(dep) {
    var s = $(dep.sel);
    // show table
    var live_tbl = $('table', s).DataTable({
        dom : 'rt', // show only processing indicator and table
        data : g.live_instances,
        processing : true,
        paging : false, // assuming there won't be too many live instances (might be a bad assumption for production)
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
                    return g.projects.find(function(p){return p.uuid==live_instance.project_id;}).display_name;
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
                    display : Formatters.flavourDisplay(g.flavours),
                    filter : function(flavour_id) { return g.flavours.find(function(f){return f.id==flavour_id;}).name; },
                },
            },
            {
                data : 'project_id',
                className : 'project_id', // to identify column for filtering
                visible : false,
            },
            {
                data : 'uuid',
                visible : false,
            },
        ],
        order : [[0, 'desc']], // order by first col: most recently created first
        language : {
            zeroRecords : 'No matching live instances found.',
        },
    });
    s.removeClass('loading');

    on.projectChanged.add(function(sender_sel, puuid) {
        if(!should_lock_charts()) return;
        live_tbl.column('.project_id').search(puuid ? puuid : '').draw();
    });
}

function report_resources(dep) {
    var s = d3.select(dep.sel);
    var aggs = [ // pls don't use key "key"
        {
            key    : 'vcpus',
            title  : 'vCPU',
            tot_fn : function(val, hyp) { return val + (+hyp.cpus); },
            use_fn : function(val, ins) { return val + (+ins.vcpus); },
            format : function(n) { return n===null ? '(no quota)' :  n + ' vcpus'; },
            quota  : function(project) { return isNaN(+project.quota_vcpus) ? null : +project.quota_vcpus },
        },
        {
            key    : 'memory',
            title  : 'Memory',
            tot_fn : function(val, hyp) { return val + (+hyp.memory); },
            use_fn : function(val, ins) { return val + (+ins.memory); },
            format : function(mem_mb) { return mem_mb===null ? '(no quota)' : Formatters.si_bytes(mem_mb*1024*1024); },
            quota  : function(project) { return isNaN(+project.quota_memory) ? null : +project.quota_memory },
        },
        {
            key    : 'local',
            title  : 'Local storage',
            tot_fn : function(val, hyp) { return val + (+hyp.local_storage); },
            use_fn : function(val, ins) { return val + (+ins.root) + (+ins.ephemeral); }, // root and ephemeral are both stored locally
            format : function(disk_gb) { return disk_gb===null ? '(no quota)' : Formatters.si_bytes(disk_gb*1024*1024*1024); },
            quota  : function() { return null }, /* because there are no such quotas in openstack */
        },
    ];

    // for pretty printing
    var pretty_key = {'used' : 'Allocated', 'free' : 'Available'};

    // store aggregated values, using title as key
    var res_tot = {}, res_used = {key:'used'}, res_free = {key:'free'};
    aggs.forEach(function(f) {
        res_tot[f.key]  = g.hypervisors.reduce(f.tot_fn, 0);
        res_used[f.key] = g.live_instances.reduce(f.use_fn, 0);
        res_free[f.key] = res_tot[f.key] - res_used[f.key];
    });
    var data = {'':[res_used, res_free]}; // indexed by project id, where '' (no project) is node-wide data

    // include project-level data
    g.projects.forEach(function(p) { // initialise data[project_id] = [used, free]
        data[p.uuid] = [{key:'used'}, {key:'free'}];
        aggs.forEach(function(a) {
            data[p.uuid][0][a.key] = 0;          // used=0
            data[p.uuid][1][a.key] = a.quota(p); // free=quota
        });
    });
    g.live_instances.forEach(function(i) { // reduce g.live_instances, populating "used" object
        aggs.forEach(function(a) {
            data[i.project_id][0][a.key] = a.use_fn(data[i.project_id][0][a.key], i); // increase used
        });
    });
    g.projects.forEach(function(p) { // calculate "free" based on quota and "used"
        aggs.forEach(function(a) {
            var quota = data[p.uuid][1][a.key];
            if(quota === null) {
                data[p.uuid][1][a.key] = null;
            } else {
                data[p.uuid][1][a.key] = quota - data[p.uuid][0][a.key];
            }
        });
    });

    // generate <select>s for controlling pie
    var data_key_sel = s.select('select.option')
        .on('change', function() { on.optionChanged.dispatch(dep.sel, this.value); });
    data_key_sel.selectAll('option')
        .data(aggs)
      .enter().append('option')
        .attr('value', function(d) { return d.key; })
        .text(function(d) { return d.title; })
    var project_sel = s.select('select.project')
        .on('change', function() { on.projectChanged.dispatch(dep.sel, this.value); });
    project_sel.selectAll('option')
        .data(g.projects)
      .enter().append('option')
        .attr('value', function(d) { return d.uuid; })
        .text(function(d) { return d.display_name; });
    project_sel.insert('option', 'option')
        .attr('value', '')
        .attr('selected', '')
        .text('All projects');

    // generate pie chart
    var width = 300, height = 300, radius = Math.min(width, height)*0.5; // TODO responsive svg

    var pie = d3.layout.pie().sort(null);

    var arc = d3.svg.arc()
        .innerRadius(0)
        .outerRadius(radius - 10);

    var svg = s.select('.chart').append('svg')
        .attr('width', width)
        .attr('height', height);
    var chart = svg.append('g')
        .attr('transform', 'translate(' + width*0.5 + ',' + height*0.5 + ')');
    var path = chart.selectAll('path');

    var handles_g = svg.append('g')
        .attr('class', 'handles')
        .attr('transform', 'translate('+width*0.5+','+height*0.5+')');
    var handles = handles_g.selectAll('circle');
    var tip = d3.tip()
        .attr('class', 'd3-tip')
        .direction(pie_tip_direction)
        .html(function(d) {
            var dk = data_key_sel.property('value');
            return pretty_key[d.data.key] + ': <span>' + aggs.find(function(a){return a.key==dk}).format(d.data[dk]) + '</span>';
         });
    handles_g.call(tip);

    var updateChart = function() {
        chart.datum(data[project_sel.property('value')]);
        handles_g.datum(data[project_sel.property('value')]);
        pie.value(function(d) { return d[data_key_sel.property('value')] });

        handles = handles.data(pie);
        handles.enter().append('circle')
            .attr('r', 1);
        handles
            .attr('cx', function(d) { return pie_tip_x(arc.outerRadius()(d), d) })
            .attr('cy', function(d) { return pie_tip_y(arc.outerRadius()(d), d) });

        path = path.data(pie);
        path.enter().append('path')
            .attr('class', function(d, i) { return 'res-'+d.data.key; })
            .on('mouseover', function(d, i) { tip.show(d, handles[0][i]) })
            .on('mouseout', tip.hide)
            .each(function(d) { this._current = d; }); // store initial angles
        path.transition()
            .attrTween('d', arcTween(arc));
    };

    // done loading pie chart now
    updateChart();
    s.classed('loading', false);

    // listen for option change events
    on.optionChanged.add(function(sender_sel, data_key) {
        if(dep.sel!==sender_sel && !should_lock_charts()) return;
        if(aggs.find(function(a){return a.key===data_key})) { // check if data_key makes sense in this context
            data_key_sel.property('value', data_key);
            updateChart();
        }
    });

    on.projectChanged.add(function(sel, project) {
        if(dep.sel!==sel && !should_lock_charts()) return;
        project_sel.property('value', project?project:''/*workaround because <option value=null> isn't possible*/);
        updateChart();
    });
}

function report_historical(dep) {
    var s = d3.select(dep.sel);
    var aggs = [ // pls don't use key "time" or "uuid"
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

    var sel = s.select('select.option')
        .on('change', function() { on.optionChanged.dispatch(dep.sel, this.value); });
    sel.selectAll('option')
        .data(aggs)
      .enter().append('option')
        .attr('value', function(d) { return d.key })
        .text(function(d) { return d.title });

    s.select('select.project')
        .on('change', function() { on.projectChanged.dispatch(dep.sel, this.value); })
      .selectAll('option')
        .data(g.projects)
      .enter().append('option')
        .attr('value', function(d) { return d.uuid; })
        .text(function(d) { return d.display_name; });
    s.select('select.project').insert('option', 'option') // placeholder
        .attr('value', '')
        .attr('disabled', '')
        .attr('selected', '')
        .style('display', 'none')
        .text('Select project...');

    var tbl = $('table', $(dep.sel)).DataTable({
        sel : dep.sel,
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
                    display : Formatters.flavourDisplay(g.flavours),
                    filter : function(flavour_id) { return g.flavours.find(function(f){return f.id==flavour_id;}).name; },
                },
            },
            {
                data : 'uuid',
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
    $('tbody', dep.sel).on('mouseover', 'tr', function () {
        // trying to separate jquery and d3, but jquery addClass doesn't work on svg elements
        var uuid = tbl.row(this).data().uuid;
        d3.selectAll('circle.instance-'+uuid).classed('highlight', true);
    });
    $('tbody', dep.sel).on('mouseout', 'tr', function () {
        var uuid = tbl.row(this).data().uuid;
        d3.selectAll('circle.instance-'+uuid).classed('highlight', false);
    });

    // project-level data
    var data = [], ts_data = [], ts_events = [];

    // how to sort data
    var ts_accessor = function(e) { return e.time };

    // build chart TODO responsive svg
    var margin = {t:30, r:30, b:30, l:60}; // this is a comment
    var width = 900, date_height = 60, zoom_height = 300, height_sep = 30;
    var svg = s.select('.chart').append('svg')
        .attr('width', width+margin.l+margin.r)
        .attr('height', date_height+zoom_height+height_sep+margin.t+margin.b)
        .append('g')
        .attr('transform', 'translate('+margin.l+','+margin.t+')');

    // date chart elements
    var date_x = d3.time.scale().range([0, width]);
    var date_y = d3.scale.linear().range([date_height, 0]);
    var date_x_axis = d3.svg.axis().scale(date_x).orient('bottom');
    var date_y_axis = d3.svg.axis().scale(date_y).orient('left').ticks(0);
    var date_brush = d3.svg.brush().x(date_x).on('brushend', function() { on.datesChanged.dispatch(dep.sel, date_brush.empty() ? null : date_brush.extent()) });

    // zoom chart elements
    var zoom_x = d3.time.scale().range([0, width]);
    var zoom_y = d3.scale.linear().range([zoom_height, 0]);
    var zoom_x_axis = d3.svg.axis().scale(zoom_x).orient('bottom');
    var zoom_y_axis = d3.svg.axis().scale(zoom_y).orient('left');
    var zoom_brush = d3.svg.brush().x(zoom_x).on('brushend', function() { on.datesChanged.dispatch(dep.sel, zoom_brush.empty() ? null : zoom_brush.extent()) });

    // line functions
    var date_line = d3.svg.line()
        .interpolate('step-after')
        .x(function(d) { return date_x(d.time) })
        .y(function(d) { return date_y(d.count) });
    var date_area = d3.svg.area()
        .interpolate('step-after')
        .x(function(d) { return date_x(d.time) })
        .y0(date_height)
        .y1(function(d) { return date_y(d.count) });
    var zoom_line = d3.svg.line()
        .interpolate('step-after')
        .x(function(d) { return zoom_x(d.time) })
        .y(function(d) { return zoom_y(d[data_key]) });

    // date chart svg
    var date_g = svg.append('g').attr('class', 'date');
    date_g.append('path').attr('class', 'area');
    date_g.append('path').attr('class', 'line');
    date_g.append('g').attr('class', 'y axis');
    date_g.append('g').attr('class', 'x axis').attr('transform', 'translate(0,'+date_height+')');

    // date brush
    var date_brush_g = date_g.append('g').call(date_brush);
    date_brush_g.selectAll('rect').attr('height', date_height);

    // zoom chart svg (if we'll have enough data that rendering becomes slow, it might help to filter data rather than draw it all and clip)
    var zoom_g = svg.append('g').attr('class', 'zoom').attr('transform', 'translate(0,'+(+date_height+height_sep)+')');
    zoom_g.append('defs').append('clipPath').attr('id', 'zoomclip').append('rect').attr('width', width+1/*because stroke width is 2px, so could overflow*/).attr('height', zoom_height);
    zoom_g.append('path').attr('class', 'line').attr('clip-path', 'url(#zoomclip)');
    var zoom_brush_g = zoom_g.append('g').call(zoom_brush);
    var zoom_circles = zoom_g.append('g').attr('class', 'handles').attr('clip-path', 'url(#zoomclip)');
    zoom_g.append('g').attr('class', 'y axis');
    zoom_g.append('g').attr('class', 'x axis').attr('transform', 'translate(0,'+zoom_height+')');
    var zoom_tip = d3.tip().attr('class','d3-tip').offset([-10,0]).html(function(d){return (d.mult==1?'created ':'deleted ')+d.instance.name});
    zoom_g.call(zoom_tip);
    zoom_brush_g.selectAll('rect').attr('height', zoom_height);

    s.classed('loading', false);

    function redraw(do_not_animate) {
        var sel_trans = function(sel) {
            return do_not_animate ? sel : sel.transition();
        };

        // update table
        tbl.draw();

        // update date chart (don't animate emptying brush; it moves to x=0 and looks silly)
        (date_brush.empty() ? date_brush_g : sel_trans(date_brush_g)).call(date_brush);

        // update zoom chart; there is a bug causing the path to disappear when the extent becomes very small (think it's a browser svg rendering bug because firefox fails differently)
        zoom_y_axis.tickFormat(aggs.find(function(a){return a.key==data_key}).tickFormat);
        sel_trans(zoom_g.select('.x.axis')).call(zoom_x_axis);
        sel_trans(zoom_g.select('.y.axis')).call(zoom_y_axis);
        sel_trans(zoom_g.select('path.line').datum(ts_data)).attr('d', zoom_line);
        zoom_brush.clear(); // zoom chart by construction shows entire brush extent, so don't bother overlaying
        zoom_brush_g.call(zoom_brush);

        // update circles
        var circ = zoom_circles.selectAll('circle').data(ts_data);
        circ.enter().append('circle')
            .attr('r', 2) // little data point helps to find tooltips (step function is not very intuitive)
            .attr('class', function(d) { return 'instance-'+d.uuid })
            .on('mouseover', function(d, i) { zoom_tip.show(ts_events[i], this); })
            .on('mouseout', zoom_tip.hide);
        sel_trans(circ)
            .attr('cx', function(d) { return zoom_x(d.time) })
            .attr('cy', function(d) { return zoom_y(d[data_key]) });
        sel_trans(circ.exit()).remove();

        // calculate integral (sum rectangles' areas) over extent
        //extent = extent || date_x.domain(); // extent==null means whole date range selected
        extent = zoom_x.domain();
        var integral = 0; // units are data_key units * milliseconds (since js dates use ms)
        var bisect = d3.bisector(ts_accessor);
        var lb = bisect.left(ts_data, extent[0]);
        var ub = bisect.right(ts_data, extent[1]);
        var working_set = ts_data.slice(lb, ub);
        if(working_set.length) {
            if(lb > 0) {
                // include rect before first datapoint (if first datapoint is after ts_data[0])
                // (first datapoint === working_set[0] === ts_data[lb])
                integral += (ts_accessor(ts_data[lb]) - extent[0]) * ts_data[lb-1][data_key];
            }
            // include rect after final datapoint (reduces to zero when final datapoint is at extent[1])
            // (final datapoint === working_set[working_set.length - 1] === ts_data[ub - 1])
            integral += (extent[1] - ts_accessor(ts_data[ub-1])) * ts_data[ub-1][data_key]

            // integrate over working_set time range (which is a subset of extent)
            for(var i=0; i<working_set.length-1; i++) {
                integral += (ts_accessor(working_set[i+1]) - ts_accessor(working_set[i])) * working_set[i][data_key];
            }
        } else if(ts_data.length) {
            // even when no data points are in the selected domain, the integral may be nonzero.
            // empty working_set implies lb > 0 (because if lb==0, working_set must include first data point)
            integral += (extent[1]-extent[0]) * ts_data[lb-1][data_key];
        }
        s.select('span.integral').html(aggs.find(function(a){return a.key==data_key}).intFormat(integral/3600000.0)+' hours');
    }

    on.datesChanged.add(function(sel, extent, do_not_redraw) {
        // update table
        $.fn.dataTable.ext.search.pop(); // fragile
        if(extent) {
            $.fn.dataTable.ext.search.push(function(settings, _, _, instance) {
                if(settings.oInit.sel !== dep.sel) return true; // only want to filter our own table
                // don't show instance if it was deleted before the time interval, or created after
                return !(instance.d_time < extent[0] || instance.c_time > extent[1]);
            });
        }

        // update charts
        if(extent) {
            zoom_x.domain(extent);
            date_brush.extent(extent);
        } else {
            zoom_x.domain(date_x.domain());
            date_brush.clear();
        }

        if(! do_not_redraw) redraw();
    });

    on.optionChanged.add(function(sender_sel, dk) {
        if(dep.sel!==sender_sel && !should_lock_charts()) return;
        var agg = aggs.find(function(a){return a.key===dk});
        if(agg) {
            data_key = dk;
            sel.property('value', data_key);
            zoom_y.domain(d3.extent(ts_data, function(d) { return d[data_key] }));
        }
        redraw();
    });

    on.projectChanged.add(function(sel, puuid) {
        if(sel!==dep.sel && !should_lock_charts()) return;
        if(!puuid) {
            s.select('select').property('value', '');
            tbl.clear(); // clear table

            // remove everything from the two charts
            data = []; ts_data = []; ts_events = []; // clear zoomed plot
            date_x.domain([]);
            date_y.domain([]);
            zoom_y.domain([]);
            on.datesChanged.dispatch(dep.sel, null, true /*do_not_redraw*/);
            date_g.select('.x.axis').call(date_x_axis);
            date_g.select('.y.axis').call(date_y_axis);
            date_g.select('path.line').datum(ts_data).attr('d', date_line);
            date_g.select('path.area').datum(ts_data).attr('d', date_area);

            redraw(true /* do_not_animate */);
            return;
        }
        s.classed('loading', true);
        s.select('select').property('value', puuid);
        sqldump('instances/'+puuid, function(data) {
            // pollute data by preparsing dates
            data.forEach(function(d,i) {
                data[i].c_time = Date.parse(d.created);
                data[i].d_time = Date.parse(d.deleted);
            });

            // fill data table
            tbl.clear().rows.add(data);

            // generate time series data for this project
            ts_events = [];
            data.forEach(function(instance) {
                var f = g.flavours.find(function(f){ return f.id===instance.flavour });
                if(! isNaN(instance.c_time)) ts_events.push({time:instance.c_time, mult:+1, instance:instance, flavour:f});
                if(! isNaN(instance.d_time)) ts_events.push({time:instance.d_time, mult:-1, instance:instance, flavour:f});
            });
            ts_events.sort(function(e1, e2) { return ts_accessor(e1) - ts_accessor(e2) });
            var context = {};
            aggs.forEach(function(agg) {
                context[agg.key] = 0;
            });
            ts_data = ts_events.map( // compute cumulative sum of ts_events
                function(e) {
                    var t = this, ret = {time:e.time, uuid:e.instance.uuid};
                    aggs.forEach(function(agg) {
                        t[agg.key] += e.mult * agg.accessor(e.instance);
                        ret[agg.key] = t[agg.key];
                    });
                    return ret;
                },
                context
            );

            // reset domains and date range
            date_x.domain([d3.min(ts_data, ts_accessor), Date.now()]);
            date_y.domain(d3.extent(ts_data, function(d) { return d.count }));
            zoom_y.domain(d3.extent(ts_data, function(d) { return d[data_key] }));
            on.datesChanged.dispatch(dep.sel, null, true/*do_not_redraw*/);

            // date chart domain remains the same for any given project (else most of the below code would belong in redraw())
            date_g.select('.x.axis').call(date_x_axis);
            date_g.select('.y.axis').call(date_y_axis);
            date_g.select('path.line').datum(ts_data).attr('d', date_line);
            date_g.select('path.area').datum(ts_data).attr('d', date_area);
            date_g.selectAll('.x.axis .tick > text').on('click', function(d) { // don't know if there's a more elegant way to do this
                var e = d3.time.month.offset(d, 1); // one month later
                if(e > date_x.domain()[1]) e = date_x.domain()[1]; // need to clamp manually
                date_brush_g.transition().call(date_brush.extent([d,e]));
                on.datesChanged.dispatch(dep.sel, date_brush.extent());
            });

            // done
            s.classed('loading', false);
            redraw(true /* do not animate, since there is no continuity between projects */);
        }, function(error) {
            tbl.clear().draw();
            s.classed('loading', false);
            s.classed('error', true);
        });
    });
}

function report_footer(dep) {
    if(g.last_updated.length == 0) {
        // panic
        $(dep.sel).addClass('error');
        return;
    }
    $('.date', dep.sel).html(humanize.relativeTime(g.last_updated[0].timestamp));
    $(dep.sel).append($('<p></p>').append($('<a></a>').html('Update now').click(function() {
        sqldump('update', function() {
            location.reload();
        });
    })));
    $(dep.sel).removeClass('loading');
}

function should_lock_charts() {
    return d3.select('#pielock').node().checked;
}

})(jQuery);
