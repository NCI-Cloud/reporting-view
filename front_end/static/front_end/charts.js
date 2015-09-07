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
                    .attr('class', typeof pathClass === 'function' ? function(d) { return pathClass(d.data) } : pathClass )
                    .attr('fill', function(d, i) { return color(i) })
                    .on('click', function(d, i) { dispatch.click(d.data, i) })
                    .each(function(d) { this._current = d }); // store initial angles
                path
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
        pie.on = function(type, listener) {
            dispatch.on(type, listener);
            return pie;
        };

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
})();
