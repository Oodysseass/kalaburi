import { createServer } from 'net'
import { peerManager } from './peermanager'
import { chainManager } from './chain'
import { mempoolManager } from './mempool'
import { miningManager } from './miningmanager'
import { Logger } from './logger'

const PORT = process.env.PORT || 18018
const log = new Logger('server')

await peerManager.init()
await miningManager.init(parseInt(process.env.MINERS || '4'))
await chainManager.init()
await mempoolManager.init()
const server = createServer((socket) => {
    peerManager.addPeer(socket)
})

server.listen(PORT, () => {
    log.info(`Listening on port ${PORT}`)
})
