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

    constructor(socket: Socket, peerManager: PeerManager, initiateHandshake: boolean = false) {
        this.socket = socket
        this.id = socket.remoteAddress + ':' + socket.remotePort
        this.peerManager = peerManager

        socket.on('data', (data) => {
            this.handleStream(data.toString())
        })
    
        if (initiateHandshake) {
            this.sendHello()
        }
    }

    handleStream(data: string) {
        this.buffer += data
        let messages = this.buffer.split('\n')

        while (messages.length > 1) {
            let message = messages.shift()?.trim() ?? '';
            this.log(`Received: ${message}`)

            let request
            try {
                request = JSON.parse(message)
                this.handleRequest(request)
            } catch (_) {
                const error = {
                    type: 'error',
                    error: 'INVALID_FORMAT',
                    description: `Could not parse message: '${message}'`
                }

                this.socket.write(canonicalize(error) + '\n')
                this.log(`Invalid JSON: ${message}`)
            }
        }

        this.buffer = messages[0] ?? ''
    }

    log(message: string) {
        console.log(`[${this.id}] ${message}`)
    }

    handleRequest(request: any) {
        switch (request.type) {
            case 'hello':
                this.handleHello(request)
                break
            case 'getpeers':
                this.handleGetPeers(request)
                break
            case 'peers':
                this.handlePeers(request)
                break
            case 'error':
                break
            default:
                this.sendError('INVALID_REQUEST', `Unknown request type: '${request.type}'`)
        }
    }

    sendHello() {
        const hello = {
            type: 'hello',
            version: VERSION,
            agent: AGENT
        }

        this.sendResponse(hello)
    }

    sendGetPeers() {
        const getPeers = {
            type: 'getpeers',
        }

        this.sendResponse(getPeers)
    }

    sendPeers() {
        const peers = this.peerManager.peers.map(peer => (
            `${peer.socket.remoteAddress}:${peer.socket.remotePort}`
        ))

        const response = {
            type: 'peers',
            peers: peers
        }

        this.sendResponse(response)
    }

    sendError(error_name: string, error_description: string) {
        const error = {
            type: 'error',
            error: error_name,
            description: error_description
        }

        this.sendResponse(error)
    }

    sendResponse(response: any) {
        this.socket.write(canonicalize(response) + '\n')
    }

    handleHello(request: any) {
        if (!matchesVersion(request.version)) {
            this.socket.end()
            return
        }

        if (this.handshaked) {
            return
        }

        this.handshaked = true
        this.sendHello()
        this.sendGetPeers()
    }

    handleGetPeers(request: any) {
        if (!this.handshaked) {
            this.sendError('INVALID_HANDSHAKE', `Received request ${request.type} before handshake`)
            return
        }

        this.sendPeers()
    }

    handlePeers(request: any) {
        if (!this.handshaked) {
            this.sendError('INVALID_HANDSHAKE', `Received request ${request.type} before handshake`)
            return
        }

        this.peerManager.saveState(request.peers)
    }
}
