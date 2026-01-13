import { parentPort } from 'worker_threads'
import { objectManager } from './object'
import type { BlockObject } from './types'

if (!parentPort) {
    throw new Error('Worker not initialized')
}

let abort = false
let currentBlock: BlockObject | null = null

parentPort.on("message", (msg) => {
    if (msg.type === "abort") {
        abort = true
        return
    }

    if (msg.type === "newBlock") {
        abort = false
        currentBlock = msg.block
        mine()
    }
    return
})

const mine = () => {
    while (!abort) {
        if (BigInt('0x' + objectManager.id(currentBlock)) < BigInt('0x' + currentBlock!.T))
            break
        currentBlock!.nonce = incrementNonce(currentBlock!.nonce)
    }
    parentPort!.postMessage({ type: "foundBlock", block: currentBlock })
}

const incrementNonce = (hex: string) => {
    const bytes = new Uint8Array(32)

    hex = hex.padStart(64, "0");
    for (let i = 0; i < 32; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    }

    for (let i = bytes.length - 1; i >= 0; i--) {
        const next = bytes[i] + 1
        if (next <= 0xFF) {
            bytes[i] = next
            break
        }
        bytes[i] = 0
    }

    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")
}
