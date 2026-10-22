/**
 * Catalog tests: the fallback roster is what keeps the model picker usable
 * when `opencode serve` is not reachable yet.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { FALLBACK_OPENCODE_MODELS, OpenCodeCatalog } from '../src/catalog.js'

test('fallback roster is non-empty and every entry is a free, usable model', () => {
  assert.ok(FALLBACK_OPENCODE_MODELS.length > 0)
  for (const model of FALLBACK_OPENCODE_MODELS) {
    assert.equal(typeof model.id, 'string')
    assert.ok(model.id.length > 0)
    assert.equal(model.providerID, 'opencode')
    assert.equal(model.status, 'active')
    assert.equal(model.cost.input, 0)
    assert.equal(model.cost.output, 0)
    assert.ok(model.contextWindow > 0)
  }
})

test('fallback model ids are unique', () => {
  const ids = FALLBACK_OPENCODE_MODELS.map(m => m.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('a fresh catalog starts on the fallback roster', () => {
  const catalog = new OpenCodeCatalog()
  assert.equal(catalog.source(), 'fallback')
  assert.equal(catalog.current().length, FALLBACK_OPENCODE_MODELS.length)
  assert.equal(catalog.fetchedAtMs(), undefined)
})

test('set() replaces the roster and records the live source', () => {
  const catalog = new OpenCodeCatalog()
  catalog.set([{ id: 'live-only', providerID: 'opencode', name: 'Live', contextWindow: 1000, cost: { input: 0, output: 0 } }], 'live')
  assert.equal(catalog.source(), 'live')
  assert.deepEqual(catalog.current().map(m => m.id), ['live-only'])
  assert.equal(typeof catalog.fetchedAtMs(), 'number')
})
