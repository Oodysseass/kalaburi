import forge from 'node-forge'
import canonicalize from 'canonicalize'
import { Transaction } from './transaction'
import { mempoolManager } from './mempool'
import { objectManager } from './object'
import { peerManager } from './peermanager'
import { Logger, shortId } from './logger'
import type { TransactionObject } from './types'

const log = new Logger('selfpayer')

const INTERVAL_MS = 2 * 60 * 1000
const STARTUP_DELAY_MS = 30 * 1000

function signHex(privHex: string, message: string): string {
    const sigBytes = forge.pki.ed25519.sign({
        message,
        encoding: 'utf8',
        privateKey: forge.util.hexToBytes(privHex),
    })
    return forge.util.bytesToHex(String.fromCharCode(...Array.from(sigBytes)))
}

function pickSmallestOwnedUTXO(pk: string): { outpoint: string; value: number } | null {
    let best: { outpoint: string; value: number } | null = null
    for (const [outpoint, output] of mempoolManager.currentState.utxos) {
        if (output.pubkey !== pk) continue
        if (best === null || output.value < best.value) {
            best = { outpoint, value: output.value }
        }
    }
    return best
}

async function broadcastSelfPayment() {
    const pk = process.env.PK
    const sk = process.env.SK
    if (!pk || !sk) {
        log.warn('PK or SK not set, skipping self-payment')
        return
    }

    const picked = pickSmallestOwnedUTXO(pk)
    if (!picked) {
        log.info('No UTXOs owned by PK in current mempool state, skipping')
        return
    }

    const [txid, indexStr] = picked.outpoint.split(':')
    const index = Number(indexStr)

    const unsigned = {
        inputs: [{ outpoint: { txid: txid!, index }, sig: null }],
        outputs: [{ pubkey: pk, value: picked.value }],
        type: 'transaction',
    }
    const signable = canonicalize(unsigned)
    if (!signable) {
        log.error('Failed to canonicalize unsigned tx')
        return
    }
    const sig = signHex(sk, signable)

    const signed: TransactionObject = {
        type: 'transaction',
        inputs: [{ outpoint: { txid: txid!, index }, sig }],
        outputs: [{ pubkey: pk, value: picked.value }],
    }

    const tx = Transaction.fromNetwork(signed)
    try {
        await tx.validate()
    } catch (err: any) {
        log.error('Self-tx failed validation', err.message)
        return
    }
    await objectManager.add(tx, tx.id)
    mempoolManager.addTransaction(tx)
    peerManager.broadcast({ type: 'ihaveobject', objectid: tx.id })
    log.info(`Broadcasted self-payment tx ${shortId(tx.id)} spending ${picked.outpoint} (${picked.value})`)
}

export function startSelfPayer() {
    setTimeout(() => {
        broadcastSelfPayment().catch(err => log.error('Self-payment failed', err.message))
        setInterval(() => {
            broadcastSelfPayment().catch(err => log.error('Self-payment failed', err.message))
        }, INTERVAL_MS)
    }, STARTUP_DELAY_MS)
    log.info(`Scheduled self-payments every ${INTERVAL_MS / 1000}s (first run in ${STARTUP_DELAY_MS / 1000}s)`)
}
