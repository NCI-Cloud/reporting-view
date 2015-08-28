var Report = {};
(function($) {

/// reference to data from current endpoint
var g = {};

/// event broadcasting
var dispatch = d3.dispatch('optionChanged', 'projectChanged', 'datesChanged');

// TODO refactor to avoid duplicating this code between reports
Report.init = function() {
    var fetch = Fetcher(Config.endpoints);
    Util.qdeps(fetch, [
        {
            sel : null,
            dep : ['instances'],
            fun : preprocess_instances, // Fetcher will invoke callbacks in the order they're queued, so this comes before anything else depending on projects
        },
        {
            sel : '.resources',
            dep : ['projects', 'hypervisors', 'live_instances', 'volumes'],
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
            dep : ['projects', 'flavours', 'instances'],
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

/// rearrange instances data so we can efficiently group by project
function preprocess_instances() {
    g._instances_by_puuid = {};
    g.instances.forEach(function(ins) {
        if(! (ins.project_id in g._instances_by_puuid)) {
            g._instances_by_puuid[ins.project_id] = [];
        }

        // pollute data by preparsing dates
        ins._c_time = Date.parse(ins.created);
        ins._d_time = Date.parse(ins.deleted);

        g._instances_by_puuid[ins.project_id].push(ins);
    });
}

function report_overview(sel) {
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
        pie.value(function(d) { return d[slct.property('value')] });

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
            .on('click', function(d) { dispatch.projectChanged(sel, d3.select(this).classed('selected') ? null : d.data.puuid); })
            .each(function(d) { this._current = d; }); // store initial angles
        path.transition()
            .attrTween('d', arcTween(arc)); // arcTween(arc) is a tweening function to transition 'd' element
    };

    updateChart();
    s.classed('loading', false);

    dispatch.on('optionChanged.'+sel, function(sender_sel, data_key) {
        if(sel!==sender_sel && !should_lock_charts()) return;
        if(aggs.find(function(a){return a.key===data_key})) { // check if data_key makes sense in this context
            slct.property('value', data_key);
            updateChart();
        }
        path.selectAll('title')
            .text(function(d) { return g.projects.find(function(p){return p.uuid==d.data.puuid;}).display_name+': '+d.data[d3.select('div.overview select').property('value')]; });
    });
    dispatch.on('projectChanged.'+sel, function(sender_sel, puuid) {
        // apply "selected" class to pie piece corresponding to puuid, if it has nonzero value (i.e. don't confuse user by selecting invisible data)
        if(sel!==sender_sel && !should_lock_charts()) return;
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

function report_live(sel) {
    var s = $(sel);
    // show table
    var live_tbl = $('table', s).DataTable({
        dom : 'rtp', // show only processing indicator and table
        data : g.live_instances,
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

    dispatch.on('projectChanged.'+sel, function(sender_sel, puuid) {
        if(!should_lock_charts()) return;
        live_tbl.column('.project_id').search(puuid ? puuid : '').draw();
    });
}

function report_resources(sel) {
    var s = d3.select(sel);

    // compute mapping of project_id => total volume size
    var vol = {}, vol_t = 0;
    g.projects.forEach(function(p) { vol[p.uuid] = 0 });
    g.volumes.forEach(function(v) { if(v.deleted == 'None'/* TODO live_volumes report would be better */) { vol[v.project_id] += +v.size; vol_t += +v.size }});

    var aggs = [ // pls don't use key "key"
        {
            key      : 'vcpus',
            title    : 'vCPU',
            format   : function(n) { return n===null ? '(no quota)' :  n + ' vcpus'; },
            quota    : function(project) { return (isNaN(+project.quota_vcpus) || +project.quota_vcpus===-1) ? null : +project.quota_vcpus },
            accessor : {
                hypervisors : function(h) { return +h.cpus },
                instances   : function(i) { return +i.vcpus },
            },
        },
        {
            key      : 'memory',
            title    : 'Memory',
            format   : function(mem_mb) { return mem_mb===null ? '(no quota)' : Formatters.si_bytes(mem_mb*1024*1024); },
            quota    : function(project) { return (isNaN(+project.quota_memory) || +project.quota_memory===-1) ? null : +project.quota_memory },
            accessor : {
                hypervisors : function(h) { return +h.memory },
                instances   : function(i) { return +i.memory },
            },
        },
        {
            key      : 'local',
            title    : 'Local storage',
            format   : function(disk_gb) { return disk_gb===null ? '(no quota)' : Formatters.si_bytes(disk_gb*1024*1024*1024); },
            quota    : function() { return null }, /* because there are no such quotas in openstack */
            accessor : {
                hypervisors : function(h) { return +h.local_storage },
                instances   : function(i) { return (+i.root) + (+i.ephemeral) },
            },
        },
        {
            key      : 'volume',
            title    : 'Allocated storage',
            format   : function(disk_gb) { return disk_gb===null ? '(no quota)' : Formatters.si_bytes(disk_gb*1024*1024*1024); },
            quota    : function(project) { return (isNaN(+project.quota_volume_total) || +project.quota_volume_total===-1) ? null : +project.quota_volume_total },
            accessor : {
                hypervisors : function() { return 0 },
                instances   : function(ins) {
                    // this is dirty and wrong but makes calculations below uniform, rather than having 'volume' as special case
                    var project_instances = g.live_instances.filter(function(i){return i.project_id==ins.project_id}).length;
                    return vol[ins.project_id]/project_instances; // so that when summed over all instances, we get back vol[puuid] -_-
                },
            },
        },
    ];

    // for pretty printing
    var pretty_key = {'used' : 'Allocated', 'free' : 'Available'};

    // store aggregated values, using title as key
    var res_tot = {}, res_used = {key:'used'}, res_free = {key:'free'};
    aggs.forEach(function(agg) {
        res_tot[agg.key]  = g.hypervisors.reduce(function(val, hyp) { return val + agg.accessor.hypervisors(hyp) }, 0);
        res_used[agg.key] = g.live_instances.reduce(function(val, ins) { return val + agg.accessor.instances(ins) }, 0);
        res_free[agg.key] = res_tot[agg.key] - res_used[agg.key];
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
            data[i.project_id][0][a.key] += a.accessor.instances(i); // increase used
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

function report_historical(sel) {
    var s = d3.select(sel);
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

    var slct = s.select('select.option')
        .on('change', function() { dispatch.optionChanged(sel, this.value); });
    slct.selectAll('option')
        .data(aggs)
      .enter().append('option')
        .attr('value', function(d) { return d.key })
        .text(function(d) { return d.title });

    s.select('select.project')
        .on('change', function() { dispatch.projectChanged(sel, this.value); })
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

    var tbl = $('table', $(sel)).DataTable({
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
    $('tbody', sel).on('mouseover', 'tr', function () {
        // trying to separate jquery and d3, but jquery addClass doesn't work on svg elements
        var uuid = tbl.row(this).data().uuid;
        d3.selectAll('circle.instance-'+uuid).classed('highlight', true);
    });
    $('tbody', sel).on('mouseout', 'tr', function () {
        var uuid = tbl.row(this).data().uuid;
        d3.selectAll('circle.instance-'+uuid).classed('highlight', false);
    });

    // project-level data
    var data = [], ts_data = [], ts_events = [];

    // how to sort data
    var ts_accessor = function(e) { return e.time };

    // build chart TODO responsive svg
    var margin = {t:30, r:60, b:30, l:60};
    var width = 870, date_height = 60, zoom_height = 300, height_sep = 30;
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
    var date_brush = d3.svg.brush().x(date_x).on('brushend', function() { dispatch.datesChanged(sel, date_brush.empty() ? null : date_brush.extent()) });

    // zoom chart elements
    var zoom_x = d3.time.scale().range([0, width]);
    var zoom_y = d3.scale.linear().range([zoom_height, 0]);
    var zoom_x_axis = d3.svg.axis().scale(zoom_x).orient('bottom');
    var zoom_y_axis = d3.svg.axis().scale(zoom_y).orient('left');
    var zoom_brush = d3.svg.brush().x(zoom_x).on('brushend', function() { dispatch.datesChanged(sel, zoom_brush.empty() ? null : zoom_brush.extent()) });

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
        var sel_trans = function(selection) {
            return do_not_animate ? selection : selection.transition();
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
        var circ = zoom_circles.selectAll('circle').data(ts_data.slice(0,-1)); // last element of ts_data is artifical "now" data point, which shouldn't be marked
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

    dispatch.on('datesChanged.'+sel, function(sender_sel, extent, do_not_redraw) {
        // update table
        $.fn.dataTable.ext.search.pop(); // fragile
        if(extent) {
            $.fn.dataTable.ext.search.push(function(settings, _, _, instance) {
                if(settings.oInit.sel !== sender_sel) return true; // only want to filter our own table
                // don't show instance if it was deleted before the time interval, or created after
                return !(instance._d_time < extent[0] || instance._c_time > extent[1]);
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

    dispatch.on('optionChanged.'+sel, function(sender_sel, dk) {
        if(sel!==sender_sel && !should_lock_charts()) return;
        var agg = aggs.find(function(a){return a.key===dk});
        if(agg) {
            data_key = dk;
            slct.property('value', data_key);
            zoom_y.domain(d3.extent(ts_data, function(d) { return d[data_key] }));
        }
        redraw();
    });

    dispatch.on('projectChanged.'+sel, function(sender_sel, puuid) {
        if(sender_sel!==sel && !should_lock_charts()) return;
        if(!puuid) {
            s.select('select').property('value', '');
            tbl.clear(); // clear table

            // remove everything from the two charts
            data = []; ts_data = []; ts_events = []; // clear zoomed plot
            date_x.domain([]);
            date_y.domain([]);
            zoom_y.domain([]);
            dispatch.datesChanged(sel, null, true /*do_not_redraw*/);
            date_g.select('.x.axis').call(date_x_axis);
            date_g.select('.y.axis').call(date_y_axis);
            date_g.select('path.line').datum(ts_data).attr('d', date_line);
            date_g.select('path.area').datum(ts_data).attr('d', date_area);

            redraw(true /* do_not_animate */);
            return;
        }
        s.classed('loading', true);
        s.select('select').property('value', puuid);

        var instances = g._instances_by_puuid[puuid];

        // fill data table
        tbl.clear().rows.add(instances);

        // generate time series data for this project
        ts_events = [];
        instances.forEach(function(instance) {
            var f = g.flavours.find(function(f){ return f.id===instance.flavour });
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
                var t = this, ret = {time:e.time, uuid:e.instance.uuid};
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
            now.uuid = null;
            now.time = Date.now();
            ts_data.push(now);
        }

        // reset domains and date range
        date_x.domain(d3.extent(ts_data, ts_accessor));
        date_y.domain(d3.extent(ts_data, function(d) { return d.count }));
        zoom_y.domain(d3.extent(ts_data, function(d) { return d[data_key] }));
        dispatch.datesChanged(sel, null, true/*do_not_redraw*/);

        // date chart domain remains the same for any given project (else most of the below code would belong in redraw())
        date_g.select('.x.axis').call(date_x_axis);
        date_g.select('.y.axis').call(date_y_axis);
        date_g.select('path.line').datum(ts_data).attr('d', date_line);
        date_g.select('path.area').datum(ts_data).attr('d', date_area);
        date_g.selectAll('.x.axis .tick > text').on('click', function(d) { // don't know if there's a more elegant way to do this
            var e = d3.time.month.offset(d, 1); // one month later
            if(e > date_x.domain()[1]) e = date_x.domain()[1]; // need to clamp manually
            date_brush_g.transition().call(date_brush.extent([d,e]));
            dispatch.datesChanged(sel, date_brush.extent());
        });

        // done
        s.classed('loading', false);
        redraw(true /* do not animate, since there is no continuity between projects */);
    });
}

function report_footer(dep) {
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
