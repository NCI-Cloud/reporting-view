(function($) {
    if(!Util.storageAvailable('sessionStorage')) {
        // TODO handle fatal error
        console.log('need web storage api');
    } else if(sessionStorage.getItem('token')) {
        // token already set; not sure if it's better here to re-authenticate or just assume the token's good
        location.replace(Config.baseURL + Config.reports[0].url); // TODO DRY
    }

    $(function() {
        $('form.aaf').attr('action', 'https://accounts.rc.nectar.org.au/rcshibboleth?return-path='+encodeURIComponent(Config.baseURL));
        $('form.manual').on('submit', function() { getTokenTenjin(); return false; });
    });

    var keystone;

    var onAuthenticated = function(catalog) {
        // clean up any error messages that might be left over
        $('.manual').removeClass('error');
        $('.manual p.message').html('');

        // save token and redirect TODO DRY
        sessionStorage.setItem('token', keystone.getToken());
        location.replace(Config.baseURL + Config.reports[0].url);
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
})(jQuery);
