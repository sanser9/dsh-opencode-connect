/**
 * OpenCode server lifecycle and HTTP client.
 * @module dsh-opencode-connect/opencode-server
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** Fixed port the plugin's own opencode server listens on. */
export const OPENCODE_SERVER_PORT = 40961

/** The server's base URL once running. */
export const OPENCODE_SERVER_URL = `http://127.0.0.1:${OPENCODE_SERVER_PORT}`

/** Locate the persistently installed opencode binary. */
export function resolveOpenCodeBinary() {
  const candidates = [
    path.join(os.homedir(), '.local', 'share', 'dsh-opencode-connect', 'bin', 'opencode'),
    path.join(os.homedir(), '.local', 'bin', 'opencode'),
    '/usr/local/bin/opencode',
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return 'opencode'
}

/** Whether the opencode binary is present and executable. */
export function hasOpenCodeBinary() {
  const bin = resolveOpenCodeBinary()
  if (bin === undefined) return false
  if (bin === 'opencode') return true
  try {
    const { execSync } = require('node:child_process')
    execSync(`${JSON.stringify(bin)} --version`, { stdio: 'ignore', timeout: 5_000 })
    return true
  } catch {
    return false
  }
}

/**
 * Probe whether an OpenCode server is already listening at OPENCODE_SERVER_URL.
 */
export function probeRunningServer(timeoutMs = 3_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(OPENCODE_SERVER_URL + '/session', {
    method: 'GET',
    signal: controller.signal,
  })
    .then(res => res.ok)
    .catch(() => false)
    .finally(() => clearTimeout(timer))
}

/**
 * Bring up the OpenCode server: probe for an existing one first, and spawn
 * the owned process only when nothing answers.
 */
export async function ensureOpenCodeServer(logger) {
  const running = await probeRunningServer()
  if (running) {
    return {
      ready: Promise.resolve(),
      url: OPENCODE_SERVER_URL,
      child: undefined,
      owned: false,
      close: async () => {},
    }
  }

  const binary = resolveOpenCodeBinary()
  if (binary === undefined) {
    throw new Error('dsh-opencode-connect: no opencode binary found; install one at ~/.local/share/dsh-opencode-connect/bin/opencode')
  }

  logger?.info?.(`dsh-opencode-connect: spawning opencode server from ${binary}`)

  const child = spawn(binary, ['serve', '--port', String(OPENCODE_SERVER_PORT)], {
    env: {
      ...process.env,
      XDG_STATE_HOME: path.join(os.homedir(), '.local', 'share', 'opencode'),
      OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })

  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (d) => { stdout += d.toString() })
  child.stderr?.on('data', (d) => { stderr += d.toString() })
  const exited = new Promise(resolve => { child.on('exit', () => resolve()) })

  let childError
  child.on('error', (err) => { childError = err })

  const ready = new Promise((resolve, reject) => {
    let attempts = 0
    const MAX_ATTEMPTS = 40
    const tick = async () => {
      if (childError !== undefined) return reject(childError)
      if (child.exitCode === null && childError === undefined) {
        attempts += 1
        try {
          const res = await fetch(OPENCODE_SERVER_URL + '/session', {
            method: 'GET',
            signal: AbortSignal.timeout(1_500),
          })
          if (res.ok) return resolve()
        } catch {}
        if (attempts >= MAX_ATTEMPTS) {
          return reject(new Error(
            `opencode server did not become reachable within ${MAX_ATTEMPTS * 500} ms; stdout=${stdout.slice(-400)} stderr=${stderr.slice(-400)}`
          ))
        }
        setTimeout(tick, 500)
      } else {
        reject(new Error(`opencode serve exited early; stdout=${stdout.slice(-400)} stderr=${stderr.slice(-400)}`))
      }
    }
    void tick()
  })

  return {
    ready,
    url: OPENCODE_SERVER_URL,
    child,
    owned: true,
    close: async () => {
      if (child.exitCode === null) {
        child.kill('SIGTERM')
        await Promise.race([exited, new Promise(r => setTimeout(r, 3_000))])
        if (child.exitCode === null) child.kill('SIGKILL')
      }
    },
  }
}

/** Create an OpenCode session. Returns the session id. */
export async function createOpenCodeSession(baseUrl, title, signal) {
  const res = await fetch(`${baseUrl}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
    signal,
  })
  if (!res.ok) {
    throw new Error(`opencode create session failed: HTTP ${res.status}`)
  }
  const body = await res.json()
  if (typeof body.id !== 'string' || body.id.length === 0) {
    throw new Error('opencode create session: no id in response')
  }
  return body.id
}

/** Fetch the live model catalog from the running OpenCode server. */
export async function fetchOpenCodeCatalog(baseUrl, signal) {
  try {
    const res = await fetch(`${baseUrl}/config/providers`, { signal })
    if (!res.ok) return { models: [], fetchedAtMs: Date.now() }
    const body = await res.json()
    const provider = body.providers?.find(p => p.id === 'opencode')
    const models = Object.values(provider?.models ?? {})
      .filter(m => m.status === 'active')
      .map(m => ({
        id: m.id,
        providerID: m.providerID,
        name: m.name,
        contextWindow: m.limit?.context ?? 200_000,
        maxTokens: m.limit?.output,
        capabilities: m.capabilities ?? {},
        status: m.status,
        cost: m.cost,
      }))
    return { models, fetchedAtMs: Date.now() }
  } catch {
    return { models: [], fetchedAtMs: Date.now() }
  }
}

/**
 * An async generator over OpenCode SSE events scoped to one session.
 * Yields each `message.part.delta` event's delta text as it arrives.
 */
export async function* streamOpenCodeSessionEvents(baseUrl, sessionId, signal) {
  const res = await fetch(`${baseUrl}/event?sessionID=${encodeURIComponent(sessionId)}`, { signal })
  if (!res.ok || res.body === null) {
    throw new Error(`opencode event stream: HTTP ${res.status}`)
  }

  const reader = res.body.getReader()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += new TextDecoder().decode(value, { stream: true })

    let sep
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)

      const dataLines = frame
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('')

      if (dataLines.length === 0) continue
      let event
      try {
        event = JSON.parse(dataLines)
      } catch {
        continue
      }

      const type = event.type ?? ''
      const props = event.properties ?? {}

      if (type === 'message.part.delta') {
        const delta = props.delta
        if (typeof delta === 'string' && delta.length > 0) {
          yield delta
        }
      } else if (type === 'message.part.updated') {
        const part = props.part
        if (part?.type === 'step-finish') {
          return
        }
      } else if (type === 'session.idle') {
        return
      } else if (type === 'message.updated') {
        const info = props.info
        if (info?.error !== undefined) {
          const errMsg = typeof info.error === 'object' && info.error !== null
            ? JSON.stringify(info.error).slice(0, 300)
            : String(info.error)
          throw new Error(`opencode model error: ${errMsg}`)
        }
      }
    }

    if (signal?.aborted) break
  }
}
