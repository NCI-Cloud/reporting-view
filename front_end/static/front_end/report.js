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
    s.insert('select', '.chart')
        .attr('class', 'project')
        .on('change', function() { on.projectChanged.dispatch(dep.sel, this.value); })
      .selectAll('option')
        .data(g.projects)
      .enter().append('option')
        .attr('value', function(d) { return d.uuid; })
        .text(function(d) { return d.display_name; });
    s.select('select').insert('option', 'option') // placeholder
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
    s.classed('loading', false);

    on.datesChanged.add(function(sel, extent) {
        $.fn.dataTable.ext.search.pop(); // fragile
        if(extent==null) return tbl.draw();
        $.fn.dataTable.ext.search.push(function(settings, _, _, instance) {
            if(settings.oInit.sel !== dep.sel) return true; // only want to filter our own table
            // don't show instance if it was deleted before the time interval, or created after
            return !(instance.d_time < extent[0] || instance.c_time > extent[1]);
        });
        tbl.draw();
    });

    on.projectChanged.add(function(sel, puuid) {
        if(sel!==dep.sel && !should_lock_charts()) return;
        if(!puuid) {
            s.select('select').property('value', '');
            tbl.clear().draw();
            s.selectAll('svg').remove();
            return;
        }
        s.classed('loading', true);
        s.select('select').property('value', puuid);
        sqldump('instances/'+puuid, function(data) {
            // pollute data by preparsing dates, then sort by c_time TODO sort may be unnecessary
            data.forEach(function(d,i) {
                data[i].c_time = Date.parse(d.created);
                data[i].d_time = Date.parse(d.deleted);
            });
            data.sort(function(i1, i2) { return i2.c_time - i1.c_time });

            // fill data table
            tbl.clear().rows.add(data).draw();

            // TODO would be nicer just to update instead of removing and recreating
            s.selectAll('svg').remove();

            // generate time series data
            var ts_events = [];
            data.forEach(function(instance) {
                if(! isNaN(instance.c_time)) ts_events.push({time:instance.c_time, count:+1});
                if(! isNaN(instance.d_time)) ts_events.push({time:instance.d_time, count:-1});
            });
            ts_events.sort(function(e1, e2) { return e1.time - e2.time });
            var context = {total_instances : 0};
            var ts_data = ts_events.map(
                function(e) {
                    this.total_instances += e.count;
                    return {time:e.time, count:this.total_instances};
                },
                context
            );

            // build chart TODO responsive svg
            var margin = {t:30, r:30, b:30, l:30}; // this is a comment
            var width = 900, height = 60;

            var svg = s.select('.chart').append('svg')
                .attr('width', width+margin.l+margin.r)
                .attr('height', height+margin.t+margin.b)
                .append('g')
                .attr('transform', 'translate('+margin.l+','+margin.t+')');

            var x = d3.time.scale()
                .domain(d3.extent(ts_data, function(d) { return d.time }))
                .range([0, width]);
            var y = d3.scale.linear()
                .domain(d3.extent(ts_data, function(d) { return d.count }))
                .range([height,0]);

            var xAxis = d3.svg.axis()
                .scale(x)
                .orient('bottom');
            var yAxis = d3.svg.axis()
                .tickFormat(d3.format('d'))
                .tickSubdivide(0)
                .ticks(3)
                .scale(y)
                .orient('left');

            var line = d3.svg.line()
                .interpolate('step-after')
                .x(function(d) { return x(d.time) })
                .y(function(d) { return y(d.count) });

            var area = d3.svg.area()
                .interpolate('step-after')
                .x(function(d) { return x(d.time) })
                .y0(height)
                .y1(function(d) { return y(d.count) });

            var view = d3.svg.brush()
                .x(x)
                .on('brushend', function() { on.datesChanged.dispatch(dep.sel, view.empty() ? null : view.extent()) });

            // plot data
            svg.append('path')
                .datum(ts_data)
                .attr('class', 'area')
                .attr('d', area);
            svg.append('path')
                .datum(ts_data)
                .attr('class', 'line')
                .attr('d', line);

            // plot axes
            svg.append('g')
                .attr('class', 'axis')
                .call(yAxis);
            svg.append('g')
                .attr('transform', 'translate(0,'+height+')')
                .attr('class', 'axis')
                .call(xAxis)
              .selectAll('.tick > text')
                .on('click', function(d) {
                    var e = d3.time.month.offset(d, 1); // one month later
                    if(e > x.domain()[1]) e = x.domain()[1]; // need to clamp manually
                    ds.transition().call(view.extent([d,e]));
                    on.datesChanged.dispatch(dep.sel, view.extent());
                 });

            // plot date range selector
            var ds = svg.append('g')
                .call(view);
            ds.selectAll('rect')
                .attr('height', height);

            s.classed('loading', false);
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
