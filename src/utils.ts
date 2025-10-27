import { blake2s } from '@noble/hashes/blake2'
import { utf8ToBytes } from '@noble/hashes/utils'
import forge from 'node-forge'

export const VERSION = '0.10.0'
export const AGENT = 'kalaburi'

export const matchesVersion = (version: string, pattern = "0.10.x") => {
    const versionParts = version.split('.')
    if (versionParts.length !== 3 || versionParts.some(part => isNaN(Number(part)))) {
      return false
    }
  
    const [vMajor, vMinor] = versionParts
    const [pMajor, pMinor] = pattern.split('.')
  
    return vMajor === pMajor && vMinor === pMinor
}

export const hash = (object: any) => {
    return Buffer.from(blake2s(utf8ToBytes(object))).toString('hex')
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
