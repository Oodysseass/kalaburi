import { Level } from 'level'
import canonicalize from 'canonicalize'
import { hash } from './utils'

export const db = new Level<string, any>('./db', {
    valueEncoding: 'json'
})

class ObjectManager {
    id(object: any) {
        return hash(canonicalize(object))
    }

    async exists(id: string) {
        return typeof await db.get(id) !== 'undefined'
    }

    async add(object: any) {
        const id = this.id(object)
        await db.put(id, object)
    }

    async get(id: string) {
        return await db.get(id)
    }

    validateTransaction(object: any) {
        return true
    }
}

export const objectManager = new ObjectManager()
