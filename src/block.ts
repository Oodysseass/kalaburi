import canonicalize from 'canonicalize'
import { hash, BLOCK_REWARD, GENESIS_BLOCK_ID } from './utils'
import { objectManager } from './object'
import { Transaction } from './transaction'
import UTXOSet from './utxo'
import type { TransactionObject } from './types'
import type { Output } from './transaction'

export class Block {
    T: string
    created: number
    nonce: string
    txids: string[]
    type: string
    miner: string | null
    note: string | null
    previd: string | null
    studentids: string[] | null

    static fromObject(block_object: any) {
        return new Block(
            block_object.T,
            block_object.created,
            block_object.nonce,
            block_object.txids,
            block_object.type,
            block_object.previd ?? null,
            block_object.miner ?? null,
            block_object.note ?? null,
            block_object.studentids ?? null
        )
    }

    toObject() {
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
        studentids: string[] | null
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
    }

    async validate() {
        if (this.previd === null) {
            if (objectManager.id(this.toObject()) === GENESIS_BLOCK_ID) {
                const genesisState = new UTXOSet(new Map<string, Output>())
                await objectManager.add(genesisState, `${GENESIS_BLOCK_ID}:state`)
                return true
            }
            const error = new Error(`Block ${this.toObject()} has null previd but it isn't genesis.`)
            error.name = 'INVALID_GENESIS'
            throw error
        }

        await objectManager.findObject(this.previd)

        if (BigInt('0x' + hash(canonicalize(this.toObject()))) >= BigInt('0x' + this.T)) {
            const error = new Error('Block hash is not less than target')
            error.name = 'INVALID_BLOCK_POW'
            throw error
        }

        const txs: Transaction[] = []
        for (const txid of this.txids) {
            const txObject = await objectManager.findObject(txid)

            const tx = Transaction.fromObject(txObject)
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

            const spendCoinbase = nonCoinbase.some(tx =>
                tx.inputs.some(input =>
                    input.outpoint.txid === objectManager.id(
                        coinbase[0]?.toObject() as TransactionObject
                    )
                )
            )
            if (spendCoinbase) {
                const error = new Error('Coinbase cannot be spend in the same block')
                error.name = 'INVALID_TX_OUTPOINT'
                throw error
            }

            const fees = await this.calculateFees(nonCoinbase)
            const coinbaseValue = coinbase[0]!.outputs[0]!.value
            if (coinbaseValue !== BLOCK_REWARD + fees) {
                const error = new Error('Coinbase value is not equal to block reward plus fees')
                error.name = 'INVALID_BLOCK_COINBASE'
                throw error
            }
        }

        const oldState: UTXOSet = await objectManager.get(`${this.previd!}:state`)
        console.log("oldState", oldState)
        const newState = new UTXOSet(oldState.utxos)
        txs.forEach(tx => newState.apply(tx))

        const blockId = objectManager.id(this.toObject())
        await objectManager.add(newState, `${blockId}:state`)

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
