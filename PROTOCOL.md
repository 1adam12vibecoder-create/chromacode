# ChromaCode Protocol Specification v1

## 1. Overview

ChromaCode is a visual data encoding protocol that uses **color + opacity** as independent data channels in PNG images. Designed for digital-first extraction (byte-perfect from embedded PNGs), it provides orders of magnitude more capacity than QR codes in the same physical space.

## 2. Encoding Dimensions

Each cell in the grid encodes data across RGBA channels. Four encoding modes are supported:

| Mode | Bits/Cell | Bit Depth | Channels | Use Case |
|------|-----------|-----------|----------|----------|
| `rgba64` | 64 | 16-bit | R+G+B+A | Max capacity, digital extraction (default) |
| `rgba32` | 32 | 8-bit | R+G+B+A | Standard PNG compatibility |
| `rgb48` | 48 | 16-bit | R+G+B | No alpha, 16-bit color |
| `rgb24` | 24 | 8-bit | R+G+B | No alpha, widest compatibility |

In modes without alpha (`rgb48`, `rgb24`), the alpha channel is set to maximum (fully opaque) and is not used for data.

## 3. Image Format

ChromaCode images are standard PNG files:
- Color type: 6 (RGBA)
- Bit depth: 16 (for `rgba64`, `rgb48`) or 8 (for `rgba32`, `rgb24`)
- No interlacing
- Filter type 0 (None) for writing

## 4. Grid Structure

The image is divided into a grid of cells. Each cell is `cellSize × cellSize` pixels (default 1×1).

```
┌─────────┬───────────────────────────┬─────────┐
│ FINDER  │      TIMING PATTERN       │ FINDER  │
│  (TL)   │                           │  (TR)   │
├─────────┤                           ├─────────┤
│         │                           │         │
│ TIMING  │       DATA REGION         │ TIMING  │
│         │   (header + data + EC)    │         │
│         │                           │         │
├─────────┤                           ├─────────┤
│ FINDER  │      TIMING PATTERN       │  ALIGN  │
│  (BL)   │                           │  (BR)   │
└─────────┴───────────────────────────┴─────────┘
```

A 1-cell transparent quiet zone (alpha=0) surrounds the entire grid. Total pixel dimensions: `(gridWidth + 2) × cellSize` by `(gridHeight + 2) × cellSize`.

### 4.1 Finder Patterns

Three 7×7 finder patterns at TL, TR, BL corners. Concentric colored squares:

| Layer | Size | Color (8-bit RGB) | 16-bit (×257) |
|-------|------|--------------------|----------------|
| 0 (outer) | 7×7 | #4f46e5 (79, 70, 229) | (20303, 17990, 58853) |
| 1 | 5×5 | #ffffff (255, 255, 255) | (65535, 65535, 65535) |
| 2 | 3×3 | #7c3aed (124, 58, 237) | (31868, 14906, 60909) |
| 3 (center) | 1×1 | #4f46e5 (79, 70, 229) | (20303, 17990, 58853) |

All finder cells have full alpha (255 or 65535).

### 4.2 Alignment Pattern

One 5×5 alignment pattern at the BR corner. Same color scheme as finders (layers 0-2).

### 4.3 Timing Patterns

Alternating dark/light cells along row `y=7` (horizontal, between finders) and column `x=7` (vertical, between finders). Dark cells use the finder outer color; light cells use white.

## 5. Header

The first N data cells (in serpentine order) encode the header:

| Field | Bits | Description |
|-------|------|-------------|
| version | 4 | Protocol version (currently 1) |
| mode | 4 | Encoding mode (0=rgba64, 1=rgba32, 2=rgb48, 3=rgb24) |
| ecLevel | 2 | Error correction (0=L, 1=M, 2=Q, 3=H) |
| hasSequence | 1 | Whether sequence fields are present |
| compressed | 1 | Whether data is deflate-compressed |
| reserved | 4 | Must be 0 |
| gridWidth | 12 | Grid width in cells |
| gridHeight | 12 | Grid height in cells |
| dataLength | 32 | Payload length in bytes |
| sequence_id | 16 | (optional) Shared ID across sequence |
| sequence_index | 8 | (optional) Position in sequence (0-indexed) |
| sequence_total | 8 | (optional) Total image count |
| CRC16 | 16 | Lower 16 bits of CRC32 over preceding header bytes |

**Total: 14 bytes** (without sequence) or **18 bytes** (with sequence).

## 6. Data Fill Order

Data cells are filled in serpentine order:
- Row 0: left → right
- Row 1: right → left
- Row 2: left → right
- ...alternating

Cells occupied by finders, alignment, or timing patterns are skipped.

## 7. Error Correction

Reed-Solomon over GF(2^8) with primitive polynomial 0x11d.

| Level | Redundancy | Correction Capacity |
|-------|-----------|---------------------|
| L | ~7% | t ≈ 3.5% of symbols |
| M | ~15% | t ≈ 7.5% of symbols |
| Q | ~25% | t ≈ 12.5% of symbols |
| H | ~30% | t ≈ 15% of symbols |

### 7.1 Block Structure

Data is split into RS blocks of at most 255 symbols (data + EC). For each block:
1. Compute EC symbol count from data length and EC ratio
2. Generate EC symbols using RS systematic encoding
3. Codeword = [data symbols, EC symbols]

### 7.2 Interleaving

Multiple RS blocks are interleaved round-robin for burst error resistance:
```
Blocks: [A0,A1,A2], [B0,B1,B2]
Stream: [A0,B0,A1,B1,A2,B2]
```

## 8. Encoding Pipeline

1. (Optional) Deflate-compress the input data
2. Split payload into RS blocks
3. RS-encode each block (append EC symbols)
4. Interleave blocks into a single stream
5. Auto-size grid if dimensions not specified
6. Allocate grid (classify cells as finder/timing/header/data)
7. Encode header into first N data cells
8. Encode interleaved stream into remaining data cells
9. Render all cells into pixel buffer
10. Write PNG

## 9. Decoding Pipeline

1. Read PNG → pixel buffer
2. Detect cell size from finder pattern (quiet zone boundary)
3. Determine grid dimensions from pixel dimensions
4. Read header from first data cells → mode, EC level, data length, etc.
5. Extract data cells in serpentine order
6. Decode cell channels → interleaved byte stream
7. Deinterleave → RS blocks
8. RS-decode each block (correct errors if needed)
9. Concatenate decoded blocks, truncate to data length
10. (If compressed) Inflate to recover original data

## 10. Multi-Image Sequences

For payloads exceeding single-image capacity, multiple images share a `sequence_id`. The decoder collects all images with matching `sequence_id`, orders by `sequence_index`, and concatenates decoded data.

## 11. Capacity Reference

At EC level L, `rgba64` mode, 1×1 cell size:

| Grid | Approx. Data Cells | Usable Capacity |
|------|--------------------:|----------------:|
| 16×16 | ~81 | ~600 B |
| 50×50 | ~2,125 | ~16 KB |
| 100×100 | ~8,500 | ~63 KB |
| 200×200 | ~34,000 | ~254 KB |
