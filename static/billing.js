var Billing = {};
(function() {

/// scale SU by an amount based on host aggregate of instance's host (if an instance is in more than one aggregate, scale by max)
var aggregateScale = {
    'default' : 0.5,
};

/// event broadcasting
var dispatch = d3.dispatch('register', 'projectChanged', 'datesChanged');

Billing.init = function() {
    Util.initReport([
        {
            sel : '.controls',
            dep : [],
            fun : controls,
        },
        {
            sel : '#pid',
            dep : ['project?personal=0'],
            fun : projects,
        },
        {
            sel : '.perproject',
            dep : ['user', 'flavour', 'aggregate_host'],
            fun : pp,
        },
    ]);
};

var controls = function(sel) {
    if(!controls.startPicker) {
        // controls have not been initialised
        var startSelected = function(date) {
            controls.endPicker.setMinDate(date);
            dispatch.datesChanged(sel, [date.getTime(), controls.endPicker.getDate().getTime()]);
        };
        controls.endSelected = function(date) {
            controls.startPicker.setMaxDate(date);
            // date range for integration is semi-open interval [start, end)
            // so to include endPicker's date in the interval, take 00:00 on the subsequent day as the endpoint
            var nextDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()+1);
            dispatch.datesChanged(sel, [controls.startPicker.getDate().getTime(), nextDay.getTime()]);
        };
        var today = new Date();
        var firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        var lastOfMonth  = new Date(today.getFullYear(), today.getMonth()+1, 0);
        controls.startPicker = new Pikaday({
            field : document.getElementById('start'),
            defaultDate : firstOfMonth,
            setDefaultDate : true,
            onSelect : startSelected,
        });
        controls.endPicker = new Pikaday({
            field : document.getElementById('end'),
            defaultDate : lastOfMonth,
            setDefaultDate : true,
            onSelect : controls.endSelected,
        });

        // manually trigger onSelect function, to make sure dispatch.datesChanged gets called with initial date range
        controls.endSelected(controls.endPicker.getDate());
    }
    var startPicker = controls.startPicker;
    var endPicker = controls.endPicker;

    dispatch.on('datesChanged.'+sel, function(sender, extent) {
        if(sender === sel) return; // avoid infinite loop
        // if this ever gets implemented (because some additional date picker is added),
        // take day previous to extent[1] for endPicker's display date
    });
    dispatch.on('register.'+sel, function(sender, data) {
        if(sender === sel) return; // don't talk to myself
        // somebody is requesting initialisation data
        controls.endSelected(controls.endPicker.getDate()); // trigger dispatch.datesChanged
    });
    dispatch.register(sel);
};

var projects = function(sel, g) {
    var slct = d3.select(sel);
    slct.on('change', function() { dispatch.projectChanged(sel, this.value) });

    // remove any old placeholders before doing data join
    // (so report_project can be called multiple times without spamming <option>s)
    slct.selectAll('option[disabled]').remove();

    // make shallow copy of data, for sorting without altering original
    var project = g['project?personal=0']
        .map(function(d) { return {id:d.id, display_name:d.display_name} })
        .sort(function(a, b) { return d3.ascending(a.display_name.toLowerCase(), b.display_name.toLowerCase()) });

    var opt = slct.selectAll('option').data(project);
    opt.enter().append('option');
    opt.attr('value', function(d) { return d.id });
    opt.html(function(d) { return d.display_name });
    opt.exit().remove();

    // add placeholder for no project selected
    slct.insert('option', 'option')
        .attr('value', '')
        .attr('disabled', '')
        .attr('selected', '')
        .style('display', 'none')
        .text('Select project...');

    dispatch.on('projectChanged.'+sel, function(sender, pid) {
        // setting value to empty string (rather than null) shows "Select project..." option
        slct.property('value', pid || '');
    });
    dispatch.on('register.'+sel, function(sender) {
        if(sender === sel) return;
        dispatch.projectChanged(sel, slct.property('value'));
    });
    dispatch.register(sel);
};

var pp = function(sel, g) {
    var s = d3.selectAll(sel);
    var tbl = s.select('table');

    // hide this selection by default, since by default no project has been picked so "per-project" is meaningless
    s.style('display', 'none');

    // integration region is extent[0] <= time < extent[1]
    var extent = null;

    // currently selected project id
    var pid = null;

    // current working data set (subset of instance table)
    var instance = [];

    // for formatting
    var round = d3.format('.1f');
    var time = d3.time.format('%Y-%m-%d %H:%M:%S');

    // define some columns for the table, then append columns for resources
    var cols = [
        {
            title  : 'Instance',
            fn     : function(instance) { return instance.name },
            agg    : function() { return 'Total:' }, // put sum label in first column of <tfoot>
        },
        {
            title  : 'Creator',
            desc   : 'User id; in some cases need to get details from LDAP...',
            fn     : function(instance) {
                var u = g.user.find(function(u) { return u.id === instance.created_by });
                return u ? u.name : instance.created_by;
            },
        },
        {
            title  : 'Flavour',
            desc   : 'Flavour name',
            fn     : function(instance) { return instance.flavour },
            format : Formatters.flavourDisplay(g.flavour),
        },
        {
            title  : 'Availability zone',
            fn     : function(instance) { return instance._meta.hostAggregates.join(' ') },
        },
        {
            title  : 'Started',
            fn     : function(instance) { return instance.created ? time(new Date(instance.created)) : '' },
        },
        {
            title  : 'Terminated',
            fn     : function(instance) { return instance.deleted ? time(new Date(instance.deleted)) : '' },
        },
        {
            title  : 'Walltime',
            desc   : 'Hours : minutes : seconds',
            fn     : function(instance) { return instance._meta.hours },
            format : function(hours) {
                var z = d3.format('02d');
                var mins = (hours - Math.floor(hours))*60;
                var secs = (mins - Math.floor(mins))*60;
                return z(Math.floor(hours))+':'+z(Math.floor(mins))+':'+z(Math.floor(secs));
            },
            agg    : function(data) { return d3.sum(data, function(instance) { return instance._meta.hours }) },
            cl     : 'number',
        },
    ];
    var sortIdx = 4; // index into above array; sorry for ugly hard-coded value

    // SU is a special resource that we want to show in several places on the report, so let's save it for easier access
    var su = {
        title  : 'SU',
        desc   : '1 SU \u223C 1 vcpu \u00B7 4 GiB',  // \u223C is &sim; (similar to ~); \u00B7 is &middot;
        fn     : function(instance) {
            var aggScale = d3.max(instance._meta.hostAggregates, function(agg) { return aggregateScale[agg] }) || 1;
            return aggScale * Math.max(instance.vcpus, Math.ceil(instance.memory/1024/4)) * instance._meta.hours;
        },
        format : function(su) { return round(su) },
        cl     : 'number',
    };
    cols.push(su);

    // defining agg property will cause a total to be shown in the table
    su.agg = function(data) { return d3.sum(data, su.fn) };

    // set up table
    var t = Charts.table()
        .cols(cols)
        .sortIdx(sortIdx);

    // if project and date range are specified, update the table
    var updateTable = function() {
        if(!extent || !pid) {
            // some input/s missing
            s.style('display', 'none');
            return;
        }
        // all inputs specified, so results can be displayed
        s.style('display', null);

        // calculate su for months prior to extent, and plot as horizontal bar chart
        var d0 = new Date(extent[0]); // first date in range
        var dO = new Date(d3.min(instance, function(ins) { return ins.created })); // oldest date in working set (creation of first VM)
        var maxMonths = isNaN(Date.parse(dO)) ? 0 : d0.getMonth()-dO.getMonth() + 12*(d0.getFullYear()-dO.getFullYear()); // don't show further back into the past than data exist
        var nMonths = Math.min(6, maxMonths);
        var d = new Date(d0.getFullYear(), d0.getMonth() - nMonths, 1);
        var data = [];
        for(var i=0; i<nMonths; i++) {
            var e = new Date(d.getFullYear(), d.getMonth()+1, d.getDate()); // end one month after start
            var ws = countHours(instance, [d.getTime(), e.getTime()]);
            data.push({month:d.getMonth(), su:su.agg(ws)});
            d = e;
        }
        var monthFormat = d3.time.format('%b');
        var x = d3.scale.linear()
            .domain([0, d3.max(data, function(d) { return d.su })])
            .range([0, 100]);
        var chart = s.select('.chart');
        var ChartTblEnter = chart.selectAll('div').data([0]).enter().append('div').attr('class', 'tbl');
        var chartTbl = chart.select('.tbl');
        var row = chartTbl.selectAll('.crow').data(data);
        var rowEnter = row.enter().append('div').attr('class', 'crow');
        rowEnter.append('span');
        rowEnter.append('div').append('div').attr('class','bar');
        row.select('span').html(function(d) { var mon = new Date(); mon.setMonth(d.month); return monthFormat(mon); });
        row.select('.bar')
            .html(function(d) { return Math.round(d.su) })
            .style('width', function(d) { return x(d.su) + '%' });
        row.exit().remove();

        // find instances to be included in bill for this period for this project
        var ws = countHours(instance, extent);

        // update table
        tbl.datum(ws).call(t);

        // update summary
        var round = d3.format(',.2f'); // hiding another variable
        var suCount = su.agg(ws);
        d3.select('#su').attr('value', round(suCount));
        var updateTotal = function() {
            var factor = +d3.select('#factor').property('value');
            d3.select('#total').attr('value', '$\u2009'+round(factor * suCount));
        };
        d3.select('#factor').on('keyup', updateTotal);
        updateTotal();

        // update SU scaling factors
        var usedAggregates = ws.reduce(function(val, ins) { return val.concat(ins._meta.hostAggregates) }, []);
        usedAggregates = usedAggregates.filter(function(ha, i) { return usedAggregates.indexOf(ha) === i }); // filter unique
        updateScalingFactors(usedAggregates);
    };

    dispatch.on('projectChanged.'+sel, function(sender, pid_) {
        pid = pid_;
        if(!pid) {
            // TODO hide everything, since no project has been selected
            return;
        }

        // TODO refactor Fetcher so it has optional arguments with these as default
        var fetch = Fetcher(Config.endpoint, sessionStorage.getItem(Config.tokenKey), Util.on401);
        fetch.q({
            qks     : ['instance?project_id='+pid],
            start   : function() {
                // update ui
                d3.select('label[for=pid]').classed('loading', true);
                d3.select('#pid').attr('disabled', '');
            },
            success : function(data) {
                // update ui
                d3.select('#pid').attr('disabled', null);
                d3.select('label[for=pid]').classed('loading', false);

                // capture data, then pollute to avoid re-parsing dates every time
                instance = data['instance?project_id='+pid];
                instance.forEach(function(ins) {
                    ins._meta = {created : Date.parse(ins.created), deleted : Date.parse(ins.deleted)};
                    if(isNaN(ins._meta.created)) ins._meta.created = -Infinity; // so everything can be treated uniformly,
                    if(isNaN(ins._meta.deleted)) ins._meta.deleted = Infinity;  // making filtering easier
                    ins._meta.hostAggregates = [];
                    g.aggregate_host.forEach(function(ah) {
                        if(ah.host === ins.hypervisor) {
                            ins._meta.hostAggregates.push(ah.availability_zone);
                        }
                    });
                });
                updateTable();
            },
            error   : function(error) {
                console.log('error',error); // TODO handle
            },
        });
        fetch();
    });

    dispatch.on('datesChanged.'+sel, function(sender, extent_) {
        extent = extent_;
        updateTable();
    });

    dispatch.register(sel);
}

/// populate "SU scaling factors" section with values from global "aggregateScale" with specified keys
var updateScalingFactors = function(keys) {
    var s = d3.select('.scale');
    if(keys.length === 0) return s.style('display', 'none');
    s.style('display', null);

    var format = d3.format('.2f');

    var li = s.select('ul').selectAll('li').data(keys);
    li.enter().append('li');
    li.html(function(key) {
        var f = aggregateScale[key] || 1;
        return '<strong>'+key+'</strong> scaled by <strong>'+format(f)+'</strong>'
              + (f < 1 && f > 0 ? ' (overcommit factor '+format(1/f)+')' : '');
    });
    li.exit().remove();
};

/**
 * Extract and return subset of instances to be included in billing over given time period.
 * 'instance' array by defining instance[*]._meta.hours, computing how many hours
 * each instance has been allocated during extent.
 * @param
 *    instance   array of all instances
 *    extent     billing period: extent[0] <= time < extent[1] (units of milliseconds)
 * @return
 *    filtered copy of input array corresponding to instances included in integration,
 *    each element annotated with ._meta.hours, giving how many hours each instance has
 *    been allocated during extent.
 */
var countHours = function(instance, extent) {
    // find working set (all instances of current project in current time window)
    var ws = instance.filter(function(i) {
        return i._meta.created < extent[1] && i._meta.deleted >= extent[0];
    });

    // calculate instances' usage over time window
    var now = Date.now(); // upper bound on time window, to prevent extrapolation
    ws.forEach(function(i) {
        var t0 = Math.max(extent[0], i._meta.created); // lower bound of instance uptime window
        var t1 = Math.min(extent[1], i._meta.deleted, now); // upper bound (don't extrapolate)
        i._meta.hours = (t1-t0)/3600000;
    });

    return ws;
};

})();
