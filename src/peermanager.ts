import { Socket, connect } from 'net'
import Peer from './peer'
import { loadPeers, savePeers } from './persistence'
import { Logger } from './logger'
import type { Hash } from './types'

const log = new Logger('peers')

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
        const identifiers = loadPeers()
        log.debug(`Found ${identifiers.length} known peers`)
        identifiers.forEach((identifier: string) => {
            this.addKnownPeer(identifier)
            const lastColon = identifier.lastIndexOf(':')
            const address = identifier.slice(0, lastColon)
            const port = parseInt(identifier.slice(lastColon + 1))
            const socket = connect(port, address)
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
