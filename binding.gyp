{
  "targets": [
    {
      "target_name": "chromacode_native",
      "sources": [
        "native/napi/addon.c",
        "native/src/crc32.c",
        "native/src/gf256.c",
        "native/src/reed_solomon.c",
        "native/src/png.c",
        "native/src/channels.c",
        "native/src/grid.c",
        "native/src/interleave.c",
        "native/src/auto_size.c",
        "native/src/encode.c",
        "native/src/decode.c",
        "native/src/capacity.c"
      ],
      "include_dirs": [
        "native/include"
      ],
      "defines": [
        "NAPI_VERSION=8"
      ],
      "cflags": [
        "-std=c99",
        "-Wall",
        "-Wextra",
        "-O2"
      ],
      "conditions": [
        ["OS=='linux'", {
          "libraries": [
            "-L<(module_root_dir)/native/lib",
            "-lz",
            "-lpthread"
          ],
          "ldflags": [
            "-Wl,-rpath,/usr/lib/x86_64-linux-gnu"
          ]
        }],
        ["OS=='mac'", {
          "libraries": [
            "-lz"
          ]
        }],
        ["OS=='win'", {
          "libraries": [
            "zlib.lib"
          ]
        }]
      ]
    }
  ]
}
