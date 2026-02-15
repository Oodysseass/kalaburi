import crypto from 'crypto'
import { Worker } from 'worker_threads'
import { objectManager } from './object'
import { peerManager } from './peermanager'
import { mempoolManager } from './mempool'
import { Block } from './block'
import { TARGET, AGENT, BLOCK_REWARD } from './utils'
import { Transaction } from './transaction'
import { Logger, shortId } from './logger'
import type { BlockObject, TransactionObject } from './types'

const log = new Logger('miner')

class MiningManager {
    workers: Worker[] = []

    async init(numWorkers: number) {
        log.info(`Starting ${numWorkers} mining workers`)
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
        log.debug(`Mining on block ${shortId(tip.id)} at height ${tip.height}`)
    }

    async onMinedBlock(tip: BlockObject) {
        const blockId = objectManager.id(tip)
        log.info(`Mined block ${blockId}`)

        let block
        try {
            block = await Block.fromMining(tip)
        } catch (err: any) {
            log.error('Failed to create block from mined data', err.message)
            return
        }
        await objectManager.fromMining(block)
        peerManager.fromMining(block.id)
    }

    async createNextBlock(tip: Block) {
        const coinbase = await this.createCoinbase(tip.height! + 1)
        const txids = [objectManager.id(coinbase), ...mempoolManager.txids]
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
        const bytes = crypto.randomBytes(32)
        return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")
    }
}

export const miningManager = new MiningManager()
