/**
 * 自動健康檢查 Worker（選用）
 *
 * 為什麼需要它：備份 Worker 跑在 workers.dev 上，某些受限網路（例如 CI 沙箱）
 * 連不到它，就沒辦法從外部驗證。這支 Worker 定時在 Cloudflare 網路「內部」
 * 去打正式的備份 Worker，把結果寫進同一個 KV 的 `selfcheck:latest`，
 * 之後只要能讀 KV（用 Cloudflare API 即可）就等於看到線上驗證結果。
 *
 * 部署：見 DEPLOY.md「選用：自動健康檢查」
 * 頻率：預設每小時；想即時看結果可暫時改為 `* * * * *`（每分鐘）
 * 成本：每次執行約 9 次子請求 + 1 次 KV 寫入，免費額度內可忽略
 */

const TARGET = "https://worktime-backup.isearover.workers.dev/api/backup";
const TOK = "SELFCHECKTOKEN0123456789abcdefghijkl"; // 專用，不與任何真實備份相撞
const WK = "selfcheck-write-key-0123456789abcdef";

async function runChecks(env) {
  const out = [];

  // 優先用 service binding（同一帳號內直接呼叫，不走 DNS／公網）；
  // 沒綁定時才退回一般 fetch。
  const call = (url, init) =>
    env.BACKUP ? env.BACKUP.fetch(url, init) : fetch(url, init);

  async function t(name, body, want) {
    const started = Date.now();
    try {
      const r = await call(`${TARGET}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://valtalab.github.io" },
        body: JSON.stringify(body),
      });
      const txt = await r.text();
      out.push({
        name,
        status: r.status,
        want,
        ok: r.status === want,
        ms: Date.now() - started,
        body: txt.slice(0, 120),
      });
    } catch (e) {
      out.push({ name, ok: false, error: String(e), ms: Date.now() - started });
    }
  }

  const enc = { iv: "AAAAAAAAAAAAAAAA", data: "dGVzdA==" };

  // v2：正常流程
  await t("v2 get（空）", { op: "get", tok: TOK }, 404);
  await t(
    "v2 put（建立）",
    {
      op: "put", tok: TOK, wk: WK, app: "worktime-calendar-cf", v: 2,
      savedAt: new Date().toISOString(),
      kdf: { salt: "c2FsdA==", iter: 600000 },
      enc,
    },
    200
  );
  await t("v2 get（有資料）", { op: "get", tok: TOK }, 200);

  // v2：防護
  await t(
    "v2 put（寫入金鑰錯 → 403）",
    {
      op: "put", tok: TOK, wk: "totally-wrong-key-0123456789",
      app: "worktime-calendar-cf", v: 2, enc,
    },
    403
  );
  await t("v2 非法 tok → 400", { op: "get", tok: "../../etc/passwd" }, 400);
  await t("v2 未知 op → 400", { op: "hack", tok: TOK }, 400);

  // v2：刪除
  await t("v2 delete", { op: "delete", tok: TOK, wk: WK }, 200);
  await t("v2 get（刪除後）", { op: "get", tok: TOK }, 404);

  // v1：舊協定仍要活著（尚未升級的舊版 App 要靠它）
  try {
    const r = await call(`${TARGET}?code=SELFCHK1`, { method: "GET" });
    out.push({ name: "v1 get（空）", status: r.status, want: 404, ok: r.status === 404 });
  } catch (e) {
    out.push({ name: "v1 get（空）", ok: false, error: String(e) });
  }
  try {
    const r = await call(`${TARGET}?code=BAD`, { method: "GET" });
    out.push({ name: "v1 非法碼 → 400", status: r.status, want: 400, ok: r.status === 400 });
  } catch (e) {
    out.push({ name: "v1 非法碼 → 400", ok: false, error: String(e) });
  }

  // CORS preflight
  try {
    const r = await call(TARGET, {
      method: "OPTIONS",
      headers: { Origin: "https://valtalab.github.io", "Access-Control-Request-Method": "POST" },
    });
    out.push({
      name: "CORS preflight → 204",
      status: r.status,
      want: 204,
      ok: r.status === 204,
      allow: r.headers.get("Access-Control-Allow-Origin"),
    });
  } catch (e) {
    out.push({ name: "CORS preflight → 204", ok: false, error: String(e) });
  }

  const summary = {
    at: new Date().toISOString(),
    total: out.length,
    passed: out.filter((x) => x.ok).length,
    failed: out.filter((x) => !x.ok).map(
      (x) => `${x.name}(got ${x.status ?? x.error}, want ${x.want})`
    ),
    results: out,
  };

  if (env.BACKUP_KV) {
    await env.BACKUP_KV.put("selfcheck:latest", JSON.stringify(summary));
  }
  return summary;
}

function toText(s) {
  const lines = [
    `Worktime Backup 健康檢查`,
    `時間：${s.at}`,
    `結果：${s.passed}/${s.total} 通過${s.failed.length ? "（有失敗）" : "（全部通過）"}`,
    "",
  ];
  for (const r of s.results) {
    const mark = r.ok ? "✓" : "✗";
    const got = r.error ? `ERR ${r.error}` : `${r.status}`;
    lines.push(`${mark} ${r.name}  got=${got} want=${r.want}${r.ms ? ` ${r.ms}ms` : ""}`);
    if (!r.ok && r.body) lines.push(`     ${r.body}`);
  }
  return lines.join("\n");
}

export default {
  // 定時執行：跑完整檢查並寫入 KV
  async scheduled(event, env) {
    await runChecks(env);
  },

  // 唯讀：把最近一次結果顯示出來，方便直接在瀏覽器打開看
  // https://wtc-selfcheck.<subdomain>.workers.dev/
  async fetch(request, env) {
    if (!env.BACKUP_KV) {
      return new Response("BACKUP_KV not bound", { status: 500 });
    }
    const raw = await env.BACKUP_KV.get("selfcheck:latest");
    if (!raw) {
      return new Response("尚未有檢查結果，請等下一個 cron 週期（或看 DEPLOY.md 調整頻率）", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    const s = JSON.parse(raw);
    const accept = request.headers.get("Accept") || "";
    if (accept.includes("application/json")) {
      return new Response(JSON.stringify(s, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    return new Response(toText(s), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
