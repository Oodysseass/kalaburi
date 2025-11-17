import { PeerManager } from '../src/peermanager'
import { FakeSocket, iterWrittenJSON, findFirst, waitForWrite } from './helpers/fakesocket'
import { InMemoryDB } from './helpers/fakedb'
import { hash } from '../src/utils'
import canonicalize from 'canonicalize'
import type { NetworkObject, Hash } from '../src/types'
import { _setObjectManagerForTests, ObjectManager } from '../src/object'

let pm: any
beforeEach(() => {
    pm = new PeerManager()
    const db = new InMemoryDB<Hash, NetworkObject>()
    const om = new ObjectManager(db)
    _setObjectManagerForTests(om)
    jest.spyOn(console, 'error').mockImplementation(() => { })
})
afterEach(() => {
    jest.clearAllMocks()
})

describe('1) object exchange', () => {
    it('requests object and sends it back on getobject', async () => {
        const s = new FakeSocket('A')
        pm.addPeer(s.asNetSocket())
        const object = {
            height: 0,
            outputs: [{
                pubkey: '958f8add086cc348e229a3b6590c71b7d7754e42134a127a50648bf07969d9a0',
                value: 50000000000
            }],
            type: 'transaction'
        }

        s.feedJSON({ type: 'hello', version: '0.10.0', agent: 'grader' })
        s.feedJSON({ type: 'ihaveobject', objectid: hash(canonicalize(object)) })
        const getobject = await waitForWrite(s, m => m?.type === 'getobject')
        expect(getobject).toBeDefined()

        s.feedJSON({ type: 'object', object })
        await waitForWrite(s, m => m?.type === 'ihaveobject')

        const msgsAfterIngest = iterWrittenJSON(s)
        const ih = findFirst(msgsAfterIngest, m => m?.type === 'ihaveobject' && typeof m.objectid === 'string')
        expect(ih).toBeDefined()
        const oid = ih!.objectid

        s.feedJSON({ type: 'getobject', objectid: oid })

        const objectMsg = await waitForWrite(s, m => m?.type === 'object' && m.object)
        expect(objectMsg).toBeDefined()

        const roundTripId = hash(canonicalize(objectMsg.object))
        expect(roundTripId).toBe(oid)

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

        pm.addPeer(s1.asNetSocket())
        s1.feedJSON({ type: 'hello', version: '0.10.0', agent: 'grader1' })
        pm.addPeer(s2.asNetSocket())
        s2.feedJSON({ type: 'hello', version: '0.10.0', agent: 'grader2' })

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

async function sendPrevTx(s: FakeSocket = new FakeSocket('A')): Promise<void> {
    const prevTx = {
        height: 0,
        outputs: [{
            pubkey: "958f8add086cc348e229a3b6590c71b7d7754e42134a127a50648bf07969d9a0",
            value: 50000000000
        }],
        type: "transaction"
    }
    s.feedJSON({ type: 'hello', version: '0.10.0', agent: 'grader' })
    s.clearWritten()
    s.feedJSON({ type: 'object', object: prevTx })
    await waitForWrite(s, m => m?.type === 'ihaveobject')
}

async function sendTxAndGetError(
    obj: any,
    s: FakeSocket = new FakeSocket('A')
): Promise<string | undefined> {
    s.feedJSON({ type: 'hello', version: '0.10.0', agent: 'grader' })
    s.clearWritten()
    s.feedJSON({ type: 'object', object: obj })
    const err = await waitForWrite(s, m => m?.type === 'error')
    return err?.error
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

        const errorCode = await sendTxAndGetError(invalidTx, s)
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

        const errorCode = await sendTxAndGetError(invalidSigTx, s)
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

        const errorCode = await sendTxAndGetError(invalidOutIndexTx, s)
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
        s.feedJSON({ type: 'hello', version: '0.10.0', agent: 'grader' })
        s.clearWritten()
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

        const errorCode = await sendTxAndGetError(invalidConservationTx, s)
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

        const errorCode = await sendTxAndGetError(invalidFormatTx, s)
        expect(errorCode).toBe('INVALID_FORMAT')
    })
})

describe('4) transaction gossip', () => {
   it('accepts valid transaction and gossips it', async () => {
       const s1 = new FakeSocket('A')
       const s2 = new FakeSocket('B')
       pm.addPeer(s1.asNetSocket())
       pm.addPeer(s2.asNetSocket())
       s1.feedJSON({ type: 'hello', version: '0.10.0', agent: 'grader1' })
       s2.feedJSON({ type: 'hello', version: '0.10.0', agent: 'grader2' })

       const tx = {
           height: 0,
           outputs: [{
               pubkey: "958f8add086cc348e229a3b6590c71b7d7754e42134a127a50648bf07969d9a0",
               value: 50000000000
           }],
           type: "transaction"
       }
       s1.feedJSON({ type: 'object', object: tx })

       const gossip = await waitForWrite(s2, msg => msg.type === 'ihaveobject')
       expect(gossip).toBeDefined()
       expect(gossip.objectid).toBe(hash(canonicalize(tx)))
       s2.feedJSON({ type: 'getobject', objectid: gossip.objectid })
       const receivedObject = await waitForWrite(s2, msg => msg.type === 'object')
       expect(receivedObject).toBeDefined()
       expect(receivedObject.object).toEqual(tx)

       const tx2 = {
           inputs: [{
               outpoint: {
                   index: 0,
                   txid: "b303d841891f91af118a319f99f5984def51091166ac73c062c98f86ea7371ee"
               },
               sig: "060bf7cbe141fecfebf6dafbd6ebbcff25f82e729a7770f4f3b1f81a7ec8a0ce4b287597e609b822111bbe1a83d682ef14f018f8a9143cef25ecc9a8b0c1c405"
           }],
           outputs: [{
               pubkey: "958f8add086cc348e229a3b6590c71b7d7754e42134a127a50648bf07969d9a0",
               value: 10
           }],
           type: "transaction"
       }

       s2.clearWritten()
       s1.feedJSON({ type: 'object', object: tx2 })
       const gossip2 = await waitForWrite(s2, msg => msg.type === 'ihaveobject')
       expect(gossip2).toBeDefined()
       expect(gossip2.objectid).toBe(hash(canonicalize(tx2)))
       s2.feedJSON({ type: 'getobject', objectid: gossip2.objectid })
       const receivedObject2 = await waitForWrite(s2, msg => msg.type === 'object')
       expect(receivedObject2).toBeDefined()
       expect(receivedObject2.object).toEqual(tx2)
   })
})
