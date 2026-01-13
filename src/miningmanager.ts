import { Worker } from 'worker_threads'
import { objectManager } from './object'
import { peerManager } from './peermanager'
import { mempoolManager } from './mempool'
import { Block } from './block'
import { TARGET, AGENT, BLOCK_REWARD } from './utils'
import { Transaction } from './transaction'
import type { BlockObject, TransactionObject } from './types'

class MiningManager {
    workers: Worker[] = []

    async init(numWorkers: number) {
        for (let i = 0; i < numWorkers; i++) {
            const worker = new Worker(new URL("./miningworker.js", import.meta.url))
            this.workers.push(worker)
            worker.on("message", (msg) => {
                if (msg.type === "foundBlock") {
                    this.onMinedBlock(msg.block)
                }
            })
        }
    }

    async onNewBlock(tip: Block) {
        const block = await this.createNextBlock(tip)
        this.workers.forEach(worker => worker.postMessage({ type: "abort" }))
        this.workers.forEach(worker => {
            block.nonce = this.randomNonce()
            worker.postMessage({ type: "newBlock", block })
        })
    }

    async onMinedBlock(tip: BlockObject) {
        console.log(`Mined block ${tip.previd}`)
        const block = await Block.fromMining(tip)
        await objectManager.fromMining(block)
        peerManager.fromMining(block.id)
    }

    async createNextBlock(tip: Block) {
        const coinbase = await this.createCoinbase(tip.height! + 1)
        const txids = mempoolManager.txids.concat(objectManager.id(coinbase))
        return {
            T: TARGET,
            previd: tip.id,
            created: Math.floor(Date.now() / 1000),
            miner: AGENT,
            nonce: this.randomNonce(),
            txids,
            type: "block"
        }
    }

    async createCoinbase(height: number) {
        const coinbase = {
            type: "transaction",
            outputs: [{
                pubkey: process.env.PK,
                value: BLOCK_REWARD
            }],
            height: height
        }
        const tx = Transaction.fromNetwork(coinbase as TransactionObject)
        await objectManager.add(tx, tx.id)
        return coinbase
    }

    randomNonce(): string {
        const bytes = crypto.getRandomValues(new Uint8Array(32))
        return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")
    }
}

export const miningManager = new MiningManager()
