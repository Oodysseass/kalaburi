import { Socket, connect } from 'net'
import Peer from './peer'
import { loadPeers, savePeers } from './persistence'
import type { Hash } from './types'

export const MAX_ACTIVE_PEERS = 20

export class PeerManager {
    activePeers: Set<Peer> = new Set()
    knownAddresses: Set<string> = new Set()

    async init() {
        this.loadState()
    }

    addPeer(socket: Socket) {
        if (this.activePeers.size < MAX_ACTIVE_PEERS) {
            const p = new Peer(socket)
            p.onConnect()
        }
    }

    removePeer(peer: Peer) {
        this.activePeers.delete(peer)
    }

    loadState() {
        console.log('Loading state')
        const identifiers = loadPeers()
        identifiers.forEach((identifier: string) => {
            if (this.activePeers.size >= MAX_ACTIVE_PEERS) return
            const lastColonIndex = identifier.lastIndexOf(':')
            const address = identifier.slice(0, lastColonIndex)
            const port = identifier.slice(lastColonIndex + 1)
            const socket = connect(parseInt(port), address)
            new Peer(socket)
        })
        this.knownAddresses = new Set(identifiers)
    }

    saveState() {
        savePeers(Array.from(this.knownAddresses))
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
