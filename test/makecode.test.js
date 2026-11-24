/* Short-code generator tests — node:test, zero dependencies.
   makeCode must always return a 6-character code from the allowed
   alphabet, and repeated calls must not collide. Run with:
   npm test (or: node --test test/) */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeCode } = require("../server");

const CODE_RE = /^[A-Za-z0-9]{6}$/;

test("makeCode returns a 6-character code from the allowed alphabet", () => {
  for (let i = 0; i < 100; i++) assert.match(makeCode(), CODE_RE);
});

test("makeCode does not repeat a code across 1000 generations", () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const code = makeCode();
    assert(!seen.has(code), `duplicate code generated: ${code}`);
    seen.add(code);
  }
});
