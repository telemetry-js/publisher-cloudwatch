# publisher-cloudwatch

> **Publish single or summary metrics to AWS CloudWatch.**  
> A [`telemetry`](https://github.com/telemetry-js/telemetry) plugin.

[![npm status](http://img.shields.io/npm/v/@telemetry-js/publisher-cloudwatch.svg)](https://www.npmjs.org/package/@telemetry-js/publisher-cloudwatch)
[![node](https://img.shields.io/node/v/@telemetry-js/publisher-cloudwatch.svg)](https://www.npmjs.org/package/@telemetry-js/publisher-cloudwatch)
[![Test](https://github.com/telemetry-js/publisher-cloudwatch/workflows/Test/badge.svg?branch=main)](https://github.com/telemetry-js/publisher-cloudwatch/actions)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

## Table of Contents

<details><summary>Click to expand</summary>

- [Usage](#usage)
  - [With Telemetry](#with-telemetry)
  - [Standalone](#standalone)
- [Options](#options)
- [Install](#install)
- [Acknowledgements](#acknowledgements)
- [License](#license)

</details>

## Usage

### With Telemetry

```js
const telemetry = require('@telemetry-js/telemetry')()
const cloudwatch = require('@telemetry-js/publisher-cloudwatch')

telemetry.task()
  .publish(cloudwatch)

// Or with options
telemetry.task()
  .publish(cloudwatch, { /* options */ })
```

If an HTTP request to CloudWatch fails, it is retried. If it fails 5 times, an `error` event will be emitted and in this case forwarded to `telemetry`:

```js
telemetry.on('error', (err) => {
  console.error(err)
})
```

### Standalone

Useful to publish one-time metrics.

```js
const cloudwatch = require('@telemetry-js/publisher-cloudwatch')
const single = require('@telemetry-js/metric').single

const publisher = cloudwatch()
const metric = single('myapp.example.count', { unit: 'count', value: 10 })

publisher.publish(metric)

await publisher.flush()
```

The `flush` method will yield an error if the HTTP request failed (after retries).

To publish multiple metrics (in one HTTP request), repeat the `.publish()` call before `.flush()`:

```js
const metric1 = single('myapp.example.count', { unit: 'count', value: 10 })
const metric2 = single('myapp.foobar.bytes', { unit: 'bytes', value: 10 })

publisher.publish(metric1)
publisher.publish(metric2)

await publisher.flush()
```

## Options

- `namespace`: string, defaults to `telemetry`
- `retry`: boolean, defaults to true
- `retryDelay`: number, milliseconds, defaults to 1000
- `timeout`: socket timeout, number, milliseconds, defaults to 60 seconds
- `credentials`: AWS credentials in the form of `{ accessKeyId, secretAccessKey }`. You normally don't need to set this, as credentials are fetched with `awscred` which supports EC2, ECS, Lambda, ..
- `region`: AWS CloudWatch region. You normally don't need to set this, as it is fetched with `awscred`.

## Install

With [npm](https://npmjs.org) do:

```
npm install @telemetry-js/publisher-cloudwatch
```

## Acknowledgements

This project is kindly sponsored by [Reason Cybersecurity Ltd](https://reasonsecurity.com).

[![reason logo](https://cdn.reasonsecurity.com/github-assets/reason_signature_logo.png)](https://reasonsecurity.com)

## License

[MIT](LICENSE) © Vincent Weevers
