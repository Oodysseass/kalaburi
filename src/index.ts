import { createServer } from 'net'
import PeerManager from './peermanager'

const PORT = process.env.PORT || 18018
const peerManager = new PeerManager()

const server = createServer((socket) => {
    peerManager.addPeer(socket)
})

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`)
})

