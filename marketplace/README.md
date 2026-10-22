# 市场收录（Awesome DSH Plugin）

本目录存放提交到 [Awesome DSH Plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 注册表的草稿。

## 提交方式

注册表以 PR 形式收录，**一个插件一个文件**：`data/plugins/<owner>__<repo>.yml`。

正式提交 = 在 `awesome-dsh-plugin/awesome-dsh-plugin` 仓库开一个 PR，新增：

```
data/plugins/sanser9__dsh-opencode-connect.yml
```

内容就是本目录的 [`awesome-dsh-plugin.yml`](./awesome-dsh-plugin.yml)。

## 已满足的前置条件

| 要求 | 状态 |
|---|---|
| `package.json` 声明 `dsh.bundle.patch` | ✅ `./cordis.patch.yml` |
| 仓库根有 `cordis.patch.yml` | ✅ `id: llm-opencode` |
| 真实可用的代码 | ✅ 6 个源文件 + 12 个测试 |
| 仓库带 `dsh-plugin` topic | ✅ |
| 官方包用 `peerDependencies` 声明 | ✅ 且带显式预发布分支 |
| **仓库创建满 1 天** | ⏳ **待满足** |

## 为什么要等

注册表 CI 会**自动检查仓库创建时间满 1 天**，用于过滤「提 PR 前几分钟才建好的仓库」。
本仓库创建于 2026-10-22，**2026-10-23 之后**再开 PR 即可通过该项检查。

## 到时怎么做

1. Fork `awesome-dsh-plugin/awesome-dsh-plugin`
2. 新建分支，添加 `data/plugins/sanser9__dsh-opencode-connect.yml`（内容见上）
3. 开 PR，标题形如 `Add sanser9/dsh-opencode-connect`
4. 等 CI 绿 + 维护者 review

> 注：README 由脚本从 `data/plugins/*.yml` 生成，**不要手工编辑 README**。
