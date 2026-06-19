'use strict';

// Tests for the native `'sendingBody'` ServerResponse hook, modeled on
// Fastify's onSend: a listener receives the response body as a Readable
// `payload` and returns a replacement payload (via done(err, payload) or by
// returning it). Multiple listeners are chained.

const common = require('../common');
const assert = require('assert');
const http = require('http');
const zlib = require('zlib');
const { PassThrough } = require('stream');

// 1) done(null, payload.pipe(gzip)) compresses the body transparently. The
//    listener also adjusts headers, like @fastify/compress does in onSend.
{
  const text = 'hello '.repeat(1000);

  const server = http.createServer((req, res) => {
    res.on('sendingBody', common.mustCall(function(payload, done) {
      this.setHeader('Content-Encoding', 'gzip');
      done(null, payload.pipe(zlib.createGzip()));
    }));

    res.write(text.slice(0, 3000));
    res.end(text.slice(3000));
  });

  server.listen(0, common.mustCall(() => {
    http.get({ port: server.address().port }, common.mustCall((res) => {
      assert.strictEqual(res.headers['content-encoding'], 'gzip');
      assert.strictEqual(res.headers['content-length'], undefined);
      assert.strictEqual(res.headers['transfer-encoding'], 'chunked');

      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', common.mustCall(() => {
        assert.strictEqual(zlib.gunzipSync(Buffer.concat(chunks)).toString(), text);
        server.close();
      }));
    }));
  }));
}

// 2) Synchronous `return payload` form is also supported.
{
  const text = 'return-form payload';
  const server = http.createServer((req, res) => {
    res.on('sendingBody', function(payload) {
      this.setHeader('Content-Encoding', 'gzip');
      return payload.pipe(zlib.createGzip());
    });
    res.end(text);
  });

  server.listen(0, common.mustCall(() => {
    http.get({ port: server.address().port }, common.mustCall((res) => {
      assert.strictEqual(res.headers['content-encoding'], 'gzip');
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', common.mustCall(() => {
        assert.strictEqual(zlib.gunzipSync(Buffer.concat(chunks)).toString(), text);
        server.close();
      }));
    }));
  }));
}

// 3) Multiple listeners chain: payload flows through each one in order.
{
  let sawSecond = 0;
  const text = 'chained';
  const server = http.createServer((req, res) => {
    res.on('sendingBody', function(payload, done) {
      this.setHeader('Content-Encoding', 'gzip');
      done(null, payload.pipe(zlib.createGzip()));
    });
    res.on('sendingBody', function(payload, done) {
      // Receives the gzip output of the previous listener.
      const pt = new PassThrough();
      pt.on('data', () => { sawSecond++; });
      done(null, payload.pipe(pt));
    });
    res.end(text);
  });

  server.listen(0, common.mustCall(() => {
    http.get({ port: server.address().port }, common.mustCall((res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', common.mustCall(() => {
        assert.ok(sawSecond > 0, 'data flowed through the second listener');
        assert.strictEqual(zlib.gunzipSync(Buffer.concat(chunks)).toString(), text);
        server.close();
      }));
    }));
  }));
}

// 4) A listener that returns nothing leaves the body unchanged.
{
  const text = 'unchanged body';
  const server = http.createServer((req, res) => {
    res.on('sendingBody', common.mustCall(() => undefined));
    res.end(text);
  });

  server.listen(0, common.mustCall(() => {
    http.get({ port: server.address().port }, common.mustCall((res) => {
      assert.strictEqual(res.headers['content-encoding'], undefined);
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', common.mustCall(() => {
        assert.strictEqual(Buffer.concat(chunks).toString(), text);
        server.close();
      }));
    }));
  }));
}
