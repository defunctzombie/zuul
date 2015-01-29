// returns available browsers to test on
// results are keyed by browser
// each browser has an array of objects with version and platform info
// some versions may have more than one OS they can run on
// {
//     'chrome': [
//        { version: 27, platform: 'Windows XP' }
//        { version: 27, platform: 'Mac 10.6' }
//     ]
// }

var https = require('https')
,   debug = require('debug')('zuul:scout_browser');

var http_endpoints = {
    'SauceLabs': function () { return {
        host: 'saucelabs.com',
        path: '/rest/v1/info/browsers/webdriver'
    }; },
    'BrowserStack': function (config) {
        throwOnNoUsernameOrKey(config);
        return {
            host: 'www.browserstack.com',
            path: '/automate/browsers.json',
            auth: config.username + ':' + config.key
        };
    }
}

var formatters = {
    'SauceLabs': formatSauceLabs,
    'BrowserStack': formatBrowserStack
}

module.exports = function(config, cb) {
    if (!cb) cb = config, config = null;

    var provider = config.selenium_runner || 'SauceLabs'
    ,   info_opt = http_endpoints[provider](config)
    ,   format = formatters[provider];

    debug('requesting browsers with opts:', info_opt)

    https.get(info_opt, function(res) {
        res.setEncoding('utf8');
        var body = '';

        res.on('data', function(data) {
            body += data;
        });

        res.once('end', function() {
            try {
                debug('got body', body.slice(0, 100), '...')
                var formatted = format(JSON.parse(body));
            } catch (err) {
                return cb(err);
            }

            cb(null, formatted);
        });

        res.once('error', cb);
    });
};

function formatSauceLabs(obj) {
    var browsers = {};
    obj.forEach(function(info) {
        var name = info.api_name;

        var browser = browsers[name] = browsers[name] || [];
        browser.push({
            name: name,
            version: info.short_version,
            platform: info.os,
        });
    });

    return browsers;
}

function formatBrowserStack(obj) {
    var browsers = {};
    obj.forEach(function(info) {
        var name = info.browser;

        var browser = browsers[name] = browsers[name] || [];
        browser.push({
            name: name,
            version: parseInt(info.browser_version || info.os_version).toString(),
            platform: info.device || (info.os + ' ' + info.os_version)
        });
    });

    return browsers;
}

function throwOnNoUsernameOrKey(config) {
    if (!config.username || !config.key) {
        console.error('Error:');
        console.error('Zuul tried to query browsers from '+config.selenium_runner+', however no '+config.selenium_runner+' credentials were provided.');
        console.error('See the zuul wiki (https://github.com/defunctzombie/zuul/wiki/Cloud-testing) for info on how to setup cloud testing.');
        process.exit(1);
        return;
    }
}