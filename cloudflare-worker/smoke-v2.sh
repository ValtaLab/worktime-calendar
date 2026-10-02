#!/usr/bin/env bash
#
# 線上 Worker 健康檢查：v1 舊 API ＋ v2 新 API ＋ CORS
#
#   bash cloudflare-worker/smoke-v2.sh
#
# 會真的寫入一筆測試資料到 KV，跑完自動刪除。
# （建議在 Worker 部署後跑一次；本機需要有能連到 workers.dev 的網路）

BASE="${BASE:-https://worktime-backup.isearover.workers.dev/api/backup}"
TOK="SMOKEV2TOKEN0123456789abcdefghijklmnop"
WK="smoke-write-key-0123456789abcdef"

hr() { printf '\n\033[1m%s\033[0m\n' "$1"; }
req() { # req <說明> <預期碼> <curl 參數…>
  local desc="$1" want="$2"; shift 2
  local out code
  out=$(curl -s -m 20 -w "\n%{http_code}" "$@")
  code=$(echo "$out" | tail -1)
  body=$(echo "$out" | sed '$d')
  if [ "$code" = "$want" ]; then
    printf '  \033[32m✓\033[0m %s → HTTP %s  %s\n' "$desc" "$code" "$(echo "$body" | head -c 70)"
  else
    printf '  \033[31m✗\033[0m %s → HTTP %s（預期 %s）  %s\n' "$desc" "$code" "$want" "$(echo "$body" | head -c 70)"
  fi
}

hr "v1 API（舊版相容，應仍可用）"
req "GET 無資料" 404 "$BASE?code=AAAAAAAA"
req "PUT 寫入" 200 -X PUT -H "Content-Type: application/json" \
  -d '{"app":"worktime-calendar-cf","v":1,"savedAt":"2026-01-01T00:00:00Z","enc":{"iv":"AAAAAAAAAAAAAAAA","data":"dGVzdA=="}}' \
  "$BASE?code=SMOKETEST"
req "GET 有資料" 200 "$BASE?code=SMOKETEST"
req "非法恢復碼" 400 "$BASE?code=BAD"

hr "v2 API（單一 POST 端點）"
req "op=get 無資料" 404 -X POST -H "Content-Type: application/json" -d "{\"op\":\"get\",\"tok\":\"$TOK\"}" "$BASE"
req "op=put 建立" 200 -X POST -H "Content-Type: application/json" \
  -d "{\"op\":\"put\",\"tok\":\"$TOK\",\"wk\":\"$WK\",\"app\":\"worktime-calendar-cf\",\"v\":2,\"savedAt\":\"2026-01-01T00:00:00Z\",\"kdf\":{\"salt\":\"c2FsdA==\",\"iter\":600000},\"enc\":{\"iv\":\"AAAAAAAAAAAAAAAA\",\"data\":\"dGVzdA==\"}}" "$BASE"
req "op=get 有資料" 200 -X POST -H "Content-Type: application/json" -d "{\"op\":\"get\",\"tok\":\"$TOK\"}" "$BASE"
req "寫入金鑰錯誤 → 拒絕" 403 -X POST -H "Content-Type: application/json" \
  -d "{\"op\":\"put\",\"tok\":\"$TOK\",\"wk\":\"totally-wrong-key-0123456789\",\"app\":\"worktime-calendar-cf\",\"v\":2,\"enc\":{\"iv\":\"AAAAAAAAAAAAAAAA\",\"data\":\"x\"}}" "$BASE"
req "非法 tok → 拒絕" 400 -X POST -H "Content-Type: application/json" -d '{"op":"get","tok":"../../etc/passwd"}' "$BASE"
req "未知 op → 拒絕" 400 -X POST -H "Content-Type: application/json" -d "{\"op\":\"hack\",\"tok\":\"$TOK\"}" "$BASE"
req "op=delete 刪除" 200 -X POST -H "Content-Type: application/json" -d "{\"op\":\"delete\",\"tok\":\"$TOK\",\"wk\":\"$WK\"}" "$BASE"
req "刪除後 op=get" 404 -X POST -H "Content-Type: application/json" -d "{\"op\":\"get\",\"tok\":\"$TOK\"}" "$BASE"

hr "CORS"
echo "  -- 授權來源（應有 access-control-allow-origin）--"
curl -s -X OPTIONS -H "Origin: https://valtalab.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" -D - -o /dev/null "$BASE" | grep -i "^\(HTTP\|access-control\)" | sed 's/^/     /'
echo "  -- 未授權來源（不應有 access-control-allow-origin）--"
curl -s -X OPTIONS -H "Origin: https://evil.example.com" \
  -H "Access-Control-Request-Method: POST" -D - -o /dev/null "$BASE" | grep -i "^\(HTTP\|access-control\)" | sed 's/^/     /'

echo
echo "注意：v1 的 SMOKETEST 那筆會留在 KV 裡，要清就到 Dashboard 的 KV 介面刪掉 wtc:SMOKETEST。"
