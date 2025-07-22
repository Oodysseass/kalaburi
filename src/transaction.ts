import canonicalize from 'canonicalize'
import { objectManager } from './object'
import { verify } from './utils'

class Outpoint {
    txid: string
    index: number

    constructor(txid: string, index: number) {
        this.txid = txid
        this.index = index
    }

    async validate() {
        if (!await objectManager.exists(this.txid)) {
            console.error(`Outpoint ${this.txid}:${this.index} does not exist`)
            return false
        }

        const tx = await objectManager.get(this.txid)

        if (tx.outputs.length <= this.index) {
            console.error(`Reference output ${this.txid}:${this.index} does not exist`)
            return false
        }

        return true
    }

    async getPublicKey() {
        const tx = await objectManager.get(this.txid)
        return tx.outputs[this.index].publicKey
    }

    async getValue() {
        const tx = await objectManager.get(this.txid)
        return tx.outputs[this.index].value
    }
}

class Output {
    value: number
    publicKey: string

    constructor(value: number, publicKey: string) {
        this.value = value
        this.publicKey = publicKey
    }

    validate() {
        if (this.value <= 0) {
            console.error(`Output value must be greater than 0`)
            return false
        }

        if (!/^[0-9a-fA-F]{64}$/.test(this.publicKey)) {
            console.error(`Output public key must be 64 characters long`)
            return false
        }

        return true
    }
}

class Input {
    outpoint: Outpoint
    sig: string

    constructor(outpoint: Outpoint, sig: string) {
        this.outpoint = outpoint
        this.sig = sig
    }

    async validate() {
        if (!this.outpoint.validate()) {
            console.error(`Input outpoint validation failed`)
            return false
        }

        const publicKey = await this.outpoint.getPublicKey()
        if (!verify(publicKey, this.sig, this.outpoint.txid)) {
            console.error(`Signature verification failed`)
            return false
        }
        return true
    }

    objectToSignable() {
        return { outpoint: this.outpoint, sig: null }
    }
}

export class Transaction {
    inputs: Input[] = []
    outputs: Output[] = []
    height: number | null = null

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

        this.inputs.forEach(input => input.validate())

        const signedTransaction = this.objectToSignable()
        const signedTransactionString = canonicalize(signedTransaction) ?? ''
        for (const input of this.inputs) {
            const publicKey = await input.outpoint.getPublicKey()
            if(!verify(publicKey, input.sig, signedTransactionString)) {
                console.error(`Signature verification failed for input ${input.outpoint.txid}:${input.outpoint.index}`)
                return false
            }
        }

        const outpointValues = await Promise.all(this.inputs.map(async (input) => await input.outpoint.getValue()))
        const totalInputValue = outpointValues.reduce((acc, value) => acc + value, 0)
        const totalOutputValue = this.outputs.reduce((acc, output) => acc + output.value, 0)

        if (totalInputValue < totalOutputValue) {
            console.error(`Transaction does not satisfy conservation law`)
            return false
        }

        return true
    }

    objectToSignable() {
        return { inputs: this.inputs.map(input => input.objectToSignable()), outputs: this.outputs }
    }
}
