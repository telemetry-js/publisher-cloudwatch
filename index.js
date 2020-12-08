'use strict'

const RequestBuilder = require('./lib/req-builder')
const EventEmitter = require('events').EventEmitter

module.exports = function plugin (options) {
  return new CloudWatchPublisher(options)
}

class CloudWatchPublisher extends EventEmitter {
  constructor (options) {
    super()
    if (!options) options = {}

    // To avoid allocating many objects, this plugin does not use `aws-sdk`,
    // but a string builder to build HTTP requests made to CloudWatch.
    this._builder = new RequestBuilder(options)
    this._backgroundFlushCallback = this._backgroundFlushCallback.bind(this)
    this._backgroundFlushing = false
  }

  publish (metric) {
    if (metric.isSingle()) {
      this._builder.addSingleMetric(metric)
    } else if (metric.isSummary()) {
      this._builder.addSummaryMetric(metric)
    }
  }

  ping (callback) {
    if (!this._builder.hasData()) {
      // No need to dezalgo ping()
      return callback()
    }

    // Perform HTTP requests in background, to not delay other plugins.
    if (!this._backgroundFlushing) {
      this._backgroundFlush()
    }

    callback()
  }

  _backgroundFlush () {
    this._backgroundFlushing = true
    this.flush(this._backgroundFlushCallback)
  }

  _backgroundFlushCallback (err) {
    this._backgroundFlushing = false
    if (err) this.emit('error', err)
    this.emit('_flush')
  }

  stop (callback) {
    if (this._backgroundFlushing) {
      this.once('_flush', this.stop.bind(this, callback))
    } else {
      this.once('_flush', callback)
      this._backgroundFlush()
    }
  }

  // Exposed for standalone usage
  flush (options, callback) {
    if (typeof options === 'function') {
      callback = options
      options = null
    } else if (callback === undefined) {
      var promise = new Promise((resolve, reject) => {
        callback = function (err, result) {
          if (err) reject(err)
          else resolve(result)
        }
      })
    }

    this._builder.send(options, callback)
    return promise
  }
}
