import PeerManager from '../src/peermanager'
import { FakeSocket, pushJSON, findWritten } from './helpers/fakesocket'

describe('handshake: happy path', () => {
  it('responds to a compatible hello', () => {
    const pm = new PeerManager()
    const s = new FakeSocket('A')
    pm.addPeer(s.asNetSocket())

    pushJSON(s, { type: 'hello', version: '0.10.0', agent: 'jest' })

    const hello = findWritten(s, (m) => m?.type === 'hello')
    expect(hello).toBeDefined()
    expect(typeof hello.version).toBe('string')
  })
})
