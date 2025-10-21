import PeerManager from '../src/peermanager'
import { FakeSocket, findWritten, pushJSON } from './helpers/fakesocket'

describe('handshake', () => {
    it('sends hello and getpeers automatically', () => {
        const pm = new PeerManager()
        const s = new FakeSocket('A')
        pm.addPeer(s.asNetSocket())

        const hello = findWritten(s, m => m?.type === 'hello')
        const gp = findWritten(s, m => m?.type === 'getpeers')

        expect(hello).toBeDefined()
        expect(gp).toBeDefined()
    })

    it('does not send a second hello', () => {
        const pm = new PeerManager()
        const s = new FakeSocket('B')
        pm.addPeer(s.asNetSocket())

        const before = s.written.join('')
        const countBefore = (before.match(/"type":"hello"/g) || []).length

        pushJSON(s, { type: 'hello', version: '0.10.0', agent: 'jest' })

        const after = s.written.join('')
        const countAfter = (after.match(/"type":"hello"/g) || []).length

        expect(countAfter).toBe(countBefore)
    })

    it('does not reply with peers until remote hello is accepted', () => {
        const pm = new PeerManager()
        const s = new FakeSocket('C')
        pm.addPeer(s.asNetSocket())

        s.written.length = 0

        pushJSON(s, { type: 'getpeers' })

        const peersMsg = findWritten(s, m => m?.type === 'peers')
        expect(peersMsg).toBeUndefined()
      })

    it('replies with peers once remote hello is accepted', () => {
        const pm = new PeerManager()
        const s = new FakeSocket('D')
        pm.addPeer(s.asNetSocket())

        pushJSON(s, { type: 'hello', version: '0.10.0', agent: 'jest' })

        s.written.length = 0

        pushJSON(s, { type: 'getpeers' })

        const peersMsg = findWritten(s, m => m?.type === 'peers' && Array.isArray(m.peers))
        expect(peersMsg).toBeDefined()
      })

    it('sends error for version mismatch', () => {
        const pm = new PeerManager()
        const s = new FakeSocket('E')
        pm.addPeer(s.asNetSocket())

        pushJSON(s, { type: 'hello', version: '9.99.0', agent: 'ancient' })

        const err = findWritten(s, m => m?.type === 'error')
        expect(err).toBeDefined()
        expect(String(err.error ?? err.message ?? '')).toMatch(/INVALID_FORMAT/i)
    })

    it('sends error on invalid schema', () => {
        const pm = new PeerManager()
        const s = new FakeSocket('F')
        pm.addPeer(s.asNetSocket())

        pushJSON(s, { type: 'hello', agent: 'jest' })

        const err = findWritten(s, m => m?.type === 'error')
        expect(err).toBeDefined()
    })
})
