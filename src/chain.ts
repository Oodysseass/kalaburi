import { objectManager } from './object'
import { mempoolManager } from './mempool'
import { miningManager } from './miningmanager'
import { Block } from './block'
import { GENESIS_BLOCK } from './utils'
import UTXOSet from './utxo'
import { InternalError } from './error'
import { Logger, shortId } from './logger'

const log = new Logger('chain')

class ChainManager {
    longestChain: Block[] = []

    async init() {
        if (await objectManager.exists('longestChain')) {
            const blocks = (await objectManager.get('longestChain'))
            this.longestChain = blocks.map((block: any) => Block.fromJSON(block))
            log.info(`Loaded chain with ${this.longestChain.length} blocks, tip: ${shortId(this.longestChain.slice(-1)[0]?.id)}`)
        } else {
            const genesisBlock = Block.fromNetwork(GENESIS_BLOCK)
            genesisBlock.height = 0
            genesisBlock.state = new UTXOSet()
            this.longestChain = [genesisBlock]
            await objectManager.add([genesisBlock], 'longestChain')
            await objectManager.add(genesisBlock, genesisBlock.id)
            log.info('Initialized with genesis block')
        }
        miningManager.onNewBlock(this.longestChain.slice(-1)[0])
    }

    async updateLongestChain(block: Block) {
        if (this.longestChain.length === 0) {
            this.longestChain = await this.getChain(block)
            for (const blk of this.longestChain) {
                await mempoolManager.applyBlock(blk)
            }
            miningManager.onNewBlock(block)
            log.info(`New chain tip at height ${block.height}: ${shortId(block.id)}`)
            return
        }

        const prevLength = this.longestChain.length
        const blockTip = this.longestChain[prevLength - 1]
        if (block.height! > blockTip!.height!) {
            const newChain = await this.getChain(block)

            if (newChain[prevLength - 1]!.id !== blockTip!.id) {
                const lastCommonHeight = await this.lastCommonHeight(this.longestChain, newChain)
                log.warn(`Chain reorg detected: depth=${prevLength - 1 - lastCommonHeight}, common height=${lastCommonHeight}`)
                await mempoolManager.handleReorg(this.longestChain, newChain, lastCommonHeight)
            } else {
                const newBlocks = newChain.slice(prevLength)
                for (const blk of newBlocks) {
                    await mempoolManager.applyBlock(blk)
                }
            }

            this.longestChain = newChain
            await objectManager.add(this.longestChain, 'longestChain')
            miningManager.onNewBlock(this.longestChain.slice(-1)[0])
            log.info(`New chain tip at height ${block.height}: ${shortId(block.id)}`)
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
