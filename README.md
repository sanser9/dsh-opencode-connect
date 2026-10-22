<h1 align="center">dsh-opencode-connect</h1>

<p align="center"><b>把 OpenCode 的免费模型接入 DeepSeek Harness —— 零配置、零费用、开箱即用。</b></p>

<p align="center">
  <a href="README.en.md">English</a> ·
  <a href="#安装">安装</a> ·
  <a href="#工作原理">工作原理</a> ·
  <a href="#故障排查">故障排查</a> ·
  <a href="#开发">开发</a>
</p>

---

一个独立的 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) bundle 插件。它把本机已安装的 [OpenCode](https://opencode.ai) CLI 的**免费模型**（`deepseek-v4.1-flash-free`、`glm-5.3-flash-free`、`big-pickle`、`kimi-k3-free`、`qwen3.7-max-free` 等）接入 DSH 的模型选择器，让你在 DSH 里直接使用，无需 API Key、无需登录、不产生任何费用。

插件会**自动拉起或复用**本机的 `opencode serve`（127.0.0.1:40961），再通过一层本地 loopback shim 把 OpenCode 的事件流翻译成 OpenAI 兼容的 SSE，交给 DSH 的 pi-ai 适配器。整个过程不经过任何第三方中转，凭据（如果有）始终留在你自己的机器上。

## 风险提示

> **本插件依赖 OpenCode CLI 的免费层，属于非官方集成方式。** 上游一旦调整免费策略或接口，插件可能需要跟着更新，甚至可能失效。请自行评估后使用；需要长期稳定与合规性时，请使用各家的官方 API。

需要说明的是，这个插件做的事情很普通：**省掉在 OpenCode 和 DSH 之间来回切换的麻烦**。你本来就能在终端里免费用这些模型，插件只是把同一份本地能力接到 DSH 的模型选择器上——不提供账号、不共享凭据、不绕过计费（免费模型本身也不计费）。

## 功能特性

- **零配置接入** —— 装好 OpenCode CLI 和本插件，重启 DSH 即可在模型选择器里看到全部免费模型，不需要任何 API Key 或登录。
- **免费模型自动发现** —— 启动时从本机 `opencode serve` 的 `/config/providers` 读取当前可用的免费模型；上游新增或下线模型时，插件每 5 分钟自动刷新一次目录，模型选择器随之更新（模型名统一带 `· Free` 后缀，一眼可辨）。
- **自动管理 OpenCode 服务** —— 检测到本机已有 `opencode serve` 在跑就直接复用（不抢占、不重启）；没有才按需拉起，并在 DSH 退出时干净地回收自己启动的进程。
- **安全 loopback shim** —— 每次进程启动生成一个 32 字节随机 secret，仅绑定 `127.0.0.1`，并校验 `Host` / `Origin` 必须是回环地址；真实的 OpenCode 服务地址不暴露给 pi-ai，适配器只拿到 shim 的地址与一次性 token。
- **流式输出与用量回传** —— 把 OpenCode 的 `message.part.delta` 事件流翻译成 OpenAI 兼容 SSE，包含增量文本、结束帧与 token 用量；中断（用户停止、切换会话）时立即释放上游连接。
- **零费用** —— 所有模型的 `cost` 都被声明为 0，DSH 的用量统计不会虚报开销。

## 安装

### 前置条件

1. **Node.js** `^22.19.0` 或 `>=24.0.0`（DSH 自身的要求）
2. **DeepSeek Harness**（桌面版或 `dsh` CLI）
3. **OpenCode CLI ≥ 1.18.0** —— 免费层的版本门槛。安装方式任选：

   ```bash
   # 官方安装脚本（macOS / Linux）
   curl -fsSL https://opencode.ai/install | bash

   # 或通过 npm
   npm install -g opencode-ai

   # 验证版本（必须 >= 1.18.0）
   opencode --version
   ```

   插件按以下顺序查找二进制，任一命中即可：

   ```
   ~/.local/share/dsh-opencode-connect/bin/opencode
   ~/.local/bin/opencode
   /usr/local/bin/opencode
   PATH 上的 opencode
   ```

   > 提示：如果你的 `opencode` 不在上述位置，把它软链到 `~/.local/bin/opencode` 即可。

### 安装插件

```bash
# 方式一：从 npm（发布后）
dsh plugin install dsh-opencode-connect

# 方式二：从源码（开发/自用）
git clone https://github.com/sanser9/dsh-opencode-connect.git
cd dsh-opencode-connect
npm install --omit=dev
npm run build
dsh plugin install "$PWD"
```

安装完成后**重启 DSH**（或让宿主重新加载 profile），模型选择器里会出现 `OpenCode` 分组。

## 工作原理

```text
DSH 模型选择器
  -> DSH PiAiAdapter（provider: opencode）
  -> 本地 loopback shim（随机端口 + 进程内随机 secret，OpenAI 兼容 /v1/chat/completions）
  -> 本机 opencode serve（127.0.0.1:40961，由插件拉起或复用）
  -> OpenCode 免费模型
  -> SSE 事件流（message.part.delta）
  -> stream-bridge 翻译为 OpenAI SSE
  -> DSH 渲染流式回复
```

关键设计：

- **shim 是唯一出口**：pi-ai 只看到 shim 的地址和一次性 token，OpenCode 服务的真实地址不外泄；shim 拒绝一切非回环请求。
- **目录双来源**：启动时优先读 `opencode serve` 的实时目录；读不到时退回内置的静态名单（`src/catalog.js`），保证模型选择器不会空着。
- **5 分钟自愈**：如果启动时实时目录没拿到（服务还没就绪），后台定时器会在后续轮询里补上并通知 DSH 刷新适配器。

## 内置兜底模型名单

当 `opencode serve` 暂时不可达时，插件用以下名单兜底（`src/catalog.js`）：

| 模型 id | 上下文 |
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

实时目录可用时以实时目录为准，上表只是兜底。

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| 模型选择器里没有 `OpenCode` 分组 | 插件未激活：检查 DSH 日志里是否有 `dsh-opencode-connect` 的启动记录；确认 profile 的 `cordis.patch.yml` 有 `llm-opencode` 行。 |
| 分组在但模型列表为空 | `opencode serve` 没起来。手动执行 `opencode serve --port 40961` 看报错；确认 CLI 版本 ≥ 1.18.0（旧版免费层不可用）。 |
| 发送消息报 `Provider is not configured: opencode` | 旧版本的已知问题（auth resolver 返回空）。升级到 0.1.0 及以上。 |
| 报 `no opencode binary found` | 二进制不在查找路径里。按上文装好，或软链到 `~/.local/bin/opencode`。 |
| 端口 40961 被占用 | 插件会先探测该端口；若被别的程序占用且不是 opencode，换一个程序或释放端口。 |
| 回复中途截断 | OpenCode 免费层有速率/上下文限制，长对话会被上游拒绝。开新会话或换一个模型。 |

查看日志：

```bash
# macOS 桌面版
tail -f ~/Library/Application\ Support/DSH\ Desktop/logs/host/*.log

# 只看本插件
grep dsh-opencode-connect ~/Library/Application\ Support/DSH\ Desktop/logs/host/*.log
```

## 开发

```bash
git clone https://github.com/sanser9/dsh-opencode-connect.git
cd dsh-opencode-connect
npm install            # 只装 @earendil-works/pi-ai
npm run build          # src/*.js -> dist/*.js（纯拷贝，无编译）
```

目录结构：

```
src/
  index.js            插件入口：注册 provider、适配器、5 分钟目录刷新
  shim.js             本地 OpenAI 兼容 HTTP shim（鉴权 + 回环校验 + 路由）
  stream-bridge.js    OpenCode SSE -> OpenAI SSE 翻译
  opencode-server.js  opencode serve 生命周期 + HTTP 客户端
  catalog.js          模型目录（实时 + 兜底名单）
  loopback.js         回环地址判定与端口绑定
scripts/build.mjs     构建（src -> dist）
cordis.patch.yml      bundle 声明（llm-opencode 行）
```

本地调试：把本仓库 `link:` 进某个 DSH profile 的 `dependencies`，重启 `dsh web`，日志里应出现：

```
dsh-opencode-connect: opencode server ready at http://127.0.0.1:40961
dsh-opencode-connect: shim listening at http://127.0.0.1:xxxxx
dsh-opencode-connect: registered opencode provider
```

## 免责声明

本项目与 OpenCode、DeepSeek 均无隶属关系，是一个社区维护的第三方 DSH 插件。免费模型的可用性、速率限制与计费规则完全由上游决定，本项目不提供任何保证。使用即表示你理解并接受这一点，并自行承担由此产生的风险。

## License

[MIT](LICENSE) © 2026 sanser9
