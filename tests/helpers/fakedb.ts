export class InMemoryDB<K extends string, V> {
    private map = new Map<K, V>()

    async has(key: K): Promise<boolean> {
        return this.map.has(key)
    }

    async get(key: K): Promise<V | undefined> {
        return this.map.get(key)
    }

    async put(key: K, value: V): Promise<void> {
        this.map.set(key, value)
    }
}
