'use strict'

const units = require('@telemetry-js/metric').units
const esc = require('querystring').escape
const https = require('https')
const EventEmitter = require('events').EventEmitter
const awscred = require('awscred')
const getEC2Region = require('aws-locate').getRegion
const detectElasticCompute = require('is-ec2-machine')
const detectElasticContainer = require('./is-ecs')
const Signer = require('./req-signer')

const MAX_ATTEMPTS = 10
const TOO_MANY_REQUESTS = 429
const REQ_DATUM_LIMIT = 20
const REQ_BYTE_LIMIT = 40 * 1024
const RECOVERABLE_NET_ERRORS = new Set([
  'EAI_AGAIN', // Dns lookup timeout
  'ENOTFOUND', // Dns lookup returned no result
  'ETIMEDOUT', // Connection timed out
  'ESOCKETTIMEDOUT', // Read timeout
  'ECONNREFUSED', // Connection refused
  'ECONNRESET', // Connection reset
  'EHOSTUNREACH', // Host is unreachable
  'EPIPE' // Broken pipe
])

// Body (or querystring) example for reference:
//
// Action=PutMetricData
// &Version=2010-08-01
// &Namespace=TestNamespace
//
// &MetricData.member.1.MetricName=buffers
// &MetricData.member.1.Unit=Bytes
// &MetricData.member.1.Value=231434333
// &MetricData.member.1.Dimensions.member.1.Name=InstanceID
// &MetricData.member.1.Dimensions.member.1.Value=i-aaba32d4
// &MetricData.member.1.Dimensions.member.2.Name=InstanceType
// &MetricData.member.1.Dimensions.member.2.Value=m1.small
//
// &MetricData.member.2.MetricName=latency
// &MetricData.member.2.Unit=Milliseconds
// &MetricData.member.2.Value=23
// &MetricData.member.2.Dimensions.member.1.Name=InstanceID
// &MetricData.member.2.Dimensions.member.1.Value=i-aaba32d4
// &MetricData.member.2.Dimensions.member.2.Name=InstanceType
// &MetricData.member.2.Dimensions.member.2.Value=m1.small

module.exports = class RequestBuilder extends EventEmitter {
  constructor (options, _signer) {
    super()

    const namespace = options.namespace || 'telemetry'
    const retryDelay = options.retryDelay || 1e3
    const timeout = options.timeout || 60e3

    if (typeof namespace !== 'string') {
      throw new TypeError('The "namespace" option must be a string')
    }

    if (typeof retryDelay !== 'number' || retryDelay <= 0) {
      throw new TypeError('The "retryDelay" option must be a positive number')
    }

    if (typeof timeout !== 'number' || timeout <= 0) {
      throw new TypeError('The "timeout" option must be a positive number')
    }

    this._namespace = namespace
    this._enableRetry = options.retry !== false
    this._requestTimeout = timeout
    this._retryDelay = retryDelay
    this._signer = _signer || new Signer(this._getCredentials.bind(this, options))
    this._options = options
    this._child = null
    this._reset()
  }

  _getCredentials (options, done) {
    if (options.credentials && options.region) {
      return process.nextTick(done, null, options.credentials, options.region)
    }

    const isElasticContainer = detectElasticContainer()
    const isElasticCompute = !isElasticContainer && detectElasticCompute()

    awscred.load(function (err, data) {
      if (err) return done(err)

      const credentials = options.credentials || data.credentials
      const region = options.region || data.region

      if (isElasticCompute && !options.region) {
        // awscred erroneously defaults to us-east-1 on EC2
        return getEC2Region((err, region) => {
          if (err) return done(err)
          done(null, credentials, region)
        })
      }

      done(null, credentials, region)
    })
  }

  _reset () {
    this._body = ''
    this._byteLength = 0
    this._datumCount = 0
    this._datum = []
  }

  addSingleMetric (metric) {
    this._addDatumProps(metric.name, metric.date, metric.unit, metric.resolution)
    this._addDatumValue(metric.value)
    this._addDatumDimensions(metric.tags)
    this._endDatum()
  }

  addSummaryMetric (metric) {
    this._addDatumProps(metric.name, metric.date, metric.unit, metric.resolution)
    let { sum, min, max, count } = metric.stats

    // TODO: is this right? CloudWatch docs state that all these parameters are
    // required, but does not say what to do when count is zero. While we could
    // choose not to submit the metric in this case; then we won't be able to
    // detect missing metrics.
    if (count === 0) {
      sum = 0
      min = 0
      max = 0
    }

    this._addDatumStatisticSet(sum, min, max, count)
    this._addDatumDimensions(metric.tags)
    this._endDatum()
  }

  _addDatumProps (metricName, date, unit, resolution) {
    if (date == null) {
      throw new TypeError('Date is required')
    }

    this._addDatumKeyValue('MetricName', metricName)
    this._addDatumKeyValue('Unit', units.get(unit).longName)

    // Strip milliseconds to get "2017-12-10T18:52:41Z"
    this._addDatumKeyValue('Timestamp', date.toISOString().replace(/\.\d{3}Z$/, 'Z'))

    if (resolution === 1) {
      this._addDatumKeyValue('StorageResolution', '1')
    } else if (resolution != null && resolution !== 60) {
      throw new RangeError('resolution must be one of 1 (high) or 60 seconds (normal)')
    }
  }

  _addDatumValue (value) {
    this._addDatumKeyValue('Value', value.toString())
  }

  _addDatumStatisticSet (sum, min, max, count) {
    this._addDatumKeyValue('StatisticValues.Sum', sum.toString())
    this._addDatumKeyValue('StatisticValues.Minimum', min.toString())
    this._addDatumKeyValue('StatisticValues.Maximum', max.toString())
    this._addDatumKeyValue('StatisticValues.SampleCount', count.toString())
  }

  _addDatumDimensions (dimensions) {
    let dimensionIndex = 1

    for (const name in dimensions) {
      const value = dimensions[name]

      if (name === '') throw new Error('dimension name cannot be empty')
      if (typeof name !== 'string') throw new TypeError('dimension name must be a string')

      if (value == null || value === '') continue
      if (typeof value !== 'string') throw new TypeError('dimension value must be a string')

      const prefix = `Dimensions.member.${dimensionIndex++}.`

      this._addDatumKeyValue(prefix + 'Name', name)
      this._addDatumKeyValue(prefix + 'Value', value)
    }
  }

  _addDatumKeyValue (key, value) {
    this._datum.push(encodeKeyValue(key, value))
  }

  _endDatum () {
    this._addDatum(this._datum, true)
    this._datum.length = 0
  }

  _addDatum (datum, splitRequest) {
    if (this._body === '') {
      this._body = encodeKeyValue('Action', 'PutMetricData')
      this._body += '&' + encodeKeyValue('Version', '2010-08-01')
      this._body += '&' + encodeKeyValue('Namespace', this._namespace)
      this._byteLength = Buffer.byteLength(this._body)
    }

    const prefix = `&MetricData.member.${this._datumCount + 1}.`
    const str = prefix + datum.join(prefix)
    const byteLength = Buffer.byteLength(str)

    if (this._datumCount >= REQ_DATUM_LIMIT || this._byteLength + byteLength > REQ_BYTE_LIMIT) {
      if (splitRequest === false) {
        throw new RangeError(`Datum is too big (${byteLength} bytes)`)
      }

      // Add datum to second request (or more)
      if (this._child === null) {
        this._child = new RequestBuilder(this._options, this._signer)
        this._child._addDatum(datum, false)
      } else {
        this._child._addDatum(datum, true)
      }
    } else {
      this._body += str
      this._byteLength += byteLength
      this._datumCount++
    }
  }

  hasData () {
    return this._byteLength !== 0
  }

  send (options, done) {
    if (typeof options === 'function') {
      done = options
      options = undefined
    }

    const customDate = (options && options.date) || undefined
    const batch = []

    let builder = this

    // Reset synchronously to receive new metrics while we send asynchronously
    while (builder !== null) {
      if (builder.hasData()) batch.push(builder._body)
      builder._reset()
      builder = builder._child
    }

    this._sendBatch(batch, 0, customDate, 1, done, null)
  }

  _sendBatch (batch, batchIndex, customDate, attempt, done, firstError) {
    if (batchIndex >= batch.length) return process.nextTick(done)

    this._signer.sign(batch[batchIndex], customDate, (err, requestOptions) => {
      if (err) return done(err)

      // For debugging purposes
      this.emit('send', requestOptions)

      let called = 0
      const finish = (err, statusCode) => {
        if (called++) {
          return
        }

        if (err && this._enableRetry && attempt < MAX_ATTEMPTS) {
          if (RECOVERABLE_NET_ERRORS.has(err.code)) {
            // Retry (without exponential delay, by design)
            return setTimeout(this._sendBatch.bind(this, batch, batchIndex, customDate, attempt + 1, done, firstError), this._retryDelay)
          } else if (statusCode === TOO_MANY_REQUESTS || (statusCode >= 500 && statusCode < 600)) {
            // Retry (without exponential delay, by design)
            return setTimeout(this._sendBatch.bind(this, batch, batchIndex, customDate, attempt + 1, done, firstError), this._retryDelay)
          }
        }

        // TODO: combine errors
        firstError = firstError || err

        if (batchIndex < batch.length - 1) {
          return this._sendBatch(batch, batchIndex + 1, customDate, 1, done, firstError)
        }

        done(firstError)
      }

      const request = https.request(requestOptions, (res) => {
        const statusCode = res.statusCode

        if (statusCode >= 200 && statusCode < 300) {
          finish(null, statusCode)
        } else {
          finish(new Error('HTTP ' + statusCode), statusCode)
        }

        res.destroy()
      }).on('error', finish).on('timeout', () => {
        // This error is not retried.
        finish(new Error(`Socket timeout (${this._requestTimeout}ms)`))
        request.abort()
      })

      request.setTimeout(this._requestTimeout)
      request.end(requestOptions.body)
    })
  }
}

function encodeKeyValue (key, value) {
  if (key === '') throw new Error('key cannot be empty')
  return key + '=' + encodeRfc3986(esc(value))
}

// This function assumes the string has already been percent encoded
function encodeRfc3986 (urlEncodedString) {
  return urlEncodedString.replace(/[!'()*]/g, function (c) {
    if (c === '!') return '%21'
    if (c === "'") return '%27'
    if (c === '(') return '%28'
    if (c === ')') return '%29'
    if (c === '*') return '%2A'
  })
}
