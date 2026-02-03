import { Level } from 'level'
import canonicalize from 'canonicalize'
import { hash, FIND_OBJECT_TIMEOUT } from './utils'
import { peerManager } from './peermanager'
import { Transaction } from './transaction'
import { Block } from './block'
import { chainManager } from './chain'
import { mempoolManager } from './mempool'
import { ObjectError, ErrorName } from './error'
import type { NetworkObject, Hash } from './types'

const makeLevelDB = (path: string) =>
    new Level<Hash, NetworkObject>(path, { valueEncoding: 'json' })

const fromNetwork = {
    transaction: Transaction.fromNetwork,
    block: Block.fromNetwork,
}

export class ObjectManager {
    constructor(private db: KV<Hash, any> = makeLevelDB('./db')) {}
    pendingFinds: Map<Hash, { resolve: (obj: any) => void, reject: (err: Error) => void }[]> = new Map()

    id(object: any) {
        return hash(canonicalize(object))
    }

    async exists(id: Hash) {
        return await this.db.has(id)
    }

    async add(object: any, id: string = this.id(object)) {
        await this.db.put(id, object)
        const waiters = this.pendingFinds.get(id)
        if (waiters && waiters.length > 0) {
            waiters.forEach(w => w.resolve(object))
            this.pendingFinds.delete(id)
        }
    }

    async get(id: Hash) {
        let object = await this.db.get(id)
        if (object.type === 'transaction') {
            object = Transaction.fromJSON(object)
        }
        else if (object.type === 'block') {
            object = Block.fromJSON(object)
        }
        return object
    }

    async validate(networkObject: NetworkObject) {
        const transformer = fromNetwork[networkObject.type]
        const object = transformer(networkObject as any)
        await object.validate()
        return object
    }

    async fromNetwork(networkObject: NetworkObject) {
        const id = this.id(networkObject)
        if (await this.exists(id)) {
            return true
        }
        try {
            const object = await this.validate(networkObject)
            if (object.type === 'transaction') {
                try {
                    mempoolManager.addTransaction(object as Transaction)
                } catch (err: any) {
                    if (!this.pendingFinds.has(id)) {
                        throw err
                    }
                }
            }
            else if (object.type === 'block') {
                await chainManager.updateLongestChain(object as Block)
            }
            await this.add(object, object.id)
            return false
        } catch (err) {
            const waiters = this.pendingFinds.get(id)
            if (waiters && waiters.length > 0) {
                waiters.forEach(w => w.reject(err as Error))
                this.pendingFinds.delete(id)
            }
            throw err
        }
    }

    async fromMining(block: Block) {
        await this.add(block, block.id)
        await chainManager.updateLongestChain(block)
    }

    async findObject(objectid: Hash): Promise<NetworkObject> {
        if (await this.exists(objectid)) {
            return await this.get(objectid)
        }

        peerManager.broadcast({
            type: 'getobject',
            objectid,
        })

        return new Promise<NetworkObject>((resolve, reject) => {
            let timer: any

            const entry = {
                resolve: (obj: NetworkObject) => {
                    clearTimeout(timer)
                    resolve(obj)
                },
                reject: (err: Error) => {
                    clearTimeout(timer)
                    reject(err)
                }
            }

            const waiters = this.pendingFinds.get(objectid) ?? []
            waiters.push(entry)
            this.pendingFinds.set(objectid, waiters)

            timer = setTimeout(() => {
                const arr = this.pendingFinds.get(objectid)
                if (arr) {
                    const idx = arr.indexOf(entry)
                    if (idx >= 0) arr.splice(idx, 1)
                    if (arr.length === 0) this.pendingFinds.delete(objectid)
                }

                reject(new ObjectError(ErrorName.UNFINDABLE_OBJECT, `Object ${objectid} not found after ${FIND_OBJECT_TIMEOUT}ms`))
            }, FIND_OBJECT_TIMEOUT)
        })
    }
}

export let objectManager = new ObjectManager()
export function _setObjectManagerForTests(om: ObjectManager) { objectManager = om }
type KV<K, V> = {
    has: (key: K) => Promise<boolean>
    get: (key: K) => Promise<V | undefined>
    put: (key: K, value: V) => Promise<void>
}
