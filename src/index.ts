import 'dotenv/config'
import os from 'os'
import { createServer } from 'net'
import { peerManager } from './peermanager'
import { chainManager } from './chain'
import { mempoolManager } from './mempool'
import { miningManager } from './miningmanager'
import { startSelfPayer } from './selfpayer'
import { Logger } from './logger'

const PORT = process.env.PORT || 18018
const MINERS = parseInt(process.env.MINERS || os.cpus().length.toString())
const log = new Logger('server')

await miningManager.init(MINERS)
await mempoolManager.init()
await chainManager.init()
await peerManager.init()
startSelfPayer()

const server = createServer((socket) => {
    peerManager.addPeer(socket)
})

server.listen(PORT, () => {
    log.info(`Listening on port ${PORT}`)
})
