import fs from 'fs'
import { savePeers, loadPeers } from '../src/persistence'

describe('persistence', () => {
    let writeSpy: jest.SpiedFunction<typeof fs.writeFileSync>
    let readSpy: jest.SpiedFunction<typeof fs.readFileSync>

    beforeEach(() => {
        writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined as any)
        readSpy = jest.spyOn(fs, 'readFileSync')
    })

    afterEach(() => {
        writeSpy.mockRestore()
        readSpy.mockRestore()
        jest.clearAllMocks()
    })

    it('savePeers writes peers.json with expected structure', () => {
        const peers = ['127.0.0.1:18018', '10.0.0.5:18018']
        savePeers(peers)

        expect(writeSpy).toHaveBeenCalledTimes(1)
        const [pathArg, dataArg] = (writeSpy.mock.calls[0] as [string, string])
        expect(pathArg).toBe('peers.json')

        const parsed = JSON.parse(String(dataArg))
        expect(parsed).toEqual({ peers })
    })

    it('loadPeers returns peers from JSON when file exists', () => {
        readSpy.mockReturnValueOnce(
            Buffer.from(JSON.stringify({ peers: ['a:1', 'b:2'] }))
        )

        const result = loadPeers()

        expect(result).toEqual(['a:1', 'b:2'])
    })

    it('loadPeers returns [] when file is missing (ENOENT)', () => {
        const enoent: any = new Error('no file')
        enoent.code = 'ENOENT'
        readSpy.mockImplementationOnce(() => { throw enoent })

        const result = loadPeers()

        expect(result).toEqual([])
    })
})
