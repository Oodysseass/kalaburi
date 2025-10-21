import { Socket } from 'net'
import canonicalize from 'canonicalize'
import { VERSION, AGENT, matchesVersion } from './utils'
import PeerManager from './peermanager'
import { objectManager } from './object'
import { MessageSchema } from './types'
import type {
    Message,
    HelloMessage,
    PeersMessage,
    IHaveObjectMessage,
    GetObjectMessage,
    ObjectMessage,
    ErrorMessage,
} from './types'

export default class Peer {
    socket: Socket
    peerManager: PeerManager
    id: string = ''
    buffer: string = ''
    handshaked: boolean = false
    handlers: Record<Message['type'], (message: Message) => void | Promise<void>> = {
        hello: (m) => this.handleHello(m as HelloMessage),
        getpeers: () => this.handleGetPeers(),
        peers: (m) => this.handlePeers(m as PeersMessage),
        ihaveobject: (m) => this.handleIHaveObject(m as IHaveObjectMessage),
        getobject: (m) => this.handleGetObject(m as GetObjectMessage),
        object: (m) => this.handleObject(m as ObjectMessage),
        error: (m) => this.handleError(m as ErrorMessage),
    }

    constructor(socket: Socket, peerManager: PeerManager) {
        this.socket = socket
        this.peerManager = peerManager
        this.initializeSocket()
    }

    initializeSocket() {
        this.socket.on('connect', () => this.onConnect())

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
        this.peerManager.peers.add(this)
        this.peerManager.saveState()
    }

    handleStream(data: string) {
        this.buffer += data
        let messages = this.buffer.split('\n')

        while (messages.length > 1) {
            let message = messages.shift()?.trim() ?? ''
            this.log(`Received: ${message}`)

            this.handleMessage(message)
        }

        this.buffer = messages[0] ?? ''
    }

    log(message: string) {
        console.log(`[${this.id}] ${message}`)
    }

    handleMessage(msg: string) {
        let message: Message

        try {
            message = JSON.parse(msg) as Message
        } catch (_) {
            this.sendError('INVALID_FORMAT', `Could not parse message: '${msg}'`)
            return
        }

        try {
            message = MessageSchema.parse(message)
        } catch (err: any) {
            console.error(err)
            this.sendError('INVALID_FORMAT', 'Unknown message type')
            return
        }

        if (!this.handshaked && message.type !== 'hello') {
            this.sendError('INVALID_HANDSHAKE', `Received message type "${message.type}" before handshake`)
            return
        }

        this.handlers[message.type](message)
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
        const peers = Array.from(this.peerManager.peers).map(p => p.id)

        const response = {
            type: 'peers',
            peers
        }

        this.sendMessage(response)
    }

    sendIHaveObject(objectid: string) {
        const iHaveObject = {
            type: 'ihaveobject',
            objectid
        }

        this.peerManager.broadcast(iHaveObject)
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

    sendError(name: string, message: string) {
        const error = {
            type: 'error',
            error: name,
            description: message
        }

        this.sendMessage(error)
    }

    sendMessage(response: any) {
        this.socket.write(canonicalize(response) + '\n')
    }

    handleHello(message: HelloMessage) {
        if (!matchesVersion(message.version)) {
            this.sendError('INVALID_FORMAT', `Received hello with invalid version "${message.version}"`)
            this.socket.end()
            return
        }

        if (this.handshaked) {
            return
        }

        this.handshaked = true
    }

    handleGetPeers() {
        this.sendPeers()
    }

    handlePeers(message: PeersMessage) {
        if (message.peers.length === 0) {
            this.sendError('INVALID_FORMAT', `Received message type ${message.type} without payload`)
            return
        }

        this.peerManager.saveState(message.peers)
    }

    async handleIHaveObject(message: IHaveObjectMessage) {
        if (!/^[a-f0-9]{64}$/.test(message.objectid)) {
            this.sendError('INVALID_FORMAT', `Received message type ${message.type} with invalid objectid`)
            return
        }

        if (await objectManager.exists(message.objectid)) {
            return
        }

        this.sendGetObject(message.objectid)
    }

    async handleGetObject(message: GetObjectMessage) {
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

    async handleObject(message: ObjectMessage) {
        const objectid = objectManager.id(message.object)
        if (await objectManager.exists(objectid)) {
            return
        }

        try {
            objectManager.validate(message.object)
        } catch (err: any) {
            console.error(err)
            this.sendError(err.name, err.message)
            return
        }

        objectManager.add(message.object)
        this.sendIHaveObject(objectid)
    }

    handleError(message: ErrorMessage) {
        this.log(`${message.error}:${message.description}`)
    }
}
