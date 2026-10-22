#!/usr/bin/env node
/**
 * Build: copy the hand-written ESM sources in `src/` to `dist/`.
 *
 * The plugin ships plain JavaScript, so there is no transpilation step — the
 * only thing `dist/` adds is a stable, published location that matches
 * `package.json`'s `main` field. Keeping the copy explicit (rather than
 * pointing `main` at `src/`) lets `npm publish` ship `dist/` alone while the
 * repository stays free of build artefacts.
 */

import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const srcDir = join(root, 'src')
const distDir = join(root, 'dist')

await rm(distDir, { recursive: true, force: true })
await mkdir(distDir, { recursive: true })

const entries = await readdir(srcDir, { withFileTypes: true })
let copied = 0
for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith('.js')) continue
  await cp(join(srcDir, entry.name), join(distDir, entry.name))
  copied += 1
}

console.log(`built ${copied} file(s) into dist/`)
