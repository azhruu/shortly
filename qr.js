/* Shortly — dependency-free QR Code generator (byte mode, EC level L).
   Encodes a short URL into a QR matrix and renders it as SVG, so the
   landing page can show a scannable code with no external service and
   no npm install. Implements ISO/IEC 18004: version selection, byte
   mode data encoding, Reed-Solomon error correction over GF(256),
   function patterns, all 8 masks with penalty scoring, format and
   version information. Supports versions 1-10 (up to 271 bytes). */
"use strict";

/* ---- Reed-Solomon over GF(256), primitive polynomial 0x11D ---- */
const EXP = new Array(512);
const LOG = new Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}
/* Generator polynomial of given degree: prod_{i=0}^{deg-1} (x - a^i).
   Returned as coefficients, highest degree first (leading 1 included),
   so the remainder step can use gen[1..deg] as the divisor. */
function rsGenerator(deg) {
  let poly = [1]; // built lowest-degree first, reversed at the end
  for (let i = 0; i < deg; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly.reverse();
}
/* Remainder of data(x) * x^deg divided by the generator: the EC bytes. */
function rsRemainder(data, deg) {
  const gen = rsGenerator(deg);
  const out = new Array(deg).fill(0);
  for (const byte of data) {
    const factor = byte ^ out[0];
    out.shift();
    out.push(0);
    for (let i = 0; i < deg; i++) out[i] ^= gfMul(gen[i + 1], factor);
  }
  return out;
}

/* ---- Version table, EC level L (from ISO/IEC 18004) ---- */
/* total codewords, EC codewords per block, block count, data codewords
   per block (v10 splits 2x68 + 2x69), alignment pattern centres. */
const VERSIONS = [
  null,
  { total: 26, ec: 7, blocks: [19], align: [] },
  { total: 44, ec: 10, blocks: [34], align: [6, 18] },
  { total: 70, ec: 15, blocks: [55], align: [6, 22] },
  { total: 100, ec: 20, blocks: [80], align: [6, 26] },
  { total: 134, ec: 26, blocks: [108], align: [6, 30] },
  { total: 172, ec: 18, blocks: [68, 68], align: [6, 34] },
  { total: 196, ec: 20, blocks: [78, 78], align: [6, 22, 38] },
  { total: 242, ec: 24, blocks: [97, 97], align: [6, 24, 42] },
  { total: 292, ec: 30, blocks: [116, 116], align: [6, 26, 46] },
  { total: 346, ec: 18, blocks: [68, 68, 69, 69], align: [6, 28, 50] },
];
const MAX_BYTES = 271; // version 10-L byte mode payload

function bitLength(n) {
  return n === 0 ? 0 : 32 - Math.clz32(n);
}

/* Encode the payload into the interleaved codeword stream for the
   smallest version that fits. Returns { version, codewords }. */
function encodeData(bytes) {
  for (let version = 1; version <= 10; version++) {
    const info = VERSIONS[version];
    const dataLen = info.blocks.reduce((a, b) => a + b, 0);
    const countBits = version < 10 ? 8 : 16;
    const capacityBits = dataLen * 8;
    const neededBits = 4 + countBits + bytes.length * 8;
    if (neededBits > capacityBits) continue;

    const bits = [];
    const push = (value, length) => {
      for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    };
    push(0b0100, 4); // byte mode
    push(bytes.length, countBits);
    for (const b of bytes) push(b, 8);
    push(0, Math.min(4, capacityBits - bits.length)); // terminator
    while (bits.length % 8 !== 0) bits.push(0); // pad to a byte
    const pads = [0xec, 0x11];
    let pi = 0;
    while (bits.length < capacityBits) push(pads[pi++ % 2], 8);

    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
      data.push(byte);
    }
    /* Split into blocks, add EC bytes per block, then interleave:
       data codewords column-wise, then EC codewords column-wise. */
    const blocks = [];
    let offset = 0;
    for (const len of info.blocks) {
      const chunk = data.slice(offset, offset + len);
      offset += len;
      blocks.push({ data: chunk, ec: rsRemainder(chunk, info.ec) });
    }
    const codewords = [];
    const maxData = Math.max(...info.blocks);
    for (let i = 0; i < maxData; i++) {
      for (const b of blocks) if (i < b.data.length) codewords.push(b.data[i]);
    }
    for (let i = 0; i < info.ec; i++) {
      for (const b of blocks) codewords.push(b.ec[i]);
    }
    return { version, codewords };
  }
  throw new Error(`text too long for a QR code (${bytes.length} bytes, max ${MAX_BYTES})`);
}

/* ---- Matrix construction ---- */
function maskApplies(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: throw new Error(`bad mask ${mask}`);
  }
}

/* Format information: 5 data bits (EC level L = 01, plus mask) with a
   10-bit BCH remainder, XORed with the mask pattern 0x5412. */
function formatBits(mask) {
  let data = (0b01 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
/* Version information (versions 7+): 6 data bits + 12-bit BCH remainder. */
function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

function buildMatrix(version, codewords, mask) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r, c, value, fn = true) => {
    modules[r][c] = value;
    if (fn) isFunction[r][c] = true;
  };

  // Timing patterns (row 6 / column 6), drawn before the finders so
  // the finders win where the two overlap.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // Finder patterns (7x7) + separators in the three corners.
  const finder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr, c = c0 + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const onBorder = dr === -1 || dr === 7 || dc === -1 || dc === 7;
        const dark = !onBorder && (
          dr === 0 || dr === 6 || dc === 0 || dc === 6 ||
          (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        set(r, c, dark && !onBorder);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // Alignment patterns (5x5, centred on each pair of centres).
  // Only the three patterns that would overlap a finder pattern are
  // skipped (top-left, top-right, bottom-left corners). Patterns
  // centred on the timing row/column ARE drawn, overwriting the
  // timing modules there — they are function modules, not data.
  const centres = VERSIONS[version].align;
  const lastCentre = centres[centres.length - 1];
  for (const r of centres) {
    for (const c of centres) {
      if ((r === 6 && c === 6) || (r === 6 && c === lastCentre) ||
          (r === lastCentre && c === 6)) continue; // overlaps a finder
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }
  // Dark module.
  set(4 * version + 9, 8, true);
  // Version information (v7+).
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, bit);
      set(b, a, bit);
    }
  }

  // Format information, drawn twice (once near each corner pair).
  // Bit 0 at (0,8), up to bit 7 at (8,8), then bit 8 at (8,7) and
  // bit 14 (MSB) at (8,0). Second copy mirrors it along row 8
  // (bits 0-7) and column 8 (bits 8-14) at the far corner.
  // Drawn BEFORE the data goes in, so the format cells are reserved
  // as function modules and no data bit is ever placed in them.
  const fmt = formatBits(mask);
  const bit = (i) => ((fmt >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(i, 8, bit(i));
  set(7, 8, bit(6));
  set(8, 8, bit(7));
  set(8, 7, bit(8));
  for (let i = 9; i < 15; i++) set(8, 14 - i, bit(i));
  for (let i = 0; i < 8; i++) set(8, size - 1 - i, bit(i));
  for (let i = 8; i < 15; i++) set(size - 15 + i, 8, bit(i));
  set(size - 8, 8, true); // dark module

  // Data codewords, zig-zag up the columns in pairs, skipping col 6.
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (isFunction[r][c] || bitIndex >= codewords.length * 8) continue;
        const bit = (codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1;
        modules[r][c] = bit === 1;
        bitIndex++;
      }
    }
  }

  // Mask: flip every non-function module where the pattern applies.
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isFunction[r][c] && maskApplies(mask, r, c)) modules[r][c] = !modules[r][c];
    }
  }
  return { size, modules };
}

/* ---- Mask penalty scoring (ISO/IEC 18004) ---- */
function penalty(modules) {
  const size = modules.length;
  let score = 0;
  // Rule 1: runs of 5+ same-colour modules in any row or column.
  const runPenalty = (line) => {
    let run = 1, prev = line[0];
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === prev) { run++; continue; }
      if (run >= 5) score += 3 + (run - 5);
      run = 1; prev = line[i];
    }
  };
  for (let r = 0; r < size; r++) runPenalty(modules[r]);
  for (let c = 0; c < size; c++) runPenalty(modules.map((row) => row[c]));
  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) score += 3;
    }
  }
  // Rule 3: finder-like patterns 10111010000 / 00001011101.
  const patternPenalty = (line) => {
    for (let i = 0; i + 11 <= line.length; i++) {
      const slice = line.slice(i, i + 11).map((b) => (b ? "1" : "0")).join("");
      if (slice === "10111010000" || slice === "00001011101") score += 40;
    }
  };
  for (let r = 0; r < size; r++) patternPenalty(modules[r]);
  for (let c = 0; c < size; c++) patternPenalty(modules.map((row) => row[c]));
  // Rule 4: dark-module proportion straying from 50%.
  let dark = 0;
  for (const row of modules) for (const v of row) if (v) dark++;
  const total = size * size;
  score += Math.floor(Math.abs((dark * 20) / total - 10)) * 10;
  return score;
}

/* Encode text to a QR matrix, trying every mask and keeping the
   lowest-penalty one. Returns { version, size, mask, modules }. */
function makeQr(text) {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length > MAX_BYTES) {
    throw new Error(`text too long for a QR code (${bytes.length} bytes, max ${MAX_BYTES})`);
  }
  const { version, codewords } = encodeData(bytes);
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = buildMatrix(version, codewords, mask);
    const score = penalty(candidate.modules);
    if (!best || score < best.score) best = { ...candidate, mask, score };
  }
  return { version, size: best.size, mask: best.mask, modules: best.modules };
}

/* Render a QR matrix as SVG (4-module quiet zone, 1 unit per module). */
function toSvg(qr) {
  const quiet = 4;
  const side = qr.size + quiet * 2;
  let path = "";
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.modules[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${side}" height="${side}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

/* One call: text in, SVG out. */
function qrSvg(text) {
  const qr = makeQr(text);
  return { svg: toSvg(qr), version: qr.version, size: qr.size, mask: qr.mask };
}

module.exports = { makeQr, qrSvg, encodeData, formatBits, versionBits, MAX_BYTES };
