#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────
# Henna Mail · 一键部署到 Cloudflare Workers（部署方式二）
#
# 用法：
#   export CLOUDFLARE_API_TOKEN=xxxx
#   export CLOUDFLARE_ACCOUNT_ID=xxxx
#   export ADMIN=admin@your.domain
#   export DOMAIN='["your.domain"]'
#   export JWT_SECRET=web3hennamail
#   ./scripts/deploy.sh
#
# 幂等：资源已存在则复用，可反复执行。
# D1 / KV / R2 全部自动创建；填了 ID 就用你指定的那个。
# 依赖：node、npm、jq、curl
# ───────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${NAME:=henna-mail}"
: "${CLOUDFLARE_API_TOKEN:=${CF_API_TOKEN:-}}"
: "${CLOUDFLARE_ACCOUNT_ID:=${CF_ACCOUNT_ID:-}}"
: "${ADMIN:=${ADMIN_EMAIL:-}}"
: "${DOMAIN:=${MAIL_DOMAINS:-}}"
: "${D1_DATABASE_ID:=}"
: "${KV_NAMESPACE_ID:=}"
: "${R2_BUCKET_NAME:=}"
: "${CUSTOM_DOMAIN:=}"

export NAME CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID ADMIN DOMAIN
export D1_DATABASE_ID KV_NAMESPACE_ID R2_BUCKET_NAME CUSTOM_DOMAIN

command -v jq >/dev/null || { echo "✗ 需要 jq（apt install jq / brew install jq）" >&2; exit 1; }
[[ -z "$CLOUDFLARE_API_TOKEN" || -z "$CLOUDFLARE_ACCOUNT_ID" ]] && {
  echo "✗ 需要 CLOUDFLARE_API_TOKEN 与 CLOUDFLARE_ACCOUNT_ID" >&2; exit 1; }

if [[ -z "${JWT_SECRET:-}" ]]; then
  JWT_SECRET="web3hennamail"
  echo "· 未设置 JWT_SECRET，使用默认值：$JWT_SECRET"
fi
export JWT_SECRET

echo "▶ [1/7] 校验环境变量"
[[ -z "$ADMIN" ]] && { echo "✗ ADMIN 不能为空" >&2; exit 1; }
grep -q '[?%#/\\|&]' <<< "$JWT_SECRET" && {
  echo "✗ JWT_SECRET 含非法字符（? % # / \ | &）" >&2; exit 1; }
jq -e 'type == "array"' <<< "$DOMAIN" >/dev/null || {
  echo "✗ DOMAIN 必须是 JSON 数组，例如 [\"your.domain\"]" >&2; exit 1; }
echo "   ✓ 校验通过"

echo "▶ [2/7] 构建前端"
( cd web && npm install && npm run build )
rm -rf worker/dist && cp -r web/dist worker/dist

echo "▶ [3/7] 安装 Worker 依赖"
( cd worker && npm install && npx wrangler telemetry disable >/dev/null 2>&1 || true )

echo "▶ [4/7] 创建 / 复用 D1 · KV · R2"
node scripts/provision.mjs
# shellcheck disable=SC1091
source /tmp/henna-resources.env
export D1_ID KV_ID R2_BUCKET R2_ENABLED

echo "▶ [5/7] 渲染配置"
cd worker
cp wrangler-action.toml wrangler-deploy.toml
C=wrangler-deploy.toml
sed -i.bak \
  -e "s|\${NAME}|${NAME}|g" \
  -e "s|\${CLOUDFLARE_ACCOUNT_ID}|${CLOUDFLARE_ACCOUNT_ID}|g" \
  -e "s|\${ADMIN}|${ADMIN}|g" \
  -e "s|\${JWT_SECRET}|${JWT_SECRET}|g" \
  -e "s|\${D1_DATABASE_ID}|${D1_ID}|g" \
  -e "s|\${KV_NAMESPACE_ID}|${KV_ID}|g" \
  "$C" && rm -f "$C.bak"
sed -i.bak "s|\"\${DOMAIN}\"|${DOMAIN}|g" "$C" && rm -f "$C.bak"
if [[ -z "$R2_BUCKET" ]]; then
  sed -i.bak '/\[\[r2_buckets\]\]/,/^$/d' "$C" && rm -f "$C.bak"
  echo "   ! R2 未启用，附件功能降级"
else
  sed -i.bak "s|\${R2_BUCKET_NAME}|${R2_BUCKET}|g" "$C" && rm -f "$C.bak"
  echo "   ✓ R2 $R2_BUCKET"
fi

if grep -v '^[[:space:]]*#' "$C" | grep -q '\${'; then echo "✗ 仍有未替换的占位符" >&2; exit 1; fi
if grep -qE '^\s*database_id\s*=\s*""' "$C"; then echo "✗ D1 database_id 为空" >&2; exit 1; fi
if grep -qE '^\s*id\s*=\s*""' "$C"; then echo "✗ KV id 为空" >&2; exit 1; fi
echo "   ✓ 渲染完成"

echo "▶ [6/7] 部署 Worker"
npx wrangler deploy -c "$C" 2>&1 | tee deploy.log
WORKER_URL="${CUSTOM_DOMAIN:+https://$CUSTOM_DOMAIN}"
WORKER_URL="${WORKER_URL:-$(grep -o 'https://[a-zA-Z0-9.-]*\.workers\.dev' deploy.log | head -1)}"
[[ -z "$WORKER_URL" ]] && { echo "✗ 拿不到访问地址，请设置 CUSTOM_DOMAIN" >&2; exit 1; }

echo "▶ [7/7] 初始化数据库"
for i in 1 2 3 4 5; do
  sleep 12
  BODY=$(curl -sL "$WORKER_URL/api/init/${JWT_SECRET}" || echo "")
  if [[ "$BODY" == "success" ]]; then
    echo
    echo "────────────────────────────────────────────"
    echo "✓ 部署完成：$WORKER_URL"
    echo "  附件存储：${R2_BUCKET:-未启用（功能降级）}"
    echo "  管理后台：$WORKER_URL/admin   （注册的首个账号即管理员）"
    echo "  收信配置：Cloudflare 控制台 → 域名 → Email → Email Routing → Routing rules → Send to Worker → $NAME"
    echo "────────────────────────────────────────────"
    exit 0
  fi
  echo "· 第 $i 次初始化未成功，响应：$BODY"
done
echo "✗ 初始化失败，请手动访问 $WORKER_URL/api/init/$JWT_SECRET" >&2
exit 1
