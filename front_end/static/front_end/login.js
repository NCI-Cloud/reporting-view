(function($) {
    $(function() {
        $('button').on('click', getTokenTenjin);
    });

    var keystone;

    var onAuthenticated = function(catalog) {
        // clean up any error messages that might be left over
        $('.manual').removeClass('error');
        $('.manual p.message').html('');

        // save token and redirect TODO DRY (repeated in login.html)
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
