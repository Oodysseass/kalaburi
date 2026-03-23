import { PeerManager } from '../src/peermanager'
import { mempoolManager } from '../src/mempool'
import { chainManager } from '../src/chain'
import canonicalize from 'canonicalize'
import { FakeSocket, iterWrittenJSON, waitForWrite } from './helpers/fakesocket'
import {
    GENESIS_BLOCK,
    GENESIS_BLOCK_ID,
    BLOCK_REWARD,
    _setTargetForTests
} from '../src/utils'
import {
    setupTestEnv,
    handshake,
    id,
    genKeypair,
    signMessageHex,
    sendAndAckObject,
    buildCoinbase,
    buildBlock
} from './helpers/test-utils'

let pm: PeerManager
let s1: FakeSocket
let s2: FakeSocket

beforeEach(async () => {
    pm = new PeerManager()
    chainManager.longestChain = []
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

function buildTwoInputSpend(
    in1: { txid: string, index: number, signerPriv: string },
    in2: { txid: string, index: number, signerPriv: string },
    outputs: { pubkey: string, value: number }[]
) {
    const signable = canonicalize({
        type: 'transaction',
        inputs: [
            { outpoint: { txid: in1.txid, index: in1.index }, sig: null },
            { outpoint: { txid: in2.txid, index: in2.index }, sig: null },
        ],
        outputs,
    })
    const sig1 = signMessageHex(in1.signerPriv, signable!)
    const sig2 = signMessageHex(in2.signerPriv, signable!)

    return {
        type: 'transaction',
        inputs: [
            { outpoint: { txid: in1.txid, index: in1.index }, sig: sig1 },
            { outpoint: { txid: in2.txid, index: in2.index }, sig: sig2 },
        ],
        outputs,
    }
}

describe('1) invalid objects -> INVALID_FORMAT and no gossip', () => {
    it('a) transaction with two inputs sharing an outpoint', async () => {
        const duplicateOutpointTx = {
            type: 'transaction',
            inputs: [
                { outpoint: { txid: 'x', index: 0 }, sig: 's1' },
                { outpoint: { txid: 'x', index: 0 }, sig: 's2' },
            ],
            outputs: [{ pubkey: 'pk', value: 1 }],
        }

        s1.feedJSON({ type: 'object', object: duplicateOutpointTx })
        const error = await waitForWrite(s1, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.name).toBe('INVALID_FORMAT')

        const msgsB = iterWrittenJSON(s2)
        const gossiped = msgsB.find(m => m?.type === 'ihaveobject' && m.objectid === id(duplicateOutpointTx))
        expect(gossiped).toBeUndefined()
    })

    it('b) block with note longer than 128 chars', async () => {
        const longNote = 'a'.repeat(129)
        const block = buildBlock({
            previd: GENESIS_BLOCK_ID,
            created: 1771159361,
            nonce: 'n',
            txids: [],
            note: longNote,
        })

        s1.feedJSON({ type: 'object', object: block })
        const error = await waitForWrite(s1, m => m?.type === 'error')
        expect(error).toBeDefined()
        expect(error?.name).toBe('INVALID_FORMAT')

        const msgsB = iterWrittenJSON(s2)
        const gossiped = msgsB.find(m => m?.type === 'ihaveobject' && m.objectid === id(block))
        expect(gossiped).toBeUndefined()
    })
})

describe('2) valid two-input transaction gossip', () => {
    it('gossips a valid transaction with two inputs (different pubkeys)', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

        await sendAndAckObject(s1, GENESIS_BLOCK)
        s1.clearWritten()
        s2.clearWritten()

        const kp1 = genKeypair()
        const kp2 = genKeypair()

        const cb1 = buildCoinbase(1, kp1.pubHex)
        await sendAndAckObject(s1, cb1)
        s1.clearWritten()
        const b1 = buildBlock({
            previd: GENESIS_BLOCK_ID,
            created: 1771159361,
            nonce: 'b1',
            txids: [id(cb1)],
        })
        await sendAndAckObject(s1, b1)
        s1.clearWritten()

        const cb2 = buildCoinbase(2, kp2.pubHex)
        await sendAndAckObject(s1, cb2)
        s1.clearWritten()

        const b2 = buildBlock({
            previd: id(b1),
            created: 1771159362,
            nonce: 'b2',
            txids: [id(cb2)],
        })
        await sendAndAckObject(s1, b2)
        s1.clearWritten()
        s2.clearWritten()

        const spend = buildTwoInputSpend(
            { txid: id(cb1), index: 0, signerPriv: kp1.privHex },
            { txid: id(cb2), index: 0, signerPriv: kp2.privHex },
            [{ pubkey: kp1.pubHex, value: BLOCK_REWARD + BLOCK_REWARD }]
        )
        await sendAndAckObject(s1, spend)
        const ih = await waitForWrite(s2, m => m?.type === 'ihaveobject')
        expect(ih).toBeDefined()
        expect(ih.objectid).toBe(id(spend))

        s2.clearWritten()
        s2.feedJSON({ type: 'getobject', objectid: ih.objectid })
        const obj = await waitForWrite(s2, m => m?.type === 'object' && m.object)
        expect(obj).toBeDefined()
        expect(obj.object).toEqual(spend)
    })
})

describe('3) mempool behavior', () => {

    it('a) getmempool + getchaintip returns a mempool valid against chain UTXO (initially empty)', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
        chainManager.longestChain = []

        await sendAndAckObject(s1, GENESIS_BLOCK)
        s1.clearWritten()

        s1.feedJSON({ type: 'getchaintip' })
        const ct = await waitForWrite(s1, m => m?.type === 'chaintip')
        expect(ct).toBeDefined()
        expect(ct.blockid).toBe(id(GENESIS_BLOCK))

        s1.feedJSON({ type: 'getmempool' })
        const mp = await waitForWrite(s1, m => m?.type === 'mempool')
        expect(mp).toBeDefined()
        expect(Array.isArray(mp.txids)).toBe(true)
        expect(mp.txids.length).toBe(0)
    })

    it('b) accepts tx valid wrt mempool/chain state and returns it in getmempool', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
        chainManager.longestChain = []

        await sendAndAckObject(s1, GENESIS_BLOCK)
        s1.clearWritten()

        const kp = genKeypair()
        const cb = buildCoinbase(1, kp.pubHex)
        await sendAndAckObject(s1, cb)
        s1.clearWritten()

        const b1 = buildBlock({
            previd: GENESIS_BLOCK_ID,
            created: 1771159361,
            nonce: 'b1',
            txids: [id(cb)],
        })
        await sendAndAckObject(s1, b1)
        s1.clearWritten()

        let signable = canonicalize({
            type: 'transaction',
            inputs: [{ outpoint: { txid: id(cb), index: 0 }, sig: null }],
            outputs: [{ pubkey: kp.pubHex, value: BLOCK_REWARD }],
        })
        const sig = signMessageHex(kp.privHex, signable!)
        const spend = {
            type: 'transaction',
            inputs: [{ outpoint: { txid: id(cb), index: 0 }, sig }],
            outputs: [{ pubkey: kp.pubHex, value: BLOCK_REWARD }],
        }

        await sendAndAckObject(s1, spend)
        s1.clearWritten()

        s1.feedJSON({ type: 'getmempool' })
        const mp = await waitForWrite(s1, m => m?.type === 'mempool')
        expect(mp.txids).toContain(id(spend))
    })

    it('c) rejects tx invalid wrt current mempool state (double-spend), mempool excludes it', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
        chainManager.longestChain = []

        await sendAndAckObject(s1, GENESIS_BLOCK)
        s1.clearWritten()
        const kp = genKeypair()
        const cb = buildCoinbase(1, kp.pubHex)
        await sendAndAckObject(s1, cb)
        s1.clearWritten()
        const b1 = buildBlock({
            previd: GENESIS_BLOCK_ID,
            created: 1771159361,
            nonce: 'b1',
            txids: [id(cb)],
        })
        await sendAndAckObject(s1, b1)
        s1.clearWritten()

        const signable = canonicalize({
            type: 'transaction',
            inputs: [{ outpoint: { txid: id(cb), index: 0 }, sig: null }],
            outputs: [{ pubkey: kp.pubHex, value: BLOCK_REWARD }],
        })
        const sig1 = signMessageHex(kp.privHex, signable!)
        const spend1 = {
            type: 'transaction',
            inputs: [{ outpoint: { txid: id(cb), index: 0 }, sig: sig1 }],
            outputs: [{ pubkey: kp.pubHex, value: BLOCK_REWARD }],
        }
        await sendAndAckObject(s1, spend1)
        s1.clearWritten()

        const signable2 = canonicalize({
            type: 'transaction',
            inputs: [{ outpoint: { txid: id(cb), index: 0 }, sig: null }],
            outputs: [{ pubkey: kp.pubHex, value: BLOCK_REWARD - 1}],
        })
        const sig2 = signMessageHex(kp.privHex, signable2!)
        const spend2 = {
            type: 'transaction',
            inputs: [{ outpoint: { txid: id(cb), index: 0 }, sig: sig2 }],
            outputs: [{ pubkey: kp.pubHex, value: BLOCK_REWARD - 1}],
        }
        s1.feedJSON({ type: 'object', object: spend2 })
        const err = await waitForWrite(s1, m => m?.type === 'error')
        expect(err?.name).toBe('INVALID_TX_OUTPOINT')

        s1.clearWritten()
        s1.feedJSON({ type: 'getmempool' })
        const mp = await waitForWrite(s1, m => m?.type === 'mempool')
        expect(mp.txids).not.toContain(id(spend2))
    })

    it('d) coinbase transaction is not included in mempool', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
        await sendAndAckObject(s1, GENESIS_BLOCK)
        s1.clearWritten()

        const kp = genKeypair()
        const coinbase = buildCoinbase(1, kp.pubHex)

        s1.feedJSON({ type: 'object', object: coinbase })
        await waitForWrite(s1, m => m?.type === 'ihaveobject')

        s1.clearWritten()
        s1.feedJSON({ type: 'getmempool' })
        const mp = await waitForWrite(s1, m => m?.type === 'mempool')
        expect(mp.txids).not.toContain(id(coinbase))
    })

    it('e) mempool reflects reorg: drops invalid/chain-included txs; restores valid txs from old chain', async () => {
        _setTargetForTests('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
        chainManager.longestChain = []

        await sendAndAckObject(s1, GENESIS_BLOCK)
        s1.clearWritten()

        const a = genKeypair()
        const cbA1 = buildCoinbase(1, a.pubHex)
        await sendAndAckObject(s1, cbA1)
        s1.clearWritten()
        const blkA1 = buildBlock({
            previd: GENESIS_BLOCK_ID,
            created: 1771159361,
            nonce: 'A1',
            txids: [id(cbA1)],
        })
        await sendAndAckObject(s1, blkA1)
        s1.clearWritten()

        const spendSignableA = canonicalize({
            type: 'transaction',
            inputs: [{ outpoint: { txid: id(cbA1), index: 0 }, sig: null }],
            outputs: [{ pubkey: a.pubHex, value: BLOCK_REWARD }],
        })
        const spendSigA = signMessageHex(a.privHex, spendSignableA!)
        const txSpendA = {
            type: 'transaction',
            inputs: [{ outpoint: { txid: id(cbA1), index: 0 }, sig: spendSigA }],
            outputs: [{ pubkey: a.pubHex, value: BLOCK_REWARD }],
        }
        await sendAndAckObject(s1, txSpendA)
        s1.clearWritten()

        const cbA2 = buildCoinbase(2, a.pubHex)
        await sendAndAckObject(s1, cbA2)
        s1.clearWritten()
        const blkA2 = buildBlock({
            previd: id(blkA1),
            created: 1771159362,
            nonce: 'A2',
            txids: [id(cbA2), id(txSpendA)],
        })
        await sendAndAckObject(s1, blkA2)
        s1.clearWritten()

        const b = genKeypair()
        const cbB2 = buildCoinbase(2, b.pubHex)
        await sendAndAckObject(s1, cbB2)
        s1.clearWritten()
        const blkB2 = buildBlock({
            previd: id(blkA1),
            created: 1771159370,
            nonce: 'B2',
            txids: [id(cbB2)],
        })
        await sendAndAckObject(s1, blkB2)
        s1.clearWritten()

        const cbB3 = buildCoinbase(3, b.pubHex)
        await sendAndAckObject(s1, cbB3)
        s1.clearWritten()
        const blkB3 = buildBlock({
            previd: id(blkB2),
            created: 1771159371,
            nonce: 'B3',
            txids: [id(cbB3)],
        })
        await sendAndAckObject(s1, blkB3)

        s1.clearWritten()
        s1.feedJSON({ type: 'getmempool' })
        const mp = await waitForWrite(s1, m => m?.type === 'mempool')

        expect(mp.txids).not.toContain(id(cbA2))
        expect(mp.txids).toContain(id(txSpendA))
    })
})
