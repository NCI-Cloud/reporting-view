var Report = {};
(function($) {

// array of
//    sel : selector for applying loading/error classes
//    dep : sqldump keys for required data (will be stored in g[key]
//    fun : function to call after all dep data loaded (will be called with deps element as argument)
var deps = [
    {
        sel : '.resources',
        dep : ['hypervisors', 'live_instances'],
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

function change_pie(data_key, pie, path, arc) {
    // change data of pie chart to use new key for data
    pie.value(function(d) { return d[data_key]; });
    path = path.data(pie);
    path.transition().duration(750).attrTween('d', function(a) {
        // arc tween
        var i = d3.interpolate(this._current, a);
        this._current = i(0);
        return function(t) {
            return arc(i(t));
        };
    });
}

function report_overview(dep) {
    var s = d3.select(dep.sel);
    // chart synchronisation is implemented by matching keys with report_resources
    var aggs = [
        {
            key    : 'vcpus',
            title  : 'vCPU',
            use_fn : function(val, ins) { return val + (+ins.vcpus); },
        },
        {
            key    : 'memory',
            title  : 'Memory',
            use_fn : function(val, ins) { return val + (+ins.memory); },
        },
        {
            key    : 'local',
            title  : 'Local storage',
            use_fn : function(val, ins) { return val + (+ins.root) + (+ins.ephemeral); },
        },
        {
            key    : 'allocation_time',
            title  : 'Allocation time',
            use_fn : function(val, ins) { return val + (+ins.allocation_time); },
        },
        {
            key    : 'wall_time',
            title  : 'Wall time', // TODO values for this currently are all 0, which breaks the pie chart
            use_fn : function(val, ins) { return val + (+ins.wall_time); },
        },
    ];

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

    var pie = d3.layout.pie()
        .value(function(d) { return d[aggs[0].key]; });

    var arc = d3.svg.arc()
        .innerRadius(0)
        .outerRadius(radius - 10);

    var svg = s.insert('svg', ':nth-child(2)') // insert after heading
        .attr('width', width)
        .attr('height', height)
      .append('g')
        .attr('transform', 'translate(' + width*0.5 + ',' + height*0.5 + ')');

    var path = svg.datum(agg_live_instances).selectAll('path')
        .data(pie)
      .enter().append('path')
        .attr('class', function(d) { return 'project-' + d.data.puuid })
        .attr('fill', function(d, i) { return color(i); })
        .attr('d', arc)
        .on('mouseover', function(d, i) {}) // TODO eventually handle these
        .on('mouseout',  function(d, i) {})
        .on('click', function(d) { on.projectChanged.dispatch(dep.sel, d3.select(this).classed('selected') ? null : d.data.puuid); })
        .each(function(d) { this._current = d; }); // store initial angles

    // done loading pie chart now
    s.classed('loading', false);

    // generate <select> for controlling pie
    var sel = s.insert('select', 'svg')
        .on('change', function() { on.optionChanged.dispatch(dep.sel, this.value); });
    sel.selectAll('option')
        .data(aggs)
      .enter().append('option')
        .attr('value', function(d) { return d.key; })
        .text(function(d) { return d.title; })

    // TODO improve tooltips
    path
      .append('svg:title') // idk if you're even allowed to put a title inside a path
        .text(function(d) { return g.projects.find(function(p){return p.uuid==d.data.puuid;}).display_name+': '+d.data[d3.select('div.overview select').property('value')]; });

    on.optionChanged.add(function(sender_sel, data_key) {
        if(dep.sel!==sender_sel && !should_lock_charts()) return;
        if(aggs.find(function(a){return a.key===data_key})) { // check if data_key makes sense in this context
            sel.property('value', data_key);
            change_pie(data_key, pie, path, arc);
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
            s.select('p.selected').style('display', 'block');
            s.select('p:not(.selected)').style('display', 'none');
        } else {
            s.select('p.selected').style('display', 'none');
            s.select('p:not(.selected)').style('display', 'block');
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
    var aggs = [
        {
            key    : 'vcpus',
            title  : 'vCPU',
            tot_fn : function(val, hyp) { return val + (+hyp.cpus); },
            use_fn : function(val, ins) { return val + (+ins.vcpus); },
        },
        {
            key    : 'memory',
            title  : 'Memory',
            tot_fn : function(val, hyp) { return val + (+hyp.memory); },
            use_fn : function(val, ins) { return val + (+ins.memory); },
        },
        {
            key    : 'local',
            title  : 'Local storage',
            tot_fn : function(val, hyp) { return val + (+hyp.local_storage); },
            use_fn : function(val, ins) { return val + (+ins.root) + (+ins.ephemeral); }, // root and ephemeral are both stored locally
        },
    ];

    // store aggregated values, using title as key
    var res_tot = {}, res_used = {key:'used'}, res_free = {key:'free'};
    aggs.forEach(function(f) {
        res_tot[f.key]  = g.hypervisors.reduce(f.tot_fn, 0);
        res_used[f.key] = g.live_instances.reduce(f.use_fn, 0);
        res_free[f.key] = res_tot[f.key] - res_used[f.key];
    });
    var data = [res_used, res_free];

    // generate pie chart
    var width = 300, height = 300, radius = Math.min(width, height)*0.5; // TODO responsive svg

    var pie = d3.layout.pie()
        .value(function(d) { return d[aggs[0].key]; });

    var arc = d3.svg.arc()
        .innerRadius(0)
        .outerRadius(radius - 10);

    var svg = d3.select(dep.sel).append('svg')
        .attr('width', width)
        .attr('height', height)
      .append('g')
        .attr('transform', 'translate(' + width*0.5 + ',' + height*0.5 + ')');

    var path = svg.datum(data).selectAll('path')
        .data(pie)
      .enter().append('path')
        .attr('class', function(d, i) { return 'res-'+d.data.key; })
        .attr('d', arc)
        .each(function(d) { this._current = d; }); // store initial angles

    // done loading pie chart now
    d3.select(dep.sel).classed('loading', false);

    // generate <select> for controlling pie
    var sel = d3.select(dep.sel)
      .insert('select', 'svg')
        .on('change', function() { on.optionChanged.dispatch(dep.sel, this.value); });
    sel.selectAll('option')
        .data(aggs)
      .enter().append('option')
        .attr('value', function(d) { return d.key; })
        .text(function(d) { return d.title; })

    // TODO improve tooltips
    path
      .append('svg:title') // idk if you're even allowed to put a title inside a path
        .text(function(d) { return d.data.key; });

    // listen for option change events
    on.optionChanged.add(function(sender_sel, data_key) {
        if(dep.sel!==sender_sel && !should_lock_charts()) return;
        if(aggs.find(function(a){return a.key===data_key})) { // check if data_key makes sense in this context
            sel.property('value', data_key);
            change_pie(data_key, pie, path, arc);
        }
    });
}

function report_historical(dep) {
    var s = d3.select(dep.sel);
    var aggs = [ // pls don't use key "time"
        {
            key        : 'vcpus',
            title      : 'vCPU',
            tickFormat : d3.format('d'),
            accessor   : function(d) { return +d.vcpus },
        },
        {
            key        : 'memory',
            title      : 'Memory',
            tickFormat : function(d) { return d ? Formatters.si_bytes(d*1024*1024) : '0' },
            accessor   : function(d) { return +d.memory },
        },
        {
            key        : 'local',
            title      : 'Local storage',
            tickFormat : function(d) { return d ? Formatters.si_bytes(d*1024*1024*1024) : '0' },
            accessor   : function(d) { return (+d.root) + (+d.ephemeral); },
        },
        {
            key        : 'count',
            title      : 'Instance count',
            tickFormat : d3.format('d'),
            accessor   : function(d) { return 1 },
        },
    ];
    var data_key = aggs[0].key;

    var sel = s.insert('select', '.chart')
        .on('change', function() { on.optionChanged.dispatch(dep.sel, this.value); });
    sel.selectAll('option')
        .data(aggs)
      .enter().append('option')
        .attr('value', function(d) { return d.key })
        .text(function(d) { return d.title });

    s.insert('select', 'select')
        .attr('class', 'project')
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
        order : [[0, 'desc']], // order by first col: most recently created first
        processing : true,
        language : {
            zeroRecords : 'Select a project to view its instances.',
        },
    });

    // project-level data
    var data = [], ts_data = [], ts_events = [];

    // how to sort data
    var ts_comparator = function(e1, e2) { return e1.time - e2.time };
    var ts_bisector = d3.bisector(function(e,d) { return e.time - d; }).left;

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
    var zoom_y_axis = d3.svg.axis().scale(zoom_y).orient('left'); // TODO axis format (depends on accessor, should be in aggs)
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
    zoom_g.append('g').attr('class', 'y axis');
    zoom_g.append('g').attr('class', 'x axis').attr('transform', 'translate(0,'+zoom_height+')');
    var zoom_x_bar = zoom_g.append('line').attr('class', 'bar').attr('y1',0).attr('y2',zoom_height);
    var zoom_tip = d3.tip().attr('class','d3-tip').html(function(d){return (d.mult==1?'created ':'deleted ')+d.instance.name});
    zoom_g.call(zoom_tip);
    var zoom_brush_g = zoom_g.append('g').call(zoom_brush);
    zoom_brush_g.selectAll('rect').attr('height', zoom_height).on('mousemove', function() {
        // find ts_events element with time closest to d
        var d = zoom_x.invert(d3.mouse(this)[0]);
        var i = ts_bisector(ts_events, d); // locates insertion index for d in (date-sorted) ts_events
        if(i == ts_events.length) {
            // insertion index off end => mouse at last element
            i -= 1;
        } else if(ts_events[i-1]) {
            // make sure i is the index of the closest ts_event, not necessarily the next ts_event
            var di = ts_events[i].time - d,
                dh = d - ts_events[i-1].time;
            if(dh < di) i -= 1;
        }
        // show some information about the event
        var x = zoom_x(ts_events[i].time);
        zoom_x_bar.attr('x1', x).attr('x2', x).style('display', 'inline');
        zoom_tip.show(ts_events[i], zoom_g.select('.bar').node());
    }).on('mouseout', function() {
        zoom_x_bar.style('display', 'none');
        zoom_tip.hide();
    });

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
        var circ = zoom_g.selectAll('circle').data(ts_data);
        circ.enter().append('circle')
            .attr('r', 5)
            .on('click', function(d, i) {
                // show tooltip, as fallback for devices without :hover (this is pretty dodgy though)
                zoom_tip.show(ts_events[i], this);
             });
        sel_trans(circ)
            .attr('cx', function(d) { return zoom_x(d.time) })
            .attr('cy', function(d) { return zoom_y(d[data_key]) });
        sel_trans(circ.exit()).remove();
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
            accessor = function(d) { return d[data_kay] };
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
            ts_events.sort(ts_comparator);
            var context = {};
            aggs.forEach(function(agg) {
                context[agg.key] = 0;
            });
            ts_data = ts_events.map( // compute cumulative sum of ts_events
                function(e) {
                    var t = this, ret = {time:e.time};
                    aggs.forEach(function(agg) {
                        t[agg.key] += e.mult * agg.accessor(e.instance);
                        ret[agg.key] = t[agg.key];
                    });
                    return ret;
                },
                context
            );

            // reset domains and date range
            date_x.domain(d3.extent(ts_data, function(d) { return d.time }));
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
