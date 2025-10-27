import { Level } from 'level'
import canonicalize from 'canonicalize'
import { hash } from './utils'
import { Transaction } from './transaction'
import type { NetworkObject, Hash } from './types'

const makeLevelDB = (path: string) =>
    new Level<Hash, NetworkObject>(path, { valueEncoding: 'json' })

const fromObject = {
    transaction: Transaction.fromObject,
}

export class ObjectManager {
    constructor(private db: KV<Hash, NetworkObject> = makeLevelDB('./db')) {}

    id(object: NetworkObject) {
        return hash(canonicalize(object))
    }

    async exists(id: Hash) {
        return await this.db.has(id)
    }

    async add(object: NetworkObject) {
        const id = this.id(object)
        await this.db.put(id, object)
    }

    async get(id: Hash) {
        return await this.db.get(id)
    }

    async validate(networkObject: NetworkObject) {
        const transformer = fromObject[networkObject.type]
        const object = transformer(networkObject)
        await object.validate()
    }
}

export let objectManager = new ObjectManager()
export function _setObjectManagerForTests(om: ObjectManager) { objectManager = om }
type KV<K, V> = {
    has: (key: K) => Promise<boolean>
    get: (key: K) => Promise<V | undefined>
    put: (key: K, value: V) => Promise<void>
}
