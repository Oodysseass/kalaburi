import { Socket, connect } from 'net'
import Peer from './peer'
import { loadPeers, savePeers } from './persistence'

export default class PeerManager {
    peers: Peer[] = []

    constructor() {
        this.loadState()
    }

    addPeer(socket: Socket) {
        new Peer(socket, this)
    }

    removePeer(peer: Peer) {
        this.peers = this.peers.filter(p => p.id !== peer.id)
    }

    loadState() {
        console.log('Loading state')
        const identifiers = loadPeers()
        identifiers.forEach((identifier: string) => {
            const lastColonIndex = identifier.lastIndexOf(':')
            const address = identifier.slice(0, lastColonIndex)
            const port = identifier.slice(lastColonIndex + 1)
            const socket = connect(parseInt(port), address)
            this.addPeer(socket)
        })
    }

    saveState(addresses: string[] = []) {
        const peerAddresses = this.peers.map(p => p.id)
        const allAddresses = [...peerAddresses, ...addresses]
        savePeers(allAddresses)
    }

    broadcast(message: any) {
        this.peers.forEach(p => p.sendMessage(message))
    }
}
