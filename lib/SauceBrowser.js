var wd = require('wd');
var EventEmitter = require('events').EventEmitter;
var FirefoxProfile = require('firefox-profile');
var debug = require('debug');
var omit = require('lodash').omit;
var xtend = require('xtend');

var setup_test_instance = require('./setup');

function SauceBrowser(conf, opt) {
    if (!(this instanceof SauceBrowser)) {
        return new SauceBrowser(conf, opt);
    }

    var self = this;
    self._conf = conf;
    self._opt = opt;
    self._opt.tunnel = (opt.sauce_connect) ? false : (self._opt.tunnel || true);
    self.stats = {
        passed: 0,
        failed: 0
    };
    self.debug = debug('zuul:sauce:' + conf.browser + ':' + conf.version);
    self.debug('browser conf: %j', omit(conf, ['username', 'key']));
}

SauceBrowser.prototype.__proto__ = EventEmitter.prototype;

SauceBrowser.prototype.toString = function() {
    var self = this;
    var conf = self._conf;
    return '<' + conf.browser + ' ' + conf.version + ' on ' + conf.platform + '>';
};

SauceBrowser.prototype.start = function() {
    var self = this;
    var conf = self._conf;

    self.stopped = false;
    self.stats = {
        passed: 0,
        failed: 0
    };

    self.debug('running');
    var browser = self.browser = wd.remote('ondemand.saucelabs.com', 80, conf.username, conf.key);

    self.controller = setup_test_instance(self._opt, function(err, url) {
        if (err) {
            return self.shutdown(err);
        }

        self.emit('init', conf);

        var init_conf = xtend({
            build: conf.build,
            name: conf.name,
            tags: conf.tags || [],
            browserName: conf.browser,
            version: conf.version,
            platform: conf.platform,
            // appium-version is not always the latest stable,
            // we enforce it to be sure to always be up to date and fix the
            // saucelabs bugs
            'appium-version': '1'
        }, conf.capabilities);

        // configures sauce connect with a tunnel identifier
        // if sauce_connect is true, use the TRAVIS_JOB_NUMBER environment variable
        // otherwise use the contents of the sauce_connect variable
        if (self._opt.sauce_connect) {
            var tunnelId = self._opt.sauce_connect !== true ? self._opt.sauce_connect : process.env.TRAVIS_JOB_NUMBER;
            if (tunnelId) {
                init_conf['tunnel-identifier'] = tunnelId;
            }
        }

        if (conf.firefox_profile) {
            var fp = new FirefoxProfile();
            var extensions = conf.firefox_profile.extensions;
            for (var preference in conf.firefox_profile) {
                if (preference !== 'extensions') {
                    fp.setPreference(preference, conf.firefox_profile[preference]);
                }
            }
            extensions = extensions ? extensions : [];
            fp.addExtensions(extensions, function () {
                fp.encoded(function(zippedProfile) {
                    init_conf.firefox_profile = zippedProfile;
                    init();
                });
            });
        } else {
            init();
        }

        function init() {
            self.debug('queuing');

            browser.init(init_conf, function(err) {
                if (err) {
                    if (err.data) {
                        err.message += ': ' + err.data.split('\n').slice(0, 1);
                    }
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
                    clearTimeout(self.noOutputTimeout);
                    self.debug('done');
                    var passed = results.passed;
                    var called = false;
                    browser.sauceJobStatus(passed, function(err) {
                        if (called) {
                            return;
                        }

                        called = true;
                        self.shutdown();

                        if (err) {
                            return;
                            // don't let this error fail us
                        }
                    });

                    reporter.removeAllListeners();
                });

                self.debug('open %s', url);
                self.emit('start', reporter);

                var timeout = false;
                var get_timeout = setTimeout(function() {
                    self.debug('timed out waiting for open %s', url);
                    timeout = true;
                    self.shutdown(new Error('Timeout opening url'));
                }, 120 * 1000);

                browser.get(url, function(err) {
                    self.debug('browser opened url');

                    if (timeout) {
                        return;
                    }

                    clearTimeout(get_timeout);
                    if (err) {
                        return self.shutdown(err);
                    }

                    // no new output for 30s => error
                    watchOutput();

                    function watchOutput() {
                        if (self._opt.browser_output_timeout === -1) {
                            return;
                        }

                        clearTimeout(self.noOutputTimeout);

                        self.noOutputTimeout = setTimeout(function() {
                            self.shutdown(new Error('Did not receive any new output from browser for 30s, shutting down'));
                        }, self._opt.browser_output_timeout);
                    }

                    (function wait() {
                        if (self.stopped) {
                            return;
                        }

                        self.debug('waiting for test results from %s', url);
                        // take the last 1000 log lines
                        // careful, the less you log lines, the slower your test
                        // result will be. The test could be finished in the browser
                        // but not in your console since it can take a lot
                        // of time to get a lot of results
                        var js = '(window.zuul_msg_bus ? window.zuul_msg_bus.splice(0, 1000) : []);'
                        browser.eval(js, function(err, res) {
                            if (err) {
                                self.debug('err: %s', err.message);
                                return self.shutdown(err);
                            }

                            self.debug('res.length: %s', res.length);

                            // if we received some data, reset the no output watch timeout
                            if (res.length > 0) {
                                watchOutput();
                            }

                            var has_done = false;
                            res = res || [];
                            res.filter(Boolean).forEach(function(msg) {
                                if (msg.type === 'done') {
                                    has_done = true;
                                }

                                reporter.emit(msg.type, msg);
                            });

                            if (has_done) {
                                self.debug('finished tests for %s', url);
                                return;
                            }

                            self.debug('fetching more results');

                            // if we found results, let's not wait
                            // to get more
                            if (res.length > 0) {
                                process.nextTick(wait);
                            } else {
                                // otherwise, let's wait a little so that we do not
                                // spam saucelabs
                                setTimeout(wait, 2000);
                            }
                        });
                    })();
                });
            });
        }
    });
};

SauceBrowser.prototype.shutdown = function(err) {
    var self = this;

    clearTimeout(self.noOutputTimeout);

    self.stopped = true;

    var finish_shutdown = function () {
        self.debug('shutdown');

        if (self.controller) {
            self.controller.shutdown();
        }

        if (err) {
            // prefix browser err message with browser version
            err.message = self._conf.browser + '@' + self._conf.version + ': ' + err.message;
            self.emit('error', err);
            return;
        }

        self.emit('done', self.stats);
        self.removeAllListeners();
    }

    // make sure the browser shuts down before continuing
    if (self.browser) {
        self.debug('quitting browser');

        var timeout = false;
        var quit_timeout = setTimeout(function() {
            self.debug('timed out waiting for browser to quit');
            timeout = true;
            finish_shutdown();
        }, 10 * 1000);

        self.browser.quit(function(err) {
            if (timeout) {
                return;
            }

            clearTimeout(quit_timeout);
            finish_shutdown();
        });
    }
    else {
        finish_shutdown();
    }
};

module.exports = SauceBrowser;
