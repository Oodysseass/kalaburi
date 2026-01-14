import { PeerManager } from '../src/peermanager'
import { chainManager } from '../src/chain'
import { FakeSocket, waitForWrite } from './helpers/fakesocket'
import { hash, GENESIS_BLOCK_ID, GENESIS_BLOCK, _setTargetForTests } from '../src/utils'
import canonicalize from 'canonicalize'
import { _setObjectManagerForTests } from '../src/object'
import {
    setupTestEnv,
    handshake,
    id,
    genKeypair,
    signMessageHex,
    buildCoinbase,
    buildBlock,
    sendAndAckObject,
    sendTxAndGetError
} from './helpers/test-utils'

let pm: any
beforeEach(async () => {
    pm = new PeerManager()
    await setupTestEnv()
    jest.spyOn(console, 'error').mockImplementation(() => { })
})
afterEach(() => {
    jest.clearAllMocks()
})

describe('1) object exchange', () => {
    it('requests object and sends it back on getobject', async () => {
        const s = new FakeSocket('A')
        handshake(pm, s)
        const object = {
            height: 0,
            outputs: [{
                pubkey: '958f8add086cc348e229a3b6590c71b7d7754e42134a127a50648bf07969d9a0',
                value: 50000000000
            }],
            type: 'transaction'
        }

        s.feedJSON({ type: 'ihaveobject', objectid: hash(canonicalize(object)) })
        await waitForWrite(s, m => m?.type === 'getobject')

        s.feedJSON({ type: 'object', object })
        const ihaveobject = await waitForWrite(s, m => m?.type === 'ihaveobject')
        expect(ihaveobject).toBeDefined()

        s.clearWritten()
        s.feedJSON({ type: 'getobject', objectid: ihaveobject.objectid })

        const objectMsg = await waitForWrite(s, m => m?.type === 'object' && m.object)
        expect(objectMsg).toBeDefined()

        const roundTripId = hash(canonicalize(objectMsg.object))
        expect(roundTripId).toBe(ihaveobject.objectid)

        expect(objectMsg.object).toMatchObject({
            type: expect.any(String),
            outputs: expect.any(Array),
        })
    })
})

describe('2) object gossiping', () => {
    it('gossip ihaveobject and object on demand', async () => {
        const s1 = new FakeSocket('A')
        const s2 = new FakeSocket('B')

        handshake(pm, s1)
        handshake(pm, s2)

        const object = {
            height: 0,
            outputs: [{
                pubkey: '958f8add086cc348e229a3b6590c71b7d7754e42134a127a50648bf07969d9a0',
                value: 50000000000
            }],
            type: 'transaction'
        }
        s1.feedJSON({ type: 'object', object })

        const gossip = await waitForWrite(s2, msg => msg.type === 'ihaveobject')
        expect(gossip).toBeDefined()
        expect(gossip.objectid).toBe(hash(canonicalize(object)))

        s2.feedJSON({ type: 'getobject', objectid: gossip.objectid })
        const receivedObject = await waitForWrite(s2, msg => msg.type === 'object')
        expect(receivedObject).toBeDefined()
        expect(receivedObject.object).toEqual(object)
    });
})

async function sendPrevTx(s: FakeSocket): Promise<void> {
    const prevTx = {
        height: 0,
        outputs: [{
            pubkey: "958f8add086cc348e229a3b6590c71b7d7754e42134a127a50648bf07969d9a0",
            value: 50000000000
        }],
        type: "transaction"
    }
    handshake(pm, s)
    s.feedJSON({ type: 'object', object: prevTx })
    await waitForWrite(s, m => m?.type === 'ihaveobject')
}

describe('3) transaction validation', () => {
    it('rejects unknown outpoint with UNKNOWN_OBJECT', async () => {
        const s = new FakeSocket('A')
        pm.addPeer(s.asNetSocket())
        const invalidTx = {
            type: 'transaction',
            inputs: [{ outpoint: { txid: 'abcd', index: 0 }, sig: 'sig1' }],
            outputs: [{ pubkey: 'key1', value: 10 }]
        }

        handshake(pm, s)
        const errorCode = await sendTxAndGetError(s, invalidTx)
        expect(errorCode).toBe('UNKNOWN_OBJECT')
    })

    it('rejects invalid signature with INVALID_TX_SIGNATURE', async () => {
        const s = new FakeSocket('A')
        pm.addPeer(s.asNetSocket())
        await sendPrevTx(s)
        const invalidSigTx = {
            inputs: [{
                outpoint: {
                    index: 0,
                    txid: "b303d841891f91af118a319f99f5984def51091166ac73c062c98f86ea7371ee"
                },
                sig: "sig1"
            }],
            outputs: [{
                pubkey: "958f8add086cc348e229a3b6590c71b7d7754e42134a127a50648bf07969d9a0",
                value: 10
            }],
            type: "transaction"
        }

        const errorCode = await sendTxAndGetError(s, invalidSigTx)
        expect(errorCode).toBe('INVALID_TX_SIGNATURE')
    })

    it('rejects invalid output index with INVALID_TX_OUTPOINT', async () => {
        const s = new FakeSocket('A')
        pm.addPeer(s.asNetSocket())
        await sendPrevTx(s)
        const invalidOutIndexTx = {
            inputs: [{
                outpoint: {
                    index: 2,
                    txid: "b303d841891f91af118a319f99f5984def51091166ac73c062c98f86ea7371ee"
                },
                sig: "sig1"
            }],
            "outputs": [{
                pubkey: "958f8add086cc348e229a3b6590c71b7d7754e42134a127a50648bf07969d9a0",
                value: 10
            }],
            type: "transaction"
        }

        const errorCode = await sendTxAndGetError(s, invalidOutIndexTx)
        expect(errorCode).toBe('INVALID_TX_OUTPOINT')
    })

    it('rejects non-conserving transaction with INVALID_TX_CONSERVATION', async () => {
        const s = new FakeSocket('A')
        pm.addPeer(s.asNetSocket())
        const prevTx = {
            height: 0,
            outputs: [{
                pubkey: "1A7D167BFC6329E1258F4883A45B4FDCD436604ADE528F9B72BCE3292A42B494",
                value: 10
            }],
            type: "transaction"
        }
        handshake(pm, s)
        s.feedJSON({ type: 'object', object: prevTx })
        await waitForWrite(s, m => m?.type === 'ihaveobject')

        const txid = hash(canonicalize(prevTx))
        const invalidConservationTx = {
            inputs: [{
                outpoint: {
                    index:0,
                    txid
                },
                sig: "ECFA4C45A474D5EE9EBFC28BEF224996263C7E147400BD64035774578D176B59FF2342B2F9BCA8CFA753991EF9F2EE92FD79B152EF99C6DEC42A68C4B90B7808"
            }],
            outputs: [{
                pubkey: "1A7D167BFC6329E1258F4883A45B4FDCD436604ADE528F9B72BCE3292A42B494",
                value: 100
            }],
            type: "transaction"
        }

        const errorCode = await sendTxAndGetError(s, invalidConservationTx)
        expect(errorCode).toBe('INVALID_TX_CONSERVATION')
    })

    it('rejects structurally invalid object with INVALID_FORMAT', async () => {
        const s = new FakeSocket('A')
        pm.addPeer(s.asNetSocket())
        const invalidFormatTx = {
            type: 'transaction',
            inputs: 'not-an-array',
            outputs: []
        }

        handshake(pm, s)
        const errorCode = await sendTxAndGetError(s, invalidFormatTx)
        expect(errorCode).toBe('INVALID_FORMAT')
    })
})

describe('4) transaction gossip', () => {
    it('accepts valid transaction and gossips it', async () => {
        const s1 = new FakeSocket('A')
        const s2 = new FakeSocket('B')
        handshake(pm, s1)
        handshake(pm, s2)

        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
        chainManager.longestChain = []
        await sendAndAckObject(s1, GENESIS_BLOCK)

        const kp = genKeypair()
        const cb = buildCoinbase(1, kp.pubHex)
        const block = buildBlock({
            previd: GENESIS_BLOCK_ID,
            created: Math.floor(Date.now() / 1000),
            nonce: '0',
            txids: [id(cb)]
        })

        await sendAndAckObject(s1, cb)
        s1.clearWritten()
        await sendAndAckObject(s1, block)
        s1.clearWritten()

        const tx2Outputs = [{ pubkey: kp.pubHex, value: 10 }]
        const tx2Signable = canonicalize({
            inputs: [{
                outpoint: { index: 0, txid: id(cb) },
                sig: null
            }],
            outputs: tx2Outputs,
            type: "transaction"
        })
        const sig = signMessageHex(kp.privHex, tx2Signable!)

        const tx2 = {
            inputs: [{
                outpoint: { index: 0, txid: id(cb) },
                sig: sig
            }],
            outputs: tx2Outputs,
            type: "transaction"
        }

        s2.clearWritten()
        s1.feedJSON({ type: 'object', object: tx2 })
        const gossip2 = await waitForWrite(s2, msg => msg.type === 'ihaveobject' && msg.objectid === id(tx2))
        expect(gossip2).toBeDefined()

        s2.feedJSON({ type: 'getobject', objectid: id(tx2) })
        const receivedObject2 = await waitForWrite(s2, msg => msg.type === 'object' && msg.object)
        expect(receivedObject2.object).toEqual(tx2)
    })
})
