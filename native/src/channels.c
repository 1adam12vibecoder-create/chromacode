/*
 * channels.c — Cell-level data encoding/decoding.
 * Maps raw bytes to/from RGBA pixel values based on encoding mode.
 */

#define CHROMACODE_INTERNAL
#include "chromacode.h"

void cc_encode_cell(const uint8_t *data, int mode, uint8_t *pixel)
{
    int bit_depth = CC_BIT_DEPTH[mode];

    if (bit_depth == 16) {
        /* 16-bit PNG: 8 bytes per pixel (R16, G16, B16, A16 big-endian) */
        if (mode == CC_MODE_RGBA64) {
            /* 8 data bytes → R16(2) + G16(2) + B16(2) + A16(2) */
            pixel[0] = data[0]; pixel[1] = data[1]; /* R16 */
            pixel[2] = data[2]; pixel[3] = data[3]; /* G16 */
            pixel[4] = data[4]; pixel[5] = data[5]; /* B16 */
            pixel[6] = data[6]; pixel[7] = data[7]; /* A16 */
        } else {
            /* rgb48: 6 data bytes → R16(2) + G16(2) + B16(2), A16 = 65535 */
            pixel[0] = data[0]; pixel[1] = data[1]; /* R16 */
            pixel[2] = data[2]; pixel[3] = data[3]; /* G16 */
            pixel[4] = data[4]; pixel[5] = data[5]; /* B16 */
            pixel[6] = 0xFF;   pixel[7] = 0xFF;     /* A16 = max */
        }
    } else {
        /* 8-bit PNG: 4 bytes per pixel (R8, G8, B8, A8) */
        if (mode == CC_MODE_RGBA32) {
            pixel[0] = data[0]; /* R */
            pixel[1] = data[1]; /* G */
            pixel[2] = data[2]; /* B */
            pixel[3] = data[3]; /* A */
        } else {
            /* rgb24: 3 data bytes → R8 + G8 + B8, A = 255 */
            pixel[0] = data[0]; /* R */
            pixel[1] = data[1]; /* G */
            pixel[2] = data[2]; /* B */
            pixel[3] = 255;     /* A = max */
        }
    }
}

void cc_decode_cell(const uint8_t *pixel, int mode, uint8_t *result)
{
    int bit_depth = CC_BIT_DEPTH[mode];

    if (bit_depth == 16) {
        if (mode == CC_MODE_RGBA64) {
            /* R16 → data[0..1], G16 → data[2..3], B16 → data[4..5], A16 → data[6..7] */
            result[0] = pixel[0]; result[1] = pixel[1];
            result[2] = pixel[2]; result[3] = pixel[3];
            result[4] = pixel[4]; result[5] = pixel[5];
            result[6] = pixel[6]; result[7] = pixel[7];
        } else {
            /* rgb48: R16 → data[0..1], G16 → data[2..3], B16 → data[4..5], ignore A */
            result[0] = pixel[0]; result[1] = pixel[1];
            result[2] = pixel[2]; result[3] = pixel[3];
            result[4] = pixel[4]; result[5] = pixel[5];
        }
    } else {
        if (mode == CC_MODE_RGBA32) {
            result[0] = pixel[0];
            result[1] = pixel[1];
            result[2] = pixel[2];
            result[3] = pixel[3];
        } else {
            /* rgb24: ignore alpha */
            result[0] = pixel[0];
            result[1] = pixel[1];
            result[2] = pixel[2];
        }
    }
}
