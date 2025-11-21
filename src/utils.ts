import { blake2s } from '@noble/hashes/blake2'
import { utf8ToBytes } from '@noble/hashes/utils'
import forge from 'node-forge'
import canonicalize from 'canonicalize'
import net from 'net'
import type { BlockObject } from './types'

export const VERSION = '0.10.0'
export const AGENT = 'kalaburi'
export const FIND_OBJECT_TIMEOUT = 2000
export let TARGET = "00000000abc00000000000000000000000000000000000000000000000000000"
export const BLOCK_REWARD = 50 * 10 ** 12
export const GENESIS_BLOCK: BlockObject = {
    T: TARGET,
    created: 1671062400,
    miner: "Marabu",
    nonce: "000000000000000000000000000000000000000000000000000000021bea03ed",
    note: "The New York Times 2022-12-13: Scientists Achieve Nuclear Fusion Breakthrough With Blast of 192 Lasers",
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

export const validatePeerAddress = (address: string) => {
    const lastColon = address.lastIndexOf(':')
    if (lastColon === -1) {
        const error = new Error(`Invalid peer address (missing port): ${address}`)
        error.name = 'INVALID_FORMAT'
        throw error
    }
    const host = address.slice(0, lastColon)
    const portStr = address.slice(lastColon + 1)

    const port = Number(portStr);
    if (
        !/^\d+$/.test(portStr) ||
        port < 1 || port > 65535 ||
        !Number.isInteger(port)
    ) {
        const error = new Error(`Invalid port in peer address: ${address}`)
        error.name = 'INVALID_FORMAT'
        throw error
    }

    const isHostname = (h: string): boolean => {
        if (h === 'localhost') return true
        if (h.length === 0 || h.length > 253) return false
        const labels = h.split('.')
        if (labels.length < 2) return false
        const labelRe = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/
        return labels.every(l => l.length > 0 && l.length <= 63 && labelRe.test(l))
    };

    if (!net.isIPv4(host) && !net.isIPv6(host) && !isHostname(host)) {
        const error = new Error(`Invalid peer address: ${address}`)
        error.name = 'INVALID_FORMAT'
        throw error
    }
};

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
