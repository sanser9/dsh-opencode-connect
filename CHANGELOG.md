# Changelog

## 0.1.0 — 2026-10-22

首个公开版本。

### 功能

- 把 OpenCode CLI 的免费模型接入 DSH 模型选择器（自动发现 + 5 分钟刷新）
- 自动拉起或复用本机 `opencode serve`（127.0.0.1:40961）
- 安全 loopback shim：随机 secret、仅回环绑定、Host/Origin 校验
- OpenCode SSE → OpenAI 兼容 SSE 翻译，含流式增量、结束帧与 token 用量
- 内置兜底模型名单，实时目录不可达时模型选择器不空
- 模型名统一带 `· Free` 后缀；所有模型声明为零费用

### 修复（在公开前由测试发现）

- `OpenCodeCatalog` 的内部字段 `source` / `fetchedAtMs` 遮蔽了同名方法，
  导致 `catalog.source()` 抛错并被调用方的 `catch {}` 吞掉——**5 分钟目录
  刷新从未真正生效**。字段改名为 `_source` / `_fetchedAtMs`。
- `hostIsLoopback` 对 `[::1]` 形式解析错误（`split(':')[0]` 得到 `[`），
  IPv6 回环请求被误拒。
- `hostIsLoopback` 用 `startsWith('127.')` 判断 IPv4 回环，导致
  `127.0.0.1.evil.com` 这类主机名被误放行（DNS rebinding 形状）。改为
  锚定的四段式正则，并补齐方括号 IPv6 与端口解析。
- `shim.js` 内重复实现的两个回环守卫改为复用 `loopback.js`，避免两处漂移。

### 工程

- 源码移入 `src/`，`dist/` 由 `npm run build` 生成（纯拷贝），并提交入库
- 新增 12 个测试用例（Node 内置 test runner，零额外依赖）
- 新增 GitHub Actions CI（Node 22.19 / 24 × Linux / macOS）
- `@deepseek-ai/*` peer 范围改为带显式预发布分支的形式，避免 semver 静默
  排除预发布构建
