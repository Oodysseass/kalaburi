import { Level } from 'level'
import canonicalize from 'canonicalize'
import { hash, FIND_OBJECT_TIMEOUT } from './utils'
import { peerManager } from './peermanager'
import { Transaction } from './transaction'
import { Block } from './block'
import { chainManager } from './chain'
import { mempoolManager } from './mempool'
import { ObjectError, ErrorName } from './error'
import { Logger, shortId } from './logger'
import type { NetworkObject, Hash } from './types'

const log = new Logger('objects')

const makeLevelDB = (path: string) =>
    new Level<Hash, NetworkObject>(path, { valueEncoding: 'json' })

const fromNetwork = {
    transaction: Transaction.fromNetwork,
    block: Block.fromNetwork,
}

export class ObjectManager {
    constructor(private db: KV<Hash, any> = makeLevelDB('./db')) {}
    pendingFinds: Map<Hash, { resolve: (obj: any) => void, reject: (err: Error) => void }[]> = new Map()
    validating: Set<Hash> = new Set()

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
            log.debug(`Object ${shortId(id)} already exists`)
            return true
        }
        this.validating.add(id)
        try {
            const object = await this.validate(networkObject)
            await this.add(object, object.id)
            log.debug(`Validated and stored ${object.type} ${shortId(id)}`)
            if (object.type === 'transaction') {
                mempoolManager.addTransaction(object as Transaction)
            }
            else if (object.type === 'block') {
                await chainManager.updateLongestChain(object as Block)
            }
            return false
        } catch (err) {
            const waiters = this.pendingFinds.get(id)
            if (waiters && waiters.length > 0) {
                log.debug(`Rejecting ${waiters.length} waiter(s) for ${shortId(id)}`)
                waiters.forEach(w => w.reject(err as Error))
                this.pendingFinds.delete(id)
            }
            throw err
        } finally {
            this.validating.delete(id)
        }
    }

    async fromMining(block: Block) {
        await this.add(block, block.id)
        await chainManager.updateLongestChain(block)
    }

    async findObject(objectid: Hash): Promise<NetworkObject> {
        try {
            return await this.get(objectid)
        } catch (err: any) { }

        const alreadyFetching = this.pendingFinds.has(objectid)
        if (!alreadyFetching) {
            log.debug(`Fetching ${shortId(objectid)} from network`)
            peerManager.broadcast({
                type: 'getobject',
                objectid,
            })
        }

        return new Promise<NetworkObject>((resolve, reject) => {
            let timer: any

            const entry = {
                resolve: (obj: NetworkObject) => {
                    clearTimeout(timer)
                    log.debug(`Received ${shortId(objectid)} from network`)
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

            const scheduleTimeout = () => {
                timer = setTimeout(() => {
                    if (this.validating.has(objectid)) {
                        scheduleTimeout()
                        return
                    }

                    const arr = this.pendingFinds.get(objectid)
                    if (arr) {
                        const idx = arr.indexOf(entry)
                        if (idx >= 0) arr.splice(idx, 1)
                        if (arr.length === 0) this.pendingFinds.delete(objectid)
                    }

                    log.warn(`Timeout fetching ${shortId(objectid)}`)
                    reject(new ObjectError(ErrorName.UNFINDABLE_OBJECT, `Object ${objectid} not found after ${FIND_OBJECT_TIMEOUT}ms`))
                }, FIND_OBJECT_TIMEOUT)
            }
            scheduleTimeout()
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
