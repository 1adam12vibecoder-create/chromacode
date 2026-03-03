/*
 * chromacode.h — ChromaCode C library public API.
 *
 * Multi-dimensional visual data encoding using RGBA color channels
 * with Reed-Solomon error correction.
 *
 * C99, single external dependency: zlib.
 */

#ifndef CHROMACODE_H
#define CHROMACODE_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ── Encoding modes ──────────────────────────────────────────────── */
#define CC_MODE_RGBA64  0   /* 64 bits/cell, 8 bytes/cell, 16-bit PNG */
#define CC_MODE_RGBA32  1   /* 32 bits/cell, 4 bytes/cell, 8-bit PNG  */
#define CC_MODE_RGB48   2   /* 48 bits/cell, 6 bytes/cell, 16-bit PNG */
#define CC_MODE_RGB24   3   /* 24 bits/cell, 3 bytes/cell, 8-bit PNG  */

/* ── Error correction levels ─────────────────────────────────────── */
#define CC_EC_L  0   /* ~7%  redundancy */
#define CC_EC_M  1   /* ~15% redundancy */
#define CC_EC_Q  2   /* ~25% redundancy */
#define CC_EC_H  3   /* ~30% redundancy */

/* ── Error codes ─────────────────────────────────────────────────── */
#define CC_OK               0
#define CC_ERR_ALLOC       -1
#define CC_ERR_GRID_SMALL  -2
#define CC_ERR_PNG         -3
#define CC_ERR_DECODE      -4
#define CC_ERR_RS          -5
#define CC_ERR_HEADER      -6
#define CC_ERR_INPUT       -7
#define CC_ERR_ZLIB        -8

/* ── Constants ───────────────────────────────────────────────────── */
#define CC_FINDER_SIZE      7
#define CC_ALIGNMENT_SIZE   5
#define CC_QUIET_ZONE       1
#define CC_MIN_GRID_SIZE   16   /* FINDER_SIZE * 2 + 2 */
#define CC_MAX_GRID_SIZE 4095   /* 12-bit header field */
#define CC_MAX_CELL_SIZE   32
#define CC_PROTOCOL_VERSION 1
#define CC_RS_MAX_BLOCK   255

/* ── Options ─────────────────────────────────────────────────────── */
typedef struct {
    int mode;           /* CC_MODE_* (default: CC_MODE_RGBA64) */
    int cell_size;      /* pixels per cell side (default: 1) */
    int ec_level;       /* CC_EC_* (default: CC_EC_L) */
    int width;          /* grid cells wide (0 = auto) */
    int height;         /* grid cells tall (0 = auto) */
    int compress;       /* 1 = deflate before encoding (default: 0) */
    /* Sequence (all zero = no sequence) */
    uint16_t seq_id;
    uint8_t  seq_index;
    uint8_t  seq_total;
} cc_options;

/* ── Capacity info ───────────────────────────────────────────────── */
typedef struct {
    int grid_width, grid_height;
    int total_cells, data_cells;
    int bits_per_cell;
    int data_bytes, ec_bytes;
    int structural_cells;
} cc_capacity;

/* ── Public API ──────────────────────────────────────────────────── */

/** Returns default options (rgba64, cellSize=1, EC_L, no compression). */
cc_options cc_defaults(void);

/**
 * Encode binary data into a ChromaCode PNG image.
 *
 * @param data      Input data bytes
 * @param data_len  Length of input data
 * @param opts      Encoding options (NULL for defaults)
 * @param out_png   Receives malloc'd PNG buffer (caller frees with free())
 * @param out_len   Receives PNG buffer length
 * @return CC_OK on success, negative error code on failure
 */
int cc_encode(const uint8_t *data, size_t data_len,
              const cc_options *opts,
              uint8_t **out_png, size_t *out_len);

/**
 * Decode a ChromaCode PNG image back to binary data.
 *
 * @param png       PNG file bytes
 * @param png_len   Length of PNG data
 * @param out_data  Receives malloc'd data buffer (caller frees with free())
 * @param out_len   Receives data buffer length
 * @return CC_OK on success, negative error code on failure
 */
int cc_decode(const uint8_t *png, size_t png_len,
              uint8_t **out_data, size_t *out_len);

/**
 * Query encoding capacity for given options.
 *
 * @param opts  Encoding options (NULL for defaults)
 * @param info  Receives capacity information
 * @return CC_OK on success, negative error code on failure
 */
int cc_get_capacity(const cc_options *opts, cc_capacity *info);

/** Return human-readable error message for an error code. */
const char *cc_strerror(int code);

#ifdef __cplusplus
}
#endif

/* ══════════════════════════════════════════════════════════════════
 * Internal API — used by implementation files only.
 * Not part of the public contract.
 * ══════════════════════════════════════════════════════════════════ */
#ifdef CHROMACODE_INTERNAL

/* ── Lookup tables ───────────────────────────────────────────────── */

/* Bytes per cell for each mode */
static const int CC_BYTES_PER_CELL[4] = { 8, 4, 6, 3 };
/* Bits per cell for each mode */
static const int CC_BITS_PER_CELL[4]  = { 64, 32, 48, 24 };
/* Bit depth for each mode: 0,2 → 16, 1,3 → 8 */
static const int CC_BIT_DEPTH[4]      = { 16, 8, 16, 8 };
/* Has alpha data channel: modes 0,1 → 1; modes 2,3 → 0 */
static const int CC_HAS_ALPHA[4]      = { 1, 1, 0, 0 };
/* PNG bytes per pixel (always RGBA): 16-bit=8, 8-bit=4 */
static const int CC_PNG_BPP[4]        = { 8, 4, 8, 4 };
/* EC ratios × 100 to avoid floats: L=7, M=15, Q=25, H=30 */
static const int CC_EC_RATIO_100[4]   = { 7, 15, 25, 30 };

/* ── CRC32 ───────────────────────────────────────────────────────── */
uint32_t cc_crc32(const uint8_t *data, size_t len);
uint32_t cc_crc32_update(uint32_t crc, const uint8_t *data, size_t len);

/* ── GF(2^8) ─────────────────────────────────────────────────────── */
extern uint8_t cc_gf_exp[512];
extern uint8_t cc_gf_log[256];

void     cc_gf_init(void);
uint8_t  cc_gf_mul(uint8_t a, uint8_t b);
uint8_t  cc_gf_div(uint8_t a, uint8_t b);
uint8_t  cc_gf_inv(uint8_t a);
uint8_t  cc_gf_pow(uint8_t a, int n);
uint8_t  cc_gf_poly_eval(const uint8_t *poly, int len, uint8_t x);
/* poly_mul: result must be pre-allocated to (a_len + b_len - 1) bytes */
void     cc_gf_poly_mul(const uint8_t *a, int a_len,
                         const uint8_t *b, int b_len,
                         uint8_t *result);

/* ── Reed-Solomon ────────────────────────────────────────────────── */
int  cc_rs_ec_symbol_count(int data_len, int ec_ratio_100);
/* rs_encode: out must be pre-allocated to (data_len + ec_count) bytes */
int  cc_rs_encode(const uint8_t *data, int data_len, int ec_count,
                  uint8_t *out);
/* rs_decode: out must be pre-allocated to data_len bytes; data_len = n - ec_count */
int  cc_rs_decode(const uint8_t *received, int n, int ec_count,
                  uint8_t *out);

/* ── PNG ─────────────────────────────────────────────────────────── */
int  cc_png_write(const uint8_t *pixels, int width, int height, int bit_depth,
                  uint8_t **out_png, size_t *out_len);
int  cc_png_read(const uint8_t *png, size_t png_len,
                 uint8_t **out_pixels, int *width, int *height, int *bit_depth);

/* ── Channels ────────────────────────────────────────────────────── */
/* encode_cell: pixel must be pre-allocated (8 bytes for 16-bit, 4 for 8-bit) */
void cc_encode_cell(const uint8_t *data, int mode, uint8_t *pixel);
/* decode_cell: result must be pre-allocated to BYTES_PER_CELL[mode] bytes */
void cc_decode_cell(const uint8_t *pixel, int mode, uint8_t *result);

/* ── Grid ────────────────────────────────────────────────────────── */

/* Cell type enum (fits in uint8_t) */
#define CC_CELL_FINDER    0
#define CC_CELL_ALIGNMENT 1
#define CC_CELL_TIMING    2
#define CC_CELL_HEADER    3
#define CC_CELL_DATA      4
#define CC_CELL_QUIET     5

typedef struct {
    int width, height;
    uint8_t *cells;            /* flat [height][width] array of CC_CELL_* */
    int32_t *data_coords;      /* pairs: [x0,y0, x1,y1, ...] in serpentine order */
    int      data_count;       /* number of coordinate pairs */
} cc_grid;

int  cc_grid_alloc(int width, int height, cc_grid *grid);
void cc_grid_free(cc_grid *grid);

int  cc_structural_cell_count(int width, int height);
int  cc_data_cell_count(int width, int height);
int  cc_header_size(int has_sequence);

typedef struct {
    uint8_t  version;
    int      mode;        /* CC_MODE_* */
    int      ec_level;    /* CC_EC_* */
    int      compressed;
    int      grid_width;
    int      grid_height;
    uint32_t data_length;
    int      has_sequence;
    uint16_t seq_id;
    uint8_t  seq_index;
    uint8_t  seq_total;
} cc_header;

/* encode_header: buf must be pre-allocated to cc_header_size() bytes */
int  cc_encode_header(const cc_header *meta, uint8_t *buf);
int  cc_decode_header(const uint8_t *buf, int buf_len, cc_header *meta);

/* Finder/alignment/timing pixel generation */
void cc_finder_pixel(int x, int y, int bit_depth, uint8_t *pixel);
void cc_alignment_pixel(int x, int y, int bit_depth, uint8_t *pixel);
void cc_timing_pixel(int index, int bit_depth, uint8_t *pixel);

/* ── Interleave ──────────────────────────────────────────────────── */
/* interleave: out must hold sum of all block sizes */
void cc_interleave(const uint8_t **blocks, const int *sizes, int count,
                   uint8_t *out);
/* deinterleave: blocks[i] must each be pre-allocated to sizes[i] bytes */
void cc_deinterleave(const uint8_t *stream, int stream_len,
                     uint8_t **blocks, const int *sizes, int count);

/* ── Auto-size ───────────────────────────────────────────────────── */
int  cc_usable_capacity(int width, int height, int mode, int ec_level,
                        int has_sequence);
int  cc_auto_size(int data_length, int mode, int ec_level, int has_sequence,
                  int *out_width, int *out_height);

#endif /* CHROMACODE_INTERNAL */

#endif /* CHROMACODE_H */
