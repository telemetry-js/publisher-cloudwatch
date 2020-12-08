'use strict'

const test = require('tape')
const nock = require('nock')
const single = require('@telemetry-js/metric').single
const plugin = require('..')

const namespace = 'test'
const credentials = { accessKeyId: 'dummy', secretAccessKey: 'dummy' }
const region = 'dummy-region'

test('publish metric with manual flush', function (t) {
  t.plan(2)

  const publisher = plugin({ namespace, credentials, region })

  publisher.publish(single('test.count', { unit: 'count', value: 1 }))

  nock('https://monitoring.dummy-region.amazonaws.com').post('/').reply(function (url, body) {
    t.pass('sent')
    return [200, '']
  })

  publisher.flush((err) => {
    t.ifError(err, 'no flush error')
  })
})

test('ping() triggers a flush', function (t) {
  t.plan(2)

  const publisher = plugin({ namespace, credentials, region })

  publisher.publish(single('test.count', { unit: 'count', value: 1 }))

  nock('https://monitoring.dummy-region.amazonaws.com').post('/').reply(function (url, body) {
    t.pass('sent')
    return [200, '']
  })

  publisher.ping((err) => {
    t.ifError(err, 'no ping error')
  })
})

test('stop() triggers a flush', function (t) {
  t.plan(2)

  const publisher = plugin({ namespace, credentials, region })

  publisher.publish(single('test.count', { unit: 'count', value: 1 }))

  nock('https://monitoring.dummy-region.amazonaws.com').post('/').reply(function (url, body) {
    t.pass('sent')
    return [200, '']
  })

  publisher.stop((err) => {
    t.ifError(err, 'no stop error')
  })
})

test('stop() waits for current flush and then triggers a second flush', function (t) {
  t.plan(4)

  const publisher = plugin({ namespace, credentials, region })
  const order = []

  publisher.publish(single('test.count', { unit: 'count', value: 1 }))

  nock('https://monitoring.dummy-region.amazonaws.com').post('/').delay(300).reply(function (url, body) {
    t.pass('sent')
    return [200, '']
  })

  publisher.on('_flush', () => {
    order.push('_flush')
  })

  publisher.ping((err) => {
    order.push('pinged')
    t.ifError(err, 'no ping error')
  })

  publisher.stop((err) => {
    order.push('stopped')
    t.ifError(err, 'no stop error')
    t.same(order, ['pinged', '_flush', '_flush', 'stopped'])
  })
})
