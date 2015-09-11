var Billing = {};
(function() {

// TODO refactor to avoid duplicating this code between reports
Billing.init = function() {
    var fetch = Fetcher(Config.endpoints);
    Util.fillNav(fetch);
}

})();
