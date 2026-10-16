import { objectManager } from './object'
import { mempoolManager } from './mempool'
import { miningManager } from './miningmanager'
import { Block } from './block'
import { GENESIS_BLOCK } from './utils'
import UTXOSet from './utxo'
import { InternalError } from './error'
import { Logger, shortId } from './logger'
import type { Hash } from './types'

const log = new Logger('chain')

class ChainManager {
    longestChain: Hash[] = []

    async init() {
        if (await objectManager.exists('longestChain')) {
            this.longestChain = await objectManager.get('longestChain')
            log.info(`Loaded chain with ${this.longestChain.length} blocks, tip: ${shortId(this.longestChain.slice(-1)[0])}`)
        } else {
            const genesisBlock = Block.fromNetwork(GENESIS_BLOCK)
            genesisBlock.height = 0
            genesisBlock.state = new UTXOSet()
            this.longestChain = [genesisBlock.id]
            await objectManager.add(this.longestChain, 'longestChain')
            await objectManager.add(genesisBlock, genesisBlock.id)
            log.info('Initialized with genesis block')
        }
        miningManager.onNewBlock(await objectManager.get(this.longestChain.slice(-1)[0]!) as Block)
    }

    async updateLongestChain(block: Block) {
        if (this.longestChain.length === 0) {
            this.longestChain = await this.getChain(block)
            for (const blkid of this.longestChain) {
                await mempoolManager.applyBlock(await objectManager.get(blkid) as Block)
            }
            miningManager.onNewBlock(block)
            log.info(`New chain tip at height ${block.height}: ${shortId(block.id)}`)
            return
        }

        const prevLength = this.longestChain.length
        const tipId = this.longestChain[prevLength - 1]
        if (block.height! > prevLength - 1) {
            const newChain = await this.getChain(block)

            if (newChain[prevLength - 1] !== tipId) {
                const lastCommonHeight = await this.lastCommonHeight(this.longestChain, newChain)
                log.warn(`Chain reorg detected: depth=${prevLength - 1 - lastCommonHeight}, common height=${lastCommonHeight}`)
                await mempoolManager.handleReorg(this.longestChain, newChain, lastCommonHeight)
            } else {
                const newBlocks = newChain.slice(prevLength)
                for (const blkid of newBlocks) {
                    await mempoolManager.applyBlock(await objectManager.get(blkid) as Block)
                }
            }

            this.longestChain = newChain
            await objectManager.add(this.longestChain, 'longestChain')
            miningManager.onNewBlock(block)
            log.info(`New chain tip at height ${block.height}: ${shortId(block.id)}`)
        }
    }

    async lastCommonHeight(oldChain: Hash[], newChain: Hash[]) {
        let i = oldChain.length - 1
        while (i > -1 && oldChain[i] !== newChain[i]) {
            i--
        }
        return i
    }

    async getChain(block: Block) {
        let chain: Hash[] = [block.id]
        let currentBlock = block
        while (currentBlock.previd !== null) {
            // stop walking back once we reach a block of the current longest chain
            if (this.longestChain[currentBlock.height! - 1] === currentBlock.previd) {
                return this.longestChain.slice(0, currentBlock.height!).concat(chain)
            }
            const parent = await objectManager.get(currentBlock.previd) as Block
            if (typeof parent === 'undefined') {
                throw new InternalError(`Parent block of ${block.id} not found`)
            }
            chain.unshift(parent.id)
            currentBlock = parent
        }
        return chain
    }
}

export const chainManager = new ChainManager()
