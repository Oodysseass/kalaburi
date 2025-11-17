import { PeerManager } from '../src/peermanager'
import canonicalize from 'canonicalize'
import { FakeSocket, waitForWrite } from './helpers/fakesocket'
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
        waitForWrite(s, m => m?.type === 'ihaveobject')
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
        s.feedJSON({ type: 'object', object: GENESIS_BLOCK })
        const block = {
            T: TARGET,
            created: 5,
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

        const block = {
            T: TARGET,
            created: 1671062401,
            nonce: '29',
            txids: ["737bda404559848f48a59b4d97160db7edc683f84f5b51380e1cb874e1f327ac"],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }
        s.feedJSON({ type: 'object', object: block })
        const error = await waitForWrite(s, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.error).toBe('UNFINDABLE_OBJECT')

        s.clearWritten()
        const tx = {
            height: 0,
            outputs: [{
                pubkey: "958f8add086cc348e229a3b6590c71b7d7754e42134a127a50648bf07969d9a0",
                value: BLOCK_REWARD
            }],
            type: "transaction"
        }
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
            height: 0,
            outputs: [{
                pubkey: "3EFFB752170316F5D15D04504190FCF0C8FF75956C68AFB2A9B5BA7801AB128C",
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
            txids: ["1e1a81ba90f66bf58b00f27b1664094d76d5ef132d39078ba8928f5259a3a6d9"],
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
                    txid: "1e1a81ba90f66bf58b00f27b1664094d76d5ef132d39078ba8928f5259a3a6d9"
                },
                sig: "D57F8E987D103EBA05BD0C7EAD0B7E9FAE5B8C6ECB78A13BCA7F0419CB0AE27ADBFA2BD902DF0D44A676B5BC892C47FD79968A18E8FF231B0AD2D07531D87207" 
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
                    txid: "1e1a81ba90f66bf58b00f27b1664094d76d5ef132d39078ba8928f5259a3a6d9"
                },
                sig: "BA792DEB247DD5FE72C82DC4F270A507CD50D2419837B8AD60443E6E130938359FF8804341F267F726B1BC03C748D6AD1589E30C99D1046709DDE151172EAB08"
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
            height: 0,
            outputs: [{
                pubkey: "3EFFB752170316F5D15D04504190FCF0C8FF75956C68AFB2A9B5BA7801AB128C",
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
            txids: ["1e1a81ba90f66bf58b00f27b1664094d76d5ef132d39078ba8928f5259a3a6d9"],
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
                    txid: "1e1a81ba90f66bf58b00f27b1664094d76d5ef132d39078ba8928f5259a3a6d9"
                },
                sig: "D57F8E987D103EBA05BD0C7EAD0B7E9FAE5B8C6ECB78A13BCA7F0419CB0AE27ADBFA2BD902DF0D44A676B5BC892C47FD79968A18E8FF231B0AD2D07531D87207" 
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
                    txid: "1e1a81ba90f66bf58b00f27b1664094d76d5ef132d39078ba8928f5259a3a6d9"
                },
                sig: "BA792DEB247DD5FE72C82DC4F270A507CD50D2419837B8AD60443E6E130938359FF8804341F267F726B1BC03C748D6AD1589E30C99D1046709DDE151172EAB08"
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
