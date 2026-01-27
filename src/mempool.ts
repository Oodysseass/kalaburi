import UTXOSet from './utxo'
import { objectManager } from './object'
import { Transaction } from './transaction'
import { Block } from './block'
import type { Hash } from './types'

class MempoolManager {
    txids: Hash[] = []
    currentState: UTXOSet = new UTXOSet()

    async init() {
        if (await objectManager.exists('longestChain')) {
            const blocks = await objectManager.get('longestChain')
            const block = Block.fromJSON(blocks[blocks.length - 1]!)
            this.currentState = new UTXOSet(block.state!.utxos)
        } 
        this.txids = []
    }

    addTransaction(tx: Transaction) {
        if (tx.isCoinbase()) {
            return
        }

        try {
            this.currentState.apply(tx)
        } catch (err: any) {
            return
        }

        this.txids.push(tx.id)
    }

    async applyBlock(block: Block) {
        this.currentState = new UTXOSet(block.state!.utxos)

        const oldTxs = await Promise.all(this.txids.map(async txid => await objectManager.get(txid) as Transaction))
        this.txids = []
        oldTxs.forEach(tx => {
            try {
                this.addTransaction(tx)
            } catch (err: any) {
                return
            }
        })
    }

    async handleReorg(oldChain: Block[], newChain: Block[], commonHeight: number) {
        this.currentState = new UTXOSet(newChain[newChain.length - 1]!.state!.utxos)
        const removedTxids = oldChain.slice(commonHeight + 1)
                             .flatMap(blk => blk.txids)

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
    }

}

export const mempoolManager = new MempoolManager()
