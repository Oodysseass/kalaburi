import { PeerManager } from '../src/peermanager'
import { chainManager } from '../src/chain'
import { mempoolManager } from '../src/mempool'
import canonicalize from 'canonicalize'
import { FakeSocket, waitForWrite } from './helpers/fakesocket'
import {
    TARGET,
    GENESIS_BLOCK,
    GENESIS_BLOCK_ID,
    BLOCK_REWARD,
    hash,
    _setTargetForTests
} from '../src/utils'
import { setupTestEnv, handshake, id } from './helpers/test-utils'

let pm: any
let s: FakeSocket
beforeEach(async () => {
    pm = new PeerManager()
    await setupTestEnv()
    s = new FakeSocket('A')
    handshake(pm, s)
    jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
    jest.clearAllMocks()
})

describe('1) block validation', () => {
    it('reject incorrect target', async () => {
        s.feedJSON({ type: 'object', object: GENESIS_BLOCK })
        await waitForWrite(s, m => m?.type === 'ihaveobject')
        const block = {
            T: '0000000a0bc00000000000000000000000000000000000000000000000000000',
            created: 1771159361,
            nonce: '26',
            txids: [],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }
        s.feedJSON({ type: 'object', object: block })
        const error = await waitForWrite(s, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.name).toBe('INVALID_FORMAT')
    })

    it('rejects invalid pow', async () => {
        _setTargetForTests('00000000abc0000000000000000000000000000000000000000000000000000')
        s.feedJSON({ type: 'object', object: GENESIS_BLOCK })
        await waitForWrite(s, m => m?.type === 'ihaveobject')
        const block = {
            T: TARGET,
            created: 1771159362,
            nonce: '23',
            txids: [],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }
        s.feedJSON({ type: 'object', object: block })
        const error = await waitForWrite(s, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.name).toBe('INVALID_BLOCK_POW')
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
            created: 1771159361,
            nonce: '29',
            txids: [id(tx)],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }
        s.feedJSON({ type: 'object', object: block })
        const error = await waitForWrite(s, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.name).toBe('UNFINDABLE_OBJECT')

        s.clearWritten()

        s.feedJSON({ type: 'object', object: tx })
        await waitForWrite(s, m => m?.type === 'ihaveobject')
        s.clearWritten()

        s.feedJSON({ type: 'object', object: block })
        const ihaveobject = await waitForWrite(s, m => m?.type === 'ihaveobject')
        expect(ihaveobject).toBeDefined()
        expect(ihaveobject.objectid).toBe(id(block))
    })

    it('rejects double spending transactions', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
        chainManager.longestChain = []
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
            created: 1771159361,
            nonce: '29',
            txids: [id(coinbase)],
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
                    txid: id(coinbase)
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
                    txid: id(coinbase)
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
        const error = await waitForWrite(s, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.name).toBe('INVALID_TX_OUTPOINT')
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
            created: 1771159361,
            nonce: '29',
            txids: [id(coinbase)],
            type: 'block',
            previd: GENESIS_BLOCK_ID,
        }
        s.feedJSON({ type: 'object', object: block })
        const error = await waitForWrite(s, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.name).toBe('INVALID_BLOCK_COINBASE')
        s.clearWritten()
    })
})

describe('2) gossiping of blocks', () => {
    it('gossips valid block', async () => {
        const s1 = new FakeSocket('B')
        handshake(pm, s1)
        s.feedJSON({ type: 'object', object: GENESIS_BLOCK })
        const ihaveobject = await waitForWrite(s1, m => m?.type === 'ihaveobject')
        expect(ihaveobject).toBeDefined()
        expect(ihaveobject.objectid).toBe(id(GENESIS_BLOCK))
    })
})
