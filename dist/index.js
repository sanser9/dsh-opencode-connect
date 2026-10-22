/**
 * OpenCode free models for DeepSeek Harness.
 * @module dsh-opencode-connect
 */

import { createProvider } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
// NOTE: no bare `@deepseek-ai/dsh-llm` import here. The host's plugin module
// resolution can bind that specifier to a stale workspace copy, which breaks
// the ESM link-time export check. dsh-llm-pi-ai already re-exports everything
// this plugin needs from the host's own instance, and the two small pieces
// that are not re-exported (default retry policy, image access) are inlined
// below.
import { createOpenCodeShim } from './shim.js'
import { OpenCodeCatalog } from './catalog.js'
import {
  ensureOpenCodeServer,
  fetchOpenCodeCatalog,
} from './opencode-server.js'
import { bridgeOpenCodeToOpenAISSE } from './stream-bridge.js'

export const name = 'llm-opencode'
export const inject = ['llm']
export const OPENCODE_PROVIDER = 'opencode'
export const OPENCODE_STREAM_IDLE_TIMEOUT_MS = 300_000

const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

const INERT_AUTH = {
  credentials: {
    async read() { return undefined },
    async list() { return [] },
    async modify() {
      throw new Error('dsh-opencode-connect: the opencode route has no pi-ai credential lifecycle')
    },
    async delete() {},
  },
  authContext: {
    async env() { return undefined },
    async fileExists() { return false },
  },
}

function toPiModel(info, baseUrl, providerId) {
  return {
    id: info.id,
    name: info.name,
    api: 'openai-completions',
    provider: providerId,
    baseUrl,
    input: info.capabilities?.attachment === true ? ['text', 'image'] : ['text'],
    cost: NO_COST,
    contextWindow: info.contextWindow,
    maxTokens: info.maxTokens ?? 8192,
    compat: { maxTokensField: 'max_tokens' },
  }
}

class OpenCodePiAiAdapter extends PiAiAdapter {
  constructor(catalog, options) {
    super(options)
    this.catalog = catalog
  }

  infoFor(model) {
    return this.catalog.current().find(entry => entry.id === model)
  }

  async listModels(provider) {
    const models = await super.listModels(provider)
    return models.flatMap(model => {
      const info = this.infoFor(model.id)
      if (info === undefined) return [model]
      const displayName = model.name === info.name ? `${info.name} · Free` : model.name
      return [{ ...model, name: displayName }]
    })
  }

  async resolveModel(provider, model, signal) {
    const resolved = await super.resolveModel(provider, model, signal)
    const info = this.infoFor(model)
    if (info === undefined) return resolved
    const displayName = resolved.name === info.name ? `${info.name} · Free` : resolved.name
    return { ...resolved, name: displayName }
  }
}

export function apply(ctx, _config) {
  let server
  let shim
  let adapter
  let releaseAdapter
  let catalog
  let refreshTimer
  let stopped = false

  const log = ctx.logger

  void (async () => {
    try {
      log.info?.('dsh-opencode-connect: ensuring local opencode server is running')
      server = await ensureOpenCodeServer(log)
      await server.ready
      log.info?.(`dsh-opencode-connect: opencode server ready at ${server.url}`)
    } catch (error) {
      log.error?.('dsh-opencode-connect: failed to start opencode server', error)
      return
    }

    if (stopped) return

    catalog = new OpenCodeCatalog()
    try {
      const fetched = await fetchOpenCodeCatalog(server.url)
      if (fetched.models.length > 0) {
        catalog.set(fetched.models, 'live')
        log.info?.(`dsh-opencode-connect: loaded ${fetched.models.length} live models`)
      }
    } catch (error) {
      log.warn?.('dsh-opencode-connect: live catalog fetch failed; using fallback roster', error)
    }

    const streamChat = (params) =>
      bridgeOpenCodeToOpenAISSE({
        opencodeUrl: server.url,
        model: params.model,
        messages: params.messages,
        signal: params.signal,
        logger: log,
      })

    shim = createOpenCodeShim({
      opencodeUrl: server.url,
      catalog: () => catalog.current(),
      streamChat,
      logger: log,
    })
    try {
      await shim.ready
      log.info?.(`dsh-opencode-connect: shim listening at ${shim.baseUrl()}`)
    } catch (error) {
      log.error?.('dsh-opencode-connect: shim failed to start', error)
      return
    }

    if (stopped) return

    const buildModels = () => {
      const baseUrl = `${shim.baseUrl()}/v1`
      return catalog.current().map(info => toPiModel(info, baseUrl, OPENCODE_PROVIDER))
    }

    const base = createProvider({
      id: OPENCODE_PROVIDER,
      name: 'OpenCode',
      auth: {
        apiKey: {
          name: 'OpenCode shared secret (shim)',
          // pi-ai's applyAuth throws `Provider is not configured` when auth
          // resolution yields nothing. The adapter always supplies the shared
          // shim token as the per-request apiKey override, so this resolver
          // only needs to return a non-empty resolution; an empty `auth`
          // object keeps the override's key in charge of the header.
          async resolve() {
            return { auth: {}, source: 'OpenCode (local shim)' }
          },
        },
      },
      models: buildModels(),
      api: openAICompletionsApi(),
    })

    const provider = { ...base, getModels: () => buildModels() }

    const profile = {
      provider: OPENCODE_PROVIDER,
      displayName: 'OpenCode',
      streamIdleTimeoutMs: OPENCODE_STREAM_IDLE_TIMEOUT_MS,
      // Mirrors resolveRetryPolicy(undefined) from @deepseek-ai/dsh-llm
      // (mode "normal" with the runtime defaults); inlined to avoid the
      // bare-specifier import explained at the top of this file.
      retryPolicy: Object.freeze({
        mode: 'normal',
        maxRetries: 2,
        retryableCodes: Object.freeze(['CONTEXT_WINDOW_EXCEEDED', 'QUOTA_EXCEEDED', 'EMPTY_RESPONSE']),
      }),
      configuredMaxTokens: new Map(),
      modelErrors: new Map(),
      maxRequestImageBytes: 20_971_520,
      requestImagePixelBudget: 4_194_304,
      requestImageMaxBytes: 1_048_576,
      piProvider: provider,
    }

    let profiles = new Map([[OPENCODE_PROVIDER, profile]])

    adapter = new OpenCodePiAiAdapter(catalog, {
      profiles: () => profiles,
      auth: INERT_AUTH,
      resolveApiKey: async () => shim.token(),
      resolveAttachments: () => ctx.get('attachments'),
      // v1 degrades image attachments to text placeholders upstream (the
      // OpenCode bridge cannot attach files yet), so no host filesystem
      // access resolution is needed here; undefined is handled by the
      // adapter via optional chaining.
      resolveImageAccess: () => undefined,
      onReplayDegrade: ({ provider: p, model, reason }) => {
        log.warn?.(`dsh-opencode-connect: unusable replay state for ${p}/${model} (${reason})`)
      },
    })

    const invalidate = () => {
      profiles = new Map([[OPENCODE_PROVIDER, profile]])
      ctx.emit('llm/adapters-updated')
    }

    try {
      releaseAdapter = ctx.llm.registerAdapter([OPENCODE_PROVIDER], adapter)
      log.info?.('dsh-opencode-connect: registered opencode provider')
    } catch (error) {
      log.error?.('dsh-opencode-connect: provider registration failed', error)
      return
    }

    refreshTimer = setInterval(async () => {
      if (stopped || server === undefined || catalog === undefined) return
      try {
        const fetched = await fetchOpenCodeCatalog(server.url)
        if (fetched.models.length > 0 && catalog.source() !== 'live') {
          catalog.set(fetched.models, 'live')
          log.info?.(`dsh-opencode-connect: catalog refreshed (${fetched.models.length} models)`)
          invalidate()
        }
      } catch {}
    }, 5 * 60_000)

    ctx.effect(() => () => {
      stopped = true
      if (refreshTimer !== undefined) clearInterval(refreshTimer)
      releaseAdapter?.()
      void shim?.close()
      void server?.close()
    })
  })()
}
