import { Socket, connect } from 'net'
import Peer from './peer'
import { loadPeers, savePeers } from './persistence'

export default class PeerManager {
    peers: Set<Peer> = new Set()

    constructor() {
        this.loadState()
    }

    addPeer(socket: Socket) {
        const p = new Peer(socket, this)
        p.onConnect()
    }

    removePeer(peer: Peer) {
        this.peers.delete(peer)
    }

    loadState() {
        console.log('Loading state')
        const identifiers = loadPeers()
        identifiers.forEach((identifier: string) => {
            const lastColonIndex = identifier.lastIndexOf(':')
            const address = identifier.slice(0, lastColonIndex)
            const port = identifier.slice(lastColonIndex + 1)
            const socket = connect(parseInt(port), address)
            new Peer(socket, this)
        })
    }

    saveState(addresses: string[] = []) {
        const peerAddresses = Array.from(this.peers).map(p => p.id)
        const allAddresses = Array.from(new Set([...peerAddresses, ...addresses]))
        savePeers(allAddresses)
    }

    broadcast(message: any) {
        Object.values(this.peers).forEach(p => p.sendMessage(message))
    }
}
