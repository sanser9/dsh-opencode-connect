#!/usr/bin/env bash
#
# 一键向 awesome-dsh-plugin 提交收录 PR。
#
# 用法：
#   GITHUB_TOKEN=ghp_xxx ./scripts/open-marketplace-pr.sh
#
# 前置：
#   - token 需要 repo 权限（fork + 建分支 + 开 PR）
#   - 仓库创建已满 24 小时，否则市场 CI 的 repo-age 检查会拒（这不是脚本能绕过的）
#
# 脚本做的事（全部通过 GitHub REST API，无需 git 凭据）：
#   1. fork awesome-dsh-plugin/awesome-dsh-plugin 到自己账号
#   2. 等 fork 就绪
#   3. 在 fork 上建分支 add-dsh-opencode-connect，写入 data/plugins/sanser9__dsh-opencode-connect.yml
#   4. 开 PR 回上游

set -euo pipefail

: "${GITHUB_TOKEN:?请设置 GITHUB_TOKEN 环境变量}"
UPSTREAM_OWNER="awesome-dsh-plugin"
UPSTREAM_REPO="awesome-dsh-plugin"
PLUGIN_OWNER="sanser9"
PLUGIN_REPO="dsh-opencode-connect"
BRANCH="add-${PLUGIN_REPO}"
ENTRY_PATH="data/plugins/${PLUGIN_OWNER}__${PLUGIN_REPO}.yml"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRY_SRC="${SCRIPT_DIR}/../marketplace/awesome-dsh-plugin.yml"

[ -f "$ENTRY_SRC" ] || { echo "找不到条目文件: $ENTRY_SRC" >&2; exit 1; }

api() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" \
      -H "Authorization: token ${GITHUB_TOKEN}" \
      -H "Accept: application/vnd.github+json" \
      -H "Content-Type: application/json" \
      -d "$body" \
      "https://api.github.com${path}"
  else
    curl -sS -X "$method" \
      -H "Authorization: token ${GITHUB_TOKEN}" \
      -H "Accept: application/vnd.github+json" \
      "https://api.github.com${path}"
  fi
}

json_get() {
  python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('$1',''))"
}

echo "==> 检查仓库年龄"
CREATED=$(curl -sS "https://api.github.com/repos/${PLUGIN_OWNER}/${PLUGIN_REPO}" | json_get created_at)
python3 - "$CREATED" <<'PY'
import sys, datetime
c = sys.argv[1]
if not c:
    sys.exit("无法读取仓库创建时间")
t = datetime.datetime.strptime(c, '%Y-%m-%dT%H:%M:%SZ')
age = datetime.datetime.utcnow() - t
hours = age.total_seconds() / 3600
print(f"    创建于 {c} UTC，已存在 {hours:.1f} 小时")
if hours < 24:
    need = t + datetime.timedelta(days=1)
    sys.exit(f"    ✗ 未满 24 小时，市场 CI 会拒。请在 {need:%Y-%m-%d %H:%M} UTC 之后重跑。")
print("    ✓ 已满 24 小时")
PY

echo "==> fork ${UPSTREAM_OWNER}/${UPSTREAM_REPO}"
api POST "/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/forks" '{"default_branch_only":true}' >/dev/null

echo "==> 等待 fork 就绪"
for i in $(seq 1 20); do
  CODE=$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: token ${GITHUB_TOKEN}" \
    "https://api.github.com/repos/${PLUGIN_OWNER}/${UPSTREAM_REPO}")
  [ "$CODE" = "200" ] && { echo "    ✓ fork 就绪"; break; }
  [ "$i" = "20" ] && { echo "    ✗ fork 超时" >&2; exit 1; }
  sleep 3
done

echo "==> 读取上游 main 的 HEAD"
BASE_SHA=$(api GET "/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/git/ref/heads/main" | json_get sha)
[ -n "$BASE_SHA" ] || { echo "✗ 无法读取上游 HEAD" >&2; exit 1; }

echo "==> 创建分支 ${BRANCH}"
api POST "/repos/${PLUGIN_OWNER}/${UPSTREAM_REPO}/git/refs" \
  "{\"ref\":\"refs/heads/${BRANCH}\",\"sha\":\"${BASE_SHA}\"}" >/dev/null || true

echo "==> 写入 ${ENTRY_PATH}"
CONTENT_B64=$(base64 < "$ENTRY_SRC" | tr -d '\n')
BODY=$(python3 - "$ENTRY_PATH" "$CONTENT_B64" "$BRANCH" <<'PY'
import json, sys
path, content, branch = sys.argv[1], sys.argv[2], sys.argv[3]
print(json.dumps({
    "message": f"Add {path.split('/')[-1].replace('.yml','')}",
    "content": content,
    "branch": branch,
}))
PY
)
api PUT "/repos/${PLUGIN_OWNER}/${UPSTREAM_REPO}/contents/${ENTRY_PATH}" "$BODY" >/dev/null

echo "==> 开 PR"
PR_BODY=$(cat <<'MD'
Adds `dsh-opencode-connect`: brings the free models of a locally installed
OpenCode CLI into DeepSeek Harness.

- Starts or reuses a local `opencode serve`, discovers the live catalog and
  refreshes it every five minutes.
- Bridges the session event stream to OpenAI-compatible SSE through a
  loopback-only shim that validates Host and Origin.
- Plain JavaScript, 12 tests (`node:test`), CI on Node 22.19/24 x Linux/macOS.
- Published on npm as `dsh-opencode-connect@0.1.0`.
MD
)
PR_BODY_JSON=$(python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))" <<< "$PR_BODY")
PR=$(api POST "/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/pulls" \
  "{\"title\":\"Add ${PLUGIN_OWNER}/${PLUGIN_REPO}\",\"head\":\"${PLUGIN_OWNER}:${BRANCH}\",\"base\":\"main\",\"body\":${PR_BODY_JSON}}")

PR_URL=$(echo "$PR" | json_get html_url)
if [ -n "$PR_URL" ]; then
  echo "    ✓ PR 已创建: $PR_URL"
else
  echo "    ✗ 创建失败: $PR" >&2
  exit 1
fi
