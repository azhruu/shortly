/* Rate-limit test — kept in its own file so it runs in a separate
   process with a fresh server: 31 rapid creates from one IP must
   trip the 30-per-minute cap on the 31st request. */
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

test("POST /api/shorten rate-limits at 30 requests per minute per IP", async () => {
  let last;
  for (let i = 0; i < 31; i++) {
    last = await fetch(`${base}/api/shorten`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: `https://example.com/rate-${i}` }),
    });
    if (i < 30) assert.equal(last.status, 201, `request ${i + 1} should succeed`);
  }
  assert.equal(last.status, 429);
  assert.match((await last.json()).error, /too many requests/);
  assert.ok(last.headers.get("retry-after"), "429 carries a Retry-After header");
});
