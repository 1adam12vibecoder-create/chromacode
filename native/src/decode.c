/*
 * decode.c — ChromaCode decoder: PNG image → data.
 *
 * Pipeline:
 * 1. Read PNG → pixel buffer
 * 2. Detect cell size from finder patterns
 * 3. Extract grid dimensions
 * 4. Read header from first N data cells
 * 5. Extract data cells in serpentine order
 * 6. Decode channels → interleaved stream
 * 7. Deinterleave → RS blocks
 * 8. RS decode each block (correct errors)
 * 9. Concatenate data
 * 10. Optional inflate decompression
 */

#define CHROMACODE_INTERNAL
#include "chromacode.h"
#include <stdlib.h>
#include <string.h>
#include <zlib.h>

/* ── Helper: read cell pixel from pixel buffer ───────────────────── */

static const uint8_t *read_cell(const uint8_t *pixels, int pixel_width,
                                 int bpp, int cell_size,
                                 int cell_x, int cell_y)
{
    int px = (cell_x + CC_QUIET_ZONE) * cell_size;
    int py = (cell_y + CC_QUIET_ZONE) * cell_size;
    size_t offset = ((size_t)py * pixel_width + px) * (size_t)bpp;
    return pixels + offset;
}

/* ── Detect cell size ────────────────────────────────────────────── */

static int detect_cell_size(const uint8_t *pixels, int pixel_width,
                            int pixel_height, int bit_depth)
{
    int bpp = (bit_depth == 16) ? 8 : 4;

    /* Scan rows looking for the first non-transparent pixel.
     * Quiet zone has alpha=0. The finder starts at pixel (cellSize, cellSize). */
    for (int y = 0; y < pixel_height && y < 50; y++) {
        for (int x = 0; x < pixel_width; x++) {
            size_t offset = ((size_t)y * pixel_width + x) * (size_t)bpp;
            int alpha;
            if (bit_depth == 16) {
                alpha = ((int)pixels[offset + 6] << 8) | pixels[offset + 7];
            } else {
                alpha = pixels[offset + 3];
            }

            if (alpha > 0) {
                /* cellSize = x / QUIET_ZONE */
                int cell_size = x / CC_QUIET_ZONE;
                if (cell_size < 1) cell_size = 1;
                /* Round: in TS it's Math.round(x / QUIET_ZONE) */
                return cell_size;
            }
        }
    }

    return 1; /* fallback */
}

/* ── Decode ──────────────────────────────────────────────────────── */

int cc_decode(const uint8_t *png, size_t png_len,
              uint8_t **out_data, size_t *out_len)
{
    cc_gf_init();

    /* Step 1: Read PNG */
    uint8_t *pixels = NULL;
    int pixel_width = 0, pixel_height = 0, bit_depth = 0;
    int rc = cc_png_read(png, png_len, &pixels, &pixel_width, &pixel_height,
                         &bit_depth);
    if (rc != CC_OK) return rc;

    int bpp = (bit_depth == 16) ? 8 : 4;

    /* Step 2: Detect cell size */
    int cell_size = detect_cell_size(pixels, pixel_width, pixel_height,
                                     bit_depth);

    /* Step 3: Grid dimensions */
    int grid_w = pixel_width / cell_size - 2 * CC_QUIET_ZONE;
    int grid_h = pixel_height / cell_size - 2 * CC_QUIET_ZONE;

    if (grid_w < 12 || grid_h < 12) {
        free(pixels);
        return CC_ERR_DECODE;
    }

    /* Step 4: Allocate grid for data coords */
    cc_grid grid;
    rc = cc_grid_alloc(grid_w, grid_h, &grid);
    if (rc != CC_OK) { free(pixels); return rc; }

    /* Bootstrap: read first cell to get mode */
    const uint8_t *first_px = read_cell(pixels, pixel_width, bpp, cell_size,
                                         grid.data_coords[0],
                                         grid.data_coords[1]);

    int mode_nibble = first_px[0];

    int mode_id = mode_nibble & 0x0F;
    if (mode_id < 0 || mode_id > 3) {
        cc_grid_free(&grid);
        free(pixels);
        return CC_ERR_HEADER;
    }

    int mode = mode_id;
    int bytes_per_cell = CC_BYTES_PER_CELL[mode];
    /* ec_ratio_100 set after header decode below */
    int ec_ratio_100;

    /* Read byte 1 to get has_sequence flag */
    uint8_t cell0_data[8];
    cc_decode_cell(first_px, mode, cell0_data);
    int has_sequence = (cell0_data[1] & 0x20) ? 1 : 0;
    int hdr_size = cc_header_size(has_sequence);
    int header_cells = (hdr_size + bytes_per_cell - 1) / bytes_per_cell;

    /* Read full header */
    int hdr_buf_len = header_cells * bytes_per_cell;
    uint8_t *hdr_buf = (uint8_t *)calloc((size_t)hdr_buf_len, 1);
    if (!hdr_buf) { cc_grid_free(&grid); free(pixels); return CC_ERR_ALLOC; }

    for (int i = 0; i < header_cells; i++) {
        int cx = grid.data_coords[i * 2];
        int cy = grid.data_coords[i * 2 + 1];
        const uint8_t *px = read_cell(pixels, pixel_width, bpp, cell_size,
                                       cx, cy);
        cc_decode_cell(px, mode, hdr_buf + i * bytes_per_cell);
    }

    cc_header header;
    rc = cc_decode_header(hdr_buf, hdr_buf_len, &header);
    free(hdr_buf);
    if (rc != CC_OK) { cc_grid_free(&grid); free(pixels); return rc; }

    /* Verify grid dimensions */
    if (header.grid_width != grid_w || header.grid_height != grid_h) {
        cc_grid_free(&grid);
        free(pixels);
        return CC_ERR_HEADER;
    }

    uint32_t payload_len = header.data_length;
    if (header.ec_level < 0 || header.ec_level > 3) {
        cc_grid_free(&grid);
        free(pixels);
        return CC_ERR_HEADER;
    }
    ec_ratio_100 = CC_EC_RATIO_100[header.ec_level];

    /* Empty data */
    if (payload_len == 0) {
        cc_grid_free(&grid);
        free(pixels);
        *out_data = (uint8_t *)malloc(1); /* non-NULL for 0-length */
        *out_len = 0;
        return CC_OK;
    }

    /* Reconstruct block structure (same logic as encoder) */
    int data_per_block = CC_RS_MAX_BLOCK - 2;
    for (; data_per_block >= 1; data_per_block--) {
        int ec_count = cc_rs_ec_symbol_count(data_per_block, ec_ratio_100);
        if (data_per_block + ec_count <= CC_RS_MAX_BLOCK) break;
    }

    int num_blocks = ((int)payload_len + data_per_block - 1) / data_per_block;
    int *block_sizes = (int *)malloc((size_t)num_blocks * sizeof(int));
    if (!block_sizes) { cc_grid_free(&grid); free(pixels); return CC_ERR_ALLOC; }

    int total_stream = 0;
    for (int i = 0; i < num_blocks; i++) {
        int start = i * data_per_block;
        int end = start + data_per_block;
        if ((uint32_t)end > payload_len) end = (int)payload_len;
        int block_data_len = end - start;
        int block_ec = cc_rs_ec_symbol_count(block_data_len, ec_ratio_100);
        block_sizes[i] = block_data_len + block_ec;
        total_stream += block_sizes[i];
    }

    int total_stream_cells = (total_stream + bytes_per_cell - 1) / bytes_per_cell;

    /* Read data cells */
    int raw_stream_len = total_stream_cells * bytes_per_cell;
    uint8_t *raw_stream = (uint8_t *)calloc((size_t)raw_stream_len, 1);
    if (!raw_stream) {
        free(block_sizes);
        cc_grid_free(&grid);
        free(pixels);
        return CC_ERR_ALLOC;
    }

    for (int i = 0; i < total_stream_cells; i++) {
        int coord_idx = header_cells + i;
        if (coord_idx >= grid.data_count) break;
        int cx = grid.data_coords[coord_idx * 2];
        int cy = grid.data_coords[coord_idx * 2 + 1];
        const uint8_t *px = read_cell(pixels, pixel_width, bpp, cell_size,
                                       cx, cy);
        cc_decode_cell(px, mode, raw_stream + i * bytes_per_cell);
    }

    free(pixels);
    cc_grid_free(&grid);

    /* Deinterleave */
    uint8_t **rs_blocks = (uint8_t **)malloc((size_t)num_blocks * sizeof(uint8_t *));
    if (!rs_blocks) { free(raw_stream); free(block_sizes); return CC_ERR_ALLOC; }

    for (int i = 0; i < num_blocks; i++) {
        rs_blocks[i] = (uint8_t *)malloc((size_t)block_sizes[i]);
        if (!rs_blocks[i]) {
            for (int j = 0; j < i; j++) free(rs_blocks[j]);
            free(rs_blocks);
            free(raw_stream);
            free(block_sizes);
            return CC_ERR_ALLOC;
        }
    }

    cc_deinterleave(raw_stream, total_stream, rs_blocks, block_sizes,
                    num_blocks);
    free(raw_stream);

    /* RS decode each block */
    uint8_t *result = (uint8_t *)malloc((size_t)payload_len);
    if (!result) {
        for (int i = 0; i < num_blocks; i++) free(rs_blocks[i]);
        free(rs_blocks);
        free(block_sizes);
        return CC_ERR_ALLOC;
    }

    int result_offset = 0;
    for (int i = 0; i < num_blocks; i++) {
        int block_data_len = data_per_block;
        int remaining = (int)payload_len - i * data_per_block;
        if (block_data_len > remaining) block_data_len = remaining;
        int block_ec = block_sizes[i] - block_data_len;

        uint8_t *decoded = (uint8_t *)malloc((size_t)block_data_len);
        if (!decoded) {
            for (int j = 0; j < num_blocks; j++) free(rs_blocks[j]);
            free(rs_blocks); free(block_sizes); free(result);
            return CC_ERR_ALLOC;
        }

        rc = cc_rs_decode(rs_blocks[i], block_sizes[i], block_ec, decoded);
        if (rc != CC_OK) {
            free(decoded);
            for (int j = 0; j < num_blocks; j++) free(rs_blocks[j]);
            free(rs_blocks); free(block_sizes); free(result);
            return rc;
        }

        int copy_len = block_data_len;
        if (result_offset + copy_len > (int)payload_len)
            copy_len = (int)payload_len - result_offset;
        memcpy(result + result_offset, decoded, (size_t)copy_len);
        result_offset += copy_len;
        free(decoded);
    }

    for (int i = 0; i < num_blocks; i++) free(rs_blocks[i]);
    free(rs_blocks);
    free(block_sizes);

    /* Decompress if needed */
    if (header.compressed) {
        /* Estimate decompressed size — try progressively larger buffers */
        size_t decomp_cap = payload_len * 4;
        if (decomp_cap < 1024) decomp_cap = 1024;

        uint8_t *decompressed = NULL;
        int zrc;
        for (int attempt = 0; attempt < 10; attempt++) {
            decompressed = (uint8_t *)malloc(decomp_cap);
            if (!decompressed) { free(result); return CC_ERR_ALLOC; }

            uLongf dest_len = (uLongf)decomp_cap;
            zrc = uncompress(decompressed, &dest_len, result,
                             (uLong)payload_len);
            if (zrc == Z_OK) {
                free(result);
                *out_data = decompressed;
                *out_len = (size_t)dest_len;
                return CC_OK;
            }
            free(decompressed);
            if (zrc != Z_BUF_ERROR) {
                free(result);
                return CC_ERR_ZLIB;
            }
            decomp_cap *= 2;
        }

        free(result);
        return CC_ERR_ZLIB;
    }

    *out_data = result;
    *out_len = (size_t)payload_len;
    return CC_OK;
}
