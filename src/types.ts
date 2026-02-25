import { z } from 'zod'
import { matchesVersion, TARGET } from './utils'

export const HashSchema = z.string()

export const SigSchema = z.string()

export const PubKeySchema = z.string().lowercase()

export const OutpointObjectSchema = z.object({
    txid: HashSchema,
    index: z.number().nonnegative(),
})

export const InputObjectSchema = z.object({
    outpoint: OutpointObjectSchema,
    sig: SigSchema
})

export const OutputObjectSchema = z.object({
    pubkey: PubKeySchema,
    value: z.number().nonnegative(),
})

export const NonCoinbaseObjectSchema = z.object({
    type: z.literal('transaction'),
    inputs: z.array(InputObjectSchema).min(1).refine(
        (inputs) => {
            const seen = new Set()
            for (const input of inputs) {
                const key = `${input.outpoint.txid}:${input.outpoint.index}`
                if (seen.has(key)) return false
                seen.add(key)
            }
            return true
        },
        { message: "Inputs must not contain duplicate outpoints" }
    ),
    outputs: z.array(OutputObjectSchema).min(1)
})

export const CoinbaseObjectSchema = z.object({
    type: z.literal('transaction'),
    outputs: z.array(OutputObjectSchema).min(1),
    height: z.number().nonnegative(),
})

export const TransactionObjectSchema = z.union([
    NonCoinbaseObjectSchema,
    CoinbaseObjectSchema,
])

export const BlockObjectSchema = z.object({
    type: z.literal('block'),
    previd: HashSchema.nullable(),
    T: z.string().refine(t => t === TARGET),
    created: z.number().nonnegative(),
    nonce: z.string().max(64),
    txids: z.array(HashSchema),
    miner: z.string().max(128).regex(/^[\x20-\x7E]*$/).optional(),
    note: z.string().max(128).regex(/^[\x20-\x7E]*$/).optional(),
    studentids: z.array(z.string().max(128).regex(/^[\x20-\x7E]*$/)).max(10).optional()
})

export const NetworkObjectSchema = z.union([
    TransactionObjectSchema,
    BlockObjectSchema,
])

export const HelloMessageSchema = z.object({
    type: z.literal('hello'),
    version: z.string().refine(v => matchesVersion(v)),
    agent: z.string().optional()
})

export const GetPeersMessageSchema = z.object({
    type: z.literal('getpeers')
})

export const PeersMessageSchema = z.object({
    type: z.literal('peers'),
    peers: z.array(z.string())
})

export const IHaveObjectMessageSchema = z.object({
    type: z.literal('ihaveobject'),
    objectid: HashSchema
})

export const GetObjectMessageSchema = z.object({
    type: z.literal('getobject'),
    objectid: HashSchema
})

export const ObjectMessageSchema = z.object({
    type: z.literal('object'),
    object: NetworkObjectSchema
})

export const GetChainTipMessageSchema = z.object({
    type: z.literal('getchaintip')
})

export const ChainTipMessageSchema = z.object({
    type: z.literal('chaintip'),
    blockid: HashSchema
})

export const GetMempoolMessageSchema = z.object({
    type: z.literal('getmempool')
})

export const MempoolMessageSchema = z.object({
    type: z.literal('mempool'),
    txids: z.array(HashSchema)
})
export const ErrorMessageSchema = z.object({
    type: z.literal('error'),
    name: z.string(),
    description: z.string()
})

export const MessageSchema = z.discriminatedUnion('type', [
    HelloMessageSchema, GetPeersMessageSchema, PeersMessageSchema,
    IHaveObjectMessageSchema, GetObjectMessageSchema, ObjectMessageSchema,
    GetChainTipMessageSchema, ChainTipMessageSchema, GetMempoolMessageSchema,
    MempoolMessageSchema, ErrorMessageSchema
])

export type Hash = z.infer<typeof HashSchema>
export type Sig = z.infer<typeof SigSchema>
export type PubKey = z.infer<typeof PubKeySchema>
export type OutpointObject = z.infer<typeof OutpointObjectSchema>
export type InputObject = z.infer<typeof InputObjectSchema>
export type OutputObject = z.infer<typeof OutputObjectSchema>
export type NonCoinbaseObject = z.infer<typeof NonCoinbaseObjectSchema>
export type CoinbaseObject = z.infer<typeof CoinbaseObjectSchema>
export type TransactionObject = z.infer<typeof TransactionObjectSchema>
export type BlockObject = z.infer<typeof BlockObjectSchema>
export type NetworkObject = z.infer<typeof NetworkObjectSchema>
export type HelloMessage = z.infer<typeof HelloMessageSchema>
export type GetPeersMessage = z.infer<typeof GetPeersMessageSchema>
export type PeersMessage = z.infer<typeof PeersMessageSchema>
export type IHaveObjectMessage = z.infer<typeof IHaveObjectMessageSchema>
export type GetObjectMessage = z.infer<typeof GetObjectMessageSchema>
export type ObjectMessage = z.infer<typeof ObjectMessageSchema>
export type GetChainTipMessage = z.infer<typeof GetChainTipMessageSchema>
export type ChainTipMessage = z.infer<typeof ChainTipMessageSchema>
export type GetMempoolMessage = z.infer<typeof GetMempoolMessageSchema>
export type MempoolMessage = z.infer<typeof MempoolMessageSchema>
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>
export type Message = z.infer<typeof MessageSchema>
