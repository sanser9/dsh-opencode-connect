/**
 * Manifest and packaging regression tests.
 *
 * These pin the two things that silently break a DSH bundle: a missing
 * `dsh.bundle` manifest, and a bare `@deepseek-ai/dsh-llm` import (the host's
 * module resolution can bind that specifier to a stale copy, which fails the
 * ESM link-time export check).
 */

import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (rel) => readFile(join(root, rel), 'utf8')

test('package.json declares the DSH bundle manifest', async () => {
  const pkg = JSON.parse(await read('package.json'))
  assert.equal(pkg.name, 'dsh-opencode-connect')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.main, 'dist/index.js')
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.ok(pkg.files.includes('dist'))
  assert.ok(pkg.files.includes('cordis.patch.yml'))
})

test('@deepseek-ai packages are peer dependencies, never dependencies', async () => {
  const pkg = JSON.parse(await read('package.json'))
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    assert.ok(!name.startsWith('@deepseek-ai/'), `${name} must be a peerDependency`)
  }
  for (const name of Object.keys(pkg.peerDependencies ?? {})) {
    assert.ok(name.startsWith('@deepseek-ai/'), `${name} should be a @deepseek-ai peer`)
  }
})

test('cordis.patch.yml declares exactly one insert row', async () => {
  const yml = await read('cordis.patch.yml')
  assert.match(yml, /^\s*-\s*insert:/m)
  assert.match(yml, /id:\s*llm-opencode/)
  assert.match(yml, /name:\s*dsh-opencode-connect/)
})

test('no source file imports the bare @deepseek-ai/dsh-llm specifier', async () => {
  const files = await readdir(join(root, 'src'))
  for (const file of files.filter(f => f.endsWith('.js'))) {
    const source = await readFile(join(root, 'src', file), 'utf8')
    const bare = /from\s+['"]@deepseek-ai\/dsh-llm['"]/
    assert.ok(!bare.test(source), `${file} must not import bare @deepseek-ai/dsh-llm`)
  }
})

test('committed dist/ matches src/', async () => {
  const sources = (await readdir(join(root, 'src'))).filter(f => f.endsWith('.js'))
  for (const file of sources) {
    const [src, dist] = await Promise.all([read(join('src', file)), read(join('dist', file))])
    assert.equal(dist, src, `dist/${file} is stale — run npm run build`)
  }
})
