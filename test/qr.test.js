/* Shortly QR code tests — node:test, zero dependencies.
   Covers the GET /api/links/:code/qr endpoint and the qr.js generator
   itself (matrix structure, format information, version selection).
   Run with: npm test (or: node --test test/) */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shortly-qr-test-"));
process.env.DATA_FILE = path.join(tmpDir, "data.json");

const { server } = require("../server");
const { makeQr, qrSvg, formatBits, MAX_BYTES } = require("../qr");

let base;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function makeLink(url = "https://example.com/a/very/long/link") {
  const res = await fetch(`${base}/api/shorten`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  assert.equal(res.status, 201);
  return res.json();
}

/* Read the raw 15 format bits back out of a matrix: bit 0 at (0,8),
   up to bit 7 at (8,8), bit 8 at (8,7), bit 14 (MSB) at (8,0). */
function readFormat(qr) {
  const pos = [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8],
    [8, 8], [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0]];
  let bits = 0;
  pos.forEach(([r, c], i) => { if (qr.modules[r][c]) bits |= 1 << i; });
  return bits;
}

test("GET /api/links/:code/qr returns an SVG QR code", async () => {
  const { code } = await makeLink();
  const res = await fetch(`${base}/api/links/${code}/qr`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /image\/svg\+xml/);
  const svg = await res.text();
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 33 33"/); // version 2 (25 modules) + quiet zone
  assert.match(svg, /<rect[^>]*fill="#fff"/); // white background
  assert.match(svg, /<path d="M[^"]+" fill="#000"\/>/); // dark modules
});

test("GET /api/links/:code/qr for an unknown code returns 404", async () => {
  const res = await fetch(`${base}/api/links/does-not-exist/qr`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "link not found");
});

test("landing page offers a QR code button after shortening", async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /Show QR code/);
  assert.match(html, /\/api\/links\/'\+d\.code\+'\/qr/);
});

test("qr.js: finder patterns, timing and dark module are in place", () => {
  const qr = makeQr("http://localhost:3000/aB3xK9");
  assert.equal(qr.version, 2);
  assert.equal(qr.size, 25);
  const { modules: m } = qr;
  // Top-left finder: 7x7 ring + solid 3x3 centre, light separator around it.
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const edge = r === 0 || r === 6 || c === 0 || c === 6;
      const centre = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      assert.equal(m[r][c], edge || centre, `finder (${r},${c})`);
    }
  }
  assert.equal(m[7][0], false); // separator row below the finder
  assert.equal(m[0][7], false); // separator column beside the finder
  // Timing pattern: row 6 and column 6 alternate, starting dark.
  // (Row 6, column 8 is a format cell, so the row check starts at 9.)
  for (let i = 9; i < 17; i++) {
    assert.equal(m[6][i], i % 2 === 0, `timing row (6,${i})`);
    assert.equal(m[i][6], i % 2 === 0, `timing col (${i},6)`);
  }
  // Dark module, and the single version-2 alignment pattern.
  assert.equal(m[17][8], true);
  assert.equal(m[18][18], true); // centre
  assert.equal(m[16][18], true); // top edge
  assert.equal(m[18][16], true); // left edge
  assert.equal(m[20][18], true); // bottom edge
  assert.equal(m[17][18], false); // inner ring is light
  assert.equal(m[18][17], false);
});

test("qr.js: format information reads back as EC level L + chosen mask", () => {
  const qr = makeQr("http://localhost:3000/aB3xK9");
  const fmt = readFormat(qr);
  assert.equal(fmt, formatBits(qr.mask));
  const unmasked = fmt ^ 0x5412; // strip the format mask pattern
  assert.equal(unmasked >> 13, 0b01); // EC level L
  assert.equal((unmasked >> 10) & 0b111, qr.mask);
});

test("qr.js: version grows with payload, and over-long text throws", () => {
  assert.equal(makeQr("hi").version, 1);
  assert.equal(makeQr("http://localhost:3000/" + "a".repeat(60)).version, 5);
  assert.equal(makeQr("http://localhost:3000/" + "b".repeat(120)).version, 7);
  assert.equal(makeQr("x".repeat(MAX_BYTES)).version, 10);
  assert.throws(() => qrSvg("x".repeat(MAX_BYTES + 1)), /too long/);
});

test("qr.js: SVG has a quiet zone and scales with the version", () => {
  const small = qrSvg("hi");
  assert.match(small.svg, /viewBox="0 0 29 29"/); // version 1: 21 + 8
  assert.equal(small.version, 1);
  const big = qrSvg("x".repeat(MAX_BYTES));
  assert.match(big.svg, /viewBox="0 0 65 65"/); // version 10: 57 + 8
  assert.equal(big.version, 10);
});
