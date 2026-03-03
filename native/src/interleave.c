/*
 * interleave.c — Block interleaving for burst error resistance.
 * Round-robin distribution of codewords across RS blocks.
 */

#define CHROMACODE_INTERNAL
#include "chromacode.h"
#include <stdlib.h>

void cc_interleave(const uint8_t **blocks, const int *sizes, int count,
                   uint8_t *out)
{
    if (count == 0) return;
    if (count == 1) {
        for (int i = 0; i < sizes[0]; i++) out[i] = blocks[0][i];
        return;
    }

    /* Find max block size */
    int max_len = 0;
    for (int b = 0; b < count; b++) {
        if (sizes[b] > max_len) max_len = sizes[b];
    }

    int pos = 0;
    for (int i = 0; i < max_len; i++) {
        for (int b = 0; b < count; b++) {
            if (i < sizes[b]) {
                out[pos++] = blocks[b][i];
            }
        }
    }
}

void cc_deinterleave(const uint8_t *stream, int stream_len,
                     uint8_t **blocks, const int *sizes, int count)
{
    if (count == 0) return;
    if (count == 1) {
        for (int i = 0; i < sizes[0] && i < stream_len; i++)
            blocks[0][i] = stream[i];
        return;
    }

    /* Find max block size */
    int max_len = 0;
    for (int b = 0; b < count; b++) {
        if (sizes[b] > max_len) max_len = sizes[b];
    }

    int cursors_stack[64];
    int *cursors = (count <= 64)
        ? cursors_stack
        : (int *)malloc((size_t)count * sizeof(int));
    if (!cursors) return;
    for (int b = 0; b < count; b++) cursors[b] = 0;

    int pos = 0;
    for (int i = 0; i < max_len; i++) {
        for (int b = 0; b < count; b++) {
            if (i < sizes[b] && pos < stream_len) {
                blocks[b][cursors[b]++] = stream[pos++];
            }
        }
    }

    if (count > 64) free(cursors);
}
