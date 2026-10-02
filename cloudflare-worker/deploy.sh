#!/usr/bin/env bash
#
# 用 Cloudflare API 重新部署備份 Worker（不需 wrangler、不需互動登入）
#
# 用法：
#   CLOUDFLARE_API_TOKEN=xxxx bash cloudflare-worker/deploy.sh
#
# Token 在這裡生：https://dash.cloudflare.com/profile/api-tokens
#   → Create Custom Token
#   → Permissions: Account | Workers Scripts | Edit
#   → Account Resources: Include | 你的帳號
#   （TTL 隨意，建完只會顯示一次）
#
# 環境變數：
#   CLOUDFLARE_API_TOKEN   必要，Workers Scripts:Edit 權限
#   CF_ACCOUNT_ID          預設已填（Isearover@gmail.com's Account）
#   CF_KV_ID               預設已填（worktime-backup namespace）
#   CF_SCRIPT              預設 worktime-backup

set -euo pipefail
cd "$(dirname "$0")/.."

: "${CLOUDFLARE_API_TOKEN:?請設定 CLOUDFLARE_API_TOKEN（需 Workers Scripts:Edit 權限）}"
CF_ACCOUNT_ID="${CF_ACCOUNT_ID:-77002f1945c94a1c33a11717015c378b}"
CF_KV_ID="${CF_KV_ID:-32ecc1c3302f4b4f9d0bfa725013dfcc}"
CF_SCRIPT="${CF_SCRIPT:-worktime-backup}"
BASE="https://worktime-backup.isearover.workers.dev/api/backup"

# 沙箱內 DNS 常解析不到真實 IP，連不上時改指定已知 IP 再試一次
resolve_args() {
  if curl -s -m 8 -o /dev/null "https://api.cloudflare.com/client/v4/user/tokens/verify" \
       -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" 2>/dev/null; then
    return 0
  fi
  for ip in 104.19.193.29 104.16.4.5 104.16.5.5; do
    if curl -s -m 8 -o /dev/null --resolve "api.cloudflare.com:443:${ip}" \
         "https://api.cloudflare.com/client/v4/user/tokens/verify" \
         -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" 2>/dev/null; then
      echo "--resolve api.cloudflare.com:443:${ip}"
      return 0
    fi
  done
  echo ""
}

echo "▸ 目標：${CF_SCRIPT}（account ${CF_ACCOUNT_ID}）"

# 1) 組成 metadata（ES module 格式，綁定 KV）
python3 - "$CF_KV_ID" <<'PY' > /tmp/cf_metadata.json
import json, sys
print(json.dumps({
    "main_module": "worker.js",
    "bindings": [{
        "type": "kv_namespace",
        "name": "BACKUP_KV",
        "namespace_id": sys.argv[1],
    }],
    "compatibility_date": "2026-09-18",
}, ensure_ascii=False))
PY

# 2) 上傳
RESOLVE="$(resolve_args)"
echo "▸ 上傳 worker.js …"
# shellcheck disable=SC2086
resp=$(curl -s -m 60 $RESOLVE \
  -X PUT \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -F "worker.js=@cloudflare-worker/worker.js;type=application/javascript+module" \
  -F "metadata=@/tmp/cf_metadata.json;type=application/json" \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/scripts/${CF_SCRIPT}")

if ! echo "$resp" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('success') else 1)"; then
  echo "✗ 部署失敗："
  echo "$resp" | head -c 800
  exit 1
fi
echo "✓ 部署成功"

# 3) 驗證（打真實網址）
echo "▸ 驗證 …"
printf "  v1 GET  ?code=AAAAAAAA      → "
curl -s -m 20 -w " (HTTP %{http_code})\n" "${BASE}?code=AAAAAAAA"

printf "  v2 POST op=get（無資料）      → "
curl -s -m 20 -X POST -H "Content-Type: application/json" \
  -d '{"op":"get","tok":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}' \
  -w " (HTTP %{http_code})\n" "${BASE}"

TOK="DEPLOYCHECK$(date +%s | tail -c 9)"
WK="check-write-key-$(date +%s)"
printf "  v2 POST op=put               → "
curl -s -m 20 -X POST -H "Content-Type: application/json" \
  -d "{\"op\":\"put\",\"tok\":\"${TOK}\",\"wk\":\"${WK}\",\"app\":\"worktime-calendar-cf\",\"v\":2,\"savedAt\":\"x\",\"kdf\":{\"salt\":\"s\",\"iter\":600000},\"enc\":{\"iv\":\"AAAAAAAAAAAAAAAA\",\"data\":\"dGVzdA==\"}}" \
  -w " (HTTP %{http_code})\n" "${BASE}"

printf "  v2 POST op=delete            → "
curl -s -m 20 -X POST -H "Content-Type: application/json" \
  -d "{\"op\":\"delete\",\"tok\":\"${TOK}\",\"wk\":\"${WK}\"}" \
  -w " (HTTP %{http_code})\n" "${BASE}"

echo
echo "預期：404 / 404 / {\"ok\":true} / {\"ok\":true}"
echo "（若 op=get 回 405，表示部署的是舊版 worker.js）"
