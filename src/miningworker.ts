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

let prefix: Uint8Array
let suffix: Uint8Array
let workBuffer: Uint8Array
let nonceOffset: number

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

const mine = () => {
  const BATCH_SIZE = 10_000

  for (let i = 0; i < BATCH_SIZE; i++) {
    binaryToHexBytes(nonceBinary, nonceHexBytes)
    workBuffer.set(nonceHexBytes, nonceOffset)

    const digest = blake2s(workBuffer)

    if (meetsTarget(digest, targetBytes)) {
      currentBlock.nonce = bytesToHex(nonceBinary)
      parentPort!.postMessage({ type: 'foundBlock', block: currentBlock })
      return
    }

    incrementNonce(nonceBinary)
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

  prefix = utf8ToBytes(before)
  suffix = utf8ToBytes(after)
  nonceOffset = prefix.length

  workBuffer = new Uint8Array(prefix.length + 64 + suffix.length)
  workBuffer.set(prefix, 0)
  workBuffer.set(suffix, prefix.length + 64)
}

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
