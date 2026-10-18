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
: "${R2_BUCKET_NAME:=henna-mail-r2}"
: "${D1_DATABASE_ID:=}"
: "${KV_NAMESPACE_ID:=}"
: "${CUSTOM_DOMAIN:=}"

export NAME CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID ADMIN DOMAIN
export R2_BUCKET_NAME D1_DATABASE_ID KV_NAMESPACE_ID CUSTOM_DOMAIN

command -v jq >/dev/null || { echo "✗ 需要 jq，请先安装（apt install jq / brew install jq）" >&2; exit 1; }

if [[ -z "$CLOUDFLARE_API_TOKEN" || -z "$CLOUDFLARE_ACCOUNT_ID" ]]; then
  echo "✗ 需要 CLOUDFLARE_API_TOKEN 与 CLOUDFLARE_ACCOUNT_ID" >&2
  exit 1
fi
if [[ -z "$JWT_SECRET" ]]; then
  JWT_SECRET="web3hennamail"
  echo "· 未设置 JWT_SECRET，使用默认值：$JWT_SECRET"
fi
export JWT_SECRET

echo "▶ [1/7] 校验环境变量"
if [[ -z "$ADMIN" ]]; then echo "✗ ADMIN 不能为空" >&2; exit 1; fi
if grep -q '[?%#/\\|&]' <<< "$JWT_SECRET"; then
  echo "✗ JWT_SECRET 含有非法字符（? % # / \\ | &）" >&2; exit 1
fi
if ! jq -e 'type == "array"' <<< "$DOMAIN" >/dev/null; then
  echo "✗ DOMAIN 必须是 JSON 数组，例如 [\"your.domain\"]" >&2; exit 1
fi
echo "   ✓ 校验通过"

echo "▶ [2/7] 构建前端"
( cd web && npm install && npm run build )
rm -rf worker/dist && cp -r web/dist worker/dist

echo "▶ [3/7] 安装 Worker 依赖"
( cd worker && npm install && npx wrangler telemetry disable >/dev/null 2>&1 || true )

cd worker
# 渲染到生成文件：模板 wrangler-action.toml 保持不变，重跑不会二次污染
cp wrangler-action.toml wrangler-deploy.toml
CONFIG_FILE="wrangler-deploy.toml"

echo "▶ [4/7] 渲染配置"
if [[ -z "$R2_BUCKET_NAME" ]]; then
  sed -i.bak '/\[\[r2_buckets\]\]/,/^$/d' "$CONFIG_FILE" && rm -f "$CONFIG_FILE.bak"
fi
sed -i.bak \
  -e "s|\${NAME}|${NAME}|g" \
  -e "s|\${CLOUDFLARE_ACCOUNT_ID}|${CLOUDFLARE_ACCOUNT_ID}|g" \
  -e "s|\${ADMIN}|${ADMIN}|g" \
  -e "s|\${JWT_SECRET}|${JWT_SECRET}|g" \
  -e "s|\${R2_BUCKET_NAME}|${R2_BUCKET_NAME}|g" \
  "$CONFIG_FILE" && rm -f "$CONFIG_FILE.bak"
# DOMAIN 是 JSON 数组，去掉包裹引号写成原生数组
sed -i.bak "s|\"\${DOMAIN}\"|${DOMAIN}|g" "$CONFIG_FILE" && rm -f "$CONFIG_FILE.bak"
echo "   ✓ 渲染完成"

echo "▶ [5/7] 设置 KV / D1"
if [[ -n "$KV_NAMESPACE_ID" ]]; then
  sed -i.bak "s|\${KV_NAMESPACE_ID}|${KV_NAMESPACE_ID}|g" "$CONFIG_FILE" && rm -f "$CONFIG_FILE.bak"
else
  KV_ID=$(npx wrangler kv namespace list 2>/dev/null | jq -r ".[] | select(.title == \"$NAME\") | .id" || true)
  if [[ -z "$KV_ID" ]]; then
    npx wrangler kv namespace create "$NAME"
    KV_ID=$(npx wrangler kv namespace list | jq -r ".[] | select(.title == \"$NAME\") | .id")
  fi
  sed -i.bak "s|\${KV_NAMESPACE_ID}|${KV_ID}|g" "$CONFIG_FILE" && rm -f "$CONFIG_FILE.bak"
  echo "   ✓ KV $KV_ID"
fi

if [[ -n "$D1_DATABASE_ID" ]]; then
  sed -i.bak "s|\${D1_DATABASE_ID}|${D1_DATABASE_ID}|g" "$CONFIG_FILE" && rm -f "$CONFIG_FILE.bak"
else
  D1_ID=$(npx wrangler d1 list --json 2>/dev/null | jq -r ".[] | select(.name == \"$NAME-db\") | .uuid" || true)
  if [[ -z "$D1_ID" ]]; then
    npx wrangler d1 create "$NAME-db"
    D1_ID=$(npx wrangler d1 list --json | jq -r ".[] | select(.name == \"$NAME-db\") | .uuid")
  fi
  sed -i.bak "s|\${D1_DATABASE_ID}|${D1_ID}|g" "$CONFIG_FILE" && rm -f "$CONFIG_FILE.bak"
  echo "   ✓ D1 $D1_ID"
fi

echo "▶ [6/7] 部署 Worker"
npx wrangler deploy -c "$CONFIG_FILE" --keep-vars 2>&1 | tee deploy.log
WORKER_URL="${CUSTOM_DOMAIN:+https://$CUSTOM_DOMAIN}"
WORKER_URL="${WORKER_URL:-$(grep -o 'https://[a-zA-Z0-9.-]*\.workers\.dev' deploy.log | head -1)}"

echo "▶ [7/7] 初始化数据库"
if [[ -z "$WORKER_URL" ]]; then
  echo "✗ 拿不到访问地址，请设置 CUSTOM_DOMAIN" >&2; exit 1
fi
for i in 1 2 3 4 5; do
  sleep 12
  BODY=$(curl -sL "$WORKER_URL/api/init/${JWT_SECRET}" || echo "")
  if [[ "$BODY" == "success" ]]; then
    echo
    echo "────────────────────────────────────────────"
    echo "✓ 部署完成：$WORKER_URL"
    echo "  管理后台：$WORKER_URL/admin   （注册的首个账号即管理员）"
    echo "  收信配置：Cloudflare 控制台 → 域名 → Email → Email Routing → Routing rules → Send to Worker → $NAME"
    echo "────────────────────────────────────────────"
    exit 0
  fi
  echo "· 第 $i 次初始化未成功，响应：$BODY"
done
echo "✗ 初始化失败，请手动访问 $WORKER_URL/api/init/$JWT_SECRET" >&2
exit 1
