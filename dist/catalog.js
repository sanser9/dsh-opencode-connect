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
  constructor() {
    this.entries = [...FALLBACK_OPENCODE_MODELS]
    this.source = 'fallback'
    this.fetchedAtMs = undefined
  }

  set(models, source = 'live') {
    this.entries = models.map(m => ({
      ...m,
      fetchedAtMs: source === 'live' ? Date.now() : undefined,
    }))
    this.source = source
    this.fetchedAtMs = source === 'live' ? Date.now() : undefined
  }

  current() {
    return this.entries
  }

  source() {
    return this.source
  }

  fetchedAtMs() {
    return this.fetchedAtMs
  }

  raw() {
    return this.entries
  }
}
