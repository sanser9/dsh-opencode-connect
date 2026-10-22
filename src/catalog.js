/**
 * OpenCode free-model catalog.
 * @module dsh-opencode-connect/catalog
 */

export const FALLBACK_OPENCODE_MODELS = [
  {
    id: 'big-pickle',
    providerID: 'opencode',
    name: 'Big Pickle',
    contextWindow: 200_000,
    capabilities: { temperature: true, reasoning: true, toolcall: true, attachment: true },
    status: 'active',
    cost: { input: 0, output: 0 },
  },
  {
    id: 'mimo-v2.6-flash-free',
    providerID: 'opencode',
    name: 'MiMo v2.6 Flash Free',
    contextWindow: 200_000,
    capabilities: { temperature: true, reasoning: true, toolcall: true, attachment: true },
    status: 'active',
    cost: { input: 0, output: 0 },
  },
  {
    id: 'deepseek-v4.1-flash-free',
    providerID: 'opencode',
    name: 'DeepSeek V4.1 Flash Free',
    contextWindow: 200_000,
    capabilities: { temperature: true, reasoning: true, toolcall: true, attachment: true },
    status: 'active',
    cost: { input: 0, output: 0 },
  },
  {
    id: 'glm-5.3-flash-free',
    providerID: 'opencode',
    name: 'GLM-5.3 Flash Free',
    contextWindow: 200_000,
    capabilities: { temperature: true, reasoning: true, toolcall: true, attachment: true },
    status: 'active',
    cost: { input: 0, output: 0 },
  },
  {
    id: 'minimax-m3.1-flash-free',
    providerID: 'opencode',
    name: 'MiniMax M3.1 Flash Free',
    contextWindow: 1_000_000,
    capabilities: { temperature: true, reasoning: true, toolcall: true, attachment: true },
    status: 'active',
    cost: { input: 0, output: 0 },
  },
  {
    id: 'nemotron-3-ultra-free',
    providerID: 'opencode',
    name: 'Nemotron 3 Ultra Free',
    contextWindow: 1_000_000,
    capabilities: { temperature: true, reasoning: true, toolcall: true, attachment: true },
    status: 'active',
    cost: { input: 0, output: 0 },
  },
]

export class OpenCodeCatalog {
  // NOTE: the backing fields are `_source` / `_fetchedAtMs` on purpose. They
  // used to be `this.source` / `this.fetchedAtMs`, which shadowed the
  // `source()` and `fetchedAtMs()` methods below — every call to
  // `catalog.source()` then threw "is not a function", and the caller's
  // `catch {}` swallowed it, so the 5-minute refresh silently never ran.
  constructor() {
    this.entries = [...FALLBACK_OPENCODE_MODELS]
    this._source = 'fallback'
    this._fetchedAtMs = undefined
  }

  set(models, source = 'live') {
    const now = source === 'live' ? Date.now() : undefined
    this.entries = models.map(m => ({
      ...m,
      fetchedAtMs: now,
    }))
    this._source = source
    this._fetchedAtMs = now
  }

  current() {
    return this.entries
  }

  source() {
    return this._source
  }

  fetchedAtMs() {
    return this._fetchedAtMs
  }

  raw() {
    return this.entries
  }
}
