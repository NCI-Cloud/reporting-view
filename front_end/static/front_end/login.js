(function($) {
    if(!Util.storageAvailable('sessionStorage')) {
        // TODO handle fatal error
        console.log('need web storage api');
    } else if(sessionStorage.getItem(Config.tokenKey)) {
        // token already set; not sure if it's better here to re-authenticate or just assume the token's good
        location.replace(Config.baseURL + Config.reports[0].url);
    }

    $(function() {
        $('form.aaf').attr('action', 'https://accounts.rc.nectar.org.au/rcshibboleth?return-path='+encodeURIComponent(Config.baseURL));
        $('form.manual').on('submit', function() { getTokenTenjin(); return false; });
        var message = sessionStorage.getItem(Config.flashKey);
        if(message) {
            $('.instructions').prepend('<p>'+message+'</p>');
        }
        sessionStorage.removeItem(Config.flashKey);

        var s = $('select');
        Config.endpoints.forEach(function(ep) {
            s.append($('<option/>').val(ep.url).text(ep.name));
        });
        var eurl = localStorage.getItem(Config.endpointKey); // get saved endpoint url
        if(eurl && Config.endpoints.find(function(ep) { return ep.url === eurl })) {
            // valid endpoint url specified, so select it by default
            s.val(localStorage.getItem(Config.endpointKey));
        }
        s.change(function(e) {
            // update local storage whenever selected option changes
            localStorage.setItem(Config.endpointKey, this.value);
        });
    });

    var keystone;

    var onAuthenticated = function(catalog) {
        // clean up any error messages that might be left over
        $('.manual').removeClass('error');
        $('.manual p.message').html('');

        // save token
        sessionStorage.setItem(Config.tokenKey, keystone.getToken());
        redirect();
    };

    var getTokenTenjin = function() {
        keystone = new osclient.Keystone({
            authURL       : $('#url').val(),
            domainName    : 'default',
            username      : $('#username').val(),
            password      : $('#password').val(),
        });
        keystone.defaultParams.error = function(jqxhr, status, err) {
            $('.manual').addClass('error');
            $('.manual p.message').html(err);
        };
        keystone.authenticate().done(onAuthenticated);
    };

    var redirect = function() {
        location.replace(Config.baseURL + Config.reports[0].url);
    };
})(jQuery);
