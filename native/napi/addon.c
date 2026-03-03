/*
 * addon.c — Node.js N-API bindings for libchromacode.
 * Pure C, N-API version 8 (stable, Node 12+).
 */

#define CHROMACODE_INTERNAL
#include "chromacode.h"
#include <node_api.h>
#include <stdlib.h>
#include <string.h>

/* ── Helper: throw JS error from C error code ────────────────────── */

static napi_value throw_cc_error(napi_env env, int rc)
{
    napi_throw_error(env, NULL, cc_strerror(rc));
    return NULL;
}

/* ── Helper: get optional int property from JS object ────────────── */

static int get_int_prop(napi_env env, napi_value obj, const char *key, int default_val)
{
    napi_value val;
    if (napi_get_named_property(env, obj, key, &val) != napi_ok) return default_val;

    napi_valuetype type;
    napi_typeof(env, val, &type);
    if (type == napi_undefined || type == napi_null) return default_val;

    int32_t result;
    if (napi_get_value_int32(env, val, &result) != napi_ok) return default_val;
    return (int)result;
}

/* ── Helper: get optional bool property from JS object ───────────── */

static int get_bool_prop(napi_env env, napi_value obj, const char *key, int default_val)
{
    napi_value val;
    if (napi_get_named_property(env, obj, key, &val) != napi_ok) return default_val;

    napi_valuetype type;
    napi_typeof(env, val, &type);
    if (type == napi_undefined || type == napi_null) return default_val;

    if (type == napi_boolean) {
        bool result;
        napi_get_value_bool(env, val, &result);
        return result ? 1 : 0;
    }

    /* Truthy int */
    int32_t result;
    if (napi_get_value_int32(env, val, &result) == napi_ok) return result ? 1 : 0;
    return default_val;
}

/* ── Helper: convert JS mode string to CC_MODE constant ──────────── */

static int mode_from_js(napi_env env, napi_value obj)
{
    napi_value val;
    if (napi_get_named_property(env, obj, "mode", &val) != napi_ok)
        return CC_MODE_RGBA64;

    napi_valuetype type;
    napi_typeof(env, val, &type);
    if (type != napi_string) return CC_MODE_RGBA64;

    char buf[16];
    size_t len = 0;
    napi_get_value_string_utf8(env, val, buf, sizeof(buf), &len);

    if (strcmp(buf, "rgba64") == 0) return CC_MODE_RGBA64;
    if (strcmp(buf, "rgba32") == 0) return CC_MODE_RGBA32;
    if (strcmp(buf, "rgb48") == 0)  return CC_MODE_RGB48;
    if (strcmp(buf, "rgb24") == 0)  return CC_MODE_RGB24;
    return CC_MODE_RGBA64;
}

/* ── Helper: convert JS ecLevel string to CC_EC constant ─────────── */

static int ec_from_js(napi_env env, napi_value obj)
{
    napi_value val;
    if (napi_get_named_property(env, obj, "ecLevel", &val) != napi_ok)
        return CC_EC_L;

    napi_valuetype type;
    napi_typeof(env, val, &type);
    if (type != napi_string) return CC_EC_L;

    char buf[4];
    size_t len = 0;
    napi_get_value_string_utf8(env, val, buf, sizeof(buf), &len);

    if (buf[0] == 'L') return CC_EC_L;
    if (buf[0] == 'M') return CC_EC_M;
    if (buf[0] == 'Q') return CC_EC_Q;
    if (buf[0] == 'H') return CC_EC_H;
    return CC_EC_L;
}

/* ── Helper: parse sequence info from JS options ─────────────────── */

static void parse_sequence(napi_env env, napi_value obj, cc_options *opts)
{
    napi_value seq_val;
    if (napi_get_named_property(env, obj, "sequence", &seq_val) != napi_ok) return;

    napi_valuetype type;
    napi_typeof(env, seq_val, &type);
    if (type != napi_object) return;

    opts->seq_id = (uint16_t)get_int_prop(env, seq_val, "id", 0);
    opts->seq_index = (uint8_t)get_int_prop(env, seq_val, "index", 0);
    opts->seq_total = (uint8_t)get_int_prop(env, seq_val, "total", 0);
}

/* ── Helper: parse JS options to cc_options ───────────────────────── */

static cc_options parse_options(napi_env env, napi_value js_opts)
{
    cc_options opts = cc_defaults();

    napi_valuetype type;
    napi_typeof(env, js_opts, &type);
    if (type != napi_object) return opts;

    opts.mode = mode_from_js(env, js_opts);
    opts.ec_level = ec_from_js(env, js_opts);
    opts.cell_size = get_int_prop(env, js_opts, "cellSize", 1);
    opts.compress = get_bool_prop(env, js_opts, "compress", 0);
    opts.width = get_int_prop(env, js_opts, "width", 0);
    opts.height = get_int_prop(env, js_opts, "height", 0);
    parse_sequence(env, js_opts, &opts);

    return opts;
}

/* ══════════════════════════════════════════════════════════════════
 * encode(data: Uint8Array, options?: object): Uint8Array
 * ══════════════════════════════════════════════════════════════════ */

static napi_value napi_encode(napi_env env, napi_callback_info info)
{
    size_t argc = 2;
    napi_value argv[2];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);

    if (argc < 1) {
        napi_throw_type_error(env, NULL, "encode requires at least 1 argument");
        return NULL;
    }

    /* Get input data */
    uint8_t *data = NULL;
    size_t data_len = 0;
    bool is_typed_array;
    napi_is_typedarray(env, argv[0], &is_typed_array);

    if (is_typed_array) {
        napi_typedarray_type arr_type;
        napi_value arr_buf;
        size_t byte_offset;
        napi_get_typedarray_info(env, argv[0], &arr_type, &data_len,
                                 (void **)&data, &arr_buf, &byte_offset);
    } else {
        bool is_buffer;
        napi_is_buffer(env, argv[0], &is_buffer);
        if (is_buffer) {
            napi_get_buffer_info(env, argv[0], (void **)&data, &data_len);
        } else {
            napi_throw_type_error(env, NULL, "First argument must be Uint8Array or Buffer");
            return NULL;
        }
    }

    /* Parse options */
    cc_options opts = cc_defaults();
    if (argc >= 2) {
        opts = parse_options(env, argv[1]);
    }

    /* Encode */
    uint8_t *png = NULL;
    size_t png_len = 0;
    int rc = cc_encode(data, data_len, &opts, &png, &png_len);
    if (rc != CC_OK) return throw_cc_error(env, rc);

    /* Create result Uint8Array using external buffer (zero-copy) */
    napi_value result;
    napi_value array_buffer;
    void *ab_data;

    napi_create_arraybuffer(env, png_len, &ab_data, &array_buffer);
    memcpy(ab_data, png, png_len);
    free(png);

    napi_create_typedarray(env, napi_uint8_array, png_len,
                           array_buffer, 0, &result);
    return result;
}

/* ══════════════════════════════════════════════════════════════════
 * decode(png: Uint8Array): Uint8Array
 * ══════════════════════════════════════════════════════════════════ */

static napi_value napi_decode(napi_env env, napi_callback_info info)
{
    size_t argc = 1;
    napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);

    if (argc < 1) {
        napi_throw_type_error(env, NULL, "decode requires 1 argument");
        return NULL;
    }

    /* Get PNG data */
    uint8_t *png_data = NULL;
    size_t png_len = 0;
    bool is_typed_array;
    napi_is_typedarray(env, argv[0], &is_typed_array);

    if (is_typed_array) {
        napi_typedarray_type arr_type;
        napi_value arr_buf;
        size_t byte_offset;
        napi_get_typedarray_info(env, argv[0], &arr_type, &png_len,
                                 (void **)&png_data, &arr_buf, &byte_offset);
    } else {
        bool is_buffer;
        napi_is_buffer(env, argv[0], &is_buffer);
        if (is_buffer) {
            napi_get_buffer_info(env, argv[0], (void **)&png_data, &png_len);
        } else {
            napi_throw_type_error(env, NULL, "Argument must be Uint8Array or Buffer");
            return NULL;
        }
    }

    /* Decode */
    uint8_t *out_data = NULL;
    size_t out_len = 0;
    int rc = cc_decode(png_data, png_len, &out_data, &out_len);
    if (rc != CC_OK) return throw_cc_error(env, rc);

    /* Create result Uint8Array */
    napi_value result;
    napi_value array_buffer;
    void *ab_data;

    napi_create_arraybuffer(env, out_len, &ab_data, &array_buffer);
    if (out_len > 0) memcpy(ab_data, out_data, out_len);
    free(out_data);

    napi_create_typedarray(env, napi_uint8_array, out_len,
                           array_buffer, 0, &result);
    return result;
}

/* ══════════════════════════════════════════════════════════════════
 * capacity(options?: object): object
 * ══════════════════════════════════════════════════════════════════ */

static napi_value napi_capacity(napi_env env, napi_callback_info info)
{
    size_t argc = 1;
    napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);

    cc_options opts = cc_defaults();
    if (argc >= 1) {
        opts = parse_options(env, argv[0]);
    }

    cc_capacity cap;
    int rc = cc_get_capacity(&opts, &cap);
    if (rc != CC_OK) return throw_cc_error(env, rc);

    /* Build JS object */
    napi_value result;
    napi_create_object(env, &result);

    napi_value val;

#define SET_INT(name, field) \
    napi_create_int32(env, cap.field, &val); \
    napi_set_named_property(env, result, name, val);

    SET_INT("gridWidth", grid_width)
    SET_INT("gridHeight", grid_height)
    SET_INT("totalCells", total_cells)
    SET_INT("dataCells", data_cells)
    SET_INT("bitsPerCell", bits_per_cell)
    SET_INT("dataBytes", data_bytes)
    SET_INT("ecBytes", ec_bytes)
    SET_INT("structuralCells", structural_cells)

#undef SET_INT

    return result;
}

/* ══════════════════════════════════════════════════════════════════
 * Module init
 * ══════════════════════════════════════════════════════════════════ */

static napi_value init(napi_env env, napi_value exports)
{
    napi_value fn;

    napi_create_function(env, "encode", NAPI_AUTO_LENGTH,
                         napi_encode, NULL, &fn);
    napi_set_named_property(env, exports, "encode", fn);

    napi_create_function(env, "decode", NAPI_AUTO_LENGTH,
                         napi_decode, NULL, &fn);
    napi_set_named_property(env, exports, "decode", fn);

    napi_create_function(env, "capacity", NAPI_AUTO_LENGTH,
                         napi_capacity, NULL, &fn);
    napi_set_named_property(env, exports, "capacity", fn);

    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
