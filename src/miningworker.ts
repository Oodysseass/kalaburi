import { parentPort } from 'worker_threads'
import { blake2s } from '@noble/hashes/blake2'
import { utf8ToBytes } from '@noble/hashes/utils'
import canonicalize from 'canonicalize'
import type { BlockObject } from './types'

if (!parentPort) {
  throw new Error('Worker not initialized')
}

let abort = false
let currentBlock: BlockObject

let nonceBinary: Uint8Array
let nonceHexBytes: Uint8Array
let targetBytes: Uint8Array

let suffixBuf: Uint8Array
let prefixHasher: ReturnType<typeof blake2s.create>
let reusableClone: ReturnType<typeof blake2s.create>

const HEX_CHARS = utf8ToBytes('0123456789abcdef')

parentPort.on('message', (msg) => {
  if (msg.type === 'abort') {
    abort = true
    return
  }

  if (msg.type === 'newBlock') {
    abort = false
    currentBlock = msg.block
    setupCanonicalParts()
    mine()
  }
})

let hashCount = 0
let lastReport = Date.now()

const mine = () => {
  const BATCH_SIZE = 10_000

  for (let i = 0; i < BATCH_SIZE; i++) {
    binaryToHexBytes(nonceBinary, nonceHexBytes)

    const clone = prefixHasher._cloneInto(reusableClone)
    clone.update(nonceHexBytes)
    clone.update(suffixBuf)
    const digest = clone.digest()

    if (meetsTarget(digest, targetBytes)) {
      currentBlock.nonce = bytesToHex(nonceBinary)
      parentPort!.postMessage({ type: 'foundBlock', block: currentBlock })
      return
    }

    incrementNonce(nonceBinary)
  }

  hashCount += BATCH_SIZE
  const now = Date.now()
  if (now - lastReport >= 10_000) {
    const rate = hashCount / ((now - lastReport) / 1000)
    parentPort!.postMessage({ type: 'progress', hashes: hashCount, rate })
    hashCount = 0
    lastReport = now
  }

  if (!abort) setImmediate(mine)
}

const setupCanonicalParts = () => {
  nonceBinary = hexToBytes(currentBlock.nonce)
  nonceHexBytes = new Uint8Array(64)
  targetBytes = hexToBytes(currentBlock.T)

  const blockCopy: BlockObject = { ...currentBlock, nonce: '' }
  const canon = canonicalize(blockCopy)
  if (!canon) throw new Error('Canonicalization failed')

  const marker = '"nonce":""'
  const idx = canon.indexOf(marker)
  if (idx === -1) throw new Error('Nonce field not found')

  const before = canon.slice(0, idx + '"nonce":"'.length)
  const after = canon.slice(idx + marker.length - 1)

  const prefixBytes = utf8ToBytes(before)
  suffixBuf = utf8ToBytes(after)

  prefixHasher = blake2s.create()
  prefixHasher.update(prefixBytes)
  reusableClone = prefixHasher.clone()
}

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

const meetsTarget = (hash: Uint8Array, target: Uint8Array) => {
  for (let i = 0; i < hash.length; i++) {
    if (hash[i] < target[i]) return true
    if (hash[i] > target[i]) return false
  }
  return true
}

const hexToBytes = (hex: string) => {
  hex = hex.padStart(64, '0')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
