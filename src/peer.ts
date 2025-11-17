import { Socket } from 'net'
import canonicalize from 'canonicalize'
import { VERSION, AGENT, matchesVersion } from './utils'
import { peerManager } from './peermanager'
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
    Hash
} from './types'

export default class Peer {
    socket: Socket
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

    constructor(socket: Socket) {
        this.socket = socket
        this.initializeSocket()
    }

    initializeSocket() {
        this.socket.on('connect', () => this.onConnect.bind(this))

        this.socket.on('close', () => {
            if (process.env.NODE_ENV === 'test') return
            this.log('Client disconnected')
            peerManager.removePeer(this)
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
        peerManager.activePeers.add(this)
        peerManager.knownAddresses.add(this.id)
        peerManager.saveState()
    }

    handleStream(data: string) {
        this.buffer += data
        let messages = this.buffer.split('\n')

        while (messages.length > 1) {
            const message = messages.shift()?.trim() ?? ''
            if (!message) continue

            this.handleMessage(message)
        }

        this.buffer = messages[0] ?? ''
    }

    log(message: any, data?: any) {
        const cyan = '\x1b[36m'
        const green = '\x1b[32m'
        const yellow = '\x1b[33m'
        const reset = '\x1b[0m'

        const coloredId = `${cyan}[${this.id}]${reset}`

        const formatValue = (value: any, indent: string = '  '): string => {
            if (value === null || typeof value !== 'object') {
                return `${yellow}${String(value)}${reset}`
            }

            const entries = Array.isArray(value)
                ? value.map<[string, any]>((v, i) => [String(i), v])
                : Object.entries(value)

            const inner = entries.map(
                ([k, v]) => `${indent}${green}${k}${reset} = ${formatValue(v, indent + '  ')}`
            ).join('\n')

            return `{\n${inner}\n${indent.slice(2)}}`
        }

        const formatObject = (obj: any) => {
            if (!obj || typeof obj !== 'object') return ` ${formatValue(obj)}`

            const lines = Object.entries(obj).map(
                ([key, value]) =>
                    `  ${green}${key}${reset} = ${formatValue(value, '    ')}`
            )

            return `\n${lines.join('\n')}`
        }

        if (data !== undefined) {
            const prefix = String(message)
            if (data && typeof data === 'object') {
                console.log(`${coloredId} ${prefix} ${formatObject(data)}`)
            } else {
                console.log(`${coloredId} ${prefix} ${data}`)
            }
            return
        }

        if (message && typeof message === 'object') {
            console.log(`${coloredId} ${formatObject(message)}`)
        } else {
            console.log(`${coloredId} ${message}`)
        }
    }

    async handleMessage(msg: string) {
        let message: Message

        try {
            message = JSON.parse(msg) as Message
        } catch (_) {
            this.sendError('INVALID_FORMAT', `Could not parse message: '${msg}'`)
            this.log('Could not parse message:', msg)
            this.socket.end()
            return
        }

        try {
            message = MessageSchema.parse(message)
        } catch (err: any) {
            console.error(err)
            this.sendError('INVALID_FORMAT', 'Unknown message type')
            this.log('Unknown message type:', msg)
            this.socket.end()
            return
        }

        if (!this.handshaked && message.type !== 'hello') {
            this.sendError('INVALID_HANDSHAKE', `Received message type "${message.type}" before handshake`)
            this.log('Received message before handshake:', msg)
            this.socket.end()
            return
        }

        this.log('Received', message)

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
        const peers = Array.from(peerManager.knownAddresses)

        const response = {
            type: 'peers',
            peers
        }

        this.sendMessage(response)
    }

    async sendIHaveObject(objectid: Hash) {
        const iHaveObject = {
            type: 'ihaveobject',
            objectid
        }

        peerManager.broadcast(iHaveObject)
    }

    async sendGetObject(objectid: Hash) {
        const getObject = {
            type: 'getobject',
            objectid
        }

        this.sendMessage(getObject)
    }

    async sendObject(objectid: Hash) {
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

        message.peers.forEach(peer => peerManager.knownAddresses.add(peer))
        peerManager.saveState()
    }

    async handleIHaveObject(message: IHaveObjectMessage) {
        if (await objectManager.exists(message.objectid)) {
            return
        }

        this.sendGetObject(message.objectid)
    }

    async handleGetObject(message: GetObjectMessage) {
        if (await objectManager.exists(message.objectid)) {
            await this.sendObject(message.objectid)
            return
        }

        this.sendError('UNKNOWN_OBJECT', `Object ${message.objectid} not found`)
    }

    async handleObject(message: ObjectMessage) {
        const existed = await objectManager.fromNetwork(message.object)
        if (!existed) {
            this.sendIHaveObject(objectManager.id(message.object))
        }
    }

    async handleError(message: ErrorMessage) {
        this.log(`${message.error}:${message.description}`)
    }
}
