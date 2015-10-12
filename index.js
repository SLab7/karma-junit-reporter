var os = require('os')
var path = require('path')
var fs = require('fs')
var builder = require('xmlbuilder')

var JUnitReporter = function (baseReporterDecorator, config, logger, helper, formatError) {
  var log = logger.create('reporter.junit')
  var reporterConfig = config.junitReporter || {}
  var pkgName = reporterConfig.suite || ''
  var outputDir = reporterConfig.outputDir
  var outputFile = reporterConfig.outputFile

  var suites
  var pendingFileWritings = 0
  var fileWritingFinished = function () {}
  var allMessages = []

  if (outputDir == null) {
    outputDir = '.'
  }

  outputDir = helper.normalizeWinPath(path.resolve(config.basePath, outputDir)) + path.sep

  baseReporterDecorator(this)

  this.adapters = [
    function (msg) {
      allMessages.push(msg)
    }
  ]

  // There are multiple test suites when you use karma-environments so we use a collector for all stats per browser spawned..
  var collectors = Object.create(null);

  var initliazeXmlForBrowser = function (browser) {
    var timestamp = (new Date()).toISOString().substr(0, 19)
    if (!suites[browser.id]) {
      var suite = suites[browser.id] = builder.create('testsuite')
      suite.att('name', browser.name)
        .att('package', pkgName)
        .att('timestamp', timestamp)
        .att('id', 0)
        .att('hostname', os.hostname())

      suite.ele('properties')
        .ele('property', {name: 'browser.fullName', value: browser.fullName})
      collectors[browser.id] = {tests: 0, errors: 0, failures: 0, time: 0};
    }
  }

  var writeXmlForBrowser = function (browser) {
    var safeBrowserName = browser.name.replace(/ /g, '_')
    var newOutputFile
    if (outputFile != null) {
      var dir = path.join(outputDir, safeBrowserName)
      newOutputFile = path.join(dir, outputFile)
    } else {
      newOutputFile = path.join(outputDir, 'TESTS-' + safeBrowserName + '.xml')
    }

    var xmlToOutput = suites[browser.id]
    if (!xmlToOutput) {
      return // don't die if browser didn't start
    }

    var collector = collectors[browser.id];
    xmlToOutput.att('tests', collector.tests)
    xmlToOutput.att('errors', collector.errors)
    xmlToOutput.att('failures', collector.failures)
    xmlToOutput.att('time', collector.time)

    xmlToOutput.ele('system-out')
    xmlToOutput.ele('system-err')

    pendingFileWritings++
    helper.mkdirIfNotExists(path.dirname(newOutputFile), function () {
      fs.writeFile(newOutputFile, xmlToOutput.end({pretty: true}), function (err) {
        if (err) {
          log.warn('Cannot write JUnit xml\n\t' + err.message)
        } else {
          log.debug('JUnit results written to "%s".', newOutputFile)
        }

        if (!--pendingFileWritings) {
          fileWritingFinished()
        }
      })
    })
  }

  var currentBrowsers = null;

  this.onRunStart = function (browsers) {
    if (!suites) {
      suites = Object.create(null)
    }

    currentBrowsers = browsers;

    // TODO(vojta): remove once we don't care about Karma 0.10
    browsers.forEach(initliazeXmlForBrowser)
  }

  this.onBrowserStart = function (browser) {
    initliazeXmlForBrowser(browser)
  }

  this.onBrowserComplete = function (browser) {
    var suite = suites[browser.id]
    var result = browser.lastResult
    if (!suite || !result) {
      return // don't die if browser didn't start
    }

    //collect all stats into a single store
    var collector = collectors[browser.id];
    collector.tests += result.total;
    collector.errors += (result.disconnected || result.error ? 1 : 0)
    collector.failures += result.failed
    collector.time += ((result.netTime || 0) / 1000)
  }

  this.specSuccess = this.specSkipped = this.specFailure = function (browser, result) {
    var spec = suites[browser.id].ele('testcase', {
      name: result.description, time: ((result.time || 0) / 1000),
      classname: browser.name.replace(/ /g, '_').replace(/\./g, '_') + '.' + (pkgName ? pkgName + '.' : '') + result.suite[0]
    })

    if (result.skipped) {
      spec.ele('skipped')
    }

    if (!result.success) {
      result.log.forEach(function (err) {
        spec.ele('failure', {type: ''}, formatError(err))
      })
    }

    spec.ele('system-out').dat(allMessages.join()+'\n');
    spec.ele('system-err');

    //reset messages for the next spec..
    allMessages.length = 0;
  }

  // wait for writing all the xml files, before exiting
  this.onExit = function (done) {
    currentBrowsers.forEach(writeXmlForBrowser);
    if (pendingFileWritings) {
      fileWritingFinished = done
    } else {
      done()
    }
  }
}

JUnitReporter.$inject = ['baseReporterDecorator', 'config', 'logger', 'helper', 'formatError']

// PUBLISH DI MODULE
module.exports = {
  'reporter:junit': ['type', JUnitReporter]
}
