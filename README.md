# kalaburi

A full node implementation for [Marabu](https://marabu.dev), a proof-of-work blockchain built for educational purposes that handles payments. Written in TypeScript.

## Features

- Block validation with proof-of-work
- UTXO-based transaction model with Ed25519 signatures
- Peer-to-peer gossip protocol (JSON over TCP)
- Chain reorganization support
- Mempool with double-spend detection
- Multi-threaded mining with fee collection

## Requirements

- [Bun](https://bun.sh) v1.2+

## Quick Start

```bash
# Install dependencies
bun install

# Run in development mode (hot reload)
bun run dev

# Or build and run with Node.js
bun run start
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server listening port | `18018` |
| `MINERS` | Number of mining worker threads (0 to disable) | CPU count |
| `PK` | Public key for mining rewards | — |

## Running a Full Node (no mining)

```bash
MINERS=0 PORT=18018 bun run start
```

## Deployment with pm2

```bash
bun run build
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

Example `ecosystem.config.cjs`:

```js
module.exports = {
  apps: [{
    name: "kalaburi",
    script: "dist/index.js",
    env: {
      PORT: 18018,
      MINERS: 0
    }
  }]
}
```

## Development

```bash
# Run tests
bun test

# Watch mode
bun test --watch

# Run specific test file
bun test tests/pset3.test.ts

# Benchmark hashrate
bun run bench
```

## Protocol

- Version: `0.10.x`
- Default port: `18018`
- Messages: `hello`, `getpeers`, `peers`, `ihaveobject`, `getobject`, `object`, `getchaintip`, `chaintip`, `getmempool`, `mempool`, `error`

## Architecture

```
src/
├── index.ts          # Entry point, TCP server
├── peer.ts           # Per-connection protocol handler
├── peermanager.ts    # Peer discovery and connection management
├── object.ts         # Object storage and retrieval (LevelDB)
├── block.ts          # Block validation and UTXO state
├── transaction.ts    # Transaction validation
├── chain.ts          # Longest chain tracking and reorgs
├── mempool.ts        # Transaction pool
├── miningmanager.ts  # Mining coordination
├── miningworker.ts   # PoW worker thread
├── error.ts          # Error hierarchy
├── types.ts          # Zod schemas and type definitions
├── utils.ts          # Constants and helpers
└── logger.ts         # Structured logging
```
