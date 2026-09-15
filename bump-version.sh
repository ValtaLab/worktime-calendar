#!/usr/bin/env bash
#
# 更新版本號並產生版本資訊檔。
# 用法：
#   bash bump-version.sh                # patch +1（1.4.0 → 1.4.1）
#   bash bump-version.sh minor          # minor +1（1.4.1 → 1.5.0）
#   bash bump-version.sh major          # major +1（1.5.0 → 2.0.0）
#   bash bump-version.sh 2.1.3 "說明文字"  # 指定版本號
#
# 會同步更新：
#   version.json     ← 前端用來比對版本
#   sw.js            ← CACHE 名稱（強制刷新快取）
#   app.js           ← APP_VERSION / APP_BUILD 常數
#   manifest.webmanifest ← 版本註記（不影響安裝）

set -euo pipefail
cd "$(dirname "$0")"

BUMP="${1:-patch}"
NOTES="${2:-}"

# 讀取目前版本
CUR=$(python3 -c "import json;print(json.load(open('version.json'))['version'])")
IFS='.' read -r MAJ MIN PAT <<< "$CUR"

case "$BUMP" in
  major) MAJ=$((MAJ+1)); MIN=0; PAT=0 ;;
  minor) MIN=$((MIN+1)); PAT=0 ;;
  patch) PAT=$((PAT+1)) ;;
  [0-9]*.[0-9]*.[0-9]*) MAJ="${BUMP%%.*}"; REST="${BUMP#*.}"; MIN="${REST%%.*}"; PAT="${REST#*.}" ;;
  *) echo "✗ 無法解析版本參數：$BUMP" >&2; exit 1 ;;
esac

NEW="${MAJ}.${MIN}.${PAT}"
BUILD="$(date +%Y%m%d-%H%M)"
[ -z "$NOTES" ] && NOTES="版本 ${NEW}"

echo "▸ ${CUR} → ${NEW}  (build ${BUILD})"

# 1) version.json
python3 - "$NEW" "$BUILD" "$NOTES" <<'PY'
import json, sys
new, build, notes = sys.argv[1], sys.argv[2], sys.argv[3]
data = {"version": new, "build": build, "notes": notes}
with open('version.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write('\n')
print("  ✓ version.json")
PY

# 2) sw.js — CACHE 名稱帶版本，確保安裝新版 SW 時清掉舊快取
python3 - "$NEW" <<'PY'
import re, sys
new = sys.argv[1]
s = open('sw.js', encoding='utf-8').read()
s = re.sub(r"const CACHE = '[^']*';", f"const CACHE = 'worktime-calendar-v{new}';", s, count=1)
open('sw.js', 'w', encoding='utf-8').write(s)
print("  ✓ sw.js (CACHE → v" + new + ")")
PY

# 3) app.js — 版本常數
python3 - "$NEW" "$BUILD" <<'PY'
import re, sys
new, build = sys.argv[1], sys.argv[2]
s = open('app.js', encoding='utf-8').read()
s = re.sub(r"const APP_VERSION = '[^']*';", f"const APP_VERSION = '{new}';", s, count=1)
s = re.sub(r"const APP_BUILD = '[^']*';", f"const APP_BUILD = '{build}';", s, count=1)
open('app.js', 'w', encoding='utf-8').write(s)
print("  ✓ app.js")
PY

echo "✓ 完成：${NEW}"
