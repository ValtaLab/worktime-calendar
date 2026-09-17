/**
 * 工時月曆 — 雲端備份 Worker（Cloudflare Workers + KV）
 *
 * 純中轉：只存取密文，看不到用戶的工時記錄。
 * App 端用「恢復碼」派生 AES-GCM 金鑰加密後上傳，伺服器永遠只有密文。
 *
 * API：
 *   GET /api/backup?code=XXXXXXXX   → {found:true, data} | 404 {found:false}
 *   PUT /api/backup?code=XXXXXXXX   → {ok:true}   body: {app:'worktime-calendar-cf', v:1, enc:{iv,data}}
 *   OPTIONS                          → CORS preflight
 *
 * 部署見同目錄 DEPLOY.md。
 */

// 允許跨站呼叫的來源（逗號分隔，可用尾碼 *）。改成你自己的自訂網域時加在這裡。
// 例："https://valtalab.github.io,https://calendar.example.com"
const ALLOW_ORIGINS = ["https://valtalab.github.io", "http://127.0.0.1:*", "http://localhost:*"];

const CODE_RE = /^[A-Z0-9]{8}$/;          // 恢復碼格式（不含易混淆字元）
const MAX_BODY = 300 * 1024;              // 300KB 上限：幾十年的工時記錄也用不到

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
  });
}

function corsFor(origin) {
  const ok = ALLOW_ORIGINS.some((p) =>
    p.endsWith("*") ? origin.startsWith(p.slice(0, -1)) : origin === p
  );
  if (!ok) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsFor(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (!env.BACKUP_KV) {
      return json({ error: "KV not bound (see DEPLOY.md)" }, 500, cors);
    }

    // 恢復碼：統一大寫、去雜訊後校驗
    const code = (url.searchParams.get("code") || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (!CODE_RE.test(code)) {
      return json({ error: "invalid code" }, 400, cors);
    }
    const key = "wtc:" + code;

    if (request.method === "GET") {
      const value = await env.BACKUP_KV.get(key);
      if (!value) return json({ found: false }, 404, cors);
      return json({ found: true, data: JSON.parse(value) }, 200, cors);
    }

    if (request.method === "PUT") {
      const len = Number(request.headers.get("Content-Length") || 0);
      if (len > MAX_BODY) return json({ error: "too large" }, 413, cors);
      let body;
      try {
        body = JSON.parse(await request.text());
        if (body.app !== "worktime-calendar-cf" || body.v !== 1 || !body.enc) {
          throw new Error("shape");
        }
      } catch (e) {
        return json({ error: "invalid body" }, 400, cors);
      }
      await env.BACKUP_KV.put(key, JSON.stringify(body));
      return json({ ok: true }, 200, cors);
    }

    return json({ error: "method not allowed" }, 405, cors);
  },
};
