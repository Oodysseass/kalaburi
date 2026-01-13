import { createServer } from 'net'
import { peerManager } from './peermanager'
import { chainManager } from './chain'
import { mempoolManager } from './mempool'
import { miningManager } from './miningmanager'

const PORT = process.env.PORT || 18018

await peerManager.init()
await chainManager.init()
await mempoolManager.init()
await miningManager.init(parseInt(process.env.MINERS || '4'))
const server = createServer((socket) => {
    peerManager.addPeer(socket)
})

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`)
})
