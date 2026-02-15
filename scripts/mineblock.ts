import os from 'os'
import { Worker } from 'worker_threads'
import { blake2s } from '@noble/hashes/blake2'
import { utf8ToBytes } from '@noble/hashes/utils'
import canonicalize from 'canonicalize'
import crypto from 'crypto'
import type { BlockObject } from '../src/types'

const TARGET = "00000000abc00000000000000000000000000000000000000000000000000000"
const NUM_WORKERS = os.cpus().length

const block: BlockObject = {
  T: TARGET,
  created: Math.floor(Date.now() / 1000),
  miner: "Marabu",
  nonce: "0000000000000000000000000000000000000000000000000000000000000000",
  note: "Financial Times 2026-02-13: Crypto's battle with the banks is splitting Trump's base",
  previd: null,
  txids: [],
  type: "block"
}

const hash = (obj: any) =>
  Buffer.from(blake2s(utf8ToBytes(canonicalize(obj)!))).toString('hex')

console.log(`Mining genesis block with ${NUM_WORKERS} workers...`)
console.log(`Target:  ${TARGET}`)
console.log(`Note:    ${block.note}`)
console.log(`Started: ${new Date().toLocaleString()}`)
console.log()

const workers: Worker[] = []
let found = false
const startTime = Date.now()

for (let i = 0; i < NUM_WORKERS; i++) {
  const workerBlock = { ...block }
  const nonce = crypto.randomBytes(32)
  nonce[0] = i
  workerBlock.nonce = nonce.toString('hex')

  const worker = new Worker(new URL('../dist/miningworker.js', import.meta.url))

  worker.on('message', (msg) => {
    if (msg.type === 'foundBlock' && !found) {
      found = true
      const elapsed = (Date.now() - startTime) / 1000
      const minedBlock = msg.block as BlockObject
      const blockId = hash(minedBlock)

      console.log(`Mined:   ${new Date().toLocaleString()}`)
      console.log(`Elapsed: ${elapsed.toFixed(1)}s`)
      console.log(`Block ID: ${blockId}`)
      console.log(`Nonce:    ${minedBlock.nonce}`)
      console.log()
      console.log(JSON.stringify(minedBlock, null, 2))

      for (const w of workers) {
        w.postMessage({ type: 'abort' })
        w.terminate()
      }
    }
  })

  worker.on('error', (err) => {
    console.error(`Worker ${i} error:`, err)
  })

  workers.push(worker)
  worker.postMessage({ type: 'newBlock', block: workerBlock })
}
