import { Duplex } from 'stream'
import type { Socket } from 'net'

export class FakeSocket extends Duplex {
    public written: string[] = []
    public closed = false
    public ended = false
    private _remoteAddress: string
    private _remotePort: number
    private _localAddress: string
    private _localPort: number

    constructor(public id: string, opts: {
        remoteAddress?: string
        remotePort?: number
        localAddress?: string
        localPort?: number
    } = {}) {
        super({ objectMode: true })
        this._remoteAddress = opts.remoteAddress ?? '127.0.0.1'
        this._remotePort = opts.remotePort ?? (40000 + Math.floor(Math.random() * 1000))
        this._localAddress = opts.localAddress ?? '127.0.0.1'
        this._localPort = opts.localPort ?? 18018
    }

    get remoteAddress() { return this._remoteAddress }
    get remotePort() { return this._remotePort }
    get localAddress() { return this._localAddress }
    get localPort() { return this._localPort }

    _read() { }

    _write(chunk: any, _enc: any, cb: any) {
        this.written.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk))
        cb()
    }

    end(): this {
        this.ended = true
            ; (this as any).emit('end')
            ; (this as any).emit('close')
        this.closed = true
        return this
    }

    override destroy(err?: Error): this {
        if (err) (this as any).emit('error', err)
            ; (this as any).emit('close')
        this.closed = true
        return this
    }

    asNetSocket(): Socket {
        return this as unknown as Socket
    }

    feedBytes(buf: Buffer | string) {
        const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf
            ; (this as any).emit('data', b)
    }

    feedJSON(obj: unknown) {
        this.feedBytes(JSON.stringify(obj) + '\n')
    }

    clearWritten() {
        this.written.length = 0
    }
}

export function iterWrittenJSON(sock: FakeSocket): any[] {
    const out: any[] = []
    for (const chunk of sock.written) {
        for (const line of chunk.split('\n')) {
            const t = line.trim()
            if (!t) continue
            try {
                out.push(JSON.parse(t))
            } catch { }
        }
    }
    return out
}

export const findFirst = (msgs: any[], pred: (m: any) => boolean) =>
    msgs.find(pred)

export const findIndex = (msgs: any[], pred: (m: any) => boolean) =>
    msgs.findIndex(pred)

export const countType = (msgs: any[], type: string) =>
    msgs.filter(m => m?.type === type).length

export const waitForWrite = (sock: FakeSocket, pred: (m: any) => boolean) =>
    new Promise<any>((resolve, reject) => {
        const start = Date.now()
        const tick = () => {
            const m = findFirst(iterWrittenJSON(sock), pred)
            if (m) return resolve(m)
            if (Date.now() - start > 10000) return reject(new Error('timeout'))
            setTimeout(tick, 5)
        }
        tick()
    }
)
