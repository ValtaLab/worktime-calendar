# 推送到 GitHub
#
# 用法：
#   cd worktime-calendar
#   GITHUB_USER=你的帳號 GITHUB_TOKEN=ghp_xxxx bash push-to-github.sh
#
# Token 需要 "repo" 權限（https://github.com/settings/tokens）

set -e

REPO_NAME="${REPO_NAME:-worktime-calendar}"
GITHUB_USER="${GITHUB_USER:?請設定 GITHUB_USER（你的 GitHub 帳號）}"
: "${GITHUB_TOKEN:?請設定 GITHUB_TOKEN（Personal Access Token，需 repo 權限）}"

cd "$(dirname "$0")"

echo "▸ 目標：$GITHUB_USER/$REPO_NAME"

# 1) 建立 repo（若已存在則略過）
echo "▸ 建立遠端 repo…"
curl -sS -X POST https://api.github.com/user/repos \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d "{\"name\":\"$REPO_NAME\",\"description\":\"工時月曆 PWA — 月曆介面，雙擊記錄工時與加班\",\"private\":false}" \
  | grep -q '"full_name"' \
  && echo "  ✓ repo 已建立" \
  || echo "  · repo 已存在，直接推送"

# 2) 推送
echo "▸ 推送 main 分支…"
git remote remove origin 2>/dev/null || true
git remote add origin "https://oauth2:${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${REPO_NAME}.git"
git branch -M main
git push -u origin main

# 3) 推送後移除遠端中的 token 明文
git remote set-url origin "https://github.com/${GITHUB_USER}/${REPO_NAME}.git"

# 4) 啟用 GitHub Pages（用 Actions 發佈）
echo "▸ 啟用 GitHub Pages…"
curl -sS -X POST "https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/pages" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d '{"build_type":"workflow"}' >/dev/null 2>&1 || true

echo
echo "✅ 完成！"
echo "   程式碼：https://github.com/${GITHUB_USER}/${REPO_NAME}"
echo "   Pages ：https://${GITHUB_USER}.github.io/${REPO_NAME}/"
echo
echo "   約 1 分鐘後 Pages 會部署完成；若未部署，到 repo 的"
echo "   Settings → Pages → Source 選「GitHub Actions」。"
