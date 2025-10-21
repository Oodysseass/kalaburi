import { Level } from 'level'
import canonicalize from 'canonicalize'
import { hash } from './utils'
import { Transaction } from './transaction'
import type { NetworkObject, Hash } from './types'

const db = new Level<Hash, NetworkObject>('./db', { valueEncoding: 'json' })

const fromObject = {
    transaction: Transaction.fromObject,
}

export class ObjectManager {
    id(object: NetworkObject) {
        return hash(canonicalize(object))
    }

    async exists(id: Hash) {
        return await db.has(id)
    }

    async add(object: NetworkObject) {
        const id = this.id(object)
        await db.put(id, object)
    }

    async get(id: Hash) {
        return await db.get(id)
    }

    validate(networkObject: NetworkObject) {
        const transformer = fromObject[networkObject.type]
        const object = transformer(networkObject)
        try {
            return object.validate()
        } catch (err: any) {
            throw err
        }
    }
}

export const objectManager = new ObjectManager()
