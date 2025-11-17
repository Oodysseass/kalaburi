import canonicalize from 'canonicalize'
import { objectManager } from './object'
import { verify } from './utils'
import type { Hash } from './types'
import type {
    OutpointObject,
    InputObject,
    OutputObject,
    PubKey
} from './types'

class Outpoint {
    txid: Hash
    index: number

    static fromObject(outpoint_object: OutpointObject) {
        return new Outpoint(outpoint_object.txid, outpoint_object.index)
    }

    toObject() {
        return {
            txid: this.txid,
            index: this.index
        }
    }

    constructor(txid: string, index: number) {
        this.txid = txid
        this.index = index
    }

    async validate() {
        const txObject = await objectManager.get(this.txid)
        if (typeof txObject === 'undefined') {
            const error = new Error(`Transaction ${this.txid} does not exist`)
            error.name = 'UNKNOWN_OBJECT'
            throw error
        }
        const tx = Transaction.fromObject(txObject)

        if (tx.outputs.length <= this.index) {
            const error = new Error(`Output index ${this.index} for transaction ${this.txid} does not exist`)
            error.name = 'INVALID_TX_OUTPOINT'
            throw error
        }

        return true
    }

    async getOutput() {
        const tx = Transaction.fromObject(await objectManager.get(this.txid))
        return tx?.outputs[this.index]
    }

    toString() {
        return `${this.txid}:${this.index}`
    }
}

class Input {
    outpoint: Outpoint
    sig: string | null

    static fromObject(input_object: InputObject) {
        return new Input(Outpoint.fromObject(input_object.outpoint), input_object.sig)
    }

    toObject() {
        return {
            outpoint: this.outpoint.toObject(),
            sig: this.sig
        }
    }

    constructor(outpoint: Outpoint, sig: string | null) {
        this.outpoint = outpoint
        this.sig = sig
    }

    toSignable() {
        return { outpoint: this.outpoint, sig: null }
    }
}

export class Output {
    value: number
    pubkey: PubKey

    static fromObject(output_object: OutputObject) {
        return new Output(output_object.value, output_object.pubkey)
    }

    toObject() {
        return {
            value: this.value,
            pubkey: this.pubkey
        }
    }

    constructor(value: number, pubkey: PubKey) {
        this.value = value
        this.pubkey = pubkey
    }
}

export class Transaction {
    inputs: Input[]
    outputs: Output[]
    height: number | null
    type: string = 'transaction'

    static fromObject(transaction_object: any) {
        return new Transaction(
            transaction_object.inputs?.map(Input.fromObject) ?? [],
            transaction_object.outputs.map(Output.fromObject),
            transaction_object.height ?? null
        )
    }

    toObject() {
        return {
            outputs: this.outputs.map(output => output.toObject()),
            type: this.type,
            ...(this.inputs?.length > 0 && { inputs: this.inputs.map(input => input.toObject()) }),
            ...(this.height !== null && { height: this.height })
        }
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

        for (const input of this.inputs) {
            await input.outpoint.validate()
        }

        const outputsOfOutpoints = await Promise.all(
            this.inputs.map(async (input) => await input.outpoint.getOutput())
        )

        const signedTransactionString = this.toSignable()
        if (signedTransactionString === undefined) {
            console.error('Error in canonicalizing signed transaction')
            return false
        }

        for (let i = 0; i < outputsOfOutpoints.length; i++) {
            const output = outputsOfOutpoints[i]
            const input = this.inputs[i]
            if (!verify(output!.pubkey, input!.sig!, signedTransactionString)) {
                const error = new Error(`Signature verification failed for input ${input?.outpoint.txid}:${input?.outpoint.index}`)
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

    toSignable() {
        return canonicalize({
            inputs: this.inputs.map(input => input.toSignable()),
            outputs: this.outputs,
            type: this.type,
        })
    }
}
