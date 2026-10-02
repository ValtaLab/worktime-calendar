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
 * CORS 只擋得住「跑在瀏覽器裡的 JS」；任何伺服器端腳本都能直接打本 Worker。
 * 所以防枚舉恢復碼的真正線是底下的 RATE_LIMIT，不是 ALLOW_ORIGINS。
 *
 * 部署見同目錄 DEPLOY.md。
 */

// 允許跨站呼叫的來源（逗號分隔，可用尾碼 *）。改成你自己的自訂網域時加在這裡。
// 例："https://valtalab.github.io,https://calendar.example.com"
const ALLOW_ORIGINS = ["https://valtalab.github.io", "http://127.0.0.1:*", "http://localhost:*"];

const CODE_RE = /^[A-Z0-9]{8}$/          // 恢復碼格式（不含易混淆字元）
const MAX_BODY = 300 * 1024;              // 300KB 上限：幾十年的工時記錄也用不到

/* ---------------- Rate limiting（防止枚舉恢復碼） ----------------
 * 8 位碼空間約 8.5×10¹¹。離線爆破擋不住（那要改客戶端的金鑰派生），但「上線逐個
 * 猜邊個碼存在」這種枚舉可以擋。純記憶體計數、per-isolate，不寫 KV —— 免費 plan
 * 每日只有 1,000 次 KV 寫入，不值得為限流而用。多 isolate 各自計數，實際門檻會
 * 比下列數字略寬；作縱深防禦仍然有效，且成本為零。 */
const RATE_LIMIT = {
  windowMs: 60_000,     // 1 分鐘窗口
  maxAll:   60,         // 單 IP 每分鐘總請求上限
  maxFail:  15,         // 單 IP 每分鐘「未命中」上限（400／404／413）
  maxBurst: 200,        // Map 最多追蹤多少個 IP，超過就清表
};

const _hits = new Map();   // ip → { n, fail, resetAt }

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
}

/** 放行回傳 null；被限流回傳 429 Response。 */
function rateLimited(request) {
  const now = Date.now();
  const ip = clientIp(request);

  // Map 若無上限會變記憶體洩漏（每個假 IP 一筆）。超量就整個清掉：攻擊者因此也
  // 不能靠洗 IP 把表撐大，代價只是限流窗口對他們失效一次，可接受。
  if (_hits.size > RATE_LIMIT.maxBurst) _hits.clear();

  let rec = _hits.get(ip);
  if (!rec || rec.resetAt <= now) {
    rec = { n: 0, fail: 0, resetAt: now + RATE_LIMIT.windowMs };
    _hits.set(ip, rec);
  }

  rec.n += 1;
  if (rec.n > RATE_LIMIT.maxAll || rec.fail > RATE_LIMIT.maxFail) {
    const retry = Math.max(1, Math.ceil((rec.resetAt - now) / 1000));
    return new Response(JSON.stringify({ error: "rate limited" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Retry-After": String(retry),
      },
    });
  }
  return null;
}

/** 記一次「未命中」嘗試（格式錯／碼不存在／體積超標）。 */
function countFailure(ip) {
  const rec = _hits.get(ip);
  if (rec && rec.resetAt > Date.now()) rec.fail += 1;
}

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
    const ip = clientIp(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (!env.BACKUP_KV) {
      return json({ error: "KV not bound (see DEPLOY.md)" }, 500, cors);
    }

    // 讀寫都計。放喺 KV 檢查之後 —— 未綁 KV 時回 500 就夠，唔好分速率。
    const limited = rateLimited(request);
    if (limited) return limited;

    // 恢復碼：統一大寫、去雜訊後校驗
    const code = (url.searchParams.get("code") || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (!CODE_RE.test(code)) {
      countFailure(ip);
      return json({ error: "invalid code" }, 400, cors);
    }
    const key = "wtc:" + code;

    if (request.method === "GET") {
      const value = await env.BACKUP_KV.get(key);
      if (!value) {
        countFailure(ip);
        return json({ found: false }, 404, cors);
      }
      return json({ found: true, data: JSON.parse(value) }, 200, cors);
    }

    if (request.method === "PUT") {
      const len = Number(request.headers.get("Content-Length") || 0);
      if (len > MAX_BODY) {
        countFailure(ip);
        return json({ error: "too large" }, 413, cors);
      }
      let body;
      try {
        body = JSON.parse(await request.text());
        if (body.app !== "worktime-calendar-cf" || body.v !== 1 || !body.enc) {
          throw new Error("shape");
        }
      } catch (e) {
        countFailure(ip);
        return json({ error: "invalid body" }, 400, cors);
      }
      await env.BACKUP_KV.put(key, JSON.stringify(body));
      return json({ ok: true }, 200, cors);
    }

    return json({ error: "method not allowed" }, 405, cors);
  },
};
