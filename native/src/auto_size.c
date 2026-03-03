/*
 * auto_size.c — Auto-calculate optimal grid dimensions for a given payload.
 */

#define CHROMACODE_INTERNAL
#include "chromacode.h"

int cc_usable_capacity(int width, int height, int mode, int ec_level,
                       int has_sequence)
{
    int total_data_cells = cc_data_cell_count(width, height);
    int bytes_per_cell = CC_BYTES_PER_CELL[mode];
    int hdr_size = cc_header_size(has_sequence);
    int ec_ratio_100 = CC_EC_RATIO_100[ec_level];

    /* Header cells needed */
    int header_cells = (hdr_size + bytes_per_cell - 1) / bytes_per_cell;

    /* Remaining cells for data + EC */
    int remaining_cells = total_data_cells - header_cells;
    if (remaining_cells <= 0) return 0;

    int total_raw_bytes = remaining_cells * bytes_per_cell;

    /* Use the same block-splitting logic as the encoder:
     * find max data_per_block where data_per_block + ec <= 255 */
    int data_per_block = CC_RS_MAX_BLOCK - 2;
    for (; data_per_block >= 1; data_per_block--) {
        int ec = cc_rs_ec_symbol_count(data_per_block, ec_ratio_100);
        if (data_per_block + ec <= CC_RS_MAX_BLOCK) break;
    }
    int ec_per_block = cc_rs_ec_symbol_count(data_per_block, ec_ratio_100);
    int block_total = data_per_block + ec_per_block;

    /* How many full blocks fit? */
    int num_blocks = (block_total > 0) ? total_raw_bytes / block_total : 0;
    if (num_blocks <= 0) {
        int min_data = total_raw_bytes > 1 ? total_raw_bytes : 1;
        int ec = cc_rs_ec_symbol_count(min_data, ec_ratio_100);
        int cap = total_raw_bytes - ec;
        return cap > 0 ? cap : 0;
    }

    /* Full blocks plus any remaining partial block */
    int capacity = num_blocks * data_per_block;
    int remaining = total_raw_bytes - num_blocks * block_total;
    if (remaining > 0) {
        int partial_ec = cc_rs_ec_symbol_count(remaining, ec_ratio_100);
        int partial_data = remaining - partial_ec;
        if (partial_data > 0) capacity += partial_data;
    }

    return capacity;
}

int cc_auto_size(int data_length, int mode, int ec_level, int has_sequence,
                 int *out_width, int *out_height)
{
    if (data_length == 0) {
        int hdr_size = cc_header_size(has_sequence);
        int bytes_per_cell = CC_BYTES_PER_CELL[mode];
        int header_cells = (hdr_size + bytes_per_cell - 1) / bytes_per_cell;
        for (int size = CC_MIN_GRID_SIZE; size <= CC_MAX_GRID_SIZE; size++) {
            if (cc_data_cell_count(size, size) >= header_cells) {
                *out_width = size;
                *out_height = size;
                return CC_OK;
            }
        }
    }

    for (int size = CC_MIN_GRID_SIZE; size <= CC_MAX_GRID_SIZE; size++) {
        int cap = cc_usable_capacity(size, size, mode, ec_level, has_sequence);
        if (cap >= data_length) {
            *out_width = size;
            *out_height = size;
            return CC_OK;
        }
    }

    return CC_ERR_INPUT;
}
