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
let s: FakeSocket
beforeEach(() => {
    pm = new PeerManager()
    const db = new InMemoryDB<Hash, NetworkObject>()
    const om = new ObjectManager(db)
    _setObjectManagerForTests(om)
    s = new FakeSocket('A')
    handshake(s)
    jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
    jest.clearAllMocks()
})

const handshake = (s: FakeSocket = new FakeSocket('A')): void => {
    pm.addPeer(s.asNetSocket())
    s.feedJSON({ type: 'hello', version: '0.10.0', agent: 'grader' })
    s.clearWritten()
}

describe('1) block validation', () => {
    it('reject incorrect target', async () => {
        s.feedJSON({ type: 'object', object: GENESIS_BLOCK })
        await waitForWrite(s, m => m?.type === 'ihaveobject')
        const block = {
            T: '0000000a0bc00000000000000000000000000000000000000000000000000000',
            created: 1671062401,
            nonce: '26',
            txids: [],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }
        s.feedJSON({ type: 'object', object: block })
        const error = await waitForWrite(s, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.error).toBe('INVALID_FORMAT')
    })

    it('rejects invalid pow', async () => {
        _setTargetForTests('00000000abc0000000000000000000000000000000000000000000000000000')
        s.feedJSON({ type: 'object', object: GENESIS_BLOCK })
        await waitForWrite(s, m => m?.type === 'ihaveobject')
        const block = {
            T: TARGET,
            created: 1671062402,
            nonce: '23',
            txids: [],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }
        s.feedJSON({ type: 'object', object: block })
        const error = await waitForWrite(s, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.error).toBe('INVALID_BLOCK_POW')
    })

    it('rejects block with unfindable transaction', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

        s.feedJSON({ type: 'object', object: GENESIS_BLOCK })
        await waitForWrite(s, m => m?.type === 'ihaveobject')

        const tx = {
            height: 1,
            outputs: [{
                pubkey: "958f8add086cc348e229a3b6590c71b7d7754e42134a127a50648bf07969d9a0",
                value: BLOCK_REWARD
            }],
            type: "transaction"
        }
        const block = {
            T: TARGET,
            created: 1671062401,
            nonce: '29',
            txids: [hash(canonicalize(tx))],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }
        s.feedJSON({ type: 'object', object: block })
        const error = await waitForWrite(s, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.error).toBe('UNFINDABLE_OBJECT')

        s.clearWritten()

        s.feedJSON({ type: 'object', object: tx })
        await waitForWrite(s, m => m?.type === 'ihaveobject')
        s.clearWritten()

        s.feedJSON({ type: 'object', object: block })
        const ihaveobject = await waitForWrite(s, m => m?.type === 'ihaveobject')
        expect(ihaveobject).toBeDefined()
        expect(ihaveobject.objectid).toBe(hash(canonicalize(block)))
    })

    it('rejects double spending transactions in the same block', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
        s.feedJSON({ type: 'object', object: GENESIS_BLOCK })
        await waitForWrite(s, m => m?.type === 'ihaveobject')
        s.clearWritten()
        const coinbase = {
            height: 1,
            outputs: [{
                pubkey: "5069D943C81EF35D07C26C10D05D6CD18815C5C7D16F30642704C4DA24AA4375",
                value: BLOCK_REWARD
            }],
            type: "transaction"
        }
        s.feedJSON({ type: 'object', object: coinbase })
        await waitForWrite(s, m => m?.type === 'ihaveobject')
        s.clearWritten()
        const block = {
            T: TARGET,
            created: 1671062401,
            nonce: '29',
            txids: [hash(canonicalize(coinbase))],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }
        s.feedJSON({ type: 'object', object: block })
        await waitForWrite(s, m => m?.type === 'ihaveobject')
        s.clearWritten()

        const tx1 = {
            inputs: [{
                outpoint: {
                    index: 0,
                    txid: hash(canonicalize(coinbase))
                },
                sig: "57D26AD7D4921B671B6D1F6655F8577C034893C3AFD70286CD1E6C195A90920EE5D15FC93FC5ECCC4C5B9A108F038623E4A305695535DFE557EA0877CC62D406" 
            }],
            outputs: [{
                pubkey: "3EFFB752170316F5D15D04504190FCF0C8FF75956C68AFB2A9B5BA7801AB128C",
                value: 10
            }],
            type: "transaction"
        }
        const tx2 = {
            inputs: [{
                outpoint: {
                    index: 0,
                    txid: hash(canonicalize(coinbase))
                },
                sig: "43D8980D80FB791902680E5D55B8568B8C9E6720F26E8C6891BD09261FCEF6240208E0316217ED0F88EE7AEC52F166927F3972E1EFF529E8BF24D969E3666C03"
            }],
            outputs: [{
                pubkey: "pubkey2",
                value: 10
            }],
            type: "transaction"
        }

        s.feedJSON({ type: 'object', object: tx1 })
        await waitForWrite(s, m => m?.type === 'ihaveobject')
        s.clearWritten()
        s.feedJSON({ type: 'object', object: tx2 })
        await waitForWrite(s, m => m?.type === 'ihaveobject')
        s.clearWritten()

        const block2 = {
            T: TARGET,
            created: 1671062402,
            nonce: '30',
            txids: [hash(canonicalize(tx1)), hash(canonicalize(tx2))],
            type: 'block',
            previd: hash(canonicalize(block)),
        }
        s.feedJSON({ type: 'object', object: block2 })
        const error = await waitForWrite(s, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.error).toBe('INVALID_TX_OUTPOINT')
    })

    it('rejects double spending transactions in different blocks', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
        s.feedJSON({ type: 'object', object: GENESIS_BLOCK })
        await waitForWrite(s, m => m?.type === 'ihaveobject')
        s.clearWritten()
        const coinbase = {
            height: 1,
            outputs: [{
                pubkey: "5069D943C81EF35D07C26C10D05D6CD18815C5C7D16F30642704C4DA24AA4375",
                value: BLOCK_REWARD
            }],
            type: "transaction"
        }
        s.feedJSON({ type: 'object', object: coinbase })
        await waitForWrite(s, m => m?.type === 'ihaveobject')
        s.clearWritten()
        const block = {
            T: TARGET,
            created: 1671062405,
            nonce: '29',
            txids: [hash(canonicalize(coinbase))],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }
        s.feedJSON({ type: 'object', object: block })
        await waitForWrite(s, m => m?.type === 'ihaveobject')
        s.clearWritten()

        const tx1 = {
            inputs: [{
                outpoint: {
                    index: 0,
                    txid: hash(canonicalize(coinbase))
                },
                sig: "57D26AD7D4921B671B6D1F6655F8577C034893C3AFD70286CD1E6C195A90920EE5D15FC93FC5ECCC4C5B9A108F038623E4A305695535DFE557EA0877CC62D406" 
            }],
            outputs: [{
                pubkey: "3EFFB752170316F5D15D04504190FCF0C8FF75956C68AFB2A9B5BA7801AB128C",
                value: 10
            }],
            type: "transaction"
        }
        s.feedJSON({ type: 'object', object: tx1 })
        await waitForWrite(s, m => m?.type === 'ihaveobject')
        s.clearWritten()
        const tx2 = {
            inputs: [{
                outpoint: {
                    index: 0,
                    txid: hash(canonicalize(coinbase))
                },
                sig: "43D8980D80FB791902680E5D55B8568B8C9E6720F26E8C6891BD09261FCEF6240208E0316217ED0F88EE7AEC52F166927F3972E1EFF529E8BF24D969E3666C03"
            }],
            outputs: [{
                pubkey: "pubkey2",
                value: 10
            }],
            type: "transaction"
        }
        s.feedJSON({ type: 'object', object: tx2 })
        await waitForWrite(s, m => m?.type === 'ihaveobject')
        s.clearWritten()

        const block1 = {
            T: TARGET,
            created: 1671062410,
            nonce: '30',
            txids: [hash(canonicalize(tx1))],
            type: 'block',
            previd: hash(canonicalize(block)),
        }
        s.feedJSON({ type: 'object', object: block1 })
        await waitForWrite(s, m => m?.type === 'ihaveobject')
        s.clearWritten()

        const block2 = {
            T: TARGET,
            created: 1671062415,
            nonce: '30',
            txids: [hash(canonicalize(tx2))],
            type: 'block',
            previd: hash(canonicalize(block1)),
        }
        s.feedJSON({ type: 'object', object: block2 })
        const error = await waitForWrite(s, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.error).toBe('INVALID_TX_OUTPOINT')
    })

    it('rejects invalid coinbase', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
        s.feedJSON({ type: 'object', object: GENESIS_BLOCK })
        await waitForWrite(s, m => m?.type === 'ihaveobject')
        s.clearWritten()
        const coinbase = {
            height: 0,
            outputs: [{
                pubkey: "3EFFB752170316F5D15D04504190FCF0C8FF75956C68AFB2A9B5BA7801AB128C",
                value: BLOCK_REWARD + 10
            }],
            type: "transaction"
        }
        s.feedJSON({ type: 'object', object: coinbase })
        await waitForWrite(s, m => m?.type === 'ihaveobject')
        s.clearWritten()
        const block = {
            T: TARGET,
            created: 1671062401,
            nonce: '29',
            txids: [hash(canonicalize(coinbase))],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }
        s.feedJSON({ type: 'object', object: block })
        const error = await waitForWrite(s, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.error).toBe('INVALID_BLOCK_COINBASE')
        s.clearWritten()
    })
})

describe('2) gossiping of blocks', () => {
    it('gossips valid block', async () => {
        const s1 = new FakeSocket('B')
        handshake(s1)
        s.feedJSON({ type: 'object', object: GENESIS_BLOCK })
        const ihaveobject = await waitForWrite(s1, m => m?.type === 'ihaveobject')
        expect(ihaveobject).toBeDefined()
        expect(ihaveobject.objectid).toBe(hash(canonicalize(GENESIS_BLOCK)))
    })
})
