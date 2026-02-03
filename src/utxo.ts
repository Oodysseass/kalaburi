import { Output, Transaction } from "./transaction"
import { ValidationError, ErrorName } from "./error"

export default class UTXOSet {
    utxos: Map<string, Output>

	constructor(
		utxos: Map<string, Output> | Record<string, Output> = new Map()
	) {
		if (utxos instanceof Map) {
			this.utxos = new Map(utxos)
		} else {
			this.utxos = new Map(Object.entries(utxos))
		}
	}

	toJSON() {
		return { utxos: Object.fromEntries(this.utxos) }
	}

    apply(tx: Transaction) {
        tx.inputs.forEach(input => {
            const outpointString = input.outpoint.toString()
            if (!this.utxos.has(outpointString)) {
                throw new ValidationError(ErrorName.INVALID_TX_OUTPOINT, `Input outpoint ${outpointString} not found in the UTXO set`)
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
