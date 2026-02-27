const colors = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
}

const levelColors: Record<LogLevel, string> = {
    debug: colors.gray,
    info: colors.blue,
    warn: colors.yellow,
    error: colors.red,
}

const levelLabels: Record<LogLevel, string> = {
    debug: 'DBG',
    info: 'INF',
    warn: 'WRN',
    error: 'ERR',
}

const contextColors: Record<string, string> = {
    server: colors.green,
    peers: colors.cyan,
    chain: colors.magenta,
    miner: colors.yellow,
    mempool: colors.blue,
    objects: colors.white,
    tx: colors.gray,
}

function getContextColor(context: string): string {
    if (contextColors[context]) return contextColors[context]
    if (context.includes(':')) return colors.cyan
    return colors.white
}

function getLogLevel(): LogLevel {
    const envLevel = process.env.LOG_LEVEL?.toLowerCase()
    if (envLevel && envLevel in levelPriority) {
        return envLevel as LogLevel
    }
    return 'debug'
}

const currentLogLevel = getLogLevel()

function shouldLog(level: LogLevel): boolean {
    return levelPriority[level] >= levelPriority[currentLogLevel]
}

function timestamp(): string {
    const now = new Date()
    const date = now.toLocaleDateString('en-GB', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    })
    const time = now.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    })
    return `${date} ${time}`
}

function formatValue(value: any, indent: string = '  '): string {
    if (value === null) return `${colors.yellow}null${colors.reset}`
    if (value === undefined) return `${colors.yellow}undefined${colors.reset}`
    if (typeof value !== 'object') return `${colors.yellow}${String(value)}${colors.reset}`

    const MAX_ARRAY_DISPLAY = 20

    const entries = Array.isArray(value)
        ? value.map<[string, any]>((v, i) => [String(i), v])
        : Object.entries(value)

    if (entries.length === 0) {
        return Array.isArray(value) ? '[]' : '{}'
    }

    if (Array.isArray(value) && value.length > MAX_ARRAY_DISPLAY) {
        const shown = entries.slice(0, MAX_ARRAY_DISPLAY).map(
            ([k, v]) => `${indent}${colors.green}${k}${colors.reset} = ${formatValue(v, indent + '  ')}`
        ).join('\n')
        return `{\n${shown}\n${indent}${colors.dim}... and ${value.length - MAX_ARRAY_DISPLAY} more${colors.reset}\n${indent.slice(2)}}`
    }

    const inner = entries.map(
        ([k, v]) => `${indent}${colors.green}${k}${colors.reset} = ${formatValue(v, indent + '  ')}`
    ).join('\n')

    return `{\n${inner}\n${indent.slice(2)}}`
}

function formatObject(obj: any): string {
    if (!obj || typeof obj !== 'object') return ` ${formatValue(obj)}`

    const lines = Object.entries(obj).map(
        ([key, value]) =>
            `  ${colors.green}${key}${colors.reset} = ${formatValue(value, '    ')}`
    )

    return `\n${lines.join('\n')}`
}

function formatMessage(message: any, data?: any): string {
    if (data !== undefined) {
        const prefix = String(message)
        if (data && typeof data === 'object') {
            return `${prefix}${formatObject(data)}`
        }
        return `${prefix} ${colors.dim}${data}${colors.reset}`
    }

    if (message && typeof message === 'object') {
        return formatObject(message)
    }

    return String(message)
}

function log(level: LogLevel, context: string, message: any, data?: any) {
    if (!shouldLog(level)) return

    const time = `${colors.dim}${timestamp()}${colors.reset}`
    const levelStr = `${levelColors[level]}${levelLabels[level]}${colors.reset}`
    const ctxColor = getContextColor(context)
    const ctx = context ? `${ctxColor}[${context}]${colors.reset} ` : ''
    const msg = formatMessage(message, data)

    const output = `${time} ${levelStr} ${ctx}${msg}`

    if (level === 'error') {
        console.error(output)
    } else {
        console.log(output)
    }
}

export class Logger {
    context: string

    constructor(context: string = '') {
        this.context = context
    }

    debug(message: any, data?: any) {
        log('debug', this.context, message, data)
    }

    info(message: any, data?: any) {
        log('info', this.context, message, data)
    }

    warn(message: any, data?: any) {
        log('warn', this.context, message, data)
    }

    error(message: any, data?: any) {
        log('error', this.context, message, data)
    }
}

export function shortId(id: string, len: number = 12): string {
    return id.length > len ? `${id.slice(0, len)}...` : id
}
