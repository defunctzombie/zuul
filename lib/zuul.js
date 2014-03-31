var debug = require('debug')('zuul');
var Batch = require('batch');
var EventEmitter = require('events').EventEmitter;

var control_app = require('./control-app');
var frameworks = require('../frameworks');
var setup_test_instance = require('./setup');
var SauceBrowser = require('./SauceBrowser');
var BrowserStackBrowser = require('./BrowserStackBrowser');
var PhantomBrowser = require('./PhantomBrowser');

module.exports = Zuul;

function Zuul(config) {
    if (!(this instanceof Zuul)) {
        return new Zuul(config);
    }

    var self = this;

    var ui = config.ui;
    var framework_dir = frameworks[ui];
    if (!framework_dir) {
        throw new Error('unsupported ui: ' + ui);
    }

    config.framework_dir = framework_dir;
    self._config = config;

    // list of browsers to test
    self._browsers = [];

    self._concurrency = config.concurrency || 3;
};

Zuul.prototype.__proto__ = EventEmitter.prototype;

Zuul.prototype._setup = function(cb) {
    var self = this;

    var config = self._config;

    // we only need one control app
    var control_server = control_app(config).listen(0, function() {
        debug('control server active on port %d', control_server.address().port);
        cb(null, control_server.address().port);
    });
};

Zuul.prototype.browser = function(info) {
    var self = this;
    var config = self._config;

    self._browsers.push(SauceBrowser({
        name: config.name,
        build: process.env.TRAVIS_BUILD_NUMBER,
        username: config.username,
        key: config.key,
        browser: info.name,
        version: info.version,
        platform: info.platform
    }, config));
};

Zuul.prototype.addBSBrowser = function(info) {
    var self = this;
    var config = self._config;

    self._browsers.push(BrowserStackBrowser({
        name: config.name,
        username: config.browserstack.username,
        key: config.browserstack.key,
        browser: info.browser,
        version: info.browser_version,
        os: info.os
    }, config));
};

Zuul.prototype.registerCloudReporter = function() {
    var self = this;

    self.on('browser', function(browser) {
        var name = browser.toString();

        browser.once('init', function() {
            console.log('- queuing: %s'.grey, name);
        });

        browser.once('start', function(reporter) {
            console.log('- starting: %s'.white, name);

            var wait_interval = setInterval(function() {
                console.log('- waiting: %s'.yellow, name);
            }, 1000 * 30);

            var current_test = undefined;
            reporter.on('test', function(test) {
                current_test = test;
            });

            reporter.on('console', function(msg) {
                console.log('%s console'.white, name);
                console.log.apply(console, msg.args);
            });

            reporter.on('assertion', function(assertion) {
                console.log();
                console.log('%s %s'.red, name, current_test.name);
                console.log('Error: %s'.red, assertion.message);
                assertion.frames.forEach(function(frame) {
                    console.log('    %s %s:%d'.grey, frame.func, frame.filename, frame.line);
                });
                console.log();
            });

            reporter.once('done', function() {
                clearInterval(wait_interval);
            });
        });

        browser.once('done', function(results) {
            if (results.failed || results.passed === 0) {
                console.log('- failed: %s (%d failed, %d passed)'.red, name,
                    results.failed, results.passed);
                return;
            }
            console.log('- passed: %s'.green, name);
        });

    });
};

Zuul.prototype.run = function(done) {
    var self = this;

    var config = self._config;

    self._setup(function(err, control_port) {
        config.control_port = control_port;

        if (config.local) {
            setup_test_instance(config, function(err, url) {
                if (err) {
                    console.error(err.stack);
                    process.exit(1);
                    return;
                }

                console.log('open the following url in a browser:');
                console.log(url);
            });
            return;
        }

        // TODO love and care
        if (config.phantom) {
            var phantom = PhantomBrowser(config);
            self.emit('browser', phantom);
            phantom.once('done', function(results) {
                done(results.failed === 0);
            });
            return phantom.start();
        }

        var batch = new Batch();
        batch.concurrency(self._concurrency);

        var passed = true;
        var passed_count = 0;
        var failed_count = 0;

        self._browsers.forEach(function(browser) {
            self.emit('browser', browser);

            batch.push(function(done) {
                browser.once('done', function(results) {
                    passed_count += results.passed;
                    failed_count += results.failed;

                    // if no tests passed, then this is also a problem
                    // indicates potential error to even run tests
                    if (results.failed || results.passed === 0) {
                        passed = false;
                    }
                    done();
                });
                browser.start();
            });
        });

        var results = {
            passed_count: passed_count,
            failed_count: failed_count
        };

        batch.end(function(err) {
            debug('batch done');
            done(err || passed, results);
        });
    });
};
