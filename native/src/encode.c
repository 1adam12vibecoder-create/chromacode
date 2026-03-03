/*
 * encode.c — ChromaCode encoder: data → PNG image.
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

#define CHROMACODE_INTERNAL
#include "chromacode.h"
#include <stdlib.h>
#include <string.h>
#include <zlib.h>

/* ── Defaults ────────────────────────────────────────────────────── */

cc_options cc_defaults(void)
{
    cc_options opts;
    memset(&opts, 0, sizeof(opts));
    opts.mode = CC_MODE_RGBA64;
    opts.cell_size = 1;
    opts.ec_level = CC_EC_L;
    opts.compress = 0;
    return opts;
}

/* ── Error strings ───────────────────────────────────────────────── */

const char *cc_strerror(int code)
{
    switch (code) {
        case CC_OK:             return "OK";
        case CC_ERR_ALLOC:      return "Memory allocation failed";
        case CC_ERR_GRID_SMALL: return "Grid too small for data";
        case CC_ERR_PNG:        return "PNG format error";
        case CC_ERR_DECODE:     return "Decode error";
        case CC_ERR_RS:         return "Reed-Solomon error correction failed";
        case CC_ERR_HEADER:     return "Header format error";
        case CC_ERR_INPUT:      return "Invalid input";
        case CC_ERR_ZLIB:       return "Zlib compression/decompression error";
        default:                return "Unknown error";
    }
}

/* ── Helper: set cell pixels ─────────────────────────────────────── */

static void set_cell(uint8_t *pixels, int pixel_width, int bpp,
                     int cell_x, int cell_y, int cell_size,
                     const uint8_t *pixel_data)
{
    int base_x = (cell_x + CC_QUIET_ZONE) * cell_size;
    int base_y = (cell_y + CC_QUIET_ZONE) * cell_size;
    for (int dy = 0; dy < cell_size; dy++) {
        for (int dx = 0; dx < cell_size; dx++) {
            int px = base_x + dx;
            int py = base_y + dy;
            size_t offset = ((size_t)py * pixel_width + px) * (size_t)bpp;
            memcpy(pixels + offset, pixel_data, (size_t)bpp);
        }
    }
}

/* ── Encode ──────────────────────────────────────────────────────── */

int cc_encode(const uint8_t *data, size_t data_len,
              const cc_options *opts,
              uint8_t **out_png, size_t *out_len)
{
    cc_gf_init();

    cc_options o = opts ? *opts : cc_defaults();
    int mode = o.mode;
    if (mode < 0 || mode > 3) return CC_ERR_INPUT;
    int ec_level = o.ec_level;
    if (ec_level < 0 || ec_level > 3) return CC_ERR_INPUT;
    int cell_size = o.cell_size > 0 ? o.cell_size : 1;
    if (cell_size > CC_MAX_CELL_SIZE) return CC_ERR_INPUT;
    int bytes_per_cell = CC_BYTES_PER_CELL[mode];
    int bit_depth = CC_BIT_DEPTH[mode];
    int bpp = CC_PNG_BPP[mode];
    int ec_ratio_100 = CC_EC_RATIO_100[ec_level];
    int has_sequence = (o.seq_total > 0) ? 1 : 0;

    /* Step 1: Optional compression */
    const uint8_t *payload = data;
    size_t payload_len = data_len;
    uint8_t *compressed = NULL;
    int is_compressed = 0;

    if (o.compress && data_len > 0) {
        uLongf comp_len = compressBound((uLong)data_len);
        compressed = (uint8_t *)malloc((size_t)comp_len);
        if (!compressed) return CC_ERR_ALLOC;

        int zrc = compress2(compressed, &comp_len, data, (uLong)data_len,
                            Z_DEFAULT_COMPRESSION);
        if (zrc == Z_OK && (size_t)comp_len < data_len) {
            payload = compressed;
            payload_len = (size_t)comp_len;
            is_compressed = 1;
        } else {
            free(compressed);
            compressed = NULL;
        }
    }

    int rc = CC_OK;

    /* Step 2-3: RS block structure */
    uint8_t *interleaved = NULL;
    int num_blocks = 0;
    uint8_t **blocks = NULL;
    int *block_sizes = NULL;

    if (payload_len > 0) {
        /* Find optimal data per block */
        int data_per_block = CC_RS_MAX_BLOCK - 2;
        int ec_count;
        for (; data_per_block >= 1; data_per_block--) {
            ec_count = cc_rs_ec_symbol_count(data_per_block, ec_ratio_100);
            if (data_per_block + ec_count <= CC_RS_MAX_BLOCK) break;
        }

        num_blocks = ((int)payload_len + data_per_block - 1) / data_per_block;
        blocks = (uint8_t **)calloc((size_t)num_blocks, sizeof(uint8_t *));
        block_sizes = (int *)calloc((size_t)num_blocks, sizeof(int));
        if (!blocks || !block_sizes) { rc = CC_ERR_ALLOC; goto cleanup; }

        for (int i = 0; i < num_blocks; i++) {
            int start = i * data_per_block;
            int end = start + data_per_block;
            if ((size_t)end > payload_len) end = (int)payload_len;
            int block_data_len = end - start;
            int block_ec = cc_rs_ec_symbol_count(block_data_len, ec_ratio_100);
            int block_total = block_data_len + block_ec;

            blocks[i] = (uint8_t *)malloc((size_t)block_total);
            if (!blocks[i]) { rc = CC_ERR_ALLOC; goto cleanup; }

            rc = cc_rs_encode(payload + start, block_data_len, block_ec, blocks[i]);
            if (rc != CC_OK) goto cleanup;
            block_sizes[i] = block_total;
        }
    }

    /* Step 4: Interleave */
    int total_stream = 0;
    for (int i = 0; i < num_blocks; i++) total_stream += block_sizes[i];

    if (total_stream > 0) {
        interleaved = (uint8_t *)malloc((size_t)total_stream);
        if (!interleaved) { rc = CC_ERR_ALLOC; goto cleanup; }
        cc_interleave((const uint8_t **)blocks, block_sizes, num_blocks, interleaved);
    }

    /* Step 5: Grid dimensions */
    int hdr_size = cc_header_size(has_sequence);
    int header_cells = (hdr_size + bytes_per_cell - 1) / bytes_per_cell;
    int data_cells = (total_stream + bytes_per_cell - 1) / bytes_per_cell;
    int needed_data_cells = header_cells + data_cells;

    int grid_w, grid_h;
    if (o.width > 0 && o.height > 0) {
        grid_w = o.width;
        grid_h = o.height;
    } else {
        rc = cc_auto_size((int)payload_len, mode, ec_level, has_sequence,
                          &grid_w, &grid_h);
        if (rc != CC_OK) goto cleanup;
    }

    /* Step 6: Allocate grid */
    cc_grid grid;
    rc = cc_grid_alloc(grid_w, grid_h, &grid);
    if (rc != CC_OK) goto cleanup;

    if (grid.data_count < needed_data_cells) {
        cc_grid_free(&grid);
        rc = CC_ERR_GRID_SMALL;
        goto cleanup;
    }

    /* Step 7: Encode header */
    cc_header hdr;
    hdr.version = CC_PROTOCOL_VERSION;
    hdr.mode = mode;
    hdr.ec_level = ec_level;
    hdr.compressed = is_compressed;
    hdr.grid_width = grid_w;
    hdr.grid_height = grid_h;
    hdr.data_length = (uint32_t)payload_len;
    hdr.has_sequence = has_sequence;
    hdr.seq_id = o.seq_id;
    hdr.seq_index = o.seq_index;
    hdr.seq_total = o.seq_total;

    uint8_t header_bytes[32]; /* max 18 bytes */
    cc_encode_header(&hdr, header_bytes);

    /* Step 8-9: Render into pixel buffer */
    int pixel_w = (grid_w + 2 * CC_QUIET_ZONE) * cell_size;
    int pixel_h = (grid_h + 2 * CC_QUIET_ZONE) * cell_size;
    size_t pixel_buf_size = (size_t)pixel_w * (size_t)pixel_h * (size_t)bpp;
    uint8_t *pixels = (uint8_t *)calloc(pixel_buf_size, 1);
    if (!pixels) { cc_grid_free(&grid); rc = CC_ERR_ALLOC; goto cleanup; }

    /* Render 3 finders */
    uint8_t finder_px[8]; /* max bpp = 8 */
    for (int fy = 0; fy < CC_FINDER_SIZE; fy++) {
        for (int fx = 0; fx < CC_FINDER_SIZE; fx++) {
            cc_finder_pixel(fx, fy, bit_depth, finder_px);
            /* Top-left */
            set_cell(pixels, pixel_w, bpp, fx, fy, cell_size, finder_px);
            /* Top-right */
            set_cell(pixels, pixel_w, bpp, grid_w - CC_FINDER_SIZE + fx, fy,
                     cell_size, finder_px);
            /* Bottom-left */
            set_cell(pixels, pixel_w, bpp, fx, grid_h - CC_FINDER_SIZE + fy,
                     cell_size, finder_px);
        }
    }

    /* Render alignment (bottom-right) */
    uint8_t align_px[8];
    for (int ay = 0; ay < CC_ALIGNMENT_SIZE; ay++) {
        for (int ax = 0; ax < CC_ALIGNMENT_SIZE; ax++) {
            cc_alignment_pixel(ax, ay, bit_depth, align_px);
            set_cell(pixels, pixel_w, bpp,
                     grid_w - CC_ALIGNMENT_SIZE + ax,
                     grid_h - CC_ALIGNMENT_SIZE + ay,
                     cell_size, align_px);
        }
    }

    /* Render timing patterns */
    uint8_t timing_px[8];
    /* Horizontal timing: row FINDER_SIZE */
    int timing_idx = 0;
    for (int x = CC_FINDER_SIZE; x < grid_w - CC_FINDER_SIZE; x++) {
        cc_timing_pixel(timing_idx++, bit_depth, timing_px);
        set_cell(pixels, pixel_w, bpp, x, CC_FINDER_SIZE, cell_size, timing_px);
    }
    /* Vertical timing: col FINDER_SIZE */
    timing_idx = 0;
    for (int y = CC_FINDER_SIZE; y < grid_h - CC_FINDER_SIZE; y++) {
        cc_timing_pixel(timing_idx++, bit_depth, timing_px);
        set_cell(pixels, pixel_w, bpp, CC_FINDER_SIZE, y, cell_size, timing_px);
    }

    /* Render header cells */
    int padded_hdr_len = header_cells * bytes_per_cell;
    uint8_t *padded_hdr = (uint8_t *)calloc((size_t)padded_hdr_len, 1);
    if (!padded_hdr) { free(pixels); cc_grid_free(&grid); rc = CC_ERR_ALLOC; goto cleanup; }
    memcpy(padded_hdr, header_bytes, (size_t)hdr_size);

    uint8_t cell_pixel[8];
    for (int i = 0; i < header_cells; i++) {
        cc_encode_cell(padded_hdr + i * bytes_per_cell, mode, cell_pixel);
        int cx = grid.data_coords[i * 2];
        int cy = grid.data_coords[i * 2 + 1];
        set_cell(pixels, pixel_w, bpp, cx, cy, cell_size, cell_pixel);
    }
    free(padded_hdr);

    /* Render data cells */
    if (data_cells > 0) {
        int padded_data_len = data_cells * bytes_per_cell;
        uint8_t *padded_data = (uint8_t *)calloc((size_t)padded_data_len, 1);
        if (!padded_data) { free(pixels); cc_grid_free(&grid); rc = CC_ERR_ALLOC; goto cleanup; }
        if (interleaved && total_stream > 0) {
            memcpy(padded_data, interleaved, (size_t)total_stream);
        }

        for (int i = 0; i < data_cells; i++) {
            int coord_idx = header_cells + i;
            if (coord_idx >= grid.data_count) break;
            cc_encode_cell(padded_data + i * bytes_per_cell, mode, cell_pixel);
            int cx = grid.data_coords[coord_idx * 2];
            int cy = grid.data_coords[coord_idx * 2 + 1];
            set_cell(pixels, pixel_w, bpp, cx, cy, cell_size, cell_pixel);
        }
        free(padded_data);
    }

    cc_grid_free(&grid);

    /* Step 10: Write PNG */
    rc = cc_png_write(pixels, pixel_w, pixel_h, bit_depth, out_png, out_len);
    free(pixels);

cleanup:
    free(compressed);
    free(interleaved);
    if (blocks) {
        for (int i = 0; i < num_blocks; i++) free(blocks[i]);
        free(blocks);
    }
    free(block_sizes);

    return rc;
}
