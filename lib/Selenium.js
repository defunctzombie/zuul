var path = require('path');
var EventEmitter = require('events').EventEmitter;
var debug = require('debug')('zuul:selenium');
var wd = require('wd');

var SELENIUM_VERSION = '2.52.0';

var setup_test_instance = require('./setup');
require('colors');

function Selenium(opt) {
    if (!(this instanceof Selenium)) {
        return new Selenium(opt);
    }

    var self = this;
    self._opt = opt;
    self._browserName = (opt.browsers && opt.browsers[0] && opt.browsers[0].name) || null;
    self._browserVersion = (opt.browsers && opt.browsers[0] && opt.browsers[0].version) || null;
    self.status = {
        passed: 0,
        failed: 0
    };
}

Selenium.prototype.__proto__ = EventEmitter.prototype;

Selenium.prototype.start = function() {
    var self = this;

    var seleniumClient;
    var selenium = require('selenium-standalone');

    function finish() {
        if (self._finished) {
            return;
        }
        self._finished = true;
        reporter.removeAllListeners();
        if (seleniumClient) {
            seleniumClient.quit();
        }
    }

    self.controller = setup_test_instance(self._opt, function(err, url) {
        if (err) {
            console.log('Error: %s'.red, err);
            self.emit('done', {
                passed: false
            });
            finish();
        }

        debug('url %s', url);

        var reporter = new EventEmitter();

        reporter.on('console', function(msg) {
            console.log.apply(console, msg.args);
        });

        reporter.on('test', function(test) {
            console.log('starting', test.name.white);
        });

        reporter.on('test_end', function(test) {
            if (!test.passed) {
                console.log('failed', test.name.red);
                return self.status.failed++;
            }

            console.log('passed:', test.name.green);
            self.status.passed++;
        });

        reporter.on('assertion', function(assertion) {
            console.log('Error: %s'.red, assertion.message);
            assertion.frames.forEach(function(frame) {
                console.log('    %s %s:%d'.grey, frame.func, frame.filename, frame.line);
            });
            console.log();
        });

        reporter.on('done', function() {
            finish();
        });

        self.emit('init', url);
        self.emit('start', reporter);

        var opts = {version: SELENIUM_VERSION};
        selenium.install(opts, function(err) {
            if (err) {
                console.log('Error: %s'.red, new Error(
                    'Failed to install selenium'));
                self.emit('done', {
                    passed: false
                });
                finish();
                return;
            }
            selenium.start(opts, function() {
                seleniumClient = wd.promiseChainRemote();
                onSeleniumReady();
            });
        });

        function onSeleniumClientReady() {
            var lastMessage = Date.now();
            var script = 'window.zuul_msg_bus ? ' +
                'window.zuul_msg_bus.splice(0, window.zuul_msg_bus.length) : ' +
                '[]';

            var interval = setInterval(poll, 2000);

            function onDoneMessage() {
                clearInterval(interval);
                seleniumClient.quit(function () {
                    seleniumClient = null;
                    self.emit('done', {
                        passed: self.status.passed,
                        failed: self.status.failed
                    });
                    finish();
                });
            }

            function onGetMessages(err, messages) {
                if (err) {
                    self.emit('error', err);
                } else if (messages.length) {
                    lastMessage = Date.now();
                    messages.forEach(function (msg) {
                        debug('msg: %j', msg);
                        if (msg.type === 'done') {
                            onDoneMessage();
                        } else {
                            reporter.emit(msg.type, msg);
                        }
                    });
                } else if ((Date.now() - lastMessage) > testTimeout) {
                    clearInterval(interval);
                    console.log('Error: %s'.red, new Error(
                        'selenium timeout after ' + testTimeout + ' ms'));
                    self.emit('done', {
                        passed: false
                    });
                    finish();
                }
            }

            function poll() {
                seleniumClient.eval(script, onGetMessages);
            }
        }

        function onSeleniumReady() {
            // TODO: maybe these should be configurable
            var testTimeout = 120000;
            var tunnelId = process.env.TRAVIS_JOB_NUMBER || 'tunnel-' + Date.now();
            var opts = {
                tunnelTimeout: testTimeout,
                name: self._browserName + ' - ' + tunnelId,
                'max-duration': 60 * 45,
                'command-timeout': 599,
                'idle-timeout': 599,
                'tunnel-identifier': tunnelId
            };
            if (self._browserName) {
                opts.browserName = self._browserName;
            }
            if (self._browserVersion) {
                opts.version = self._browserVersion;
            }

            seleniumClient.init(opts).get(url, onSeleniumClientReady);
        }
    });
};

Selenium.prototype.shutdown = function() {
    if (self.controller) {
        self.controller.shutdown();
    }
};

module.exports = Selenium;
