export const ErrorName = {
    INVALID_FORMAT: 'INVALID_FORMAT',
    INVALID_GENESIS: 'INVALID_GENESIS',
    INVALID_BLOCK_POW: 'INVALID_BLOCK_POW',
    INVALID_BLOCK_TIMESTAMP: 'INVALID_BLOCK_TIMESTAMP',
    INVALID_BLOCK_COINBASE: 'INVALID_BLOCK_COINBASE',
    INVALID_TX_OUTPOINT: 'INVALID_TX_OUTPOINT',
    INVALID_TX_SIGNATURE: 'INVALID_TX_SIGNATURE',
    INVALID_TX_CONSERVATION: 'INVALID_TX_CONSERVATION',
    UNKNOWN_OBJECT: 'UNKNOWN_OBJECT',
    UNFINDABLE_OBJECT: 'UNFINDABLE_OBJECT'
}

export type ErrorNameType = typeof ErrorName[keyof typeof ErrorName]

export class ProtocolError extends Error {
    type: string

    constructor(name: ErrorNameType, message: string, type: string = 'PROTOCOL_ERROR') {
        super(message)
        this.name = name
        this.type = type
    }
}

export class ValidationError extends ProtocolError {
    constructor(name: ErrorNameType, message: string) {
        super(name, message, 'VALIDATION_ERROR')
    }
}

export class ObjectError extends ProtocolError {
    constructor(name: ErrorNameType, message: string) {
        super(name, message, 'OBJECT_ERROR')
    }
}

export class DependencyError extends Error {
    cause: Error

    constructor(cause: Error) {
        super(cause.message)
        this.cause = cause
        this.name = 'DEPENDENCY_ERROR'
    }
}

export class InternalError extends Error {
    type: string

    constructor(message: string) {
        super(message)
        this.type = 'INTERNAL_ERROR'
        this.name = 'INTERNAL_ERROR'
    }
}
