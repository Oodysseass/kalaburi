import UTXOSet from './utxo'
import { objectManager } from './object'
import { Transaction } from './transaction'
import { Block } from './block'
import { Logger, shortId } from './logger'
import type { Hash } from './types'

const log = new Logger('mempool')

class MempoolManager {
    txids: Hash[] = []
    currentState: UTXOSet = new UTXOSet()

    async init() {
        if (await objectManager.exists('longestChain')) {
            const blockids = await objectManager.get('longestChain')
            const block = await objectManager.get(blockids[blockids.length - 1]!) as Block
            this.currentState = new UTXOSet(block.state!.utxos)
        }
        this.txids = []
        log.info('Initialized mempool')
    }

    addTransaction(tx: Transaction) {
        if (tx.isCoinbase()) {
            return
        }

        this.currentState.apply(tx)
        this.txids.push(tx.id)
        log.debug(`Added tx ${shortId(tx.id)} (pool size: ${this.txids.length})`)
    }

    async applyBlock(block: Block) {
        this.currentState = new UTXOSet(block.state!.utxos)

        const oldTxs = await Promise.all(this.txids.map(async txid => await objectManager.get(txid) as Transaction))
        const prevSize = this.txids.length
        this.txids = []
        oldTxs.forEach(tx => {
            try {
                this.addTransaction(tx)
            } catch (err: any) {
                return
            }
        })
        if (prevSize > 0) {
            log.debug(`Applied block, revalidated ${this.txids.length}/${prevSize} txs`)
        }
    }

    async handleReorg(oldChain: Hash[], newChain: Hash[], commonHeight: number) {
        const newTip = await objectManager.get(newChain[newChain.length - 1]!) as Block
        this.currentState = new UTXOSet(newTip.state!.utxos)
        const removedBlocks = await Promise.all(oldChain.slice(commonHeight + 1).map(async blkid => await objectManager.get(blkid) as Block))
        const removedTxids = removedBlocks.flatMap(blk => blk.txids)

        let removedTxs = await Promise.all(removedTxids.map(async txid => await objectManager.get(txid) as Transaction))
        const oldTxs = await Promise.all(this.txids.map(async txid => await objectManager.get(txid) as Transaction))
        removedTxs = removedTxs.concat(oldTxs)
        this.txids = []
        removedTxs.forEach(tx => {
            try {
                this.addTransaction(tx)
            } catch (err: any) {
                return
            }
        })
        log.info(`Reorg handled: revalidated ${this.txids.length}/${removedTxs.length} txs`)
    }

}

export const mempoolManager = new MempoolManager()
