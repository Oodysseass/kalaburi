import canonicalize from 'canonicalize'
import { objectManager } from './object'
import { verify } from './utils'
import type { Hash } from './types'
import type {
    OutpointObject,
    InputObject,
    OutputObject,
    TransactionObject,
    PubKey
} from './types'

class Outpoint {
    txid: Hash
    index: number

    static fromObject(outpoint_object: OutpointObject) {
        return new Outpoint(outpoint_object.txid, outpoint_object.index)
    }

    constructor(txid: string, index: number) {
        this.txid = txid
        this.index = index
    }

    async validate() {
        const tx = await objectManager.get(this.txid)
        if (!tx) {
            const error = new Error(`Transaction ${this.txid} does not exist`)
            error.name = 'UNKNOWN_OBJECT'
            throw error
        }

        if (tx.outputs.length <= this.index) {
            const error = new Error(`Output index ${this.index} for transaction ${this.txid} does not exist`)
            error.name = 'INVALID_TX_OUTPOINT'
            throw error
        }

        return true
    }

    async getOutput() {
        const tx: TransactionObject | null = await objectManager.get(this.txid)
        return tx?.outputs[this.index]
    }
}

class Input {
    outpoint: Outpoint
    sig: string

    static fromObject(input_object: InputObject) {
        return new Input(Outpoint.fromObject(input_object.outpoint), input_object.sig)
    }

    constructor(outpoint: Outpoint, sig: string) {
        this.outpoint = outpoint
        this.sig = sig
    }

    objectToSignable() {
        return { outpoint: this.outpoint, sig: null }
    }
}

class Output {
    value: number
    pubKey: PubKey

    static fromObject(output_object: OutputObject) {
        return new Output(output_object.value, output_object.pubkey)
    }

    constructor(value: number, pubKey: string) {
        this.value = value
        this.pubKey = pubKey
    }
}

export class Transaction {
    inputs: Input[]
    outputs: Output[]
    height: number | null

    static fromObject(transaction_object: any) {
        return new Transaction(
            transaction_object.inputs?.map(Input.fromObject),
            transaction_object.outputs.map(Output.fromObject),
            transaction_object.height ?? null
        )
    }

    constructor(inputs: Input[], outputs: Output[], height: number | null) {
        this.inputs = inputs
        this.outputs = outputs
        this.height = height
    }

    isCoinbase() {
        return this.height !== null
    }

    async validate() {
        if (this.isCoinbase()) {
            return true
        }

        this.inputs.forEach(input => input.outpoint.validate())

        const outputsOfOutpoints = await Promise.all(
            this.inputs.map(async (input) => await input.outpoint.getOutput())
        )

        const signedTransaction = this.objectToSignable()
        const signedTransactionString = canonicalize(signedTransaction)
        if (signedTransactionString === undefined) {
            console.error('Error in canonicalizing signed transaction')
            return false
        }

        for (let i = 0; i < outputsOfOutpoints.length; i++) {
            const output = outputsOfOutpoints[i];
            const input = this.inputs[i];
            if (output && input && !verify(output.pubkey, input.sig, signedTransactionString)) {
                const error = new Error(`Signature verification failed for input ${input.outpoint.txid}:${input.outpoint.index}`)
                error.name = 'INVALID_TX_SIGNATURE'
                throw error
            }
        }

        const outpointValues = await Promise.all(
            outputsOfOutpoints.map((output) => output?.value ?? 0)
        )
        const totalInputValue = outpointValues.reduce(
            (acc, value) => acc + value, 0
        )
        const totalOutputValue = this.outputs.reduce(
            (acc, output) => acc + output.value, 0
        )

        if (totalInputValue < totalOutputValue) {
            const error = new Error(`Transaction does not satisfy conservation law`)
            error.name = 'INVALID_TX_CONSERVATION'
            throw error
        }

        return true
    }

    objectToSignable() {
        return { inputs: this.inputs.map(input => input.objectToSignable()), outputs: this.outputs }
    }
}
