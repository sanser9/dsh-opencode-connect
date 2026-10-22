<h1 align="center">dsh-opencode-connect</h1>

<p align="center"><b>Bring OpenCode's free models into DeepSeek Harness — zero config, zero cost, works out of the box.</b></p>

<p align="center">
  <a href="README.md">中文</a> ·
  <a href="#install">Install</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#troubleshooting">Troubleshooting</a>
</p>

---

A standalone [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) bundle plugin. It exposes the **free models** of the locally installed [OpenCode](https://opencode.ai) CLI (`deepseek-v4.1-flash-free`, `glm-5.3-flash-free`, `big-pickle`, `kimi-k3-free`, `qwen3.7-max-free`, …) in DSH's model picker — no API key, no sign-in, no cost.

The plugin **starts or reuses** a local `opencode serve` (127.0.0.1:40961) and bridges its event stream to OpenAI-compatible SSE through a loopback shim, which DSH's pi-ai adapter consumes. Nothing goes through a third-party relay.

## Risk notice

> **This plugin relies on OpenCode CLI's free tier and is an unofficial integration.** If upstream changes its free policy or API, the plugin may need updates or stop working. Evaluate the risk yourself; use official vendor APIs when you need long-term stability.

To be clear about what this does: **it saves you from switching between OpenCode and DSH.** You can already use these models for free in a terminal — the plugin just wires the same local capability into DSH's model picker. It provides no accounts, shares no credentials, and bypasses no billing (free models are not billed anyway).

## Features

- **Zero configuration** — install OpenCode CLI and this plugin, restart DSH, and every free model shows up in the picker. No API key, no login.
- **Automatic model discovery** — reads the live catalog from the local `opencode serve` at startup (`/config/providers`) and refreshes it every 5 minutes, so upstream model changes appear in the picker without a restart. Free models are labelled with a `· Free` suffix.
- **Manages the OpenCode server** — reuses an already-running `opencode serve` (never hijacks or restarts it); spawns one only when nothing answers, and reclaims it on DSH shutdown.
- **Secure loopback shim** — a 32-byte random secret per process, bound to `127.0.0.1` only, with `Host`/`Origin` loopback checks. pi-ai never sees the real OpenCode address, only the shim's one-time token.
- **Streaming + usage** — translates OpenCode `message.part.delta` events into OpenAI-compatible SSE with deltas, a finish chunk and token usage; aborts release the upstream connection immediately.
- **Zero cost** — every model declares `cost: 0`, so DSH usage accounting never reports phantom spend.

## Install

### Prerequisites

1. **Node.js** `^22.19.0` or `>=24.0.0`
2. **DeepSeek Harness** (desktop app or `dsh` CLI)
3. **OpenCode CLI ≥ 1.18.0** — the free-tier version gate:

   ```bash
   # official installer (macOS / Linux)
   curl -fsSL https://opencode.ai/install | bash

   # or via npm
   npm install -g opencode-ai

   opencode --version   # must be >= 1.18.0
   ```

   The binary is looked up in this order:

   ```
   ~/.local/share/dsh-opencode-connect/bin/opencode
   ~/.local/bin/opencode
   /usr/local/bin/opencode
   opencode on PATH
   ```

### Install the plugin

```bash
# from npm (once published)
dsh plugin install dsh-opencode-connect

# from source
git clone https://github.com/sanser9/dsh-opencode-connect.git
cd dsh-opencode-connect
npm install --omit=dev
npm run build
dsh plugin install "$PWD"
```

Then **restart DSH**. An `OpenCode` group appears in the model picker.

## How it works

```text
DSH model picker
  -> DSH PiAiAdapter (provider: opencode)
  -> local loopback shim (random port + in-process secret, OpenAI-compatible /v1/chat/completions)
  -> local opencode serve (127.0.0.1:40961, spawned or reused by the plugin)
  -> OpenCode free models
  -> SSE event stream (message.part.delta)
  -> stream-bridge -> OpenAI SSE
  -> DSH streams the reply
```

Design notes:

- **The shim is the only exit.** pi-ai only receives the shim's address and one-time token; the real OpenCode address never leaves the process, and the shim rejects every non-loopback request.
- **Two catalog sources.** The live catalog from `opencode serve` wins; a built-in static roster (`src/catalog.js`) is the fallback so the picker is never empty.
- **5-minute self-healing.** If the live catalog was not ready at startup, a background timer retries and notifies DSH to refresh the adapter.

## Fallback roster

Used when `opencode serve` is unreachable at startup (`src/catalog.js`). The live catalog always takes precedence.

| Model id | Context |
|---|---|
| `big-pickle` | 200K |
| `mimo-v2.6-flash-free` | 200K |
| `deepseek-v4.1-flash-free` | 200K |
| `glm-5.3-flash-free` | 200K |
| `minimax-m3.1-flash-free` | 1M |
| `nemotron-3-ultra-free` | 1M |
| `kimi-k3-free` | 200K |
| `qwen3.7-max-free` | 200K |
| `north-mini-code-free` | 200K |
| `trinity-large-preview-free` | 200K |
| `ling-3.0-flash-free` | 200K |

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| No `OpenCode` group in the picker | Plugin not active. Check the DSH log for `dsh-opencode-connect` startup lines and that the profile's `cordis.patch.yml` has the `llm-opencode` row. |
| Group present, no models | `opencode serve` is not running. Run `opencode serve --port 40961` manually to see the error; confirm CLI ≥ 1.18.0. |
| `Provider is not configured: opencode` | Known issue in older builds (empty auth resolution). Upgrade to 0.1.0+. |
| `no opencode binary found` | Binary not in the lookup paths. Install it or symlink it to `~/.local/bin/opencode`. |
| Port 40961 taken | The plugin probes first; if a non-opencode program holds the port, free it or move that program. |
| Replies cut off | Free-tier rate/context limits. Start a new session or switch models. |

Logs:

```bash
tail -f ~/Library/Application\ Support/DSH\ Desktop/logs/host/*.log   # macOS desktop
grep dsh-opencode-connect ~/Library/Application\ Support/DSH\ Desktop/logs/host/*.log
```

## Development

```bash
git clone https://github.com/sanser9/dsh-opencode-connect.git
cd dsh-opencode-connect
npm install       # only @earendil-works/pi-ai
npm run build     # src/*.js -> dist/*.js (plain copy, no transpilation)
```

```
src/
  index.js            plugin entry: provider, adapter, 5-minute catalog refresh
  shim.js             local OpenAI-compatible HTTP shim (auth + loopback guards)
  stream-bridge.js    OpenCode SSE -> OpenAI SSE translation
  opencode-server.js  opencode serve lifecycle + HTTP client
  catalog.js          model catalog (live + fallback roster)
  loopback.js         loopback detection and port binding
scripts/build.mjs     build (src -> dist)
cordis.patch.yml      bundle declaration (llm-opencode row)
```

Local debugging: `link:` this repo into a DSH profile's `dependencies`, restart `dsh web`, and expect these log lines:

```
dsh-opencode-connect: opencode server ready at http://127.0.0.1:40961
dsh-opencode-connect: shim listening at http://127.0.0.1:xxxxx
dsh-opencode-connect: registered opencode provider
```

## Disclaimer

This project is not affiliated with OpenCode or DeepSeek; it is a community-maintained third-party DSH plugin. Free-model availability, rate limits and billing are decided entirely by upstream, with no guarantees from this project.

## License

[MIT](LICENSE) © 2026 sanser9
