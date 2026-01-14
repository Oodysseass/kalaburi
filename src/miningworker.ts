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

let nonceBytes: Uint8Array
let targetBytes: Uint8Array

let prefix: Uint8Array
let suffix: Uint8Array
let workBuffer: Uint8Array

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

  while (!abort) {
    for (let i = 0; i < BATCH_SIZE; i++) {
      workBuffer.set(prefix, 0)
      workBuffer.set(nonceBytes, prefix.length)
      workBuffer.set(suffix, prefix.length + nonceBytes.length)

      const digest = blake2s(workBuffer)

      if (meetsTarget(digest, targetBytes)) {
        currentBlock.nonce = bytesToHex(nonceBytes)
        parentPort!.postMessage({ type: 'foundBlock', block: currentBlock })
        return
      }

      incrementNonce(nonceBytes)
    }
  }
}

const setupCanonicalParts = () => {
  nonceBytes = hexToBytes(currentBlock.nonce)
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

  workBuffer = new Uint8Array(
    prefix.length + nonceBytes.length + suffix.length
  )
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
