/*
 * png.c — PNG encoder/decoder.
 * Supports RGBA color type (6) at 8-bit and 16-bit depth.
 * Uses zlib for deflate/inflate.
 */

#define CHROMACODE_INTERNAL
#include "chromacode.h"
#include <stdlib.h>
#include <string.h>
#include <zlib.h>

static const uint8_t PNG_SIGNATURE[8] = {137, 80, 78, 71, 13, 10, 26, 10};

/* ── Helpers: big-endian read/write ──────────────────────────────── */

static void write_u32be(uint8_t *dst, uint32_t val)
{
    dst[0] = (uint8_t)(val >> 24);
    dst[1] = (uint8_t)(val >> 16);
    dst[2] = (uint8_t)(val >>  8);
    dst[3] = (uint8_t)(val);
}

static uint32_t read_u32be(const uint8_t *src)
{
    return ((uint32_t)src[0] << 24) | ((uint32_t)src[1] << 16) |
           ((uint32_t)src[2] <<  8) |  (uint32_t)src[3];
}

/* ── Write a PNG chunk ───────────────────────────────────────────── */

/* Returns malloc'd chunk (length + type + data + CRC), total 12+data_len bytes */
static uint8_t *write_chunk(const char *type, const uint8_t *data, uint32_t data_len,
                            size_t *out_chunk_len)
{
    size_t chunk_len = 12 + data_len;
    uint8_t *chunk = (uint8_t *)malloc(chunk_len);
    if (!chunk) return NULL;

    write_u32be(chunk, data_len);
    memcpy(chunk + 4, type, 4);
    if (data_len > 0) {
        memcpy(chunk + 8, data, data_len);
    }

    /* CRC over type + data */
    uint32_t crc = 0xFFFFFFFFu;
    crc = cc_crc32_update(crc, chunk + 4, 4 + data_len);
    crc ^= 0xFFFFFFFFu;
    write_u32be(chunk + 8 + data_len, crc);

    *out_chunk_len = chunk_len;
    return chunk;
}

/* ── PNG Write ───────────────────────────────────────────────────── */

int cc_png_write(const uint8_t *pixels, int width, int height, int bit_depth,
                 uint8_t **out_png, size_t *out_len)
{
    int bpp = (bit_depth == 16) ? 8 : 4;
    (void)bpp; /* used below for row_bytes */

    /* IHDR data: 13 bytes */
    uint8_t ihdr[13];
    write_u32be(ihdr, (uint32_t)width);
    write_u32be(ihdr + 4, (uint32_t)height);
    ihdr[8]  = (uint8_t)bit_depth;
    ihdr[9]  = 6;  /* RGBA */
    ihdr[10] = 0;  /* deflate compression */
    ihdr[11] = 0;  /* filter method 0 */
    ihdr[12] = 0;  /* no interlace */

    /* Build raw scanlines: filter byte 0 (None) per row */
    size_t row_bytes = (size_t)width * (size_t)bpp;
    size_t raw_size = (size_t)height * (1 + row_bytes);
    uint8_t *raw = (uint8_t *)malloc(raw_size);
    if (!raw) return CC_ERR_ALLOC;

    for (int y = 0; y < height; y++) {
        size_t raw_offset = (size_t)y * (1 + row_bytes);
        raw[raw_offset] = 0; /* filter type: None */
        memcpy(raw + raw_offset + 1,
               pixels + (size_t)y * row_bytes,
               row_bytes);
    }

    /* Compress with zlib */
    uLongf comp_len = compressBound((uLong)raw_size);
    uint8_t *compressed = (uint8_t *)malloc((size_t)comp_len);
    if (!compressed) { free(raw); return CC_ERR_ALLOC; }

    int zrc = compress2(compressed, &comp_len, raw, (uLong)raw_size, Z_DEFAULT_COMPRESSION);
    free(raw);
    if (zrc != Z_OK) { free(compressed); return CC_ERR_ZLIB; }

    /* Build chunks */
    size_t ihdr_chunk_len, idat_chunk_len, iend_chunk_len;
    uint8_t *ihdr_chunk = write_chunk("IHDR", ihdr, 13, &ihdr_chunk_len);
    uint8_t *idat_chunk = write_chunk("IDAT", compressed, (uint32_t)comp_len, &idat_chunk_len);
    uint8_t *iend_chunk = write_chunk("IEND", NULL, 0, &iend_chunk_len);
    free(compressed);

    if (!ihdr_chunk || !idat_chunk || !iend_chunk) {
        free(ihdr_chunk); free(idat_chunk); free(iend_chunk);
        return CC_ERR_ALLOC;
    }

    /* Assemble final PNG */
    size_t total = 8 + ihdr_chunk_len + idat_chunk_len + iend_chunk_len;
    uint8_t *png = (uint8_t *)malloc(total);
    if (!png) {
        free(ihdr_chunk); free(idat_chunk); free(iend_chunk);
        return CC_ERR_ALLOC;
    }

    size_t offset = 0;
    memcpy(png + offset, PNG_SIGNATURE, 8); offset += 8;
    memcpy(png + offset, ihdr_chunk, ihdr_chunk_len); offset += ihdr_chunk_len;
    memcpy(png + offset, idat_chunk, idat_chunk_len); offset += idat_chunk_len;
    memcpy(png + offset, iend_chunk, iend_chunk_len);

    free(ihdr_chunk);
    free(idat_chunk);
    free(iend_chunk);

    *out_png = png;
    *out_len = total;
    return CC_OK;
}

/* ── Paeth predictor ─────────────────────────────────────────────── */

static int paeth_predictor(int a, int b, int c)
{
    int p = a + b - c;
    int pa = p - a; if (pa < 0) pa = -pa;
    int pb = p - b; if (pb < 0) pb = -pb;
    int pc = p - c; if (pc < 0) pc = -pc;
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}

/* ── PNG unfilter ────────────────────────────────────────────────── */

static int unfilter(const uint8_t *raw_data, size_t raw_len,
                    int width, int height, int bpp,
                    uint8_t *pixels)
{
    size_t row_bytes = (size_t)width * (size_t)bpp;

    for (int y = 0; y < height; y++) {
        size_t raw_row_start = (size_t)y * (1 + row_bytes);
        if (raw_row_start >= raw_len) return CC_ERR_PNG;
        uint8_t filter_type = raw_data[raw_row_start];
        const uint8_t *src_row = raw_data + raw_row_start + 1;
        size_t dst_offset = (size_t)y * row_bytes;

        for (size_t x = 0; x < row_bytes; x++) {
            int a = (x >= (size_t)bpp) ? pixels[dst_offset + x - bpp] : 0;
            int b = (y > 0) ? pixels[dst_offset - row_bytes + x] : 0;
            int c = (x >= (size_t)bpp && y > 0)
                ? pixels[dst_offset - row_bytes + x - bpp] : 0;

            int val;
            switch (filter_type) {
                case 0: val = src_row[x]; break;
                case 1: val = (src_row[x] + a) & 0xFF; break;
                case 2: val = (src_row[x] + b) & 0xFF; break;
                case 3: val = (src_row[x] + ((a + b) / 2)) & 0xFF; break;
                case 4: val = (src_row[x] + paeth_predictor(a, b, c)) & 0xFF; break;
                default: return CC_ERR_PNG;
            }
            pixels[dst_offset + x] = (uint8_t)val;
        }
    }

    return CC_OK;
}

/* ── PNG Read ────────────────────────────────────────────────────── */

int cc_png_read(const uint8_t *png, size_t png_len,
                uint8_t **out_pixels, int *out_width, int *out_height,
                int *out_bit_depth)
{
    /* Verify signature */
    if (png_len < 8) return CC_ERR_PNG;
    for (int i = 0; i < 8; i++) {
        if (png[i] != PNG_SIGNATURE[i]) return CC_ERR_PNG;
    }

    int width = 0, height = 0, bit_depth = 0, color_type = 0;
    int got_ihdr = 0;

    /* Accumulate IDAT data */
    size_t idat_cap = 4096;
    size_t idat_len = 0;
    uint8_t *idat_data = (uint8_t *)malloc(idat_cap);
    if (!idat_data) return CC_ERR_ALLOC;

    size_t offset = 8;
    while (offset + 12 <= png_len) {
        uint32_t chunk_data_len = read_u32be(png + offset);
        const uint8_t *chunk_type = png + offset + 4;
        const uint8_t *chunk_data = png + offset + 8;

        if (offset + 12 + chunk_data_len > png_len) break;

        /* Verify chunk CRC */
        uint32_t stored_crc = read_u32be(png + offset + 8 + chunk_data_len);
        uint32_t crc = 0xFFFFFFFFu;
        crc = cc_crc32_update(crc, chunk_type, 4 + chunk_data_len);
        crc ^= 0xFFFFFFFFu;
        if (stored_crc != crc) { free(idat_data); return CC_ERR_PNG; }

        if (memcmp(chunk_type, "IHDR", 4) == 0 && chunk_data_len >= 13) {
            width = (int)read_u32be(chunk_data);
            height = (int)read_u32be(chunk_data + 4);
            bit_depth = chunk_data[8];
            color_type = chunk_data[9];
            if (color_type != 6) {
                free(idat_data);
                return CC_ERR_PNG;
            }
            if (bit_depth != 8 && bit_depth != 16) {
                free(idat_data);
                return CC_ERR_PNG;
            }
            got_ihdr = 1;
        } else if (memcmp(chunk_type, "IDAT", 4) == 0) {
            /* Grow buffer if needed */
            while (idat_len + chunk_data_len > idat_cap) {
                idat_cap *= 2;
                uint8_t *tmp = (uint8_t *)realloc(idat_data, idat_cap);
                if (!tmp) { free(idat_data); return CC_ERR_ALLOC; }
                idat_data = tmp;
            }
            memcpy(idat_data + idat_len, chunk_data, chunk_data_len);
            idat_len += chunk_data_len;
        } else if (memcmp(chunk_type, "IEND", 4) == 0) {
            break;
        }

        offset += 12 + chunk_data_len;
    }

    if (!got_ihdr || width == 0 || height == 0 || idat_len == 0) {
        free(idat_data);
        return CC_ERR_PNG;
    }

    /* Decompress IDAT data */
    int bpp = (bit_depth == 16) ? 8 : 4;
    size_t row_bytes = (size_t)width * (size_t)bpp;
    size_t raw_size = (size_t)height * (1 + row_bytes);

    uint8_t *raw = (uint8_t *)malloc(raw_size);
    if (!raw) { free(idat_data); return CC_ERR_ALLOC; }

    uLongf dest_len = (uLongf)raw_size;
    int zrc = uncompress(raw, &dest_len, idat_data, (uLong)idat_len);
    free(idat_data);
    if (zrc != Z_OK) { free(raw); return CC_ERR_ZLIB; }

    /* Unfilter */
    size_t pixel_size = (size_t)width * (size_t)height * (size_t)bpp;
    uint8_t *pixels = (uint8_t *)calloc(pixel_size, 1);
    if (!pixels) { free(raw); return CC_ERR_ALLOC; }

    int rc = unfilter(raw, dest_len, width, height, bpp, pixels);
    free(raw);
    if (rc != CC_OK) { free(pixels); return rc; }

    *out_pixels = pixels;
    *out_width = width;
    *out_height = height;
    *out_bit_depth = bit_depth;
    return CC_OK;
}
