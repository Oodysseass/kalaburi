import { blake2s } from '@noble/hashes/blake2'
import { utf8ToBytes } from '@noble/hashes/utils'
import canonicalize from 'canonicalize'

const TARGET = '00000000abc00000000000000000000000000000000000000000000000000000'
const HEX_CHARS = utf8ToBytes('0123456789abcdef')

const block = {
    T: TARGET,
    created: Math.floor(Date.now() / 1000),
    miner: 'bench',
    nonce: '0'.repeat(64),
    previd: '0'.repeat(64),
    txids: [],
    type: 'block',
}

const blockCopy = { ...block, nonce: '' }
const canon = canonicalize(blockCopy)!
const marker = '"nonce":""'
const idx = canon.indexOf(marker)
const prefix = utf8ToBytes(canon.slice(0, idx + '"nonce":"'.length))
const suffix = utf8ToBytes(canon.slice(idx + marker.length - 1))

const nonceOffset = prefix.length
const workBuffer = new Uint8Array(prefix.length + 64 + suffix.length)
workBuffer.set(prefix, 0)
workBuffer.set(suffix, prefix.length + 64)

const nonceBinary = new Uint8Array(32)
const nonceHexBytes = new Uint8Array(64)

const binaryToHexBytes = (bin: Uint8Array, out: Uint8Array) => {
    for (let i = 0; i < bin.length; i++) {
        out[i * 2] = HEX_CHARS[bin[i] >> 4]
        out[i * 2 + 1] = HEX_CHARS[bin[i] & 0x0f]
    }
}

const incrementNonce = (n: Uint8Array) => {
    for (let i = n.length - 1; i >= 0; i--) {
        if (++n[i] !== 0) break
    }
}

const DURATION_MS = 10_000
const SAMPLE_INTERVAL = 500_000

let totalHashes = 0
let sampleHashes = 0
const start = performance.now()
let lastSample = start

console.log(`Benchmarking blake2s mining for ${DURATION_MS / 1000}s...\n`)

while (performance.now() - start < DURATION_MS) {
    for (let i = 0; i < 10_000; i++) {
        binaryToHexBytes(nonceBinary, nonceHexBytes)
        workBuffer.set(nonceHexBytes, nonceOffset)
        blake2s(workBuffer)
        incrementNonce(nonceBinary)
    }
    totalHashes += 10_000
    sampleHashes += 10_000

    if (sampleHashes >= SAMPLE_INTERVAL) {
        const now = performance.now()
        const rate = sampleHashes / ((now - lastSample) / 1000)
        console.log(`  ${(rate / 1000).toFixed(0)}K H/s`)
        sampleHashes = 0
        lastSample = now
    }
}

const elapsed = (performance.now() - start) / 1000
const avgRate = totalHashes / elapsed

console.log(`\nResults:`)
console.log(`  Total hashes:  ${totalHashes.toLocaleString()}`)
console.log(`  Duration:      ${elapsed.toFixed(2)}s`)
console.log(`  Average rate:  ${(avgRate / 1000).toFixed(0)}K H/s`)
