/**
 * Encapsulate reusable charts in D3.
 * Based on: http://bost.ocks.org/mike/chart/
 *
 * Would probably be more sensible to use something like NVD3 <http://nvd3.org/>
 * but this code was written partly as a learning exercise, so there.
 * Maybe one day I'll replace this re-invented wheel with nice NVD3 code,
 * and feel confident in my understanding of how it actually works...
 */
var Charts = {};
(function() {
    Charts.pie = function() {
        var width     = 300,
            height    = 300,
            keyFn     = function(d) { return d[0] }, /// accessor into data
            valFn     = function(d) { return d[1] }, /// accessor into data
            tipFn     = keyFn,                       /// formatter for human-readable titles
            color     = d3.scale.category20(),
            layout    = d3.layout.pie().sort(null),
            arc       = d3.svg.arc().innerRadius(0),
            pathClass = null,                        /// class to give to each <path> piece of pie
            dispatch  = d3.dispatch('click'),
            tip       = d3.tip()
                            .attr('class', 'd3-tip')
                            .direction(pie_tip_direction)
                            .html(function(d) { return tipFn(d.data) });

        /// draw a pie chart given selection
        function pie(selection) {
            selection.each(function(data) {
                var radius = Math.min(width, height)*0.5;
                arc.outerRadius(radius-10);

                // make sure svg element exists and has a group
                var svg = d3.select(this).selectAll('svg').data([data]);
                var svgEnter = svg.enter().append('svg');
                var gEnter = svgEnter.append('g')
                    .attr('class', 'wrapper');
                var hEnter = gEnter.append('g')
                    .attr('class', 'handles');
                var g = svg.select('g.wrapper');
                var h = svg.select('g.handles');

                // ready the tooltips
                h.call(tip);

                // set some attributes
                svg.attr('width', width).attr('height', height);
                g.attr('transform', 'translate('+width*0.5+','+height*0.5+')');

                // how does pie layout extract its values
                layout.value(valFn);

                // make handles
                var hand = h.selectAll('circle').data(layout);
                hand.enter().append('circle')
                    .attr('r', 1); // r=0 gets drawn at (0,0) in firefox, so can't be used as anchor
                hand
                    .attr('cx', function(d) { return pie_tip_x(arc.outerRadius()(d), d) })
                    .attr('cy', function(d) { return pie_tip_y(arc.outerRadius()(d), d) });
                hand.exit().remove();

                // make pie slices
                var path = g.selectAll('path').data(layout);
                path.enter().append('path')
                    .attr('fill', function(d, i) { return color(i) })
                    .on('click', function(d, i) { dispatch.click(d.data, i) })
                    .each(function(d) { this._current = d }); // store initial angles
                path
                    .attr('class', typeof pathClass === 'function' ? function(d) { return pathClass(d.data) } : pathClass )
                    .on('mouseover', function(d, i) { tip.show(d, hand[0][i]) }) // ensure that if tipFn is updated, the new version gets re-bound here
                    .on('mouseout', tip.hide);
                path.transition()
                    .attrTween('d', arcTween(arc));
                path.exit().remove();
            });
        }

        pie.width = function(value) {
            if(!arguments.length) return width;
            width = value;
            return pie;
        };
        pie.height = function(value) {
            if(!arguments.length) return height;
            height = value;
            return pie;
        };
        pie.key = function(value) {
            if(!arguments.length) return keyFn;
            keyFn = value;
            return pie;
        };
        pie.val = function(value) {
            if(!arguments.length) return valFn;
            valFn = value;
            return pie;
        };
        pie.tip = function(value) {
            if(!arguments.length) return tipFn;
            tipFn = value;
            return pie;
        };
        pie.pathClass = function(value) {
            if(!arguments.length) return pathClass;
            pathClass = value;
            return pie;
        };
        pie.dispatch = dispatch;

        /// return a tweening function to transition pie layout element
        var arcTween = function(arc) { // return a tween from current datum (._current) to final datum pie_d
            return function(pie_d) {
                var i = d3.interpolate(this._current, pie_d); // object interpolator, interpolating {start,end}Angle
                this._current = pie_d; // save final state (for next transition)
                return function(t) {
                    return arc(i(t));
                };
            };
        };

        /* get cartesian coordinates for target of tooltip of pie datum d
         * where (0,0) is the centre of the pie chart and r is its radius
         */
        var pie_tip_x = function(r, d) {
            return -r * Math.cos(-0.5*Math.PI - 0.5*(d.startAngle+d.endAngle));
        }
        var pie_tip_y = function(r, d) {
            return  r * Math.sin(-0.5*Math.PI - 0.5*(d.startAngle+d.endAngle));
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

        return pie;
    }

    Charts.zoom = function() {
        var margin     = {t:30, r:60, b:30, l:60, s:30}, /// top, right, bottom, left, separation between zoomed/finder charts
            width      = 840, /// both charts have same width; margins are extra
            heightZoom = 300, /// "zoom" chart shows a subset of domain
            heightDate = 60,  /// "date" charts shows complete domain
            xFn        = function(d) { return d.time }, /// accessor for horizontal domain
            yDateFn    = function(d) { return d.count }, /// accessor for vertical domain
            yZoomFn    = function(d) { return d.vcpus }, /// accessor for vertical domain
            tickFormat = d3.format('d'), /// for zoom chart's vertical axis
            dispatch   = d3.dispatch('brushend'),
            pointClass = null,
            dispatch   = d3.dispatch('zoom', 'highlight'),
            domain     = null, /// for zoom chart x axis; null means full extent
            tip        = d3.tip()
                             .attr('class', 'd3-tip')
                             .offset([-10,0])
                             .html(function(d) { return yZoomFn(d) });

        function zoom(selection) {
            selection.each(function(data) {
                // date chart elements (n.b. if this turns out to be computationally expensive, then the code could be restructured so these are only recomputed as needed, e.g. after chart resize)
                var xDate = d3.time.scale().range([0, width]).domain(d3.extent(data, xFn));
                var yDate = d3.scale.linear().range([heightDate, 0]).domain(d3.extent(data, yDateFn));
                var xAxisDate = d3.svg.axis().scale(xDate).orient('bottom');
                var yAxisDate = d3.svg.axis().scale(yDate).orient('left').ticks(0); // no ticks because the y scale is meant to be qualitative
                var brushDate = d3.svg.brush().x(xDate).on('brushend', function() { dispatch.zoom(brushDate.empty() ? null : brushDate.extent()) });
                if(domain) brushDate.extent(domain);

                // zoom chart elements (could be optimised similarly to as described above)
                var xZoom = d3.time.scale().range([0, width]).domain(domain ? domain : d3.extent(data, xFn));
                var yZoom = d3.scale.linear().range([heightZoom, 0]).domain(d3.extent(data, yZoomFn));
                var xAxisZoom = d3.svg.axis().scale(xZoom).orient('bottom');
                var yAxisZoom = d3.svg.axis().scale(yZoom).orient('left').tickFormat(tickFormat);
                var brushZoom = d3.svg.brush().x(xZoom).on('brushend', function() { dispatch.zoom(brushZoom.empty() ? null : brushZoom.extent()) });

                // line functions
                var lineDate = d3.svg.line().interpolate('step-after').x(function(d) { return xDate(xFn(d)) }).y(function(d) { return yDate(yDateFn(d)) });
                var areaDate = d3.svg.area().interpolate('step-after').x(function(d) { return xDate(xFn(d)) }).y0(heightDate).y1(function(d) { return yDate(yDateFn(d)) });
                var lineZoom = d3.svg.line().interpolate('step-after').x(function(d) { return xZoom(xFn(d)) }).y(function(d) { return yZoom(yZoomFn(d)) });

                // make sure svg elements are initialised; structure is:
                //  <svg>
                //    <g> <!-- transformed for margins -->
                //      <g class="date">
                //        <path class="area"/>
                //        <path class="line"/>
                //        <g class="brush"/>
                //        <g class="y axis"/>
                //        <g class="x axis"/> <!-- transformed, shifted down by heightDate -->
                //      </g>
                //      <g class="zoom"> <!-- transformed, shifted below g.date -->
                //        <path class="line"/>
                //        <g class="brush"/>
                //        <g class="handles"/>
                //        <g class="y axis"/>
                //        <g class="x axis"/> <!-- transformed, shifted down by heightZoom -->
                //      </g>
                //    </g>
                //  </svg>
                var svg = d3.select(this).selectAll('svg').data([data]);
                var svgEnter = svg.enter().append('svg').append('g');
                var dateEnter = svgEnter.append('g').attr('class', 'date');
                dateEnter.append('path').attr('class', 'area');
                dateEnter.append('path').attr('class', 'line');
                dateEnter.append('g').attr('class', 'brush');
                dateEnter.append('g').attr('class', 'y axis');
                dateEnter.append('g').attr('class', 'x axis');
                var zoomEnter = svgEnter.append('g').attr('class', 'zoom');
                zoomEnter.append('defs').append('clipPath').attr('id', 'zoomclip').append('rect');
                zoomEnter.append('path').attr('class', 'line').attr('clip-path', 'url(#zoomclip)');
                zoomEnter.append('g').attr('class', 'brush');
                zoomEnter.append('g').attr('class', 'handles').attr('clip-path', 'url(#zoomclip)');
                zoomEnter.append('g').attr('class', 'y axis');
                zoomEnter.append('g').attr('class', 'x axis');

                // select some elements for updating
                var gMargin = svg.select('g');
                var gDate = gMargin.select('g.date');
                var gZoom = gMargin.select('g.zoom');
                var gHandles = gZoom.select('g.handles');
                var gBrushDate = gDate.select('g.brush');
                var gBrushZoom = gZoom.select('g.brush');

                // update svg elements
                svg
                    .attr('width', width + margin.l + margin.r)
                    .attr('height', heightZoom+heightDate+margin.t+margin.b+margin.s);
                gDate
                    .attr('transform', 'translate('+margin.l+','+margin.t+')');
                gDate.select('g.axis.x')
                    .attr('transform', 'translate(0,'+heightDate+')')
                    .call(xAxisDate);
                gDate.select('g.axis.y')
                    .call(yAxisDate);
                gDate.select('g.brush')
                    .call(brushDate)
                  .selectAll('rect')
                    .attr('height', heightDate);
                gZoom
                    .attr('transform', 'translate('+margin.l+','+(+margin.t+margin.s+heightDate)+')')
                    .call(tip);
                gZoom.select('g.axis.x')
                    .attr('transform', 'translate(0,'+heightZoom+')')
                    .call(xAxisZoom);
                gZoom.select('g.axis.y')
                    .call(yAxisZoom);
                gZoom.select('clippath rect')
                    .attr('width', width + 1) // because stroke width is 2px, so could overflow
                    .attr('height', heightZoom);
                gZoom.select('g.brush')
                    .call(brushZoom)
                  .selectAll('rect')
                    .attr('height', heightZoom);

                // update date chart
                gDate.select('path.line').datum(data).attr('d', lineDate);
                gDate.select('path.area').datum(data).attr('d', areaDate);
                gDate.selectAll('.x.axis .tick > text').on('click', function(d) { // don't know if there's a more elegant way to do this
                    var e = d3.time.month.offset(d, 1); // one month later
                    if(e > xDate.domain()[1]) e = date_x.domain()[1]; // need to clamp manually
                    dispatch.zoom([d,e]);
                });

                // update zoom chart
                gZoom.select('path.line').datum(data).attr('d', lineZoom);
                var circ = gZoom.select('g.handles').selectAll('circle').data(data);
                circ.enter().append('circle')
                    .attr('class', pointClass)
                    .attr('r', 2) // little data point helps to find tooltips (step function is not very intuitive)
                    .on('mouseout', tip.hide);
                circ
                    .on('mouseover', function(d, i) { tip.show(data[i], this); })
                    .attr('cx', function(d) { return xZoom(xFn(d)) })
                    .attr('cy', function(d) { return yZoom(yZoomFn(d)) });
                circ.exit().remove();

                // change domain of zoom chart to extent (show full domain for null extent)
                // redraws as necessary
                var zoomTo = function(extent) {
                    if(extent) {
                        brushDate.extent(extent); // keep brushes in sync
                        xZoom.domain(extent);
                        // TODO yZoom.domain(something here)
                        gBrushDate.transition().call(brushDate);
                    } else {
                        brushDate.clear();
                        gBrushDate.call(brushDate); // no transition when clearing (moves to x=0, looks silly)
                        xZoom.domain(xDate.domain());
                    }

                    // never show brush on zoom chart, since it would always be 100% selected
                    brushZoom.clear();
                    gBrushZoom.call(brushZoom);

                    // transition update for zoom chart (axes, line, and handles)
                    // there is a bug causing the path to disappear when the extent becomes very small (think it's a browser svg rendering bug because firefox fails differently from chromium)
                    gZoom.select('.x.axis').transition().call(xAxisZoom);
                    gZoom.select('.y.axis').transition().call(yAxisZoom); // jk it doesn't actually change yet
                    gZoom.select('path.line').transition().attr('d', lineZoom);
                    circ.transition()
                        .attr('cx', function(d) { return xZoom(xFn(d)) })
                        .attr('cy', function(d) { return yZoom(yZoomFn(d)) });

                    // store zoomed domain to remember it when redrawing
                    domain = extent;
                };

                // highlight all data points whose pointClass matches given className
                dispatch.on('highlight', function(className) {
                    circ.classed('highlight', false);
                    if(!className) return;
                    gHandles.selectAll('circle.'+className).classed('highlight', true);
                });

                // change date range
                dispatch.on('zoom', function(extent) {
                    zoomTo(extent);
                });
            });
        }

        zoom.width = function(value) {
            if(!arguments.length) return width;
            width = value;
            return zoom;
        };
        zoom.tip = function(_) {
            if(!arguments.length) return tip;
            tip = _;
            return zoom;
        };
        zoom.pointClass = function(_) {
            if(!arguments.length) return pointClass;
            pointClass = _;
            return zoom;
        };
        zoom.yZoom = function(_) {
            if(!arguments.length) return yZoomFn;
            yZoomFn = _;
            return zoom;
        };
        zoom.yDateFn = function(_) {
            if(!arguments.length) return yDateFn;
            yDateFn = _;
            return zoom;
        };
        zoom.xFn = function(_) {
            if(!arguments.length) return xFn;
            xFn = _;
            return zoom;
        };
        zoom.tickFormat = function(_) {
            if(!arguments.length) return tickFormat;
            tickFormat = _;
            return zoom;
        };
        zoom.dispatch = dispatch;

        return zoom;
    }

    Charts.table = function() {
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
        var sortOrder = d3.ascending;

        function table(selection) {
            // wrap this in a function it can be called recursively, allowing the table to update itself
            var makeTable = function(tbl, dataUnsorted) {
                // make shallow copy of data, for sorting without altering original
                var data = dataUnsorted
                    .map(function(d) { return d })
                    .sort(function(a, b) { return sortOrder(cols[sortIdx].fn(a), cols[sortIdx].fn(b)) });

                // set up <thead>
                var thead = tbl.selectAll('thead').data([data]);
                thead.enter().append('thead').append('tr');
                var th = thead.select('tr').selectAll('th').data(cols);
                th.enter().append('th');
                th
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
                    .attr('class', function(d, i) { return (i === sortIdx ? (sortOrder === d3.descending ? 'descending' : 'ascending') : '') + (d.cl ? ' '+d.cl : '') })
                    .html(function(d) { return d.title });

                // <tfoot>
                var tfoot = tbl.selectAll('tfoot').data([data]);
                tfoot.enter().append('tfoot').append('tr');
                var tf = tfoot.select('tr').selectAll('td').data(cols);
                tf.enter().append('td');
                tf
                    .attr('class', function(d) { return d.cl })
                    .html(function(d) { return d.agg ? (d.format || String)(d.agg(data)) : null });

                // <tbody>
                var tbody = tbl.selectAll('tbody').data([data]);
                tbody.enter().append('tbody');

                // <tr>
                var row = tbody.selectAll('tr').data(data);
                row.enter().append('tr');
                row.exit().remove();

                // make cells
                var td = row.selectAll('td').data(function(ins) {
                    // map instance to array, where each element corresponds to one in cols
                    return cols.map(function(column) {
                        return { // TODO make this generic, not key-dependent
                            title : column.title,
                            html  : (column.format || String)(column.fn(ins)),
                            cl    : column.cl || null,
                        };
                    });
                });
                td.enter().append('td');
                td.html(function(d) { return d.html });
                td.attr('class', function(d) { return d.cl });
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
