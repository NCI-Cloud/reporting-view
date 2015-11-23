// idk if this is a silly design but it was the least bad that sprung to mind...
// will eventually want to add some kind of abstraction for virtual endpoints, in order to define 'All nodes' endpoint with aggregation which would be defined per report
var Config = {
    baseURL : 'http://example.com',
    tokenKey : 'token', // key in sessionStorage for keystone token
    flashKey : 'flash', // key in sessionStorage for temporary message storage
    endpoint : 'http://example.com:9495', // reporting api base url
    nodeKey  : 'node',  // key in localStorage for node to be used for node-level filtering
    reports : [
        {
            name : 'Node Aggregates',
            url  : '/load',
        },
        {
            name : 'Project Details',
            url  : '/project',
        },
        {
            name : 'Flavour Capacity',
            url  : '/flav',
        },
        {
            name : 'Billing',
            url  : '/billing',
        },
    ],
};
