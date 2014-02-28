var wd = require('wd');
var EventEmitter = require('events').EventEmitter;
var debug = require('debug')('zuul:browserstackbrowser');
var https = require('https');

var setup_test_instance = require('./setup');

function BrowserStackBrowser(conf, opt) {
    if (!(this instanceof BrowserStackBrowser)) {
        return new BrowserStackBrowser(conf, opt);
    };

    var self = this;
    self._conf = conf;
    self._opt = opt;
    self._opt.tunnel = true;
    self.stats = {
        passed: 0,
        failed: 0
    };
};

BrowserStackBrowser._formatBrowsers = function(obj) {
    var browsers = {};
    obj.forEach(function(info) {
        var name = info.browser;

        var browser = browsers[name] = browsers[name] || [];
        browser.push(info);
    });

    return browsers;
};

BrowserStackBrowser.getBrowsers = function(conf, cb) {
    var info_opt = {
        host: 'www.browserstack.com',
        path: '/automate/browsers.json',
        auth: conf.browserstack.username + ':' +
            conf.browserstack.key
    };

    https.get(info_opt, function(res) {
        res.setEncoding('utf8');
        var body = '';

        res.on('data', function(data) {
            body += data;
        });

        res.once('end', function() {
            try {
                var formatted = BrowserStackBrowser._formatBrowsers(
                    JSON.parse(body)
                );
            } catch (err) {
                return cb(err);
            }

            cb(null, formatted);
        });

        res.once('error', cb);
    });
};

BrowserStackBrowser.getAbbrevBrowsers = function(conf, cb) {
    BrowserStackBrowser.getBrowsers(conf, function(err, browsers) {
        var abbrevBrowsers = [];
        Object.keys(browsers).forEach(function(key) {
            var list = browsers[key];
            if (list.length === 1) {
                return abbrevBrowsers.push(list);
            }

            list.sort(function(a, b) {
                return a.version - b.version;
            });

            // Return oldest and newest of each browser
            abbrevBrowsers.push(list.shift());
            abbrevBrowsers.push(list.pop());
        });
        cb(err, abbrevBrowsers);
    });
}

BrowserStackBrowser.prototype.__proto__ = EventEmitter.prototype;

BrowserStackBrowser.prototype.toString = function() {
    var self = this;
    var conf = self._conf;
    return '<' + conf.browser + ' ' + conf.version + ' on ' + conf.os + '>';
};

BrowserStackBrowser.prototype.start = function() {
    var self = this;
    var conf = self._conf;

    debug('running %s %s %s', conf.browser, conf.version, conf.os);
    var browser = self.browser = wd.remote('hub.browserstack.com', 80);

    self.controller = setup_test_instance(self._opt, function(err, url) {
        if (err) {
            return self.shutdown(err);
        }

        self.emit('init', conf);

        var init_conf = {
            build: conf.build,
            name: conf.name,
            tags: conf.tags || [],
            browserName: conf.browser,
            version: conf.version || '',
            os: conf.os,
            'browserstack.user': conf.username,
            'browserstack.key': conf.key
        };

        debug('queuing %s %s %s', conf.browser, conf.version, conf.os);

        browser.init(init_conf, function(err) {
            if (err) {
                err.message += ': ' + err.data.split('\n').slice(0, 1);
                return self.shutdown(err);
            }

            var reporter = new EventEmitter();

            reporter.on('test_end', function(test) {
                if (!test.passed) {
                    return self.stats.failed++;
                }
                self.stats.passed++;
            });

            reporter.on('done', function(results) {
                browser.quit(function(err) {
                    self.shutdown(err);
                });

                reporter.removeAllListeners();
            });

            debug('open %s', url);
            self.emit('start', reporter);

            browser.get(url, function(err) {
                if (err) {
                    return self.shutdown(err);
                }

                (function wait() {
                    var js = '(window.zuul_msg_bus ? window.zuul_msg_bus.splice(0, window.zuul_msg_bus.length) : []);'
                    browser.eval(js, function(err, res) {
                        if (err) {
                            return self.shutdown(err);
                        }

                        var has_done = false;
                        res = res || [];
                        res.forEach(function(msg) {
                            if (msg.type === 'done') {
                                has_done = true;
                            }

                            reporter.emit(msg.type, msg);
                        });

                        if (has_done) {
                            return;
                        }

                        debug('fetching more results');
                        setTimeout(wait, 1000);
                    });
                })();
            });
        });
    });
};

BrowserStackBrowser.prototype.shutdown = function(err) {
    var self = this;

    if (err) {
        self.emit('error', err);
    }

    self.emit('done', self.stats);

    if (self.browser) {
        self.browser.quit();
    }

    if (self.controller) {
        self.controller.shutdown();
    }

    self.removeAllListeners();
};

module.exports = BrowserStackBrowser;
