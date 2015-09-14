var Billing = {};
(function() {

/// event broadcasting
var dispatch = d3.dispatch('projectChanged', 'datesChanged');

// TODO refactor to avoid duplicating this code between reports
Billing.init = function() {
    var fetch = Fetcher(Config.endpoints);
    Util.fillNav(fetch);
    Util.qdeps(fetch, [
        {
            sel : '#pid',
            dep : ['project'],
            fun : report_project,
        },
        {
            sel : '.perproject',
            dep : ['instance', 'user'],
            fun : report_pp,
        },
    ]);
    var ep_name = Config.defaultEndpoint;
    fetch(ep_name);
}

var report_project = function(sel, g) {
    var slct = d3.select(sel);
    slct.on('change', function() { dispatch.projectChanged(this.value) });

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

    // select no project
    dispatch.projectChanged(null);

    dispatch.on('projectChanged', function(pid) {
        // setting value to empty string (rather than null) shows "Select project..." option
        slct.property('value', pid || '');
    });
};

var report_pp = function(sel, g) {
    var s = d3.select(sel);
    var dl = s.select('dl');
    var tbl = s.select('table');

    // hide this selection by default, since by default no project has been picked so "per-project" is meaningless
    s.style('display', 'none');

    // integration region is extent[0] <= time <= extent[1]
    var extent = [-Infinity, Infinity];

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
            title : 'User',
            fn    : function(d) { return d.created_by }, // TODO look up in g.user
        },
    ]);

    /// perform calculations over extent for project pid
    var integrate = function() {
        // trust that this function is only called when it makes sense to do so, so we can un-hide data
        s.style('display', null);

        // find working set (all instances of current project in current time window)
        var ws = g.instance.filter(function(i) {
            return i.project_id === pid && i._meta.created <= extent[1] && i._meta.deleted >= extent[0];
        });

        // perform integration
        console.log('++++');

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

    dispatch.on('projectChanged', function(pid_) {
        if(!pid_) {
            return s.style('display', 'none'); // no project selected => hide per-project data
        }
        pid = pid_;

        integrate();
    });

    dispatch.on('datesChanged', function(extent_) {
        if(!extent_) {
            // TODO what does a null date range even mean
            return s.style('display', 'none'); // no date range => hide per-project data
        }
        extent = extent_;
        integrate();
    });
}

function Table() {
    /// array of {title:string, fn:function taking datum outputting string}
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
            var theadtrEnter = thead.enter().append('thead').append('tr');
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
                .html(function(d) { return d.title });
            th.attr('class', function(d, i) { return i === sortIdx ? (sortOrder === d3.descending ? 'descending' : 'ascending') : null });
            var tbody = tbl.selectAll('tbody').data([data]);
            tbody.enter().append('tbody');

            // make rows
            var row = tbody.selectAll('tr').data(data);
            row.enter().append('tr');
            row.append('td').html('.');
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
