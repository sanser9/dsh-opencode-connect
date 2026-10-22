# Changelog

## 0.1.0 — 2026-10-22

首个公开版本。

- 把 OpenCode CLI 的免费模型接入 DSH 模型选择器（自动发现 + 5 分钟刷新）
- 自动拉起或复用本机 `opencode serve`（127.0.0.1:40961）
- 安全 loopback shim：随机 secret、仅回环绑定、Host/Origin 校验
- OpenCode SSE → OpenAI 兼容 SSE 翻译，含流式增量、结束帧与 token 用量
- 内置兜底模型名单，实时目录不可达时模型选择器不空
- 模型名统一带 `· Free` 后缀；所有模型声明为零费用
