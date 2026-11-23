// Cloudflare Worker: receives feedback from the Ancient Europe app and stores it in KV.
//
// Needs one KV binding named FEEDBACK_KV.
// Optional secret ADMIN_TOKEN: lets you download all answers at  <worker-url>/export?token=...
// No IP address is stored (only what the visitor filled in, plus the period they viewed and their screen size).

const ALLOWED_ORIGINS = [
  "https://ancienteurope.org",
  "https://www.ancienteurope.org",
];

const MAX_BODY_CHARS = 30000;   // whole request
const MAX_ANSWERS = 30;         // number of questions
const MAX_TEXT = 2000;          // one open answer
const MAX_OPTIONS = 20;         // ticked options per question
const MAX_OPTION_TEXT = 400;    // one ticked option, incl. an "Other: ..." text
const RATE_LIMIT_PER_HOUR = 5;  // submissions per visitor per hour (approximate)

function corsHeaders(origin) {
  const h = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (ALLOWED_ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Only accept the shapes the app sends: a number (stars), a text, or a list of ticked options.
function cleanAnswers(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ANSWERS) return null;
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const id = str(item.id, 40);
    const question = str(item.question, 300);
    if (!id) return null;
    let answer;
    if (typeof item.answer === "number" && Number.isFinite(item.answer)) answer = item.answer;
    else if (typeof item.answer === "string") answer = str(item.answer, MAX_TEXT);
    else if (Array.isArray(item.answer)) answer = item.answer.slice(0, MAX_OPTIONS).map(x => str(x, MAX_OPTION_TEXT)).filter(Boolean);
    else answer = null;
    out.push({ id, question, answer });
  }
  return out;
}

async function visitorKey(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return null;
  // One-way, daily-changing hash used only for the rate limit; the IP address itself is never stored.
  const day = new Date().toISOString().slice(0, 10);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + "|" + day));
  return "rl:" + [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function handleExport(url, env) {
  const token = url.searchParams.get("token") || "";
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return new Response("Not found", { status: 404 });
  const items = [];
  let cursor;
  do {
    const page = await env.FEEDBACK_KV.list({ prefix: "fb:", cursor });
    for (const k of page.keys) {
      const v = await env.FEEDBACK_KV.get(k.name);
      if (v) items.push(JSON.parse(v));
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  items.sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : 1));
  return new Response(JSON.stringify(items, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "GET" && url.pathname === "/export") return handleExport(url, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== "POST") return new Response("Not found", { status: 404 });

    // Only accept submissions from the Ancient Europe website.
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: "origin" }, 403, origin);

    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) return json({ ok: false, error: "too_large" }, 413, origin);

    let data;
    try { data = JSON.parse(text); } catch { return json({ ok: false, error: "bad_json" }, 400, origin); }

    // Honeypot: a real visitor never fills this field. Pretend it worked.
    if (data && typeof data.website === "string" && data.website.trim() !== "") return json({ ok: true }, 200, origin);

    const answers = cleanAnswers(data && data.answers);
    if (!answers) return json({ ok: false, error: "bad_answers" }, 400, origin);
    const hasContent = answers.some(a => (Array.isArray(a.answer) ? a.answer.length : a.answer !== null && a.answer !== ""));
    if (!hasContent) return json({ ok: false, error: "empty" }, 400, origin);

    const rl = await visitorKey(request);
    if (rl) {
      const count = parseInt((await env.FEEDBACK_KV.get(rl)) || "0", 10);
      if (count >= RATE_LIMIT_PER_HOUR) return json({ ok: false, error: "rate_limited" }, 429, origin);
      await env.FEEDBACK_KV.put(rl, String(count + 1), { expirationTtl: 3600 });
    }

    const m = (data && typeof data.meta === "object" && data.meta) || {};
    const record = {
      receivedAt: new Date().toISOString(),
      answers,
      meta: { period: str(m.period, 40), view: str(m.view, 20), screen: str(m.screen, 20) },
    };
    const key = `fb:${record.receivedAt}:${crypto.randomUUID().slice(0, 8)}`;
    await env.FEEDBACK_KV.put(key, JSON.stringify(record));

    return json({ ok: true }, 200, origin);
  },
};
