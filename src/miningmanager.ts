import crypto from 'crypto'
import { Worker } from 'worker_threads'
import { execFile, type ChildProcess } from 'child_process'
import canonicalize from 'canonicalize'
import { objectManager } from './object'
import { peerManager } from './peermanager'
import { mempoolManager } from './mempool'
import { Block } from './block'
import { TARGET, AGENT, BLOCK_REWARD } from './utils'
import { Transaction } from './transaction'
import { Logger, shortId } from './logger'
import type { BlockObject, TransactionObject } from './types'

const log = new Logger('miner')

const RUST_MINER_PATH = process.env.RUST_MINER_PATH || '../blake2s-gpu-miner/target/release/miner'

class MiningManager {
    workers: Worker[] = []
    rustMiners: ChildProcess[] = []
    numWorkers = 0
    minerType = 'js'
    totalHashes = 0
    workerRates = new Map<number, number>()
    miningStartTime = 0

    async init(numWorkers: number, minerType: string = 'js') {
        this.numWorkers = numWorkers
        this.minerType = minerType
        log.info(`Starting ${numWorkers} ${minerType} mining workers`)
        if (minerType === 'rust') {
            return
        }
        for (let i = 0; i < numWorkers; i++) {
            const worker = new Worker(new URL("./miningworker.js", import.meta.url))
            this.workers.push(worker)
            worker.on("message", (msg) => {
                if (msg.type === "foundBlock") {
                    this.onMinedBlock(msg.block)
                }
                if (msg.type === "progress") {
                    this.totalHashes += msg.hashes
                }
            })
        }
    }

    async onNewBlock(tip: Block) {
        const block = await this.createNextBlock(tip)
        this.workers.forEach(worker => worker.postMessage({ type: "abort" }))
        this.stopRustMiners()

        this.totalHashes = 0
        this.miningStartTime = Date.now()

        if (this.minerType === 'rust') {
            this.startRustMiners(block)
        }
        this.workers.forEach(worker => {
            block.nonce = this.randomNonce()
            worker.postMessage({ type: "newBlock", block })
        })
        log.debug(`Mining on block ${shortId(tip.id)} at height ${tip.height}`)
    }

    startRustMiners(block: any) {
        for (let i = 0; i < this.numWorkers; i++) {
            const miner = execFile(RUST_MINER_PATH, ['--stdin'], (err, stdout) => {
                if (err) {
                    if (!miner.killed) log.error('Rust miner failed', err.message)
                    return
                }
                const result = JSON.parse(stdout)
                this.totalHashes += result.hashes
                this.stopRustMiners()
                this.onMinedBlock(result.block)
            })
            miner.stdin!.end(canonicalize(block))
            this.rustMiners.push(miner)
        }
    }

    stopRustMiners() {
        this.rustMiners.forEach(miner => miner.kill())
        this.rustMiners = []
    }

    async onMinedBlock(tip: BlockObject) {
        const blockId = objectManager.id(tip)
        const elapsed = (Date.now() - this.miningStartTime) / 1000
        const mins = Math.floor(elapsed / 60)
        const secs = Math.floor(elapsed % 60)

        log.info(`Mined block ${shortId(blockId)} in ${mins}m${secs.toString().padStart(2, '0')}s | ${(this.totalHashes / 1e6).toFixed(1)}M hashes`)

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

    async calculateMempoolFees(): Promise<number> {
        let fees = 0
        for (const txid of mempoolManager.txids) {
            const tx = await objectManager.get(txid) as Transaction
            const outputsOfOutpoints = await Promise.all(
                tx.inputs.map(async (input) => await input.outpoint.getOutput())
            )
            const totalInputValue = outputsOfOutpoints.reduce(
                (acc, output) => acc + (output?.value ?? 0), 0
            )
            const totalOutputValue = tx.outputs.reduce(
                (acc, output) => acc + output.value, 0
            )
            fees += totalInputValue - totalOutputValue
        }
        return fees
    }

    async createNextBlock(tip: Block) {
        const fees = await this.calculateMempoolFees()
        const coinbase = await this.createCoinbase(tip.height! + 1, fees)
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

    async createCoinbase(height: number, fees: number = 0) {
        const coinbase = {
            type: "transaction",
            outputs: [{
                pubkey: process.env.PK,
                value: BLOCK_REWARD + fees
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
