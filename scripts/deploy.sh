#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────
# Henna Mail · 一键部署到 Cloudflare Workers（部署方式二）
#
# 用法：
#   export CLOUDFLARE_API_TOKEN=xxxx
#   export CLOUDFLARE_ACCOUNT_ID=xxxx
#   export JWT_SECRET=$(openssl rand -hex 32)
#   export ADMIN_EMAIL=admin@your.domain
#   export MAIL_DOMAINS='["your.domain"]'
#   ./scripts/deploy.sh
#
# 幂等：资源已存在则复用，可反复执行。
# ───────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${CLOUDFLARE_API_TOKEN:=${CF_API_TOKEN:-}}"
: "${CLOUDFLARE_ACCOUNT_ID:=${CF_ACCOUNT_ID:-}}"

if [[ -z "$CLOUDFLARE_API_TOKEN" || -z "$CLOUDFLARE_ACCOUNT_ID" ]]; then
  echo "✗ 需要 CLOUDFLARE_API_TOKEN 与 CLOUDFLARE_ACCOUNT_ID" >&2
  exit 1
fi

if [[ -z "${JWT_SECRET:-}" ]]; then
  JWT_SECRET="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  echo "· 未设置 JWT_SECRET，已随机生成：${JWT_SECRET}"
fi

ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
MAIL_DOMAINS="${MAIL_DOMAINS:-[\"example.com\"]}"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID JWT_SECRET ADMIN_EMAIL MAIL_DOMAINS

echo "▶ [1/6] 安装前端依赖并构建"
( cd web && npm install && npm run build )

echo "▶ [2/6] 安装 Worker 依赖"
( cd worker && npm install )

echo "▶ [3/6] 创建 / 复用 D1 · KV · R2"
node scripts/provision.mjs
# shellcheck disable=SC1091
source /tmp/henna-resources.env
export D1_ID KV_ID R2_BUCKET

echo "▶ [4/6] 渲染 wrangler.jsonc"
node scripts/render-config.mjs

echo "▶ [5/6] 应用数据库迁移"
( cd worker && npx wrangler d1 migrations apply henna-mail-db --remote )

echo "▶ [6/6] 部署 Worker"
DEPLOY_OUTPUT="$(cd worker && npx wrangler deploy 2>&1 | tee /dev/stderr)"
URL="$(printf '%s' "$DEPLOY_OUTPUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1 || true)"

if [[ -n "$URL" ]]; then
  echo "▶ 初始化数据库表结构"
  for i in 1 2 3 4 5; do
    code="$(curl -s -o /tmp/henna-init.json -w '%{http_code}' "$URL/api/init/$JWT_SECRET" || echo 000)"
    if [[ "$code" == "200" ]]; then
      echo "✓ 初始化完成："; cat /tmp/henna-init.json; echo
      break
    fi
    echo "· 第 $i 次初始化未就绪（HTTP $code），8s 后重试"
    sleep 8
  done
  echo
  echo "────────────────────────────────────────────"
  echo "✓ 部署完成：$URL"
  echo "  管理后台：$URL/admin   （注册的首个账号即管理员）"
  echo "  收信配置：Cloudflare 控制台 → 域名 → Email → Email Routing → Routing rules → Send to Worker → henna-mail"
  echo "────────────────────────────────────────────"
else
  echo "✓ 部署命令已执行，请从上方输出获取访问地址"
fi
