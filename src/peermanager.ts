import { Socket, connect } from 'net'
import Peer from './peer'
import { loadPeers, savePeers } from './persistence'
import { Logger } from './logger'
import type { Hash } from './types'

const log = new Logger('peers')

const BOOTSTRAP_PEERS = [
    '95.179.158.137:18018',
    '95.179.132.22:18018'
]

const MY_ADDRESS = '45.32.235.245:18018'

export class PeerManager {
    activePeers: Set<Peer> = new Set()
    knownAddresses: Map<string, number> = new Map()

    async init() {
        this.loadState()
    }

    addPeer(socket: Socket) {
        const p = new Peer(socket)
        p.onConnect()
    }

    removePeer(peer: Peer) {
        this.activePeers.delete(peer)
    }

    addKnownPeer(identifier: string) {
        const lastColon = identifier.lastIndexOf(':')
        const ip = identifier.slice(0, lastColon)
        const port = parseInt(identifier.slice(lastColon + 1))
        if (ip && !isNaN(port)) {
            if (ip === 'localhost' || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.')) {
                log.warn(`Ignoring localhost peer: ${identifier}`)
                return
            }
            this.knownAddresses.set(ip, port)
        }
    }

    forgetPeer(identifier: string) {
        const lastColon = identifier.lastIndexOf(':')
        const ip = identifier.slice(0, lastColon)
        if (ip && this.knownAddresses.has(ip)) {
            this.knownAddresses.delete(ip)
            this.saveState()
            log.info(`Forgot peer ${identifier}`)
        }
    }

    knownPeersList(): string[] {
        return Array.from(this.knownAddresses.entries()).map(([ip, port]) => `${ip}:${port}`)
    }

    loadState() {
        log.info('Loading persisted peers')

        this.addKnownPeer(MY_ADDRESS)
        BOOTSTRAP_PEERS.forEach(id => this.addKnownPeer(id))

        const persisted = loadPeers()
        log.debug(`Found ${persisted.length} persisted peers`)
        persisted.forEach((id: string) => this.addKnownPeer(id))

        this.knownAddresses.forEach((port, ip) => {
            const identifier = `${ip}:${port}`
            if (identifier === MY_ADDRESS) return
            const socket = connect(port, ip)
            new Peer(socket, identifier)
        })
    }

    saveState() {
        savePeers(this.knownPeersList())
    }

    broadcast(message: any) {
        this.activePeers.forEach(p => p.sendMessage(message))
    }

    fromMining(id: Hash) {
        const ihaveobject = {
            type: 'ihaveobject',
            objectid: id
        }
        this.broadcast(ihaveobject)
    }
}

export const peerManager = new PeerManager()
