import { PeerManager } from '../src/peermanager'
import { FakeSocket, iterWrittenJSON, findFirst, findIndex, waitForWrite } from './helpers/fakesocket'

let pm: any
beforeEach(() => {
    pm = new PeerManager()
})

describe('1) connect', () => {
    it('accepts a connection and starts handshake', () => {
        const s = new FakeSocket('A')
        pm.addPeer(s.asNetSocket())
        const msgs = iterWrittenJSON(s)
        expect(findFirst(msgs, m => m?.type === 'hello')).toBeDefined()
    })
})

describe('2-3) hello then getpeers ordering', () => {
    it('writes hello first, then getpeers', () => {
        const s = new FakeSocket('B')
        pm.addPeer(s.asNetSocket())
        const msgs = iterWrittenJSON(s)
        const hiIdx = findIndex(msgs, m => m?.type === 'hello')
        const gpIdx = findIndex(msgs, m => m?.type === 'getpeers')
        expect(hiIdx).toBeGreaterThanOrEqual(0)
        expect(gpIdx).toBeGreaterThanOrEqual(0)
        expect(hiIdx).toBeLessThan(gpIdx)
    })
})

describe('4) disconnect → reconnect', () => {
    it('restarts handshake on new connection', () => {
        const s1 = new FakeSocket('C1')
        pm.addPeer(s1.asNetSocket())
        const first = iterWrittenJSON(s1)
        expect(findFirst(first, m => m?.type === 'hello')).toBeDefined()
        s1.destroy()

        const s2 = new FakeSocket('C2')
        pm.addPeer(s2.asNetSocket())
        const second = iterWrittenJSON(s2)
        expect(findFirst(second, m => m?.type === 'hello')).toBeDefined()
    })
})

describe('5) getpeers -> peers (post-handshake)', () => {
    it('replies with peers after remote hello', async () => {
        const s = new FakeSocket('D')
        pm.addPeer(s.asNetSocket())

        s.feedJSON({ type: 'hello', version: '0.10.0', agent: 'grader' })
        s.clearWritten()

        s.feedJSON({ type: 'getpeers' })
        const peersMsg = await waitForWrite(s, m => m?.type === 'peers' && Array.isArray(m.peers))
        expect(peersMsg).toBeDefined()
    })
})

describe('6) chunked framing ("ge" + "tpeers")', () => {
    it('parses partial frame and replies with peers', async () => {
        const s = new FakeSocket('E')
        pm.addPeer(s.asNetSocket())

        s.feedJSON({ type: 'hello', version: '0.10.0', agent: 'grader' })
        s.clearWritten()

        s.feedBytes('{"type":"ge')
        s.feedBytes('tpeers"}\n')

        const peersMsg = await waitForWrite(s, m => m?.type === 'peers')
        expect(peersMsg).toBeDefined()
    })
})

describe('7) pre-hello message -> INVALID_HANDSHAKE + disconnect', () => {
    it('rejects and closes when remote speaks before hello', () => {
        const s = new FakeSocket('F')
        pm.addPeer(s.asNetSocket())

        s.clearWritten()
        s.feedJSON({ type: 'getpeers' })

        const msgs = iterWrittenJSON(s)
        const err = findFirst(msgs, m => m?.type === 'error')
        expect(err).toBeDefined()
        expect(String(err.name ?? err.message ?? '')).toMatch(/INVALID_HANDSHAKE/i)
        expect(s.closed).toBe(true)
    })
})

describe('8) invalid messages -> INVALID_FORMAT', () => {
    it('rejects raw garbage', () => {
        const s = new FakeSocket('G1')
        pm.addPeer(s.asNetSocket())
        s.clearWritten()
        s.feedBytes('Wbgygvf7rgtvy7tfbgy{{{\n')
        const msgs = iterWrittenJSON(s)
        const err = findFirst(msgs, m => m?.type === 'error')
        expect(err).toBeDefined()
        expect(String(err.name ?? err.message ?? '')).toMatch(/INVALID_FORMAT/i)
        expect(s.closed).toBe(true)
    })

    it('rejects unknown type', () => {
        const s = new FakeSocket('G2')
        pm.addPeer(s.asNetSocket())
        s.clearWritten()
        s.feedJSON({ type: 'diufygeuybhv' })
        const msgs = iterWrittenJSON(s)
        const err = findFirst(msgs, m => m?.type === 'error')
        expect(err).toBeDefined()
        expect(String(err.name ?? err.message ?? '')).toMatch(/INVALID_FORMAT/i)
        expect(s.closed).toBe(true)
    })

    it('rejects hello missing version', () => {
        const s = new FakeSocket('G3')
        pm.addPeer(s.asNetSocket())
        s.clearWritten()
        s.feedJSON({ type: 'hello' })
        const msgs = iterWrittenJSON(s)
        const err = findFirst(msgs, m => m?.type === 'error')
        expect(err).toBeDefined()
        expect(String(err.name ?? err.message ?? '')).toMatch(/INVALID_FORMAT/i)
        expect(s.closed).toBe(true)
    })

    it('rejects hello with invalid semver (jd3.x)', () => {
        const s = new FakeSocket('G4')
        pm.addPeer(s.asNetSocket())
        s.clearWritten()
        s.feedJSON({ type: 'hello', version: 'jd3.x' })
        const msgs = iterWrittenJSON(s)
        const err = findFirst(msgs, m => m?.type === 'error')
        expect(err).toBeDefined()
        expect(String(err.name ?? err.message ?? '')).toMatch(/INVALID_FORMAT/i)
        expect(s.closed).toBe(true)
    })

    it('rejects hello with incompatible version (5.8.2) as INVALID_FORMAT per spec', () => {
        const s = new FakeSocket('G5')
        pm.addPeer(s.asNetSocket())
        s.clearWritten()
        s.feedJSON({ type: 'hello', version: '5.8.2' })
        const msgs = iterWrittenJSON(s)
        const err = findFirst(msgs, m => m?.type === 'error')
        expect(err).toBeDefined()
        expect(String(err.name ?? err.message ?? '')).toMatch(/INVALID_FORMAT/i)
        expect(s.closed).toBe(true)
    })
})

describe('9) peers persist across reconnect', () => {
    it('remembers peers from previous session', async () => {
        const givenPeers = ['45.32.235.245:18018']

        const s1 = new FakeSocket('H1')
        pm.addPeer(s1.asNetSocket())
        s1.feedJSON({ type: 'hello', version: '0.10.0', agent: 'grader' })
        s1.clearWritten()
        s1.feedJSON({ type: 'peers', peers: givenPeers })
        s1.destroy()

        const s2 = new FakeSocket('H2')
        pm.addPeer(s2.asNetSocket())
        s2.feedJSON({ type: 'hello', version: '0.10.0', agent: 'grader' })

        s2.feedJSON({ type: 'getpeers' })

        const peersMsg = await waitForWrite(s2, m => m?.type === 'peers' && Array.isArray(m.peers))
        expect(peersMsg).toBeDefined()

        const returned: string[] = peersMsg!.peers
        expect(returned).toEqual(expect.arrayContaining(givenPeers))
    })
})

describe('10) two simultaneous connections', () => {
    it('handles two peers at once', () => {
        const sA = new FakeSocket('I-A')
        const sB = new FakeSocket('I-B')
        pm.addPeer(sA.asNetSocket())
        pm.addPeer(sB.asNetSocket())

        const aMsgs = iterWrittenJSON(sA)
        const bMsgs = iterWrittenJSON(sB)

        expect(findFirst(aMsgs, m => m?.type === 'hello')).toBeDefined()
        expect(findFirst(bMsgs, m => m?.type === 'hello')).toBeDefined()
        expect(findFirst(aMsgs, m => m?.type === 'getpeers')).toBeDefined()
        expect(findFirst(bMsgs, m => m?.type === 'getpeers')).toBeDefined()
    })
})
