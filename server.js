/* Shortly — a tiny URL shortener API in pure Node.js. No dependencies. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

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

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

const landing = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Shortly</title>
<style>body{font-family:system-ui;background:#0d1117;color:#e6edf3;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:28px;width:min(480px,90vw)}
input,button{width:100%;padding:10px;margin-top:10px;border-radius:8px;border:1px solid #30363d;background:#0d1117;color:#e6edf3}
button{background:#58a6ff;color:#fff;font-weight:700;cursor:pointer}#out{margin-top:14px;word-break:break-all}</style></head>
<body><form id="f"><h1>🔗 Shortly</h1><p>Paste a long URL, get a short link.</p>
<input id="u" placeholder="https://example.com/a/very/long/link" required>
<input id="a" placeholder="Custom alias (optional, e.g. my-link)"><button>Shorten</button><div id="out"></div></form>
<script>f.onsubmit=async e=>{e.preventDefault();const body={url:u.value};if(a.value.trim())body.alias=a.value.trim();
const r=await fetch('/api/shorten',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const d=await r.json();out.innerHTML=d.shortUrl?('Short link: <a href="'+d.shortUrl+'" style="color:#58a6ff">'+d.shortUrl+'</a>'):(d.error||'Error');}</script>
</body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, BASE);

  if (req.method === "GET" && url.pathname === "/") return send(res, 200, landing, "text/html");

  if (req.method === "POST" && url.pathname === "/api/shorten") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body;
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: "invalid JSON body" }); }
      const target = body.url;
      let parsed;
      try { parsed = new URL(target); } catch { return send(res, 400, { error: "invalid URL" }); }
      if (!/^https?:$/.test(parsed.protocol)) return send(res, 400, { error: "only http/https URLs are allowed" });
      let code;
      if (body.alias !== undefined) {
        const err = aliasError(body.alias);
        if (err) return send(res, body.alias && links[body.alias] ? 409 : 400, { error: err });
        code = body.alias;
      } else {
        code = makeCode();
      }
      links[code] = { url: target, clicks: 0, created: new Date().toISOString() };
      persist();
      return send(res, 201, { code, shortUrl: `${BASE}/${code}` });
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
      lastClicked: entry.lastClicked || null,
    });
  }

  if (req.method === "GET" && /^\/[A-Za-z0-9_-]{1,30}$/.test(url.pathname)) {
    const entry = links[url.pathname.slice(1)];
    if (!entry) return send(res, 404, { error: "link not found" });
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
