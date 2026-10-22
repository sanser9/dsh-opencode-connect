/**
 * Loopback helpers.
 * @module dsh-opencode-connect/loopback
 */

import { createServer } from 'node:http'

/** Strict IPv4 dotted-quad in the 127.0.0.0/8 loopback block. */
const IPV4_LOOPBACK = /^127\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})$/

/**
 * Resolve whether a Host header value names a loopback interface.
 *
 * Handles the three shapes a Host header can take: a bare name
 * (`localhost`), a bracketed IPv6 literal (`[::1]` or `[::1]:8080`), and an
 * IPv4 literal (`127.0.0.1:40961`).
 *
 * The IPv4 test is anchored and octet-counted rather than a `127.` prefix
 * check: `127.0.0.1.evil.com` starts with `127.` and would otherwise be
 * accepted, which is the DNS-rebinding shape a prefix check lets through.
 */
export function hostIsLoopback(host) {
  if (host === undefined || host.length === 0) return false
  const raw = host.trim().toLowerCase()
  if (raw.length === 0) return false

  // Bracketed IPv6 literal, optionally with a port: `[::1]` / `[::1]:3000`.
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']')
    if (end === -1) return false
    const literal = raw.slice(1, end)
    const rest = raw.slice(end + 1)
    if (rest.length > 0 && !/^:\d+$/.test(rest)) return false
    return literal === '::1' || literal === '0:0:0:0:0:0:0:1'
  }

  // A bare (unbracketed) IPv6 loopback is technically not a valid Host
  // header, but clients do send it and it is still loopback — accept it
  // rather than fail closed on a local caller.
  if (raw === '::1' || raw === '0:0:0:0:0:0:0:1') return true

  // Strip a port only for the IPv4/name shapes; any other value with more
  // than one colon is not something this guard recognises.
  const colons = raw.split(':').length - 1
  if (colons > 1) return false
  const name = colons === 1 ? raw.slice(0, raw.lastIndexOf(':')) : raw
  if (name.length === 0) return false

  if (name === 'localhost') return true
  return IPV4_LOOPBACK.test(name)
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
