var Zuul = require('../../');

var auth = require('../auth');
var assert = require('assert');
var URL = require('url');

test('sauce connect without loopback option', function(done) {
    var config = {
        ui: 'mocha-bdd',
        sauce_connect: true,
        username: auth.username,
        key: auth.key
    };

    var zuul = Zuul(config);

    zuul.browser({
        name: 'internet explorer',
        version: '11'
    });

    var browser = zuul._browsers[0];

    browser.on('init', function(browserConfig, url) {
        assert.equal(zuul._config.sauce_connect, true)
        assert.equal(zuul._config.tunnel, false)
        assert.equal(URL.parse(url).hostname, 'localhost')

        browser.shutdown();
    });

    browser.on('done', function(/*stats*/) {
        done();
    });

    browser.on('error', done);

    browser.start();
});

test('sauce connect with loopback option', function(done) {
    var config = {
        ui: 'mocha-bdd',
        sauce_connect: true,
        loopback: 'test.local',
        username: auth.username,
        key: auth.key
    };

    var zuul = Zuul(config);

    zuul.browser({
        name: 'internet explorer',
        version: '11'
    });

    var browser = zuul._browsers[0];

    browser.on('init', function(browserConfig, url) {
        assert.equal(zuul._config.sauce_connect, true)
        assert.equal(zuul._config.tunnel, false)
        assert.equal(URL.parse(url).hostname, 'test.local')

        browser.shutdown();
    });

    browser.on('done', function(/*stats*/) {
        done();
    });

    browser.on('error', done);

    browser.start();
});
