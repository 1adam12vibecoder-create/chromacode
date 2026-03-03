/*
 * test_chromacode.c — C unit tests for the ChromaCode library.
 * Simple test framework: no dependencies, just assert + printf.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include <time.h>

#define CHROMACODE_INTERNAL
#include "chromacode.h"

static int tests_run = 0;
static int tests_passed = 0;

#define TEST(name) \
    do { \
        tests_run++; \
        printf("  %-50s", name); \
        fflush(stdout); \
    } while(0)

#define PASS() \
    do { \
        tests_passed++; \
        printf("PASS\n"); \
    } while(0)

#define FAIL(msg) \
    do { \
        printf("FAIL: %s\n", msg); \
    } while(0)

/* ════════════════════════════════════════════════════════════════════
 * CRC32 Tests
 * ════════════════════════════════════════════════════════════════════ */

static void test_crc32(void)
{
    printf("\n--- CRC32 ---\n");

    /* Empty data */
    TEST("crc32 empty");
    uint32_t crc = cc_crc32(NULL, 0);
    /* CRC of empty = 0x00000000 */
    if (crc == 0x00000000) { PASS(); } else { FAIL("wrong crc for empty"); }

    /* "123456789" → 0xCBF43926 */
    TEST("crc32 of '123456789'");
    const uint8_t data[] = "123456789";
    crc = cc_crc32(data, 9);
    if (crc == 0xCBF43926) { PASS(); } else { FAIL("wrong crc"); }

    /* Single zero byte */
    TEST("crc32 of [0x00]");
    uint8_t zero = 0;
    crc = cc_crc32(&zero, 1);
    if (crc == 0xD202EF8D) { PASS(); } else { FAIL("wrong crc"); }

    /* Multi-buffer */
    TEST("crc32_update multi-buffer");
    const uint8_t a[] = "1234";
    const uint8_t b[] = "56789";
    uint32_t crc2 = 0xFFFFFFFF;
    crc2 = cc_crc32_update(crc2, a, 4);
    crc2 = cc_crc32_update(crc2, b, 5);
    crc2 ^= 0xFFFFFFFF;
    if (crc2 == 0xCBF43926) { PASS(); } else { FAIL("multi-buffer mismatch"); }
}

/* ════════════════════════════════════════════════════════════════════
 * GF(2^8) Tests
 * ════════════════════════════════════════════════════════════════════ */

static void test_gf256(void)
{
    printf("\n--- GF(2^8) ---\n");
    cc_gf_init();

    /* EXP[0] = 1 (alpha^0 = 1) */
    TEST("exp[0] = 1");
    if (cc_gf_exp[0] == 1) { PASS(); } else { FAIL("wrong"); }

    /* EXP[1] = 2 */
    TEST("exp[1] = 2");
    if (cc_gf_exp[1] == 2) { PASS(); } else { FAIL("wrong"); }

    /* All non-zero elements appear exactly once in EXP[0..254] */
    TEST("exp table covers all non-zero elements");
    {
        int seen[256];
        memset(seen, 0, sizeof(seen));
        for (int i = 0; i < 255; i++) seen[cc_gf_exp[i]]++;
        int ok = 1;
        for (int i = 1; i < 256; i++) {
            if (seen[i] != 1) { ok = 0; break; }
        }
        if (ok) { PASS(); } else { FAIL("not all elements present"); }
    }

    /* Multiply */
    TEST("mul: basic");
    if (cc_gf_mul(0, 5) == 0 && cc_gf_mul(1, 7) == 7 &&
        cc_gf_mul(2, 3) == 6) { PASS(); } else { FAIL("wrong"); }

    /* Divide */
    TEST("div: a * b / b = a");
    {
        int ok = 1;
        for (int a = 1; a < 256; a++) {
            uint8_t b = 37;
            uint8_t prod = cc_gf_mul((uint8_t)a, b);
            uint8_t back = cc_gf_div(prod, b);
            if (back != (uint8_t)a) { ok = 0; break; }
        }
        if (ok) { PASS(); } else { FAIL("div roundtrip failed"); }
    }

    /* Inverse */
    TEST("inv: a * inv(a) = 1");
    {
        int ok = 1;
        for (int a = 1; a < 256; a++) {
            uint8_t inv = cc_gf_inv((uint8_t)a);
            if (cc_gf_mul((uint8_t)a, inv) != 1) { ok = 0; break; }
        }
        if (ok) { PASS(); } else { FAIL("inverse failed"); }
    }

    /* polyEval */
    TEST("polyEval: constant polynomial");
    {
        uint8_t poly[] = {42};
        if (cc_gf_poly_eval(poly, 1, 100) == 42) { PASS(); } else { FAIL("wrong"); }
    }

    /* polyMul */
    TEST("polyMul: (x+1)(x+2) = x^2 + 3x + 2");
    {
        uint8_t a[] = {1, 1};   /* x + 1 */
        uint8_t b[] = {1, 2};   /* x + 2 */
        uint8_t r[3];
        cc_gf_poly_mul(a, 2, b, 2, r);
        /* In GF(2^8): 1+2 = 3 */
        if (r[0] == 1 && r[1] == 3 && r[2] == 2) { PASS(); } else { FAIL("wrong"); }
    }
}

/* ════════════════════════════════════════════════════════════════════
 * Reed-Solomon Tests
 * ════════════════════════════════════════════════════════════════════ */

static void test_reed_solomon(void)
{
    printf("\n--- Reed-Solomon ---\n");
    cc_gf_init();

    /* ecSymbolCount */
    TEST("ecSymbolCount minimum 2");
    if (cc_rs_ec_symbol_count(1, 7) == 2) { PASS(); } else { FAIL("wrong"); }

    TEST("ecSymbolCount L for 100 bytes");
    {
        /* ceil(100 * 0.07 / 0.93) = ceil(7.527) = 8 */
        int ec = cc_rs_ec_symbol_count(100, 7);
        if (ec == 8) { PASS(); } else { FAIL("wrong"); }
    }

    /* RS encode/decode no errors */
    TEST("rs encode/decode clean roundtrip");
    {
        uint8_t data[] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10};
        int data_len = 10;
        int ec_count = cc_rs_ec_symbol_count(data_len, 7);
        int total = data_len + ec_count;
        uint8_t *encoded = (uint8_t *)malloc((size_t)total);
        cc_rs_encode(data, data_len, ec_count, encoded);

        uint8_t *decoded = (uint8_t *)malloc((size_t)data_len);
        int rc = cc_rs_decode(encoded, total, ec_count, decoded);

        int ok = (rc == CC_OK) && (memcmp(decoded, data, (size_t)data_len) == 0);
        free(encoded); free(decoded);
        if (ok) { PASS(); } else { FAIL("roundtrip failed"); }
    }

    /* RS decode with single error */
    TEST("rs decode with 1 error");
    {
        uint8_t data[] = {10, 20, 30, 40, 50};
        int data_len = 5;
        int ec_count = cc_rs_ec_symbol_count(data_len, 15); /* M level */
        int total = data_len + ec_count;
        uint8_t *encoded = (uint8_t *)malloc((size_t)total);
        cc_rs_encode(data, data_len, ec_count, encoded);

        /* Introduce 1 error */
        encoded[2] ^= 0x42;

        uint8_t *decoded = (uint8_t *)malloc((size_t)data_len);
        int rc = cc_rs_decode(encoded, total, ec_count, decoded);

        int ok = (rc == CC_OK) && (memcmp(decoded, data, (size_t)data_len) == 0);
        free(encoded); free(decoded);
        if (ok) { PASS(); } else { FAIL("error correction failed"); }
    }

    /* RS decode with multiple errors */
    TEST("rs decode with multiple errors (H level)");
    {
        uint8_t data[50];
        for (int i = 0; i < 50; i++) data[i] = (uint8_t)(i * 3 + 7);
        int data_len = 50;
        int ec_count = cc_rs_ec_symbol_count(data_len, 30); /* H level */
        int total = data_len + ec_count;
        uint8_t *encoded = (uint8_t *)malloc((size_t)total);
        cc_rs_encode(data, data_len, ec_count, encoded);

        /* Introduce errors (up to ec_count/2) */
        int max_errors = ec_count / 2;
        for (int i = 0; i < max_errors && i < 5; i++) {
            encoded[i * 7 % total] ^= (uint8_t)(0x11 + i);
        }

        uint8_t *decoded = (uint8_t *)malloc((size_t)data_len);
        int rc = cc_rs_decode(encoded, total, ec_count, decoded);

        int ok = (rc == CC_OK) && (memcmp(decoded, data, (size_t)data_len) == 0);
        free(encoded); free(decoded);
        if (ok) { PASS(); } else { FAIL("multi-error correction failed"); }
    }
}

/* ════════════════════════════════════════════════════════════════════
 * PNG Tests
 * ════════════════════════════════════════════════════════════════════ */

static void test_png(void)
{
    printf("\n--- PNG ---\n");

    /* 8-bit round-trip */
    TEST("png 8-bit round-trip 4x4");
    {
        int w = 4, h = 4, bpp = 4;
        size_t pix_size = (size_t)(w * h * bpp);
        uint8_t *pixels = (uint8_t *)malloc(pix_size);
        for (size_t i = 0; i < pix_size; i++) pixels[i] = (uint8_t)(i & 0xFF);

        uint8_t *png_data = NULL;
        size_t png_len = 0;
        int rc = cc_png_write(pixels, w, h, 8, &png_data, &png_len);
        if (rc != CC_OK) { free(pixels); FAIL("write failed"); return; }

        uint8_t *decoded = NULL;
        int dw, dh, dbd;
        rc = cc_png_read(png_data, png_len, &decoded, &dw, &dh, &dbd);
        free(png_data);

        int ok = (rc == CC_OK) && (dw == w) && (dh == h) && (dbd == 8)
                 && (memcmp(decoded, pixels, pix_size) == 0);
        free(pixels); free(decoded);
        if (ok) { PASS(); } else { FAIL("8-bit roundtrip mismatch"); }
    }

    /* 16-bit round-trip */
    TEST("png 16-bit round-trip 4x4");
    {
        int w = 4, h = 4, bpp = 8;
        size_t pix_size = (size_t)(w * h * bpp);
        uint8_t *pixels = (uint8_t *)malloc(pix_size);
        for (size_t i = 0; i < pix_size; i++) pixels[i] = (uint8_t)((i * 7) & 0xFF);

        uint8_t *png_data = NULL;
        size_t png_len = 0;
        int rc = cc_png_write(pixels, w, h, 16, &png_data, &png_len);
        if (rc != CC_OK) { free(pixels); FAIL("write failed"); return; }

        uint8_t *decoded = NULL;
        int dw, dh, dbd;
        rc = cc_png_read(png_data, png_len, &decoded, &dw, &dh, &dbd);
        free(png_data);

        int ok = (rc == CC_OK) && (dw == w) && (dh == h) && (dbd == 16)
                 && (memcmp(decoded, pixels, pix_size) == 0);
        free(pixels); free(decoded);
        if (ok) { PASS(); } else { FAIL("16-bit roundtrip mismatch"); }
    }
}

/* ════════════════════════════════════════════════════════════════════
 * Header Tests
 * ════════════════════════════════════════════════════════════════════ */

static void test_header(void)
{
    printf("\n--- Header ---\n");

    TEST("header encode/decode no sequence");
    {
        cc_header meta = {0};
        meta.version = 1;
        meta.mode = CC_MODE_RGBA64;
        meta.ec_level = CC_EC_L;
        meta.compressed = 0;
        meta.grid_width = 32;
        meta.grid_height = 32;
        meta.data_length = 1024;
        meta.has_sequence = 0;

        uint8_t buf[32];
        cc_encode_header(&meta, buf);

        cc_header decoded;
        int rc = cc_decode_header(buf, 14, &decoded);
        int ok = (rc == CC_OK)
            && decoded.version == 1
            && decoded.mode == CC_MODE_RGBA64
            && decoded.ec_level == CC_EC_L
            && decoded.grid_width == 32
            && decoded.grid_height == 32
            && decoded.data_length == 1024
            && decoded.compressed == 0
            && decoded.has_sequence == 0;
        if (ok) { PASS(); } else { FAIL("decode mismatch"); }
    }

    TEST("header encode/decode with sequence");
    {
        cc_header meta = {0};
        meta.version = 1;
        meta.mode = CC_MODE_RGB24;
        meta.ec_level = CC_EC_H;
        meta.compressed = 1;
        meta.grid_width = 100;
        meta.grid_height = 200;
        meta.data_length = 50000;
        meta.has_sequence = 1;
        meta.seq_id = 12345;
        meta.seq_index = 3;
        meta.seq_total = 10;

        uint8_t buf[32];
        cc_encode_header(&meta, buf);

        cc_header decoded;
        int rc = cc_decode_header(buf, 18, &decoded);
        int ok = (rc == CC_OK)
            && decoded.version == 1
            && decoded.mode == CC_MODE_RGB24
            && decoded.ec_level == CC_EC_H
            && decoded.compressed == 1
            && decoded.grid_width == 100
            && decoded.grid_height == 200
            && decoded.data_length == 50000
            && decoded.has_sequence == 1
            && decoded.seq_id == 12345
            && decoded.seq_index == 3
            && decoded.seq_total == 10;
        if (ok) { PASS(); } else { FAIL("sequence decode mismatch"); }
    }

    TEST("header CRC verification");
    {
        cc_header meta = {0};
        meta.version = 1;
        meta.mode = CC_MODE_RGBA32;
        meta.ec_level = CC_EC_M;
        meta.grid_width = 16;
        meta.grid_height = 16;
        meta.data_length = 42;

        uint8_t buf[32];
        cc_encode_header(&meta, buf);

        /* Corrupt a byte */
        buf[5] ^= 0xFF;

        cc_header decoded;
        int rc = cc_decode_header(buf, 14, &decoded);
        if (rc != CC_OK) { PASS(); } else { FAIL("CRC should have failed"); }
    }
}

/* ════════════════════════════════════════════════════════════════════
 * Grid Tests
 * ════════════════════════════════════════════════════════════════════ */

static void test_grid(void)
{
    printf("\n--- Grid ---\n");

    TEST("structural cell count 16x16");
    {
        /* 3 finders (147) + alignment (25) + timing (2+2-1=3) = 175 */
        int s = cc_structural_cell_count(16, 16);
        if (s == 175) { PASS(); } else { FAIL("wrong count"); }
    }

    TEST("data cell count 16x16");
    {
        int d = cc_data_cell_count(16, 16);
        if (d == 16*16 - 175) { PASS(); } else { FAIL("wrong count"); }
    }

    TEST("grid alloc serpentine order");
    {
        cc_grid grid;
        int rc = cc_grid_alloc(16, 16, &grid);
        if (rc != CC_OK) { FAIL("alloc failed"); return; }
        if (grid.data_count == cc_data_cell_count(16, 16)) { PASS(); } else { FAIL("wrong data count"); }
        cc_grid_free(&grid);
    }
}

/* ════════════════════════════════════════════════════════════════════
 * Interleave Tests
 * ════════════════════════════════════════════════════════════════════ */

static void test_interleave(void)
{
    printf("\n--- Interleave ---\n");

    TEST("interleave 2 equal blocks");
    {
        uint8_t a[] = {1, 2, 3};
        uint8_t b[] = {4, 5, 6};
        const uint8_t *blocks[] = {a, b};
        int sizes[] = {3, 3};
        uint8_t out[6];
        cc_interleave(blocks, sizes, 2, out);
        uint8_t expected[] = {1, 4, 2, 5, 3, 6};
        if (memcmp(out, expected, 6) == 0) { PASS(); } else { FAIL("wrong order"); }
    }

    TEST("deinterleave roundtrip");
    {
        uint8_t a[] = {10, 20, 30, 40};
        uint8_t b[] = {50, 60, 70};
        const uint8_t *blocks[] = {a, b};
        int sizes[] = {4, 3};
        uint8_t interleaved[7];
        cc_interleave(blocks, sizes, 2, interleaved);

        uint8_t da[4], db[3];
        uint8_t *dblocks[] = {da, db};
        cc_deinterleave(interleaved, 7, dblocks, sizes, 2);

        int ok = (memcmp(da, a, 4) == 0) && (memcmp(db, b, 3) == 0);
        if (ok) { PASS(); } else { FAIL("roundtrip failed"); }
    }
}

/* ════════════════════════════════════════════════════════════════════
 * Channels Tests
 * ════════════════════════════════════════════════════════════════════ */

static void test_channels(void)
{
    printf("\n--- Channels ---\n");

    TEST("rgba64 round-trip");
    {
        uint8_t data[] = {0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0};
        uint8_t pixel[8], result[8];
        cc_encode_cell(data, CC_MODE_RGBA64, pixel);
        cc_decode_cell(pixel, CC_MODE_RGBA64, result);
        if (memcmp(data, result, 8) == 0) { PASS(); } else { FAIL("mismatch"); }
    }

    TEST("rgba32 round-trip");
    {
        uint8_t data[] = {0xAA, 0xBB, 0xCC, 0xDD};
        uint8_t pixel[4], result[4];
        cc_encode_cell(data, CC_MODE_RGBA32, pixel);
        cc_decode_cell(pixel, CC_MODE_RGBA32, result);
        if (memcmp(data, result, 4) == 0) { PASS(); } else { FAIL("mismatch"); }
    }

    TEST("rgb48 round-trip");
    {
        uint8_t data[] = {0x11, 0x22, 0x33, 0x44, 0x55, 0x66};
        uint8_t pixel[8], result[6];
        cc_encode_cell(data, CC_MODE_RGB48, pixel);
        cc_decode_cell(pixel, CC_MODE_RGB48, result);
        if (memcmp(data, result, 6) == 0) { PASS(); } else { FAIL("mismatch"); }
    }

    TEST("rgb24 round-trip");
    {
        uint8_t data[] = {0xFE, 0xDC, 0xBA};
        uint8_t pixel[4], result[3];
        cc_encode_cell(data, CC_MODE_RGB24, pixel);
        cc_decode_cell(pixel, CC_MODE_RGB24, result);
        if (memcmp(data, result, 3) == 0) { PASS(); } else { FAIL("mismatch"); }
    }

    TEST("rgb modes set alpha to max");
    {
        uint8_t data6[] = {1,2,3,4,5,6};
        uint8_t pixel8[8];
        cc_encode_cell(data6, CC_MODE_RGB48, pixel8);
        if (pixel8[6] == 0xFF && pixel8[7] == 0xFF) { PASS(); } else { FAIL("alpha not max"); }
    }
}

/* ════════════════════════════════════════════════════════════════════
 * Full Encode/Decode Round-Trip Tests
 * ════════════════════════════════════════════════════════════════════ */

static void test_roundtrip(void)
{
    printf("\n--- Full Round-Trip ---\n");

    /* Small data, default options */
    TEST("roundtrip: 10 bytes, rgba64, EC_L");
    {
        uint8_t data[] = {1,2,3,4,5,6,7,8,9,10};
        uint8_t *png = NULL;
        size_t png_len = 0;
        int rc = cc_encode(data, 10, NULL, &png, &png_len);
        if (rc != CC_OK) { FAIL("encode failed"); return; }

        uint8_t *decoded = NULL;
        size_t decoded_len = 0;
        rc = cc_decode(png, png_len, &decoded, &decoded_len);
        free(png);
        if (rc != CC_OK) { free(decoded); FAIL("decode failed"); return; }

        int ok = (decoded_len == 10) && (memcmp(decoded, data, 10) == 0);
        free(decoded);
        if (ok) { PASS(); } else { FAIL("data mismatch"); }
    }

    /* All modes */
    int modes[] = {CC_MODE_RGBA64, CC_MODE_RGBA32, CC_MODE_RGB48, CC_MODE_RGB24};
    const char *mode_names[] = {"rgba64", "rgba32", "rgb48", "rgb24"};

    for (int mi = 0; mi < 4; mi++) {
        char buf[80];
        snprintf(buf, sizeof(buf), "roundtrip: 100 bytes, %s, EC_M", mode_names[mi]);
        TEST(buf);

        uint8_t data[100];
        for (int i = 0; i < 100; i++) data[i] = (uint8_t)(i * 3 + 17);

        cc_options opts = cc_defaults();
        opts.mode = modes[mi];
        opts.ec_level = CC_EC_M;

        uint8_t *png = NULL;
        size_t png_len = 0;
        int rc = cc_encode(data, 100, &opts, &png, &png_len);
        if (rc != CC_OK) { FAIL("encode failed"); continue; }

        uint8_t *decoded = NULL;
        size_t decoded_len = 0;
        rc = cc_decode(png, png_len, &decoded, &decoded_len);
        free(png);
        if (rc != CC_OK) { free(decoded); FAIL("decode failed"); continue; }

        int ok = (decoded_len == 100) && (memcmp(decoded, data, 100) == 0);
        free(decoded);
        if (ok) { PASS(); } else { FAIL("data mismatch"); }
    }

    /* All EC levels */
    int ec_levels[] = {CC_EC_L, CC_EC_M, CC_EC_Q, CC_EC_H};
    const char *ec_names[] = {"L", "M", "Q", "H"};

    for (int ei = 0; ei < 4; ei++) {
        char buf[80];
        snprintf(buf, sizeof(buf), "roundtrip: 50 bytes, rgba64, EC_%s", ec_names[ei]);
        TEST(buf);

        uint8_t data[50];
        for (int i = 0; i < 50; i++) data[i] = (uint8_t)(i ^ 0xAA);

        cc_options opts = cc_defaults();
        opts.ec_level = ec_levels[ei];

        uint8_t *png = NULL;
        size_t png_len = 0;
        int rc = cc_encode(data, 50, &opts, &png, &png_len);
        if (rc != CC_OK) { FAIL("encode failed"); continue; }

        uint8_t *decoded = NULL;
        size_t decoded_len = 0;
        rc = cc_decode(png, png_len, &decoded, &decoded_len);
        free(png);
        if (rc != CC_OK) { free(decoded); FAIL("decode failed"); continue; }

        int ok = (decoded_len == 50) && (memcmp(decoded, data, 50) == 0);
        free(decoded);
        if (ok) { PASS(); } else { FAIL("data mismatch"); }
    }

    /* Empty data */
    TEST("roundtrip: empty data");
    {
        uint8_t *png = NULL;
        size_t png_len = 0;
        int rc = cc_encode(NULL, 0, NULL, &png, &png_len);
        if (rc != CC_OK) { FAIL("encode failed"); return; }

        uint8_t *decoded = NULL;
        size_t decoded_len = 0;
        rc = cc_decode(png, png_len, &decoded, &decoded_len);
        free(png);

        int ok = (rc == CC_OK) && (decoded_len == 0);
        free(decoded);
        if (ok) { PASS(); } else { FAIL("empty roundtrip failed"); }
    }

    /* Single byte */
    TEST("roundtrip: single byte");
    {
        uint8_t data[] = {0x42};
        uint8_t *png = NULL;
        size_t png_len = 0;
        int rc = cc_encode(data, 1, NULL, &png, &png_len);
        if (rc != CC_OK) { FAIL("encode failed"); return; }

        uint8_t *decoded = NULL;
        size_t decoded_len = 0;
        rc = cc_decode(png, png_len, &decoded, &decoded_len);
        free(png);

        int ok = (rc == CC_OK) && (decoded_len == 1) && (decoded[0] == 0x42);
        free(decoded);
        if (ok) { PASS(); } else { FAIL("single byte roundtrip failed"); }
    }

    /* CellSize > 1 */
    TEST("roundtrip: cellSize=3");
    {
        uint8_t data[] = {10,20,30,40,50};
        cc_options opts = cc_defaults();
        opts.cell_size = 3;

        uint8_t *png = NULL;
        size_t png_len = 0;
        int rc = cc_encode(data, 5, &opts, &png, &png_len);
        if (rc != CC_OK) { FAIL("encode failed"); return; }

        uint8_t *decoded = NULL;
        size_t decoded_len = 0;
        rc = cc_decode(png, png_len, &decoded, &decoded_len);
        free(png);

        int ok = (rc == CC_OK) && (decoded_len == 5) && (memcmp(decoded, data, 5) == 0);
        free(decoded);
        if (ok) { PASS(); } else { FAIL("cellSize=3 roundtrip failed"); }
    }

    /* With compression */
    TEST("roundtrip: with compression");
    {
        /* Repetitive data compresses well */
        uint8_t data[500];
        memset(data, 0xAB, 500);

        cc_options opts = cc_defaults();
        opts.compress = 1;

        uint8_t *png = NULL;
        size_t png_len = 0;
        int rc = cc_encode(data, 500, &opts, &png, &png_len);
        if (rc != CC_OK) { FAIL("encode failed"); return; }

        uint8_t *decoded = NULL;
        size_t decoded_len = 0;
        rc = cc_decode(png, png_len, &decoded, &decoded_len);
        free(png);

        int ok = (rc == CC_OK) && (decoded_len == 500) && (memcmp(decoded, data, 500) == 0);
        free(decoded);
        if (ok) { PASS(); } else { FAIL("compressed roundtrip failed"); }
    }

    /* Larger payload: 1KB */
    TEST("roundtrip: 1024 bytes random-like data");
    {
        uint8_t data[1024];
        for (int i = 0; i < 1024; i++) data[i] = (uint8_t)((i * 97 + 13) & 0xFF);

        cc_options opts = cc_defaults();
        opts.ec_level = CC_EC_M;

        uint8_t *png = NULL;
        size_t png_len = 0;
        int rc = cc_encode(data, 1024, &opts, &png, &png_len);
        if (rc != CC_OK) { FAIL("encode failed"); return; }

        uint8_t *decoded = NULL;
        size_t decoded_len = 0;
        rc = cc_decode(png, png_len, &decoded, &decoded_len);
        free(png);

        int ok = (rc == CC_OK) && (decoded_len == 1024) && (memcmp(decoded, data, 1024) == 0);
        free(decoded);
        if (ok) { PASS(); } else { FAIL("1KB roundtrip failed"); }
    }
}

/* ════════════════════════════════════════════════════════════════════
 * Capacity Tests
 * ════════════════════════════════════════════════════════════════════ */

static void test_capacity(void)
{
    printf("\n--- Capacity ---\n");

    TEST("capacity default options");
    {
        cc_capacity info;
        int rc = cc_get_capacity(NULL, &info);
        int ok = (rc == CC_OK) && (info.grid_width >= CC_MIN_GRID_SIZE)
                 && (info.data_bytes > 0) && (info.structural_cells > 0);
        if (ok) { PASS(); } else { FAIL("bad capacity result"); }
    }

    TEST("capacity with specific dimensions");
    {
        cc_options opts = cc_defaults();
        opts.width = 32;
        opts.height = 32;

        cc_capacity info;
        int rc = cc_get_capacity(&opts, &info);
        int ok = (rc == CC_OK)
                 && (info.grid_width == 32)
                 && (info.grid_height == 32)
                 && (info.data_bytes > 0);
        if (ok) { PASS(); } else { FAIL("bad capacity result"); }
    }
}

/* ════════════════════════════════════════════════════════════════════
 * Main
 * ════════════════════════════════════════════════════════════════════ */

int main(void)
{
    printf("ChromaCode C Library Tests\n");
    printf("==========================\n");

    test_crc32();
    test_gf256();
    test_reed_solomon();
    test_png();
    test_header();
    test_grid();
    test_interleave();
    test_channels();
    test_roundtrip();
    test_capacity();

    printf("\n==========================\n");
    printf("Results: %d/%d passed\n", tests_passed, tests_run);

    return (tests_passed == tests_run) ? 0 : 1;
}
