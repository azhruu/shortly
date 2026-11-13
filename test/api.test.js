/* Shortly endpoint tests — node:test, zero dependencies.
   Starts the real server on an ephemeral port with a throwaway
   DATA_FILE, then exercises every route over HTTP. Run with:
   npm test (or: node --test test/) */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shortly-test-"));
process.env.DATA_FILE = path.join(tmpDir, "data.json");

const { server } = require("../server");

let base;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function postShorten(body, rawBody) {
  return fetch(`${base}/api/shorten`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody !== undefined ? rawBody : JSON.stringify(body),
  });
}

test("GET / serves the landing page", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  assert.match(await res.text(), /Shortly/);
});

test("POST /api/shorten creates a link and GET /:code redirects it", async () => {
  const created = await postShorten({ url: "https://example.com/a/very/long/link" });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(typeof body.code, "string");
  assert.equal(body.code.length, 6);
  assert.ok(body.shortUrl.endsWith(`/${body.code}`));

  const redirect = await fetch(`${base}/${body.code}`, { redirect: "manual" });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "https://example.com/a/very/long/link");

  const stats = await fetch(`${base}/api/links/${body.code}`);
  assert.equal((await stats.json()).clicks, 1);
});

test("GET /api/links lists created links", async () => {
  const created = await postShorten({ url: "https://example.com/list-me" });
  const { code } = await created.json();
  const res = await fetch(`${base}/api/links`);
  assert.equal(res.status, 200);
  const links = await res.json();
  assert.ok(Array.isArray(links));
  assert.ok(links.some((l) => l.code === code && l.url === "https://example.com/list-me"));
});

test("GET /api/links/:code reports stats, unknown codes 404", async () => {
  const created = await postShorten({ url: "https://example.com/stats-me" });
  const { code } = await created.json();
  const res = await fetch(`${base}/api/links/${code}`);
  assert.equal(res.status, 200);
  const stats = await res.json();
  assert.equal(stats.url, "https://example.com/stats-me");
  assert.equal(stats.clicks, 0);
  assert.equal(stats.lastClicked, null);
  assert.equal(stats.expired, false);

  const missing = await fetch(`${base}/api/links/does-not-exist`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, "link not found");
});

test("custom alias: create, clash returns 409, redirect works", async () => {
  const first = await postShorten({ url: "https://example.com/one", alias: "my-link" });
  assert.equal(first.status, 201);
  assert.equal((await first.json()).code, "my-link");

  const clash = await postShorten({ url: "https://example.com/two", alias: "my-link" });
  assert.equal(clash.status, 409);
  assert.match((await clash.json()).error, /already in use/);

  const redirect = await fetch(`${base}/my-link`, { redirect: "manual" });
  assert.equal(redirect.status, 302);
});

test("invalid inputs are rejected with 400", async () => {
  const cases = [
    [{ url: "not a url" }, /invalid URL/],
    [{ url: "ftp://example.com/file" }, /only http\/https/],
    [{ url: "https://example.com", alias: "bad alias!" }, /alias must be/],
    [{ url: "https://example.com", alias: "api" }, /reserved/],
    [{ url: "https://example.com", alias: "x".repeat(31) }, /alias must be/],
    [{ url: "https://example.com", expiresAt: "not-a-date" }, /valid ISO 8601/],
    [{ url: "https://example.com", expiresAt: "2000-01-01T00:00:00.000Z" }, /in the future/],
    [{ url: "https://example.com/" + "a".repeat(2048) }, /2048 characters or less/],
  ];
  for (const [body, message] of cases) {
    const res = await postShorten(body);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    assert.match((await res.json()).error, message);
  }

  const badJson = await postShorten(undefined, "{not json");
  assert.equal(badJson.status, 400);
  assert.match((await badJson.json()).error, /invalid JSON/);
});

test("oversized body returns 413", async () => {
  const res = await postShorten(undefined, JSON.stringify({ url: "https://example.com", pad: "x".repeat(70 * 1024) }));
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /64 KiB|65536/);
});

test("expiry: future expiresAt is stored, expired links answer 410", async () => {
  const expiresAt = new Date(Date.now() + 1000).toISOString();
  const created = await postShorten({ url: "https://example.com/short-lived", expiresAt });
  assert.equal(created.status, 201);
  const { code } = await created.json();
  assert.equal((await fetch(`${base}/api/links/${code}`).then((r) => r.json())).expiresAt, expiresAt);

  await new Promise((r) => setTimeout(r, 1300));

  const redirect = await fetch(`${base}/${code}`, { redirect: "manual" });
  assert.equal(redirect.status, 410);
  assert.match((await redirect.json()).error, /expired/);
});

test("DELETE removes a link and its short URL stops redirecting", async () => {
  const created = await postShorten({ url: "https://example.com/delete-me", alias: "gone-soon" });
  assert.equal(created.status, 201);

  const deleted = await fetch(`${base}/api/links/gone-soon`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { code: "gone-soon", deleted: true });

  assert.equal((await fetch(`${base}/gone-soon`, { redirect: "manual" })).status, 404);
  assert.equal((await fetch(`${base}/api/links/gone-soon`)).status, 404);

  const missing = await fetch(`${base}/api/links/never-existed`, { method: "DELETE" });
  assert.equal(missing.status, 404);
});

test("unknown short code and unknown route return 404", async () => {
  assert.equal((await fetch(`${base}/no-such-code`, { redirect: "manual" })).status, 404);
  assert.equal((await fetch(`${base}/api/whatever`)).status, 404);
});
