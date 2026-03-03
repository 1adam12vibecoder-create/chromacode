cmake_minimum_required(VERSION 3.10)
project(chromacode C)

set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

# Warnings
add_compile_options(-Wall -Wextra -Wpedantic -Werror=implicit-function-declaration)

# Find zlib
find_package(ZLIB REQUIRED)

# Library sources
set(LIB_SOURCES
    src/crc32.c
    src/gf256.c
    src/reed_solomon.c
    src/png.c
    src/channels.c
    src/grid.c
    src/interleave.c
    src/auto_size.c
    src/encode.c
    src/decode.c
    src/capacity.c
)

# Static library
add_library(chromacode STATIC ${LIB_SOURCES})
target_include_directories(chromacode PUBLIC include)
target_link_libraries(chromacode PUBLIC ZLIB::ZLIB)

# Shared library (for N-API)
add_library(chromacode_shared SHARED ${LIB_SOURCES})
target_include_directories(chromacode_shared PUBLIC include)
target_link_libraries(chromacode_shared PUBLIC ZLIB::ZLIB)
set_target_properties(chromacode_shared PROPERTIES OUTPUT_NAME chromacode)

# Test binary
add_executable(test_chromacode test/test_chromacode.c)
target_link_libraries(test_chromacode PRIVATE chromacode)
target_link_libraries(test_chromacode PRIVATE m)

enable_testing()
add_test(NAME chromacode_tests COMMAND test_chromacode)
