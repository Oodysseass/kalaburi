import forge from 'node-forge'
import canonicalize from 'canonicalize'
import { hash, TARGET, BLOCK_REWARD } from '../../src/utils'
import { FakeSocket, waitForWrite } from './fakesocket'
import { PeerManager } from '../../src/peermanager'
import { InMemoryDB } from './fakedb'
import { _setObjectManagerForTests, ObjectManager } from '../../src/object'
import { mempoolManager } from '../../src/mempool'
import { chainManager } from '../../src/chain'
import type { Hash, NetworkObject } from '../../src/types'

export const asHex = (bytes: Uint8Array | Buffer | string): string => {
    if (typeof bytes === 'string') {
        return forge.util.bytesToHex(bytes);
    }
    return forge.util.bytesToHex(String.fromCharCode(...Array.from(bytes)));
}

export function genKeypair() {
    const kp = forge.pki.ed25519.generateKeyPair();
    const pubHex = asHex(kp.publicKey);
    const privHex = asHex(kp.privateKey);
    return { pubHex, privHex }
}

export function signMessageHex(privHex: string, message: string) {
    const sigBytes = forge.pki.ed25519.sign({
        message,
        encoding: 'utf8',
        privateKey: forge.util.hexToBytes(privHex),
    })
    return asHex(sigBytes)
}

export function id(obj: any) {
    return hash(canonicalize(obj))
}

export function buildCoinbase(height: number, pubkey: string, value = BLOCK_REWARD) {
    return {
        height,
        outputs: [{ pubkey, value }],
        type: 'transaction',
    }
}

export function buildBlock({
    previd,
    created,
    nonce,
    txids,
    note,
}: {
    previd: string | null
    created: number
    nonce: string
    txids: string[]
    note?: string
}) {
    return {
        T: TARGET,
        created,
        nonce,
        txids,
        type: 'block' as const,
        previd,
        ...(note ? { note } : {})
    }
}

export function handshake(pm: PeerManager, s: FakeSocket): void {
    pm.addPeer(s.asNetSocket())
    s.feedJSON({ type: 'hello', version: '0.10.0', agent: 'grader' })
    s.clearWritten()
}

export async function sendAndAckObject(s: FakeSocket, obj: any) {
    s.feedJSON({ type: 'object', object: obj })
    await waitForWrite(s, m => m?.type === 'ihaveobject')
}

export async function sendTxAndGetError(
    s: FakeSocket,
    obj: any
): Promise<string | undefined> {
    s.feedJSON({ type: 'object', object: obj })
    const err = await waitForWrite(s, m => m?.type === 'error')
    return err?.error
}

export async function setupTestEnv() {
    const db = new InMemoryDB<Hash, NetworkObject>()
    const om = new ObjectManager(db)
    _setObjectManagerForTests(om)
    await mempoolManager.init()
    await chainManager.init()
    return { db, om }
}

