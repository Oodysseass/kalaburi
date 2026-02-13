import { objectManager } from './object'
import { Transaction } from './transaction'
import UTXOSet from './utxo'
import { ValidationError, InternalError, ErrorName, DependencyError } from "./error"
import { BLOCK_REWARD, GENESIS_BLOCK_ID } from './utils'
import type { BlockObject, Hash } from './types'

export class Block {
    T: string
    created: number
    nonce: string
    txids: Hash[]
    type: string
    miner: string | null
    note: string | null
    previd: string | null
    studentids: string[] | null
    height: number | null
    state: UTXOSet | null
    id: Hash

    static fromNetwork(block: BlockObject) {
        return new Block(
            block.T,
            block.created,
            block.nonce,
            block.txids,
            block.type,
            block.previd ?? null,
            block.miner ?? null,
            block.note ?? null,
            block.studentids ?? null,
            null,
            null,
            objectManager.id(block)
        )
    }

    static async fromMining(minedBlock: BlockObject) {
        const block = new Block(
                    minedBlock.T,
                    minedBlock.created,
                    minedBlock.nonce,
                    minedBlock.txids,
                    minedBlock.type,
                    minedBlock.previd ?? null,
                    minedBlock.miner ?? null,
                    minedBlock.note ?? null,
                    minedBlock.studentids ?? null,
                    null,
                    null,
                    objectManager.id(minedBlock)
                )

        if (BigInt('0x' + block.id) >= BigInt('0x' + block.T)) {
            throw new InternalError(`Mined block ${block.id} does not satisfy PoW inequality`)
        }

        if (minedBlock.previd === null) {
            throw new InternalError(`Mined block has no parent`)
        }
        const parent = await objectManager.get(minedBlock.previd!) as Block

        if (parent.height === null) {
            throw new InternalError(`Parent block height is null`)
        }
        block.height = parent.height + 1

        if (parent.state === null) {
            throw new InternalError(`Parent block state is null`)
        }
        const newState = new UTXOSet(parent.state.utxos)

        for (const txid of minedBlock.txids) {
            const tx = await objectManager.get(txid) as Transaction
            if (typeof tx === 'undefined') {
                throw new InternalError(`Mined block has unknown transactions`)
            }
            newState.apply(tx)
        }
        block.state = newState

        return block
    }

    static fromJSON(block: any) {
        return new Block(
            block.T,
            block.created,
            block.nonce,
            block.txids,
            block.type,
            block.previd,
            block.miner,
            block.note,
            block.studentids,
            block.height,
            new UTXOSet(block.state.utxos),
            block.id
        )
    }

    toNetwork() {
        return {
            T: this.T,
            created: this.created,
            nonce: this.nonce,
            txids: this.txids,
            type: this.type,
            previd: this.previd,
            ...(this.miner !== null && { miner: this.miner }),
            ...(this.note !== null && { note: this.note }),
            ...(this.studentids !== null && { studentids: this.studentids })
        }
    }

    constructor(
        T: string,
        created: number,
        nonce: string,
        txids: string[],
        type: string,
        previd: string | null,
        miner: string | null,
        note: string | null,
        studentids: string[] | null,
        height: number | null,
        state: UTXOSet | null,
        id: Hash
    ) {
        this.T = T
        this.created = created
        this.nonce = nonce
        this.txids = txids
        this.type = type
        this.miner = miner
        this.note = note
        this.previd = previd
        this.studentids = studentids
        this.height = height
        this.state = state
        this.id = id
    }

    async validate() {
        if (this.previd === null) {
            if (this.id !== GENESIS_BLOCK_ID) {
                throw new ValidationError(ErrorName.INVALID_GENESIS, `Block ${this.id} has null previd but it is not genesis.`)
            }
            this.height = 0
            this.state = new UTXOSet()
            return true
        }

        if (BigInt('0x' + this.id) >= BigInt('0x' + this.T)) {
            throw new ValidationError(ErrorName.INVALID_BLOCK_POW, `Block ${this.id} is not less than target`)
        }

        let parent: Block
        try {
            parent = await objectManager.findObject(this.previd) as Block
        } catch (err: any) {
            throw err instanceof DependencyError ? err : new DependencyError(err)
        }

        if (this.created <= parent.created) {
            throw new ValidationError(ErrorName.INVALID_BLOCK_TIMESTAMP, `Block creation time ${this.created} is not greater than parent block's creation time ${parent.created}.`)
        }
        if (this.created * 1000 > Date.now()) {
            throw new ValidationError(ErrorName.INVALID_BLOCK_TIMESTAMP, `Block creation time is in the future.`)
        }
        if (parent.state === null) {
            throw new InternalError(`Parent block state is null`)
        }
        if (parent.height === null) {
            throw new InternalError(`Parent block height is null.`)
        }
        this.height = parent.height + 1

        let txs: Transaction[]
        try {
            txs = await Promise.all([
                ...this.txids.map(txid => objectManager.findObject(txid))
            ]) as Transaction[]
        } catch (err: any) {
            throw err instanceof DependencyError ? err : new DependencyError(err)
        }


        const coinbase = txs.filter(tx => tx.isCoinbase())
        const nonCoinbase = txs.filter(tx => !tx.isCoinbase())
        if (coinbase.length > 0) {
            if (coinbase.length > 1) {
                throw new ValidationError(ErrorName.INVALID_BLOCK_COINBASE, `Block has more than one coinbase transactions.`)
            }

            if (coinbase[0].height !== this.height) {
                throw new ValidationError(ErrorName.INVALID_BLOCK_COINBASE, `Coinbase height ${coinbase[0]?.height} is not equal to block height ${this.height}.`)
            }

            const spendCoinbase = nonCoinbase.some(tx =>
                tx.inputs.some(input =>
                    input.outpoint.txid === coinbase[0].id
                )
            )
            if (spendCoinbase) {
                throw new ValidationError(ErrorName.INVALID_TX_OUTPOINT, `Coinbase cannot be spent in the same block.`)
            }

            const fees = await this.calculateFees(nonCoinbase)
            const coinbaseValue = coinbase[0].outputs.reduce((acc, output) => acc + output.value, 0)
            if (coinbaseValue > BLOCK_REWARD + fees) {
                throw new ValidationError(ErrorName.INVALID_BLOCK_COINBASE, `Coinbase value ${coinbaseValue} is greater than block reward ${BLOCK_REWARD} plus fees ${fees}.`)
            }
        }

        const newState = new UTXOSet(parent.state.utxos)
        txs.forEach(tx => newState.apply(tx))
        this.state = newState

        return true
    }

    async calculateFees(txs: Transaction[]) {
        let fees = 0
        for (const tx of txs) {
            const outputsOfOutpoints = await Promise.all(
                tx.inputs.map(async (input) => await input.outpoint.getOutput())
            )
            const outpointValues = await Promise.all(
                outputsOfOutpoints.map((output) => output?.value ?? 0)
            )
            const totalInputValue = outpointValues.reduce(
                (acc, value) => acc + value, 0
            )
            const totalOutputValue = tx.outputs.reduce(
                (acc, output) => acc + output.value, 0
            )
            fees += totalInputValue - totalOutputValue
        }
        return fees
    }
}
