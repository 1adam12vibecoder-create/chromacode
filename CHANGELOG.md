# Changelog

## 0.1.0

Initial release.

- Encode binary data into ChromaCode PNG images
- Decode ChromaCode PNG images back to binary data
- Four encoding modes: `rgba64`, `rgba32`, `rgb48`, `rgb24`
- Reed-Solomon error correction with four levels (L/M/Q/H)
- Deflate compression support
- Multi-image sequence support for large payloads
- Auto-sizing grid dimensions
- Capacity calculator API
- Native C implementation (optional)
- Full protocol specification (PROTOCOL.md)
