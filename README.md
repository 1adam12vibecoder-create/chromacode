# ChromaCode

[![npm version](https://img.shields.io/npm/v/chromacode.svg)](https://www.npmjs.com/package/chromacode)
[![CI](https://github.com/1adam12vibecoder-create/chromacode/actions/workflows/ci.yml/badge.svg)](https://github.com/1adam12vibecoder-create/chromacode/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Multi-dimensional visual data encoding using color + opacity channels.

## What is ChromaCode?

ChromaCode encodes binary data into PNG images using all four RGBA channels (red, green, blue, alpha) as independent data streams. Combined with Reed-Solomon error correction, this yields a visual data format designed for **digital-first extraction** — byte-perfect recovery from embedded PNGs, not camera scanning.

Think of it like QR codes, but instead of a black-and-white dot matrix optimized for cameras, ChromaCode uses the full color and transparency space of PNG images. In `rgba64` mode (16-bit per channel), a single cell carries 64 bits of data — versus QR's ~1 bit per module. A 100x100 grid can store ~63 KB at the lowest error correction level, orders of magnitude more than QR codes in the same pixel footprint.

## Capacity Reference

At EC level L, `rgba64` mode, 1x1 cell size:

| Grid | Approx. Data Cells | Usable Capacity |
|------|--------------------:|----------------:|
| 16x16 | ~81 | ~600 B |
| 50x50 | ~2,125 | ~16 KB |
| 100x100 | ~8,500 | ~63 KB |
| 200x200 | ~34,000 | ~254 KB |

## Quick Start

```bash
npm install chromacode
```

```typescript
import { encode, decode } from 'chromacode'
import { writeFileSync, readFileSync } from 'node:fs'

// Encode
const data = new TextEncoder().encode('Hello, ChromaCode!')
const png = encode(data)
writeFileSync('hello.png', png)

// Decode
const recovered = decode(readFileSync('hello.png'))
console.log(new TextDecoder().decode(recovered)) // "Hello, ChromaCode!"
```

## API Reference

### `encode(data, options?)`

Encodes binary data into a ChromaCode PNG image.

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `Uint8Array` | The binary data to encode |
| `options` | `Partial<EncodeOptions>` | Optional encoding configuration |

**Returns:** `Uint8Array` — the PNG file contents.

#### `EncodeOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mode` | `EncodingMode` | `'rgba64'` | Encoding mode (see table below) |
| `cellSize` | `number` | `1` | Pixels per cell side (1–32) |
| `ecLevel` | `ECLevel` | `'L'` | Error correction level |
| `width` | `number` | auto | Grid width in cells |
| `height` | `number` | auto | Grid height in cells |
| `compress` | `boolean` | `false` | Deflate-compress data before encoding |
| `sequence` | `SequenceInfo` | — | Multi-image sequence metadata |

### `decode(png)`

Decodes a ChromaCode PNG image back to the original binary data.

| Parameter | Type | Description |
|-----------|------|-------------|
| `png` | `Uint8Array` | The PNG file contents |

**Returns:** `Uint8Array` — the decoded data.

### `capacity(options?)`

Returns capacity information for given encoding options.

| Parameter | Type | Description |
|-----------|------|-------------|
| `options` | `Partial<EncodeOptions>` | Optional encoding configuration |

**Returns:** `CapacityInfo` — object with `gridWidth`, `gridHeight`, `totalCells`, `dataCells`, `bitsPerCell`, `dataBytes`, `ecBytes`, `structuralCells`.

## Encoding Modes

| Mode | Bits/Cell | Bit Depth | Channels | Use Case |
|------|-----------|-----------|----------|----------|
| `rgba64` | 64 | 16-bit | R+G+B+A | Max capacity, digital extraction (default) |
| `rgba32` | 32 | 8-bit | R+G+B+A | Standard PNG compatibility |
| `rgb48` | 48 | 16-bit | R+G+B | No alpha, 16-bit color |
| `rgb24` | 24 | 8-bit | R+G+B | No alpha, widest compatibility |

## Error Correction Levels

Reed-Solomon over GF(2^8) with configurable redundancy:

| Level | Redundancy | Correction Capacity |
|-------|-----------|---------------------|
| `L` | ~7% | ~3.5% of symbols |
| `M` | ~15% | ~7.5% of symbols |
| `Q` | ~25% | ~12.5% of symbols |
| `H` | ~30% | ~15% of symbols |

## Building the Native Addon

ChromaCode includes an optional C implementation for performance-critical use cases.

```bash
# Node.js native addon (node-gyp)
npm run build:native

# Standalone C library
cd native && make all
```

Prerequisites: C compiler (gcc/clang), zlib, libpng development headers.

## Running Tests

```bash
# TypeScript tests
npm test

# Native C tests
npm run test:native

# Type checking
npm run typecheck
```

## Protocol Specification

See [PROTOCOL.md](./PROTOCOL.md) for the full encoding format specification.

## License

[MIT](./LICENSE) — Copyright (c) 2026 Adam Irwin White
