import { BLOCK_REWARD, GENESIS_BLOCK_ID } from './utils'
import { objectManager } from './object'
import { Transaction } from './transaction'
import UTXOSet from './utxo'
import type { BlockObject, Hash } from './types'
import type { Output } from './transaction'

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
    height: number = -1
    state: UTXOSet | undefined
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
            objectManager.id(block)
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
        this.id = id
    }

    async validate() {
        if (this.previd === null) {
            if (this.id !== GENESIS_BLOCK_ID) {
                const error = new Error(`Block ${this.toNetwork()} has null previd but it isn't genesis.`)
                error.name = 'INVALID_GENESIS'
                throw error
            }
            this.height = 0
            this.state = new UTXOSet(new Map<string, Output>())
            return true
        }

        if (BigInt('0x' + this.id) >= BigInt('0x' + this.T)) {
            const error = new Error('Block hash is not less than target')
            error.name = 'INVALID_BLOCK_POW'
            throw error
        }

        const parent = await objectManager.findObject(this.previd) as Block
        if (this.created <= parent.created) {
            const error = new Error(`Block creation time ${this.created} is not greater than parent block's creation time ${parent.created}.`)
            error.name = 'INVALID_BLOCK_TIMESTAMP'
            throw error
        }
        if (this.created * 1000 > Date.now()) {
            const error = new Error('Block creation time is in the future')
            error.name = 'INVALID_BLOCK_TIMESTAMP'
            throw error
        }
        if (typeof parent.state === 'undefined') {
            const error = new Error('Parent block state is undefined')
            error.name = 'INTERNAL_ERROR'
            throw error
        }
        if (parent.height === -1) {
            const error = new Error('Parent block height is not set')
            error.name = 'INTERNAL_ERROR'
            throw error
        }
        this.height = parent.height + 1

        const txs: Transaction[] = []
        for (const txid of this.txids) {
            const tx = await objectManager.findObject(txid) as Transaction

            await tx.validate()
            txs.push(tx)
        }

        const coinbase = txs.filter(tx => tx.isCoinbase())
        const nonCoinbase = txs.filter(tx => !tx.isCoinbase())
        if (coinbase.length > 0) {
            if (coinbase.length > 1) {
                const error = new Error('Block has more than one coinbase')
                error.name = 'INVALID_BLOCK_COINBASE'
                throw error
            }

            if (coinbase[0]?.height !== this.height) {
                const error = new Error('Coinbase height is not equal to block height')
                error.name = 'INVALID_BLOCK_COINBASE'
                throw error
            }

            const spendCoinbase = nonCoinbase.some(tx =>
                tx.inputs.some(input =>
                    input.outpoint.txid === coinbase[0]?.id
                )
            )
            if (spendCoinbase) {
                const error = new Error('Coinbase cannot be spend in the same block')
                error.name = 'INVALID_TX_OUTPOINT'
                throw error
            }

            const fees = await this.calculateFees(nonCoinbase)
            const coinbaseValue = coinbase[0]?.outputs.reduce((acc, output) => acc + output.value, 0) ?? 0
            if (coinbaseValue !== BLOCK_REWARD + fees) {
                const error = new Error('Coinbase value is not equal to block reward plus fees')
                error.name = 'INVALID_BLOCK_COINBASE'
                throw error
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
