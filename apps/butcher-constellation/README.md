# Butcher Constellation — Deer Hill Butchers

Order management system for Deer Hill Butchers. Phase 1: in-memory, single operator.

## Quick Start (Local)

**Requirements:** Node.js 18 or higher. No npm install needed — zero external dependencies.

```
node server.js
```

Open `http://localhost:3000` in a browser. That's it.

Rick can access it from another device on the same network using your machine's local IP (e.g. `http://192.168.1.XX:3000`). Find your IP with `ifconfig` (Mac/Linux) or `ipconfig` (Windows).

To use a different port:

```
PORT=8080 node server.js
```

## Running Tests

```
npm test
```

Or directly:

```
node tests/run-all.js
```

612 tests across 8 tiers: bus infrastructure, vault operations, input gates, signal loops, compute, workflows, and end-to-end.

## File Structure

```
constellation.js   — Core system: buses, routing, vaults, loops (4,721 lines)
server.js          — HTTP server, SSE, config seed (655 lines)
dashboard.html     — Operator UI (1,911 lines)
package.json       — Start/test scripts
tests/
  run-all.js       — Test runner
  tier0.test.js    — Bus infrastructure, routing, ledger
  tier1-vault-config.test.js  — Config vault
  tier1-all-vaults.test.js    — All vaults
  tier2-input-gates.test.js   — Input validation
  tier3-signal-loops.test.js  — Signal loops
  tier4-compute.test.js       — Pricing, daily scan, reports
  tier5-workflow.test.js      — Order lifecycle workflows
  tier7-e2e.test.js           — End-to-end scenarios
```

## Important Notes

- **In-memory storage.** All data lives in memory. Restarting the server clears everything. This is Phase 1 — persistence is planned for Phase 2.
- **Single operator.** Designed for Rick as primary operator, Christine as co-operator.
- **No authentication.** Phase 1 runs on a trusted local network. Do not expose to the public internet without adding auth.
