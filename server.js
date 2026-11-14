/* Shortly — a tiny URL shortener API in pure Node.js. No dependencies. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { qrSvg } = require("./qr");

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;

let links = load();

function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return {}; }
}
function persist() { fs.writeFileSync(DATA_FILE, JSON.stringify(links, null, 2)); }

function makeCode() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code;
  do {
    code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (links[code]);
  return code;
}

/* Input hardening: a short-link request is tiny by nature, so oversized
   bodies and absurdly long URLs are rejected up front instead of being
   stored or parsed. */
const MAX_BODY_BYTES = 64 * 1024;   // 64 KiB JSON body
const MAX_URL_LENGTH = 2048;        // characters

/* Custom aliases: 1-30 chars of letters, digits, _ or -. Reserved words
   (api, and anything starting with it) stay free for the API routes. */
const ALIAS_RE = /^[A-Za-z0-9_-]{1,30}$/;
const RESERVED = new Set(["api"]);
function aliasError(alias) {
  if (typeof alias !== "string" || !ALIAS_RE.test(alias)) {
    return "alias must be 1-30 characters: letters, digits, _ or -";
  }
  if (RESERVED.has(alias.toLowerCase())) return `alias "${alias}" is reserved`;
  if (links[alias]) return `alias "${alias}" is already in use`;
  return null;
}

function isExpired(entry) {
  return !!entry.expiresAt && Date.now() >= new Date(entry.expiresAt).getTime();
}

/* Rate limiting: a fixed window per IP on POST /api/shorten, so one
   client cannot flood the store with links. 30 creates a minute is
   plenty for a human; clients over the cap get a 429 with Retry-After. */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;  // 1 minute
const RATE_LIMIT_MAX = 30;               // requests per window per IP
const rateLimits = new Map();            // ip -> { count, windowStart }

function rateLimited(ip) {
  const now = Date.now();
  let entry = rateLimits.get(ip);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    rateLimits.set(ip, entry);
  }
  // Drop entries from IPs that have gone quiet, so the map stays small.
  if (rateLimits.size > 1000) {
    for (const [key, value] of rateLimits) {
      if (now - value.windowStart >= RATE_LIMIT_WINDOW_MS) rateLimits.delete(key);
    }
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
  }
  return 0;
}

function send(res, status, body, type = "application/json", extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": type, ...extraHeaders });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

const landing = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Shortly</title>
<style>body{font-family:system-ui;background:#0d1117;color:#e6edf3;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:28px;width:min(480px,90vw)}
input,button{width:100%;padding:10px;margin-top:10px;border-radius:8px;border:1px solid #30363d;background:#0d1117;color:#e6edf3}
button{background:#58a6ff;color:#fff;font-weight:700;cursor:pointer}#out{margin-top:14px;word-break:break-all}</style></head>
<body><form id="f"><h1>🔗 Shortly</h1><p>Paste a long URL, get a short link.</p>
<input id="u" placeholder="https://example.com/a/very/long/link" maxlength="2048" required>
<input id="a" placeholder="Custom alias (optional, e.g. my-link)">
<input id="e" type="datetime-local" title="Optional expiry — leave blank and the link never expires">
<button>Shorten</button><div id="out"></div></form>
<script>f.onsubmit=async ev=>{ev.preventDefault();const body={url:u.value};if(a.value.trim())body.alias=a.value.trim();
if(e.value)body.expiresAt=new Date(e.value).toISOString();
const r=await fetch('/api/shorten',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const d=await r.json();
if(!d.shortUrl){out.textContent=d.error||'Error';return;}
out.innerHTML='Short link: <a href="'+d.shortUrl+'" style="color:#58a6ff">'+d.shortUrl+'</a><br><button id="qrbtn" type="button">Show QR code</button><div id="qr"></div>';
const b=document.getElementById('qrbtn');
b.onclick=async()=>{const q=await fetch('/api/links/'+d.code+'/qr');
if(!q.ok){document.getElementById('qr').textContent='Could not load QR code';return;}
document.getElementById('qr').innerHTML=await q.text()+'<br><a href="/api/links/'+d.code+'/qr" download="'+d.code+'-qr.svg" style="color:#58a6ff">Download SVG</a>';
b.remove();};}</script>
</body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, BASE);

  if (req.method === "GET" && url.pathname === "/") return send(res, 200, landing, "text/html");

  if (req.method === "POST" && url.pathname === "/api/shorten") {
    const retryAfter = rateLimited(req.socket.remoteAddress || "unknown");
    if (retryAfter > 0) {
      return send(res, 429,
        { error: `too many requests, try again in ${retryAfter} seconds` },
        "application/json", { "Retry-After": String(retryAfter) });
    }
    let raw = "";
    let size = 0;
    let tooBig = false;
    req.on("data", (c) => {
      if (tooBig) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        tooBig = true;
        send(res, 413, { error: `request body must be ${MAX_BODY_BYTES} bytes or less` });
        req.destroy();
        return;
      }
      raw += c;
    });
    req.on("end", () => {
      if (tooBig) return;
      let body;
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: "invalid JSON body" }); }
      const target = body.url;
      if (typeof target !== "string") return send(res, 400, { error: "url must be a string" });
      if (target.length > MAX_URL_LENGTH) {
        return send(res, 400, { error: `url must be ${MAX_URL_LENGTH} characters or less` });
      }
      let parsed;
      try { parsed = new URL(target); } catch { return send(res, 400, { error: "invalid URL" }); }
      if (!/^https?:$/.test(parsed.protocol)) return send(res, 400, { error: "only http/https URLs are allowed" });
      // Optional expiry: an ISO 8601 date/time in the future. Expired
      // links answer 410 Gone instead of redirecting (see below).
      let expiresAt = null;
      if (body.expiresAt !== undefined) {
        const when = new Date(body.expiresAt);
        if (isNaN(when.getTime())) return send(res, 400, { error: "expiresAt must be a valid ISO 8601 date" });
        if (when.getTime() <= Date.now()) return send(res, 400, { error: "expiresAt must be in the future" });
        expiresAt = when.toISOString();
      }
      let code;
      if (body.alias !== undefined) {
        const err = aliasError(body.alias);
        if (err) return send(res, body.alias && links[body.alias] ? 409 : 400, { error: err });
        code = body.alias;
      } else {
        code = makeCode();
      }
      links[code] = { url: target, clicks: 0, created: new Date().toISOString(), expiresAt };
      persist();
      return send(res, 201, { code, shortUrl: `${BASE}/${code}`, expiresAt });
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/links") {
    return send(res, 200, Object.entries(links).map(([code, v]) => ({ code, ...v })));
  }

  /* Delete a link: removes it from the store, so its short URL stops
     redirecting and its stats disappear. Unknown codes get a 404. */
  if (req.method === "DELETE" && url.pathname.startsWith("/api/links/")) {
    const code = decodeURIComponent(url.pathname.slice("/api/links/".length));
    if (!links[code] || code.includes("/")) return send(res, 404, { error: "link not found" });
    delete links[code];
    persist();
    return send(res, 200, { code, deleted: true });
  }

  /* QR code for a short link: an SVG generated on the fly by qr.js
     (dependency-free, byte mode, EC level L). Unknown codes 404. */
  if (req.method === "GET" && url.pathname.startsWith("/api/links/") &&
      url.pathname.endsWith("/qr")) {
    const code = decodeURIComponent(
      url.pathname.slice("/api/links/".length, -"/qr".length));
    const entry = links[code];
    if (!entry || code.includes("/")) return send(res, 404, { error: "link not found" });
    try {
      const { svg } = qrSvg(`${BASE}/${code}`);
      return send(res, 200, svg, "image/svg+xml");
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  /* Per-link stats: code, target URL, click count, created time and the
     time of the most recent click (null if never clicked). */
  if (req.method === "GET" && url.pathname.startsWith("/api/links/")) {
    const code = decodeURIComponent(url.pathname.slice("/api/links/".length));
    const entry = links[code];
    if (!entry || code.includes("/")) return send(res, 404, { error: "link not found" });
    return send(res, 200, {
      code,
      url: entry.url,
      shortUrl: `${BASE}/${code}`,
      clicks: entry.clicks,
      created: entry.created,
      expiresAt: entry.expiresAt || null,
      expired: isExpired(entry),
      lastClicked: entry.lastClicked || null,
    });
  }

  if (req.method === "GET" && /^\/[A-Za-z0-9_-]{1,30}$/.test(url.pathname)) {
    const entry = links[url.pathname.slice(1)];
    if (!entry) return send(res, 404, { error: "link not found" });
    if (isExpired(entry)) return send(res, 410, { error: "link has expired" });
    entry.clicks++;
    entry.lastClicked = new Date().toISOString();
    persist();
    res.writeHead(302, { Location: entry.url });
    return res.end();
  }

  return send(res, 404, { error: "not found" });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Shortly listening on ${BASE}`));
}

module.exports = { server, makeCode };
