import { Socket } from 'net'
import canonicalize from 'canonicalize'
import { VERSION, AGENT, validatePeerAddress } from './utils'
import { peerManager, MAX_ACTIVE_PEERS } from './peermanager'
import { objectManager } from './object'
import { chainManager } from './chain'
import { mempoolManager } from './mempool'
import { ObjectError, InternalError, DependencyError, ErrorName } from './error'
import { MessageSchema } from './types'
import { Logger } from './logger'
import type {
    Message,
    PeersMessage,
    IHaveObjectMessage,
    GetObjectMessage,
    ObjectMessage,
    ChainTipMessage,
    MempoolMessage,
    ErrorMessage,
    NetworkObject,
    Hash
} from './types'

export default class Peer {
    socket: Socket
    id: string = ''
    buffer: string = ''
    handshaked: boolean = false
    log: Logger = new Logger()
    handlers: Record<Message['type'], (message: Message) => Promise<void>> = {
        hello: async () => await this.handleHello(),
        getpeers: async () => await this.handleGetPeers(),
        peers: async (m) => await this.handlePeers(m as PeersMessage),
        ihaveobject: async (m) => await this.handleIHaveObject(m as IHaveObjectMessage),
        getobject: async (m) => await this.handleGetObject(m as GetObjectMessage),
        object: async (m) => await this.handleObject(m as ObjectMessage),
        getchaintip: async () => await this.handleGetChainTip(),
        chaintip: async (m) => await this.handleChainTip(m as ChainTipMessage),
        getmempool: async () => await this.handleGetMempool(),
        mempool: async (m) => await this.handleMempool(m as MempoolMessage),
        error: async (m) => await this.handleError(m as ErrorMessage),
    }

    constructor(socket: Socket) {
        this.socket = socket
        this.initializeSocket()
    }

    initializeSocket() {
        this.socket.on('connect', () => {
            if (peerManager.activePeers.size < MAX_ACTIVE_PEERS) {
                this.onConnect.bind(this)
            } else {
                this.socket.end()
            }
        })

        this.socket.on('close', () => {
            this.log.info('Disconnected')
            peerManager.removePeer(this)
        })

        this.socket.on('error', (error) => {
            this.log.error('Socket error', error.message)
            peerManager.removePeer(this)
            this.socket.end()
        })

        this.socket.on('data', (data) => {
            this.handleStream(data.toString())
        })
    }

    onConnect() {
        this.id = this.socket.remoteAddress + ':' + this.socket.remotePort
        this.log = new Logger(this.id)
        this.log.info('Connected')
        this.sendHello()
        this.sendGetPeers()
        this.sendGetChainTip()
        this.sendGetMempool()
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

    async handleMessage(msg: string) {
        let message: Message

        try {
            message = JSON.parse(msg) as Message
        } catch (_) {
            this.sendError('INVALID_FORMAT', `Could not parse message: '${msg}'`)
            this.log.warn('Could not parse message', msg)
            peerManager.removePeer(this)
            this.socket.end()
            return
        }

        try {
            message = MessageSchema.parse(message)
        } catch (err: any) {
            this.log.error('Schema validation failed', err.message)
            this.sendError('INVALID_FORMAT', 'Unknown message type')
            this.log.warn('Unknown message type', msg)
            peerManager.removePeer(this)
            this.socket.end()
            return
        }

        if (!this.handshaked && message.type !== 'hello') {
            this.sendError('INVALID_HANDSHAKE', `Received message type "${message.type}" before handshake`)
            this.log.warn('Received message before handshake', msg)
            peerManager.removePeer(this)
            this.socket.end()
            return
        }

        this.log.debug('Received', message)

        await this.handlers[message.type](message)
            .then(() => true)
            .catch((err: any) => {
                this.log.error('Handler error', err.message)
                if (err instanceof InternalError) {
                    return
                }
                this.sendError(err.name, err.message)
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

    async sendObject(object: NetworkObject) {
        const response = {
            type: 'object',
            object
        }

        this.sendMessage(response)
    }

    async sendGetChainTip() {
        const getChainTip = {
            type: 'getchaintip',
        }

        this.sendMessage(getChainTip)
    }

    async sendChainTip() {
        const length = chainManager.longestChain.length
        const blockid = chainManager.longestChain[length - 1]!.id
        const chainTip = {
            type: 'chaintip',
            blockid
        }

        this.sendMessage(chainTip)
    }

    async sendGetMempool() {
        const getMempool = {
            type: 'getmempool',
        }

        this.sendMessage(getMempool)
    }

    async sendMempool() {
        const mempool = {
            type: 'mempool',
            txids: mempoolManager.txids
        }

        this.sendMessage(mempool)
    }

    async sendError(name: string, description: string) {
        const error = {
            type: 'error',
            name,
            description
        }

        this.sendMessage(error)
    }

    async sendMessage(msg: any) {
        this.log.debug('Sending', msg)
        const message = canonicalize(msg) + '\n'
        this.socket.write(message)
    }

    async handleHello() {
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

        message.peers.forEach(peer => validatePeerAddress(peer))
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
            const object = await objectManager.get(message.objectid)
            if (typeof object.type === 'undefined') {
                return
            }
            await this.sendObject(object.toNetwork())
            return
        }

        throw new ObjectError(ErrorName.UNKNOWN_OBJECT, `Object ${message.objectid} not found`)
    }

    async handleObject(message: ObjectMessage) {
        const id = objectManager.id(message.object)
        const isWaitedFor = objectManager.pendingFinds.has(id)
        try {
            const existed = await objectManager.fromNetwork(message.object)
            if (!existed) {
                this.sendIHaveObject(id)
            }
        } catch (err: any) {
            if (isWaitedFor) {
                return
            }
            if (err instanceof DependencyError) {
                this.log.error('Dependency error', err.cause.message)
                if (message.object.type === 'block') {
                    this.sendError(ErrorName.UNFINDABLE_OBJECT, `Block ${id} could not be validated`)
                }
                throw err.cause
            }
            throw err
        }
    }

    async handleGetChainTip() {
        this.sendChainTip()
    }

    async handleChainTip(message: ChainTipMessage) {
        const exists = await objectManager.exists(message.blockid)
        if (!exists) {
            this.sendGetObject(message.blockid)
        }
    }

    async handleGetMempool() {
        this.sendMempool()
    }

    async handleMempool(message: MempoolMessage) {
        message.txids.forEach(async txid => {
            if (await objectManager.exists(txid)) {
                return
            }
            this.sendGetObject(txid)
        })
    }

    async handleError(message: ErrorMessage) {
        this.log.warn('Remote error', `${message.name}: ${message.description}`)
    }
}
