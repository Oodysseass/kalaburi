import { objectManager } from './object'
import { mempoolManager } from './mempool'
import { miningManager } from './miningmanager'
import { Block } from './block'
import { GENESIS_BLOCK } from './utils'
import UTXOSet from './utxo'
import { InternalError } from './error'

class ChainManager {
    longestChain: Block[] = []

    async init() {
        if (await objectManager.exists('longestChain')) {
            const blocks = (await objectManager.get('longestChain'))
            this.longestChain = blocks.map((block: any) => Block.fromJSON(block))
        } else {
            const genesisBlock = Block.fromNetwork(GENESIS_BLOCK)
            genesisBlock.height = 0
            genesisBlock.state = new UTXOSet()
            this.longestChain = [genesisBlock]
            await objectManager.add([genesisBlock], 'longestChain')
            await objectManager.add(genesisBlock, genesisBlock.id)
        }
        miningManager.onNewBlock(this.longestChain.slice(-1)[0])
    }

    async updateLongestChain(block: Block) {
        if (this.longestChain.length === 0) {
            this.longestChain = await this.getChain(block)
            this.longestChain.forEach(async (blk) => {
                await mempoolManager.applyBlock(blk)
            })
            miningManager.onNewBlock(block)
            return
        }

        const prevLength = this.longestChain.length
        const blockTip = this.longestChain[prevLength - 1]
        if (block.height! > blockTip!.height!) {
            const newChain = await this.getChain(block)

            if (newChain[prevLength - 1]!.id !== blockTip!.id) {
                const lastCommonHeight = await this.lastCommonHeight(this.longestChain, newChain)
                await mempoolManager.handleReorg(this.longestChain, newChain, lastCommonHeight)
            } else {
                const newBlocks = newChain.slice(prevLength)
                newBlocks.forEach(async (blk) => {
                    await mempoolManager.applyBlock(blk)
                })
            }

            this.longestChain = newChain
            await objectManager.add(this.longestChain, 'longestChain')
            miningManager.onNewBlock(this.longestChain.slice(-1)[0])
        }
    }

    async lastCommonHeight(oldChain: Block[], newChain: Block[]) {
        let i = oldChain.length - 1
        while (i > -1 && oldChain[i]!.id !== newChain[i]!.id) {
            i--
        }
        return i
    }

    async getChain(block: Block) {
        let chain: Block[] = [block]
        let currentBlock = block
        while (currentBlock.previd !== null) {
            const parent = await objectManager.get(currentBlock.previd) as Block
            if (typeof parent === 'undefined') {
                throw new InternalError(`Parent block of ${block.id} not found`)
            }
            chain.unshift(parent)
            currentBlock = parent
        }
        return chain
    }
}

export const chainManager = new ChainManager()
