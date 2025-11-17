import { objectManager } from "./object"
import { Output, Transaction } from "./transaction"

export default class UTXOSet {
    utxos: Map<string, Output>

    constructor(utxos: Map<string, Output>) {
        this.utxos = utxos
    }

    apply(tx: Transaction) {
        for (const input of tx.inputs) {
            const outpointString = input.outpoint.toString()
            if (!this.utxos.has(outpointString)) {
                const error = new Error(`Input outpoint ${outpointString} not found in UTXO set`)
                error.name = 'INVALID_TX_OUTPOINT'
                throw error
            }

            this.utxos.delete(outpointString)
        }

        const prefix = objectManager.id(tx.toObject())
        tx.outputs.forEach((output, idx) => {
            this.utxos.set(`${prefix}:${idx}`, output)
        })
    }
}
