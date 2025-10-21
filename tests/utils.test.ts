import { matchesVersion, hash } from '../src/utils'

describe('utils', () => {
    describe('matchesVersion', () => {
        it('accepts same major and minor, ignores patch', () => {
                expect(matchesVersion('0.10.0', '0.10.x')).toBe(true)
                expect(matchesVersion('0.10.7', '0.10.x')).toBe(true)
        })

        it('rejects different major/minor', () => {
                expect(matchesVersion('0.10.0', '0.11.x')).toBe(false)
                expect(matchesVersion('1.10.0', '0.10.x')).toBe(false)
        })

        it('rejects malformed input versions', () => {
            expect(matchesVersion('foo', '0.10.x')).toBe(false)
            expect(matchesVersion('0.10', '0.10.x')).toBe(false)
            expect(matchesVersion('0.10.0.0', '0.10.x')).toBe(false)
            expect(matchesVersion('0.10.a', '0.10.x')).toBe(false)
        })
    })

    describe('hash', () => {
        it('is deterministic and hex-encoded', () => {
            const a = hash('hello')
            const b = hash('hello')
            expect(a).toEqual(b)
            expect(a).toMatch(/^[0-9a-f]{64}$/)
        })
    })
})
