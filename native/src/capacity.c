/*
 * capacity.c — Capacity calculator: how much data fits in a ChromaCode image.
 */

#define CHROMACODE_INTERNAL
#include "chromacode.h"
#include <string.h>

int cc_get_capacity(const cc_options *opts, cc_capacity *info)
{
    cc_options o = opts ? *opts : cc_defaults();
    int mode = o.mode;
    if (mode < 0 || mode > 3) return CC_ERR_INPUT;
    int ec_level = o.ec_level;
    if (ec_level < 0 || ec_level > 3) return CC_ERR_INPUT;
    int has_sequence = (o.seq_total > 0) ? 1 : 0;
    int bytes_per_cell = CC_BYTES_PER_CELL[mode];
    int bits_per_cell = CC_BITS_PER_CELL[mode];
    int ec_ratio_100 = CC_EC_RATIO_100[ec_level];

    int grid_w, grid_h;

    if (o.width > 0 && o.height > 0) {
        grid_w = o.width;
        grid_h = o.height;
    } else {
        int rc = cc_auto_size(1, mode, ec_level, has_sequence, &grid_w, &grid_h);
        if (rc != CC_OK) return rc;
    }

    int total_cells = grid_w * grid_h;
    int structural = cc_structural_cell_count(grid_w, grid_h);
    int total_data_cells = cc_data_cell_count(grid_w, grid_h);
    int hdr_size = cc_header_size(has_sequence);
    int header_cells = (hdr_size + bytes_per_cell - 1) / bytes_per_cell;
    int payload_data_cells = total_data_cells - header_cells;

    int raw_bytes = payload_data_cells * bytes_per_cell;
    int data_bytes = 0, ec_bytes = 0;

    if (raw_bytes <= 0) {
        data_bytes = 0;
        ec_bytes = 0;
    } else if (raw_bytes <= CC_RS_MAX_BLOCK) {
        int ec = cc_rs_ec_symbol_count(raw_bytes, ec_ratio_100);
        data_bytes = raw_bytes - ec;
        if (data_bytes < 0) data_bytes = 0;
        ec_bytes = ec;
    } else {
        int num_blocks = (raw_bytes + CC_RS_MAX_BLOCK - 1) / CC_RS_MAX_BLOCK;

        /* Find data per block (same logic as encoder) */
        int data_per_block;
        for (data_per_block = CC_RS_MAX_BLOCK - 2; data_per_block >= 1; data_per_block--) {
            int ec = cc_rs_ec_symbol_count(data_per_block, ec_ratio_100);
            if (data_per_block + ec <= CC_RS_MAX_BLOCK) break;
        }
        int ec_per_block = cc_rs_ec_symbol_count(data_per_block, ec_ratio_100);
        data_bytes = data_per_block * num_blocks;
        ec_bytes = ec_per_block * num_blocks;
    }

    info->grid_width = grid_w;
    info->grid_height = grid_h;
    info->total_cells = total_cells;
    info->data_cells = total_data_cells;
    info->bits_per_cell = bits_per_cell;
    info->data_bytes = data_bytes;
    info->ec_bytes = ec_bytes;
    info->structural_cells = structural;

    return CC_OK;
}
