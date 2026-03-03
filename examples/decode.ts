import { decode } from 'chromacode'
import { readFileSync } from 'node:fs'

const png = readFileSync('output.png')
const data = decode(new Uint8Array(png))
const message = new TextDecoder().decode(data)

console.log(`Decoded ${png.length} bytes → "${message}"`)
