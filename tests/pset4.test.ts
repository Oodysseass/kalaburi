import { PeerManager } from '../src/peermanager'
import canonicalize from 'canonicalize'
import { FakeSocket, iterWrittenJSON, waitForWrite } from './helpers/fakesocket'
import { InMemoryDB } from './helpers/fakedb'
import type { NetworkObject, Hash } from '../src/types'
import { _setObjectManagerForTests, ObjectManager } from '../src/object'
import {
    TARGET,
    GENESIS_BLOCK,
    GENESIS_BLOCK_ID,
    BLOCK_REWARD,
    hash,
    _setTargetForTests
} from '../src/utils'

let pm: any
let s1: FakeSocket
let s2: FakeSocket

beforeEach(() => {
    pm = new PeerManager()
    const db = new InMemoryDB<Hash, NetworkObject>()
    const om = new ObjectManager(db)
    _setObjectManagerForTests(om)

    s1 = new FakeSocket('A')
    s2 = new FakeSocket('B')

    handshake(s1)
    handshake(s2)

    jest.spyOn(console, 'error').mockImplementation(() => {})
    s1.clearWritten()
    s2.clearWritten()
})

afterEach(() => {
    jest.clearAllMocks()
})

const handshake = (s: FakeSocket = new FakeSocket('X')): void => {
    pm.addPeer(s.asNetSocket())
    s.feedJSON({ type: 'hello', version: '0.10.0', agent: 'grader' })
    s.clearWritten()
}

describe('1) invalid blockchains', () => {
    jest.setTimeout(10000)

    it('a) points to an unavailable block -> UNFINDABLE_OBJECT, no ihaveobject on other peer', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

        const unavailableParent = hash(canonicalize({ missing: 'parent' }))
        const block = {
            T: TARGET,
            created: 1671062401,
            nonce: '23',
            txids: [],
            type: 'block',
            previd: unavailableParent,
        }

        s1.feedJSON({ type: 'object', object: block })

        const error = await waitForWrite(s1, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.error).toBe('UNFINDABLE_OBJECT')

        const msgsB = iterWrittenJSON(s2)
        const gossiped = msgsB.find(m => m?.type === 'ihaveobject' && m.objectid === hash(canonicalize(block)))
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
            created: 1671062401,
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
            created: 1671062401,
            nonce: '24',
            txids: [],
            type: 'block',
            previd: hash(canonicalize(block1)),
        }
        s1.feedJSON({ type: 'object', object: block2 })

        const error = await waitForWrite(s1, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.error).toBe('INVALID_BLOCK_TIMESTAMP')

        const msgsB = iterWrittenJSON(s2)
        const gossiped = msgsB.find(m => m?.type === 'ihaveobject' && m.objectid === hash(canonicalize(block2)))
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
        expect(error?.error).toBe('INVALID_BLOCK_TIMESTAMP')

        const msgsB = iterWrittenJSON(s2)
        const gossiped = msgsB.find(m => m?.type === 'ihaveobject' && m.objectid === hash(canonicalize(futureBlock)))
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
            created: 1671062402,
            nonce: '23',
            txids: [],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }
        s1.feedJSON({ type: 'object', object: badPow })

        const error = await waitForWrite(s1, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.error).toBe('INVALID_BLOCK_POW')

        const msgsB = iterWrittenJSON(s2)
        const gossiped = msgsB.find(m => m?.type === 'ihaveobject' && m.objectid === hash(canonicalize(badPow)))
        expect(gossiped).toBeUndefined()
    })

    it('e) fake genesis (null previd but not the real genesis) -> INVALID_GENESIS, no ihaveobject on other peer', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

        const fakeGenesis = {
            T: TARGET,
            created: 1671062400,
            nonce: '00',
            txids: [],
            type: 'block',
            previd: null,
        }
        s1.feedJSON({ type: 'object', object: fakeGenesis })

        const error = await waitForWrite(s1, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.error).toBe('INVALID_GENESIS')

        const msgsB = iterWrittenJSON(s2)
        const gossiped = msgsB.find(m => m?.type === 'ihaveobject' && m.objectid === hash(canonicalize(fakeGenesis)))
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
                pubkey: "3EFFB752170316F5D15D04504190FCF0C8FF75956C68AFB2A9B5BA7801AB128C",
                value: BLOCK_REWARD
            }],
            type: "transaction"
        }
        s1.feedJSON({ type: 'object', object: coinbase })
        await waitForWrite(s1, m => m?.type === 'ihaveobject')
        s1.clearWritten()
        s2.clearWritten()

        const block = {
            T: TARGET,
            created: 1671062401,
            nonce: '29',
            txids: [hash(canonicalize(coinbase))],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }
        s1.feedJSON({ type: 'object', object: block })

        const error = await waitForWrite(s1, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.error).toBe('INVALID_BLOCK_COINBASE')

        const msgsB = iterWrittenJSON(s2)
        const gossiped = msgsB.find(m => m?.type === 'ihaveobject' && m.objectid === hash(canonicalize(block)))
        expect(gossiped).toBeUndefined()
    })
})

describe('2) chaintip reports the longest valid chain', () => {
    it('returns the tip of the longest chain after multiple valid chains are sent', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

        s1.feedJSON({ type: 'object', object: GENESIS_BLOCK })
        await waitForWrite(s1, m => m?.type === 'ihaveobject')
        s1.clearWritten()
        s2.clearWritten()

        const blockA1 = {
            T: TARGET,
            created: 1671062401,
            nonce: 'a1',
            txids: [],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }
        const blockA2 = {
            T: TARGET,
            created: 1671062402,
            nonce: 'a2',
            txids: [],
            type: 'block',
            previd: hash(canonicalize(blockA1)),
        }

        const blockB1 = {
            T: TARGET,
            created: 1671062403,
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
        expect(chaintip.blockid).toBe(hash(canonicalize(blockA2)))
    })
})

describe('3) accepts chain of blocks', () => {
    it('sends tip first and pauses between blocks', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

        s1.feedJSON({ type: 'object', object: GENESIS_BLOCK })
        await waitForWrite(s1, m => m?.type === 'ihaveobject')
        s1.clearWritten()

        const block1 = {
            T: TARGET,
            created: 1671062401,
            nonce: '23',
            txids: [],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }

        const block2 = {
            T: TARGET,
            created: 1671062402,
            nonce: '23',
            txids: [],
            type: 'block',
            previd: hash(canonicalize(block1)),
        }

        const block3 = {
            T: TARGET,
            created: 1671062403,
            nonce: '23',
            txids: [],
            type: 'block',
            previd: hash(canonicalize(block2)),
        }

        const block4 = {
            T: TARGET,
            created: 1671062404,
            nonce: '23',
            txids: [],
            type: 'block',
            previd: hash(canonicalize(block3)),
        }

        const block5 = {
            T: TARGET,
            created: 1671062405,
            nonce: '23',
            txids: [],
            type: 'block',
            previd: hash(canonicalize(block4)),
        }

        const block6 = {
            T: TARGET,
            created: 1671062406,
            nonce: '23',
            txids: [],
            type: 'block',
            previd: hash(canonicalize(block5)),
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

        const ihaveobject = await waitForWrite(s1, m => m?.type === 'ihaveobject' && m.objectid === hash(canonicalize(block6)))
        expect(ihaveobject).toBeDefined()
        expect(ihaveobject.objectid).toBe(hash(canonicalize(block6)))
    })
})


