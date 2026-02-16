import { blake2s } from '@noble/hashes/blake2'
import { utf8ToBytes } from '@noble/hashes/utils'

const HEX_CHARS = utf8ToBytes('0123456789abcdef')

const binaryToHexBytes = (bin: Uint8Array, out: Uint8Array) => {
  for (let i = 0; i < bin.length; i++) {
    out[i * 2] = HEX_CHARS[bin[i] >> 4]
    out[i * 2 + 1] = HEX_CHARS[bin[i] & 0x0f]
  }
}

const incrementNonce = (n: Uint8Array) => {
  for (let i = n.length - 1; i >= 0; i--) {
    n[i]++
    if (n[i] !== 0) break
  }
}

const prefix = utf8ToBytes('{"T":"00000000abc00000000000000000000000000000000000000000000000000000","created":1234567890,"miner":"bench","nonce":"')
const suffix = utf8ToBytes('","note":"benchmark block","previd":"0000000000000000000000000000000000000000000000000000000000000000","txids":[],"type":"block"}')

const nonceHexBytes = new Uint8Array(64)
const n = new Uint8Array(32)
const ITERATIONS = 1_000_000
const WARMUP = 100_000

const prefixHasher = blake2s.create()
prefixHasher.update(prefix)

for (let i = 0; i < WARMUP; i++) {
  binaryToHexBytes(n, nonceHexBytes)
  const clone = prefixHasher.clone()
  clone.update(nonceHexBytes)
  clone.update(suffix)
  clone.digest()
  incrementNonce(n)
}

const start = performance.now()
for (let i = 0; i < ITERATIONS; i++) {
  binaryToHexBytes(n, nonceHexBytes)
  const clone = prefixHasher.clone()
  clone.update(nonceHexBytes)
  clone.update(suffix)
  clone.digest()
  incrementNonce(n)
}
const elapsed = (performance.now() - start) / 1000
console.log(`${(ITERATIONS / elapsed / 1000).toFixed(1)}k H/s  (${ITERATIONS.toLocaleString()} hashes in ${elapsed.toFixed(2)}s)`)
