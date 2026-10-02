/**
 * 工時月曆 — 雲端備份 Worker（Cloudflare Workers + KV）
 *
 * 純中轉：只存取密文，看不到用戶的工時記錄。
 *
 * ── v2 API（v1.33.0 起）────────────────────────────────
 * 全部走單一個 POST 端點，識別憑證放在 request body，
 * 不再出現在 URL（避免落在存取日誌、瀏覽器歷史、Referer）。
 *
 *   POST /api/backup   { op:'get',    tok }                      → {found:true, data} | 404
 *   POST /api/backup   { op:'put',    tok, wk, app, v, savedAt,
 *                        kdf:{salt,iter}, enc:{iv,data} }        → {ok:true}
 *   POST /api/backup   { op:'delete', tok, wk }                  → {ok:true}
 *   OPTIONS                                                      → CORS preflight
 *
 * 三個憑證的分工：
 *   tok  由「恢復碼」經 PBKDF2 派生（600k 迭代）。只能用來定位與讀取，
 *        從 tok 反推恢復碼的成本極高，且它跟加密金鑰是不同的派生結果。
 *   wk   寫入金鑰（隨機 32 bytes），只存在用戶裝置與加密內容裡。
 *        有它才能覆寫或刪除，所以「tok 外洩」不會讓備份被毀。
 *   加密金鑰 完全不出裝置，伺服器只拿到密文＋salt，永遠解不開。
 *
 * ── v1 API（舊版 App，已棄用，過渡期保留）───────────────
 *   GET /api/backup?code=XXXXXXXX   → {found:true, data} | 404
 *   PUT /api/backup?code=XXXXXXXX   → {ok:true}
 * 舊資料用 key「wtc:<code>」，與新的「wtc2:<tok>」分開存放互不干擾。
 * 等所有用戶都升級後可直接刪掉這段。
 *
 * 部署見同目錄 DEPLOY.md。
 */

// 允許跨站呼叫的來源（逗號分隔，可用尾碼 *）。改成你自己的自訂網域時加在這裡。
const ALLOW_ORIGINS = ["https://valtalab.github.io", "http://127.0.0.1:*", "http://localhost:*"];

const CODE_RE = /^[A-Z0-9]{8}$/;                 // v1 恢復碼格式（不含易混淆字元）
const TOK_RE = /^[A-Za-z0-9_-]{16,128}$/;        // v2 派生憑證（base64url，43 字）
const APP_RE = /^worktime-calendar-cf$/;
const MAX_BODY = 300 * 1024;                     // 300KB 上限：幾十年的工時記錄也用不到

// 速率限制：每 IP 每分鐘的配額，只對「寫入類」操作（put/delete）計數。
// 為什麼不計讀取：計數器要寫 KV，而免費額度的 KV 寫入只有 1000 次／日，
// 若連讀取都計，攻擊者狂發請求反而更容易把你的寫入額度耗光（放大攻擊）。
// 讀取端靠 Worker 請求額度（10 萬次／日）與恢復碼的 2^40 空間撐著，
// 想要更嚴就到 Cloudflare 後台用 WAF Rate Limiting Rules（不佔 KV 額度）。
//   wrangler.toml [vars]：RATE_LIMIT=0 關閉；RATE_LIMIT_READS=1 連讀取也計（會吃寫入額度）
const DEFAULT_RATE_LIMIT = 60;

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
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 速率限制：回傳 true 表示已超限（呼叫方自行回 429 並帶上 CORS） */
async function rateLimit(env, ip, weight) {
  const limit =
    env.RATE_LIMIT === undefined ? DEFAULT_RATE_LIMIT : Number(env.RATE_LIMIT);
  if (!limit || !env.BACKUP_KV) return null;
  const bucket = Math.floor(Date.now() / 60000);
  const key = `rl:${ip}:${bucket}`;
  const used = Number((await env.BACKUP_KV.get(key)) || 0) + weight;
  await env.BACKUP_KV.put(key, String(used), { expirationTtl: 180 });
  return used > limit;
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

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";

    /* ================= v2：單一 POST 端點 ================= */
    if (request.method === "POST" && url.pathname === "/api/backup") {
      if (env.RATE_LIMIT_READS === "1" && (await rateLimit(env, ip, 1))) {
        return json({ error: "rate limited" }, 429, cors);
      }

      let body;
      try {
        const text = await request.text();
        if (text.length > MAX_BODY) return json({ error: "too large" }, 413, cors);
        body = JSON.parse(text);
      } catch (e) {
        return json({ error: "invalid body" }, 400, cors);
      }

      const op = body.op;
      const tok = String(body.tok || "");
      if (!TOK_RE.test(tok)) return json({ error: "invalid token" }, 400, cors);

      const dataKey = "wtc2:" + tok;
      const wkKey = "wtk2:" + tok;

      if (op === "get") {
        const value = await env.BACKUP_KV.get(dataKey);
        if (!value) return json({ found: false }, 404, cors);
        return json({ found: true, data: JSON.parse(value) }, 200, cors);
      }

      if (op === "put") {
        if (await rateLimit(env, ip, 5)) return json({ error: "rate limited" }, 429, cors); // 一次寫入算 5 點（60 點 ≈ 每分鐘 12 次）

        if (body.app !== "worktime-calendar-cf" || !body.enc || !body.enc.iv || !body.enc.data) {
          return json({ error: "invalid body" }, 400, cors);
        }
        const wk = String(body.wk || "");
        if (wk.length < 16) return json({ error: "missing write key" }, 400, cors);

        // 寫入金鑰：第一次建立後就固定，之後不符者拒絕（防止憑證外洩後被覆寫）
        const wkHash = await sha256Hex(wk);
        const stored = await env.BACKUP_KV.get(wkKey);
        if (stored && stored !== wkHash) {
          return json({ error: "write key mismatch" }, 403, cors);
        }
        const payload = {
          app: body.app,
          v: body.v,
          savedAt: body.savedAt,
          kdf: body.kdf || null,
          enc: body.enc,
        };
        await env.BACKUP_KV.put(dataKey, JSON.stringify(payload));
        await env.BACKUP_KV.put(wkKey, wkHash);
        return json({ ok: true }, 200, cors);
      }

      if (op === "delete") {
        if (await rateLimit(env, ip, 5)) return json({ error: "rate limited" }, 429, cors);

        const wk = String(body.wk || "");
        if (wk.length < 16) return json({ error: "missing write key" }, 400, cors);
        const wkHash = await sha256Hex(wk);
        const stored = await env.BACKUP_KV.get(wkKey);
        if (!stored) return json({ error: "not found" }, 404, cors);
        if (stored !== wkHash) return json({ error: "write key mismatch" }, 403, cors);

        await env.BACKUP_KV.delete(dataKey);
        await env.BACKUP_KV.delete(wkKey);
        return json({ ok: true }, 200, cors);
      }

      return json({ error: "unknown op" }, 400, cors);
    }

    /* ================= v1：舊版 App（過渡期保留） ================= */
    const code = (url.searchParams.get("code") || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (!CODE_RE.test(code)) {
      return json({ error: "invalid code" }, 400, cors);
    }
    const key = "wtc:" + code;

    if (request.method === "GET") {
      if (env.RATE_LIMIT_READS === "1" && (await rateLimit(env, ip, 1))) {
        return json({ error: "rate limited" }, 429, cors);
      }
      const value = await env.BACKUP_KV.get(key);
      if (!value) return json({ found: false }, 404, cors);
      return json({ found: true, data: JSON.parse(value) }, 200, cors);
    }

    if (request.method === "PUT") {
      if (await rateLimit(env, ip, 5)) return json({ error: "rate limited" }, 429, cors);
      let body;
      try {
        const text = await request.text();
        if (text.length > MAX_BODY) return json({ error: "too large" }, 413, cors);
        body = JSON.parse(text);
      } catch (e) {
        return json({ error: "invalid body" }, 400, cors);
      }
      if (!APP_RE.test(body.app) || !body.enc) {
        return json({ error: "invalid body" }, 400, cors);
      }
      await env.BACKUP_KV.put(key, JSON.stringify(body));
      return json({ ok: true }, 200, cors);
    }

    return json({ error: "method not allowed" }, 405, cors);
  },
};
