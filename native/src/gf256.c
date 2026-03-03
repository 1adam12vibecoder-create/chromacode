/*
 * gf256.c — GF(2^8) finite field arithmetic.
 * Primitive polynomial: 0x11d (x^8 + x^4 + x^3 + x^2 + 1).
 * Same as QR codes and AES.
 */

#define CHROMACODE_INTERNAL
#include "chromacode.h"
#include <string.h>

#ifdef _WIN32
#include <windows.h>
static INIT_ONCE gf_once = INIT_ONCE_STATIC_INIT;
#else
#include <pthread.h>
static pthread_once_t gf_once = PTHREAD_ONCE_INIT;
#endif

uint8_t cc_gf_exp[512];
uint8_t cc_gf_log[256];

static void gf_init_tables(void)
{
    int x = 1;
    for (int i = 0; i < 255; i++) {
        cc_gf_exp[i] = (uint8_t)x;
        cc_gf_log[x] = (uint8_t)i;
        x <<= 1;
        if (x & 0x100) {
            x ^= 0x11d;
        }
    }
    /* Extend exp table for wrap-around (avoids modular reduction in mul) */
    for (int i = 255; i < 512; i++) {
        cc_gf_exp[i] = cc_gf_exp[i - 255];
    }
}

#ifdef _WIN32
static BOOL CALLBACK gf_init_callback(PINIT_ONCE once, PVOID param, PVOID *ctx)
{
    (void)once; (void)param; (void)ctx;
    gf_init_tables();
    return TRUE;
}
void cc_gf_init(void)
{
    InitOnceExecuteOnce(&gf_once, gf_init_callback, NULL, NULL);
}
#else
void cc_gf_init(void)
{
    pthread_once(&gf_once, gf_init_tables);
}
#endif

uint8_t cc_gf_mul(uint8_t a, uint8_t b)
{
    if (a == 0 || b == 0) return 0;
    return cc_gf_exp[cc_gf_log[a] + cc_gf_log[b]];
}

uint8_t cc_gf_div(uint8_t a, uint8_t b)
{
    /* b must not be 0 */
    if (a == 0) return 0;
    return cc_gf_exp[(cc_gf_log[a] + 255 - cc_gf_log[b]) % 255];
}

uint8_t cc_gf_inv(uint8_t a)
{
    /* a must not be 0 */
    return cc_gf_exp[255 - cc_gf_log[a]];
}

uint8_t cc_gf_pow(uint8_t a, int n)
{
    if (a == 0) return (n == 0) ? 1 : 0;
    return cc_gf_exp[(cc_gf_log[a] * n) % 255];
}

uint8_t cc_gf_poly_eval(const uint8_t *poly, int len, uint8_t x)
{
    /* poly[0] = highest degree coefficient, Horner's method */
    if (x == 0) return poly[len - 1];
    uint8_t result = poly[0];
    for (int i = 1; i < len; i++) {
        result = cc_gf_mul(result, x) ^ poly[i];
    }
    return result;
}

void cc_gf_poly_mul(const uint8_t *a, int a_len,
                     const uint8_t *b, int b_len,
                     uint8_t *result)
{
    int rlen = a_len + b_len - 1;
    memset(result, 0, (size_t)rlen);
    for (int i = 0; i < a_len; i++) {
        for (int j = 0; j < b_len; j++) {
            result[i + j] ^= cc_gf_mul(a[i], b[j]);
        }
    }
}
