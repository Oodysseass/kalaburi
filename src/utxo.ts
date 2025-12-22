import { Output, Transaction } from "./transaction"

export default class UTXOSet {
    utxos: Map<string, Output>

    constructor(utxos: Map<string, Output>) {
        this.utxos = new Map(utxos)
    }

    apply(tx: Transaction) {
        tx.inputs.forEach(input => {
            const outpointString = input.outpoint.toString()
            if (!this.utxos.has(outpointString)) {
                const error = new Error(`Input outpoint ${outpointString} not found in UTXO set`)
                error.name = 'INVALID_TX_OUTPOINT'
                throw error
            }
        })

        tx.inputs.forEach(input => {
            const outpointString = input.outpoint.toString()
            this.utxos.delete(outpointString)
        })

        const prefix = tx.id
        tx.outputs.forEach((output, idx) => {
            this.utxos.set(`${prefix}:${idx}`, output)
        })
    }
}
