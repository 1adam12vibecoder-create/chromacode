/** Encoding mode determines bits per cell and bit depth */
export type EncodingMode = 'rgba64' | 'rgba32' | 'rgb48' | 'rgb24'

/** Error correction level */
export type ECLevel = 'L' | 'M' | 'Q' | 'H'

/** Options for encoding data into a ChromaCode image */
export interface EncodeOptions {
  /** Encoding mode (default: 'rgba64') */
  mode: EncodingMode
  /** Pixels per cell side (default: 1) */
  cellSize: number
  /** Error correction level (default: 'L') */
  ecLevel: ECLevel
  /** Grid cells wide (auto-calculated if omitted) */
  width?: number
  /** Grid cells tall (auto-calculated if omitted) */
  height?: number
  /** Deflate compress data before encoding (default: false) */
  compress?: boolean
  /** Multi-image sequence info */
  sequence?: SequenceInfo
}

/** Multi-image sequence metadata */
export interface SequenceInfo {
  /** Shared ID across all images in the sequence (0-65535) */
  id: number
  /** Position in sequence (0-indexed, 0-255) */
  index: number
  /** Total image count (1-256) */
  total: number
}

/** Information about encoding capacity */
export interface CapacityInfo {
  /** Grid width in cells */
  gridWidth: number
  /** Grid height in cells */
  gridHeight: number
  /** Total cells in grid */
  totalCells: number
  /** Cells available for data */
  dataCells: number
  /** Bits encoded per cell */
  bitsPerCell: number
  /** Usable data bytes after error correction overhead */
  dataBytes: number
  /** Error correction overhead bytes */
  ecBytes: number
  /** Cells used by finders, timing, header */
  structuralCells: number
}

/** What kind of content a cell holds */
export type CellType = 'finder' | 'alignment' | 'timing' | 'header' | 'data' | 'quiet'

/** Map of cell positions to their types */
export interface CellMap {
  width: number
  height: number
  cells: CellType[][]
  /** Ordered data cell coordinates in serpentine fill order */
  dataCoords: [number, number][]
  /** Header cell coordinates */
  headerCoords: [number, number][]
}

/** Header metadata encoded in the first data cells */
export interface HeaderMeta {
  /** Protocol version (0-15) */
  version: number
  /** Encoding mode */
  mode: EncodingMode
  /** Error correction level */
  ecLevel: ECLevel
  /** Grid width in cells */
  gridWidth: number
  /** Grid height in cells */
  gridHeight: number
  /** Data length in bytes (original, before compression/EC) */
  dataLength: number
  /** Whether data is deflate-compressed */
  compressed: boolean
  /** Optional sequence info */
  sequence?: SequenceInfo
}

/** Bits per cell for each mode */
export const BITS_PER_CELL: Record<EncodingMode, number> = {
  rgba64: 64,
  rgba32: 32,
  rgb48: 48,
  rgb24: 24,
}

/** Bytes per cell for each mode */
export const BYTES_PER_CELL: Record<EncodingMode, number> = {
  rgba64: 8,
  rgba32: 4,
  rgb48: 6,
  rgb24: 3,
}

/** Bit depth for each mode */
export const BIT_DEPTH: Record<EncodingMode, 8 | 16> = {
  rgba64: 16,
  rgba32: 8,
  rgb48: 16,
  rgb24: 8,
}

/** Whether mode uses alpha channel */
export const HAS_ALPHA: Record<EncodingMode, boolean> = {
  rgba64: true,
  rgba32: true,
  rgb48: false,
  rgb24: false,
}

/** Bytes per pixel in the PNG for each mode */
export const PNG_BYTES_PER_PIXEL: Record<EncodingMode, number> = {
  rgba64: 8, // 4 channels × 2 bytes
  rgba32: 4, // 4 channels × 1 byte
  rgb48: 8, // PNG is always RGBA; we use alpha=max for rgb modes
  rgb24: 4, // PNG is always RGBA; we use alpha=255 for rgb modes
}

/** EC redundancy ratios */
export const EC_RATIO: Record<ECLevel, number> = {
  L: 0.07,
  M: 0.15,
  Q: 0.25,
  H: 0.3,
}

/** Mode string to numeric ID */
export const MODE_ID: Record<EncodingMode, number> = {
  rgba64: 0,
  rgba32: 1,
  rgb48: 2,
  rgb24: 3,
}

/** Numeric ID to mode string */
export const ID_TO_MODE: Record<number, EncodingMode> = {
  0: 'rgba64',
  1: 'rgba32',
  2: 'rgb48',
  3: 'rgb24',
}

/** EC level to numeric ID */
export const EC_ID: Record<ECLevel, number> = {
  L: 0,
  M: 1,
  Q: 2,
  H: 3,
}

/** Numeric ID to EC level */
export const ID_TO_EC: Record<number, ECLevel> = {
  0: 'L',
  1: 'M',
  2: 'Q',
  3: 'H',
}

/** Finder pattern size in cells */
export const FINDER_SIZE = 7

/** Alignment pattern size in cells */
export const ALIGNMENT_SIZE = 5

/** Quiet zone width in cells */
export const QUIET_ZONE = 1

/** Minimum grid dimension (2 non-overlapping finders + timing + some data) */
export const MIN_GRID_SIZE = FINDER_SIZE * 2 + 2 // 7 + 7 + 2 = 16

/** Maximum grid dimension (12-bit header field) */
export const MAX_GRID_SIZE = 4095

/** Protocol version */
export const PROTOCOL_VERSION = 1

/** Maximum cell size in pixels */
export const MAX_CELL_SIZE = 32

/** Max RS block size */
export const RS_MAX_BLOCK = 255

/** Default options */
export const DEFAULT_OPTIONS: EncodeOptions = {
  mode: 'rgba64',
  cellSize: 1,
  ecLevel: 'L',
  compress: false,
}
