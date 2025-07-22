import { Socket } from 'net'
import canonicalize from 'canonicalize'
import { VERSION, AGENT, matchesVersion } from './utils'
import PeerManager from './peermanager'
import { objectManager } from './object'

export default class Peer {
    socket: Socket
    peerManager: PeerManager
    id: string = ''
    buffer: string = ''
    handshaked: boolean = false

    constructor(socket: Socket, peerManager: PeerManager) {
        this.socket = socket
        this.peerManager = peerManager
        this.initializeSocket()
    }

    initializeSocket() {
        // Seperate the initialization for incoming and outgoing connections
        if (this.socket.remoteAddress && this.socket.remotePort) {
            this.onConnect()
        } else {
            this.socket.on('connect', () => this.onConnect())
        }

        this.socket.on('close', () => {
            this.log('Client disconnected')
            this.peerManager.removePeer(this)
        })

        this.socket.on('error', (error) => {
            this.log(`Client error: ${error}`)
            this.socket.end()
        })

        this.socket.on('data', (data) => {
            this.handleStream(data.toString())
        })
    }

    onConnect() {
        this.id = this.socket.remoteAddress + ':' + this.socket.remotePort
        this.log('Client connected')
        this.sendHello()
        this.sendGetPeers()
        this.peerManager.peers.push(this)
        this.peerManager.saveState()
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
            case 'ihaveobject':
                this.handleIHaveObject(message)
                break
            case 'getobject':
                this.handleGetObject(message)
                break
            case 'object':
                this.handleObject(message)
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

    sendGetObject(objectid: string) {
        const getObject = {
            type: 'getobject',
            objectid
        }

        this.sendMessage(getObject)
    }

    async sendObject(objectid: string) {
        const object = await objectManager.get(objectid)
        const response = {
            type: 'object',
            object
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

    async handleIHaveObject(message: any) {
        if (!this.handshaked) {
            this.sendError('INVALID_HANDSHAKE', `Received message type "${message.type}" before handshake`)
            return
        }

        if (!/^[a-f0-9]{64}$/.test(message.objectid)) {
            this.sendError('INVALID_FORMAT', `Received message type ${message.type} with invalid objectid`)
            return
        }

        if (await objectManager.exists(message.objectid)) {
            console.log('it exists????')
            return
        }

        this.sendGetObject(message.objectid)
    }

    async handleGetObject(message: any) {
        if (!this.handshaked) {
            this.sendError('INVALID_HANDSHAKE', `Received message type "${message.type}" before handshake`)
            return
        }

        if (!/^[a-f0-9]{64}$/.test(message.objectid)) {
            this.sendError('INVALID_FORMAT', `Received message type ${message.type} with invalid objectid`)
            return
        }

        if (await objectManager.exists(message.objectid)) {
            this.sendObject(message.objectid)
            return
        }

        this.sendError('UNKNOWN_OBJECT', `Object ${message.objectid} not found`)
    }

    async handleObject(message: any) {
        if (!this.handshaked) {
            this.sendError('INVALID_HANDSHAKE', `Received message type "${message.type}" before handshake`)
            return
        }

        const objectid = objectManager.id(message.object)
        console.log('objectid', objectid)
        console.log('message.object', message.object)
        if (await objectManager.exists(objectid)) {
            return
        }

        if (!objectManager.validate(message.object)) {
            this.sendError('INVALID_OBJECT', `Object ${message.objectid} is invalid`)
            return
        }

        objectManager.add(message.object)
        this.peerManager.broadcast({
            type: 'ihaveobject',
            objectid
        })
    }
}
