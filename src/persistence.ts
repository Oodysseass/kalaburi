import fs from 'fs'

export const savePeers = (peers: string[]) => {
    fs.writeFileSync('peers.json', JSON.stringify({ peers }, null, 2))
}

export const loadPeers = () => {
    try {
        const peersData = fs.readFileSync('peers.json', 'utf8')
        const parsedData = JSON.parse(peersData)
        return parsedData.peers || []
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return []
        }
        throw error
    }
}
