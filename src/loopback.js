/**
 * Loopback helpers.
 * @module dsh-opencode-connect/loopback
 */

import { createServer } from 'node:http'

/** Resolve whether a Host header value names a loopback interface. */
export function hostIsLoopback(host) {
  if (host === undefined || host.length === 0) return false
  const name = host.split(':')[0]?.toLowerCase()
  if (name === undefined || name.length === 0) return false
  if (name === 'localhost') return true
  if (name === '::1') return true
  if (name === '[::1]') return true
  if (name.startsWith('127.')) return true
  return false
}

/** Resolve whether a browser-sent Origin header names a loopback origin. */
export function originIsLoopback(origin) {
  if (origin === undefined || origin.length === 0) return true
  try {
    const url = new URL(origin)
    return hostIsLoopback(url.hostname)
  } catch {
    return false
  }
}

/** Bind an HTTP server to 127.0.0.1 on an OS-assigned free port. */
export function bindToUsablePort(handler) {
  return new Promise((resolve, reject) => {
    const server = createServer(handler)
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr === null || typeof addr === 'string') {
        server.close()
        reject(new Error('bindToUsablePort: no address'))
        return
      }
      const port = addr.port
      resolve({
        server,
        port,
        close: () => new Promise((res2, rej2) => {
          server.closeAllConnections?.()
          server.close(err => (err ? rej2(err) : res2()))
        }),
      })
    })
  })
}

/** Guard middleware: reject non-loopback requests. */
export function refuseNonLoopback(req, res) {
  const host = req.headers.host
  if (!hostIsLoopback(host)) {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'forbidden: non-loopback Host', type: 'forbidden', code: 'forbidden' } }))
    return true
  }
  const origin = req.headers.origin
  if (origin !== undefined && !originIsLoopback(origin)) {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'forbidden: non-loopback Origin', type: 'forbidden', code: 'forbidden' } }))
    return true
  }
  return false
}
