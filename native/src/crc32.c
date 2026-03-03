/*
 * crc32.c — CRC32 computation for PNG chunk integrity.
 * Polynomial 0xEDB88320 (reversed representation of 0x04C11DB7).
 */

#define CHROMACODE_INTERNAL
#include "chromacode.h"

#ifdef _WIN32
#include <windows.h>
static INIT_ONCE crc_once = INIT_ONCE_STATIC_INIT;
#else
#include <pthread.h>
static pthread_once_t crc_once = PTHREAD_ONCE_INIT;
#endif

static uint32_t crc_table[256];

static void build_table_impl(void)
{
    for (int i = 0; i < 256; i++) {
        uint32_t c = (uint32_t)i;
        for (int j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
        }
        crc_table[i] = c;
    }
}

#ifdef _WIN32
static BOOL CALLBACK crc_init_callback(PINIT_ONCE once, PVOID param, PVOID *ctx)
{
    (void)once; (void)param; (void)ctx;
    build_table_impl();
    return TRUE;
}
static void build_table(void)
{
    InitOnceExecuteOnce(&crc_once, crc_init_callback, NULL, NULL);
}
#else
static void build_table(void)
{
    pthread_once(&crc_once, build_table_impl);
}
#endif

uint32_t cc_crc32_update(uint32_t crc, const uint8_t *data, size_t len)
{
    build_table();
    for (size_t i = 0; i < len; i++) {
        crc = crc_table[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
    }
    return crc;
}

uint32_t cc_crc32(const uint8_t *data, size_t len)
{
    uint32_t crc = 0xFFFFFFFFu;
    crc = cc_crc32_update(crc, data, len);
    return crc ^ 0xFFFFFFFFu;
}
