"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  capacity: () => capacity,
  decode: () => decode,
  encode: () => encode
});
module.exports = __toCommonJS(index_exports);

// src/encode.ts
var import_node_zlib2 = require("zlib");

// src/types.ts
var BITS_PER_CELL = {
  rgba64: 64,
  rgba32: 32,
  rgb48: 48,
  rgb24: 24
};
var BYTES_PER_CELL = {
  rgba64: 8,
  rgba32: 4,
  rgb48: 6,
  rgb24: 3
};
var BIT_DEPTH = {
  rgba64: 16,
  rgba32: 8,
  rgb48: 16,
  rgb24: 8
};
var EC_RATIO = {
  L: 0.07,
  M: 0.15,
  Q: 0.25,
  H: 0.3
};
var MODE_ID = {
  rgba64: 0,
  rgba32: 1,
  rgb48: 2,
  rgb24: 3
};
var ID_TO_MODE = {
  0: "rgba64",
  1: "rgba32",
  2: "rgb48",
  3: "rgb24"
};
var EC_ID = {
  L: 0,
  M: 1,
  Q: 2,
  H: 3
};
var ID_TO_EC = {
  0: "L",
  1: "M",
  2: "Q",
  3: "H"
};
var FINDER_SIZE = 7;
var ALIGNMENT_SIZE = 5;
var QUIET_ZONE = 1;
var MIN_GRID_SIZE = FINDER_SIZE * 2 + 2;
var MAX_GRID_SIZE = 4095;
var PROTOCOL_VERSION = 1;
var MAX_CELL_SIZE = 32;
var RS_MAX_BLOCK = 255;
var DEFAULT_OPTIONS = {
  mode: "rgba64",
  cellSize: 1,
  ecLevel: "L",
  compress: false
};

// src/gf256.ts
var EXP = new Uint8Array(512);
var LOG = new Uint8Array(256);
var x = 1;
for (let i = 0; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x = x << 1;
  if (x & 256) {
    x ^= 285;
  }
}
for (let i = 255; i < 512; i++) {
  EXP[i] = EXP[i - 255];
}
function add(a, b) {
  return a ^ b;
}
function mul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}
function polyMul(a, b) {
  const result = new Uint8Array(a.length + b.length - 1);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      result[i + j] = add(result[i + j], mul(a[i], b[j]));
    }
  }
  return result;
}

// src/reed-solomon.ts
function generatorPoly(ecSymbols) {
  let g = new Uint8Array([1]);
  for (let i = 0; i < ecSymbols; i++) {
    g = polyMul(g, new Uint8Array([1, EXP[i]]));
  }
  return g;
}
function rsEncode(data, ecCount) {
  const gen = generatorPoly(ecCount);
  const result = new Uint8Array(data.length + ecCount);
  result.set(data);
  const feedback = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i++) {
    const coeff = add(data[i], feedback[0]);
    feedback.copyWithin(0, 1);
    feedback[ecCount - 1] = 0;
    if (coeff !== 0) {
      for (let j = 0; j < ecCount; j++) {
        feedback[j] = add(feedback[j], mul(coeff, gen[j + 1]));
      }
    }
  }
  result.set(feedback, data.length);
  return result;
}
function computeSyndromes(received, ecCount) {
  const synd = new Array(ecCount);
  for (let i = 0; i < ecCount; i++) {
    const a = EXP[i];
    let val = 0;
    for (let j = 0; j < received.length; j++) {
      val = add(mul(val, a), received[j]);
    }
    synd[i] = val;
  }
  return synd;
}
function berlekampMassey(synd, ecCount) {
  const C = [1];
  let B = [1];
  let L = 0;
  let m = 1;
  let b = 1;
  for (let n = 0; n < ecCount; n++) {
    let d = synd[n];
    for (let i = 1; i < C.length; i++) {
      d = add(d, mul(C[i], synd[n - i]));
    }
    if (d === 0) {
      m++;
      continue;
    }
    const T = C.slice();
    const coeff = mul(d, EXP[(255 - LOG[b]) % 255]);
    const needed = B.length + m;
    while (C.length < needed) C.push(0);
    for (let i = 0; i < B.length; i++) {
      C[i + m] = add(C[i + m], mul(coeff, B[i]));
    }
    if (2 * L <= n) {
      L = n + 1 - L;
      B = T;
      b = d;
      m = 1;
    } else {
      m++;
    }
  }
  return C;
}
function chienSearch(lambda, n) {
  const positions = [];
  const degree = lambda.length - 1;
  for (let p = 0; p < n; p++) {
    const exp = ((p - n + 1) % 255 + 255) % 255;
    const x2 = exp === 0 ? 1 : EXP[exp];
    let val = lambda[0];
    let xPow = 1;
    for (let j = 1; j < lambda.length; j++) {
      xPow = mul(xPow, x2);
      val = add(val, mul(lambda[j], xPow));
    }
    if (val === 0) {
      positions.push(p);
    }
  }
  if (positions.length !== degree) {
    throw new Error(
      `Chien search found ${positions.length} roots but expected ${degree} \u2014 uncorrectable errors`
    );
  }
  return positions;
}
function forney(synd, lambda, positions, n, ecCount) {
  const omega = new Array(ecCount).fill(0);
  for (let i = 0; i < ecCount; i++) {
    for (let j = 0; j < lambda.length && j <= i; j++) {
      omega[i] = add(omega[i], mul(lambda[j], synd[i - j]));
    }
  }
  const lp = [];
  for (let j = 1; j < lambda.length; j += 2) {
    while (lp.length < j) lp.push(0);
    lp[j - 1] = lambda[j];
  }
  if (lp.length === 0) lp.push(0);
  const magnitudes = new Array(positions.length);
  for (let k = 0; k < positions.length; k++) {
    const p = positions[k];
    const xpExp = (n - 1 - p) % 255;
    const Xp = xpExp === 0 ? 1 : EXP[xpExp];
    const xpInvExp = ((p - n + 1) % 255 + 255) % 255;
    const XpInv = xpInvExp === 0 ? 1 : EXP[xpInvExp];
    let omegaVal = 0;
    let xPow = 1;
    for (let i = 0; i < omega.length; i++) {
      omegaVal = add(omegaVal, mul(omega[i], xPow));
      xPow = mul(xPow, XpInv);
    }
    let lpVal = 0;
    xPow = 1;
    for (let i = 0; i < lp.length; i++) {
      lpVal = add(lpVal, mul(lp[i] || 0, xPow));
      xPow = mul(xPow, XpInv);
    }
    if (lpVal === 0) {
      throw new Error("Forney: lambda prime evaluates to zero \u2014 uncorrectable");
    }
    magnitudes[k] = mul(Xp, mul(omegaVal, EXP[(255 - LOG[lpVal]) % 255]));
  }
  return magnitudes;
}
function rsDecode(received, ecCount) {
  const n = received.length;
  const dataLen = n - ecCount;
  const synd = computeSyndromes(received, ecCount);
  if (synd.every((s) => s === 0)) {
    return received.slice(0, dataLen);
  }
  const lambda = berlekampMassey(synd, ecCount);
  const numErrors = lambda.length - 1;
  if (numErrors === 0) {
    throw new Error("BM found no errors but syndromes non-zero");
  }
  if (numErrors > Math.floor(ecCount / 2)) {
    throw new Error(
      `Too many errors (${numErrors}) for EC capacity (max ${Math.floor(ecCount / 2)})`
    );
  }
  const positions = chienSearch(lambda, n);
  const magnitudes = forney(synd, lambda, positions, n, ecCount);
  const corrected = new Uint8Array(received);
  for (let i = 0; i < positions.length; i++) {
    corrected[positions[i]] = add(corrected[positions[i]], magnitudes[i]);
  }
  const checkSynd = computeSyndromes(corrected, ecCount);
  if (!checkSynd.every((s) => s === 0)) {
    throw new Error("Reed-Solomon correction failed verification");
  }
  return corrected.slice(0, dataLen);
}
function ecSymbolCount(dataLen, ecRatio) {
  const ec = Math.ceil(dataLen * ecRatio / (1 - ecRatio));
  return Math.max(2, ec);
}

// src/interleave.ts
function interleave(blocks) {
  if (blocks.length === 0) return new Uint8Array(0);
  if (blocks.length === 1) return blocks[0];
  const maxLen = Math.max(...blocks.map((b) => b.length));
  const total = blocks.reduce((sum, b) => sum + b.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (let i = 0; i < maxLen; i++) {
    for (const block of blocks) {
      if (i < block.length) {
        result[pos++] = block[i];
      }
    }
  }
  return result;
}
function deinterleave(stream, blockSizes) {
  if (blockSizes.length === 0) return [];
  if (blockSizes.length === 1) return [stream.slice()];
  const blocks = blockSizes.map((size) => new Uint8Array(size));
  const cursors = new Array(blockSizes.length).fill(0);
  const maxLen = Math.max(...blockSizes);
  let pos = 0;
  for (let i = 0; i < maxLen; i++) {
    for (let b = 0; b < blocks.length; b++) {
      if (i < blockSizes[b]) {
        blocks[b][cursors[b]++] = stream[pos++];
      }
    }
  }
  return blocks;
}

// src/crc32.ts
var TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
  }
  TABLE[i] = c;
}
function crc32(data) {
  let crc = 4294967295;
  for (let i = 0; i < data.length; i++) {
    crc = TABLE[(crc ^ data[i]) & 255] ^ crc >>> 8;
  }
  return (crc ^ 4294967295) >>> 0;
}
function crc32Multi(...buffers) {
  let crc = 4294967295;
  for (const data of buffers) {
    for (let i = 0; i < data.length; i++) {
      crc = TABLE[(crc ^ data[i]) & 255] ^ crc >>> 8;
    }
  }
  return (crc ^ 4294967295) >>> 0;
}

// src/grid.ts
var FINDER_COLORS_8 = [
  [79, 70, 229],
  // Layer 0 — outermost
  [255, 255, 255],
  // Layer 1
  [124, 58, 237],
  // Layer 2
  [79, 70, 229]
  // Layer 3 — center
];
var FINDER_COLORS_16 = FINDER_COLORS_8.map(
  (c) => c.map((v) => v * 257)
);
function generateFinderPixels(bitDepth) {
  const bpp = bitDepth === 16 ? 8 : 4;
  const pixels = new Uint8Array(FINDER_SIZE * FINDER_SIZE * bpp);
  const colors = bitDepth === 16 ? FINDER_COLORS_16 : FINDER_COLORS_8;
  const alphaMax = bitDepth === 16 ? 65535 : 255;
  for (let y = 0; y < FINDER_SIZE; y++) {
    for (let x2 = 0; x2 < FINDER_SIZE; x2++) {
      const distFromEdge = Math.min(x2, y, FINDER_SIZE - 1 - x2, FINDER_SIZE - 1 - y);
      const layer = Math.min(distFromEdge, 3);
      const color = colors[layer];
      const offset = (y * FINDER_SIZE + x2) * bpp;
      if (bitDepth === 16) {
        const view = new DataView(pixels.buffer, offset, 8);
        view.setUint16(0, color[0]);
        view.setUint16(2, color[1]);
        view.setUint16(4, color[2]);
        view.setUint16(6, alphaMax);
      } else {
        pixels[offset] = color[0];
        pixels[offset + 1] = color[1];
        pixels[offset + 2] = color[2];
        pixels[offset + 3] = alphaMax;
      }
    }
  }
  return pixels;
}
function generateAlignmentPixels(bitDepth) {
  const bpp = bitDepth === 16 ? 8 : 4;
  const pixels = new Uint8Array(ALIGNMENT_SIZE * ALIGNMENT_SIZE * bpp);
  const colors = bitDepth === 16 ? FINDER_COLORS_16 : FINDER_COLORS_8;
  const alphaMax = bitDepth === 16 ? 65535 : 255;
  for (let y = 0; y < ALIGNMENT_SIZE; y++) {
    for (let x2 = 0; x2 < ALIGNMENT_SIZE; x2++) {
      const distFromEdge = Math.min(x2, y, ALIGNMENT_SIZE - 1 - x2, ALIGNMENT_SIZE - 1 - y);
      const layer = Math.min(distFromEdge, 3);
      const color = colors[layer];
      const offset = (y * ALIGNMENT_SIZE + x2) * bpp;
      if (bitDepth === 16) {
        const view = new DataView(pixels.buffer, offset, 8);
        view.setUint16(0, color[0]);
        view.setUint16(2, color[1]);
        view.setUint16(4, color[2]);
        view.setUint16(6, alphaMax);
      } else {
        pixels[offset] = color[0];
        pixels[offset + 1] = color[1];
        pixels[offset + 2] = color[2];
        pixels[offset + 3] = alphaMax;
      }
    }
  }
  return pixels;
}
function allocateGrid(width, height) {
  const cells = Array.from(
    { length: height },
    () => new Array(width).fill("data")
  );
  for (let y = 0; y < FINDER_SIZE; y++) {
    for (let x2 = 0; x2 < FINDER_SIZE; x2++) {
      cells[y][x2] = "finder";
    }
  }
  for (let y = 0; y < FINDER_SIZE; y++) {
    for (let x2 = width - FINDER_SIZE; x2 < width; x2++) {
      cells[y][x2] = "finder";
    }
  }
  for (let y = height - FINDER_SIZE; y < height; y++) {
    for (let x2 = 0; x2 < FINDER_SIZE; x2++) {
      cells[y][x2] = "finder";
    }
  }
  for (let y = height - ALIGNMENT_SIZE; y < height; y++) {
    for (let x2 = width - ALIGNMENT_SIZE; x2 < width; x2++) {
      cells[y][x2] = "alignment";
    }
  }
  for (let x2 = FINDER_SIZE; x2 < width - FINDER_SIZE; x2++) {
    cells[FINDER_SIZE][x2] = "timing";
  }
  for (let y = FINDER_SIZE; y < height - FINDER_SIZE; y++) {
    cells[y][FINDER_SIZE] = "timing";
  }
  const allDataCoords = [];
  for (let y = 0; y < height; y++) {
    if (y % 2 === 0) {
      for (let x2 = 0; x2 < width; x2++) {
        if (cells[y][x2] === "data") {
          allDataCoords.push([x2, y]);
        }
      }
    } else {
      for (let x2 = width - 1; x2 >= 0; x2--) {
        if (cells[y][x2] === "data") {
          allDataCoords.push([x2, y]);
        }
      }
    }
  }
  return {
    width,
    height,
    cells,
    dataCoords: allDataCoords,
    headerCoords: []
    // Filled by encoder based on header size
  };
}
function encodeHeader(meta) {
  const hasSeq = meta.sequence !== void 0;
  const size = hasSeq ? 18 : 14;
  const buf = new Uint8Array(size);
  const view = new DataView(buf.buffer);
  buf[0] = (meta.version & 15) << 4 | MODE_ID[meta.mode] & 15;
  buf[1] = (EC_ID[meta.ecLevel] & 3) << 6 | (hasSeq ? 32 : 0) | (meta.compressed ? 16 : 0);
  const gw = meta.gridWidth & 4095;
  const gh = meta.gridHeight & 4095;
  buf[2] = gw >> 4 & 255;
  buf[3] = (gw & 15) << 4 | gh >> 8 & 15;
  buf[4] = gh & 255;
  view.setUint32(5, meta.dataLength);
  let offset = 9;
  if (hasSeq) {
    const seq = meta.sequence;
    view.setUint16(offset, seq.id);
    offset += 2;
    buf[offset++] = seq.index;
    buf[offset] = seq.total;
  }
  const crcData = buf.subarray(0, size - 2);
  const crc = crc32(crcData) & 65535;
  view.setUint16(size - 2, crc);
  return buf;
}
function decodeHeader(buf) {
  if (buf.length < 14) {
    throw new Error(`Header too short: ${buf.length} bytes (need at least 14)`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const version = buf[0] >> 4 & 15;
  const modeId = buf[0] & 15;
  const ecId = buf[1] >> 6 & 3;
  const hasSeq = (buf[1] & 32) !== 0;
  const compressed = (buf[1] & 16) !== 0;
  const expectedSize = hasSeq ? 18 : 14;
  if (buf.length < expectedSize) {
    throw new Error(`Header too short for sequence data: ${buf.length} < ${expectedSize}`);
  }
  const crcData = buf.subarray(0, expectedSize - 2);
  const expectedCrc = crc32(crcData) & 65535;
  const actualCrc = view.getUint16(expectedSize - 2);
  if (expectedCrc !== actualCrc) {
    throw new Error(`Header CRC mismatch: expected ${expectedCrc}, got ${actualCrc}`);
  }
  const gridWidth = (buf[2] << 4 | buf[3] >> 4) & 4095;
  const gridHeight = ((buf[3] & 15) << 8 | buf[4]) & 4095;
  const dataLength = view.getUint32(5);
  const mode = ID_TO_MODE[modeId];
  const ecLevel = ID_TO_EC[ecId];
  if (!mode) throw new Error(`Unknown mode ID: ${modeId}`);
  if (!ecLevel) throw new Error(`Unknown EC level ID: ${ecId}`);
  const result = {
    version,
    mode,
    ecLevel,
    compressed,
    gridWidth,
    gridHeight,
    dataLength
  };
  if (hasSeq) {
    result.sequence = {
      id: view.getUint16(9),
      index: buf[11],
      total: buf[12]
    };
  }
  return result;
}
function headerSize(hasSequence) {
  return hasSequence ? 18 : 14;
}
function structuralCellCount(width, height) {
  const finders = 3 * FINDER_SIZE * FINDER_SIZE;
  const alignment = ALIGNMENT_SIZE * ALIGNMENT_SIZE;
  const hTiming = Math.max(0, width - 2 * FINDER_SIZE);
  const vTiming = Math.max(0, height - 2 * FINDER_SIZE);
  const timingTotal = Math.max(0, hTiming + vTiming - 1);
  return finders + alignment + timingTotal;
}
function dataCellCount(width, height) {
  return width * height - structuralCellCount(width, height);
}
function timingCellPixel(index, bitDepth) {
  const bpp = bitDepth === 16 ? 8 : 4;
  const pixel = new Uint8Array(bpp);
  const isDark = index % 2 === 0;
  const colors = bitDepth === 16 ? FINDER_COLORS_16 : FINDER_COLORS_8;
  const color = isDark ? colors[0] : colors[1];
  const alphaMax = bitDepth === 16 ? 65535 : 255;
  if (bitDepth === 16) {
    const view = new DataView(pixel.buffer);
    view.setUint16(0, color[0]);
    view.setUint16(2, color[1]);
    view.setUint16(4, color[2]);
    view.setUint16(6, alphaMax);
  } else {
    pixel[0] = color[0];
    pixel[1] = color[1];
    pixel[2] = color[2];
    pixel[3] = alphaMax;
  }
  return pixel;
}

// src/auto-size.ts
function usableCapacity(width, height, mode, ecLevel, hasSequence) {
  const totalDataCells = dataCellCount(width, height);
  const bytesPerCell = BYTES_PER_CELL[mode];
  const hdrSize = headerSize(hasSequence);
  const headerCells = Math.ceil(hdrSize / bytesPerCell);
  const remainingCells = totalDataCells - headerCells;
  if (remainingCells <= 0) return 0;
  const totalRawBytes = remainingCells * bytesPerCell;
  const ecRatio = EC_RATIO[ecLevel];
  let dataPerBlock;
  for (dataPerBlock = RS_MAX_BLOCK - 2; dataPerBlock >= 1; dataPerBlock--) {
    const ec = ecSymbolCount(dataPerBlock, ecRatio);
    if (dataPerBlock + ec <= RS_MAX_BLOCK) break;
  }
  const ecPerBlock = ecSymbolCount(dataPerBlock, ecRatio);
  const blockTotal = dataPerBlock + ecPerBlock;
  const numBlocks = Math.floor(totalRawBytes / blockTotal);
  if (numBlocks <= 0) {
    const ec = ecSymbolCount(Math.max(1, totalRawBytes), ecRatio);
    return Math.max(0, totalRawBytes - ec);
  }
  let capacity2 = numBlocks * dataPerBlock;
  const remaining = totalRawBytes - numBlocks * blockTotal;
  if (remaining > 0) {
    const partialEc = ecSymbolCount(remaining, ecRatio);
    capacity2 += Math.max(0, remaining - partialEc);
  }
  return capacity2;
}
function autoSize(dataLength, mode, ecLevel, hasSequence) {
  if (dataLength === 0) {
    const hdrSize = headerSize(hasSequence);
    const bytesPerCell = BYTES_PER_CELL[mode];
    const headerCells = Math.ceil(hdrSize / bytesPerCell);
    for (let size = MIN_GRID_SIZE; size <= MAX_GRID_SIZE; size++) {
      if (dataCellCount(size, size) >= headerCells) {
        return { width: size, height: size };
      }
    }
  }
  for (let size = MIN_GRID_SIZE; size <= MAX_GRID_SIZE; size++) {
    const cap = usableCapacity(size, size, mode, ecLevel, hasSequence);
    if (cap >= dataLength) {
      return { width: size, height: size };
    }
  }
  throw new Error(`Data too large (${dataLength} bytes) \u2014 exceeds maximum grid capacity`);
}

// src/channels.ts
function encodeCell(data, mode) {
  const depth = BIT_DEPTH[mode];
  if (depth === 16) {
    const pixel = new Uint8Array(8);
    const view = new DataView(pixel.buffer);
    if (mode === "rgba64") {
      view.setUint16(0, data[0] << 8 | data[1]);
      view.setUint16(2, data[2] << 8 | data[3]);
      view.setUint16(4, data[4] << 8 | data[5]);
      view.setUint16(6, data[6] << 8 | data[7]);
    } else {
      view.setUint16(0, data[0] << 8 | data[1]);
      view.setUint16(2, data[2] << 8 | data[3]);
      view.setUint16(4, data[4] << 8 | data[5]);
      view.setUint16(6, 65535);
    }
    return pixel;
  } else {
    const pixel = new Uint8Array(4);
    if (mode === "rgba32") {
      pixel[0] = data[0];
      pixel[1] = data[1];
      pixel[2] = data[2];
      pixel[3] = data[3];
    } else {
      pixel[0] = data[0];
      pixel[1] = data[1];
      pixel[2] = data[2];
      pixel[3] = 255;
    }
    return pixel;
  }
}
function decodeCell(pixel, mode) {
  const depth = BIT_DEPTH[mode];
  const bytesPerCell = BYTES_PER_CELL[mode];
  const result = new Uint8Array(bytesPerCell);
  if (depth === 16) {
    const view = new DataView(pixel.buffer, pixel.byteOffset, pixel.byteLength);
    if (mode === "rgba64") {
      const r = view.getUint16(0);
      const g = view.getUint16(2);
      const b = view.getUint16(4);
      const a = view.getUint16(6);
      result[0] = r >> 8 & 255;
      result[1] = r & 255;
      result[2] = g >> 8 & 255;
      result[3] = g & 255;
      result[4] = b >> 8 & 255;
      result[5] = b & 255;
      result[6] = a >> 8 & 255;
      result[7] = a & 255;
    } else {
      const r = view.getUint16(0);
      const g = view.getUint16(2);
      const b = view.getUint16(4);
      result[0] = r >> 8 & 255;
      result[1] = r & 255;
      result[2] = g >> 8 & 255;
      result[3] = g & 255;
      result[4] = b >> 8 & 255;
      result[5] = b & 255;
    }
  } else {
    if (mode === "rgba32") {
      result[0] = pixel[0];
      result[1] = pixel[1];
      result[2] = pixel[2];
      result[3] = pixel[3];
    } else {
      result[0] = pixel[0];
      result[1] = pixel[1];
      result[2] = pixel[2];
    }
  }
  return result;
}

// src/png.ts
var import_node_zlib = require("zlib");
var PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
function writeChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const length = data.length;
  const chunk = new Uint8Array(12 + length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  const crc = crc32Multi(typeBytes, data);
  view.setUint32(8 + length, crc);
  return chunk;
}
function writePng(pixels, width, height, bitDepth = 16) {
  const bytesPerPixel = bitDepth === 16 ? 8 : 4;
  const expectedSize = width * height * bytesPerPixel;
  if (pixels.length !== expectedSize) {
    throw new Error(
      `Pixel data size mismatch: got ${pixels.length}, expected ${expectedSize} (${width}x${height}x${bytesPerPixel})`
    );
  }
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = bitDepth;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const rowBytes = width * bytesPerPixel;
  const rawSize = height * (1 + rowBytes);
  const raw = new Uint8Array(rawSize);
  for (let y = 0; y < height; y++) {
    const rawOffset = y * (1 + rowBytes);
    raw[rawOffset] = 0;
    raw.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), rawOffset + 1);
  }
  const compressed = (0, import_node_zlib.deflateSync)(Buffer.from(raw));
  const ihdrChunk = writeChunk("IHDR", ihdr);
  const idatChunk = writeChunk("IDAT", new Uint8Array(compressed));
  const iendChunk = writeChunk("IEND", new Uint8Array(0));
  const totalSize = PNG_SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const png = new Uint8Array(totalSize);
  let offset = 0;
  png.set(PNG_SIGNATURE, offset);
  offset += PNG_SIGNATURE.length;
  png.set(ihdrChunk, offset);
  offset += ihdrChunk.length;
  png.set(idatChunk, offset);
  offset += idatChunk.length;
  png.set(iendChunk, offset);
  return png;
}
function readChunk(png, offset) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const length = view.getUint32(offset);
  const typeBytes = png.subarray(offset + 4, offset + 8);
  const type = new TextDecoder().decode(typeBytes);
  const data = png.subarray(offset + 8, offset + 8 + length);
  const storedCrc = view.getUint32(offset + 8 + length);
  const computedCrc = crc32Multi(typeBytes, data);
  if (storedCrc !== computedCrc) {
    throw new Error(`PNG chunk CRC mismatch in ${type} chunk`);
  }
  const nextOffset = offset + 12 + length;
  return { type, data, nextOffset };
}
function unfilter(raw, width, height, bytesPerPixel) {
  const rowBytes = width * bytesPerPixel;
  const pixels = new Uint8Array(width * height * bytesPerPixel);
  for (let y = 0; y < height; y++) {
    const rawRowStart = y * (1 + rowBytes);
    const filterType = raw[rawRowStart];
    const srcRow = raw.subarray(rawRowStart + 1, rawRowStart + 1 + rowBytes);
    const dstOffset = y * rowBytes;
    for (let x2 = 0; x2 < rowBytes; x2++) {
      const a = x2 >= bytesPerPixel ? pixels[dstOffset + x2 - bytesPerPixel] : 0;
      const b = y > 0 ? pixels[dstOffset - rowBytes + x2] : 0;
      const c = x2 >= bytesPerPixel && y > 0 ? pixels[dstOffset - rowBytes + x2 - bytesPerPixel] : 0;
      let val;
      switch (filterType) {
        case 0:
          val = srcRow[x2];
          break;
        case 1:
          val = srcRow[x2] + a & 255;
          break;
        case 2:
          val = srcRow[x2] + b & 255;
          break;
        case 3:
          val = srcRow[x2] + Math.floor((a + b) / 2) & 255;
          break;
        case 4:
          val = srcRow[x2] + paethPredictor(a, b, c) & 255;
          break;
        default:
          throw new Error(`Unknown PNG filter type: ${filterType}`);
      }
      pixels[dstOffset + x2] = val;
    }
  }
  return pixels;
}
function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
function readPng(png) {
  for (let i = 0; i < 8; i++) {
    if (png[i] !== PNG_SIGNATURE[i]) {
      throw new Error("Invalid PNG signature");
    }
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType;
  const idatChunks = [];
  while (offset < png.length) {
    const chunk = readChunk(png, offset);
    offset = chunk.nextOffset;
    if (chunk.type === "IHDR") {
      const view = new DataView(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);
      width = view.getUint32(0);
      height = view.getUint32(4);
      bitDepth = chunk.data[8];
      colorType = chunk.data[9];
      if (colorType !== 6) {
        throw new Error(`Unsupported PNG color type: ${colorType} (only RGBA/6 supported)`);
      }
      if (bitDepth !== 8 && bitDepth !== 16) {
        throw new Error(`Unsupported bit depth: ${bitDepth} (only 8 and 16 supported)`);
      }
    } else if (chunk.type === "IDAT") {
      idatChunks.push(chunk.data);
    } else if (chunk.type === "IEND") {
      break;
    }
  }
  if (width === 0 || height === 0) {
    throw new Error("Missing IHDR chunk");
  }
  if (idatChunks.length === 0) {
    throw new Error("Missing IDAT chunk");
  }
  const totalIdatLen = idatChunks.reduce((sum, c) => sum + c.length, 0);
  const compressedData = new Uint8Array(totalIdatLen);
  let pos = 0;
  for (const chunk of idatChunks) {
    compressedData.set(chunk, pos);
    pos += chunk.length;
  }
  const raw = new Uint8Array((0, import_node_zlib.inflateSync)(Buffer.from(compressedData)));
  const bytesPerPixel = bitDepth === 16 ? 8 : 4;
  const pixels = unfilter(raw, width, height, bytesPerPixel);
  return { pixels, width, height, bitDepth };
}

// src/encode.ts
function encode(data, options) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (opts.cellSize < 1 || opts.cellSize > MAX_CELL_SIZE) {
    throw new Error(`cellSize must be between 1 and ${MAX_CELL_SIZE}, got ${opts.cellSize}`);
  }
  const { mode, cellSize, ecLevel, compress, sequence } = opts;
  let payload = data;
  let isCompressed = false;
  if (compress && data.length > 0) {
    const compressed = new Uint8Array((0, import_node_zlib2.deflateSync)(Buffer.from(data)));
    if (compressed.length < data.length) {
      payload = compressed;
      isCompressed = true;
    }
  }
  const payloadLen = payload.length;
  const bytesPerCell = BYTES_PER_CELL[mode];
  const bitDepth = BIT_DEPTH[mode];
  const ecRatio = EC_RATIO[ecLevel];
  const hasSequence = sequence !== void 0;
  const totalDataBytes = payloadLen;
  let blocks;
  if (totalDataBytes === 0) {
    blocks = [];
  } else {
    let dataPerBlock;
    let ecCount;
    for (dataPerBlock = RS_MAX_BLOCK - 2; dataPerBlock >= 1; dataPerBlock--) {
      ecCount = ecSymbolCount(dataPerBlock, ecRatio);
      if (dataPerBlock + ecCount <= RS_MAX_BLOCK) break;
    }
    const numBlocks = Math.ceil(totalDataBytes / dataPerBlock);
    blocks = [];
    for (let i = 0; i < numBlocks; i++) {
      const start = i * dataPerBlock;
      const end = Math.min(start + dataPerBlock, totalDataBytes);
      const blockData = payload.slice(start, end);
      const blockEcCount = ecSymbolCount(blockData.length, ecRatio);
      const encoded = rsEncode(blockData, blockEcCount);
      blocks.push(encoded);
    }
  }
  const interleavedStream = interleave(blocks);
  const hdrSize = headerSize(hasSequence);
  const headerCells = Math.ceil(hdrSize / bytesPerCell);
  const dataCells = Math.ceil(interleavedStream.length / bytesPerCell);
  const neededDataCells = headerCells + dataCells;
  let gridWidth;
  let gridHeight;
  if (opts.width && opts.height) {
    gridWidth = opts.width;
    gridHeight = opts.height;
  } else {
    const auto = autoSize(payloadLen, mode, ecLevel, hasSequence);
    gridWidth = auto.width;
    gridHeight = auto.height;
  }
  const grid = allocateGrid(gridWidth, gridHeight);
  if (grid.dataCoords.length < neededDataCells) {
    throw new Error(
      `Grid too small: need ${neededDataCells} data cells but only ${grid.dataCoords.length} available. Try larger dimensions or smaller data.`
    );
  }
  const headerCoords = grid.dataCoords.slice(0, headerCells);
  const dataCoords = grid.dataCoords.slice(headerCells);
  const header = {
    version: PROTOCOL_VERSION,
    mode,
    ecLevel,
    compressed: isCompressed,
    gridWidth,
    gridHeight,
    dataLength: payloadLen,
    sequence
  };
  const headerBytes = encodeHeader(header);
  const pixelWidth = (gridWidth + 2 * QUIET_ZONE) * cellSize;
  const pixelHeight = (gridHeight + 2 * QUIET_ZONE) * cellSize;
  const bpp = bitDepth === 16 ? 8 : 4;
  const pixels = new Uint8Array(pixelWidth * pixelHeight * bpp);
  const setCell = (cellX, cellY, pixelData) => {
    const baseX = (cellX + QUIET_ZONE) * cellSize;
    const baseY = (cellY + QUIET_ZONE) * cellSize;
    for (let dy = 0; dy < cellSize; dy++) {
      for (let dx = 0; dx < cellSize; dx++) {
        const px = baseX + dx;
        const py = baseY + dy;
        const offset = (py * pixelWidth + px) * bpp;
        pixels.set(pixelData, offset);
      }
    }
  };
  const finderPixels = generateFinderPixels(bitDepth);
  const finderBpp = bpp;
  for (let fy = 0; fy < FINDER_SIZE; fy++) {
    for (let fx = 0; fx < FINDER_SIZE; fx++) {
      const srcOffset = (fy * FINDER_SIZE + fx) * finderBpp;
      setCell(fx, fy, finderPixels.subarray(srcOffset, srcOffset + finderBpp));
    }
  }
  for (let fy = 0; fy < FINDER_SIZE; fy++) {
    for (let fx = 0; fx < FINDER_SIZE; fx++) {
      const srcOffset = (fy * FINDER_SIZE + fx) * finderBpp;
      setCell(
        gridWidth - FINDER_SIZE + fx,
        fy,
        finderPixels.subarray(srcOffset, srcOffset + finderBpp)
      );
    }
  }
  for (let fy = 0; fy < FINDER_SIZE; fy++) {
    for (let fx = 0; fx < FINDER_SIZE; fx++) {
      const srcOffset = (fy * FINDER_SIZE + fx) * finderBpp;
      setCell(
        fx,
        gridHeight - FINDER_SIZE + fy,
        finderPixels.subarray(srcOffset, srcOffset + finderBpp)
      );
    }
  }
  const alignPixels = generateAlignmentPixels(bitDepth);
  for (let ay = 0; ay < ALIGNMENT_SIZE; ay++) {
    for (let ax = 0; ax < ALIGNMENT_SIZE; ax++) {
      const srcOffset = (ay * ALIGNMENT_SIZE + ax) * bpp;
      setCell(
        gridWidth - ALIGNMENT_SIZE + ax,
        gridHeight - ALIGNMENT_SIZE + ay,
        alignPixels.subarray(srcOffset, srcOffset + bpp)
      );
    }
  }
  let timingIdx = 0;
  for (let x2 = FINDER_SIZE; x2 < gridWidth - FINDER_SIZE; x2++) {
    setCell(x2, FINDER_SIZE, timingCellPixel(timingIdx++, bitDepth));
  }
  timingIdx = 0;
  for (let y = FINDER_SIZE; y < gridHeight - FINDER_SIZE; y++) {
    setCell(FINDER_SIZE, y, timingCellPixel(timingIdx++, bitDepth));
  }
  const paddedHeader = new Uint8Array(headerCells * bytesPerCell);
  paddedHeader.set(headerBytes);
  for (let i = 0; i < headerCells; i++) {
    const cellData = paddedHeader.subarray(i * bytesPerCell, (i + 1) * bytesPerCell);
    const pixel = encodeCell(cellData, mode);
    const [cx, cy] = headerCoords[i];
    setCell(cx, cy, pixel);
  }
  const paddedData = new Uint8Array(dataCells * bytesPerCell);
  paddedData.set(interleavedStream);
  for (let i = 0; i < dataCells; i++) {
    const cellData = paddedData.subarray(i * bytesPerCell, (i + 1) * bytesPerCell);
    const pixel = encodeCell(cellData, mode);
    if (i < dataCoords.length) {
      const [cx, cy] = dataCoords[i];
      setCell(cx, cy, pixel);
    }
  }
  return writePng(pixels, pixelWidth, pixelHeight, bitDepth);
}

// src/decode.ts
var import_node_zlib3 = require("zlib");
function decode(png) {
  const image = readPng(png);
  const { pixels, width: pixelWidth, height: pixelHeight, bitDepth } = image;
  const bpp = bitDepth === 16 ? 8 : 4;
  const cellSize = detectCellSize(pixels, pixelWidth, pixelHeight, bitDepth);
  const gridWidth = Math.floor(pixelWidth / cellSize) - 2 * QUIET_ZONE;
  const gridHeight = Math.floor(pixelHeight / cellSize) - 2 * QUIET_ZONE;
  if (gridWidth < 12 || gridHeight < 12) {
    throw new Error(`Grid too small: ${gridWidth}\xD7${gridHeight}`);
  }
  const readCell = (cellX, cellY) => {
    const px = (cellX + QUIET_ZONE) * cellSize;
    const py = (cellY + QUIET_ZONE) * cellSize;
    const offset2 = (py * pixelWidth + px) * bpp;
    return pixels.subarray(offset2, offset2 + bpp);
  };
  const grid = allocateGrid(gridWidth, gridHeight);
  const firstCellPixel = readCell(...grid.dataCoords[0]);
  let modeNibble;
  if (bitDepth === 16) {
    const view = new DataView(
      firstCellPixel.buffer,
      firstCellPixel.byteOffset,
      firstCellPixel.byteLength
    );
    const r16 = view.getUint16(0);
    modeNibble = r16 >> 8;
  } else {
    modeNibble = firstCellPixel[0];
  }
  const modeId = modeNibble & 15;
  const modeMap = {
    0: "rgba64",
    1: "rgba32",
    2: "rgb48",
    3: "rgb24"
  };
  const mode = modeMap[modeId];
  if (!mode) throw new Error(`Unknown mode ID in header: ${modeId}`);
  const bytesPerCell = BYTES_PER_CELL[mode];
  const hasSeqByte1 = readHeaderByte1(grid, readCell, mode, bitDepth);
  const hasSequence = (hasSeqByte1 & 32) !== 0;
  const hdrSize = headerSize(hasSequence);
  const headerCells = Math.ceil(hdrSize / bytesPerCell);
  const headerBytes = new Uint8Array(headerCells * bytesPerCell);
  for (let i = 0; i < headerCells; i++) {
    const [cx, cy] = grid.dataCoords[i];
    const pixel = readCell(cx, cy);
    const cellData = decodeCell(pixel, mode);
    headerBytes.set(cellData, i * bytesPerCell);
  }
  const header = decodeHeader(headerBytes.subarray(0, hdrSize));
  if (header.gridWidth !== gridWidth || header.gridHeight !== gridHeight) {
    throw new Error(
      `Grid dimension mismatch: header says ${header.gridWidth}\xD7${header.gridHeight}, image gives ${gridWidth}\xD7${gridHeight}`
    );
  }
  const dataCoords = grid.dataCoords.slice(headerCells);
  const payloadLen = header.dataLength;
  const ecRatio = EC_RATIO[header.ecLevel];
  let dataPerBlock;
  let ecCount;
  if (payloadLen === 0) {
    return new Uint8Array(0);
  }
  for (dataPerBlock = RS_MAX_BLOCK - 2; dataPerBlock >= 1; dataPerBlock--) {
    ecCount = ecSymbolCount(dataPerBlock, ecRatio);
    if (dataPerBlock + ecCount <= RS_MAX_BLOCK) break;
  }
  const numBlocks = Math.ceil(payloadLen / dataPerBlock);
  const blockSizes = [];
  for (let i = 0; i < numBlocks; i++) {
    const start = i * dataPerBlock;
    const end = Math.min(start + dataPerBlock, payloadLen);
    const blockDataLen = end - start;
    const blockEcCount = ecSymbolCount(blockDataLen, ecRatio);
    blockSizes.push(blockDataLen + blockEcCount);
  }
  const totalStreamBytes = blockSizes.reduce((s, b) => s + b, 0);
  const totalStreamCells = Math.ceil(totalStreamBytes / bytesPerCell);
  const rawStream = new Uint8Array(totalStreamCells * bytesPerCell);
  for (let i = 0; i < totalStreamCells && i < dataCoords.length; i++) {
    const [cx, cy] = dataCoords[i];
    const pixel = readCell(cx, cy);
    const cellData = decodeCell(pixel, mode);
    rawStream.set(cellData, i * bytesPerCell);
  }
  const interleavedStream = rawStream.subarray(0, totalStreamBytes);
  const rsBlocks = deinterleave(interleavedStream, blockSizes);
  const dataChunks = [];
  for (let i = 0; i < numBlocks; i++) {
    const blockDataLen = Math.min(dataPerBlock, payloadLen - i * dataPerBlock);
    const blockEcCount = rsBlocks[i].length - blockDataLen;
    const decoded = rsDecode(rsBlocks[i], blockEcCount);
    dataChunks.push(decoded);
  }
  const totalData = dataChunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalData);
  let offset = 0;
  for (const chunk of dataChunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  const trimmed = result.subarray(0, payloadLen);
  if (header.compressed) {
    return new Uint8Array((0, import_node_zlib3.inflateSync)(Buffer.from(trimmed)));
  }
  return trimmed;
}
function readHeaderByte1(grid, readCell, mode, _bitDepth) {
  const bytesPerCell = BYTES_PER_CELL[mode];
  if (bytesPerCell >= 2) {
    const [cx, cy] = grid.dataCoords[0];
    const pixel = readCell(cx, cy);
    const cellData = decodeCell(pixel, mode);
    return cellData[1];
  } else {
    const [cx, cy] = grid.dataCoords[1];
    const pixel = readCell(cx, cy);
    const cellData = decodeCell(pixel, mode);
    return cellData[0];
  }
}
function detectCellSize(pixels, pixelWidth, _pixelHeight, bitDepth) {
  const bpp = bitDepth === 16 ? 8 : 4;
  for (let testY = 0; testY < Math.min(50, _pixelHeight); testY++) {
    let finderStart = -1;
    for (let x2 = 0; x2 < pixelWidth; x2++) {
      const offset = (testY * pixelWidth + x2) * bpp;
      const alpha = bitDepth === 16 ? pixels[offset + 6] << 8 | pixels[offset + 7] : pixels[offset + 3];
      if (alpha > 0) {
        finderStart = x2;
        break;
      }
    }
    if (finderStart < 0) continue;
    const cellSize = Math.round(finderStart / QUIET_ZONE);
    if (cellSize < 1) continue;
    return cellSize;
  }
  return 1;
}

// src/capacity.ts
function capacity(options) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { mode, ecLevel, sequence } = opts;
  const hasSequence = sequence !== void 0;
  const bytesPerCell = BYTES_PER_CELL[mode];
  const bitsPerCell = BITS_PER_CELL[mode];
  const ecRatio = EC_RATIO[ecLevel];
  let gridWidth;
  let gridHeight;
  if (opts.width && opts.height) {
    gridWidth = opts.width;
    gridHeight = opts.height;
  } else {
    const auto = autoSize(1, mode, ecLevel, hasSequence);
    gridWidth = auto.width;
    gridHeight = auto.height;
  }
  const totalCells = gridWidth * gridHeight;
  const structural = structuralCellCount(gridWidth, gridHeight);
  const totalDataCells = dataCellCount(gridWidth, gridHeight);
  const hdrSize = headerSize(hasSequence);
  const headerCells = Math.ceil(hdrSize / bytesPerCell);
  const payloadDataCells = totalDataCells - headerCells;
  const rawBytes = payloadDataCells * bytesPerCell;
  let dataBytes;
  let ecBytes;
  if (rawBytes <= 0) {
    dataBytes = 0;
    ecBytes = 0;
  } else if (rawBytes <= RS_MAX_BLOCK) {
    const ec = ecSymbolCount(rawBytes, ecRatio);
    dataBytes = Math.max(0, rawBytes - ec);
    ecBytes = ec;
  } else {
    const numBlocks = Math.ceil(rawBytes / RS_MAX_BLOCK);
    let dataPerBlock;
    for (dataPerBlock = RS_MAX_BLOCK - 2; dataPerBlock >= 1; dataPerBlock--) {
      const ec = ecSymbolCount(dataPerBlock, ecRatio);
      if (dataPerBlock + ec <= RS_MAX_BLOCK) break;
    }
    const ecPerBlock = ecSymbolCount(dataPerBlock, ecRatio);
    dataBytes = dataPerBlock * numBlocks;
    ecBytes = ecPerBlock * numBlocks;
  }
  return {
    gridWidth,
    gridHeight,
    totalCells,
    dataCells: totalDataCells,
    bitsPerCell,
    dataBytes,
    ecBytes,
    structuralCells: structural
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  capacity,
  decode,
  encode
});
//# sourceMappingURL=index.cjs.map