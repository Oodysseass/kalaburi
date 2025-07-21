import { Socket } from 'net'
import canonicalize from 'canonicalize'
import { VERSION, AGENT, matchesVersion } from './utils'
import PeerManager from './peermanager'

export default class Peer {
    socket: Socket
    id: string
    peerManager: PeerManager
    buffer: string = ''
    handshaked: boolean = false

    constructor(socket: Socket, peerManager: PeerManager) {
        this.socket = socket
        this.id = socket.remoteAddress + ':' + socket.remotePort
        this.peerManager = peerManager
        this.initializeSocket()
    }

    initializeSocket() {
        this.log('Client connected')
        this.sendHello()
        this.sendGetPeers()

        this.socket.on('data', (data) => {
            this.handleStream(data.toString())
        })
    }

    handleStream(data: string) {
        this.buffer += data
        let messages = this.buffer.split('\n')

        while (messages.length > 1) {
            let message = messages.shift()?.trim() ?? '';
            this.log(`Received: ${message}`)

            try {
                this.handleMessage(JSON.parse(message))
            } catch (_) {
                this.sendError('INVALID_FORMAT', `Could not parse message: '${message}'`)
            }
        }

        this.buffer = messages[0] ?? ''
    }

    log(message: string) {
        console.log(`[${this.id}] ${message}`)
    }

    handleMessage(message: any) {
        switch (message.type) {
            case 'hello':
                this.handleHello(message)
                break
            case 'getpeers':
                this.handleGetPeers(message)
                break
            case 'peers':
                this.handlePeers(message)
                break
            case 'error':
                break
            default:
                this.sendError('INVALID_FORMAT', `Unknown message type: '${message.type}'`)
        }
    }

    sendHello() {
        const hello = {
            type: 'hello',
            version: VERSION,
            agent: AGENT
        }

        this.sendMessage(hello)
    }

    sendGetPeers() {
        const getPeers = {
            type: 'getpeers',
        }

        this.sendMessage(getPeers)
    }

    sendPeers() {
        const peers = this.peerManager.peers.map(peer => peer.id)

        const response = {
            type: 'peers',
            peers
        }

        this.sendMessage(response)
    }

    sendError(error_name: string, error_description: string) {
        const error = {
            type: 'error',
            error: error_name,
            description: error_description
        }

        this.sendMessage(error)
    }

    sendMessage(response: any) {
        this.socket.write(canonicalize(response) + '\n')
    }

    handleHello(message: any) {
        if (!matchesVersion(message.version)) {
            this.socket.end()
            return
        }

        if (this.handshaked) {
            return
        }

        this.handshaked = true
    }

    handleGetPeers(message: any) {
        if (!this.handshaked) {
            this.sendError('INVALID_HANDSHAKE', `Received message type "${message.type}" before handshake`)
            return
        }

        this.sendPeers()
    }

    handlePeers(message: any) {
        if (!this.handshaked) {
            this.sendError('INVALID_HANDSHAKE', `Received message type "${message.type}" before handshake`)
            this.socket.end()
            return
        }

        if (message.peers.length === 0) {
            this.sendError('INVALID_FORMAT', `Received message type ${message.type} without payload`)
            return
        }

        this.peerManager.saveState(message.peers)
    }
}
