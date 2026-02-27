import { PeerManager } from '../src/peermanager'
import { FakeSocket, iterWrittenJSON, waitForWrite } from './helpers/fakesocket'
import {
    TARGET,
    GENESIS_BLOCK,
    GENESIS_BLOCK_ID,
    _setTargetForTests
} from '../src/utils'
import { setupTestEnv, handshake, id } from './helpers/test-utils'
import { chainManager } from '../src/chain'

let pm: any
let s1: FakeSocket
let s2: FakeSocket

beforeEach(async () => {
    pm = new PeerManager()
    await setupTestEnv()

    s1 = new FakeSocket('A')
    s2 = new FakeSocket('B')

    handshake(pm, s1)
    handshake(pm, s2)

    jest.spyOn(console, 'error').mockImplementation(() => {})
    s1.clearWritten()
    s2.clearWritten()
})

afterEach(() => {
    jest.clearAllMocks()
})

describe('1) invalid blockchains', () => {
    jest.setTimeout(10000)

    it('a) points to an unavailable block -> UNFINDABLE_OBJECT, no ihaveobject on other peer', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

        const unavailableParent = id({ missing: 'parent' })
        const block = {
            T: TARGET,
            created: 1771159361,
            nonce: '23',
            txids: [],
            type: 'block',
            previd: unavailableParent,
        }

        s1.feedJSON({ type: 'object', object: block })

        const error = await waitForWrite(s1, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.name).toBe('UNFINDABLE_OBJECT')

        const msgsB = iterWrittenJSON(s2)
        const gossiped = msgsB.find(m => m?.type === 'ihaveobject' && m.objectid === id(block))
        expect(gossiped).toBeUndefined()
    })

   it('b) non-increasing timestamps -> INVALID_BLOCK_TIMESTAMP, no ihaveobject on other peer', async () => {
       _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

       s1.feedJSON({ type: 'object', object: GENESIS_BLOCK })
       await waitForWrite(s1, m => m?.type === 'ihaveobject')
       s1.clearWritten()
       s2.clearWritten()

       const block1 = {
           T: TARGET,
           created: 1771159361,
           nonce: '23',
           txids: [],
           type: 'block',
           previd: GENESIS_BLOCK_ID,
       }
       s1.feedJSON({ type: 'object', object: block1 })
       await waitForWrite(s1, m => m?.type === 'ihaveobject')
       s1.clearWritten()
       s2.clearWritten()

       const block2 = {
           T: TARGET,
           created: 1771159361,
           nonce: '24',
           txids: [],
           type: 'block',
           previd: id(block1),
       }
       s1.feedJSON({ type: 'object', object: block2 })

       const error = await waitForWrite(s1, m => m?.type === 'error')
       expect(error).toBeDefined()
       expect(error?.name).toBe('INVALID_BLOCK_TIMESTAMP')

       const msgsB = iterWrittenJSON(s2)
       const gossiped = msgsB.find(m => m?.type === 'ihaveobject' && m.objectid === id(block2))
       expect(gossiped).toBeUndefined()
   })

    it('c) block in the year 2077 (future) -> INVALID_BLOCK_TIMESTAMP, no ihaveobject on other peer', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

        s1.feedJSON({ type: 'object', object: GENESIS_BLOCK })
        await waitForWrite(s1, m => m?.type === 'ihaveobject')
        s1.clearWritten()
        s2.clearWritten()

        const futureBlock = {
            T: TARGET,
            created: 3400000000,
            nonce: '23',
            txids: [],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }
        s1.feedJSON({ type: 'object', object: futureBlock })

        const error = await waitForWrite(s1, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.name).toBe('INVALID_BLOCK_TIMESTAMP')

        const msgsB = iterWrittenJSON(s2)
        const gossiped = msgsB.find(m => m?.type === 'ihaveobject' && m.objectid === id(futureBlock))
        expect(gossiped).toBeUndefined()
    })

    it('d) invalid proof-of-work -> INVALID_BLOCK_POW, no ihaveobject on other peer', async () => {
        _setTargetForTests('00000000abc00000000000000000000000000000000000000000000000000000')

        s1.feedJSON({ type: 'object', object: GENESIS_BLOCK })
        await waitForWrite(s1, m => m?.type === 'ihaveobject')
        s1.clearWritten()
        s2.clearWritten()

        const badPow = {
            T: TARGET,
            created: 1771159362,
            nonce: '23',
            txids: [],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }
        s1.feedJSON({ type: 'object', object: badPow })

        const error = await waitForWrite(s1, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.name).toBe('INVALID_BLOCK_POW')

        await new Promise(resolve => setTimeout(resolve, 1000))
        const msgsB = iterWrittenJSON(s2)
        const gossiped = msgsB.find(m => m?.type === 'ihaveobject' && m.objectid === id(badPow))
        expect(gossiped).toBeUndefined()
    })

    it('e) fake genesis (null previd but not the real genesis) -> INVALID_GENESIS, no ihaveobject on other peer', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

        const fakeGenesis = {
            T: TARGET,
            created: 1771159360,
            nonce: '00',
            txids: [],
            type: 'block',
            previd: null,
        }
        s1.feedJSON({ type: 'object', object: fakeGenesis })

        const error = await waitForWrite(s1, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.name).toBe('INVALID_GENESIS')

        const msgsB = iterWrittenJSON(s2)
        const gossiped = msgsB.find(m => m?.type === 'ihaveobject' && m.objectid === id(fakeGenesis))
        expect(gossiped).toBeUndefined()
    })

    it('f) incorrect coinbase height -> INVALID_BLOCK_COINBASE, no ihaveobject on other peer', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

        s1.feedJSON({ type: 'object', object: GENESIS_BLOCK })
        await waitForWrite(s1, m => m?.type === 'ihaveobject')
        s1.clearWritten()
        s2.clearWritten()

        const coinbase = {
            height: 0,
            outputs: [{
                pubkey: "3effb752170316f5d15d04504190fcf0c8ff75956c68afb2a9b5ba7801ab128c",
                value: 50 * 10 ** 12 // BLOCK_REWARD
            }],
            type: "transaction"
        }
        s1.feedJSON({ type: 'object', object: coinbase })
        await waitForWrite(s1, m => m?.type === 'ihaveobject')
        s1.clearWritten()
        s2.clearWritten()

        const block = {
            T: TARGET,
            created: 1771159361,
            nonce: '29',
            txids: [id(coinbase)],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }
        s1.feedJSON({ type: 'object', object: block })

        const error = await waitForWrite(s1, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.name).toBe('INVALID_BLOCK_COINBASE')

        const msgsB = iterWrittenJSON(s2)
        const gossiped = msgsB.find(m => m?.type === 'ihaveobject' && m.objectid === id(block))
        expect(gossiped).toBeUndefined()
    })
})

describe('2) chaintip reports the longest valid chain', () => {
    it('returns the tip of the longest chain after multiple valid chains are sent', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
        chainManager.longestChain = []

        s1.feedJSON({ type: 'object', object: GENESIS_BLOCK })
        await waitForWrite(s1, m => m?.type === 'ihaveobject')
        s1.clearWritten()
        s2.clearWritten()

        const blockA1 = {
            T: TARGET,
            created: 1771159361,
            nonce: 'a1',
            txids: [],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }
        const blockA2 = {
            T: TARGET,
            created: 1771159362,
            nonce: 'a2',
            txids: [],
            type: 'block',
            previd: id(blockA1),
        }

        const blockB1 = {
            T: TARGET,
            created: 1771159363,
            nonce: 'b1',
            txids: [],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }

        s1.feedJSON({ type: 'object', object: blockB1 })
        await waitForWrite(s1, m => m?.type === 'ihaveobject')
        s1.clearWritten()

        s1.feedJSON({ type: 'object', object: blockA1 })
        await waitForWrite(s1, m => m?.type === 'ihaveobject')
        s1.clearWritten()

        s1.feedJSON({ type: 'object', object: blockA2 })
        await waitForWrite(s1, m => m?.type === 'ihaveobject')
        s1.clearWritten()

        s1.feedJSON({ type: 'getchaintip' })

        const chaintip = await waitForWrite(s1, m => m?.type === 'chaintip')
        expect(chaintip).toBeDefined()
        expect(chaintip.blockid).toBe(id(blockA2))
    })
})

describe('3) accepts chain of blocks', () => {
    it('sends tip first and pauses between blocks', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
        chainManager.longestChain = []

        s1.feedJSON({ type: 'object', object: GENESIS_BLOCK })
        await waitForWrite(s1, m => m?.type === 'ihaveobject')
        s1.clearWritten()

        const block1 = {
            T: TARGET,
            created: 1771159361,
            nonce: '23',
            txids: [],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }

        const block2 = {
            T: TARGET,
            created: 1771159362,
            nonce: '23',
            txids: [],
            type: 'block',
            previd: id(block1),
        }

        const block3 = {
            T: TARGET,
            created: 1771159363,
            nonce: '23',
            txids: [],
            type: 'block',
            previd: id(block2),
        }

        const block4 = {
            T: TARGET,
            created: 1771159364,
            nonce: '23',
            txids: [],
            type: 'block',
            previd: id(block3),
        }

        const block5 = {
            T: TARGET,
            created: 1771159365,
            nonce: '23',
            txids: [],
            type: 'block',
            previd: id(block4),
        }

        const block6 = {
            T: TARGET,
            created: 1771159366,
            nonce: '23',
            txids: [],
            type: 'block',
            previd: id(block5),
        }

        s1.feedJSON({ type: 'object', object: block6 })
        await waitForWrite(s1, m => m?.type === 'getobject')
        s1.clearWritten()
        await new Promise<void>(resolve => setTimeout(resolve, 200))

        s1.feedJSON({ type: 'object', object: block5 })
        await waitForWrite(s1, m => m?.type === 'getobject')
        s1.clearWritten()
        await new Promise<void>(resolve => setTimeout(resolve, 200))

        s1.feedJSON({ type: 'object', object: block4 })
        await waitForWrite(s1, m => m?.type === 'getobject')
        s1.clearWritten()
        await new Promise<void>(resolve => setTimeout(resolve, 200))

        s1.feedJSON({ type: 'object', object: block3 })
        await waitForWrite(s1, m => m?.type === 'getobject')
        s1.clearWritten()
        await new Promise<void>(resolve => setTimeout(resolve, 200))

        s1.feedJSON({ type: 'object', object: block2 })
        await waitForWrite(s1, m => m?.type === 'getobject')
        s1.clearWritten()
        await new Promise<void>(resolve => setTimeout(resolve, 200))

        s1.feedJSON({ type: 'object', object: block1 })

        const ihaveobject = await waitForWrite(s1, m => m?.type === 'ihaveobject' && m.objectid === id(block6))
        expect(ihaveobject).toBeDefined()
        expect(ihaveobject.objectid).toBe(id(block6))
    })
})
