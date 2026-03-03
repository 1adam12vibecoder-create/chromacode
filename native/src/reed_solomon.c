/*
 * reed_solomon.c — Reed-Solomon encoder/decoder over GF(2^8).
 *
 * Convention: codeword c[0..n-1] = c[0]*x^{n-1} + ... + c[n-1]*x^0.
 * Position j → power n-1-j.
 * Error locator for position j: X_j = alpha^{n-1-j}.
 *
 * Generator: g(x) = product of (x - alpha^i) for i=0..ecCount-1.
 */

#define CHROMACODE_INTERNAL
#include "chromacode.h"
#include <string.h>
#include <stdlib.h>
#include <math.h>

/* ── EC symbol count ─────────────────────────────────────────────── */

int cc_rs_ec_symbol_count(int data_len, int ec_ratio_100)
{
    /* ec = ceil(data_len * ratio / (1 - ratio))
     * With integer: ec = ceil(data_len * ec_ratio_100 / (100 - ec_ratio_100))
     */
    int num = data_len * ec_ratio_100;
    int den = 100 - ec_ratio_100;
    int ec = (num + den - 1) / den;
    return ec < 2 ? 2 : ec;
}

/* ── Generator polynomial ────────────────────────────────────────── */

/* Build g(x) = product (x - alpha^i) for i=0..ec-1.
 * Stored highest-degree first. Length = ec+1.
 * Returns malloc'd buffer; caller frees.
 */
static uint8_t *generator_poly(int ec, int *out_len)
{
    cc_gf_init();

    /* Start with g = [1], final length will be ec+1 */
    int g_len = 1;
    uint8_t *g = (uint8_t *)malloc((size_t)(ec + 1));
    if (!g) return NULL;
    g[0] = 1;

    uint8_t factor[2];
    factor[0] = 1;

    for (int i = 0; i < ec; i++) {
        factor[1] = cc_gf_exp[i];
        int new_len = g_len + 1;
        uint8_t *tmp = (uint8_t *)malloc((size_t)new_len);
        if (!tmp) { free(g); return NULL; }
        cc_gf_poly_mul(g, g_len, factor, 2, tmp);
        free(g);
        g = tmp;
        g_len = new_len;
    }

    *out_len = g_len;
    return g;
}

/* ── RS Encode ───────────────────────────────────────────────────── */

int cc_rs_encode(const uint8_t *data, int data_len, int ec_count,
                 uint8_t *out)
{
    cc_gf_init();

    int gen_len;
    uint8_t *gen = generator_poly(ec_count, &gen_len);
    if (!gen) return CC_ERR_ALLOC;

    /* Copy data to output */
    memcpy(out, data, (size_t)data_len);
    memset(out + data_len, 0, (size_t)ec_count);

    /* LFSR feedback shift register */
    uint8_t *feedback = (uint8_t *)calloc((size_t)ec_count, 1);
    if (!feedback) { free(gen); return CC_ERR_ALLOC; }

    for (int i = 0; i < data_len; i++) {
        uint8_t coeff = data[i] ^ feedback[0];
        /* Shift feedback left by 1 */
        memmove(feedback, feedback + 1, (size_t)(ec_count - 1));
        feedback[ec_count - 1] = 0;
        if (coeff != 0) {
            for (int j = 0; j < ec_count; j++) {
                feedback[j] ^= cc_gf_mul(coeff, gen[j + 1]);
            }
        }
    }

    memcpy(out + data_len, feedback, (size_t)ec_count);

    free(feedback);
    free(gen);
    return CC_OK;
}

/* ── Syndromes ───────────────────────────────────────────────────── */

static void compute_syndromes(const uint8_t *received, int n,
                              int ec_count, uint8_t *synd)
{
    for (int i = 0; i < ec_count; i++) {
        uint8_t a = cc_gf_exp[i];
        uint8_t val = 0;
        for (int j = 0; j < n; j++) {
            val = cc_gf_mul(val, a) ^ received[j];
        }
        synd[i] = val;
    }
}

/* ── Berlekamp-Massey ────────────────────────────────────────────── */

/* Lambda(x) = 1 + L1*x + L2*x^2 + ...
 * Stored as lambda[i] = coeff of x^i, so lambda[0] = 1.
 * Returns length of lambda array.
 */
static int berlekamp_massey(const uint8_t *synd, int ec_count,
                            uint8_t *lambda, int max_lambda)
{
    cc_gf_init();

    /* C = current LFSR connection poly */
    uint8_t C[256];
    uint8_t B[256];
    memset(C, 0, sizeof(C));
    memset(B, 0, sizeof(B));
    C[0] = 1;
    B[0] = 1;
    int C_len = 1;
    int B_len = 1;
    int L = 0;
    int m = 1;
    uint8_t b = 1;

    for (int n = 0; n < ec_count; n++) {
        /* Discrepancy */
        uint8_t d = synd[n];
        for (int i = 1; i < C_len; i++) {
            d ^= cc_gf_mul(C[i], synd[n - i]);
        }

        if (d == 0) {
            m++;
            continue;
        }

        /* Save T = copy of C */
        uint8_t T[256];
        memcpy(T, C, (size_t)C_len);
        int T_len = C_len;

        /* coeff = d * b^{-1} */
        uint8_t coeff = cc_gf_mul(d, cc_gf_exp[(255 - cc_gf_log[b]) % 255]);

        /* C = C + coeff * x^m * B */
        int needed = B_len + m;
        while (C_len < needed) {
            C[C_len] = 0;
            C_len++;
        }
        for (int i = 0; i < B_len; i++) {
            C[i + m] ^= cc_gf_mul(coeff, B[i]);
        }

        if (2 * L <= n) {
            L = n + 1 - L;
            memcpy(B, T, (size_t)T_len);
            B_len = T_len;
            b = d;
            m = 1;
        } else {
            m++;
        }
    }

    if (C_len > max_lambda) C_len = max_lambda;
    memcpy(lambda, C, (size_t)C_len);
    return C_len;
}

/* ── Chien Search ────────────────────────────────────────────────── */

/* Find error positions. Returns number of positions found, or -1 on error. */
static int chien_search(const uint8_t *lambda, int lambda_len,
                        int n, int *positions, int max_positions)
{
    int degree = lambda_len - 1;
    int found = 0;

    for (int p = 0; p < n; p++) {
        /* x = X_p^{-1} = alpha^{(p - n + 1) mod 255} */
        int e = ((p - n + 1) % 255 + 255) % 255;
        uint8_t x = (e == 0) ? 1 : cc_gf_exp[e];

        /* Evaluate Lambda(x) */
        uint8_t val = lambda[0]; /* = 1 */
        uint8_t x_pow = 1;
        for (int j = 1; j < lambda_len; j++) {
            x_pow = cc_gf_mul(x_pow, x);
            val ^= cc_gf_mul(lambda[j], x_pow);
        }

        if (val == 0) {
            if (found < max_positions) {
                positions[found] = p;
            }
            found++;
        }
    }

    if (found != degree) return -1; /* uncorrectable */
    return found;
}

/* ── Forney's Algorithm ──────────────────────────────────────────── */

static int forney(const uint8_t *synd, const uint8_t *lambda, int lambda_len,
                  const int *positions, int num_errors,
                  int n, int ec_count,
                  uint8_t *magnitudes)
{
    cc_gf_init();

    /* Omega(x) = Lambda(x) * S(x) mod x^{ec_count}
     * where S(x) = S_0 + S_1*x + ... + S_{ec_count-1}*x^{ec_count-1}
     * omega[i] = coeff of x^i
     */
    uint8_t omega[256];
    memset(omega, 0, (size_t)ec_count);
    for (int i = 0; i < ec_count; i++) {
        for (int j = 0; j < lambda_len && j <= i; j++) {
            omega[i] ^= cc_gf_mul(lambda[j], synd[i - j]);
        }
    }

    /* Lambda'(x): formal derivative in GF(2).
     * d/dx [c_j * x^j] = c_j * x^{j-1} if j odd, 0 if j even.
     * lp[j-1] = lambda[j] for odd j.
     */
    uint8_t lp[256];
    int lp_len = 0;
    memset(lp, 0, sizeof(lp));
    for (int j = 1; j < lambda_len; j += 2) {
        while (lp_len < j) {
            lp[lp_len] = 0;
            lp_len++;
        }
        lp[j - 1] = lambda[j];
        if (j >= lp_len) lp_len = j;
    }
    if (lp_len == 0) { lp[0] = 0; lp_len = 1; }

    for (int k = 0; k < num_errors; k++) {
        int p = positions[k];

        /* X_p = alpha^{n-1-p} */
        int xp_exp = (n - 1 - p) % 255;
        uint8_t Xp = (xp_exp == 0) ? 1 : cc_gf_exp[xp_exp];

        /* X_p^{-1} */
        int xp_inv_exp = ((p - n + 1) % 255 + 255) % 255;
        uint8_t XpInv = (xp_inv_exp == 0) ? 1 : cc_gf_exp[xp_inv_exp];

        /* Evaluate Omega(XpInv) */
        uint8_t omega_val = 0;
        uint8_t x_pow = 1;
        for (int i = 0; i < ec_count; i++) {
            omega_val ^= cc_gf_mul(omega[i], x_pow);
            x_pow = cc_gf_mul(x_pow, XpInv);
        }

        /* Evaluate Lambda'(XpInv) */
        uint8_t lp_val = 0;
        x_pow = 1;
        for (int i = 0; i < lp_len; i++) {
            lp_val ^= cc_gf_mul(lp[i], x_pow);
            x_pow = cc_gf_mul(x_pow, XpInv);
        }

        if (lp_val == 0) return CC_ERR_RS;

        /* e_p = Xp * Omega(XpInv) / Lambda'(XpInv) */
        magnitudes[k] = cc_gf_mul(Xp,
                            cc_gf_mul(omega_val,
                                cc_gf_exp[(255 - cc_gf_log[lp_val]) % 255]));
    }

    return CC_OK;
}

/* ── RS Decode ───────────────────────────────────────────────────── */

int cc_rs_decode(const uint8_t *received, int n, int ec_count,
                 uint8_t *out)
{
    cc_gf_init();

    int data_len = n - ec_count;

    /* Compute syndromes */
    uint8_t synd[256];
    compute_syndromes(received, n, ec_count, synd);

    /* Check if all syndromes are zero (no errors) */
    int all_zero = 1;
    for (int i = 0; i < ec_count; i++) {
        if (synd[i] != 0) { all_zero = 0; break; }
    }
    if (all_zero) {
        memcpy(out, received, (size_t)data_len);
        return CC_OK;
    }

    /* Berlekamp-Massey */
    uint8_t lambda[256];
    int lambda_len = berlekamp_massey(synd, ec_count, lambda, 256);
    int num_errors = lambda_len - 1;

    if (num_errors == 0) return CC_ERR_RS;
    if (num_errors > ec_count / 2) return CC_ERR_RS;

    /* Chien search */
    int positions[256];
    int found = chien_search(lambda, lambda_len, n, positions, 256);
    if (found < 0) return CC_ERR_RS;

    /* Forney: compute magnitudes */
    uint8_t magnitudes[256];
    int rc = forney(synd, lambda, lambda_len, positions, num_errors,
                    n, ec_count, magnitudes);
    if (rc != CC_OK) return rc;

    /* Apply corrections */
    uint8_t *corrected = (uint8_t *)malloc((size_t)n);
    if (!corrected) return CC_ERR_ALLOC;
    memcpy(corrected, received, (size_t)n);
    for (int i = 0; i < num_errors; i++) {
        corrected[positions[i]] ^= magnitudes[i];
    }

    /* Verify syndromes */
    uint8_t check_synd[256];
    compute_syndromes(corrected, n, ec_count, check_synd);
    for (int i = 0; i < ec_count; i++) {
        if (check_synd[i] != 0) {
            free(corrected);
            return CC_ERR_RS;
        }
    }

    memcpy(out, corrected, (size_t)data_len);
    free(corrected);
    return CC_OK;
}
