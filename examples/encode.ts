import { encode } from 'chromacode'
import { writeFileSync } from 'node:fs'

const message = 'Hello, ChromaCode!'
const data = new TextEncoder().encode(message)

const png = encode(data, { mode: 'rgba32', ecLevel: 'M' })
writeFileSync('output.png', png)

console.log(`Encoded "${message}" (${data.length} bytes) → output.png (${png.length} bytes)`)
