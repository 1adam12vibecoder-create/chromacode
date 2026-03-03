/*
 * grid.c — Grid layout, finder/alignment/timing patterns, header codec,
 *          and data cell ordering (serpentine fill).
 */

#define CHROMACODE_INTERNAL
#include "chromacode.h"
#include <stdlib.h>
#include <string.h>

/* ── Finder pattern colors ───────────────────────────────────────── */

/* 8-bit RGB: layer 0=outer, 1=white, 2=violet, 3=center(=outer) */
static const uint8_t FINDER_RGB8[4][3] = {
    { 79,  70, 229},  /* Layer 0 — brand indigo #4f46e5 */
    {255, 255, 255},  /* Layer 1 — white */
    {124,  58, 237},  /* Layer 2 — brand violet #7c3aed */
    { 79,  70, 229},  /* Layer 3 — same as layer 0 */
};

/* 16-bit RGB: each 8-bit value × 257 */
static const uint16_t FINDER_RGB16[4][3] = {
    { 79*257,  70*257, 229*257},
    {255*257, 255*257, 255*257},
    {124*257,  58*257, 237*257},
    { 79*257,  70*257, 229*257},
};

/* ── Pixel helpers ───────────────────────────────────────────────── */

static void set_pixel_color(uint8_t *pixel, int bit_depth,
                            int layer)
{
    if (bit_depth == 16) {
        uint16_t r = FINDER_RGB16[layer][0];
        uint16_t g = FINDER_RGB16[layer][1];
        uint16_t b = FINDER_RGB16[layer][2];
        pixel[0] = (uint8_t)(r >> 8); pixel[1] = (uint8_t)(r & 0xFF);
        pixel[2] = (uint8_t)(g >> 8); pixel[3] = (uint8_t)(g & 0xFF);
        pixel[4] = (uint8_t)(b >> 8); pixel[5] = (uint8_t)(b & 0xFF);
        pixel[6] = 0xFF; pixel[7] = 0xFF; /* alpha = 65535 */
    } else {
        pixel[0] = FINDER_RGB8[layer][0];
        pixel[1] = FINDER_RGB8[layer][1];
        pixel[2] = FINDER_RGB8[layer][2];
        pixel[3] = 255;
    }
}

/* Determine layer from distance to edge of pattern */
static int min4(int a, int b, int c, int d)
{
    int m = a;
    if (b < m) m = b;
    if (c < m) m = c;
    if (d < m) m = d;
    return m;
}

void cc_finder_pixel(int x, int y, int bit_depth, uint8_t *pixel)
{
    int dist = min4(x, y, CC_FINDER_SIZE - 1 - x, CC_FINDER_SIZE - 1 - y);
    int layer = dist < 4 ? dist : 3;
    set_pixel_color(pixel, bit_depth, layer);
}

void cc_alignment_pixel(int x, int y, int bit_depth, uint8_t *pixel)
{
    int dist = min4(x, y, CC_ALIGNMENT_SIZE - 1 - x, CC_ALIGNMENT_SIZE - 1 - y);
    int layer = dist < 4 ? dist : 3;
    set_pixel_color(pixel, bit_depth, layer);
}

void cc_timing_pixel(int index, int bit_depth, uint8_t *pixel)
{
    /* Even index → dark (layer 0), odd → light (layer 1) */
    int layer = (index % 2 == 0) ? 0 : 1;
    set_pixel_color(pixel, bit_depth, layer);
}

/* ── Grid allocation ─────────────────────────────────────────────── */

int cc_grid_alloc(int width, int height, cc_grid *grid)
{
    grid->width = width;
    grid->height = height;

    /* Allocate cells flat array */
    size_t cell_count = (size_t)width * (size_t)height;
    grid->cells = (uint8_t *)malloc(cell_count);
    if (!grid->cells) return CC_ERR_ALLOC;

    /* Initialize all as data */
    memset(grid->cells, CC_CELL_DATA, cell_count);

    /* Top-left finder */
    for (int y = 0; y < CC_FINDER_SIZE; y++)
        for (int x = 0; x < CC_FINDER_SIZE; x++)
            grid->cells[y * width + x] = CC_CELL_FINDER;

    /* Top-right finder */
    for (int y = 0; y < CC_FINDER_SIZE; y++)
        for (int x = width - CC_FINDER_SIZE; x < width; x++)
            grid->cells[y * width + x] = CC_CELL_FINDER;

    /* Bottom-left finder */
    for (int y = height - CC_FINDER_SIZE; y < height; y++)
        for (int x = 0; x < CC_FINDER_SIZE; x++)
            grid->cells[y * width + x] = CC_CELL_FINDER;

    /* Bottom-right alignment */
    for (int y = height - CC_ALIGNMENT_SIZE; y < height; y++)
        for (int x = width - CC_ALIGNMENT_SIZE; x < width; x++)
            grid->cells[y * width + x] = CC_CELL_ALIGNMENT;

    /* Horizontal timing: row FINDER_SIZE, x from FINDER_SIZE to width-FINDER_SIZE-1 */
    for (int x = CC_FINDER_SIZE; x < width - CC_FINDER_SIZE; x++)
        grid->cells[CC_FINDER_SIZE * width + x] = CC_CELL_TIMING;

    /* Vertical timing: col FINDER_SIZE, y from FINDER_SIZE to height-FINDER_SIZE-1 */
    for (int y = CC_FINDER_SIZE; y < height - CC_FINDER_SIZE; y++)
        grid->cells[y * width + CC_FINDER_SIZE] = CC_CELL_TIMING;

    /* Collect data coords in serpentine order */
    /* First pass: count data cells */
    int data_count = 0;
    for (int y = 0; y < height; y++)
        for (int x = 0; x < width; x++)
            if (grid->cells[y * width + x] == CC_CELL_DATA)
                data_count++;

    grid->data_coords = (int32_t *)malloc((size_t)data_count * 2 * sizeof(int32_t));
    if (!grid->data_coords) {
        free(grid->cells);
        grid->cells = NULL;
        return CC_ERR_ALLOC;
    }

    int idx = 0;
    for (int y = 0; y < height; y++) {
        if (y % 2 == 0) {
            /* Left to right */
            for (int x = 0; x < width; x++) {
                if (grid->cells[y * width + x] == CC_CELL_DATA) {
                    grid->data_coords[idx * 2]     = x;
                    grid->data_coords[idx * 2 + 1] = y;
                    idx++;
                }
            }
        } else {
            /* Right to left */
            for (int x = width - 1; x >= 0; x--) {
                if (grid->cells[y * width + x] == CC_CELL_DATA) {
                    grid->data_coords[idx * 2]     = x;
                    grid->data_coords[idx * 2 + 1] = y;
                    idx++;
                }
            }
        }
    }
    grid->data_count = data_count;

    return CC_OK;
}

void cc_grid_free(cc_grid *grid)
{
    free(grid->cells);
    free(grid->data_coords);
    grid->cells = NULL;
    grid->data_coords = NULL;
    grid->data_count = 0;
}

/* ── Structural cell counting ────────────────────────────────────── */

int cc_structural_cell_count(int width, int height)
{
    int finders = 3 * CC_FINDER_SIZE * CC_FINDER_SIZE; /* 147 */
    int alignment = CC_ALIGNMENT_SIZE * CC_ALIGNMENT_SIZE; /* 25 */
    int h_timing = width - 2 * CC_FINDER_SIZE;
    int v_timing = height - 2 * CC_FINDER_SIZE;
    if (h_timing < 0) h_timing = 0;
    if (v_timing < 0) v_timing = 0;
    /* Subtract 1 for intersection at (FINDER_SIZE, FINDER_SIZE) */
    int timing_total = h_timing + v_timing - 1;
    if (timing_total < 0) timing_total = 0;

    return finders + alignment + timing_total;
}

int cc_data_cell_count(int width, int height)
{
    return width * height - cc_structural_cell_count(width, height);
}

/* ── Header ──────────────────────────────────────────────────────── */

int cc_header_size(int has_sequence)
{
    return has_sequence ? 18 : 14;
}

int cc_encode_header(const cc_header *meta, uint8_t *buf)
{
    int has_seq = meta->has_sequence;
    int size = has_seq ? 18 : 14;

    memset(buf, 0, (size_t)size);

    /* Byte 0: version(4) | mode(4) */
    buf[0] = (uint8_t)(((meta->version & 0x0F) << 4) | (meta->mode & 0x0F));

    /* Byte 1: ecLevel(2) | hasSeq(1) | compressed(1) | reserved(4) */
    buf[1] = (uint8_t)(((meta->ec_level & 0x03) << 6)
                       | (has_seq ? 0x20 : 0)
                       | (meta->compressed ? 0x10 : 0));

    /* Bytes 2-4: gridWidth(12) | gridHeight(12) */
    uint16_t gw = (uint16_t)(meta->grid_width & 0xFFF);
    uint16_t gh = (uint16_t)(meta->grid_height & 0xFFF);
    buf[2] = (uint8_t)((gw >> 4) & 0xFF);
    buf[3] = (uint8_t)(((gw & 0x0F) << 4) | ((gh >> 8) & 0x0F));
    buf[4] = (uint8_t)(gh & 0xFF);

    /* Bytes 5-8: dataLength (32-bit big-endian) */
    buf[5] = (uint8_t)(meta->data_length >> 24);
    buf[6] = (uint8_t)(meta->data_length >> 16);
    buf[7] = (uint8_t)(meta->data_length >>  8);
    buf[8] = (uint8_t)(meta->data_length);

    /* Bytes 9-12: sequence (if present) */
    int offset = 9;
    if (has_seq) {
        buf[offset]     = (uint8_t)(meta->seq_id >> 8);
        buf[offset + 1] = (uint8_t)(meta->seq_id);
        buf[offset + 2] = meta->seq_index;
        buf[offset + 3] = meta->seq_total;
        offset += 4;
    }

    /* Last 2 bytes: CRC16 = lower 16 bits of CRC32 */
    uint32_t crc = cc_crc32(buf, (size_t)(size - 2));
    uint16_t crc16 = (uint16_t)(crc & 0xFFFF);
    buf[size - 2] = (uint8_t)(crc16 >> 8);
    buf[size - 1] = (uint8_t)(crc16);

    return CC_OK;
}

int cc_decode_header(const uint8_t *buf, int buf_len, cc_header *meta)
{
    if (buf_len < 14) return CC_ERR_HEADER;

    meta->version = (buf[0] >> 4) & 0x0F;
    meta->mode = buf[0] & 0x0F;
    meta->ec_level = (buf[1] >> 6) & 0x03;
    meta->has_sequence = (buf[1] & 0x20) ? 1 : 0;
    meta->compressed = (buf[1] & 0x10) ? 1 : 0;

    int expected_size = meta->has_sequence ? 18 : 14;
    if (buf_len < expected_size) return CC_ERR_HEADER;

    /* Verify CRC */
    uint32_t crc = cc_crc32(buf, (size_t)(expected_size - 2));
    uint16_t expected_crc = (uint16_t)(crc & 0xFFFF);
    uint16_t actual_crc = (uint16_t)((buf[expected_size - 2] << 8) | buf[expected_size - 1]);
    if (expected_crc != actual_crc) return CC_ERR_HEADER;

    meta->grid_width = ((buf[2] << 4) | (buf[3] >> 4)) & 0xFFF;
    meta->grid_height = (((buf[3] & 0x0F) << 8) | buf[4]) & 0xFFF;
    meta->data_length = ((uint32_t)buf[5] << 24) | ((uint32_t)buf[6] << 16)
                      | ((uint32_t)buf[7] << 8)  |  (uint32_t)buf[8];

    if (meta->mode > 3) return CC_ERR_HEADER;
    if (meta->ec_level > 3) return CC_ERR_HEADER;

    if (meta->has_sequence) {
        meta->seq_id = (uint16_t)((buf[9] << 8) | buf[10]);
        meta->seq_index = buf[11];
        meta->seq_total = buf[12];
    } else {
        meta->seq_id = 0;
        meta->seq_index = 0;
        meta->seq_total = 0;
    }

    return CC_OK;
}
