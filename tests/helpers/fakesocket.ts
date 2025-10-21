import { Duplex } from 'stream'
import type { Socket } from 'net'

export class FakeSocket extends Duplex {
    public written: string[] = []
    constructor(public id: string) { super({ objectMode: true }) }
    _read() {}
    _write(chunk: any, _enc: any, cb: any) {
      this.written.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk))
      cb()
    }
    asNetSocket(): Socket {
      return this as unknown as Socket
    }
}

export function pushJSON(sock: FakeSocket, msg: unknown) {
    const line = JSON.stringify(msg) + '\n'
    ;(sock as any).emit('data', Buffer.from(line, 'utf8'))
}

export function findWritten(sock: FakeSocket, predicate: (m: any) => boolean) {
    for (const chunk of sock.written) {
      for (const line of chunk.split('\n')) {
        const s = line.trim()
        if (!s) continue
        try {
          const obj = JSON.parse(s)
          if (predicate(obj)) return obj
        } catch { }
      }
    }
    return undefined
}
