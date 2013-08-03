# zuul

Zuul is a test runner/harness to make running your mocha tests in a browser easier. Just point it at your mocha test files and let zuul consume them!

## zuul server

If you want to see the output of your mocha tests in a pretty browser window use zuul with the ```server``` option.

```shell
$ zuul --server 9000 --debug /path/to/your/tests
```

Zuul will start a server on localhost:9000 which you can visit to get awesome html output (courtesy of mocha).

![html](https://raw.github.com/shtylman/zuul/master/img/html.png)

## headless zuul

If you just want to run your tests in a headless environment courtesy of mocha-phantomjs and phantomjs, zuul will oblige!

```shell
$ zuul /path/to/your/tests
```

![headless](https://raw.github.com/shtylman/zuul/master/img/headless.png)

## finding tests

You can specify either a specific javascript file(s) or a directory(s) to zuul. If you specify a directory, zuul will load all of the ```.js``` files in that directory.

## mocha.opts

If ```test/mocha.opts``` is available relative to your launch directory, then zuul will incorporate those options into the mocha setup.

## install

```shell
$ npm install -g zuul
```

## credits

This probject is just a tiny tool. The real credit goes to these projects.

* [phantomjs](http://phantomjs.org/)
* [mocha](http://visionmedia.github.com/mocha/)
* [mocha-phantomjs](https://github.com/metaskills/mocha-phantomjs)
* [express](http://expressjs.com/)
* [browserify](https://github.com/substack/node-browserify)
