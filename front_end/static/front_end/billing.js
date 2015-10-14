var Billing = {};
(function() {

/// scale SU by an amount based on host aggregate of instance's host (if an instance is in more than one aggregate, scale by max)
var aggregateScale = {
    'hpc' : 2,
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
            dep : ['project'],
            fun : projects,
        },
        {
            sel : '.perproject',
            dep : ['instance', 'user', 'flavour', 'aggregate_host'],
            fun : pp,
        },
        {
            sel : '.ha',
            dep : [], // this section gets data from global "aggretateScale" ewww
            fun : ha,
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
        // TODO set dates
        // (take day previous to extent[1] for endPicker's display date)
        console.log('set bounds on date pickers');
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
    var project = g.project
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
    var s = d3.select(sel);
    var tbl = s.select('table');

    // hide this selection by default, since by default no project has been picked so "per-project" is meaningless
    s.style('display', 'none');

    // integration region is extent[0] <= time < extent[1]
    var extent = null;

    // currently selected project id
    var pid = null;

    // pollute data to avoid re-parsing dates every time
    g.instance.forEach(function(ins) {
        ins._meta = {created : Date.parse(ins.created), deleted : Date.parse(ins.deleted)};
        if(isNaN(ins._meta.created)) ins._meta.created = -Infinity; // so everything can be treated uniformly,
        if(isNaN(ins._meta.deleted)) ins._meta.deleted = Infinity;  // making filtering easier
        ins._meta.hostAggregates = [];
        g.aggregate_host.forEach(function(ah) {
            if(ah.host === ins.hypervisor) {
                ins._meta.hostAggregates.push(ah.aggregate);
            }
        });
    });

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
                if(u) {
                    // user exists in keystone
                    return u.name;
                }
                // TODO look up in ldap
                return instance.created_by
            },
        },
        {
            title  : 'Flavour',
            desc   : 'Flavour name',
            fn     : function(instance) { return instance.flavour },
            format : Formatters.flavourDisplay(g.flavour),
        },
        {
            title  : 'AZ',
            desc   : 'Host aggregates [sic]',
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
        {
            title  : 'SU',
            desc   : '1 SU \u223C 1 vcpu \u00B7 4 GiB',  // \u223C is &sim; (similar to ~); \u00B7 is &middot;
            fn     : function(instance) {
                var aggScale = d3.max(instance._meta.hostAggregates, function(agg) { return aggregateScale[agg] }) || 1;
                return aggScale * Math.max(instance.vcpus, Math.ceil(instance.memory/1024/4)) * instance._meta.hours;
            },
            format : function(su) { return round(su) },
            cl     : 'number',
        },
    ];

    // SU is a special resource that we want to show in several places on the report, so let's save its index in the array for easier access
    var suIdx = cols.findIndex(function(c) { return c.title === 'SU' });

    // defining agg property will cause a total to be shown in the table
    cols[suIdx].agg = function(data) { return d3.sum(data, cols[suIdx].fn) };

    // set up table
    var t = Charts.table().cols(cols);

    // if project and date range are specified, update the table
    var updateTable = function() {
        if(!extent || !pid) {
            // some input/s missing
            s.style('display', 'none');
            return;
        }
        // all inputs specified, so results can be displayed
        s.style('display', null);

        // find instances to be included in bill for this period for this project
        var ws = countHours(g.instance, pid, extent);

        // update table
        tbl.datum(ws).call(t);
    };

    dispatch.on('projectChanged.'+sel, function(sender, pid_) {
        pid = pid_;
        updateTable();
    });

    dispatch.on('datesChanged.'+sel, function(sender, extent_) {
        extent = extent_;
        updateTable();
    });

    dispatch.register(sel);
}

var ha = function(sel) {
    var s = d3.select(sel);
    if(!Object.keys(aggregateScale).length) return s.style('display', 'none');
    var d = Object.keys(aggregateScale).map(function(agg) { return {name : agg, scale : aggregateScale[agg]} });
    var li = s.select('ul').selectAll('li').data(d);
    li.enter().append('li');
    li.html(function(d) { return '<strong>'+d.name+'</strong> &times;'+d.scale });
    li.exit().remove();
};

/**
 * Extract and return subset of instances to be included in billing over given time period.
 * 'instance' array by defining instance[*]._meta.hours, computing how many hours
 * each instance has been allocated during extent.
 * @param
 *    instance   array of all instances
 *    pid        id of project being billed
 *    extent     billing period: extent[0] <= time < extent[1] (units of milliseconds)
 * @return
 *    filtered copy of input array corresponding to instances included in integration,
 *    each element annotated with ._meta.hours, giving how many hours each instance has
 *    been allocated during extent.
 */
var countHours = function(instance, pid, extent) {
    // find working set (all instances of current project in current time window)
    var ws = instance.filter(function(i) {
        return i.project_id === pid && i._meta.created < extent[1] && i._meta.deleted >= extent[0];
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
