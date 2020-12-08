'use strict'

// Adapted from mhart/aws4 (MIT), 2.6x faster, added
// autoloading as well as refreshing of credentials.

const esc = require('querystring').escape
const crypto = require('crypto')
const lru = require('hashlru')
const credentialsCache = lru(1000)

// http://docs.amazonwebservices.com/general/latest/gr/signature-version-4.html

function hmac (key, string, encoding) {
  return crypto.createHmac('sha256', key).update(string, 'utf8').digest(encoding)
}

function hash (string, encoding) {
  return crypto.createHash('sha256').update(string, 'utf8').digest(encoding)
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

function trimHeaderValue (value) {
  return value.trim().replace(/\s+/g, ' ')
}

function RequestSigner (getCredentials) {
  this._getCredentials = getCredentials
  this._credentials = undefined
  this._region = undefined
}

RequestSigner.prototype.refreshCredentials = function (done) {
  // credentials: { accessKeyId, secretAccessKey, [sessionToken], [expiration: Date] }
  this._getCredentials((err, credentials, region) => {
    if (err) return done(err)

    if (!credentials.accessKeyId) {
      return done(new Error('Missing accessKeyId'))
    } else if (!credentials.secretAccessKey) {
      return done(new Error('Missing secretAccessKey'))
    } else if (!region) {
      return done(new Error('Missing region'))
    }

    this._credentials = credentials
    this._region = region

    if (!this.hasFreshCredentials(new Date())) {
      return done(new Error('credentials did not successfully refresh'))
    }

    done()
  })
}

RequestSigner.prototype.hasFreshCredentials = function (now) {
  if (this._credentials === undefined) return false
  if (this._credentials.expiration === undefined) return true

  // We'd like these credentials to be valid for at least 30 more seconds
  return now.valueOf() < this._credentials.expiration.valueOf() - 30e3
}

// body: string | object
// customDate: Date
RequestSigner.prototype.sign = function (body, customDate, done) {
  if (typeof customDate === 'function') {
    done = customDate
    customDate = undefined
  }

  const now = new Date()

  if (!this.hasFreshCredentials(now)) {
    return this.refreshCredentials(err => {
      if (err) return done(err)
      this.sign(body, customDate, done)
    })
  }

  if (typeof body !== 'string') body = this.buildBody(body)

  const bodyHash = hash(body, 'hex')
  const hostname = 'monitoring.' + this._region + '.amazonaws.com'
  const datetime = (customDate || now).toISOString().replace(/[:-]|\.\d{3}/g, '')
  const date = datetime.substr(0, 8)

  const request = {
    hostname: hostname,
    path: '/',
    method: 'POST',
    body: body,
    headers: {
      host: hostname,
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
      'content-length': String(Buffer.byteLength(body)),
      'x-amz-content-sha256': bodyHash,

      // AWS also supports "date" but prefers "x-amz-date".
      'x-amz-date': datetime
    }
  }

  // We don't sign content-type and content-length, same as aws-sdk.
  // This signedHeaders array must be sorted, don't change the order.
  const signedHeaders = ['host', 'x-amz-content-sha256', 'x-amz-date']
  const headers = request.headers

  if (this._credentials.sessionToken) {
    headers['x-amz-security-token'] = this._credentials.sessionToken

    // This header, if set, must be signed
    signedHeaders.push('x-amz-security-token')
  }

  const canonicalHeaders = new Array(signedHeaders.length)

  for (let i = 0; i < signedHeaders.length; i++) {
    const k = signedHeaders[i]
    canonicalHeaders[i] = k + ':' + trimHeaderValue(headers[k])
  }

  headers.authorization = this.authHeader(
    request.method,
    request.path,
    datetime,
    date,
    signedHeaders.join(';'),
    canonicalHeaders.join('\n') + '\n',
    bodyHash
  )

  done(null, request)
}

RequestSigner.prototype.authHeader = function (method, path, datetime, date, signedHeaders, canonicalHeaders, bodyHash) {
  return (
    'AWS4-HMAC-SHA256 Credential=' + this._credentials.accessKeyId + '/' + this.credentialString(date) + ', ' +
    'SignedHeaders=' + signedHeaders + ', ' +
    'Signature=' + this.signature(method, path, datetime, date, signedHeaders, canonicalHeaders, bodyHash)
  )
}

RequestSigner.prototype.signature = function (method, path, datetime, date, signedHeaders, canonicalHeaders, bodyHash) {
  const cacheKey = this._credentials.secretAccessKey + '|' + date + '|' + this._region + '|' + 'monitoring'

  let kCredentials = credentialsCache.get(cacheKey)

  if (!kCredentials) {
    const kDate = hmac('AWS4' + this._credentials.secretAccessKey, date)
    const kRegion = hmac(kDate, this._region)
    const kService = hmac(kRegion, 'monitoring')

    kCredentials = hmac(kService, 'aws4_request')
    credentialsCache.set(cacheKey, kCredentials)
  }

  return hmac(kCredentials, this.stringToSign(method, path, datetime, date, signedHeaders, canonicalHeaders, bodyHash), 'hex')
}

RequestSigner.prototype.stringToSign = function (method, path, datetime, date, signedHeaders, canonicalHeaders, bodyHash) {
  return (
    'AWS4-HMAC-SHA256' + '\n' +
    datetime + '\n' +
    this.credentialString(date) + '\n' +
    hash(this.canonicalString(method, path, signedHeaders, canonicalHeaders, bodyHash), 'hex')
  )
}

RequestSigner.prototype.buildBody = function (body) {
  const lines = Object.keys(body)

  for (let i = 0; i < lines.length; i++) {
    const k = lines[i]
    if (k === '') throw new Error('key cannot be empty')
    lines[i] = k + '=' + encodeRfc3986(esc(body[k]))
  }

  return lines.join('&')
}

RequestSigner.prototype.canonicalString = function (method, path, signedHeaders, canonicalHeaders, bodyHash) {
  return (
    method + '\n' +
    path + '\n' +
    /* query string + */ '\n' +
    canonicalHeaders + '\n' +
    signedHeaders + '\n' +
    bodyHash
  )
}

RequestSigner.prototype.credentialString = function (date) {
  return date + '/' + this._region + '/monitoring/aws4_request'
}

module.exports = RequestSigner
