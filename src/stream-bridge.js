/**
 * Translate one OpenCode session's event stream into OpenAI-compatible SSE.
 * @module dsh-opencode-connect/stream-bridge
 */

import { Readable } from 'node:stream'
import { createOpenCodeSession } from './opencode-server.js'

function serializeOpenAIHistory(messages) {
  if (messages.length === 0) return 'Reply with exactly: PONG'
  const lines = []
  let idx = 1
  for (const raw of messages) {
    const msg = raw
    const role = msg.role ?? 'user'
    let text = ''
    if (typeof msg.content === 'string') {
      text = msg.content
    } else if (Array.isArray(msg.content)) {
      const parts = []
      for (const c of msg.content) {
        if (c.type === 'text' && typeof c.text === 'string' && c.text.length > 0) {
          parts.push(c.text)
        } else if (c.type === 'image') {
          parts.push('[image attached]')
        }
      }
      text = parts.join('\n')
    }
    if (text.length > 0) {
      lines.push(`[${idx}] ${role}: ${text}`)
      idx += 1
    }
  }
  lines.push('')
  lines.push('Answer the latest message above, using the conversation context provided.')
  return lines.join('\n')
}

/**
 * For one OpenAI /v1/chat/completions request, create an OpenCode session,
 * send the serialized history, follow the event stream, and return a Node
 * Readable that yields OpenAI-compatible SSE bytes.
 */
export async function bridgeOpenCodeToOpenAISSE(params) {
  const { opencodeUrl, model, messages, signal, logger } = params

  const sse = new Readable({
    read() {},
  })
  let aborted = false
  let settled = false

  const push = (obj) => {
    if (aborted || settled) return
    const sseLine = `data: ${JSON.stringify(obj)}\n\n`
    if (!sse.push(Buffer.from(sseLine))) {
      sse.once('drain', () => {})
    }
  }

  const sseId = `chatcmpl-opencode-${Math.floor(Math.random() * 1e15)}`
  const modelLabel = model

  const emitSSEStart = () => {
    if (aborted || settled) return
    push({
      id: sseId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: modelLabel,
      choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
    })
  }

  const emitDelta = (content) => {
    if (aborted || settled) return
    if (content === undefined || content.length === 0) return
    push({
      id: sseId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: modelLabel,
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    })
  }

  const emitFinish = (reason, usage) => {
    if (aborted || settled) return
    // Push directly: the shared push() helper checks `settled`, which this
    // function is about to set. Writing the frames first, then flipping the
    // flag, is what keeps the finish chunk from being dropped.
    const now = Math.floor(Date.now() / 1000)
    sse.push(Buffer.from(`data: ${JSON.stringify({
      id: sseId,
      object: 'chat.completion.chunk',
      created: now,
      model: modelLabel,
      choices: [{ index: 0, delta: {}, finish_reason: reason }],
    })}\n\n`))
    if (usage !== undefined) {
      sse.push(Buffer.from(`data: ${JSON.stringify({
        id: sseId,
        object: 'chat.completion.chunk',
        created: now,
        model: modelLabel,
        choices: [],
        usage: {
          prompt_tokens: usage.input,
          completion_tokens: usage.output,
          total_tokens: usage.input + usage.output,
        },
      })}\n\n`))
    }
    settled = true
    if (!aborted) sse.push(null)
  }

  const emitError = (message, code) => {
    if (aborted || settled) return
    // Same ordering as emitFinish: frame first, flag second.
    sse.push(Buffer.from(`data: ${JSON.stringify({
      id: sseId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: modelLabel,
      choices: [{ index: 0, delta: {}, finish_reason: null }],
      error: { message, type: code, code },
    })}\n\n`))
    settled = true
    sse.push(null)
  }

  if (signal !== undefined) {
    signal.addEventListener('abort', () => {
      aborted = true
      sse.push(null)
    }, { once: true })
  }

  void (async () => {
    try {
      const sessionId = await createOpenCodeSession(opencodeUrl, `dsh-opencode-connect ${model}`, signal)
      emitSSEStart()

      const promptPromise = (async () => {
        const res = await fetch(`${opencodeUrl}/session/${sessionId}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerID: 'opencode',
            modelID: model,
            parts: [{ type: 'text', text: serializeOpenAIHistory(messages) }],
          }),
          signal,
        })
        if (!res.ok) {
          const bodyText = await res.text().catch(() => '')
          throw new Error(`opencode message failed: HTTP ${res.status} ${bodyText.slice(0, 300)}`)
        }
        const body = await res.json()
        if (body.info?.error !== undefined) {
          const data = body.info.error.data
          throw new Error(`opencode model error: ${data?.message ?? body.info.error.name} (status ${data?.statusCode})`)
        }
        return {
          usage: body.info?.tokens === undefined
            ? undefined
            : { input: body.info.tokens.input ?? 0, output: body.info.tokens.output ?? 0 },
        }
      })()

      let finishedByEvent = false
      let usageFromPrompt
      try {
        const { streamOpenCodeSessionEvents } = await import('./opencode-server.js')
        for await (const delta of streamOpenCodeSessionEvents(opencodeUrl, sessionId, signal)) {
          emitDelta(delta)
        }
        finishedByEvent = true
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        if (!msg.includes('aborted') && !(signal?.aborted)) {
          emitError(msg, 'opencode_event_stream')
          sse.push(null)
          return
        }
      }

      try {
        const result = await promptPromise
        usageFromPrompt = result.usage
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        if (!(signal?.aborted)) {
          emitError(msg, 'opencode_upstream')
        }
        sse.push(null)
        return
      }

      if (signal?.aborted) {
        sse.push(null)
        return
      }
      emitFinish('stop', usageFromPrompt)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger?.error?.('dsh-opencode-connect: stream bridge failed', error)
      if (!(signal?.aborted)) {
        emitError(msg, 'opencode_bridge')
      }
      sse.push(null)
    }
  })()

  return sse
}
