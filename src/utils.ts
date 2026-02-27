import net from 'net'
import forge from 'node-forge'
import canonicalize from 'canonicalize'
import { blake2s } from '@noble/hashes/blake2'
import { utf8ToBytes } from '@noble/hashes/utils'
import { ValidationError, ErrorName } from "./error"
import type { BlockObject } from './types'

export const VERSION = '0.10.0'
export const AGENT = 'kalaburi'
export const FIND_OBJECT_TIMEOUT = 2000
export let TARGET = "00000000abc00000000000000000000000000000000000000000000000000000"
export const BLOCK_REWARD = 50 * 10 ** 12
export const GENESIS_BLOCK: BlockObject = {
    T: "00000000abc00000000000000000000000000000000000000000000000000000",
    created: 1771159355,
    miner: "Marabu",
    nonce: "00dd82159556175752d9ba7349df67bddd237b59183747383f7b720e85c32347",
    note: "Financial Times 2026-02-13: Crypto's battle with the banks is splitting Trump's base",
    previd: null,
    txids: [],
    type: "block"
}

export const hash = (object: any) => {
    return Buffer.from(blake2s(utf8ToBytes(object))).toString('hex')
}

export let GENESIS_BLOCK_ID = hash(canonicalize(GENESIS_BLOCK))

export const matchesVersion = (version: string, pattern = "0.10.x") => {
    const versionParts = version.split('.')
    if (versionParts.length !== 3 || versionParts.some(part => isNaN(Number(part)))) {
      return false
    }
  
    const [vMajor, vMinor] = versionParts
    const [pMajor, pMinor] = pattern.split('.')
  
    return vMajor === pMajor && vMinor === pMinor
}

export const parsePeerAddress = (address: string): { host: string; port: number } => {
    let host: string
    let portStr: string

    if (address.startsWith('[')) {
        const closingBracket = address.indexOf(']')
        if (closingBracket === -1 || address[closingBracket + 1] !== ':') {
            throw new ValidationError(ErrorName.INVALID_FORMAT, `Invalid bracketed IPv6 peer address: ${address}`)
        }
        host = address.slice(1, closingBracket)
        portStr = address.slice(closingBracket + 2)
    } else {
        const lastColon = address.lastIndexOf(':')
        if (lastColon === -1) {
            throw new ValidationError(ErrorName.INVALID_FORMAT, `Invalid peer address (missing port): ${address}`)
        }
        host = address.slice(0, lastColon)
        portStr = address.slice(lastColon + 1)
    }

    const port = Number(portStr);
    if (
        !/^\d+$/.test(portStr) ||
        port < 1 || port > 65535 ||
        !Number.isInteger(port)
    ) {
        throw new ValidationError(ErrorName.INVALID_FORMAT, `Invalid port in peer address: ${address}`)
    }

    return { host, port }
}

export const validatePeerAddress = (address: string) => {
    const { host } = parsePeerAddress(address)

    const isHostname = (h: string): boolean => {
        if (h === 'localhost') return true
        if (h.length === 0 || h.length > 253) return false
        const labels = h.split('.')
        if (labels.length < 2) return false
        const labelRe = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/
        return labels.every(l => l.length > 0 && l.length <= 63 && labelRe.test(l))
    };

    if (!net.isIPv4(host) && !net.isIPv6(host) && !isHostname(host)) {
        throw new ValidationError(ErrorName.INVALID_FORMAT, `Invalid peer address: ${address}`)
    }

    if (isPrivateOrLocalAddress(host)) {
        throw new ValidationError(ErrorName.INVALID_FORMAT, `Private/local peer addresses are not allowed: ${address}`)
    }
};

export const isPrivateOrLocalAddress = (host: string): boolean => {
    if (host === 'localhost' || host === '::1') return true

    if (!net.isIPv4(host)) return false

    const parts = host.split('.').map(Number)
    const [a, b] = parts

    if (a === 127) return true
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 0) return true

    return false
}

export const verify = (publicKey: string, signature: string, message: string) => {
    try {
        return forge.pki.ed25519.verify({
        message: message,
        encoding: 'utf8',
        signature: forge.util.hexToBytes(signature),
        publicKey: forge.util.hexToBytes(publicKey),
    })
    } catch (error) {
        return false
    }
}

export const _setTargetForTests = (target: string) => {
    TARGET = target
    GENESIS_BLOCK.T = target
    GENESIS_BLOCK_ID = hash(canonicalize(GENESIS_BLOCK))
}
