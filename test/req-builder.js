'use strict'

const test = require('tape')
const nock = require('nock')
const proxyquire = require('proxyquire')
const awscredSpies = []

const RequestBuilder = proxyquire('../lib/req-builder', {
  awscred: {
    load: function (...args) {
      awscredSpies.shift()(...args)
    }
  }
})

const NAMESPACE = 'test'
const REQ_DATUM_LIMIT = 20

test('RequestBuilder', function (t) {
  t.plan(6)

  const builder = new RequestBuilder({
    namespace: NAMESPACE
  })

  awscredSpies.push((callback) => {
    t.pass('loading credentials and region')

    process.nextTick(callback, null, {
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'xxx',
        secretAccessKey: 'xxx'
      }
    })
  })

  builder.addSingleMetric({
    // TODO (later): update names (here and below) to match appoptics style
    name: 'TestCount',
    date: new Date(1),
    unit: 'count',
    resolution: 60,
    value: 2.5,
    // TODO (later): update tag names (here and below) to match appoptics style
    tags: {
      TestDimension1: '1',
      TestDimension2: '2'
    }
  })

  builder.addSingleMetric({
    name: 'TestBytes',
    date: new Date(2),
    unit: 'bytes',
    value: 200,
    tags: {
      TestDimension3: '3',
      TestDimension4: '4'
    }
  })

  builder.addSummaryMetric({
    name: 'TestSeconds',
    date: new Date(3),
    unit: 'seconds',
    stats: {
      min: 1,
      max: 2,
      sum: 3,
      count: 2
    },
    // test empty dimensions
    tags: {}
  })

  builder.addSummaryMetric({
    name: 'TestPercent',
    date: new Date(4),
    unit: 'percent',
    stats: {
      min: 10.2,
      max: 25,
      sum: 50,
      count: 3
    },
    tags: {
      TestDimension1: '1'
    }
  })

  const expectedBody = fixture()
  const date = new Date('2017-12-11T11:53:54Z')

  t.is(builder._body, expectedBody, 'got body')

  builder.on('send', function (requestOptions) {
    t.same(requestOptions, {
      hostname: 'monitoring.us-east-1.amazonaws.com',
      path: '/',
      method: 'POST',
      headers: {
        host: 'monitoring.us-east-1.amazonaws.com',
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
        'content-length': '1543',
        'x-amz-content-sha256': '9d4be2f6566498d421014325737425f424d8b8a5b0e84a1f103beec8d3a8bbca',
        'x-amz-date': '20171211T115354Z',
        authorization: 'AWS4-HMAC-SHA256 Credential=xxx/20171211/us-east-1/monitoring/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=1a1d517c57d395eda296f1a5a82bcc97b6c21f8309bc1db3da3fcfa9208e43e7'
      },
      body: expectedBody
    })
  }, 'signed request')

  const scope = nock('https://monitoring.us-east-1.amazonaws.com').post('/').reply(function (url, body) {
    t.notOk('x-amz-security-token' in this.req.headers)
    t.is(body, expectedBody)

    return [200, [
      '<PutMetricDataResponse xmlns="http://monitoring.amazonaws.com/doc/2010-08-01/">\n',
      '  <ResponseMetadata>\n',
      '    <RequestId>abc</RequestId>\n',
      '  </ResponseMetadata>\n',
      '</PutMetricDataResponse>\n'
    ].join(''), {
      'x-amzn-requestid': 'abc',
      'content-type': 'text/xml',
      'content-length': '212',
      date: 'Wed, 22 Feb 2012 22:47:15 GMT'
    }]
  })

  builder.send({ date }, (err) => {
    t.ifError(err, 'no send error')
    scope.done()
  })
})

test('retry', function (t) {
  t.plan(9)

  const builder = new RequestBuilder({
    namespace: NAMESPACE,
    retryDelay: 200
  })

  awscredSpies.push((callback) => {
    t.pass('loading credentials and region')

    process.nextTick(callback, null, {
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'xxx',
        secretAccessKey: 'xxx'
      }
    })
  })

  builder.addSingleMetric({
    // TODO (later): update names (here and below) to match appoptics style
    name: 'TestCount',
    date: new Date(1),
    unit: 'count',
    resolution: 60,
    value: 2.5,
    // TODO (later): update tag names (here and below) to match appoptics style
    tags: {
      TestDimension1: '1',
      TestDimension2: '2'
    }
  })

  builder.addSingleMetric({
    name: 'TestBytes',
    date: new Date(2),
    unit: 'bytes',
    value: 200,
    tags: {
      TestDimension3: '3',
      TestDimension4: '4'
    }
  })

  builder.addSummaryMetric({
    name: 'TestSeconds',
    date: new Date(3),
    unit: 'seconds',
    stats: {
      min: 1,
      max: 2,
      sum: 3,
      count: 2
    },
    // test empty dimensions
    tags: {}
  })

  builder.addSummaryMetric({
    name: 'TestPercent',
    date: new Date(4),
    unit: 'percent',
    stats: {
      min: 10.2,
      max: 25,
      sum: 50,
      count: 3
    },
    tags: {
      TestDimension1: '1'
    }
  })

  const expectedBody = fixture()
  const date = new Date('2017-12-11T11:53:54Z')

  t.is(builder._body, expectedBody, 'got body')

  builder.on('send', function (requestOptions) {
    t.same(requestOptions, {
      hostname: 'monitoring.us-east-1.amazonaws.com',
      path: '/',
      method: 'POST',
      headers: {
        host: 'monitoring.us-east-1.amazonaws.com',
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
        'content-length': '1543',
        'x-amz-content-sha256': '9d4be2f6566498d421014325737425f424d8b8a5b0e84a1f103beec8d3a8bbca',
        'x-amz-date': '20171211T115354Z',
        authorization: 'AWS4-HMAC-SHA256 Credential=xxx/20171211/us-east-1/monitoring/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=1a1d517c57d395eda296f1a5a82bcc97b6c21f8309bc1db3da3fcfa9208e43e7'
      },
      body: expectedBody
    })
  }, 'signed request')

  const scope = nock('https://monitoring.us-east-1.amazonaws.com')
    .post('/').reply(function (url, body) {
      t.is(body, expectedBody)
      return [500, '']
    })
    .post('/').reply(function (url, body) {
      t.is(body, expectedBody)
      return [429, '']
    })
    .post('/').reply(function (url, body) {
      t.is(body, expectedBody)

      return [200, [
        '<PutMetricDataResponse xmlns="http://monitoring.amazonaws.com/doc/2010-08-01/">\n',
        '  <ResponseMetadata>\n',
        '    <RequestId>abc</RequestId>\n',
        '  </ResponseMetadata>\n',
        '</PutMetricDataResponse>\n'
      ].join(''), {
        'x-amzn-requestid': 'abc',
        'content-type': 'text/xml',
        'content-length': '212',
        date: 'Wed, 22 Feb 2012 22:47:15 GMT'
      }]
    })

  builder.send({ date }, (err) => {
    t.ifError(err, 'no send error')
    scope.done()
  })
})

test('disable retry', function (t) {
  t.plan(2)

  const builder = new RequestBuilder({
    namespace: NAMESPACE,
    retry: false
  })

  awscredSpies.push((callback) => {
    process.nextTick(callback, null, {
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'xxx',
        secretAccessKey: 'xxx'
      }
    })
  })

  builder.addSingleMetric({
    // TODO (later): update names (here and below) to match appoptics style
    name: 'TestCount',
    date: new Date(1),
    unit: 'count',
    resolution: 60,
    value: 2.5,
    // TODO (later): update tag names (here and below) to match appoptics style
    tags: {
      TestDimension1: '1',
      TestDimension2: '2'
    }
  })

  const scope = nock('https://monitoring.us-east-1.amazonaws.com')
    .post('/').reply(function (url, body) {
      t.pass('made request')
      return [500, '']
    })

  builder.send((err) => {
    t.is(err.message, 'HTTP 500')
    scope.done()
  })
})

test('timeout', function (t) {
  t.plan(1)

  const builder = new RequestBuilder({
    namespace: NAMESPACE,
    timeout: 200
  })

  awscredSpies.push((callback) => {
    process.nextTick(callback, null, {
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'xxx',
        secretAccessKey: 'xxx'
      }
    })
  })

  builder.addSingleMetric({
    // TODO (later): update names (here and below) to match appoptics style
    name: 'TestCount',
    date: new Date(1),
    unit: 'count',
    resolution: 60,
    value: 2.5,
    // TODO (later): update tag names (here and below) to match appoptics style
    tags: {
      TestDimension1: '1',
      TestDimension2: '2'
    }
  })

  const scope = nock('https://monitoring.us-east-1.amazonaws.com')
    .post('/').socketDelay(2000).reply(200, 'foo')

  builder.send((err) => {
    t.is(err.message, 'Socket timeout (200ms)')
    scope.done()
  })
})

for (let i = 0; i < 10; i++) {
  // Randomize input
  const datumCount = i === 0 ? REQ_DATUM_LIMIT : i === 1 ? REQ_DATUM_LIMIT + 1 : random(1, REQ_DATUM_LIMIT * 3)
  const requestCount = Math.ceil(datumCount / REQ_DATUM_LIMIT)

  // Instantiate here, to test that builder can be reused
  const builder = new RequestBuilder({ namespace: NAMESPACE }, {
    sign (body, customDate, callback) {
      process.nextTick(callback, null, {
        hostname: 'localhost',
        path: '/',
        method: 'POST',
        body
      })
    }
  })

  test(`batches requests (${i}, ${datumCount} over ${requestCount})`, function (t) {
    t.plan(requestCount + 1)

    const scope = nock('https://localhost').post('/').times(requestCount).reply(200, '')
    const bodies = []

    for (let i = 0; i < datumCount; i++) {
      builder.addSingleMetric({
        name: 'test.count',
        date: new Date(1),
        unit: 'count',
        resolution: 60,
        value: i
      })
    }

    for (let r = 0; r < requestCount; r++) {
      let expectedBody = 'Action=PutMetricData&Version=2010-08-01&Namespace=test'
      let value = r * REQ_DATUM_LIMIT

      for (let i = 1; i <= REQ_DATUM_LIMIT && value < datumCount; i++) {
        expectedBody += `&MetricData.member.${i}.MetricName=test.count&MetricData.member.${i}.Unit=Count&MetricData.member.${i}.Timestamp=1970-01-01T00%3A00%3A00Z&MetricData.member.${i}.Value=${value}`
        value++
      }

      bodies.push(expectedBody)
    }

    builder.on('send', onsend)

    function onsend (requestOptions) {
      t.same(requestOptions.body, bodies.shift())
    }

    builder.send(function (err) {
      builder.removeListener('send', onsend)
      scope.done()
      t.is(err, null)
    })

    let child = builder

    while (child !== null) {
      if (child._body !== '' || child._datumCount !== 0) {
        throw new Error('Did not reset synchronously')
      }

      child = child._child
    }
  })
}

function random (min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min)
}

function fixture () {
  return [
    'Action=PutMetricData',
    '&Version=2010-08-01',
    '&Namespace=' + NAMESPACE,
    '&MetricData.member.1.MetricName=TestCount',
    '&MetricData.member.1.Unit=Count',
    '&MetricData.member.1.Timestamp=1970-01-01T00%3A00%3A00Z',
    '&MetricData.member.1.Value=2.5',
    '&MetricData.member.1.Dimensions.member.1.Name=TestDimension1',
    '&MetricData.member.1.Dimensions.member.1.Value=1',
    '&MetricData.member.1.Dimensions.member.2.Name=TestDimension2',
    '&MetricData.member.1.Dimensions.member.2.Value=2',

    '&MetricData.member.2.MetricName=TestBytes',
    '&MetricData.member.2.Unit=Bytes',
    '&MetricData.member.2.Timestamp=1970-01-01T00%3A00%3A00Z',
    '&MetricData.member.2.Value=200',
    '&MetricData.member.2.Dimensions.member.1.Name=TestDimension3',
    '&MetricData.member.2.Dimensions.member.1.Value=3',
    '&MetricData.member.2.Dimensions.member.2.Name=TestDimension4',
    '&MetricData.member.2.Dimensions.member.2.Value=4',

    '&MetricData.member.3.MetricName=TestSeconds',
    '&MetricData.member.3.Unit=Seconds',
    '&MetricData.member.3.Timestamp=1970-01-01T00%3A00%3A00Z',
    '&MetricData.member.3.StatisticValues.Sum=3',
    '&MetricData.member.3.StatisticValues.Minimum=1',
    '&MetricData.member.3.StatisticValues.Maximum=2',
    '&MetricData.member.3.StatisticValues.SampleCount=2',

    '&MetricData.member.4.MetricName=TestPercent',
    '&MetricData.member.4.Unit=Percent',
    '&MetricData.member.4.Timestamp=1970-01-01T00%3A00%3A00Z',
    '&MetricData.member.4.StatisticValues.Sum=50',
    '&MetricData.member.4.StatisticValues.Minimum=10.2',
    '&MetricData.member.4.StatisticValues.Maximum=25',
    '&MetricData.member.4.StatisticValues.SampleCount=3',
    '&MetricData.member.4.Dimensions.member.1.Name=TestDimension1',
    '&MetricData.member.4.Dimensions.member.1.Value=1'
  ].join('')
}
