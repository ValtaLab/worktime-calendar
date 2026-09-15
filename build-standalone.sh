#!/usr/bin/env bash
# =========================================================
# 產生單檔版 worktime-calendar.standalone.html
# 把 styles.css / app.js / 圖示 全部內嵌，可離線單獨使用
# 用法：bash build-standalone.sh
# =========================================================
set -euo pipefail
cd "$(dirname "$0")"

OUT="worktime-calendar.standalone.html"
VERSION=$(python3 -c "import json;print(json.load(open('version.json'))['version'])")
BUILD=$(python3 -c "import json;print(json.load(open('version.json'))['build'])")

python3 - "$OUT" <<'PY'
import base64, pathlib, re, sys

root = pathlib.Path('.')
out = pathlib.Path(sys.argv[1])

html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'styles.css').read_text(encoding='utf-8')
js = (root / 'app.js').read_text(encoding='utf-8')
icon = base64.b64encode((root / 'icons' / 'icon-192.png').read_bytes()).decode()

# 1) CSS：<link rel="stylesheet" href="./styles.css"> → <style>
html = re.sub(
    r'<link[^>]*href="\./styles\.css"[^>]*>',
    lambda m: '<style>\n' + css + '\n</style>',
    html, count=1)

# 2) JS：<script src="./app.js" defer></script> → <script>
html = re.sub(
    r'<script[^>]*src="\./app\.js"[^>]*></script>',
    lambda m: '<script>\n' + js + '\n</script>',
    html, count=1)

# 3) 圖示：任何指向 icons/*.png 的連結 → data URI
html = re.sub(
    r'href="\./icons/[^"]+\.png"',
    lambda m: 'href="data:image/png;base64,' + icon + '"',
    html)

# 4) manifest 在單檔模式下無意義（無法提供外部檔案）
html = re.sub(r'<link[^>]*rel="manifest"[^>]*>\n?', '', html)

# 5) 標記為單檔版
html = html.replace('<html lang="zh-Hant">',
                    '<html lang="zh-Hant" data-build="standalone">')

out.write_text(html, encoding='utf-8')
print(f'  ✓ {out}  ({len(html)/1024:.1f} KB)')
PY

echo "✓ 單檔版完成：${OUT}  (v${VERSION} / build ${BUILD})"
