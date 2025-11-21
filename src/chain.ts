import type { Block } from './block'
import { objectManager } from './object'

class ChainManager {
    longestChain: Block[] = []

    async updateLongestChain(block: Block) {
        if (this.longestChain.length === 0) {
            this.longestChain = await this.getChain(block)
            return
        }
        const blockTip = this.longestChain[this.longestChain.length - 1]
        if (block.height > blockTip!.height) {
            if (block.previd === blockTip!.id) {
                this.longestChain.push(block)
            } else {
                this.longestChain = await this.getChain(block)
            }
        }
   }

    async getChain(block: Block) {
        let chain: Block[] = [block]
        let currentBlock = block
        while (currentBlock.previd !== null) {
            const parent = await objectManager.get(currentBlock.previd)
            if (typeof parent === 'undefined') {
                const error = new Error(`Parent block of ${block.id} not found`)
                error.name = 'INTERNAL_ERROR'
                throw error
            }
            chain.unshift(parent)
            currentBlock = parent
        }
        return chain
    }
}

export const chainManager = new ChainManager()
