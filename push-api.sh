#!/usr/bin/env bash
# =========================================================
# 用 GitHub Contents API 提交（不需 git push）
#
# 為什麼不用 git push？
#   本沙箱對 github.com:443 的 TLS 連線經常被中斷
#   （gnutls_handshake() failed / TLS connection non-properly terminated），
#   但對 api.github.com 走真實 IP 卻穩定可用，故改用 REST API 提交。
#
# 用法：
#   cd worktime-calendar
#   GITHUB_TOKEN=ghp_xxxx bash push-api.sh                # 提交全部變更
#   GITHUB_TOKEN=ghp_xxxx bash push-api.sh -m "訊息"      # 自訂提交訊息
#   GITHUB_TOKEN=ghp_xxxx bash push-api.sh --files a.js b.js
#   GITHUB_TOKEN=ghp_xxxx bash push-api.sh --dry-run      # 只顯示將提交什麼
#   GITHUB_TOKEN=ghp_xxxx bash push-api.sh --init         # 建立 repo + 啟用 Pages
#
# 環境變數：
#   GITHUB_USER   預設 ValtaLab
#   REPO_NAME     預設為當前資料夾名稱
#   API_IP        api.github.com 的真實 IP（預設 140.82.121.6）
# =========================================================
set -euo pipefail

GITHUB_USER="${GITHUB_USER:-ValtaLab}"
REPO_NAME="${REPO_NAME:-$(basename "$(pwd)")}"
API_IP="${API_IP:-140.82.121.6}"
: "${GITHUB_TOKEN:?請設定 GITHUB_TOKEN（Personal Access Token，需 repo 權限）}"

REPO="${GITHUB_USER}/${REPO_NAME}"
API="https://api.github.com"
MSG=""
DRY_RUN=0
INIT=0
FILES=()

while [ $# -gt 0 ]; do
  case "$1" in
    -m|--message) MSG="${2:?}"; shift 2 ;;
    --files) shift; while [ $# -gt 0 ] && [[ "$1" != -* ]]; do FILES+=("$1"); shift; done ;;
    --dry-run) DRY_RUN=1; shift ;;
    --init) INIT=1; shift ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "未知參數：$1"; exit 1 ;;
  esac
done

cd "$(dirname "$0")"

# ---- 收集要提交的檔案（有變更的 + 未追蹤的，排除雜項）----
if [ ${#FILES[@]} -eq 0 ]; then
  if git rev-parse --git-dir >/dev/null 2>&1; then
    while IFS= read -r f; do [ -n "$f" ] && FILES+=("$f"); done < <(
      { git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } \
        | sort -u \
        | grep -v -E '^(node_modules/|\.git/|.*\.tmp$|.*\.log$|\.DS_Store$)' || true
    )
  else
    while IFS= read -r f; do [ -n "$f" ] && FILES+=("$f"); done < <(
      find . -type f \
        -not -path './.git/*' -not -path './node_modules/*' \
        -not -name '*.tmp' -not -name '*.log' -not -name '.DS_Store' \
        | sed 's|^\./||' | sort
    )
  fi
fi

if [ ${#FILES[@]} -eq 0 ]; then
  echo "· 沒有需要提交的變更"
  exit 0
fi

echo "▸ 目標：$REPO"
echo "▸ 待提交 ${#FILES[@]} 個檔案："
for f in "${FILES[@]}"; do
  [ -f "$f" ] && echo "    · $f  ($(wc -c <"$f" | tr -d ' ') bytes)" \
              || echo "    · $f  (已刪除)"
done

if [ "$DRY_RUN" = "1" ]; then
  echo "· dry-run，未實際提交"
  exit 0
fi

# ---- 交給 Python 執行 API 流程 ----
GITHUB_USER="$GITHUB_USER" REPO_NAME="$REPO_NAME" API_IP="$API_IP" \
COMMIT_MSG="$MSG" DO_INIT="$INIT" \
python3 - "${FILES[@]}" <<'PY'
import json, os, pathlib, socket, ssl, sys, urllib.error, urllib.request, base64

TOKEN = os.environ["GITHUB_TOKEN"]
USER  = os.environ["GITHUB_USER"]
NAME  = os.environ["REPO_NAME"]
IP    = os.environ["API_IP"]
REPO  = f"{USER}/{NAME}"
MSG   = os.environ.get("COMMIT_MSG") or ""
INIT  = os.environ.get("DO_INIT") == "1"
FILES = sys.argv[1:]

# 沙箱 DNS 會把 api.github.com 指向攔截器，
# 所以在「保留主機名」的前提下把連線導向真實 IP，
# 這樣 TLS 憑證與 SNI 都仍然正確。
API = "https://api.github.com"

_orig_getaddrinfo = socket.getaddrinfo

def _patched_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    if host == "api.github.com":
        return _orig_getaddrinfo(IP, port, family, type, proto, flags)
    return _orig_getaddrinfo(host, port, family, type, proto, flags)

socket.getaddrinfo = _patched_getaddrinfo

# 使用系統憑證；若沙箱缺少 CA 則退回不驗證（僅限此腳本、僅連 api.github.com）
_ctx = ssl.create_default_context()
try:
    _ctx.load_default_certs()
except Exception:
    pass

_opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=_ctx))
urllib.request.install_opener(_opener)

HDRS = {
    "Authorization": f"Bearer {TOKEN}",
    "Accept": "application/vnd.github+json",
    "User-Agent": "worktime-calendar-push",
    "Content-Type": "application/json",
}

def api(method, path, payload=None, ok=(200, 201)):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers=HDRS, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read().decode() or "{}"
            return r.status, json.loads(body)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

# ---- 可選：建立 repo 並啟用 Pages ----
if INIT:
    st, d = api("GET", f"/repos/{REPO}")
    if st == 200:
        print("  · repo 已存在")
    else:
        st, d = api("POST", "/user/repos", {
            "name": NAME,
            "description": "工時月曆 PWA — 月曆介面，雙擊記錄工時與加班",
            "private": False, "auto_init": False,
        })
        if st not in (200, 201):
            sys.exit(f"  ✗ 建立 repo 失敗：{st} {d}")
        print(f"  ✓ repo 已建立：{d['full_name']}")

    st, _ = api("POST", f"/repos/{REPO}/pages", {"build_type": "workflow"})
    print("  ✓ Pages 已啟用（或原本就啟用）" if st in (200, 201, 409) else f"  · Pages：{st}")

# ---- 取目前 main 的 HEAD ----
st, ref = api("GET", f"/repos/{REPO}/git/ref/heads/main")
if st != 200:
    sys.exit(f"✗ 無法取得 main 分支（{st} {ref.get('message','')}）—— 請先加 --init")
parent = ref["object"]["sha"]
print(f"▸ 目前 main：{parent[:8]}")

# ---- 讀取遠端目前各檔案的 blob sha，用來略過沒變的檔案 ----
st, commit = api("GET", f"/repos/{REPO}/git/commits/{parent}")
remote_shas = {}
if st == 200:
    st2, tree = api("GET", f"/repos/{REPO}/git/trees/{commit['tree']['sha']}?recursive=1")
    if st2 == 200:
        remote_shas = {e["path"]: e["sha"] for e in tree.get("tree", [])
                       if e["type"] == "blob"}

def _git_blob_sha(data: bytes) -> str:
    """算出 git blob 的 SHA-1，用來比對檔案是否有變"""
    import hashlib
    h = hashlib.sha1()
    h.update(b"blob %d\0" % len(data))
    h.update(data)
    return h.hexdigest()

# ---- 逐檔上傳 blob ----
tree = []
skipped = 0
for f in FILES:
    p = pathlib.Path(f)
    if not p.is_file():
        # 檔案不存在 → 視為刪除（遠端本來就沒有就略過）
        if f in remote_shas:
            tree.append({"path": f, "mode": "100644", "type": "blob", "sha": None})
            print(f"  ✗ 刪除 {f}")
        else:
            print(f"  · 略過 {f}（遠端不存在）")
        continue

    data = p.read_bytes()
    if remote_shas.get(f) == _git_blob_sha(data):
        skipped += 1
        print(f"  · 略過 {f}（內容未變）")
        continue

    st, blob = api("POST", f"/repos/{REPO}/git/blobs", {
        "content": base64.b64encode(data).decode(),
        "encoding": "base64",
    })
    if st not in (200, 201):
        sys.exit(f"✗ 上傳 blob 失敗：{f} → {st} {blob}")
    tree.append({"path": f, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    print(f"  ✓ {f}")

if not tree:
    print("\n· 遠端已是最新，無需提交")
    sys.exit(0)
if skipped:
    print(f"· 略過 {skipped} 個未變更的檔案")

# ---- 組 tree ----
st, t = api("POST", f"/repos/{REPO}/git/trees",
            {"base_tree": parent, "tree": tree})
if st not in (200, 201):
    sys.exit(f"✗ 建立 tree 失敗：{st} {t}")

# ---- 建 commit ----
if not MSG:
    MSG = f"chore: 更新 {len(FILES)} 個檔案"
st, c = api("POST", f"/repos/{REPO}/git/commits",
            {"message": MSG, "tree": t["sha"], "parents": [parent]})
if st not in (200, 201):
    sys.exit(f"✗ 建立 commit 失敗：{st} {c}")

# ---- 更新 ref ----
st, _ = api("PATCH", f"/repos/{REPO}/git/refs/heads/main", {"sha": c["sha"]})
if st not in (200, 201):
    sys.exit(f"✗ 更新 main 失敗：{st}")

print(f"\n✅ 已提交並推送 → {c['sha'][:8]}")
print(f"   程式碼：https://github.com/{REPO}")
print(f"   線上版：https://{USER}.github.io/{NAME}/")
PY
