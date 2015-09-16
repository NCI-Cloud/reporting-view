var Billing = {};
(function() {

/// event broadcasting
var dispatch = d3.dispatch('register', 'projectChanged', 'datesChanged');

// TODO refactor to avoid duplicating this code between reports
Billing.init = function() {
    var fetch = Fetcher(Config.endpoints);
    Util.fillNav(fetch);
    Util.qdeps(fetch, [
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
            dep : ['instance', 'user', 'flavour'],
            fun : pp,
        },
    ]);
    var ep_name = Config.defaultEndpoint;
    fetch(ep_name);
}

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

    var opt = slct.selectAll('option').data(g.project);
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

    dispatch.on('projectChanged', function(sender, pid) {
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
    var dl = s.select('dl');
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
        if(isNaN(ins._meta.created)) ins._meta.created = -Infinity;
        if(isNaN(ins._meta.deleted)) ins._meta.deleted = Infinity; // to make integration and filtering easier
    });

    // what gets shown in <dl>
    var dlData = [
        {
            title : 'Total SU',
            fn    : function() {
                return Math.round(Math.random()*100);
            },
        },
        {
            title : 'Core hours',
            fn    : function(instances, extent) {
                return Math.round(Math.random()*50);
            },
        },
    ];

    var t = Table().cols([
        {
            title : 'Instance',
            fn    : function(d) { return d.name },
        },
        {
            title : 'Creator',
            desc  : 'User id; need to get details from LDAP...',
            fn    : function(d) { return d.created_by }, // TODO look up in g.user or ldap
        },
        {
            title : 'Flavour',
            fn    : function(d) { return d.flavour }, // TODO look up in g.flavour
        },
        {
            title : 'VCPU hours',
            fn    : function(d) { return d._meta.vcpu },
        },
        {
            title : 'SU',
            desc  : '#define SU ???',
            fn    : function(d) { return d._meta.su },
        },
    ]);

    /// perform calculations over extent for project pid
    var integrate = function() {
        if(!extent || !pid) {
            // some input/s missing
            s.style('display', 'none');
            return;
        }
        // all inputs specified, so results can be displayed
        s.style('display', null);

        // find working set (all instances of current project in current time window)
        var ws = g.instance.filter(function(i) {
            return i.project_id === pid && i._meta.created < extent[1] && i._meta.deleted >= extent[0];
        });

        // calculate instances' usage over time window
        ws.forEach(function(i) {
            var f = g.flavour.find(function(f) { return f.id == i.flavour });
            if(!f) { console.log('unknown flavour for instance %o', i) }
            var t0 = Math.max(extent[0], i._meta.created); // lower bound of instance uptime window
            var t1 = Math.min(extent[1], i._meta.deleted); // upper bound
            // TODO calculate stuff
            i._meta.vcpu = 12;
            i._meta.su = 3;
        });

        // perform integration
        console.log('integrating for project %o over dates:', pid)
        console.log(new Date(extent[0]));
        console.log(new Date(extent[1]));


        // update table
        tbl.datum(ws).call(t);

        // update dl
        var div = dl.selectAll('div').data(dlData);
        var divEnter = div.enter().append('div');
        divEnter.append('dt');
        divEnter.append('dd');
        div.select('dt').html(function(d) { return d.title });
        div.select('dd').html(function(d) { return d.fn() }); // TODO will need to pass some integrated data
        div.exit().remove();
    };

    dispatch.on('projectChanged', function(sender, pid_) {
        pid = pid_;
        integrate();
    });

    dispatch.on('datesChanged', function(sender, extent_) {
        extent = extent_;
        integrate();
    });

    dispatch.register(sel);
}

function Table() {
    /// array of {title:string, fn:function taking datum outputting string}
    /**
     * array of {
     *  title : string to put in <th>
     *  fn    : function, to put fn(datum) in <td>
     *  desc  : string, to put as title attribute of <th> (optional)
     * }
     */
    var cols = [];

    /// index into cols, for ordering data
    var sortIdx = 0;

    /// d3.ascending or d3.desending
    var sortOrder = d3.descending;

    function table(selection) {
        // wrap this in a function it can be called recursively, allowing the table to update itself
        var makeTable = function(tbl, dataUnsorted) {
            // make shallow copy of data, for sorting without altering original
            var data = dataUnsorted
                .map(function(d) { return d })
                .sort(function(a, b) { return sortOrder(cols[sortIdx].fn(a), cols[sortIdx].fn(b)) });

            // set up <thead> and <tbody>
            var thead = tbl.selectAll('thead').data([data]);
            thead.enter().append('thead').append('tr');
            var th = thead.select('tr').selectAll('th').data(cols);
            th.enter().append('th')
                .on('click', function(d, i) {
                    if(sortIdx === i) {
                        // toggle order
                        sortOrder = sortOrder === d3.descending ? d3.ascending : d3.descending;
                    } else {
                        sortIdx = i;
                    }
                    makeTable(tbl, dataUnsorted); // redraw table
                })
                .attr('title', function(d) { return d.desc })
                .html(function(d) { return d.title });
            th.attr('class', function(d, i) { return i === sortIdx ? (sortOrder === d3.descending ? 'descending' : 'ascending') : null });
            var tbody = tbl.selectAll('tbody').data([data]);
            tbody.enter().append('tbody');

            // make rows
            var row = tbody.selectAll('tr').data(data);
            row.enter().append('tr');
            row.exit().remove();

            // make cells
            var td = row.selectAll('td').data(function(ins) {
                // map instance to array, where each element corresponds to one in cols
                return cols.map(function(column) {
                    return {title:column.title, html:column.fn(ins)}; // TODO make this generic, not key-dependent
                });
            });
            td.enter().append('td');
            td.html(function(d) { return d.html });
            td.exit().remove();
        };

        selection.each(function(data) { makeTable(d3.select(this), data) });
    };

    table.cols = function(_) {
        if(!arguments.length) return cols;
        cols = _;
        return table;
    };
    table.sortIdx = function(_) {
        if(!arguments.length) return sortIdx;
        sortIdx = _;
        return table;
    };
    table.sortOrder = function(_) {
        if(!arguments.length) return sortOrder;
        sortOrder = _;
        return table;
    };
    /// convenience setter function combining sortIdx and sortOrder
    table.sort = function(idx, order) {
        table.sortIdx(idx);
        table.sortOrder(order);
        return table;
    };

    return table;
}

})();
