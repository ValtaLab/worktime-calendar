# 推送方法 — 實戰筆記

> 這份文件記錄本專案唯一可用的 GitHub 推送路徑。每次要推送前，先讀完第 1、2 節。

---

## 1. 環境預檢（每次推送前必做）

沙箱的網路環境**不穩定且會被重置**。開工第一件事：

```bash
getent hosts api.github.com
```

| 結果 | 意義 | 動作 |
|---|---|---|
| `140.82.121.6` | ✅ 正常 | 直接推送 |
| `198.18.0.x` | ❌ DNS 被攔截 | 見下方修復，或用 `push-api.sh`（自帶繞過） |

### 兩種繞過方式

**方式 A（推薦，用在 `push-api.sh`）：Python 層攔截 `getaddrinfo`**

不改系統設定，只在本腳本行程內生效，因此不受沙箱重置影響：

```python
_orig = socket.getaddrinfo
def _patched(host, port, family=0, type=0, proto=0, flags=0):
    if host == "api.github.com":
        return _orig("140.82.121.6", port, family, type, proto, flags)
    return _orig(host, port, family, type, proto, flags)
socket.getaddrinfo = _patched
```

**保留主機名**是關鍵 —— TLS SNI 與憑證驗證才會正確。
不要寫 `https://140.82.121.6/...`，會 `IP address mismatch`。

**方式 B（用在 curl）：改 `/etc/hosts`**

```bash
grep -v "github.com\|githubusercontent.com\|github.io" /etc/hosts > /tmp/hosts.new
cat >> /tmp/hosts.new <<'EOF'
140.82.121.4 github.com
140.82.121.6 api.github.com
140.82.121.35 ssh.github.com
185.199.108.133 raw.githubusercontent.com
185.199.108.133 objects.githubusercontent.com
185.199.108.153 valtalab.github.io
EOF
cp /tmp/hosts.new /etc/hosts
```

⚠️ 會被重置，每次都要重驗。最後三行是驗證「線上網站」必需的 ——
少了 `valtalab.github.io`，`curl` 會回 `HTTP 000`，讓你誤以為部署失敗。

---

## 2. 推送（`push-api.sh`）

### 基本用法

```bash
cd /workspace/worktime-calendar
GITHUB_TOKEN=github_pat_xxx bash push-api.sh -m "提交訊息"
```

| 參數 | 說明 |
|---|---|
| （無參數） | 自動偵測變更並提交 |
| `-m "訊息"` | 自訂提交訊息 |
| `--files a.js b.js` | 只提交指定檔案 |
| `--dry-run` | 只看會提交什麼 |
| `--init` | 建 repo + 啟用 Pages |

### 為什麼不用 `git push`

沙箱對 `github.com:443` 的 TLS 連線極不穩定，持續出現：

```
gnutls_handshake() failed: The TLS connection was non-properly terminated.
GnuTLS recv error (-110): The TLS connection was non-properly terminated.
```

`git fetch` 實測會卡住 4 分鐘以上。**不要浪費時間在 git smart-HTTP 上。**

---

## 3. 直接推單檔（含二進位）

`push-api.sh` 走 Git Data API（整批 tree 提交）。若要精準推單一檔案（例如只補一張 PNG），
用 Contents API：

```bash
TOKEN='github_pat_xxx'
REPO="ValtaLab/worktime-calendar"
path="screenshots/06-編輯面板-半夜加班.png"

# 1. 取舊 sha（更新既有檔必要；新檔不要帶，帶了會 409）
sha=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/$REPO/contents/$path?ref=main" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('sha','') if isinstance(d,dict) else '')")

# 2. base64 寫進檔案（★ 不能當命令列參數，33 萬字元會 Argument list too long）
base64 -w0 "$path" > /tmp/b64.txt

# 3. 組 payload
python3 -c "
import json,sys
body={'message':'docs: 更新 '+sys.argv[1],'content':open('/tmp/b64.txt').read(),'branch':'main'}
if sys.argv[2]: body['sha']=sys.argv[2]
json.dump(body,open('/tmp/payload.json','w'))
" "$path" "$sha"

# 4. 送出
curl -s -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" -d @/tmp/payload.json \
  "https://api.github.com/repos/$REPO/contents/$path"
```

**二進位檔（PNG 等）只能走這條路** —— MCP 不吃二進位，見第 5 節。

---

## 4. 推送後的驗證（三件套）

不看 HTTP 200 就收工，**要比對 blob SHA**：

```bash
# ① 本機
git hash-object app.js
# → 25ee70322ff45bc6012761b4b7518f26bf2c3ce3

# ② 遠端 repo
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/ValtaLab/worktime-calendar/contents/app.js?ref=main" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['sha'])"
# → 25ee70322ff45bc6012761b4b7518f26bf2c3ce3

# ③ 線上實際檔案（證明 CI + Pages 都對）
curl -s https://valtalab.github.io/worktime-calendar/app.js -o /tmp/live.js
git hash-object /tmp/live.js
# → 25ee70322ff45bc6012761b4b7518f26bf2c3ce3
```

**三者全等才算真的上線。** 第 ③ 步最重要 —— repo 對了但 CI 掛掉，線上仍是舊版。

### 檢查 CI

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/ValtaLab/worktime-calendar/actions/runs?per_page=4" \
  | python3 -c "
import sys,json
for r in json.load(sys.stdin).get('workflow_runs',[])[:4]:
    print(('✅' if r['conclusion']=='success' else ('⏳' if r['status']!='completed' else '❌')),
          r['head_sha'][:8], r['conclusion'])
"
```

`cancelled` 是**併發保護的正常行為**（連續 push 時自動取消排隊中的舊執行），
只要最新一次 `success` 就代表部署正確，不要追這些。

---

## 5. 各推送通道能力對照

| 通道 | 純文字 | 二進位 | 大檔 | 穩定性 |
|---|---|---|---|---|
| `push-api.sh`（Git Data API） | ✅ | ✅ | ✅ | ✅ 推薦 |
| Contents API 單檔 | ✅ | ✅ | ✅ | ✅ 推薦 |
| `mcp__github__push_files` | ✅ | ❌ | ⚠️ ~40KB 上限 | ⚠️ 需人工轉錄 |
| `git push` | ✅ | ✅ | ✅ | ❌ TLS 不穩 |

### 為什麼不用 MCP

**本專案曾因此摧毀 `main` 分支**：把 `content` 填成 `"@@APP_JS@@"` 佔位字串
→ commit 直接覆寫 8 個檔案成垃圾。**佔位符就是內容，沒有第二階段。**

MCP 的三個硬限制：
- **沒有本機檔案存取** —— 內容必須從 context 手動轉錄，轉錄即風險
- **不支援二進位** —— 只吃純文字（base64 是 GitHub 伺服器端才做的）
- **大檔會爆** —— 96 KB 的 HTML 直接讓工具呼叫失敗

非用不可時的紀律：**完整讀出 → 整份推送 → 比對 blob SHA**，三者全過才算成功。

---

## 6. Token 權限

| Token 類型 | 開頭 | 可用性 |
|---|---|---|
| **Fine-grained PAT** | `github_pat_` | ✅ 推薦 |
| Classic PAT | `ghp_` | ✅ 可用（勾 `repo`） |
| GitHub App user token | `ghu_` | ❌ 與 PAT 不互通，實測 401 |
| 已撤銷 / 過期 | — | ❌ 401 |

### Fine-grained PAT 設定

https://github.com/settings/personal-access-tokens → Generate new token

| 欄位 | 值 |
|---|---|
| Repository access | Only select repositories → `worktime-calendar` |
| Repository permissions | **Contents → Read and write** ← 必要且唯一需要的權限 |

### 症狀對照（很重要）

| 症狀 | 原因 |
|---|---|
| `GET /user` ✅ 但 `PUT contents` ❌ **403** `Resource not accessible by personal access token` | **權限沒開**，不是 token 失效 |
| `GET /user` ❌ **401** `Bad credentials` | token 真的失效／類型不對 |

**403 ≠ 401。** 403 的修法是到設定頁把 `Contents` 改成 `Read and write`，
**改完即時生效，token 字串不變，不需重新產生**。

---

## 7. 建置產物：`standalone.html`

由 `build-standalone.sh` 從 `index.html + styles.css + app.js + icons/icon-192.png` 組成。

- **不要 commit**（`.gitignore` 已排除）
- 由 CI 在部署前產生（`pages.yml` 的 `Build standalone bundle` 步驟）
- 改動任何來源檔都會讓它過期 —— 這正是交給 CI 的理由

驗證可重現性：本機跑 `build-standalone.sh`，比對 CI 產物的 blob SHA。
實測兩者皆為 `acc77b123ad96024d803296168ec924053c4c233`，完全一致。

---

## 8. 版本發佈流程

```bash
bash bump-version.sh minor "這次改了什麼"   # 1) 升版（同步 3 處）
GITHUB_TOKEN=xxx bash push-api.sh -m "release: X.Y.Z"   # 2) 提交
```

`bump-version.sh` 會同步更新 `version.json`、`sw.js` 的 `CACHE` 名、`app.js` 常數。
**三者任一不同步，更新偵測就會失效。**
