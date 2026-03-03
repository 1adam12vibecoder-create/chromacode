/** Encoding mode determines bits per cell and bit depth */
type EncodingMode = 'rgba64' | 'rgba32' | 'rgb48' | 'rgb24';
/** Error correction level */
type ECLevel = 'L' | 'M' | 'Q' | 'H';
/** Options for encoding data into a ChromaCode image */
interface EncodeOptions {
    /** Encoding mode (default: 'rgba64') */
    mode: EncodingMode;
    /** Pixels per cell side (default: 1) */
    cellSize: number;
    /** Error correction level (default: 'L') */
    ecLevel: ECLevel;
    /** Grid cells wide (auto-calculated if omitted) */
    width?: number;
    /** Grid cells tall (auto-calculated if omitted) */
    height?: number;
    /** Deflate compress data before encoding (default: false) */
    compress?: boolean;
    /** Multi-image sequence info */
    sequence?: SequenceInfo;
}
/** Multi-image sequence metadata */
interface SequenceInfo {
    /** Shared ID across all images in the sequence (0-65535) */
    id: number;
    /** Position in sequence (0-indexed, 0-255) */
    index: number;
    /** Total image count (1-256) */
    total: number;
}
/** Information about encoding capacity */
interface CapacityInfo {
    /** Grid width in cells */
    gridWidth: number;
    /** Grid height in cells */
    gridHeight: number;
    /** Total cells in grid */
    totalCells: number;
    /** Cells available for data */
    dataCells: number;
    /** Bits encoded per cell */
    bitsPerCell: number;
    /** Usable data bytes after error correction overhead */
    dataBytes: number;
    /** Error correction overhead bytes */
    ecBytes: number;
    /** Cells used by finders, timing, header */
    structuralCells: number;
}

/**
 * ChromaCode encoder: data → PNG image.
 *
 * Pipeline:
 * 1. Optional deflate compression
 * 2. Split data into RS blocks
 * 3. RS encode each block (add EC symbols)
 * 4. Interleave blocks
 * 5. Auto-size grid (if dimensions not specified)
 * 6. Allocate grid
 * 7. Encode header into header cells
 * 8. Encode data into data cells via channel encoding
 * 9. Render finders, timing, alignment, data cells into pixel buffer
 * 10. Write PNG
 */

/**
 * Encode binary data into a ChromaCode PNG image.
 */
declare function encode(data: Uint8Array, options?: Partial<EncodeOptions>): Uint8Array;

/**
 * ChromaCode decoder: PNG image → data.
 *
 * Pipeline:
 * 1. Read PNG → pixel buffer
 * 2. Detect quiet zone / cell size from finder patterns
 * 3. Extract grid dimensions
 * 4. Read header from first N data cells
 * 5. Extract data cells in serpentine order
 * 6. Decode channels → interleaved stream
 * 7. Deinterleave → RS blocks
 * 8. RS decode each block (correct errors)
 * 9. Concatenate data
 * 10. Optional inflate decompression
 */
/**
 * Decode a ChromaCode PNG image back to binary data.
 */
declare function decode(png: Uint8Array): Uint8Array;

/**
 * Capacity calculator: how much data fits in a ChromaCode image.
 */

/**
 * Get capacity information for given encoding options.
 * If width/height are not specified, returns info for the minimum grid
 * that can hold at least 1 byte.
 */
declare function capacity(options?: Partial<EncodeOptions>): CapacityInfo;

export { type CapacityInfo, type ECLevel, type EncodeOptions, type EncodingMode, type SequenceInfo, capacity, decode, encode };
