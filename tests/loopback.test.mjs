/**
 * Loopback guard tests: the shim's only defence against non-local callers.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hostIsLoopback, originIsLoopback } from '../src/loopback.js'

test('hostIsLoopback accepts every loopback spelling', () => {
  for (const host of ['localhost', 'localhost:8080', '127.0.0.1', '127.0.0.1:49627', '127.9.9.9', '[::1]', '[::1]:3000', '::1']) {
    assert.equal(hostIsLoopback(host), true, `expected ${host} to be loopback`)
  }
})

test('hostIsLoopback rejects remote and malformed hosts', () => {
  for (const host of ['example.com', 'example.com:80', '10.0.0.1', '192.168.1.5:8080', '', undefined, 'localhost.evil.com', '127.0.0.1.evil.com']) {
    assert.equal(hostIsLoopback(host), false, `expected ${String(host)} to be rejected`)
  }
})

test('originIsLoopback treats a missing origin as local (same-origin curl) and rejects remote origins', () => {
  assert.equal(originIsLoopback(undefined), true)
  assert.equal(originIsLoopback(''), true)
  assert.equal(originIsLoopback('http://127.0.0.1:43120'), true)
  assert.equal(originIsLoopback('http://localhost:3000'), true)
  assert.equal(originIsLoopback('https://evil.example.com'), false)
  assert.equal(originIsLoopback('not a url'), false)
})
