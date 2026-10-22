/**
 * Loopback OpenAI-compatible shim.
 * @module dsh-opencode-connect/shim
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

import { hostIsLoopback, originIsLoopback } from './loopback.js'

const REQUEST_BODY_LIMIT = 64 * 1024 * 1024

function isJsonContentType(req) {
  const type = req.headers['content-type']
  return typeof type === 'string' && type.trim().toLowerCase().startsWith('application/json')
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function writeOpenAIError(res, status, message, type = 'invalid_request_error') {
  writeJson(res, status, { error: { message, type, code: type } })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > REQUEST_BODY_LIMIT) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * Start the loopback OpenAI-compatible shim.
 */
export function createOpenCodeShim(options) {
  const { opencodeUrl, catalog, streamChat, logger } = options
  const SHARED_SECRET = randomBytes(32).toString('base64url')

  function bearerOk(req) {
    const header = req.headers.authorization
    if (typeof header !== 'string') return false
    const prefix = 'Bearer '
    if (!header.startsWith(prefix)) return false
    const token = header.slice(prefix.length).trim()
    const expected = Buffer.from(SHARED_SECRET)
    const actual = Buffer.from(token)
    if (expected.length !== actual.length) return false
    return timingSafeEqual(expected, actual)
  }

  const handler = async (req, res) => {
    if (!hostIsLoopback(req.headers.host)) {
      writeOpenAIError(res, 403, 'forbidden: non-loopback Host', 'forbidden')
      return
    }
    if (req.headers.origin !== undefined && !originIsLoopback(req.headers.origin)) {
      writeOpenAIError(res, 403, 'forbidden: non-loopback Origin', 'forbidden')
      return
    }
    if (!bearerOk(req)) {
      writeOpenAIError(res, 401, 'unauthorized: missing or invalid Bearer token', 'unauthorized')
      return
    }

    const method = req.method ?? 'GET'
    const url = (req.url ?? '/').split('?')[0]

    if (method === 'GET' && url === '/v1/models') {
      const models = catalog()
      writeJson(res, 200, {
        object: 'list',
        data: models.map(m => ({
          id: m.id,
          object: 'model',
          created: Math.floor((m.fetchedAtMs ?? Date.now()) / 1000),
          owned_by: 'opencode',
        })),
      })
      return
    }

    if (method === 'POST' && url === '/v1/chat/completions') {
      if (!isJsonContentType(req)) {
        writeOpenAIError(res, 400, 'Content-Type must be application/json')
        return
      }
      const raw = await readBody(req)
      let body
      try {
        body = JSON.parse(raw.toString('utf-8'))
      } catch {
        writeOpenAIError(res, 400, 'invalid JSON body')
        return
      }
      const model = body.model ?? ''
      if (model.length === 0) {
        writeOpenAIError(res, 400, 'model is required')
        return
      }

      const controller = new AbortController()
      const onAbort = () => controller.abort()
      req.on('close', onAbort)

      try {
        const stream = await streamChat({
          model,
          messages: Array.isArray(body.messages) ? body.messages : [],
          signal: controller.signal,
        })
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })
        stream.on('error', (err) => {
          logger?.error?.('dsh-opencode-connect: shim stream error', err)
          res.end()
        })
        stream.pipe(res)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        if (!res.headersSent) {
          writeOpenAIError(res, 502, `opencode upstream error: ${msg.slice(0, 300)}`, 'upstream_error')
        } else {
          res.end()
        }
      } finally {
        req.off('close', onAbort)
      }
      return
    }

    writeOpenAIError(res, 404, `unknown route ${method} ${url}`, 'not_found')
  }

  let port = 0
  let closeImpl

  const ready = new Promise((resolve, reject) => {
    const server = createServer(handler)
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      port = typeof addr === 'object' && addr !== null ? addr.port : 0
      closeImpl = () => new Promise((res2, rej2) => {
        server.closeAllConnections?.()
        server.close(err => (err ? rej2(err) : res2()))
      })
      resolve()
    })
  })

  return {
    ready,
    baseUrl: () => `http://127.0.0.1:${port}`,
    token: () => SHARED_SECRET,
    close: async () => closeImpl(),
  }
}
