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
    handlers: Record<Message['type'], (message: Message) => Promise<void>> = {
        hello: async (m) => await this.handleHello(m as HelloMessage),
        getpeers: async () => await this.handleGetPeers(),
        peers: async (m) => await this.handlePeers(m as PeersMessage),
        ihaveobject: async (m) => await this.handleIHaveObject(m as IHaveObjectMessage),
        getobject: async (m) => await this.handleGetObject(m as GetObjectMessage),
        object: async (m) => await this.handleObject(m as ObjectMessage),
        error: async (m) => await this.handleError(m as ErrorMessage),
    }

    constructor(socket: Socket, peerManager: PeerManager) {
        this.socket = socket
        this.peerManager = peerManager
        this.initializeSocket()
    }

    initializeSocket() {
        this.socket.on('connect', () => this.onConnect.bind(this))

        this.socket.on('close', () => {
            if (process.env.NODE_ENV === 'test') return
            this.log('Client disconnected')
            this.peerManager.removePeer(this)
        })

        this.socket.on('error', (error) => {
            if (process.env.NODE_ENV === 'test') return
            console.error(`Client error: ${error}`)
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
        this.peerManager.activePeers.add(this)
        this.peerManager.knownAddresses.add(this.id)
        this.peerManager.saveState()
    }

    handleStream(data: string) {
        this.buffer += data
        let messages = this.buffer.split('\n')

        while (messages.length > 1) {
            let message = messages.shift()?.trim() ?? ''
            this.log(`Received: ${message}`)

            this.handleMessage.bind(this)(message)
        }

        this.buffer = messages[0] ?? ''
    }

    log(message: string) {
        console.log(`[${this.id}] ${message}`)
    }

    async handleMessage(msg: string) {
        let message: Message

        try {
            message = JSON.parse(msg) as Message
        } catch (_) {
            this.sendError('INVALID_FORMAT', `Could not parse message: '${msg}'`)
            this.socket.end()
            return
        }

        try {
            message = MessageSchema.parse(message)
        } catch (err: any) {
            console.error(err)
            this.sendError('INVALID_FORMAT', 'Unknown message type')
            this.socket.end()
            return
        }

        if (!this.handshaked && message.type !== 'hello') {
            this.sendError('INVALID_HANDSHAKE', `Received message type "${message.type}" before handshake`)
            this.socket.end()
            return
        }

        await this.handlers[message.type](message)
            .then(() => true)
            .catch((err: any) => {
                console.error(err)
                this.sendError(err.name, err.message)
                return false
            })
    }

    async sendHello() {
        const hello = {
            type: 'hello',
            version: VERSION,
            agent: AGENT
        }

        this.sendMessage(hello)
    }

    async sendGetPeers() {
        const getPeers = {
            type: 'getpeers',
        }

        this.sendMessage(getPeers)
    }

    async sendPeers() {
        const peers = Array.from(this.peerManager.knownAddresses)

        const response = {
            type: 'peers',
            peers
        }

        this.sendMessage(response)
    }

    async sendIHaveObject(objectid: string) {
        const iHaveObject = {
            type: 'ihaveobject',
            objectid
        }

        this.peerManager.broadcast(iHaveObject)
    }

    async sendGetObject(objectid: string) {
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

    async sendError(name: string, message: string) {
        const error = {
            type: 'error',
            error: name,
            description: message
        }

        this.sendMessage(error)
    }

    sendMessage(msg: any) {
        const message = canonicalize(msg) + '\n'
        this.socket.write(message)
    }

    async handleHello(message: HelloMessage) {
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

    async handleGetPeers() {
        this.sendPeers()
    }

    async handlePeers(message: PeersMessage) {
        if (message.peers.length === 0) {
            this.sendError('INVALID_FORMAT', `Received message type ${message.type} without payload`)
            return
        }
        // TODO: add peer address validation

        message.peers.forEach(peer => this.peerManager.knownAddresses.add(peer))
        this.peerManager.saveState()
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
            await this.sendObject(message.objectid)
            return
        }

        this.sendError('UNKNOWN_OBJECT', `Object ${message.objectid} not found`)
    }

    async handleObject(message: ObjectMessage) {
        const objectid = objectManager.id(message.object)
        if (await objectManager.exists(objectid)) {
            return
        }

        await objectManager.validate(message.object)
        await objectManager.add(message.object)
        this.sendIHaveObject(objectid)
    }

    async handleError(message: ErrorMessage) {
        this.log(`${message.error}:${message.description}`)
    }
}
