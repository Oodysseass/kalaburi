import { Socket, connect } from 'net'
import Peer from './peer'
import { loadPeers, savePeers } from './persistence'

export default class PeerManager {
    peers: Peer[] = []

    constructor() {
        this.loadState()
    }

    addPeer(socket: Socket, initiateHandshake: boolean = false) {
        const peer = new Peer(socket, this, initiateHandshake)
        this.peers.push(peer)
        peer.socket.on('close', () => {
            this.removePeer(peer)
        })

        this.saveState()
    }

    removePeer(peer: Peer) {
        this.peers = this.peers.filter(p => p.id !== peer.id)
        this.saveState()
    }

    loadState() {
        const identifiers = loadPeers()
        identifiers.forEach((identifier: string) => {
            const [address, port] = identifier.split(':')
            const socket = connect(parseInt(port || '0'), address || '')
            console.log(`Connected to ${address}:${port}`)
            this.addPeer(socket, true)
        })
    }

    saveState(addresses: string[] = []) {
        const peerAddresses = this.peers.map(p => `${p.socket.remoteAddress}:${p.socket.remotePort}`);
        const allAddresses = [...peerAddresses, ...addresses];
        savePeers(allAddresses);
    }
}