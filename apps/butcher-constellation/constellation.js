// ╔══════════════════════════════════════════════════════════════════════╗
// ║  BUTCHER CONSTELLATION — constellation.js                          ║
// ║  System logic: loops, buses, routing, ledger, capabilities.        ║
// ║  Zero external imports. All external access via injected caps.     ║
// ║  FBD-4: This file contains zero require() or import statements.   ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

// ────────────────────────────────────────────────────────────────────
// SECTION 0: INLINE UTILITIES
// No imports allowed. Everything the constellation needs is here
// or injected via capabilities.
// ────────────────────────────────────────────────────────────────────

/**
 * Generate a UUID v4 (random). Not cryptographically secure —
 * adequate for packet IDs and trace IDs in a ~100 orders/season system.
 * Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 */
function generateId() {
  const hex = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      id += '-';
    } else if (i === 14) {
      id += '4';
    } else if (i === 19) {
      id += hex[(Math.random() * 4 | 0) + 8];
    } else {
      id += hex[Math.random() * 16 | 0];
    }
  }
  return id;
}

/**
 * Current ISO 8601 timestamp.
 */
function now() {
  return new Date().toISOString();
}

/**
 * Deep freeze an object. Used for routing table entries and
 * capability sets — once declared, they cannot be mutated.
 */
function deepFreeze(obj) {
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}


// ────────────────────────────────────────────────────────────────────
// SECTION 1: PACKET HEADER
// Every packet in the constellation carries this header.
// Ref: PCR v1 V3, Common Header.
// ────────────────────────────────────────────────────────────────────

/**
 * Create a packet with validated header fields.
 * @param {string} packetType - e.g. 'INTAKE_RAW', 'WRITE_ORDER_CREATE'
 * @param {object} payload    - packet-specific fields (per PCR contract)
 * @param {object} [opts]     - optional overrides: { traceId, source }
 * @returns {object} Complete packet with header + payload
 */
function createPacket(packetType, payload, opts) {
  if (!packetType || typeof packetType !== 'string') {
    throw new Error('[constellation] Cannot create packet: packetType is required and must be a string');
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error(`[constellation] Cannot create packet ${packetType}: payload must be an object`);
  }

  return {
    packetId:   generateId(),
    packetType: packetType,
    timestamp:  now(),
    traceId:    (opts && opts.traceId) || generateId(),
    source:     (opts && opts.source) || null,
    payload:    payload
  };
}


// ────────────────────────────────────────────────────────────────────
// SECTION 2: EVENT LEDGER
// Append-only log of all bus traffic. Every packet emission is
// recorded with bus, timestamp, source, destination(s), and status.
// Queryable by traceId to reconstruct a packet's full journey.
// ────────────────────────────────────────────────────────────────────

function createLedger() {
  const entries = [];

  return {
    /**
     * Record a bus emission.
     * @param {object} record - { bus, packet, source, destinations, status }
     */
    record(record) {
      entries.push({
        ledgerId:     generateId(),
        recordedAt:   now(),
        bus:          record.bus,
        packetId:     record.packet.packetId,
        packetType:   record.packet.packetType,
        traceId:      record.packet.traceId,
        source:       record.source,
        destinations: record.destinations || [],
        status:       record.status || 'delivered'
      });
    },

    /**
     * Query ledger by traceId — reconstruct a packet's full journey.
     * @param {string} traceId
     * @returns {object[]} All ledger entries for this trace
     */
    queryByTraceId(traceId) {
      return entries.filter(e => e.traceId === traceId);
    },

    /**
     * Query ledger by packetType.
     * @param {string} packetType
     * @returns {object[]}
     */
    queryByPacketType(packetType) {
      return entries.filter(e => e.packetType === packetType);
    },

    /**
     * Total entry count (diagnostic).
     */
    count() {
      return entries.length;
    },

    /**
     * Get all entries (diagnostic — use sparingly).
     */
    all() {
      return entries.slice();
    }
  };
}


// ────────────────────────────────────────────────────────────────────
// SECTION 3: ROUTING TABLE
// Declares every legal data path. Packets can only reach declared
// subscribers. Unrouted packets are rejected.
// Ref: Constellation Spec §12 (96 entries). Routing Tables §1–§6.
// Entry numbers are post-renumbering per §12.
// ────────────────────────────────────────────────────────────────────

function createRoutingTable() {
  // Map: packetType → { bus, entries[] }
  // Each entry: { entryNumber, source, destinations[], mode, priority }
  const routes = new Map();

  return {
    /**
     * Register a routing entry.
     * @param {object} entry - { entryNumber, packetType, source, bus, destinations, mode, priority }
     */
    register(entry) {
      if (!entry.packetType || !entry.source || !entry.bus) {
        throw new Error(`[routing] Cannot register entry: packetType, source, and bus are required`);
      }
      if (!entry.destinations || !Array.isArray(entry.destinations) || entry.destinations.length === 0) {
        throw new Error(`[routing] Cannot register entry #${entry.entryNumber} (${entry.packetType}): destinations must be a non-empty array`);
      }

      const key = `${entry.packetType}:${entry.source}`;
      if (!routes.has(key)) {
        routes.set(key, []);
      }
      routes.get(key).push(deepFreeze({
        entryNumber:  entry.entryNumber,
        packetType:   entry.packetType,
        source:       entry.source,
        bus:          entry.bus,
        destinations: entry.destinations.slice(),
        mode:         entry.mode || 'Push',
        priority:     entry.priority || 'STANDARD'
      }));
    },

    /**
     * Resolve routing for a packet from a source.
     * Returns the matching route entries, or throws if unrouted.
     * @param {string} packetType
     * @param {string} source - the loop emitting the packet
     * @returns {object[]} Matching route entries
     */
    resolve(packetType, source) {
      const key = `${packetType}:${source}`;
      const matched = routes.get(key);
      if (!matched || matched.length === 0) {
        throw new Error(`[routing] Unrouted packet: ${packetType} from ${source}. No matching routing entry.`);
      }
      return matched;
    },

    /**
     * Check if a route exists (non-throwing).
     */
    has(packetType, source) {
      const key = `${packetType}:${source}`;
      const matched = routes.get(key);
      return matched && matched.length > 0;
    },

    /**
     * Total registered entries (diagnostic).
     */
    count() {
      let total = 0;
      for (const entries of routes.values()) {
        total += entries.length;
      }
      return total;
    }
  };
}


// ────────────────────────────────────────────────────────────────────
// SECTION 4: BUS IMPLEMENTATIONS
// Four buses: DATA, VAULT, SIGNAL, SYNC.
// Ref: Constellation Spec §3.
//
// DATA:   Publish-subscribe. Publisher declares, routing table
//         specifies subscribers. Asynchronous delivery.
// VAULT:  Request-response for pulls. Fire-and-confirm for writes.
// SIGNAL: Command-result. Command enters on SIGNAL, result on DATA.
// SYNC:   No V1 traffic. Declared and initialized.
// ────────────────────────────────────────────────────────────────────

/**
 * Create a bus instance.
 * @param {string} name        - 'DATA', 'VAULT', 'SIGNAL', or 'SYNC'
 * @param {object} routingTable - the shared routing table
 * @param {object} ledger       - the shared event ledger
 */
function createBus(name, routingTable, ledger) {
  // Subscriber registry: loopName → handler function
  const subscribers = new Map();

  return {
    name: name,

    /**
     * Register a loop as a subscriber on this bus.
     * @param {string} loopName - e.g. 'vault:orders'
     * @param {function} handler - receives (packet) when routed to this loop
     */
    subscribe(loopName, handler) {
      if (typeof handler !== 'function') {
        throw new Error(`[bus:${name}] Cannot subscribe ${loopName}: handler must be a function`);
      }
      subscribers.set(loopName, handler);
    },

    /**
     * Emit a packet onto this bus from a source loop.
     * Routing table determines destinations. Unrouted packets are rejected.
     * @param {string} source - the loop emitting the packet
     * @param {object} packet - a packet created by createPacket()
     */
    emit(source, packet) {
      if (!packet || !packet.packetType) {
        throw new Error(`[bus:${name}] Cannot emit from ${source}: invalid packet (missing packetType)`);
      }

      // Resolve routing
      let routeEntries;
      try {
        routeEntries = routingTable.resolve(packet.packetType, source);
      } catch (err) {
        ledger.record({
          bus: name,
          packet: packet,
          source: source,
          destinations: [],
          status: 'rejected:unrouted'
        });
        throw err;
      }

      // Verify this packet belongs on this bus
      const entry = routeEntries[0];
      if (entry.bus !== name) {
        const msg = `[bus:${name}] Cannot emit ${packet.packetType} from ${source}: packet is routed to bus ${entry.bus}, not ${name}`;
        ledger.record({
          bus: name,
          packet: packet,
          source: source,
          destinations: [],
          status: 'rejected:wrong_bus'
        });
        throw new Error(msg);
      }

      // Deliver to routed destinations
      const delivered = [];
      const missing = [];

      for (const re of routeEntries) {
        for (const dest of re.destinations) {
          const handler = subscribers.get(dest);
          if (handler) {
            try {
              handler(packet);
              delivered.push(dest);
            } catch (handlerErr) {
              // Subscriber errors are logged, not propagated to emitter
              ledger.record({
                bus: name,
                packet: packet,
                source: source,
                destinations: [dest],
                status: `error:subscriber:${handlerErr.message}`
              });
              delivered.push(dest); // Still counts as delivery attempt
            }
          } else {
            missing.push(dest);
          }
        }
      }

      // Record successful emission
      ledger.record({
        bus: name,
        packet: packet,
        source: source,
        destinations: delivered,
        status: missing.length > 0
          ? `delivered:partial (missing: ${missing.join(', ')})`
          : 'delivered'
      });

      return { delivered, missing };
    },

    /**
     * Request-response pattern (VAULT bus pulls).
     * Emits to a single destination and returns the handler's return value.
     * @param {string} source   - the loop making the request
     * @param {object} packet   - the request packet
     * @returns {*} The handler's return value (the response)
     */
    request(source, packet) {
      if (name !== 'VAULT') {
        throw new Error(`[bus:${name}] request() is only available on the VAULT bus`);
      }
      if (!packet || !packet.packetType) {
        throw new Error(`[bus:${name}] Cannot request from ${source}: invalid packet`);
      }

      let routeEntries;
      try {
        routeEntries = routingTable.resolve(packet.packetType, source);
      } catch (err) {
        ledger.record({
          bus: name,
          packet: packet,
          source: source,
          destinations: [],
          status: 'rejected:unrouted'
        });
        throw err;
      }

      const entry = routeEntries[0];
      if (entry.bus !== name) {
        throw new Error(`[bus:${name}] Cannot request ${packet.packetType}: routed to bus ${entry.bus}`);
      }

      // Pull requests go to exactly one destination
      const dest = entry.destinations[0];
      const handler = subscribers.get(dest);
      if (!handler) {
        ledger.record({
          bus: name,
          packet: packet,
          source: source,
          destinations: [dest],
          status: 'error:destination_not_registered'
        });
        throw new Error(`[bus:${name}] Cannot request ${packet.packetType} from ${source}: destination ${dest} is not registered`);
      }

      let result;
      try {
        result = handler(packet);
      } catch (handlerErr) {
        ledger.record({
          bus: name,
          packet: packet,
          source: source,
          destinations: [dest],
          status: `error:handler:${handlerErr.message}`
        });
        throw handlerErr;
      }

      ledger.record({
        bus: name,
        packet: packet,
        source: source,
        destinations: [dest],
        status: 'delivered:request_response'
      });

      return result;
    },

    /**
     * Check if a loop is subscribed to this bus (diagnostic).
     */
    hasSubscriber(loopName) {
      return subscribers.has(loopName);
    },

    /**
     * Count of subscribers (diagnostic).
     */
    subscriberCount() {
      return subscribers.size;
    }
  };
}


// ────────────────────────────────────────────────────────────────────
// SECTION 5: CAPABILITY FRAMEWORK
// Each loop receives exactly its permitted capabilities.
// Ref: Constellation Spec §6.
//
// Standard capabilities:
//   bus      — all loops (pre-filtered per bus assignment)
//   db       — Vault Loops only
//   services — Signal Loops only
//   document — Presentation Loops only
//
// The closure wall: a loop without `db` cannot access the database
// because the capability does not exist in its scope.
// ────────────────────────────────────────────────────────────────────

/**
 * Bus assignment table. Declares which buses each loop can subscribe
 * to and publish on. Source: Constellation Spec §2 topology table.
 *
 * Format: { subscribe: string[], publish: string[] }
 * These are bus NAMES, not packet types.
 */
const BUS_ASSIGNMENTS = {
  'working:orderIntake':       { subscribe: [],                          publish: ['DATA'] },
  'working:paymentWebhook':    { subscribe: [],                          publish: ['DATA'] },
  'filter:orderValidation':    { subscribe: ['DATA'],                    publish: ['DATA'] },
  'compute:pricing':           { subscribe: ['DATA', 'VAULT'],           publish: ['DATA'] },
  'compute:dailyScan':         { subscribe: ['DATA', 'VAULT'],           publish: ['DATA', 'VAULT'] },
  'compute:reports':           { subscribe: ['DATA', 'VAULT'],           publish: ['DATA', 'VAULT'] },
  'vault:orders':              { subscribe: ['VAULT'],                    publish: ['DATA'] },
  'vault:customers':           { subscribe: ['VAULT'],                    publish: ['DATA'] },
  'vault:config':              { subscribe: ['VAULT'],                    publish: ['DATA'] },
  'vault:snapshots':           { subscribe: ['VAULT'],                    publish: ['DATA'] },
  'signal:payments':           { subscribe: ['SIGNAL'],                  publish: ['DATA'] },
  'signal:notifications':      { subscribe: ['SIGNAL'],                  publish: ['DATA'] },
  'workflow:orderLifecycle':   { subscribe: ['DATA', 'VAULT', 'SIGNAL'], publish: ['DATA', 'VAULT', 'SIGNAL'] },
  'workflow:notifications':    { subscribe: ['DATA', 'VAULT', 'SIGNAL'], publish: ['DATA', 'VAULT', 'SIGNAL'] },
  'presentation:dashboard':    { subscribe: ['DATA', 'VAULT'],           publish: ['DATA', 'SYNC'] },
  'presentation:customerIntake': { subscribe: ['VAULT'],                 publish: [] }
};

/**
 * Standard capability type per loop type.
 * Ref: Constellation Spec §6.
 */
const LOOP_TYPE_CAPABILITIES = {
  'working':      ['bus', 'gateway'],
  'filter':       ['bus'],
  'compute':      ['bus'],
  'vault':        ['bus', 'db'],
  'signal':       ['bus', 'services'],
  'workflow':     ['bus'],
  'presentation': ['bus', 'document']
};

/**
 * Build the capability set for a loop.
 * Returns a frozen object containing only the permitted capabilities.
 *
 * @param {string} loopName   - e.g. 'vault:orders'
 * @param {object} buses      - { DATA, VAULT, SIGNAL, SYNC }
 * @param {object} externalCaps - { db, services, gateway, document } from server.js
 * @returns {object} The loop's capability set
 */
function buildCapabilities(loopName, buses, externalCaps) {
  const loopType = loopName.split(':')[0];
  const allowedCaps = LOOP_TYPE_CAPABILITIES[loopType];
  if (!allowedCaps) {
    throw new Error(`[capability] Unknown loop type for ${loopName}`);
  }

  const assignment = BUS_ASSIGNMENTS[loopName];
  if (!assignment) {
    throw new Error(`[capability] No bus assignment declared for ${loopName}`);
  }

  // Build filtered bus interface
  const busCap = {
    /**
     * Emit a packet onto a bus.
     * Pre-filtered: only buses in this loop's publish set are accessible.
     */
    emit(busName, packet) {
      if (!assignment.publish.includes(busName)) {
        throw new Error(`[${loopName}] Cannot publish to ${busName}: not in declared publish set [${assignment.publish.join(', ')}]`);
      }
      const bus = buses[busName];
      if (!bus) {
        throw new Error(`[${loopName}] Bus ${busName} does not exist`);
      }
      return bus.emit(loopName, packet);
    },

    /**
     * Request-response on VAULT bus.
     * Pre-filtered: only available if VAULT is in subscribe set.
     */
    request(packet) {
      if (!assignment.subscribe.includes('VAULT')) {
        throw new Error(`[${loopName}] Cannot request on VAULT: not in declared subscribe set`);
      }
      return buses.VAULT.request(loopName, packet);
    }
  };

  const caps = { bus: busCap };

  // Inject external capabilities per loop type
  if (allowedCaps.includes('db') && externalCaps.db) {
    // db capability is per-vault — server provides a db adapter per vault loop
    const dbForLoop = externalCaps.db[loopName];
    if (dbForLoop) {
      caps.db = dbForLoop;
    }
  }

  if (allowedCaps.includes('services') && externalCaps.services) {
    const svcForLoop = externalCaps.services[loopName];
    if (svcForLoop) {
      caps.services = svcForLoop;
    }
  }

  if (allowedCaps.includes('document') && externalCaps.document) {
    caps.document = externalCaps.document;
  }

  // Gateway capability — per working loop, inbound verification tools (FBD-5)
  if (allowedCaps.includes('gateway') && externalCaps.gateway) {
    const gwForLoop = externalCaps.gateway[loopName];
    if (gwForLoop) {
      caps.gateway = gwForLoop;
    }
  }

  return deepFreeze(caps);
}


// ────────────────────────────────────────────────────────────────────
// SECTION 6: LOOP REGISTRY
// Loops are registered by name. Each loop is a factory function
// that receives its capability set and returns a handle.
// ────────────────────────────────────────────────────────────────────

function createLoopRegistry() {
  const factories = new Map();  // loopName → factory function
  const instances = new Map();  // loopName → instantiated loop handle

  return {
    /**
     * Register a loop factory.
     * @param {string} loopName - e.g. 'vault:orders'
     * @param {function} factory - receives (capabilities) → returns handle
     */
    registerFactory(loopName, factory) {
      if (factories.has(loopName)) {
        throw new Error(`[registry] Loop ${loopName} is already registered`);
      }
      if (typeof factory !== 'function') {
        throw new Error(`[registry] Factory for ${loopName} must be a function`);
      }
      factories.set(loopName, factory);
    },

    /**
     * Instantiate all registered loops with their capabilities.
     * @param {object} buses       - { DATA, VAULT, SIGNAL, SYNC }
     * @param {object} externalCaps - from server.js
     */
    instantiateAll(buses, externalCaps) {
      for (const [loopName, factory] of factories) {
        const caps = buildCapabilities(loopName, buses, externalCaps);
        const handle = factory(caps);
        instances.set(loopName, handle);

        // Auto-subscribe loop to its declared buses
        const assignment = BUS_ASSIGNMENTS[loopName];
        if (handle.onPacket) {
          for (const busName of assignment.subscribe) {
            const bus = buses[busName];
            if (bus) {
              bus.subscribe(loopName, handle.onPacket);
            }
          }
        }
      }
    },

    /**
     * Get an instantiated loop handle (diagnostic).
     */
    get(loopName) {
      return instances.get(loopName);
    },

    /**
     * Count of registered factories.
     */
    factoryCount() {
      return factories.size;
    },

    /**
     * Count of instantiated loops.
     */
    instanceCount() {
      return instances.size;
    }
  };
}


// ────────────────────────────────────────────────────────────────────
// SECTION 7: LOOP IMPLEMENTATIONS — VAULT LOOPS
// Each loop is a factory function: (capabilities) → handle.
// Handle must expose onPacket(packet) for bus subscription.
// ────────────────────────────────────────────────────────────────────

// ── vault:config ──────────────────────────────────────────────────
// Config record persistence. Singleton record, overwrite-in-place.
// No retention stages (§8: N/A for config).
// Ref: Constellation Spec §2, PCR OP-019 (FETCH_CONFIG),
//      PCR OP-070/OP-092 (WRITE_CONFIG_UPDATE, CONFIG_UPDATED/FAILED).
// Record schema: Pass 2a Config Record.

function createVaultConfig(caps) {
  const LOOP = 'vault:config';

  // In-memory config state. Seeded by server.js via db adapter,
  // or initialized empty. db adapter is the persistence layer.
  let configRecord = null;
  let version = 0;

  // Load initial state from db adapter
  if (caps.db) {
    const stored = caps.db.read('config');
    if (stored) {
      configRecord = stored.data;
      version = stored.version || 1;
    }
  }

  /**
   * Handle FETCH_CONFIG — return config data.
   * Supports optional configKeys filter (§5 extension).
   */
  function handleFetchConfig(packet) {
    if (!configRecord) {
      return { config: null, version: 0 };
    }

    const keys = packet.payload.configKeys;
    if (keys && Array.isArray(keys) && keys.length > 0) {
      // Return only requested sections
      const filtered = {};
      for (const key of keys) {
        if (configRecord[key] !== undefined) {
          filtered[key] = configRecord[key];
        }
      }
      return { config: filtered, version: version };
    }

    // Return full config
    return { config: configRecord, version: version };
  }

  /**
   * Handle WRITE_CONFIG_UPDATE — update config, emit confirmation.
   * Uses configKey + updatePath for targeted updates.
   */
  function handleWriteConfigUpdate(packet) {
    const { configKey, updatePath, value } = packet.payload;

    if (!configKey || !updatePath) {
      // Emit failure
      const failPacket = createPacket('CONFIG_UPDATE_FAILED', {
        configKey:     configKey || 'unknown',
        updatePath:    updatePath || 'unknown',
        failureReason: 'Missing configKey or updatePath'
      }, { traceId: packet.traceId, source: LOOP });

      try { caps.bus.emit('DATA', failPacket); } catch (e) {
        // Routing may not be registered yet — log but don't crash
      }
      return;
    }

    // Navigate to the config key
    if (!configRecord) {
      configRecord = {};
    }

    // Capture previous value for audit
    let previousValue = undefined;
    const keyParts = configKey.split('.');
    let target = configRecord;

    // Navigate to parent of the target field
    for (let i = 0; i < keyParts.length; i++) {
      if (target[keyParts[i]] === undefined) {
        target[keyParts[i]] = {};
      }
      target = target[keyParts[i]];
    }

    previousValue = target[updatePath];
    target[updatePath] = value;
    version++;

    // Persist via db adapter
    if (caps.db) {
      try {
        caps.db.write('config', { data: configRecord, version: version });
      } catch (dbErr) {
        // Rollback in-memory
        target[updatePath] = previousValue;
        version--;

        const failPacket = createPacket('CONFIG_UPDATE_FAILED', {
          configKey:     configKey,
          updatePath:    updatePath,
          failureReason: `[${LOOP}] Database write failed: ${dbErr.message}`
        }, { traceId: packet.traceId, source: LOOP });

        try { caps.bus.emit('DATA', failPacket); } catch (e) { /* routing gap */ }
        return;
      }
    }

    // Emit confirmation on DATA
    const confirmPacket = createPacket('CONFIG_UPDATED', {
      configKey:     configKey,
      updatePath:    updatePath,
      previousValue: previousValue !== undefined ? previousValue : null,
      newValue:      value
    }, { traceId: packet.traceId, source: LOOP });

    try { caps.bus.emit('DATA', confirmPacket); } catch (e) {
      // Routing not registered — write succeeded, confirmation undeliverable
    }
  }

  /**
   * Packet handler — dispatches by packetType.
   * Called by both VAULT bus emit (writes) and request (pulls).
   */
  function onPacket(packet) {
    switch (packet.packetType) {
      case 'FETCH_CONFIG':
        return handleFetchConfig(packet);

      case 'WRITE_CONFIG_UPDATE':
        handleWriteConfigUpdate(packet);
        return;

      default:
        throw new Error(`[${LOOP}] Unknown packet type: ${packet.packetType}`);
    }
  }

  return {
    onPacket: onPacket,

    // Diagnostic/testing interface
    getVersion()    { return version; },
    getConfig()     { return configRecord; },

    /**
     * Seed config data (used by server.js for initial setup).
     * Does NOT emit CONFIG_UPDATED — this is a bootstrap operation.
     */
    seed(data) {
      configRecord = data;
      version = 1;
      if (caps.db) {
        caps.db.write('config', { data: configRecord, version: version });
      }
    }
  };
}


// ────────────────────────────────────────────────────────────────────
// SECTION 8: ROUTING ENTRIES — VAULT:CONFIG
// Registered during init. Post-renumbering entry numbers per §12.
// ────────────────────────────────────────────────────────────────────

function registerVaultConfigRoutes(routing) {
  // §1 #21 — FETCH_CONFIG (declare, compute:pricing → vault:config)
  routing.register({
    entryNumber: 21, packetType: 'FETCH_CONFIG',
    source: 'compute:pricing', bus: 'VAULT',
    destinations: ['vault:config'], mode: 'Pull', priority: 'STANDARD'
  });

  // §4 #55 — FETCH_CONFIG (reuse, workflow:notifications → vault:config)
  routing.register({
    entryNumber: 55, packetType: 'FETCH_CONFIG',
    source: 'workflow:notifications', bus: 'VAULT',
    destinations: ['vault:config'], mode: 'Pull', priority: 'STANDARD'
  });

  // §5 #66 — FETCH_CONFIG (reuse, compute:dailyScan → vault:config)
  routing.register({
    entryNumber: 66, packetType: 'FETCH_CONFIG',
    source: 'compute:dailyScan', bus: 'VAULT',
    destinations: ['vault:config'], mode: 'Pull', priority: 'STANDARD'
  });

  // §5 #73 — WRITE_CONFIG_UPDATE (declare, compute:dailyScan → vault:config)
  routing.register({
    entryNumber: 73, packetType: 'WRITE_CONFIG_UPDATE',
    source: 'compute:dailyScan', bus: 'VAULT',
    destinations: ['vault:config'], mode: 'Push', priority: 'STANDARD'
  });

  // §5 #74 — CONFIG_UPDATED (declare, vault:config → presentation:dashboard)
  routing.register({
    entryNumber: 74, packetType: 'CONFIG_UPDATED',
    source: 'vault:config', bus: 'DATA',
    destinations: ['presentation:dashboard'], mode: 'Push', priority: 'STANDARD'
  });

  // §5 #75 — CONFIG_UPDATE_FAILED (declare, vault:config → compute:dailyScan, presentation:dashboard)
  routing.register({
    entryNumber: 75, packetType: 'CONFIG_UPDATE_FAILED',
    source: 'vault:config', bus: 'DATA',
    destinations: ['compute:dailyScan', 'presentation:dashboard'], mode: 'Push', priority: 'CRITICAL'
  });

  // §5 #84 — FETCH_CONFIG (reuse, compute:reports → vault:config)
  routing.register({
    entryNumber: 84, packetType: 'FETCH_CONFIG',
    source: 'compute:reports', bus: 'VAULT',
    destinations: ['vault:config'], mode: 'Pull', priority: 'STANDARD'
  });

  // §6 #89 — FETCH_CONFIG (reuse, presentation:dashboard → vault:config)
  routing.register({
    entryNumber: 89, packetType: 'FETCH_CONFIG',
    source: 'presentation:dashboard', bus: 'VAULT',
    destinations: ['vault:config'], mode: 'Pull', priority: 'STANDARD'
  });

  // §6 #96 — WRITE_CONFIG_UPDATE (reuse, workflow:orderLifecycle → vault:config)
  routing.register({
    entryNumber: 96, packetType: 'WRITE_CONFIG_UPDATE',
    source: 'workflow:orderLifecycle', bus: 'VAULT',
    destinations: ['vault:config'], mode: 'Push', priority: 'STANDARD'
  });
}


// ── vault:customers ───────────────────────────────────────────────
// Customer record persistence. Lookup by field, batch with filters.
// Ref: PCR OP-005 (FETCH_CUSTOMER), OP-059 (FETCH_CUSTOMERS),
//      OP-009 (WRITE_CUSTOMER_CREATE), OP-088 (WRITE_CUSTOMER_UPDATE).
// Record schema: Pass 2a Customer Record.

function createVaultCustomers(caps) {
  const LOOP = 'vault:customers';
  const customers = new Map(); // customerId → record

  // Load from db
  if (caps.db) {
    const stored = caps.db.read('customers_index');
    if (stored) {
      for (const [id, rec] of Object.entries(stored)) {
        customers.set(id, rec);
      }
    }
  }

  function persist() {
    if (caps.db) {
      const obj = {};
      for (const [id, rec] of customers) { obj[id] = rec; }
      caps.db.write('customers_index', obj);
    }
  }

  function handleFetchCustomer(packet) {
    const { lookupBy, lookupValue } = packet.payload;
    for (const rec of customers.values()) {
      if (rec[lookupBy] === lookupValue) {
        return { found: true, customer: rec };
      }
    }
    return { found: false, customer: null };
  }

  function handleFetchCustomers(packet) {
    const { filter, searchQuery } = packet.payload;
    let results = Array.from(customers.values());

    if (filter) {
      if (filter.marketingOptIn !== undefined) {
        results = results.filter(c => c.marketingOptIn === filter.marketingOptIn);
      }
      if (filter.hasCompletedOrder !== undefined) {
        results = results.filter(c =>
          filter.hasCompletedOrder
            ? (c.orderHistory && c.orderHistory.length > 0)
            : (!c.orderHistory || c.orderHistory.length === 0)
        );
      }
    }

    if (searchQuery && typeof searchQuery === 'string') {
      const q = searchQuery.toLowerCase();
      results = results.filter(c =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q))
      );
    }

    return { customers: results };
  }

  function handleWriteCustomerCreate(packet) {
    const p = packet.payload;

    if (customers.has(p.customerId)) {
      const fail = createPacket('CUSTOMER_CREATE_FAILED', {
        failureReason: 'DUPLICATE_CUSTOMER',
        failureDetail: `Customer ${p.customerId} already exists`,
        customerId: p.customerId
      }, { traceId: packet.traceId, source: LOOP });
      try { caps.bus.emit('DATA', fail); } catch (e) { /* routing gap */ }
      return;
    }

    const record = {
      customerId: p.customerId,
      name: p.name,
      phone: p.phone || null,
      email: p.email || null,
      textOptIn: p.textOptIn || false,
      emailOptIn: p.emailOptIn || false,
      marketingOptIn: p.marketingOptIn || false,
      depositWaiverStatus: p.depositWaiverStatus || false,
      preferredChannel: p.preferredChannel || null,
      previousCutPreferences: null,
      orderHistory: [],
      createdAt: now(),
      updatedAt: now()
    };

    customers.set(p.customerId, record);
    persist();

    const confirm = createPacket('CUSTOMER_CREATED', {
      customerId: p.customerId,
      name: p.name,
      createdAt: record.createdAt
    }, { traceId: packet.traceId, source: LOOP });
    try { caps.bus.emit('DATA', confirm); } catch (e) { /* routing gap */ }
  }

  function handleWriteCustomerUpdate(packet) {
    const { customerId, updates } = packet.payload;
    const existing = customers.get(customerId);

    if (!existing) {
      const fail = createPacket('CUSTOMER_UPDATE_FAILED', {
        customerId: customerId,
        failureReason: 'NOT_FOUND',
        failureDetail: `Customer ${customerId} not found`
      }, { traceId: packet.traceId, source: LOOP });
      try { caps.bus.emit('DATA', fail); } catch (e) { /* routing gap */ }
      return;
    }

    const previousState = Object.assign({}, existing);
    Object.assign(existing, updates, { updatedAt: now() });
    persist();

    const confirm = createPacket('CUSTOMER_UPDATED', {
      customerId: customerId,
      updatedFields: Object.keys(updates)
    }, { traceId: packet.traceId, source: LOOP });
    try { caps.bus.emit('DATA', confirm); } catch (e) { /* routing gap */ }
  }

  function onPacket(packet) {
    switch (packet.packetType) {
      case 'FETCH_CUSTOMER':        return handleFetchCustomer(packet);
      case 'FETCH_CUSTOMERS':       return handleFetchCustomers(packet);
      case 'WRITE_CUSTOMER_CREATE': return handleWriteCustomerCreate(packet);
      case 'WRITE_CUSTOMER_UPDATE': return handleWriteCustomerUpdate(packet);
      default: throw new Error(`[${LOOP}] Unknown packet type: ${packet.packetType}`);
    }
  }

  return {
    onPacket,
    getCustomer(id) { return customers.get(id) || null; },
    count() { return customers.size; }
  };
}


// ── vault:orders ──────────────────────────────────────────────────
// Order record persistence. Optimistic concurrency via version field.
// Ref: PCR OP-006 (WRITE_ORDER_CREATE), OP-022 (WRITE_ORDER_UPDATE),
//      OP-030 (FETCH_ORDER), OP-062 (FETCH_ORDERS).
// Record schema: Pass 2a Order Record.

function createVaultOrders(caps) {
  const LOOP = 'vault:orders';
  const orders = new Map(); // orderId → record

  if (caps.db) {
    const stored = caps.db.read('orders_index');
    if (stored) {
      for (const [id, rec] of Object.entries(stored)) {
        orders.set(id, rec);
      }
    }
  }

  function persist() {
    if (caps.db) {
      const obj = {};
      for (const [id, rec] of orders) { obj[id] = rec; }
      caps.db.write('orders_index', obj);
    }
  }

  function handleFetchOrder(packet) {
    const { orderId, lookupBy, lookupValue } = packet.payload;
    if (orderId) {
      const rec = orders.get(orderId);
      return rec ? { found: true, order: rec } : { found: false, order: null };
    }
    // Alternate lookup (e.g., by stripeChargeId)
    if (lookupBy && lookupValue) {
      for (const rec of orders.values()) {
        const field = rec[lookupBy];
        // Support array fields (e.g., stripeChargeIds: ['ch_1', 'ch_2'])
        if (Array.isArray(field) ? field.includes(lookupValue) : field === lookupValue) {
          return { found: true, order: rec };
        }
      }
    }
    return { found: false, order: null };
  }

  function handleFetchOrders(packet) {
    const { stageFilter, dateRange, searchQuery } = packet.payload;
    let results = Array.from(orders.values());

    if (stageFilter && Array.isArray(stageFilter)) {
      results = results.filter(o => stageFilter.includes(o.stage));
    }
    if (dateRange) {
      if (dateRange.from) {
        results = results.filter(o => o.createdAt >= dateRange.from);
      }
      if (dateRange.to) {
        results = results.filter(o => o.createdAt <= dateRange.to);
      }
    }
    if (searchQuery && typeof searchQuery === 'string') {
      const q = searchQuery.toLowerCase();
      results = results.filter(o =>
        (o.customerName && o.customerName.toLowerCase().includes(q)) ||
        (o.tagNumber && o.tagNumber.toLowerCase().includes(q))
      );
    }

    return { orders: results };
  }

  function handleWriteOrderCreate(packet) {
    const p = packet.payload;

    if (orders.has(p.orderId)) {
      const fail = createPacket('ORDER_CREATE_FAILED', {
        orderId: p.orderId, tagNumber: p.tagNumber || '',
        customerId: p.customerId || '',
        failureReason: 'DUPLICATE_ORDER',
        failureDetail: `Order ${p.orderId} already exists`
      }, { traceId: packet.traceId, source: LOOP });
      try { caps.bus.emit('DATA', fail); } catch (e) { /* routing gap */ }
      return;
    }

    const record = Object.assign({}, p, {
      version: 1,
      createdAt: now(),
      updatedAt: now()
    });

    orders.set(p.orderId, record);
    persist();

    const confirm = createPacket('ORDER_CREATED', {
      orderId: p.orderId,
      customerId: p.customerId,
      stage: p.stage,
      intakeSource: p.intakeSource,
      depositWaived: p.depositWaived || false,
      selfServiceLinkId: p.selfServiceLinkId || null,
      createdAt: record.createdAt,
      version: 1
    }, { traceId: packet.traceId, source: LOOP });
    try { caps.bus.emit('DATA', confirm); } catch (e) { /* routing gap */ }
  }

  function handleWriteOrderUpdate(packet) {
    const { orderId, updates, expectedVersion } = packet.payload;
    const existing = orders.get(orderId);

    if (!existing) {
      const fail = createPacket('ORDER_UPDATE_FAILED', {
        orderId: orderId,
        failureReason: 'NOT_FOUND',
        failureDetail: `Order ${orderId} not found`
      }, { traceId: packet.traceId, source: LOOP });
      try { caps.bus.emit('DATA', fail); } catch (e) { /* routing gap */ }
      return;
    }

    // Optimistic concurrency check
    if (expectedVersion !== undefined && expectedVersion !== existing.version) {
      const fail = createPacket('ORDER_UPDATE_FAILED', {
        orderId: orderId,
        failureReason: 'VERSION_CONFLICT',
        failureDetail: `Expected version ${expectedVersion}, actual ${existing.version}`
      }, { traceId: packet.traceId, source: LOOP });
      try { caps.bus.emit('DATA', fail); } catch (e) { /* routing gap */ }
      return;
    }

    const previousVersion = existing.version;
    Object.assign(existing, updates, {
      version: existing.version + 1,
      updatedAt: now()
    });
    persist();

    const confirm = createPacket('ORDER_UPDATED', {
      orderId: orderId,
      version: existing.version,
      updatedFields: Object.keys(updates)
    }, { traceId: packet.traceId, source: LOOP });
    try { caps.bus.emit('DATA', confirm); } catch (e) { /* routing gap */ }
  }

  function onPacket(packet) {
    switch (packet.packetType) {
      case 'FETCH_ORDER':         return handleFetchOrder(packet);
      case 'FETCH_ORDERS':        return handleFetchOrders(packet);
      case 'WRITE_ORDER_CREATE':  return handleWriteOrderCreate(packet);
      case 'WRITE_ORDER_UPDATE':  return handleWriteOrderUpdate(packet);
      default: throw new Error(`[${LOOP}] Unknown packet type: ${packet.packetType}`);
    }
  }

  return {
    onPacket,
    getOrder(id) { return orders.get(id) || null; },
    count() { return orders.size; }
  };
}


// ── vault:snapshots ───────────────────────────────────────────────
// Append-only persistence. Audit records and snapshots.
// No update or delete — append-only by design.
// Ref: PCR OP-011 (WRITE_AUDIT), OP-075 (STORE_SNAPSHOT/SNAPSHOT_STORED),
//      OP-084 (FETCH_SNAPSHOTS).
// Record schema: Pass 2a Snapshot Record.

function createVaultSnapshots(caps) {
  const LOOP = 'vault:snapshots';
  const snapshots = []; // append-only array

  function handleFetchSnapshots(packet) {
    const { snapshotType, dateRange, auditType, orderId } = packet.payload;
    let results = snapshots.slice();

    if (snapshotType) {
      results = results.filter(s => s.snapshotType === snapshotType);
    }
    if (auditType) {
      results = results.filter(s => s.auditType === auditType);
    }
    if (orderId) {
      results = results.filter(s => s.orderId === orderId);
    }
    if (dateRange) {
      if (dateRange.from) results = results.filter(s => s.createdAt >= dateRange.from);
      if (dateRange.to) results = results.filter(s => s.createdAt <= dateRange.to);
    }

    return { snapshots: results };
  }

  function handleWriteAudit(packet) {
    const p = packet.payload;
    const record = Object.assign({}, p, {
      snapshotId: generateId(),
      snapshotType: 'audit',
      createdAt: now()
    });

    snapshots.push(record);
    if (caps.db) {
      caps.db.write('snapshot_' + record.snapshotId, record);
    }
    // WRITE_AUDIT does not emit a separate confirmation per PCR —
    // the audit trail is the side effect. No AUDIT_STORED packet exists.
  }

  function handleStoreSnapshot(packet) {
    const p = packet.payload;
    const record = Object.assign({}, p, {
      snapshotId: generateId(),
      createdAt: now()
    });

    snapshots.push(record);
    if (caps.db) {
      caps.db.write('snapshot_' + record.snapshotId, record);
    }

    const confirm = createPacket('SNAPSHOT_STORED', {
      snapshotId: record.snapshotId,
      snapshotType: p.snapshotType,
      storedAt: record.createdAt
    }, { traceId: packet.traceId, source: LOOP });
    try { caps.bus.emit('DATA', confirm); } catch (e) { /* routing gap */ }
  }

  function onPacket(packet) {
    switch (packet.packetType) {
      case 'FETCH_SNAPSHOTS':  return handleFetchSnapshots(packet);
      case 'WRITE_AUDIT':      return handleWriteAudit(packet);
      case 'STORE_SNAPSHOT':   return handleStoreSnapshot(packet);
      default: throw new Error(`[${LOOP}] Unknown packet type: ${packet.packetType}`);
    }
  }

  return {
    onPacket,
    count() { return snapshots.length; },
    all() { return snapshots.slice(); }
  };
}


// ────────────────────────────────────────────────────────────────────
// SECTION 8b: ROUTING ENTRIES — VAULT:CUSTOMERS
// ────────────────────────────────────────────────────────────────────

function registerVaultCustomersRoutes(routing) {
  // §1 #5 — FETCH_CUSTOMER (declare, workflow:orderLifecycle → vault:customers)
  routing.register({ entryNumber: 5, packetType: 'FETCH_CUSTOMER',
    source: 'workflow:orderLifecycle', bus: 'VAULT',
    destinations: ['vault:customers'], mode: 'Pull', priority: 'STANDARD' });

  // §4 #53 — FETCH_CUSTOMER (reuse, workflow:notifications → vault:customers)
  routing.register({ entryNumber: 53, packetType: 'FETCH_CUSTOMER',
    source: 'workflow:notifications', bus: 'VAULT',
    destinations: ['vault:customers'], mode: 'Pull', priority: 'STANDARD' });

  // §1 #9 — WRITE_CUSTOMER_CREATE (declare, workflow:orderLifecycle → vault:customers)
  routing.register({ entryNumber: 9, packetType: 'WRITE_CUSTOMER_CREATE',
    source: 'workflow:orderLifecycle', bus: 'VAULT',
    destinations: ['vault:customers'], mode: 'Push', priority: 'STANDARD' });

  // §1 #10 — CUSTOMER_CREATED (declare, vault:customers → workflow:orderLifecycle, presentation:dashboard)
  routing.register({ entryNumber: 10, packetType: 'CUSTOMER_CREATED',
    source: 'vault:customers', bus: 'DATA',
    destinations: ['workflow:orderLifecycle', 'presentation:dashboard'], mode: 'Push', priority: 'STANDARD' });

  // §1 #11 — CUSTOMER_CREATE_FAILED (declare, vault:customers → workflow:orderLifecycle)
  routing.register({ entryNumber: 11, packetType: 'CUSTOMER_CREATE_FAILED',
    source: 'vault:customers', bus: 'DATA',
    destinations: ['workflow:orderLifecycle'], mode: 'Push', priority: 'STANDARD' });

  // §4 #61 — FETCH_CUSTOMERS (declare, workflow:notifications → vault:customers)
  routing.register({ entryNumber: 61, packetType: 'FETCH_CUSTOMERS',
    source: 'workflow:notifications', bus: 'VAULT',
    destinations: ['vault:customers'], mode: 'Pull', priority: 'STANDARD' });

  // §5 #79 — FETCH_CUSTOMERS (reuse, compute:reports → vault:customers)
  routing.register({ entryNumber: 79, packetType: 'FETCH_CUSTOMERS',
    source: 'compute:reports', bus: 'VAULT',
    destinations: ['vault:customers'], mode: 'Pull', priority: 'STANDARD' });

  // §6 #88 — FETCH_CUSTOMERS (reuse, presentation:dashboard → vault:customers)
  routing.register({ entryNumber: 88, packetType: 'FETCH_CUSTOMERS',
    source: 'presentation:dashboard', bus: 'VAULT',
    destinations: ['vault:customers'], mode: 'Pull', priority: 'STANDARD' });

  // §6 #92 — WRITE_CUSTOMER_UPDATE (declare, workflow:orderLifecycle → vault:customers)
  routing.register({ entryNumber: 92, packetType: 'WRITE_CUSTOMER_UPDATE',
    source: 'workflow:orderLifecycle', bus: 'VAULT',
    destinations: ['vault:customers'], mode: 'Push', priority: 'STANDARD' });

  // §6 #93 — CUSTOMER_UPDATED (declare, vault:customers → presentation:dashboard, workflow:notifications)
  routing.register({ entryNumber: 93, packetType: 'CUSTOMER_UPDATED',
    source: 'vault:customers', bus: 'DATA',
    destinations: ['presentation:dashboard', 'workflow:notifications'], mode: 'Push', priority: 'STANDARD' });

  // §6 #94 — CUSTOMER_UPDATE_FAILED (declare, vault:customers → workflow:orderLifecycle, presentation:dashboard)
  routing.register({ entryNumber: 94, packetType: 'CUSTOMER_UPDATE_FAILED',
    source: 'vault:customers', bus: 'DATA',
    destinations: ['workflow:orderLifecycle', 'presentation:dashboard'], mode: 'Push', priority: 'STANDARD' });
}


// ────────────────────────────────────────────────────────────────────
// SECTION 8c: ROUTING ENTRIES — VAULT:ORDERS
// ────────────────────────────────────────────────────────────────────

function registerVaultOrdersRoutes(routing) {
  // §1 #6 — WRITE_ORDER_CREATE (declare, workflow:orderLifecycle → vault:orders)
  routing.register({ entryNumber: 6, packetType: 'WRITE_ORDER_CREATE',
    source: 'workflow:orderLifecycle', bus: 'VAULT',
    destinations: ['vault:orders'], mode: 'Push', priority: 'STANDARD' });

  // §1 #7 — ORDER_CREATED (declare, vault:orders → workflow:orderLifecycle, workflow:notifications, presentation:dashboard)
  routing.register({ entryNumber: 7, packetType: 'ORDER_CREATED',
    source: 'vault:orders', bus: 'DATA',
    destinations: ['workflow:orderLifecycle', 'workflow:notifications', 'presentation:dashboard'], mode: 'Push', priority: 'STANDARD' });

  // §1 #8 — ORDER_CREATE_FAILED (declare, vault:orders → workflow:orderLifecycle, presentation:dashboard)
  routing.register({ entryNumber: 8, packetType: 'ORDER_CREATE_FAILED',
    source: 'vault:orders', bus: 'DATA',
    destinations: ['workflow:orderLifecycle', 'presentation:dashboard'], mode: 'Push', priority: 'CRITICAL' });

  // §1 #24 — WRITE_ORDER_UPDATE (declare, workflow:orderLifecycle → vault:orders)
  routing.register({ entryNumber: 24, packetType: 'WRITE_ORDER_UPDATE',
    source: 'workflow:orderLifecycle', bus: 'VAULT',
    destinations: ['vault:orders'], mode: 'Push', priority: 'STANDARD' });

  // §1 #25 — ORDER_UPDATED (declare, vault:orders → workflow:orderLifecycle, presentation:dashboard, workflow:notifications)
  routing.register({ entryNumber: 25, packetType: 'ORDER_UPDATED',
    source: 'vault:orders', bus: 'DATA',
    destinations: ['workflow:orderLifecycle', 'presentation:dashboard', 'workflow:notifications'], mode: 'Push', priority: 'STANDARD' });

  // §1 #26 — ORDER_UPDATE_FAILED (declare, vault:orders → workflow:orderLifecycle, presentation:dashboard)
  routing.register({ entryNumber: 26, packetType: 'ORDER_UPDATE_FAILED',
    source: 'vault:orders', bus: 'DATA',
    destinations: ['workflow:orderLifecycle', 'presentation:dashboard'], mode: 'Push', priority: 'CRITICAL' });

  // §2 #32 — FETCH_ORDER (declare, workflow:orderLifecycle → vault:orders)
  routing.register({ entryNumber: 32, packetType: 'FETCH_ORDER',
    source: 'workflow:orderLifecycle', bus: 'VAULT',
    destinations: ['vault:orders'], mode: 'Pull', priority: 'STANDARD' });

  // §5 #65 — FETCH_ORDERS (declare, compute:dailyScan → vault:orders)
  routing.register({ entryNumber: 65, packetType: 'FETCH_ORDERS',
    source: 'compute:dailyScan', bus: 'VAULT',
    destinations: ['vault:orders'], mode: 'Pull', priority: 'STANDARD' });

  // §5 #78 — FETCH_ORDERS (reuse, compute:reports → vault:orders)
  routing.register({ entryNumber: 78, packetType: 'FETCH_ORDERS',
    source: 'compute:reports', bus: 'VAULT',
    destinations: ['vault:orders'], mode: 'Pull', priority: 'STANDARD' });

  // §5 #71 — WRITE_ORDER_UPDATE (reuse, workflow:notifications → vault:orders)
  routing.register({ entryNumber: 71, packetType: 'WRITE_ORDER_UPDATE',
    source: 'workflow:notifications', bus: 'VAULT',
    destinations: ['vault:orders'], mode: 'Push', priority: 'STANDARD' });

  // §6 #87 — FETCH_ORDERS (reuse, presentation:dashboard → vault:orders)
  routing.register({ entryNumber: 87, packetType: 'FETCH_ORDERS',
    source: 'presentation:dashboard', bus: 'VAULT',
    destinations: ['vault:orders'], mode: 'Pull', priority: 'STANDARD' });
}


// ────────────────────────────────────────────────────────────────────
// SECTION 8d: ROUTING ENTRIES — VAULT:SNAPSHOTS
// ────────────────────────────────────────────────────────────────────

function registerVaultSnapshotsRoutes(routing) {
  // §1 #12 — WRITE_AUDIT (declare, workflow:orderLifecycle → vault:snapshots)
  routing.register({ entryNumber: 12, packetType: 'WRITE_AUDIT',
    source: 'workflow:orderLifecycle', bus: 'VAULT',
    destinations: ['vault:snapshots'], mode: 'Push', priority: 'STANDARD' });

  // §5 #80 — STORE_SNAPSHOT (declare, compute:reports → vault:snapshots)
  routing.register({ entryNumber: 80, packetType: 'STORE_SNAPSHOT',
    source: 'compute:reports', bus: 'VAULT',
    destinations: ['vault:snapshots'], mode: 'Push', priority: 'STANDARD' });

  // §5 #81 — SNAPSHOT_STORED (declare, vault:snapshots → compute:reports, presentation:dashboard)
  routing.register({ entryNumber: 81, packetType: 'SNAPSHOT_STORED',
    source: 'vault:snapshots', bus: 'DATA',
    destinations: ['compute:reports', 'presentation:dashboard'], mode: 'Push', priority: 'STANDARD' });

  // §6 #90 — FETCH_SNAPSHOTS (declare, presentation:dashboard → vault:snapshots)
  routing.register({ entryNumber: 90, packetType: 'FETCH_SNAPSHOTS',
    source: 'presentation:dashboard', bus: 'VAULT',
    destinations: ['vault:snapshots'], mode: 'Pull', priority: 'STANDARD' });
}


// ────────────────────────────────────────────────────────────────────
// SECTION 10: LOOP IMPLEMENTATIONS — WORKING LOOPS
// Working loops sit on the constellation's external boundary.
// subscribe: [] — they receive input from outside the bus system.
// publish: ['DATA'] — they emit validated input onto the bus.
// FBD-5: Both loops require a gateway capability at startup.
// Ref: Gateway Capability Decision v1.
// ────────────────────────────────────────────────────────────────────

// ── working:orderIntake ─────────────────────────────────────────────
// HTTP endpoint for customer form submissions and Clock triggers.
// Structural validation via gateway adapter. Emits INTAKE_RAW,
// CUTS_RAW, or clock trigger packets onto DATA bus.
// Ref: PCR OP-001 (INTAKE_RAW), OP-025 (CUTS_RAW),
//      Routing table §1 #1, #25.

function createWorkingOrderIntake(caps) {
  const LOOP = 'working:orderIntake';

  // FBD-5: gateway required at startup
  if (!caps.gateway) {
    throw new Error(`[${LOOP}] Cannot start: no gateway capability provided`);
  }

  const gateway = caps.gateway;

  // ── Required fields by submission type ──
  const INTAKE_REQUIRED = ['customerName', 'textOptIn', 'emailOptIn',
    'tagNumber', 'animalType', 'tenderloinRemoved'];
  const CUTS_REQUIRED = ['orderId', 'selfServiceLinkId', 'cutSelections'];

  /**
   * Validate structural integrity of a submission.
   * Checks: required fields present, correct types.
   * This is the "is this a string" check — the filter does pattern matching.
   * @param {object} body - raw HTTP POST body
   * @returns {{ valid: boolean, errors: string[] }}
   */
  function structuralValidation(body) {
    const errors = [];

    if (!body || typeof body !== 'object') {
      return { valid: false, errors: ['Payload must be an object'] };
    }

    // Determine submission type: CUTS if orderId present, INTAKE otherwise
    const isCuts = body.orderId !== undefined;
    const required = isCuts ? CUTS_REQUIRED : INTAKE_REQUIRED;

    for (const field of required) {
      if (body[field] === undefined || body[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Type checks for intake
    if (!isCuts) {
      if (body.customerName !== undefined && typeof body.customerName !== 'string') {
        errors.push('customerName must be a string');
      }
      if (body.customerName && body.customerName.length > 200) {
        errors.push('customerName exceeds 200 character limit');
      }
      if (body.textOptIn !== undefined && typeof body.textOptIn !== 'boolean') {
        errors.push('textOptIn must be a boolean');
      }
      if (body.emailOptIn !== undefined && typeof body.emailOptIn !== 'boolean') {
        errors.push('emailOptIn must be a boolean');
      }
      if (body.tagNumber !== undefined && typeof body.tagNumber !== 'string') {
        errors.push('tagNumber must be a string');
      }
      if (body.animalType !== undefined && typeof body.animalType !== 'string') {
        errors.push('animalType must be a string');
      }
      if (body.tenderloinRemoved !== undefined && typeof body.tenderloinRemoved !== 'boolean') {
        errors.push('tenderloinRemoved must be a boolean');
      }
      if (body.hangingWeightLbs !== undefined && typeof body.hangingWeightLbs !== 'number') {
        errors.push('hangingWeightLbs must be a number');
      }
      if (typeof body.hangingWeightLbs === 'number' && body.hangingWeightLbs <= 0) {
        errors.push('hangingWeightLbs must be > 0');
      }
      // Consent cross-checks
      if (body.textOptIn === true && !body.customerPhone) {
        errors.push('customerPhone required when textOptIn is true');
      }
      if (body.emailOptIn === true && !body.customerEmail) {
        errors.push('customerEmail required when emailOptIn is true');
      }
    }

    // Type checks for cuts
    if (isCuts) {
      if (typeof body.orderId !== 'string') {
        errors.push('orderId must be a string');
      }
      if (typeof body.selfServiceLinkId !== 'string') {
        errors.push('selfServiceLinkId must be a string');
      }
      if (body.cutSelections !== undefined && typeof body.cutSelections !== 'object') {
        errors.push('cutSelections must be an object');
      }
    }

    return { valid: errors.length === 0, errors: errors };
  }

  /**
   * Handle an HTTP POST submission.
   * Structural validation → gateway schema validation → emit packet.
   * @param {object} body - parsed HTTP POST body
   * @returns {{ status: number, packetType: string|null, errors: string[]|null }}
   */
  function handleSubmission(body) {
    // Structural validation (type checks, required fields)
    const structural = structuralValidation(body);
    if (!structural.valid) {
      return { status: 400, packetType: null, errors: structural.errors };
    }

    // Gateway schema validation (field-level rules from server.js)
    const schema = gateway.validateSubmission(body);
    if (!schema.valid) {
      return { status: 400, packetType: null, errors: schema.errors };
    }

    // Determine packet type and emit
    const isCuts = body.orderId !== undefined;
    const packetType = isCuts ? 'CUTS_RAW' : 'INTAKE_RAW';

    const packet = createPacket(packetType, body, { source: LOOP });
    caps.bus.emit('DATA', packet);

    return { status: 202, packetType: packetType, errors: null };
  }

  /**
   * Handle a Clock trigger payload.
   * Tags with operator: 'system:clock' and emits the appropriate
   * trigger packet onto the DATA bus.
   * @param {object} payload - clock schedule payload
   * @returns {{ packetType: string }}
   */
  function handleClockTrigger(payload) {
    if (!payload || !payload.triggerType) {
      throw new Error(`[${LOOP}] Clock trigger missing triggerType`);
    }

    const CLOCK_TRIGGERS = {
      'daily_overdue_scan':  'DAILY_SCAN_TRIGGERED',
      'daily_snapshot':      'SNAPSHOT_TRIGGERED',
      'seasonal_snapshot':   'SNAPSHOT_TRIGGERED',
      'retention_sweep':     'RETENTION_SWEEP_TRIGGERED'
    };

    const packetType = CLOCK_TRIGGERS[payload.triggerType];
    if (!packetType) {
      throw new Error(`[${LOOP}] Unknown clock trigger type: ${payload.triggerType}`);
    }

    const clockPayload = Object.assign({}, payload, { operator: 'system:clock' });
    const packet = createPacket(packetType, clockPayload, { source: LOOP });
    caps.bus.emit('DATA', packet);

    return { packetType: packetType };
  }

  // Working loops have no onPacket — they don't subscribe to buses.
  // Server.js accesses the handle via registry.get() after start().
  return {
    handleSubmission: handleSubmission,
    handleClockTrigger: handleClockTrigger
  };
}


// ── working:paymentWebhook ──────────────────────────────────────────
// Stripe webhook endpoint. Signature verification via gateway adapter,
// idempotency deduplication, payload normalization.
// Ref: PCR OP-046 (PAYMENT_EVENT, WEBHOOK_REJECTED),
//      Routing table §3 #48, #50.

function createWorkingPaymentWebhook(caps) {
  const LOOP = 'working:paymentWebhook';

  // FBD-5: gateway required at startup
  if (!caps.gateway) {
    throw new Error(`[${LOOP}] Cannot start: no gateway capability provided`);
  }

  const gateway = caps.gateway;

  // Deduplication: processed Stripe event IDs.
  // In-memory for V1. Stripe may retry delivery — reject duplicates.
  const processedEventIds = new Set();

  /**
   * Handle an incoming Stripe webhook.
   * Pipeline: verify signature → dedup → normalize → emit.
   * @param {object} body       - raw webhook body (parsed JSON)
   * @param {string} signature  - Stripe-Signature header value
   * @returns {{ status: number, packetType: string }}
   */
  function handleWebhook(body, signature) {
    // Step 1: Signature verification via gateway (FBD-5)
    const sigResult = gateway.verifySignature(body, signature);
    if (!sigResult.valid) {
      const rejectPacket = createPacket('WEBHOOK_REJECTED', {
        stripeEventId: (body && body.id) || null,
        rejectionReason: 'SIGNATURE_INVALID',
        rejectionDetail: sigResult.reason || 'Stripe signature verification failed',
        receivedAt: now()
      }, { source: LOOP });
      caps.bus.emit('DATA', rejectPacket);
      return { status: 401, packetType: 'WEBHOOK_REJECTED' };
    }

    // Step 2: Parse and validate payload structure
    if (!body || !body.id || !body.type) {
      const rejectPacket = createPacket('WEBHOOK_REJECTED', {
        stripeEventId: null,
        rejectionReason: 'MALFORMED_PAYLOAD',
        rejectionDetail: 'Webhook body missing id or type',
        receivedAt: now()
      }, { source: LOOP });
      caps.bus.emit('DATA', rejectPacket);
      return { status: 400, packetType: 'WEBHOOK_REJECTED' };
    }

    // Step 3: Deduplication by stripeEventId
    if (processedEventIds.has(body.id)) {
      const rejectPacket = createPacket('WEBHOOK_REJECTED', {
        stripeEventId: body.id,
        rejectionReason: 'DUPLICATE_EVENT',
        rejectionDetail: `Event ${body.id} already processed`,
        receivedAt: now()
      }, { source: LOOP });
      caps.bus.emit('DATA', rejectPacket);
      return { status: 200, packetType: 'WEBHOOK_REJECTED' };
    }

    // Step 4: Normalize and emit PAYMENT_EVENT
    processedEventIds.add(body.id);

    const normalized = {
      stripeEventId: body.id,
      stripeEventType: body.type,
      relatedChargeId: (body.data && body.data.object && body.data.object.charge) || null,
      relatedCustomerId: (body.data && body.data.object && body.data.object.customer) || null,
      eventData: (body.data && body.data.object) || {},
      receivedAt: now()
    };

    const packet = createPacket('PAYMENT_EVENT', normalized, { source: LOOP });
    caps.bus.emit('DATA', packet);

    return { status: 200, packetType: 'PAYMENT_EVENT' };
  }

  /**
   * Get count of processed event IDs (diagnostic).
   */
  function processedCount() {
    return processedEventIds.size;
  }

  return {
    handleWebhook: handleWebhook,
    processedCount: processedCount
  };
}


// ────────────────────────────────────────────────────────────────────
// SECTION 11: LOOP IMPLEMENTATIONS — FILTER LOOPS
// Filters subscribe to DATA bus, apply pattern-matching rules,
// and emit validated or rejected packets.
// ────────────────────────────────────────────────────────────────────

// ── filter:orderValidation ──────────────────────────────────────────
// Subscribes to INTAKE_RAW and CUTS_RAW on DATA bus.
// Pattern-matching validation (format checks, enum checks).
// Emits INTAKE_VALIDATED / INTAKE_REJECTED or
//       CUTS_VALIDATED / CUTS_REJECTED.
// Does NOT access vaults — business validation is in compute:pricing.
// Ref: PCR OP-001 (intake validation), OP-025 (cuts validation),
//      Routing table §1 #1–3, #25–27.

function createFilterOrderValidation(caps) {
  const LOOP = 'filter:orderValidation';

  // ── Validation patterns ──

  // Phone: E.164 (+12075551234) or North American (207-555-1234, (207) 555-1234, 2075551234)
  const PHONE_PATTERN = /^(\+[1-9]\d{1,14}|\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})$/;

  // Basic email: something@something.something
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Maine hunting tag: two-letter state code, dash, four-digit year,
  // dash, 1-6 digit sequence. e.g. ME-2025-1234
  const TAG_PATTERN = /^[A-Z]{2}-\d{4}-\d{1,6}$/;

  // Valid animal types (extensible enum)
  const VALID_ANIMAL_TYPES = ['deer', 'moose', 'bear', 'pig'];

  /**
   * Validate an INTAKE_RAW packet.
   * Format-level checks on fields the working loop already verified as present.
   * @param {object} payload - INTAKE_RAW payload
   * @returns {{ valid: boolean, reasons: string[], detail: string }}
   */
  function validateIntake(payload) {
    const reasons = [];

    // Phone format (only if provided)
    if (payload.customerPhone && !PHONE_PATTERN.test(payload.customerPhone)) {
      reasons.push('INVALID_PHONE_FORMAT');
    }

    // Email format (only if provided)
    if (payload.customerEmail && !EMAIL_PATTERN.test(payload.customerEmail)) {
      reasons.push('INVALID_EMAIL_FORMAT');
    }

    // Tag number format
    if (payload.tagNumber && !TAG_PATTERN.test(payload.tagNumber)) {
      reasons.push('INVALID_TAG_FORMAT');
    }

    // Animal type enum check
    if (payload.animalType && !VALID_ANIMAL_TYPES.includes(payload.animalType)) {
      reasons.push('UNKNOWN_ANIMAL_TYPE');
    }

    // Consent cross-validation: if textOptIn and phone is present, phone must be valid
    if (payload.textOptIn === true && payload.customerPhone && !PHONE_PATTERN.test(payload.customerPhone)) {
      // Already captured as INVALID_PHONE_FORMAT — no duplicate
    }

    // Consent cross-validation: if emailOptIn and email is present, email must be valid
    if (payload.emailOptIn === true && payload.customerEmail && !EMAIL_PATTERN.test(payload.customerEmail)) {
      // Already captured as INVALID_EMAIL_FORMAT — no duplicate
    }

    const detail = reasons.length > 0
      ? `Validation failed: ${reasons.join(', ')}`
      : '';

    return { valid: reasons.length === 0, reasons: reasons, detail: detail };
  }

  /**
   * Validate a CUTS_RAW packet.
   * Same pattern-matching checks applicable to cuts submissions.
   * @param {object} payload - CUTS_RAW payload
   * @returns {{ valid: boolean, reasons: string[], detail: string }}
   */
  function validateCuts(payload) {
    const reasons = [];

    // cutSelections must be a non-empty object
    if (!payload.cutSelections || typeof payload.cutSelections !== 'object' ||
        Object.keys(payload.cutSelections).length === 0) {
      reasons.push('EMPTY_CUT_SELECTIONS');
    }

    const detail = reasons.length > 0
      ? `Cuts validation failed: ${reasons.join(', ')}`
      : '';

    return { valid: reasons.length === 0, reasons: reasons, detail: detail };
  }

  /**
   * onPacket handler — receives all DATA bus traffic this loop subscribes to.
   * Routes to the appropriate validator based on packet type.
   */
  function onPacket(packet) {
    if (packet.packetType === 'INTAKE_RAW') {
      const result = validateIntake(packet.payload);

      if (result.valid) {
        // Pass through unchanged — validation is pass/fail, not transformation
        const validated = createPacket('INTAKE_VALIDATED', packet.payload,
          { traceId: packet.traceId, source: LOOP });
        caps.bus.emit('DATA', validated);
      } else {
        const rejected = createPacket('INTAKE_REJECTED', {
          rejectionReasons: result.reasons,
          rejectionDetail: result.detail,
          originalSubmission: packet.payload
        }, { traceId: packet.traceId, source: LOOP });
        caps.bus.emit('DATA', rejected);
      }
    }

    else if (packet.packetType === 'CUTS_RAW') {
      const result = validateCuts(packet.payload);

      if (result.valid) {
        const validated = createPacket('CUTS_VALIDATED', packet.payload,
          { traceId: packet.traceId, source: LOOP });
        caps.bus.emit('DATA', validated);
      } else {
        const rejected = createPacket('CUTS_REJECTED', {
          orderId: packet.payload.orderId,
          rejectionReasons: result.reasons,
          rejectionDetail: result.detail,
          originalSubmission: packet.payload
        }, { traceId: packet.traceId, source: LOOP });
        caps.bus.emit('DATA', rejected);
      }
    }

    // Ignore other packet types — filter only processes intake and cuts
  }

  return {
    onPacket: onPacket
  };
}


// ────────────────────────────────────────────────────────────────────
// SECTION 12: LOOP IMPLEMENTATIONS — SIGNAL LOOPS
// Signal loops sit on the constellation's outbound boundary.
// subscribe: ['SIGNAL'] — they receive commands from workflows.
// publish: ['DATA'] — they emit results back to the constellation.
// Dependency Gates are injected via `services` capability.
// Ref: Constellation Spec §2, §3.
// ────────────────────────────────────────────────────────────────────

// ── signal:payments ─────────────────────────────────────────────────
// Stripe integration. Receives CHARGE_* commands on SIGNAL bus,
// calls Stripe API through Dependency Gate, emits *_CHARGED or
// *_FAILED on DATA bus. Circuit breaker for service degradation.
// Ref: PCR OP-012 (deposit), OP-037 (balance), OP-040 (storage),
//      OP-043 (no-show), OP-049 (service degradation).
//      Routing table §1 #12–14, §3 #39–52.

function createSignalPayments(caps) {
  const LOOP = 'signal:payments';

  // Circuit breaker state
  const FAILURE_THRESHOLD = 3;
  let consecutiveFailures = 0;
  let isDegraded = false;
  let lastSuccessAt = null;
  let queuedChargeCount = 0;

  // Charge type mapping: command → { success, failure }
  const CHARGE_MAP = {
    'CHARGE_DEPOSIT':        { success: 'DEPOSIT_CHARGED',        failure: 'DEPOSIT_FAILED' },
    'CHARGE_BALANCE':        { success: 'BALANCE_CHARGED',        failure: 'BALANCE_FAILED' },
    'CHARGE_STORAGE_FEE':    { success: 'STORAGE_FEE_CHARGED',    failure: 'STORAGE_FEE_FAILED' },
    'CHARGE_NOSHOW_BALANCE': { success: 'NOSHOW_BALANCE_CHARGED', failure: 'NOSHOW_BALANCE_FAILED' }
  };

  /**
   * Handle a charge command. Calls the Dependency Gate and emits result.
   * @param {object} packet - CHARGE_* command packet
   */
  function handleCharge(packet) {
    const mapping = CHARGE_MAP[packet.packetType];
    if (!mapping) return; // Not a charge command

    const payload = packet.payload;

    // Call Dependency Gate
    let chargeResult;
    try {
      if (caps.services && caps.services.charge) {
        chargeResult = caps.services.charge({
          amountCents:     payload.amountCents,
          currency:        payload.currency,
          customerId:      payload.stripeCustomerId || payload.customerIdStripe,
          paymentMethodId: payload.paymentMethodId,
          description:     payload.description,
          idempotencyKey:  payload.idempotencyKey
        });
      } else {
        // No Dependency Gate — stub mode, auto-succeed
        chargeResult = {
          success: true,
          chargeId: 'ch_stub_' + generateId().substring(0, 8),
          chargedAt: now()
        };
      }
    } catch (err) {
      chargeResult = {
        success: false,
        reason: 'STRIPE_ERROR',
        detail: err.message || 'Dependency Gate threw'
      };
    }

    if (chargeResult.success) {
      // Success path
      consecutiveFailures = 0;
      lastSuccessAt = now();

      // Restore service if previously degraded
      if (isDegraded) {
        isDegraded = false;
        const restoredPkt = createPacket('PAYMENT_SERVICE_RESTORED', {
          service: 'stripe',
          restoredAt: now(),
          failedChargesRetried: queuedChargeCount
        }, { traceId: packet.traceId, source: LOOP });
        caps.bus.emit('DATA', restoredPkt);
        queuedChargeCount = 0;
      }

      // Build success payload — echo common fields + charge-specific
      const successPayload = {
        orderId:       payload.orderId,
        stripeChargeId: chargeResult.chargeId,
        amountCents:   payload.amountCents,
        chargedAt:     chargeResult.chargedAt
      };

      // Echo type-specific fields
      if (payload.stripeCustomerId) successPayload.stripeCustomerId = payload.stripeCustomerId;
      if (payload.storageWeekNumber) successPayload.storageWeekNumber = payload.storageWeekNumber;

      const successPkt = createPacket(mapping.success, successPayload,
        { traceId: packet.traceId, source: LOOP });
      caps.bus.emit('DATA', successPkt);

    } else {
      // Failure path
      consecutiveFailures++;

      // Circuit breaker check
      if (consecutiveFailures >= FAILURE_THRESHOLD && !isDegraded) {
        isDegraded = true;
        const degradedPkt = createPacket('PAYMENT_SERVICE_DEGRADED', {
          service: 'stripe',
          detectedAt: now(),
          lastSuccessAt: lastSuccessAt,
          failureCount: consecutiveFailures,
          queuedChargeCount: queuedChargeCount
        }, { traceId: packet.traceId, source: LOOP });
        caps.bus.emit('DATA', degradedPkt);
      }

      if (isDegraded) queuedChargeCount++;

      const failPayload = {
        orderId:       payload.orderId,
        amountCents:   payload.amountCents,
        failureReason: chargeResult.reason || 'STRIPE_ERROR',
        failureDetail: chargeResult.detail || null
      };

      if (payload.stripeErrorCode) failPayload.stripeErrorCode = chargeResult.stripeErrorCode;
      if (payload.storageWeekNumber) failPayload.storageWeekNumber = payload.storageWeekNumber;

      const failPkt = createPacket(mapping.failure, failPayload,
        { traceId: packet.traceId, source: LOOP });
      caps.bus.emit('DATA', failPkt);
    }
  }

  function onPacket(packet) {
    if (CHARGE_MAP[packet.packetType]) {
      handleCharge(packet);
    }
  }

  return {
    onPacket: onPacket,
    isDegraded() { return isDegraded; },
    consecutiveFailures() { return consecutiveFailures; }
  };
}


// ── signal:notifications ────────────────────────────────────────────
// Twilio/email integration. Receives SEND_NOTIFICATION on SIGNAL bus,
// calls messaging API through Dependency Gate, emits
// NOTIFICATION_DELIVERED or NOTIFICATION_FAILED on DATA bus.
// Circuit breaker for service degradation.
// Ref: PCR OP-054 (SEND_NOTIFICATION), OP-060 (service degradation).
//      Routing table §4 #56–58, #62–63.

function createSignalNotifications(caps) {
  const LOOP = 'signal:notifications';

  // Circuit breaker state
  const FAILURE_THRESHOLD = 3;
  let consecutiveFailures = 0;
  let isDegraded = false;
  let lastSuccessAt = null;

  function onPacket(packet) {
    if (packet.packetType !== 'SEND_NOTIFICATION') return;

    const payload = packet.payload;

    // Call Dependency Gate
    let sendResult;
    try {
      if (caps.services && caps.services.send) {
        sendResult = caps.services.send({
          channel:          payload.channel,
          recipientAddress: payload.recipientAddress,
          subject:          payload.subject,
          body:             payload.body
        });
      } else {
        // No Dependency Gate — stub mode, auto-succeed
        sendResult = {
          success: true,
          providerResponse: 'stub_delivery_ok',
          attemptNumber: 1
        };
      }
    } catch (err) {
      sendResult = {
        success: false,
        reason: 'PROVIDER_ERROR',
        detail: err.message || 'Dependency Gate threw'
      };
    }

    if (sendResult.success) {
      consecutiveFailures = 0;
      lastSuccessAt = now();

      if (isDegraded) {
        isDegraded = false;
        const restoredPkt = createPacket('NOTIFICATION_SERVICE_RESTORED', {
          service: payload.channel === 'sms' ? 'twilio' : 'email',
          restoredAt: now()
        }, { traceId: packet.traceId, source: LOOP });
        caps.bus.emit('DATA', restoredPkt);
      }

      const deliveredPkt = createPacket('NOTIFICATION_DELIVERED', {
        notificationId:  payload.notificationId,
        orderId:         payload.orderId,
        customerId:      payload.customerId,
        channel:         payload.channel,
        providerResponse: sendResult.providerResponse,
        attemptNumber:   sendResult.attemptNumber || 1
      }, { traceId: packet.traceId, source: LOOP });
      caps.bus.emit('DATA', deliveredPkt);

    } else {
      consecutiveFailures++;

      if (consecutiveFailures >= FAILURE_THRESHOLD && !isDegraded) {
        isDegraded = true;
        const degradedPkt = createPacket('NOTIFICATION_SERVICE_DEGRADED', {
          service: payload.channel === 'sms' ? 'twilio' : 'email',
          detectedAt: now(),
          lastSuccessAt: lastSuccessAt,
          failureCount: consecutiveFailures,
          queuedCount: 0
        }, { traceId: packet.traceId, source: LOOP });
        caps.bus.emit('DATA', degradedPkt);
      }

      const failedPkt = createPacket('NOTIFICATION_FAILED', {
        notificationId:  payload.notificationId,
        orderId:         payload.orderId,
        customerId:      payload.customerId,
        channel:         payload.channel,
        failureReason:   sendResult.reason || 'PROVIDER_ERROR',
        failureDetail:   sendResult.detail || null,
        attemptNumber:   sendResult.attemptNumber || 1
      }, { traceId: packet.traceId, source: LOOP });
      caps.bus.emit('DATA', failedPkt);
    }
  }

  return {
    onPacket: onPacket,
    isDegraded() { return isDegraded; },
    consecutiveFailures() { return consecutiveFailures; }
  };
}


// ────────────────────────────────────────────────────────────────────
// SECTION 13: ROUTING ENTRIES — SIGNAL LOOPS (TIER 3)
// Registered during init. Post-renumbering entry numbers per §12.
// ────────────────────────────────────────────────────────────────────

function registerSignalPaymentsRoutes(routing) {
  // §1 #12 — CHARGE_DEPOSIT (declare, workflow:orderLifecycle → signal:payments)
  routing.register({ entryNumber: 12, packetType: 'CHARGE_DEPOSIT',
    source: 'workflow:orderLifecycle', bus: 'SIGNAL',
    destinations: ['signal:payments'], mode: 'Push', priority: 'CRITICAL' });

  // §1 #13 — DEPOSIT_CHARGED (declare, signal:payments → workflow:orderLifecycle, presentation:dashboard)
  routing.register({ entryNumber: 13, packetType: 'DEPOSIT_CHARGED',
    source: 'signal:payments', bus: 'DATA',
    destinations: ['workflow:orderLifecycle', 'presentation:dashboard'], mode: 'Push', priority: 'CRITICAL' });

  // §1 #14 — DEPOSIT_FAILED (declare, signal:payments → workflow:orderLifecycle, presentation:dashboard)
  routing.register({ entryNumber: 14, packetType: 'DEPOSIT_FAILED',
    source: 'signal:payments', bus: 'DATA',
    destinations: ['workflow:orderLifecycle', 'presentation:dashboard'], mode: 'Push', priority: 'CRITICAL' });

  // §3 #39 — CHARGE_BALANCE (declare, workflow:orderLifecycle → signal:payments)
  routing.register({ entryNumber: 39, packetType: 'CHARGE_BALANCE',
    source: 'workflow:orderLifecycle', bus: 'SIGNAL',
    destinations: ['signal:payments'], mode: 'Push', priority: 'STANDARD' });

  // §3 #40 — BALANCE_CHARGED (declare, signal:payments → workflow:orderLifecycle, presentation:dashboard)
  routing.register({ entryNumber: 40, packetType: 'BALANCE_CHARGED',
    source: 'signal:payments', bus: 'DATA',
    destinations: ['workflow:orderLifecycle', 'presentation:dashboard'], mode: 'Push', priority: 'STANDARD' });

  // §3 #41 — BALANCE_FAILED (declare, signal:payments → workflow:orderLifecycle, presentation:dashboard)
  routing.register({ entryNumber: 41, packetType: 'BALANCE_FAILED',
    source: 'signal:payments', bus: 'DATA',
    destinations: ['workflow:orderLifecycle', 'presentation:dashboard'], mode: 'Push', priority: 'CRITICAL' });

  // §3 #42 — CHARGE_STORAGE_FEE (declare, workflow:orderLifecycle → signal:payments)
  routing.register({ entryNumber: 42, packetType: 'CHARGE_STORAGE_FEE',
    source: 'workflow:orderLifecycle', bus: 'SIGNAL',
    destinations: ['signal:payments'], mode: 'Push', priority: 'STANDARD' });

  // §3 #43 — STORAGE_FEE_CHARGED (declare, signal:payments → workflow:orderLifecycle, presentation:dashboard)
  routing.register({ entryNumber: 43, packetType: 'STORAGE_FEE_CHARGED',
    source: 'signal:payments', bus: 'DATA',
    destinations: ['workflow:orderLifecycle', 'presentation:dashboard'], mode: 'Push', priority: 'STANDARD' });

  // §3 #44 — STORAGE_FEE_FAILED (declare, signal:payments → workflow:orderLifecycle, presentation:dashboard)
  routing.register({ entryNumber: 44, packetType: 'STORAGE_FEE_FAILED',
    source: 'signal:payments', bus: 'DATA',
    destinations: ['workflow:orderLifecycle', 'presentation:dashboard'], mode: 'Push', priority: 'CRITICAL' });

  // §3 #45 — CHARGE_NOSHOW_BALANCE (declare, workflow:orderLifecycle → signal:payments)
  routing.register({ entryNumber: 45, packetType: 'CHARGE_NOSHOW_BALANCE',
    source: 'workflow:orderLifecycle', bus: 'SIGNAL',
    destinations: ['signal:payments'], mode: 'Push', priority: 'STANDARD' });

  // §3 #46 — NOSHOW_BALANCE_CHARGED (declare, signal:payments → workflow:orderLifecycle, presentation:dashboard)
  routing.register({ entryNumber: 46, packetType: 'NOSHOW_BALANCE_CHARGED',
    source: 'signal:payments', bus: 'DATA',
    destinations: ['workflow:orderLifecycle', 'presentation:dashboard'], mode: 'Push', priority: 'STANDARD' });

  // §3 #47 — NOSHOW_BALANCE_FAILED (declare, signal:payments → workflow:orderLifecycle, presentation:dashboard)
  routing.register({ entryNumber: 47, packetType: 'NOSHOW_BALANCE_FAILED',
    source: 'signal:payments', bus: 'DATA',
    destinations: ['workflow:orderLifecycle', 'presentation:dashboard'], mode: 'Push', priority: 'CRITICAL' });

  // §3 #49 — PAYMENT_ALERT (declare, workflow:orderLifecycle → presentation:dashboard)
  routing.register({ entryNumber: 49, packetType: 'PAYMENT_ALERT',
    source: 'workflow:orderLifecycle', bus: 'DATA',
    destinations: ['presentation:dashboard'], mode: 'Push', priority: 'CRITICAL' });

  // §3 #51 — PAYMENT_SERVICE_DEGRADED (declare, signal:payments → presentation:dashboard)
  routing.register({ entryNumber: 51, packetType: 'PAYMENT_SERVICE_DEGRADED',
    source: 'signal:payments', bus: 'DATA',
    destinations: ['presentation:dashboard'], mode: 'Push', priority: 'CRITICAL' });

  // §3 #52 — PAYMENT_SERVICE_RESTORED (declare, signal:payments → presentation:dashboard)
  routing.register({ entryNumber: 52, packetType: 'PAYMENT_SERVICE_RESTORED',
    source: 'signal:payments', bus: 'DATA',
    destinations: ['presentation:dashboard'], mode: 'Push', priority: 'STANDARD' });
}


function registerSignalNotificationsRoutes(routing) {
  // §4 #56 — SEND_NOTIFICATION (declare, workflow:notifications → signal:notifications)
  routing.register({ entryNumber: 56, packetType: 'SEND_NOTIFICATION',
    source: 'workflow:notifications', bus: 'SIGNAL',
    destinations: ['signal:notifications'], mode: 'Push', priority: 'STANDARD' });

  // §4 #57 — NOTIFICATION_DELIVERED (declare, signal:notifications → workflow:notifications)
  routing.register({ entryNumber: 57, packetType: 'NOTIFICATION_DELIVERED',
    source: 'signal:notifications', bus: 'DATA',
    destinations: ['workflow:notifications'], mode: 'Push', priority: 'STANDARD' });

  // §4 #58 — NOTIFICATION_FAILED (declare, signal:notifications → workflow:notifications)
  routing.register({ entryNumber: 58, packetType: 'NOTIFICATION_FAILED',
    source: 'signal:notifications', bus: 'DATA',
    destinations: ['workflow:notifications'], mode: 'Push', priority: 'STANDARD' });

  // §4 #62 — NOTIFICATION_SERVICE_DEGRADED (declare, signal:notifications → presentation:dashboard)
  routing.register({ entryNumber: 62, packetType: 'NOTIFICATION_SERVICE_DEGRADED',
    source: 'signal:notifications', bus: 'DATA',
    destinations: ['presentation:dashboard'], mode: 'Push', priority: 'CRITICAL' });

  // §4 #63 — NOTIFICATION_SERVICE_RESTORED (declare, signal:notifications → presentation:dashboard)
  routing.register({ entryNumber: 63, packetType: 'NOTIFICATION_SERVICE_RESTORED',
    source: 'signal:notifications', bus: 'DATA',
    destinations: ['presentation:dashboard'], mode: 'Push', priority: 'STANDARD' });
}


// ────────────────────────────────────────────────────────────────────
// SECTION 14: ROUTING ENTRIES — INPUT GATES (TIER 2)
// Registered during init. Post-renumbering entry numbers per §12.
// ────────────────────────────────────────────────────────────────────

function registerInputGateRoutes(routing) {
  // ── External Intake Path ──
  // §1 #1 — INTAKE_RAW (declare, working:orderIntake → filter:orderValidation)
  routing.register({
    entryNumber: 1, packetType: 'INTAKE_RAW',
    source: 'working:orderIntake', bus: 'DATA',
    destinations: ['filter:orderValidation'], mode: 'Push', priority: 'STANDARD'
  });

  // §1 #2 — INTAKE_VALIDATED (declare, filter:orderValidation → workflow:orderLifecycle)
  routing.register({
    entryNumber: 2, packetType: 'INTAKE_VALIDATED',
    source: 'filter:orderValidation', bus: 'DATA',
    destinations: ['workflow:orderLifecycle'], mode: 'Push', priority: 'STANDARD'
  });

  // §1 #3 — INTAKE_REJECTED (declare, filter:orderValidation → presentation:dashboard)
  routing.register({
    entryNumber: 3, packetType: 'INTAKE_REJECTED',
    source: 'filter:orderValidation', bus: 'DATA',
    destinations: ['presentation:dashboard'], mode: 'Push', priority: 'STANDARD'
  });

  // ── Internal Intake Path ──
  // §1 #4 — INTAKE_DIRECT (declare, presentation:dashboard → workflow:orderLifecycle)
  routing.register({
    entryNumber: 4, packetType: 'INTAKE_DIRECT',
    source: 'presentation:dashboard', bus: 'DATA',
    destinations: ['workflow:orderLifecycle'], mode: 'Push', priority: 'STANDARD'
  });

  // ── External Cuts Path ──
  // §1 #25 — CUTS_RAW (declare, working:orderIntake → filter:orderValidation)
  routing.register({
    entryNumber: 25, packetType: 'CUTS_RAW',
    source: 'working:orderIntake', bus: 'DATA',
    destinations: ['filter:orderValidation'], mode: 'Push', priority: 'STANDARD'
  });

  // §1 #26 — CUTS_VALIDATED (declare, filter:orderValidation → workflow:orderLifecycle)
  routing.register({
    entryNumber: 26, packetType: 'CUTS_VALIDATED',
    source: 'filter:orderValidation', bus: 'DATA',
    destinations: ['workflow:orderLifecycle'], mode: 'Push', priority: 'STANDARD'
  });

  // §1 #27 — CUTS_REJECTED (declare, filter:orderValidation → presentation:dashboard)
  routing.register({
    entryNumber: 27, packetType: 'CUTS_REJECTED',
    source: 'filter:orderValidation', bus: 'DATA',
    destinations: ['presentation:dashboard'], mode: 'Push', priority: 'STANDARD'
  });

  // ── Internal Cuts Path ──
  // §1 #28 — CUTS_DIRECT (declare, presentation:dashboard → workflow:orderLifecycle)
  routing.register({
    entryNumber: 28, packetType: 'CUTS_DIRECT',
    source: 'presentation:dashboard', bus: 'DATA',
    destinations: ['workflow:orderLifecycle'], mode: 'Push', priority: 'STANDARD'
  });

  // ── Payment Webhook Path ──
  // §3 #48 — PAYMENT_EVENT (declare, working:paymentWebhook → workflow:orderLifecycle)
  routing.register({
    entryNumber: 48, packetType: 'PAYMENT_EVENT',
    source: 'working:paymentWebhook', bus: 'DATA',
    destinations: ['workflow:orderLifecycle'], mode: 'Push', priority: 'STANDARD'
  });

  // §3 #50 — WEBHOOK_REJECTED (declare, working:paymentWebhook → presentation:dashboard)
  routing.register({
    entryNumber: 50, packetType: 'WEBHOOK_REJECTED',
    source: 'working:paymentWebhook', bus: 'DATA',
    destinations: ['presentation:dashboard'], mode: 'Push', priority: 'STANDARD'
  });
}


// ────────────────────────────────────────────────────────────────────
// SECTION 15: LOOP IMPLEMENTATIONS — COMPUTE LOOPS
// Compute loops pull from vaults, evaluate business logic, and emit
// trigger events. No external dependencies. Require Tier 1 (vaults).
// ────────────────────────────────────────────────────────────────────

// ── compute:pricing ─────────────────────────────────────────────────
// Subscribes to PRICING_REQUESTED on DATA bus.
// Pulls config from vault:config (pricing tables, valid services).
// Validates cut selections and services against config.
// Snapshots all applicable rates, calculates totals.
// Emits ORDER_PRICED or PRICING_REJECTED on DATA.
// Ref: PCR OP-018 (PRICING_REQUESTED/ORDER_PRICED/PRICING_REJECTED),
//      OP-019 (FETCH_CONFIG).
//      Routing table §1 #18–21.
// Critical: PRICING_REQUESTED must be self-contained — this loop
//           does NOT pull from vault:orders. Every field needed for
//           pricing must be in the packet.

function createComputePricing(caps) {
  const LOOP = 'compute:pricing';

  // Valid animal types (extensible — config can add overrides)
  const BASE_ANIMAL_TYPES = ['deer', 'moose', 'bear'];

  // Valid optional service keys
  const VALID_SERVICES = [
    'porkFat', 'sausage', 'antlers', 'skullCapMount', 'cape', 'rushProcessing'
  ];

  function onPacket(packet) {
    if (packet.packetType !== 'PRICING_REQUESTED') return;

    const payload = packet.payload;

    // Pull config from vault:config
    const configPkt = createPacket('FETCH_CONFIG', {}, { traceId: packet.traceId, source: LOOP });
    const configResult = caps.bus.request(configPkt);

    if (!configResult || !configResult.config) {
      // Config unavailable — reject
      const rejectPkt = createPacket('PRICING_REJECTED', {
        orderId: payload.orderId,
        rejectionReasons: ['CONFIG_UNAVAILABLE'],
        rejectionDetail: 'Could not fetch pricing configuration'
      }, { traceId: packet.traceId, source: LOOP });
      caps.bus.emit('DATA', rejectPkt);
      return;
    }

    const config = configResult.config;
    const configVersion = configResult.version;
    const rejectionReasons = [];

    // ── Validate animal type ──
    const knownTypes = config.pricing.animalTypeOverrides
      ? BASE_ANIMAL_TYPES.concat(Object.keys(config.pricing.animalTypeOverrides))
      : BASE_ANIMAL_TYPES;

    if (!payload.animalType || knownTypes.indexOf(payload.animalType) === -1) {
      rejectionReasons.push('UNKNOWN_ANIMAL_TYPE');
    }

    // ── Validate cut selections ──
    if (!payload.cutSelections || typeof payload.cutSelections !== 'object') {
      rejectionReasons.push('INVALID_CUT_SELECTION');
    }

    // ── Validate optional services ──
    if (payload.optionalServices && typeof payload.optionalServices === 'object') {
      const serviceKeys = Object.keys(payload.optionalServices);
      for (let i = 0; i < serviceKeys.length; i++) {
        if (VALID_SERVICES.indexOf(serviceKeys[i]) === -1) {
          rejectionReasons.push('UNKNOWN_SERVICE');
          break;
        }
      }

      // Sausage minimum check
      if (payload.optionalServices.sausage) {
        const sausage = payload.optionalServices.sausage;
        const totalLbs = sausage.totalLbs || 0;
        if (totalLbs > 0 && totalLbs < (config.services.sausageMinimumLbs || 5)) {
          rejectionReasons.push('SAUSAGE_BELOW_MINIMUM');
        }
      }
    }

    // ── Reject if any validation failed ──
    if (rejectionReasons.length > 0) {
      const rejectPkt = createPacket('PRICING_REJECTED', {
        orderId: payload.orderId,
        rejectionReasons: rejectionReasons,
        rejectionDetail: 'Pricing validation failed: ' + rejectionReasons.join(', ')
      }, { traceId: packet.traceId, source: LOOP });
      caps.bus.emit('DATA', rejectPkt);
      return;
    }

    // ── Calculate pricing ──
    // Base rate (with per-type override)
    let baseRate = config.pricing.baseRate;
    if (config.pricing.animalTypeOverrides &&
        config.pricing.animalTypeOverrides[payload.animalType] !== undefined) {
      baseRate = config.pricing.animalTypeOverrides[payload.animalType];
    }

    // Overage
    const threshold = config.pricing.weightThresholdLbs || 160;
    const overageRate = config.pricing.overagePerLb || 0;
    let overageAmount = 0;
    if (payload.hangingWeightLbs && payload.hangingWeightLbs > threshold) {
      overageAmount = (payload.hangingWeightLbs - threshold) * overageRate;
    }

    // Optional service costs
    const optionalServiceCosts = {};
    let serviceTotalCost = 0;

    if (payload.optionalServices) {
      const svc = payload.optionalServices;
      const prices = config.services;

      if (svc.porkFat) {
        const lbs = svc.porkFat.lbs || 0;
        const cost = lbs * (prices.porkFatPerLb || 0);
        optionalServiceCosts.porkFat = cost;
        serviceTotalCost += cost;
      }

      if (svc.sausage) {
        const lbs = svc.sausage.totalLbs || 0;
        const cost = lbs * (prices.sausagePerLb || 0);
        optionalServiceCosts.sausage = cost;
        serviceTotalCost += cost;
      }

      if (svc.antlers) {
        const cost = prices.antlers || 0;
        optionalServiceCosts.antlers = cost;
        serviceTotalCost += cost;
      }

      if (svc.skullCapMount) {
        const cost = prices.skullCapMount || 0;
        optionalServiceCosts.skullCapMount = cost;
        serviceTotalCost += cost;
      }

      if (svc.cape) {
        const cost = prices.cape || 0;
        optionalServiceCosts.cape = cost;
        serviceTotalCost += cost;
      }

      if (svc.rushProcessing) {
        const cost = prices.rushProcessing || 0;
        optionalServiceCosts.rushProcessing = cost;
        serviceTotalCost += cost;
      }
    }

    // Totals
    const total = baseRate + overageAmount + serviceTotalCost;
    const depositCredit = payload.depositAmount || 0;
    const balanceDue = Math.max(0, total - depositCredit);

    const pricingSnapshot = {
      baseRate:              baseRate,
      overageRate:           overageRate,
      overageAmount:         overageAmount,
      optionalServiceCosts:  optionalServiceCosts,
      depositCredit:         depositCredit,
      total:                 total,
      balanceDue:            balanceDue
    };

    const pricedPkt = createPacket('ORDER_PRICED', {
      orderId:            payload.orderId,
      pricingSnapshot:    pricingSnapshot,
      configVersionUsed:  configVersion
    }, { traceId: packet.traceId, source: LOOP });
    caps.bus.emit('DATA', pricedPkt);
  }

  return { onPacket: onPacket };
}


// ── compute:dailyScan ───────────────────────────────────────────────
// Daily condition checker. Subscribes to DAILY_SCAN_TRIGGERED on DATA.
// Pulls orders and config from vaults.
// Checks conditions in priority order per order:
//   Terminal before recurring (no-show → storage fee).
//   Then: incomplete reminders, marketing outreach.
// Emits trigger packets. Writes marketing dedup flags.
// Emits DAILY_SCAN_COMPLETED at end.
// Ref: PCR OP-062 (scan trigger), OP-065 (storage fee due),
//      OP-066 (no-show), OP-068 (incomplete reminder),
//      OP-070 (marketing), OP-074 (scan completed).
//      Routing table §5 #64–76.

function createComputeDailyScan(caps) {
  const LOOP = 'compute:dailyScan';

  function daysBetween(iso1, iso2) {
    const d1 = new Date(iso1);
    const d2 = new Date(iso2);
    return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
  }

  function onPacket(packet) {
    if (packet.packetType !== 'DAILY_SCAN_TRIGGERED') return;

    const scanDate = packet.payload.scanDate || now();
    const traceId = packet.traceId;

    const triggerCounts = {
      storageFeesDue: 0,
      noShowsReached: 0,
      incompleteReminders: 0,
      marketingCampaigns: 0
    };

    // ── Pull orders ──
    const ordersPkt = createPacket('FETCH_ORDERS', {
      stageFilter: ['ready_for_pickup', 'pending_customer_input']
    }, { traceId: traceId, source: LOOP });
    const ordersResult = caps.bus.request(ordersPkt);

    // ── Pull config ──
    const configPkt = createPacket('FETCH_CONFIG', {
      configKeys: ['storage', 'notifications', 'campaigns']
    }, { traceId: traceId, source: LOOP });
    const configResult = caps.bus.request(configPkt);

    if (!ordersResult || !configResult || !configResult.config) {
      // Can't scan without data — emit completion with zeros
      const completePkt = createPacket('DAILY_SCAN_COMPLETED', {
        scanDate: scanDate,
        completedAt: now(),
        triggerCounts: triggerCounts
      }, { traceId: traceId, source: LOOP });
      caps.bus.emit('DATA', completePkt);
      return;
    }

    const orders = ordersResult.orders || [];
    const config = configResult.config;
    const noShowDays = (config.storage && config.storage.noShowDeadlineDays) || 30;
    const graceDays = (config.storage && config.storage.gracePeriodDays) || 7;
    const storageFeeIntervalDays = 7; // Weekly
    const reminderIntervalDays = 3;   // Default 3 days between reminders
    const reminderMax = 3;            // Default max 3 reminders

    // ── Process each order ──
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];

      if (order.stage === 'ready_for_pickup') {
        // ── Terminal check: no-show deadline ──
        if (order.readyForPickupAt) {
          const daysReady = daysBetween(order.readyForPickupAt, scanDate);

          if (daysReady >= noShowDays) {
            // No-show — terminal, skip storage fee for this order
            const noShowPkt = createPacket('NO_SHOW_DEADLINE_REACHED', {
              orderId: order.orderId
            }, { traceId: traceId, source: LOOP });
            caps.bus.emit('DATA', noShowPkt);
            triggerCounts.noShowsReached++;
            continue; // Terminal — skip remaining checks for this order
          }

          // ── Recurring check: storage fee ──
          if (daysReady >= graceDays) {
            const lastCharged = order.lastStorageFeeChargedAt;
            const daysSinceCharge = lastCharged
              ? daysBetween(lastCharged, scanDate)
              : storageFeeIntervalDays; // Null = never charged, treat as due

            if (daysSinceCharge >= storageFeeIntervalDays) {
              const feePkt = createPacket('STORAGE_FEE_DUE', {
                orderId: order.orderId
              }, { traceId: traceId, source: LOOP });
              caps.bus.emit('DATA', feePkt);
              triggerCounts.storageFeesDue++;
            }
          }
        }
      } else if (order.stage === 'pending_customer_input') {
        // ── Incomplete reminder check ──
        const reminderCount = order.reminderCount || 0;
        if (reminderCount < reminderMax) {
          const lastReminder = order.lastReminderSentAt || order.createdAt;
          if (lastReminder) {
            const daysSince = daysBetween(lastReminder, scanDate);
            if (daysSince >= reminderIntervalDays) {
              const reminderPkt = createPacket('INCOMPLETE_REMINDER_DUE', {
                orderId: order.orderId
              }, { traceId: traceId, source: LOOP });
              caps.bus.emit('DATA', reminderPkt);
              triggerCounts.incompleteReminders++;
            }
          }
        }
      }
    }

    // ── Marketing campaigns ──
    if (config.campaigns && Array.isArray(config.campaigns)) {
      for (let j = 0; j < config.campaigns.length; j++) {
        const campaign = config.campaigns[j];
        if (campaign.executedAt) continue; // Already executed

        if (campaign.scheduledDate && campaign.scheduledDate <= scanDate) {
          // Emit trigger
          const mktPkt = createPacket('MARKETING_OUTREACH_DUE', {
            campaignId: campaign.campaignId,
            campaignConfig: campaign
          }, { traceId: traceId, source: LOOP });
          caps.bus.emit('DATA', mktPkt);
          triggerCounts.marketingCampaigns++;

          // Write dedup flag via WRITE_CONFIG_UPDATE
          const dedupPkt = createPacket('WRITE_CONFIG_UPDATE', {
            configKey: 'campaigns.' + campaign.campaignId,
            updatePath: 'executedAt',
            value: now()
          }, { traceId: traceId, source: LOOP });
          caps.bus.emit('VAULT', dedupPkt);
        }
      }
    }

    // ── Scan complete ──
    const completePkt = createPacket('DAILY_SCAN_COMPLETED', {
      scanDate: scanDate,
      completedAt: now(),
      triggerCounts: triggerCounts
    }, { traceId: traceId, source: LOOP });
    caps.bus.emit('DATA', completePkt);
  }

  return { onPacket: onPacket };
}


// ── compute:reports ─────────────────────────────────────────────────
// Snapshot assembly and on-demand reports.
// Subscribes to SNAPSHOT_TRIGGERED and REPORT_REQUESTED on DATA.
// Pulls from vault:orders, vault:customers, vault:config.
// Writes snapshots to vault:snapshots via STORE_SNAPSHOT.
// Emits REPORT_GENERATED for on-demand reports.
// Ref: PCR OP-075 (snapshot), OP-081 (report).
//      Routing table §5 #77–85.

function createComputeReports(caps) {
  const LOOP = 'compute:reports';

  function onPacket(packet) {
    if (packet.packetType === 'SNAPSHOT_TRIGGERED') {
      handleSnapshot(packet);
    } else if (packet.packetType === 'REPORT_REQUESTED') {
      handleReport(packet);
    }
  }

  function handleSnapshot(packet) {
    const payload = packet.payload;
    const traceId = packet.traceId;
    const snapshotType = payload.snapshotType || 'daily';

    // Pull orders
    const orderFilter = snapshotType === 'daily'
      ? { stageFilter: null } // Daily: all active (null = no filter)
      : {};                   // Seasonal: all orders
    const ordersPkt = createPacket('FETCH_ORDERS', orderFilter,
      { traceId: traceId, source: LOOP });
    const ordersResult = caps.bus.request(ordersPkt);
    const orders = (ordersResult && ordersResult.orders) || [];

    // Pull customers for seasonal snapshots
    let customers = [];
    if (snapshotType === 'seasonal') {
      const custPkt = createPacket('FETCH_CUSTOMERS', { filter: null },
        { traceId: traceId, source: LOOP });
      const custResult = caps.bus.request(custPkt);
      customers = (custResult && custResult.customers) || [];
    }

    // Assemble summary
    const stageBreakdown = {};
    let revenueTotal = 0;
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      stageBreakdown[o.stage] = (stageBreakdown[o.stage] || 0) + 1;
      if (o.pricingSnapshot && o.pricingSnapshot.total) {
        revenueTotal += o.pricingSnapshot.total;
      }
    }

    const snapshotId = generateId();
    const takenAt = now();

    const storePkt = createPacket('STORE_SNAPSHOT', {
      snapshotId:   snapshotId,
      snapshotType: snapshotType,
      takenAt:      takenAt,
      recordCount:  orders.length + customers.length,
      summary: {
        totalOrders: orders.length,
        ordersByStage: stageBreakdown,
        revenueTotal: revenueTotal,
        totalCustomers: customers.length
      },
      records:  snapshotType === 'seasonal'
        ? { orders: orders, customers: customers }
        : { orders: orders },
      metadata: {
        snapshotDate: payload.snapshotDate || takenAt,
        filtersApplied: orderFilter
      }
    }, { traceId: traceId, source: LOOP });
    caps.bus.emit('VAULT', storePkt);
  }

  function handleReport(packet) {
    const payload = packet.payload;
    const traceId = packet.traceId;
    const reportType = payload.reportType;

    // Pull orders
    const ordersPkt = createPacket('FETCH_ORDERS', {
      dateRange: payload.dateRange || null
    }, { traceId: traceId, source: LOOP });
    const ordersResult = caps.bus.request(ordersPkt);
    const orders = (ordersResult && ordersResult.orders) || [];

    // Pull customers
    const custPkt = createPacket('FETCH_CUSTOMERS', { filter: null },
      { traceId: traceId, source: LOOP });
    const custResult = caps.bus.request(custPkt);
    const customers = (custResult && custResult.customers) || [];

    // Pull config (for revenue calculations)
    const configPkt = createPacket('FETCH_CONFIG', {},
      { traceId: traceId, source: LOOP });
    const configResult = caps.bus.request(configPkt);
    const config = (configResult && configResult.config) || {};

    // Assemble report
    const reportData = assembleReport(reportType, orders, customers, config);

    // On-demand snapshots also get stored
    if (reportType === 'snapshot_on_demand') {
      const snapshotId = generateId();
      const storePkt = createPacket('STORE_SNAPSHOT', {
        snapshotId:   snapshotId,
        snapshotType: 'on_demand',
        takenAt:      now(),
        recordCount:  orders.length + customers.length,
        summary:      reportData,
        records:      { orders: orders, customers: customers },
        metadata: {
          reportType:  reportType,
          dateRange:   payload.dateRange || null,
          requestedBy: payload.operatorId
        }
      }, { traceId: traceId, source: LOOP });
      caps.bus.emit('VAULT', storePkt);
    }

    // Emit report
    const reportPkt = createPacket('REPORT_GENERATED', {
      reportType:  reportType,
      generatedAt: now(),
      reportData:  reportData,
      requestedBy: payload.operatorId
    }, { traceId: traceId, source: LOOP });
    caps.bus.emit('DATA', reportPkt);
  }

  function assembleReport(reportType, orders, customers, config) {
    const stageBreakdown = {};
    let revenueTotal = 0;
    let balanceDueTotal = 0;

    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      stageBreakdown[o.stage] = (stageBreakdown[o.stage] || 0) + 1;
      if (o.pricingSnapshot) {
        revenueTotal += o.pricingSnapshot.total || 0;
        balanceDueTotal += o.pricingSnapshot.balanceDue || 0;
      }
    }

    if (reportType === 'season_summary') {
      return {
        totalOrders: orders.length,
        totalCustomers: customers.length,
        ordersByStage: stageBreakdown,
        revenueTotal: revenueTotal,
        balanceDueTotal: balanceDueTotal
      };
    } else if (reportType === 'revenue') {
      return {
        totalOrders: orders.length,
        revenueTotal: revenueTotal,
        balanceDueTotal: balanceDueTotal,
        configVersion: config.version || null
      };
    } else if (reportType === 'order_status') {
      return {
        totalOrders: orders.length,
        ordersByStage: stageBreakdown
      };
    } else if (reportType === 'snapshot_on_demand') {
      return {
        totalOrders: orders.length,
        totalCustomers: customers.length,
        ordersByStage: stageBreakdown,
        revenueTotal: revenueTotal
      };
    }

    // Fallback
    return {
      totalOrders: orders.length,
      ordersByStage: stageBreakdown
    };
  }

  return { onPacket: onPacket };
}


// ────────────────────────────────────────────────────────────────────
// SECTION 15B: LOOP IMPLEMENTATIONS — WORKFLOW LOOPS (TIER 5)
// ────────────────────────────────────────────────────────────────────

// ── workflow:notifications ──────────────────────────────────────────
// Notification assembly and delivery pipeline.
// Triggers: ORDER_CREATED (partial), ORDER_STAGE_CHANGED (rfp, closed),
//   ORDER_CANCELLED, ORDER_ABANDONED, INCOMPLETE_REMINDER_DUE,
//   MARKETING_OUTREACH_DUE, SEND_MANUAL_MESSAGE
// Assembly: fetch customer → fetch order → fetch template → SEND_NOTIFICATION
// Delivery: NOTIFICATION_DELIVERED → audit. NOTIFICATION_FAILED → retry/escalate.

function createWorkflowNotifications(caps) {
  const LOOP = 'workflow:notifications';

  // ── Retry tracking ──
  const retryState = new Map();
  const MAX_RETRIES_PER_CHANNEL = 4;

  // ── Fallback templates ──
  const FALLBACK_TEMPLATES = {
    self_service_link:   'Hi {{customerName}}, please complete your cut selections for order {{orderId}}: {{selfServiceLinkUrl}}',
    ready_for_pickup:    'Your order is ready for pickup, {{customerName}}!',
    thank_you:           'Thank you {{customerName}}! We appreciate your business.',
    cancellation:        'Your order {{orderId}} has been cancelled.',
    abandonment:         'Your order {{orderId}} has been marked abandoned after the pickup deadline.',
    incomplete_reminder: 'Reminder: please complete your cut selections for order {{orderId}}: {{selfServiceLinkUrl}}',
    marketing:           'Hunting season is approaching! Contact us to schedule your processing.',
    manual:              '{{messageText}}'
  };

  function populateTemplate(template, vars) {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp('\\{\\{' + key + '\\}\\}', 'g'), value || '');
    }
    return result;
  }

  function resolveTemplate(templateKey, traceId) {
    const configResult = caps.bus.request(
      createPacket('FETCH_CONFIG', { configKeys: ['notifications'] },
        { traceId: traceId, source: LOOP })
    );
    const templates = configResult.config && configResult.config.notifications;
    if (templates) {
      const configMap = {
        self_service_link:   'selfServiceLinkTemplate',
        ready_for_pickup:    'readyForPickupTemplate',
        thank_you:           'thankYouTemplate',
        cancellation:        'cancellationTemplate',
        abandonment:         'abandonmentTemplate',
        incomplete_reminder: 'incompleteReminderTemplate',
        marketing:           'marketingTemplate'
      };
      const configKey = configMap[templateKey];
      if (configKey && templates[configKey]) {
        return { template: templates[configKey], source: 'config' };
      }
    }
    return { template: FALLBACK_TEMPLATES[templateKey] || '', source: 'fallback' };
  }

  // ── Core send ──
  function sendNotification(opts, traceId) {
    const { customerId, orderId, templateKey, templateVars, messageText } = opts;

    const custResult = caps.bus.request(
      createPacket('FETCH_CUSTOMER', { lookupBy: 'customerId', lookupValue: customerId },
        { traceId: traceId, source: LOOP })
    );
    if (!custResult.found) {
      caps.bus.emit('VAULT', createPacket('WRITE_AUDIT', {
        auditType: 'notification_skipped',
        orderId: orderId, operatorId: 'system',
        orderState: { reason: 'customer_not_found', customerId: customerId }
      }, { traceId: traceId, source: LOOP }));
      return;
    }
    const customer = custResult.customer;

    const channels = [];
    if (customer.textOptIn) channels.push('sms');
    if (customer.emailOptIn) channels.push('email');

    if (channels.length === 0) {
      caps.bus.emit('VAULT', createPacket('WRITE_AUDIT', {
        auditType: 'notification_skipped',
        orderId: orderId, operatorId: 'system',
        orderState: { reason: 'no_channel_opt_in', customerId: customerId }
      }, { traceId: traceId, source: LOOP }));
      return;
    }

    let body;
    let templateId;
    if (messageText) {
      body = messageText;
      templateId = 'manual';
    } else {
      const resolved = resolveTemplate(templateKey, traceId);
      body = populateTemplate(resolved.template, templateVars || {});
      templateId = resolved.source === 'fallback' ? 'fallback' : templateKey;
    }

    const primaryChannel = channels[0];
    const notificationId = generateId();
    const recipientAddress = primaryChannel === 'sms' ? customer.phone : customer.email;

    retryState.set(notificationId, {
      orderId: orderId, customerId: customerId,
      channels: channels, currentChannelIdx: 0, attempts: 0,
      body: body, templateId: templateId, subject: opts.subject || null
    });

    caps.bus.emit('SIGNAL', createPacket('SEND_NOTIFICATION', {
      notificationId: notificationId, orderId: orderId, customerId: customerId,
      channel: primaryChannel, recipientAddress: recipientAddress,
      subject: opts.subject || null, body: body, templateId: templateId
    }, { traceId: traceId, source: LOOP }));
  }

  // ── Trigger handlers ──

  function handleOrderCreated(packet) {
    const p = packet.payload;
    if (p.stage !== 'pending_customer_input') return;

    const orderResult = caps.bus.request(
      createPacket('FETCH_ORDER', { orderId: p.orderId },
        { traceId: packet.traceId, source: LOOP })
    );
    if (!orderResult.found) return;

    sendNotification({
      customerId: p.customerId, orderId: p.orderId,
      templateKey: 'self_service_link',
      templateVars: { customerName: orderResult.order.customerName || '', orderId: p.orderId,
        selfServiceLinkUrl: orderResult.order.selfServiceLinkUrl || '' }
    }, packet.traceId);
  }

  function handleStageChanged(packet) {
    const p = packet.payload;

    if (p.newStage === 'ready_for_pickup' || p.newStage === 'closed') {
      const orderResult = caps.bus.request(
        createPacket('FETCH_ORDER', { orderId: p.orderId },
          { traceId: packet.traceId, source: LOOP })
      );
      if (!orderResult.found) return;

      const templateKey = p.newStage === 'ready_for_pickup' ? 'ready_for_pickup' : 'thank_you';
      sendNotification({
        customerId: orderResult.order.customerId, orderId: p.orderId,
        templateKey: templateKey,
        templateVars: { customerName: '', orderId: p.orderId }
      }, packet.traceId);
    }
  }

  function handleOrderCancelled(packet) {
    const p = packet.payload;
    const orderResult = caps.bus.request(
      createPacket('FETCH_ORDER', { orderId: p.orderId },
        { traceId: packet.traceId, source: LOOP })
    );
    if (!orderResult.found) return;
    sendNotification({
      customerId: orderResult.order.customerId, orderId: p.orderId,
      templateKey: 'cancellation', templateVars: { orderId: p.orderId }
    }, packet.traceId);
  }

  function handleOrderAbandoned(packet) {
    const p = packet.payload;
    const orderResult = caps.bus.request(
      createPacket('FETCH_ORDER', { orderId: p.orderId },
        { traceId: packet.traceId, source: LOOP })
    );
    if (!orderResult.found) return;
    sendNotification({
      customerId: orderResult.order.customerId, orderId: p.orderId,
      templateKey: 'abandonment', templateVars: { orderId: p.orderId }
    }, packet.traceId);
  }

  function handleIncompleteReminder(packet) {
    const p = packet.payload;
    const orderResult = caps.bus.request(
      createPacket('FETCH_ORDER', { orderId: p.orderId },
        { traceId: packet.traceId, source: LOOP })
    );
    if (!orderResult.found) return;
    sendNotification({
      customerId: orderResult.order.customerId, orderId: p.orderId,
      templateKey: 'incomplete_reminder',
      templateVars: { orderId: p.orderId, selfServiceLinkUrl: orderResult.order.selfServiceLinkUrl || '' }
    }, packet.traceId);
  }

  function handleMarketingOutreach(packet) {
    const batchResult = caps.bus.request(
      createPacket('FETCH_CUSTOMERS', { filter: { marketingOptIn: true } },
        { traceId: packet.traceId, source: LOOP })
    );
    if (!batchResult.customers || batchResult.customers.length === 0) return;
    for (const customer of batchResult.customers) {
      sendNotification({
        customerId: customer.customerId, orderId: null,
        templateKey: 'marketing', templateVars: { customerName: customer.name || '' }
      }, packet.traceId);
    }
  }

  function handleManualMessage(packet) {
    const p = packet.payload;
    let customerId = p.customerId;
    if (!customerId && p.orderId) {
      const orderResult = caps.bus.request(
        createPacket('FETCH_ORDER', { orderId: p.orderId },
          { traceId: packet.traceId, source: LOOP })
      );
      if (orderResult.found) customerId = orderResult.order.customerId;
    }
    if (!customerId) return;
    sendNotification({
      customerId: customerId, orderId: p.orderId || null,
      messageText: p.messageText, subject: p.subject || null
    }, packet.traceId);
  }

  // ── Delivery result handlers ──

  function handleDelivered(packet) {
    const p = packet.payload;
    retryState.delete(p.notificationId);
    caps.bus.emit('VAULT', createPacket('WRITE_AUDIT', {
      auditType: 'notification_delivered',
      orderId: p.orderId, operatorId: 'system',
      orderState: { notificationId: p.notificationId, channel: p.channel,
        customerId: p.customerId, attemptNumber: p.attemptNumber }
    }, { traceId: packet.traceId, source: LOOP }));
  }

  function handleFailed(packet) {
    const p = packet.payload;
    const state = retryState.get(p.notificationId);
    if (!state) {
      caps.bus.emit('VAULT', createPacket('WRITE_AUDIT', {
        auditType: 'notification_failed', orderId: p.orderId, operatorId: 'system',
        orderState: { notificationId: p.notificationId, failureReason: p.failureReason }
      }, { traceId: packet.traceId, source: LOOP }));
      return;
    }

    state.attempts++;
    if (state.attempts >= MAX_RETRIES_PER_CHANNEL) {
      state.currentChannelIdx++;
      if (state.currentChannelIdx < state.channels.length) {
        state.attempts = 0;
        const nextChannel = state.channels[state.currentChannelIdx];
        const custResult = caps.bus.request(
          createPacket('FETCH_CUSTOMER', { lookupBy: 'customerId', lookupValue: state.customerId },
            { traceId: packet.traceId, source: LOOP })
        );
        if (!custResult.found) { retryState.delete(p.notificationId); return; }
        caps.bus.emit('SIGNAL', createPacket('SEND_NOTIFICATION', {
          notificationId: p.notificationId, orderId: state.orderId, customerId: state.customerId,
          channel: nextChannel, recipientAddress: nextChannel === 'sms' ? custResult.customer.phone : custResult.customer.email,
          subject: state.subject, body: state.body, templateId: state.templateId
        }, { traceId: packet.traceId, source: LOOP }));
      } else {
        retryState.delete(p.notificationId);
        caps.bus.emit('DATA', createPacket('NOTIFICATION_PERMANENTLY_FAILED', {
          notificationId: p.notificationId, orderId: state.orderId, customerId: state.customerId,
          channelsAttempted: state.channels, totalAttempts: state.channels.length * MAX_RETRIES_PER_CHANNEL,
          lastFailureReason: p.failureReason
        }, { traceId: packet.traceId, source: LOOP }));
        caps.bus.emit('VAULT', createPacket('WRITE_AUDIT', {
          auditType: 'notification_permanently_failed', orderId: state.orderId, operatorId: 'system',
          orderState: { notificationId: p.notificationId, channelsAttempted: state.channels, lastFailureReason: p.failureReason }
        }, { traceId: packet.traceId, source: LOOP }));
      }
    } else {
      const currentChannel = state.channels[state.currentChannelIdx];
      const custResult = caps.bus.request(
        createPacket('FETCH_CUSTOMER', { lookupBy: 'customerId', lookupValue: state.customerId },
          { traceId: packet.traceId, source: LOOP })
      );
      if (!custResult.found) { retryState.delete(p.notificationId); return; }
      caps.bus.emit('SIGNAL', createPacket('SEND_NOTIFICATION', {
        notificationId: p.notificationId, orderId: state.orderId, customerId: state.customerId,
        channel: currentChannel, recipientAddress: currentChannel === 'sms' ? custResult.customer.phone : custResult.customer.email,
        subject: state.subject, body: state.body, templateId: state.templateId
      }, { traceId: packet.traceId, source: LOOP }));
    }
  }

  // ── Packet router ──

  function onPacket(packet) {
    switch (packet.packetType) {
      case 'ORDER_CREATED':       handleOrderCreated(packet); break;
      case 'ORDER_STAGE_CHANGED': handleStageChanged(packet); break;
      case 'ORDER_CANCELLED':     handleOrderCancelled(packet); break;
      case 'ORDER_ABANDONED':     handleOrderAbandoned(packet); break;
      case 'INCOMPLETE_REMINDER_DUE': handleIncompleteReminder(packet); break;
      case 'MARKETING_OUTREACH_DUE':  handleMarketingOutreach(packet); break;
      case 'SEND_MANUAL_MESSAGE':     handleManualMessage(packet); break;
      case 'NOTIFICATION_DELIVERED':  handleDelivered(packet); break;
      case 'NOTIFICATION_FAILED':     handleFailed(packet); break;
      case 'ORDER_UPDATED':
      case 'ORDER_UPDATE_FAILED':
      case 'CUSTOMER_CREATED':
      case 'CUSTOMER_UPDATED':
        break;
      default: break;
    }
  }

  return { onPacket: onPacket };
}


// ── workflow:orderLifecycle ─────────────────────────────────────────
// workflow:orderLifecycle: Pipelines 1–8
// Orchestrates across DATA, VAULT, SIGNAL buses.
// Ref: §1 (intake, deposit, pricing), §2 (stage advance, weight, cancel),
//      §3 (balance, storage fee, no-show/abandon).
//
// Pipeline 1: PIPELINE_ORDER_INTAKE
//   INTAKE_VALIDATED / INTAKE_DIRECT → fetch customer → create order
//   → deposit (charge or waive) → pricing (if cuts present)
//
// Pipeline 2: PIPELINE_STAGE_ADVANCE
//   STAGE_ADVANCE_COMMAND → fetch order → validate transition
//   → write stage → ORDER_STAGE_CHANGED or STAGE_ADVANCE_REJECTED

function createWorkflowOrderLifecycle(caps) {
  const LOOP = 'workflow:orderLifecycle';

  // ── Stage machine ──
  const STAGE_ORDER = [
    'checked_in', 'hanging', 'ready_to_butcher', 'butchering',
    'ready_for_packaging', 'packaging', 'stored', 'ready_for_pickup',
    'picked_up', 'closed'
  ];
  const SIDE_STATES = ['pending_customer_input', 'cancelled', 'abandoned'];
  const GATED_STAGES = { 'ready_to_butcher': true };
  const AUTO_ONLY_STAGES = { 'closed': true };

  // Stage index lookup for transition validation
  const STAGE_INDEX = {};
  for (let i = 0; i < STAGE_ORDER.length; i++) {
    STAGE_INDEX[STAGE_ORDER[i]] = i;
  }

  // ── Orchestration context ──
  // Tracks multi-step pipeline state keyed by traceId.
  // Populated at intake start, consumed at ORDER_CREATED, cleaned up after deposit.
  const intakeCtx = new Map();

  // Tracks no-show charge context keyed by traceId.
  const noShowCtx = new Map();

  // ── Pipeline 1: ORDER_INTAKE ──

  function handleIntake(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;

    // Step 1: Fetch customer by phone to check returning status + deposit waiver
    const customerResult = caps.bus.request(
      createPacket('FETCH_CUSTOMER', {
        lookupBy: 'phone',
        lookupValue: p.customerPhone || ''
      }, { traceId: traceId, source: LOOP })
    );

    let customerId;
    let depositWaiverStatus = false;

    if (customerResult.found) {
      // Returning customer — use existing record
      customerId = customerResult.customer.customerId;
      depositWaiverStatus = customerResult.customer.depositWaiverStatus || false;
    } else {
      // New customer — create
      customerId = generateId();
      caps.bus.emit('VAULT', createPacket('WRITE_CUSTOMER_CREATE', {
        customerId: customerId,
        name: p.customerName,
        phone: p.customerPhone || null,
        email: p.customerEmail || null,
        textOptIn: p.textOptIn || false,
        emailOptIn: p.emailOptIn || false,
        depositWaiverStatus: false
      }, { traceId: traceId, source: LOOP }));
    }

    // Step 2: Determine initial stage
    const hasCuts = p.cutSelections != null && Object.keys(p.cutSelections).length > 0;
    const initialStage = hasCuts ? 'checked_in' : 'pending_customer_input';

    // Step 3: Store context for downstream handlers (ORDER_CREATED, etc.)
    const orderId = generateId();
    const depositAmount = 75; // Flat $75, snapshotted from config

    intakeCtx.set(traceId, {
      orderId: orderId,
      customerId: customerId,
      depositWaiverStatus: depositWaiverStatus,
      depositAmount: depositAmount,
      hasCuts: hasCuts,
      cutSelections: p.cutSelections || null,
      optionalServices: p.optionalServices || null,
      animalType: p.animalType,
      intakeSource: packet.packetType === 'INTAKE_DIRECT' ? 'direct' : 'external',
      operatorId: p.operatorId || null
    });

    // Step 4: Write order to vault
    caps.bus.emit('VAULT', createPacket('WRITE_ORDER_CREATE', {
      orderId: orderId,
      customerId: customerId,
      tagNumber: p.tagNumber,
      intakeSource: intakeCtx.get(traceId).intakeSource,
      animalType: p.animalType,
      tenderloinRemoved: p.tenderloinRemoved || false,
      hangingWeightLbs: p.hangingWeightLbs || null,
      cutSelections: p.cutSelections || null,
      optionalServices: p.optionalServices || null,
      stage: initialStage,
      rushFlag: false,
      depositAmount: depositAmount,
      depositWaived: depositWaiverStatus,
      depositPaid: false
    }, { traceId: traceId, source: LOOP }));

    // ORDER_CREATED fires synchronously from vault → handleOrderCreated
  }

  function handleOrderCreated(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;
    const ctx = intakeCtx.get(traceId);

    // Guard: only process if we have intake context (our own order creation)
    if (!ctx) return;

    // Step 5: Audit — order creation
    caps.bus.emit('VAULT', createPacket('WRITE_AUDIT', {
      auditType: 'order_creation',
      orderId: p.orderId,
      operatorId: ctx.operatorId || 'system',
      orderState: { stage: p.stage, customerId: p.customerId }
    }, { traceId: traceId, source: LOOP }));

    // Step 6: Deposit
    if (ctx.depositWaiverStatus) {
      // Waiver path
      caps.bus.emit('DATA', createPacket('DEPOSIT_WAIVED', {
        orderId: p.orderId,
        customerId: p.customerId,
        waivedAmount: ctx.depositAmount
      }, { traceId: traceId, source: LOOP }));

      // Audit — deposit waiver
      caps.bus.emit('VAULT', createPacket('WRITE_AUDIT', {
        auditType: 'deposit_waiver',
        orderId: p.orderId,
        operatorId: ctx.operatorId || 'system',
        orderState: { stage: p.stage, depositWaived: true, waivedAmount: ctx.depositAmount }
      }, { traceId: traceId, source: LOOP }));
    } else {
      // Charge path — emit to signal:payments on SIGNAL bus
      caps.bus.emit('SIGNAL', createPacket('CHARGE_DEPOSIT', {
        orderId: p.orderId,
        customerId: p.customerId,
        amountCents: ctx.depositAmount * 100,
        currency: 'usd',
        paymentMethodId: 'pm_placeholder', // Collected at intake in production
        description: `Deposit — Order ${p.orderId}`,
        idempotencyKey: generateId()
      }, { traceId: traceId, source: LOOP }));

      // DEPOSIT_CHARGED or DEPOSIT_FAILED fires sync → handled below
    }

    // Step 7: If cut selections present, request pricing
    if (ctx.hasCuts) {
      caps.bus.emit('DATA', createPacket('PRICING_REQUESTED', {
        orderId: p.orderId,
        animalType: ctx.animalType,
        hangingWeightLbs: null, // Not yet recorded at intake
        cutSelections: ctx.cutSelections,
        optionalServices: ctx.optionalServices,
        depositAmount: ctx.depositAmount
      }, { traceId: traceId, source: LOOP }));
    }

    // Clean up context
    intakeCtx.delete(traceId);
  }

  function handleDepositCharged(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;

    // Update order: depositPaid = true, store stripe references
    caps.bus.emit('VAULT', createPacket('WRITE_ORDER_UPDATE', {
      orderId: p.orderId,
      updates: {
        depositPaid: true,
        stripeChargeIds: [p.stripeChargeId],
        stripeCustomerId: p.stripeCustomerId
      }
    }, { traceId: traceId, source: LOOP }));

    // Audit — deposit charged
    caps.bus.emit('VAULT', createPacket('WRITE_AUDIT', {
      auditType: 'deposit_charged',
      orderId: p.orderId,
      operatorId: 'system',
      orderState: { depositPaid: true, amountCents: p.amountCents, stripeChargeId: p.stripeChargeId }
    }, { traceId: traceId, source: LOOP }));
  }

  function handleDepositFailed(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;

    // Order stays depositPaid: false. Audit the failure.
    caps.bus.emit('VAULT', createPacket('WRITE_AUDIT', {
      auditType: 'deposit_failed',
      orderId: p.orderId,
      operatorId: 'system',
      orderState: { depositPaid: false, failureReason: p.failureReason }
    }, { traceId: traceId, source: LOOP }));
  }

  function handleOrderPriced(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;

    // Write pricing snapshot to order
    caps.bus.emit('VAULT', createPacket('WRITE_ORDER_UPDATE', {
      orderId: p.orderId,
      updates: {
        pricingSnapshot: p.pricingSnapshot
      }
    }, { traceId: traceId, source: LOOP }));

    // Check Ready to Butcher gate after pricing write
    checkRTBGate(p.orderId, traceId);
  }

  function handleLateCuts(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;

    // Write cut selections to order
    caps.bus.emit('VAULT', createPacket('WRITE_ORDER_UPDATE', {
      orderId: p.orderId,
      updates: {
        cutSelections: p.cutSelections,
        optionalServices: p.optionalServices || null,
        stage: 'checked_in' // Exit pending_customer_input
      }
    }, { traceId: traceId, source: LOOP }));

    // Pull order for pricing request fields
    const orderResult = caps.bus.request(
      createPacket('FETCH_ORDER', { orderId: p.orderId },
        { traceId: traceId, source: LOOP })
    );

    if (!orderResult.found) return;
    const order = orderResult.order;

    // Emit pricing request
    caps.bus.emit('DATA', createPacket('PRICING_REQUESTED', {
      orderId: p.orderId,
      animalType: order.animalType,
      hangingWeightLbs: order.hangingWeightLbs || null,
      cutSelections: p.cutSelections,
      optionalServices: p.optionalServices || null,
      depositAmount: order.depositAmount || 75
    }, { traceId: traceId, source: LOOP }));
  }

  // ── Ready to Butcher gate ──
  // Checks if both conditions are met: weight recorded AND order priced.
  // If so and order is in checked_in or hanging, auto-advances to ready_to_butcher.
  // Called after pricing write (Pipeline 1) and weight recording (Pipeline 3, future).

  function checkRTBGate(orderId, traceId) {
    const orderResult = caps.bus.request(
      createPacket('FETCH_ORDER', { orderId: orderId },
        { traceId: traceId, source: LOOP })
    );

    if (!orderResult.found) return;
    const order = orderResult.order;

    // Gate conditions: weight > 0 AND pricing snapshot exists
    const hasWeight = order.hangingWeightLbs != null && order.hangingWeightLbs > 0;
    const hasPricing = order.pricingSnapshot != null;

    if (!hasWeight || !hasPricing) return;

    // Only auto-advance from checked_in or hanging
    if (order.stage !== 'checked_in' && order.stage !== 'hanging') return;

    // Auto-advance to ready_to_butcher
    executeStageAdvance(orderId, order.stage, 'ready_to_butcher', 'system', traceId);
  }

  // ── Pipeline 2: STAGE_ADVANCE ──

  function handleStageAdvance(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;

    const { orderId, targetStage: requestedTarget, operatorId } = p;

    // Auto-compute target if not specified (dashboard omits it)
    // Resolved after order fetch; pre-fetch checks use requestedTarget directly.

    // Validate targetStage is not closed (auto-only)
    if (AUTO_ONLY_STAGES[requestedTarget]) {
      caps.bus.emit('DATA', createPacket('STAGE_ADVANCE_REJECTED', {
        orderId: orderId,
        attemptedTargetStage: requestedTarget,
        currentStage: 'unknown',
        reason: 'Cannot advance directly to Closed — auto-triggered only'
      }, { traceId: traceId, source: LOOP }));
      return;
    }

    // Pull order
    const orderResult = caps.bus.request(
      createPacket('FETCH_ORDER', { orderId: orderId },
        { traceId: traceId, source: LOOP })
    );

    if (!orderResult.found) {
      caps.bus.emit('DATA', createPacket('STAGE_ADVANCE_REJECTED', {
        orderId: orderId,
        attemptedTargetStage: requestedTarget,
        currentStage: 'unknown',
        reason: 'Order not found'
      }, { traceId: traceId, source: LOOP }));
      return;
    }

    const order = orderResult.order;
    const currentStage = order.stage;

    // Resolve targetStage: use explicit value if provided, otherwise next in pipeline
    const currentIdx = STAGE_INDEX[currentStage];
    const targetStage = requestedTarget || (currentIdx !== undefined ? STAGE_ORDER[currentIdx + 1] : undefined);

    // Check side states
    if (SIDE_STATES.includes(currentStage)) {
      caps.bus.emit('DATA', createPacket('STAGE_ADVANCE_REJECTED', {
        orderId: orderId,
        attemptedTargetStage: targetStage,
        currentStage: currentStage,
        reason: `Order is in ${currentStage} state`
      }, { traceId: traceId, source: LOOP }));
      return;
    }

    // Check sequential: target must be the next stage in the pipeline
    const targetIdx = STAGE_INDEX[targetStage];

    if (currentIdx === undefined || targetIdx === undefined || targetIdx !== currentIdx + 1) {
      caps.bus.emit('DATA', createPacket('STAGE_ADVANCE_REJECTED', {
        orderId: orderId,
        attemptedTargetStage: targetStage,
        currentStage: currentStage,
        reason: `Cannot skip stages: order is in ${currentStage}, target is ${targetStage}`
      }, { traceId: traceId, source: LOOP }));
      return;
    }

    // Check gate conditions for ready_to_butcher
    if (GATED_STAGES[targetStage]) {
      const hasWeight = order.hangingWeightLbs != null && order.hangingWeightLbs > 0;
      const hasPricing = order.pricingSnapshot != null;

      if (!hasWeight && !hasPricing) {
        caps.bus.emit('DATA', createPacket('STAGE_ADVANCE_REJECTED', {
          orderId: orderId,
          attemptedTargetStage: targetStage,
          currentStage: currentStage,
          reason: 'Gate condition not met: hanging weight not recorded and order not priced'
        }, { traceId: traceId, source: LOOP }));
        return;
      }
      if (!hasWeight) {
        caps.bus.emit('DATA', createPacket('STAGE_ADVANCE_REJECTED', {
          orderId: orderId,
          attemptedTargetStage: targetStage,
          currentStage: currentStage,
          reason: 'Gate condition not met: hanging weight not recorded'
        }, { traceId: traceId, source: LOOP }));
        return;
      }
      if (!hasPricing) {
        caps.bus.emit('DATA', createPacket('STAGE_ADVANCE_REJECTED', {
          orderId: orderId,
          attemptedTargetStage: targetStage,
          currentStage: currentStage,
          reason: 'Gate condition not met: order not priced'
        }, { traceId: traceId, source: LOOP }));
        return;
      }
    }

    // All validation passed — execute the advance
    executeStageAdvance(orderId, currentStage, targetStage, operatorId, traceId);
  }

  // ── Shared: Execute stage advance ──
  // Used by STAGE_ADVANCE_COMMAND handler and RTB gate auto-advance.
  // Writes the stage update, emits ORDER_STAGE_CHANGED, writes audit.

  function executeStageAdvance(orderId, previousStage, newStage, triggeredBy, traceId) {
    // Build updates — include lifecycle timestamps for specific stages
    const updates = { stage: newStage };
    if (newStage === 'ready_for_pickup') {
      updates.readyForPickupAt = now();
    } else if (newStage === 'picked_up') {
      updates.pickedUpAt = now();
    } else if (newStage === 'closed') {
      updates.closedAt = now();
    }

    // Write stage update to vault
    caps.bus.emit('VAULT', createPacket('WRITE_ORDER_UPDATE', {
      orderId: orderId,
      updates: updates
    }, { traceId: traceId, source: LOOP }));

    // Emit semantic business event
    caps.bus.emit('DATA', createPacket('ORDER_STAGE_CHANGED', {
      orderId: orderId,
      previousStage: previousStage,
      newStage: newStage,
      triggeredBy: triggeredBy,
      timestamp: now()
    }, { traceId: traceId, source: LOOP }));

    // Audit — stage transition
    caps.bus.emit('VAULT', createPacket('WRITE_AUDIT', {
      auditType: 'stage_transition',
      orderId: orderId,
      operatorId: triggeredBy,
      orderState: { previousStage: previousStage, newStage: newStage },
      eventDetail: { previousStage: previousStage, newStage: newStage, triggeredBy: triggeredBy }
    }, { traceId: traceId, source: LOOP }));
  }

  // ── Pipeline 3: WEIGHT_RECORDING ──
  // §2 entries 35 + reuses. Dashboard sends WEIGHT_RECORDED.
  // Writes weight to order, audits unconditionally, checks RTB gate.

  function handleWeightRecorded(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;

    const { orderId, hangingWeightLbs, operatorId } = p;

    // Pull current order
    const orderResult = caps.bus.request(
      createPacket('FETCH_ORDER', { orderId: orderId },
        { traceId: traceId, source: LOOP })
    );

    if (!orderResult.found) {
      // No rejection event for weight — order simply not found
      return;
    }

    const order = orderResult.order;

    // Write weight to order
    caps.bus.emit('VAULT', createPacket('WRITE_ORDER_UPDATE', {
      orderId: orderId,
      updates: { hangingWeightLbs: hangingWeightLbs }
    }, { traceId: traceId, source: LOOP }));

    // Audit — weight recording (unconditional, independent of gate)
    caps.bus.emit('VAULT', createPacket('WRITE_AUDIT', {
      auditType: 'weight_recording',
      orderId: orderId,
      operatorId: operatorId || 'system',
      orderState: {
        stage: order.stage,
        hangingWeightLbs: hangingWeightLbs,
        previousWeight: order.hangingWeightLbs || null
      }
    }, { traceId: traceId, source: LOOP }));

    // Re-trigger pricing with actual weight (intake pricing runs with null weight)
    if (order.cutSelections && Object.keys(order.cutSelections).length > 0) {
      caps.bus.emit('DATA', createPacket('PRICING_REQUESTED', {
        orderId: orderId,
        animalType: order.animalType,
        hangingWeightLbs: hangingWeightLbs,
        cutSelections: order.cutSelections,
        optionalServices: order.optionalServices || null,
        depositAmount: order.depositAmount || 75
      }, { traceId: traceId, source: LOOP }));
    }

    // Check RTB gate — the second trigger point (Pipeline 1 handles pricing trigger)
    checkRTBGate(orderId, traceId);
  }

  // ── Pipeline 5: CANCELLATION ──
  // §2 entries 36–38. Manual cancel from dashboard.
  // Valid only before butchering: checked_in, pending_customer_input, hanging, ready_to_butcher.
  // Full deposit forfeit. No refund routing.

  const CANCELLABLE_STAGES = ['checked_in', 'pending_customer_input', 'hanging', 'ready_to_butcher'];

  function handleCancelOrder(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;

    const { orderId, operatorId, reason } = p;

    // Pull current order
    const orderResult = caps.bus.request(
      createPacket('FETCH_ORDER', { orderId: orderId },
        { traceId: traceId, source: LOOP })
    );

    if (!orderResult.found) {
      caps.bus.emit('DATA', createPacket('CANCEL_REJECTED', {
        orderId: orderId,
        currentStage: 'unknown',
        reason: 'Order not found'
      }, { traceId: traceId, source: LOOP }));
      return;
    }

    const order = orderResult.order;

    // Validate cancellable stage
    if (!CANCELLABLE_STAGES.includes(order.stage)) {
      caps.bus.emit('DATA', createPacket('CANCEL_REJECTED', {
        orderId: orderId,
        currentStage: order.stage,
        reason: `Order is in ${order.stage} stage — cancellation not permitted after butchering begins`
      }, { traceId: traceId, source: LOOP }));
      return;
    }

    const previousStage = order.stage;

    // Write cancellation to vault
    caps.bus.emit('VAULT', createPacket('WRITE_ORDER_UPDATE', {
      orderId: orderId,
      updates: { stage: 'cancelled', cancelledAt: now() }
    }, { traceId: traceId, source: LOOP }));

    // Emit semantic business event (NOT ORDER_STAGE_CHANGED — cancellation is a side state)
    caps.bus.emit('DATA', createPacket('ORDER_CANCELLED', {
      orderId: orderId,
      cancelledBy: operatorId || 'system',
      previousStage: previousStage,
      depositForfeited: true,
      reason: reason || null,
      timestamp: now()
    }, { traceId: traceId, source: LOOP }));

    // Audit — cancellation
    caps.bus.emit('VAULT', createPacket('WRITE_AUDIT', {
      auditType: 'cancellation',
      orderId: orderId,
      operatorId: operatorId || 'system',
      orderState: { previousStage: previousStage, stage: 'cancelled', depositForfeited: true }
    }, { traceId: traceId, source: LOOP }));
  }

  // ── Pipeline 6: PICKUP_CLOSE (Balance Charge + Auto-Close) ──
  // Triggered by ORDER_STAGE_CHANGED self-loop.
  // At ready_for_pickup: snapshot storage fee rate from config.
  // At picked_up: calculate balance, charge or skip, then auto-close.
  // Auto-close waits for balance charge completion (not success).

  function handleOrderStageChanged(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;

    if (p.newStage === 'ready_for_pickup') {
      // Snapshot storage fee rate into order record
      const configResult = caps.bus.request(
        createPacket('FETCH_CONFIG', { configKeys: ['storage'] },
          { traceId: traceId, source: LOOP })
      );
      if (configResult.config && configResult.config.storage) {
        caps.bus.emit('VAULT', createPacket('WRITE_ORDER_UPDATE', {
          orderId: p.orderId,
          updates: { storageFeeRateCents: configResult.config.storage.feePerWeek * 100 }
        }, { traceId: traceId, source: LOOP }));
      }
    }

    if (p.newStage === 'picked_up') {
      // Pull order for pricing snapshot
      const orderResult = caps.bus.request(
        createPacket('FETCH_ORDER', { orderId: p.orderId },
          { traceId: traceId, source: LOOP })
      );
      if (!orderResult.found) return;
      const order = orderResult.order;

      const balanceCents = (order.pricingSnapshot && order.pricingSnapshot.balanceDue != null)
        ? Math.round(order.pricingSnapshot.balanceDue * 100)
        : 0;

      if (balanceCents <= 0) {
        // Zero balance — skip charge, auto-close immediately
        executeStageAdvance(p.orderId, 'picked_up', 'closed', 'system', traceId);
      } else {
        // Charge balance — BALANCE_CHARGED/FAILED fires sync → handleBalanceCharged/Failed
        caps.bus.emit('SIGNAL', createPacket('CHARGE_BALANCE', {
          orderId: p.orderId,
          customerId: order.customerId,
          amountCents: balanceCents,
          stripeCustomerId: order.stripeCustomerId || null,
          currency: 'usd',
          description: `Balance — Order ${p.orderId}`,
          idempotencyKey: generateId()
        }, { traceId: traceId, source: LOOP }));
        // BALANCE_CHARGED or BALANCE_FAILED fires sync → handled below
      }
    }
  }

  function handleBalanceCharged(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;

    // Write stripe references to order
    caps.bus.emit('VAULT', createPacket('WRITE_ORDER_UPDATE', {
      orderId: p.orderId,
      updates: {
        balancePaid: true,
        stripeChargeIds: [p.stripeChargeId] // Appended in production; array for now
      }
    }, { traceId: traceId, source: LOOP }));

    // Audit — balance charged
    caps.bus.emit('VAULT', createPacket('WRITE_AUDIT', {
      auditType: 'balance_charged',
      orderId: p.orderId,
      operatorId: 'system',
      orderState: { amountCents: p.amountCents, stripeChargeId: p.stripeChargeId }
    }, { traceId: traceId, source: LOOP }));

    // Auto-close: charge completed (successfully)
    executeStageAdvance(p.orderId, 'picked_up', 'closed', 'system', traceId);
  }

  function handleBalanceFailed(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;

    // Audit — balance failed
    caps.bus.emit('VAULT', createPacket('WRITE_AUDIT', {
      auditType: 'balance_failed',
      orderId: p.orderId,
      operatorId: 'system',
      orderState: { amountCents: p.amountCents, failureReason: p.failureReason }
    }, { traceId: traceId, source: LOOP }));

    // Emit payment alert for dashboard
    caps.bus.emit('DATA', createPacket('PAYMENT_ALERT', {
      orderId: p.orderId,
      alertType: 'balance_charge_failed',
      amountCents: p.amountCents,
      failureReason: p.failureReason,
      timestamp: now()
    }, { traceId: traceId, source: LOOP }));

    // Auto-close: charge completed (with failure — does NOT block close)
    executeStageAdvance(p.orderId, 'picked_up', 'closed', 'system', traceId);
  }

  // ── Pipeline 7: STORAGE_FEE ──
  // Triggered by STORAGE_FEE_DUE from compute:dailyScan.
  // Pull order, charge from snapshotted rate, update lastStorageFeeChargedAt.

  function handleStorageFeeDue(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;

    // Pull order
    const orderResult = caps.bus.request(
      createPacket('FETCH_ORDER', { orderId: p.orderId },
        { traceId: traceId, source: LOOP })
    );
    if (!orderResult.found) return;
    const order = orderResult.order;

    // Calculate fee from snapshotted rate
    const feeCents = order.storageFeeRateCents || 5000; // Fallback to $50 default

    // Emit charge
    caps.bus.emit('SIGNAL', createPacket('CHARGE_STORAGE_FEE', {
      orderId: p.orderId,
      customerId: order.customerId,
      amountCents: feeCents,
      stripeCustomerId: order.stripeCustomerId || null,
      storageWeekNumber: p.storageWeekNumber || 1,
      currency: 'usd',
      description: `Storage fee week ${p.storageWeekNumber || 1} — Order ${p.orderId}`,
      idempotencyKey: generateId()
    }, { traceId: traceId, source: LOOP }));
    // STORAGE_FEE_CHARGED or STORAGE_FEE_FAILED fires sync
  }

  function handleStorageFeeCharged(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;

    // Pull order to get current accumulated storage fees
    const orderResult = caps.bus.request(
      createPacket('FETCH_ORDER', { orderId: p.orderId },
        { traceId: traceId, source: LOOP })
    );
    const currentTotal = orderResult.found ? (orderResult.order.storageFeesChargedCents || 0) : 0;

    // Update order: lastStorageFeeChargedAt + accumulate total
    caps.bus.emit('VAULT', createPacket('WRITE_ORDER_UPDATE', {
      orderId: p.orderId,
      updates: {
        lastStorageFeeChargedAt: now(),
        storageFeesChargedCents: currentTotal + p.amountCents
      }
    }, { traceId: traceId, source: LOOP }));

    // Audit — storage fee charged
    caps.bus.emit('VAULT', createPacket('WRITE_AUDIT', {
      auditType: 'storage_fee_charged',
      orderId: p.orderId,
      operatorId: 'system',
      orderState: { amountCents: p.amountCents, stripeChargeId: p.stripeChargeId }
    }, { traceId: traceId, source: LOOP }));
  }

  function handleStorageFeeFailed(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;

    // Audit — storage fee failed
    caps.bus.emit('VAULT', createPacket('WRITE_AUDIT', {
      auditType: 'storage_fee_failed',
      orderId: p.orderId,
      operatorId: 'system',
      orderState: { amountCents: p.amountCents, failureReason: p.failureReason }
    }, { traceId: traceId, source: LOOP }));

    // Alert dashboard
    caps.bus.emit('DATA', createPacket('PAYMENT_ALERT', {
      orderId: p.orderId,
      alertType: 'storage_fee_failed',
      amountCents: p.amountCents,
      failureReason: p.failureReason,
      timestamp: now()
    }, { traceId: traceId, source: LOOP }));
  }

  // ── Pipeline 8: ABANDONMENT (No-Show) ──
  // Triggered by NO_SHOW_DEADLINE_REACHED from compute:dailyScan.
  // Charge remaining balance, then mark abandoned regardless of charge result.

  function handleNoShowDeadline(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;

    // Pull order
    const orderResult = caps.bus.request(
      createPacket('FETCH_ORDER', { orderId: p.orderId },
        { traceId: traceId, source: LOOP })
    );
    if (!orderResult.found) return;
    const order = orderResult.order;

    // Calculate remaining balance: total - deposit - storage fees paid
    const total = (order.pricingSnapshot && order.pricingSnapshot.total) || 0;
    const depositPaid = order.depositPaid ? (order.depositAmount || 0) : 0;
    const storagePaid = (order.storageFeesChargedCents || 0) / 100;
    const remainingCents = Math.round(Math.max(0, total - depositPaid - storagePaid) * 100);

    // Store context for the charge result handler
    noShowCtx.set(traceId, {
      orderId: p.orderId,
      previousStage: order.stage
    });

    if (remainingCents <= 0) {
      // No balance to charge — proceed directly to abandonment
      executeAbandonment(p.orderId, order.stage, traceId);
      noShowCtx.delete(traceId);
    } else {
      // Charge remaining balance
      caps.bus.emit('SIGNAL', createPacket('CHARGE_NOSHOW_BALANCE', {
        orderId: p.orderId,
        customerId: order.customerId,
        amountCents: remainingCents,
        stripeCustomerId: order.stripeCustomerId || null,
        currency: 'usd',
        description: `No-show balance — Order ${p.orderId}`,
        idempotencyKey: generateId()
      }, { traceId: traceId, source: LOOP }));
      // NOSHOW_BALANCE_CHARGED or NOSHOW_BALANCE_FAILED fires sync
    }
  }

  function handleNoShowCharged(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;
    const ctx = noShowCtx.get(traceId);

    // Audit — no-show charge success
    caps.bus.emit('VAULT', createPacket('WRITE_AUDIT', {
      auditType: 'noshow_balance_charged',
      orderId: p.orderId,
      operatorId: 'system',
      orderState: { amountCents: p.amountCents, stripeChargeId: p.stripeChargeId }
    }, { traceId: traceId, source: LOOP }));

    // Proceed to abandonment
    const previousStage = ctx ? ctx.previousStage : 'ready_for_pickup';
    executeAbandonment(p.orderId, previousStage, traceId);
    noShowCtx.delete(traceId);
  }

  function handleNoShowFailed(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;
    const ctx = noShowCtx.get(traceId);

    // Audit — no-show charge failed
    caps.bus.emit('VAULT', createPacket('WRITE_AUDIT', {
      auditType: 'noshow_balance_failed',
      orderId: p.orderId,
      operatorId: 'system',
      orderState: { amountCents: p.amountCents, failureReason: p.failureReason }
    }, { traceId: traceId, source: LOOP }));

    // Alert dashboard
    caps.bus.emit('DATA', createPacket('PAYMENT_ALERT', {
      orderId: p.orderId,
      alertType: 'noshow_charge_failed',
      amountCents: p.amountCents,
      failureReason: p.failureReason,
      timestamp: now()
    }, { traceId: traceId, source: LOOP }));

    // Proceed to abandonment regardless of charge failure
    const previousStage = ctx ? ctx.previousStage : 'ready_for_pickup';
    executeAbandonment(p.orderId, previousStage, traceId);
    noShowCtx.delete(traceId);
  }

  // ── Shared: Execute abandonment ──
  // Writes abandoned status, emits ORDER_ABANDONED, writes audit.
  // Distinct from executeStageAdvance — abandonment is a side state, not a pipeline step.

  function executeAbandonment(orderId, previousStage, traceId) {
    // Write abandoned status to vault
    caps.bus.emit('VAULT', createPacket('WRITE_ORDER_UPDATE', {
      orderId: orderId,
      updates: { stage: 'abandoned', abandonedAt: now() }
    }, { traceId: traceId, source: LOOP }));

    // Emit semantic business event (NOT ORDER_STAGE_CHANGED)
    caps.bus.emit('DATA', createPacket('ORDER_ABANDONED', {
      orderId: orderId,
      previousStage: previousStage,
      timestamp: now()
    }, { traceId: traceId, source: LOOP }));

    // Audit — abandonment
    caps.bus.emit('VAULT', createPacket('WRITE_AUDIT', {
      auditType: 'abandonment',
      orderId: orderId,
      operatorId: 'system',
      orderState: { previousStage: previousStage, stage: 'abandoned' }
    }, { traceId: traceId, source: LOOP }));
  }

  // ── Pipeline 9: PAYMENT_EVENT (Stripe webhook processing) ──
  // Triggered by PAYMENT_EVENT from working:paymentWebhook (§3 #48).
  // Looks up order via stripeChargeIds alternate key, determines alert type,
  // emits PAYMENT_ALERT (§3 #49), audits unconditionally.
  // Ref: PCR OP-046 (PAYMENT_EVENT), OP-047 (PAYMENT_ALERT).

  // Stripe event type → alert type mapping
  const STRIPE_ALERT_MAP = {
    'charge.dispute.created':      'dispute_filed',
    'customer.source.expiring':    'card_expiring',
    'charge.refunded':             'unexpected_refund',
    'charge.dispute.funds_withdrawn': 'charge_reversed'
  };

  function handlePaymentEvent(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;

    const alertType = STRIPE_ALERT_MAP[p.stripeEventType] || 'unmatched_event';

    // Look up order by relatedChargeId (alternate key on stripeChargeIds array)
    let orderId = null;
    let orderFound = false;

    if (p.relatedChargeId) {
      const orderResult = caps.bus.request(
        createPacket('FETCH_ORDER', {
          lookupBy: 'stripeChargeIds',
          lookupValue: p.relatedChargeId
        }, { traceId: traceId, source: LOOP })
      );
      if (orderResult.found) {
        orderId = orderResult.order.orderId;
        orderFound = true;
      }
    }

    // Build human-readable summary
    let summary;
    const chargeRef = p.relatedChargeId || 'unknown';
    if (alertType === 'dispute_filed') {
      summary = `Dispute filed on charge ${chargeRef}` + (orderId ? ` (Order ${orderId})` : '');
    } else if (alertType === 'card_expiring') {
      summary = `Card expiring for customer ${p.relatedCustomerId || 'unknown'}`;
    } else if (alertType === 'unexpected_refund') {
      summary = `Refund issued on charge ${chargeRef}` + (orderId ? ` (Order ${orderId})` : '');
    } else if (alertType === 'charge_reversed') {
      summary = `Charge reversed on ${chargeRef}` + (orderId ? ` (Order ${orderId})` : '');
    } else {
      summary = `Unrecognized Stripe event: ${p.stripeEventType} (${chargeRef})`;
    }

    // Determine action required and deadline
    const actionRequired = alertType === 'dispute_filed';
    const deadline = (actionRequired && p.eventData && p.eventData.evidence_due_by)
      ? p.eventData.evidence_due_by
      : null;

    // Emit PAYMENT_ALERT (§3 #49)
    caps.bus.emit('DATA', createPacket('PAYMENT_ALERT', {
      orderId: orderId,
      alertType: alertType,
      stripeEventId: p.stripeEventId,
      summary: summary,
      actionRequired: actionRequired,
      deadline: deadline
    }, { traceId: traceId, source: LOOP }));

    // Audit — every webhook gets an audit record regardless of outcome
    caps.bus.emit('VAULT', createPacket('WRITE_AUDIT', {
      auditType: 'payment',
      orderId: orderId,
      operatorId: 'system',
      orderState: {
        stripeEventId: p.stripeEventId,
        stripeEventType: p.stripeEventType,
        alertType: alertType,
        orderFound: orderFound
      },
      eventDetail: {
        relatedChargeId: p.relatedChargeId || null,
        relatedCustomerId: p.relatedCustomerId || null,
        eventData: p.eventData
      }
    }, { traceId: traceId, source: LOOP }));
  }

  // ── CUSTOMER_UPDATE_COMMAND handler ──
  // Validates field updates, then writes to vault:customers.
  // Ref: §6 #90 → #92 (WRITE_CUSTOMER_UPDATE).
  function handleCustomerUpdateCommand(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;

    if (!p.customerId) {
      caps.bus.emit('DATA', createPacket('CUSTOMER_UPDATE_FAILED', {
        customerId: null,
        failureReason: 'MISSING_CUSTOMER_ID',
        failureDetail: 'customerId is required'
      }, { traceId: traceId, source: LOOP }));
      return;
    }

    if (!p.updates || typeof p.updates !== 'object' || Object.keys(p.updates).length === 0) {
      caps.bus.emit('DATA', createPacket('CUSTOMER_UPDATE_FAILED', {
        customerId: p.customerId,
        failureReason: 'MISSING_UPDATES',
        failureDetail: 'updates object is required and must be non-empty'
      }, { traceId: traceId, source: LOOP }));
      return;
    }

    // Field-level validation
    const errors = [];
    const CUST_PHONE_PATTERN = /^\d{3}-\d{3}-\d{4}$/;

    if (p.updates.phone !== undefined && p.updates.phone !== null) {
      if (!CUST_PHONE_PATTERN.test(p.updates.phone)) {
        errors.push('phone must match format XXX-XXX-XXXX');
      }
    }
    if (p.updates.name !== undefined) {
      if (typeof p.updates.name !== 'string' || p.updates.name.length > 200) {
        errors.push('name must be a string under 200 characters');
      }
    }
    if (p.updates.email !== undefined && p.updates.email !== null) {
      if (typeof p.updates.email !== 'string' || !p.updates.email.includes('@')) {
        errors.push('email must be a valid email address');
      }
    }

    if (errors.length > 0) {
      caps.bus.emit('DATA', createPacket('CUSTOMER_UPDATE_FAILED', {
        customerId: p.customerId,
        failureReason: 'VALIDATION_FAILED',
        failureDetail: errors.join('; ')
      }, { traceId: traceId, source: LOOP }));
      return;
    }

    // Write to vault
    caps.bus.emit('VAULT', createPacket('WRITE_CUSTOMER_UPDATE', {
      customerId: p.customerId,
      updates: p.updates
    }, { traceId: traceId, source: LOOP }));
  }

  // ── CONFIG_CHANGE_COMMAND handler ──
  // Validates config change, then writes to vault:config.
  // Ref: §6 #94 → #96 (WRITE_CONFIG_UPDATE).
  function handleConfigChangeCommand(packet) {
    const p = packet.payload;
    const traceId = packet.traceId;

    if (!p.configKey) {
      caps.bus.emit('DATA', createPacket('CONFIG_UPDATE_FAILED', {
        configKey: 'unknown',
        updatePath: p.updatePath || 'unknown',
        failureReason: 'configKey is required'
      }, { traceId: traceId, source: LOOP }));
      return;
    }

    if (!p.changes || typeof p.changes !== 'object' || Object.keys(p.changes).length === 0) {
      caps.bus.emit('DATA', createPacket('CONFIG_UPDATE_FAILED', {
        configKey: p.configKey,
        updatePath: 'unknown',
        failureReason: 'changes object is required and must be non-empty'
      }, { traceId: traceId, source: LOOP }));
      return;
    }

    // Apply each change as a separate WRITE_CONFIG_UPDATE
    for (const [updatePath, value] of Object.entries(p.changes)) {
      caps.bus.emit('VAULT', createPacket('WRITE_CONFIG_UPDATE', {
        configKey: p.configKey,
        updatePath: updatePath,
        value: value
      }, { traceId: traceId, source: LOOP }));
    }
  }

  // ── Packet router ──

  function onPacket(packet) {
    switch (packet.packetType) {
      // Pipeline 1: ORDER_INTAKE
      case 'INTAKE_VALIDATED':
      case 'INTAKE_DIRECT':
        handleIntake(packet);
        break;
      case 'ORDER_CREATED':
        handleOrderCreated(packet);
        break;
      case 'DEPOSIT_CHARGED':
        handleDepositCharged(packet);
        break;
      case 'DEPOSIT_FAILED':
        handleDepositFailed(packet);
        break;
      case 'ORDER_PRICED':
        handleOrderPriced(packet);
        break;
      case 'CUTS_VALIDATED':
      case 'CUTS_DIRECT':
        handleLateCuts(packet);
        break;

      // Pipeline 2: STAGE_ADVANCE
      case 'STAGE_ADVANCE_COMMAND':
        handleStageAdvance(packet);
        break;

      // Pipeline 3: WEIGHT_RECORDING
      case 'WEIGHT_RECORDED':
        handleWeightRecorded(packet);
        break;

      // Pipeline 5: CANCELLATION
      case 'CANCEL_ORDER':
        handleCancelOrder(packet);
        break;

      // Pipeline 6: PICKUP_CLOSE (auto-close after picked_up)
      case 'ORDER_STAGE_CHANGED':
        handleOrderStageChanged(packet);
        break;
      case 'BALANCE_CHARGED':
        handleBalanceCharged(packet);
        break;
      case 'BALANCE_FAILED':
        handleBalanceFailed(packet);
        break;

      // Pipeline 7: STORAGE_FEE
      case 'STORAGE_FEE_DUE':
        handleStorageFeeDue(packet);
        break;
      case 'STORAGE_FEE_CHARGED':
        handleStorageFeeCharged(packet);
        break;
      case 'STORAGE_FEE_FAILED':
        handleStorageFeeFailed(packet);
        break;

      // Pipeline 8: ABANDONMENT
      case 'NO_SHOW_DEADLINE_REACHED':
        handleNoShowDeadline(packet);
        break;
      case 'NOSHOW_BALANCE_CHARGED':
        handleNoShowCharged(packet);
        break;
      case 'NOSHOW_BALANCE_FAILED':
        handleNoShowFailed(packet);
        break;

      // Pipeline 9: PAYMENT_EVENT (Stripe webhook)
      case 'PAYMENT_EVENT':
        handlePaymentEvent(packet);
        break;

      // Ignored packet types (routed here but consumed by other loops or informational)
      case 'ORDER_UPDATED':
      case 'ORDER_UPDATE_FAILED':
      case 'ORDER_CREATE_FAILED':
      case 'CUSTOMER_CREATED':
      case 'CUSTOMER_CREATE_FAILED':
      case 'PRICING_REJECTED':
        break;

      // Pipeline 10: CUSTOMER_UPDATE
      case 'CUSTOMER_UPDATE_COMMAND':
        handleCustomerUpdateCommand(packet);
        break;

      // Pipeline 11: CONFIG_CHANGE
      case 'CONFIG_CHANGE_COMMAND':
        handleConfigChangeCommand(packet);
        break;

      default:
        // Unknown packet type — no-op
        break;
    }
  }

  return { onPacket: onPacket };
}


// ────────────────────────────────────────────────────────────────────
// SECTION 16A: ROUTING ENTRIES — WORKFLOW LOOPS (TIER 5)
// Registered during init. Entry numbers per §1 and §2 routing tables.
// ────────────────────────────────────────────────────────────────────

function registerWorkflowOrderLifecycleRoutes(routing) {
  // §1 #16 — DEPOSIT_WAIVED (declare, workflow:orderLifecycle → presentation:dashboard)
  routing.register({ entryNumber: 16, packetType: 'DEPOSIT_WAIVED',
    source: 'workflow:orderLifecycle', bus: 'DATA',
    destinations: ['presentation:dashboard'], mode: 'Push', priority: 'STANDARD' });

  // §2 #31 — STAGE_ADVANCE_COMMAND (declare, presentation:dashboard → workflow:orderLifecycle)
  routing.register({ entryNumber: 31, packetType: 'STAGE_ADVANCE_COMMAND',
    source: 'presentation:dashboard', bus: 'DATA',
    destinations: ['workflow:orderLifecycle'], mode: 'Push', priority: 'STANDARD' });

  // §2 #33 — ORDER_STAGE_CHANGED (declare, workflow:orderLifecycle → presentation:dashboard, workflow:notifications, workflow:orderLifecycle)
  routing.register({ entryNumber: 33, packetType: 'ORDER_STAGE_CHANGED',
    source: 'workflow:orderLifecycle', bus: 'DATA',
    destinations: ['presentation:dashboard', 'workflow:notifications', 'workflow:orderLifecycle'], mode: 'Push', priority: 'STANDARD' });

  // §2 #34 — STAGE_ADVANCE_REJECTED (declare, workflow:orderLifecycle → presentation:dashboard)
  routing.register({ entryNumber: 34, packetType: 'STAGE_ADVANCE_REJECTED',
    source: 'workflow:orderLifecycle', bus: 'DATA',
    destinations: ['presentation:dashboard'], mode: 'Push', priority: 'STANDARD' });

  // §2 #35 — WEIGHT_RECORDED (declare, presentation:dashboard → workflow:orderLifecycle)
  routing.register({ entryNumber: 35, packetType: 'WEIGHT_RECORDED',
    source: 'presentation:dashboard', bus: 'DATA',
    destinations: ['workflow:orderLifecycle'], mode: 'Push', priority: 'STANDARD' });

  // §2 #36 — CANCEL_ORDER (declare, presentation:dashboard → workflow:orderLifecycle)
  routing.register({ entryNumber: 36, packetType: 'CANCEL_ORDER',
    source: 'presentation:dashboard', bus: 'DATA',
    destinations: ['workflow:orderLifecycle'], mode: 'Push', priority: 'STANDARD' });

  // §2 #37 — ORDER_CANCELLED (declare, workflow:orderLifecycle → presentation:dashboard, workflow:notifications)
  routing.register({ entryNumber: 37, packetType: 'ORDER_CANCELLED',
    source: 'workflow:orderLifecycle', bus: 'DATA',
    destinations: ['presentation:dashboard', 'workflow:notifications'], mode: 'Push', priority: 'STANDARD' });

  // §2 #38 — CANCEL_REJECTED (declare, workflow:orderLifecycle → presentation:dashboard)
  routing.register({ entryNumber: 38, packetType: 'CANCEL_REJECTED',
    source: 'workflow:orderLifecycle', bus: 'DATA',
    destinations: ['presentation:dashboard'], mode: 'Push', priority: 'STANDARD' });

  // §5 #69 — ORDER_ABANDONED (declare, workflow:orderLifecycle → presentation:dashboard, workflow:notifications)
  routing.register({ entryNumber: 69, packetType: 'ORDER_ABANDONED',
    source: 'workflow:orderLifecycle', bus: 'DATA',
    destinations: ['presentation:dashboard', 'workflow:notifications'], mode: 'Push', priority: 'STANDARD' });

  // FETCH_CONFIG (supplementary, workflow:orderLifecycle → vault:config)
  // Needed for storage fee rate snapshot at ready_for_pickup (§3 design decision).
  routing.register({ entryNumber: 99, packetType: 'FETCH_CONFIG',
    source: 'workflow:orderLifecycle', bus: 'VAULT',
    destinations: ['vault:config'], mode: 'Pull', priority: 'STANDARD' });
}


function registerWorkflowNotificationsRoutes(routing) {
  // §4 #54 — FETCH_ORDER (declare, workflow:notifications → vault:orders)
  routing.register({ entryNumber: 54, packetType: 'FETCH_ORDER',
    source: 'workflow:notifications', bus: 'VAULT',
    destinations: ['vault:orders'], mode: 'Pull', priority: 'STANDARD' });

  // §4 #59 — NOTIFICATION_PERMANENTLY_FAILED (declare, workflow:notifications → presentation:dashboard)
  routing.register({ entryNumber: 59, packetType: 'NOTIFICATION_PERMANENTLY_FAILED',
    source: 'workflow:notifications', bus: 'DATA',
    destinations: ['presentation:dashboard'], mode: 'Push', priority: 'STANDARD' });

  // §4 #60 — SEND_MANUAL_MESSAGE (declare, presentation:dashboard → workflow:notifications)
  routing.register({ entryNumber: 60, packetType: 'SEND_MANUAL_MESSAGE',
    source: 'presentation:dashboard', bus: 'DATA',
    destinations: ['workflow:notifications'], mode: 'Push', priority: 'STANDARD' });

  // WRITE_AUDIT (supplementary, workflow:notifications → vault:snapshots)
  // §4 spec declares reuse of §1 #12 but routing is source-specific.
  routing.register({ entryNumber: 100, packetType: 'WRITE_AUDIT',
    source: 'workflow:notifications', bus: 'VAULT',
    destinations: ['vault:snapshots'], mode: 'Push', priority: 'STANDARD' });

  // §6 #90 — CUSTOMER_UPDATE_COMMAND (declare, presentation:dashboard → workflow:orderLifecycle)
  routing.register({ entryNumber: 90, packetType: 'CUSTOMER_UPDATE_COMMAND',
    source: 'presentation:dashboard', bus: 'DATA',
    destinations: ['workflow:orderLifecycle'], mode: 'Push', priority: 'STANDARD' });

  // §6 #94 — CONFIG_CHANGE_COMMAND (declare, presentation:dashboard → workflow:orderLifecycle)
  routing.register({ entryNumber: 94, packetType: 'CONFIG_CHANGE_COMMAND',
    source: 'presentation:dashboard', bus: 'DATA',
    destinations: ['workflow:orderLifecycle'], mode: 'Push', priority: 'STANDARD' });
}


// ────────────────────────────────────────────────────────────────────

function registerComputePricingRoutes(routing) {
  // §1 #18 — PRICING_REQUESTED (declare, workflow:orderLifecycle → compute:pricing)
  routing.register({ entryNumber: 18, packetType: 'PRICING_REQUESTED',
    source: 'workflow:orderLifecycle', bus: 'DATA',
    destinations: ['compute:pricing'], mode: 'Push', priority: 'STANDARD' });

  // §1 #20 — ORDER_PRICED (declare, compute:pricing → workflow:orderLifecycle)
  routing.register({ entryNumber: 20, packetType: 'ORDER_PRICED',
    source: 'compute:pricing', bus: 'DATA',
    destinations: ['workflow:orderLifecycle'], mode: 'Push', priority: 'STANDARD' });

  // §1 #21 — PRICING_REJECTED (declare, compute:pricing → workflow:orderLifecycle, presentation:dashboard)
  routing.register({ entryNumber: 21, packetType: 'PRICING_REJECTED',
    source: 'compute:pricing', bus: 'DATA',
    destinations: ['workflow:orderLifecycle', 'presentation:dashboard'], mode: 'Push', priority: 'STANDARD' });
}

function registerComputeDailyScanRoutes(routing) {
  // §5 #64 — DAILY_SCAN_TRIGGERED (declare, working:orderIntake → compute:dailyScan)
  routing.register({ entryNumber: 64, packetType: 'DAILY_SCAN_TRIGGERED',
    source: 'working:orderIntake', bus: 'DATA',
    destinations: ['compute:dailyScan'], mode: 'Push', priority: 'STANDARD' });

  // §5 #67 — STORAGE_FEE_DUE (declare, compute:dailyScan → workflow:orderLifecycle)
  routing.register({ entryNumber: 67, packetType: 'STORAGE_FEE_DUE',
    source: 'compute:dailyScan', bus: 'DATA',
    destinations: ['workflow:orderLifecycle'], mode: 'Push', priority: 'STANDARD' });

  // §5 #68 — NO_SHOW_DEADLINE_REACHED (declare, compute:dailyScan → workflow:orderLifecycle)
  routing.register({ entryNumber: 68, packetType: 'NO_SHOW_DEADLINE_REACHED',
    source: 'compute:dailyScan', bus: 'DATA',
    destinations: ['workflow:orderLifecycle'], mode: 'Push', priority: 'STANDARD' });

  // §5 #70 — INCOMPLETE_REMINDER_DUE (declare, compute:dailyScan → workflow:notifications)
  routing.register({ entryNumber: 70, packetType: 'INCOMPLETE_REMINDER_DUE',
    source: 'compute:dailyScan', bus: 'DATA',
    destinations: ['workflow:notifications'], mode: 'Push', priority: 'STANDARD' });

  // §5 #72 — MARKETING_OUTREACH_DUE (declare, compute:dailyScan → workflow:notifications)
  routing.register({ entryNumber: 72, packetType: 'MARKETING_OUTREACH_DUE',
    source: 'compute:dailyScan', bus: 'DATA',
    destinations: ['workflow:notifications'], mode: 'Push', priority: 'STANDARD' });

  // §5 #76 — DAILY_SCAN_COMPLETED (declare, compute:dailyScan → presentation:dashboard)
  routing.register({ entryNumber: 76, packetType: 'DAILY_SCAN_COMPLETED',
    source: 'compute:dailyScan', bus: 'DATA',
    destinations: ['presentation:dashboard'], mode: 'Push', priority: 'STANDARD' });
}

function registerComputeReportsRoutes(routing) {
  // §5 #77 — SNAPSHOT_TRIGGERED (declare, working:orderIntake → compute:reports)
  routing.register({ entryNumber: 77, packetType: 'SNAPSHOT_TRIGGERED',
    source: 'working:orderIntake', bus: 'DATA',
    destinations: ['compute:reports'], mode: 'Push', priority: 'STANDARD' });

  // §5 #83 — REPORT_REQUESTED (declare, presentation:dashboard → compute:reports)
  routing.register({ entryNumber: 83, packetType: 'REPORT_REQUESTED',
    source: 'presentation:dashboard', bus: 'DATA',
    destinations: ['compute:reports'], mode: 'Push', priority: 'STANDARD' });

  // §5 #85 — REPORT_GENERATED (declare, compute:reports → presentation:dashboard)
  routing.register({ entryNumber: 85, packetType: 'REPORT_GENERATED',
    source: 'compute:reports', bus: 'DATA',
    destinations: ['presentation:dashboard'], mode: 'Push', priority: 'STANDARD' });
}


// ────────────────────────────────────────────────────────────────────
// SECTION 15C: LOOP IMPLEMENTATIONS — PRESENTATION LOOPS (TIER 6)
// ────────────────────────────────────────────────────────────────────

// ── presentation:dashboard ─────────────────────────────────────────
// The operator's identity in the constellation. Receives all system
// events (36 inbound packet types). Serves as source identity for all
// operator-initiated actions (11 outbound packet types via server.js).
//
// Phase 1: onPacket is a no-op receiver. Dashboard data comes from
// vault and ledger queries through server.js.
// Phase 2: Each case gains a SYNC bus push for WebSocket delivery.
//
// PHASE 2 PRIORITY: The four service health packets
// (PAYMENT_SERVICE_DEGRADED, PAYMENT_SERVICE_RESTORED,
// NOTIFICATION_SERVICE_DEGRADED, NOTIFICATION_SERVICE_RESTORED)
// should be the first cases to gain real handlers when real
// Stripe/Twilio integration arrives.
//
// Ref: §6 routing entries #87–96. BUS_ASSIGNMENTS: subscribe
// [DATA, VAULT], publish [DATA, SYNC]. Capabilities: bus, document.

function createPresentationDashboard(caps) {

  function onPacket(packet) {
    switch (packet.packetType) {
      // ── Vault confirmations ──
      case 'ORDER_CREATED':
      case 'ORDER_CREATE_FAILED':
      case 'ORDER_UPDATED':
      case 'ORDER_UPDATE_FAILED':
      case 'CUSTOMER_CREATED':
      case 'CUSTOMER_UPDATED':
      case 'CUSTOMER_UPDATE_FAILED':
      case 'CONFIG_UPDATED':
      case 'CONFIG_UPDATE_FAILED':
      case 'SNAPSHOT_STORED':
        break;

      // ── Workflow events ──
      case 'ORDER_STAGE_CHANGED':
      case 'ORDER_CANCELLED':
      case 'ORDER_ABANDONED':
      case 'STAGE_ADVANCE_REJECTED':
      case 'CANCEL_REJECTED':
      case 'DEPOSIT_WAIVED':
        break;

      // ── Payment events ──
      case 'DEPOSIT_CHARGED':
      case 'DEPOSIT_FAILED':
      case 'BALANCE_CHARGED':
      case 'BALANCE_FAILED':
      case 'STORAGE_FEE_CHARGED':
      case 'STORAGE_FEE_FAILED':
      case 'NOSHOW_BALANCE_CHARGED':
      case 'NOSHOW_BALANCE_FAILED':
        break;

      // ── Alert / health events ──
      // PHASE 2 PRIORITY: These four are the first to gain real handlers
      case 'PAYMENT_ALERT':
      case 'PAYMENT_SERVICE_DEGRADED':
      case 'PAYMENT_SERVICE_RESTORED':
      case 'NOTIFICATION_PERMANENTLY_FAILED':
      case 'NOTIFICATION_SERVICE_DEGRADED':
      case 'NOTIFICATION_SERVICE_RESTORED':
        break;

      // ── Compute / filter results ──
      case 'DAILY_SCAN_COMPLETED':
      case 'REPORT_GENERATED':
      case 'INTAKE_REJECTED':
      case 'PRICING_REJECTED':
      case 'CUTS_REJECTED':
      case 'WEBHOOK_REJECTED':
        break;

      default:
        // Defensive: log unknown packet types for triage.
        // Catches routing additions that miss this handler.
        if (typeof console !== 'undefined') {
          console.warn('[presentation:dashboard] Unknown packet type: ' +
            packet.packetType + ' (packetId: ' + packet.packetId +
            ', traceId: ' + packet.traceId + ')');
        }
        break;
    }
  }

  return { onPacket: onPacket };
}


// ────────────────────────────────────────────────────────────────────
// SECTION 9: CONSTELLATION INIT
// The single export. FBD-2: init(capabilities) → handle.
// Server.js calls this with external capabilities (db adapters,
// Dependency Gates, etc). Returns a handle for server interaction.
// ────────────────────────────────────────────────────────────────────

/**
 * Initialize the Butcher Constellation.
 *
 * @param {object} externalCaps - Capabilities from server.js:
 *   {
 *     db:       { 'vault:orders': adapter, 'vault:customers': adapter, ... },
 *     services: { 'signal:payments': gate, 'signal:notifications': gate },
 *     gateway:  { 'working:orderIntake': adapter, 'working:paymentWebhook': adapter },
 *     document: documentInterface
 *   }
 *
 * @returns {object} Constellation handle:
 *   {
 *     routing:  routing table (for server to register entries)
 *     registry: loop registry (for loop factories)
 *     ledger:   event ledger (for diagnostics)
 *     buses:    { DATA, VAULT, SIGNAL, SYNC }
 *     start():  instantiate all loops and begin operation
 *     createPacket(type, payload, opts): packet factory
 *   }
 */
function init(externalCaps) {
  const caps = externalCaps || {};

  // Core infrastructure
  const ledger  = createLedger();
  const routing = createRoutingTable();

  // Buses
  const buses = {
    DATA:   createBus('DATA',   routing, ledger),
    VAULT:  createBus('VAULT',  routing, ledger),
    SIGNAL: createBus('SIGNAL', routing, ledger),
    SYNC:   createBus('SYNC',   routing, ledger)
  };

  // Loop registry
  const registry = createLoopRegistry();

  // ── Register built-in routing entries ──
  registerVaultConfigRoutes(routing);
  registerVaultCustomersRoutes(routing);
  registerVaultOrdersRoutes(routing);
  registerVaultSnapshotsRoutes(routing);
  registerInputGateRoutes(routing);
  registerSignalPaymentsRoutes(routing);
  registerSignalNotificationsRoutes(routing);
  registerComputePricingRoutes(routing);
  registerComputeDailyScanRoutes(routing);
  registerComputeReportsRoutes(routing);
  registerWorkflowOrderLifecycleRoutes(routing);
  registerWorkflowNotificationsRoutes(routing);

  // ── Register built-in loop factories ──
  registry.registerFactory('vault:config', createVaultConfig);
  registry.registerFactory('vault:customers', createVaultCustomers);
  registry.registerFactory('vault:orders', createVaultOrders);
  registry.registerFactory('vault:snapshots', createVaultSnapshots);
  registry.registerFactory('working:orderIntake', createWorkingOrderIntake);
  registry.registerFactory('working:paymentWebhook', createWorkingPaymentWebhook);
  registry.registerFactory('filter:orderValidation', createFilterOrderValidation);
  registry.registerFactory('signal:payments', createSignalPayments);
  registry.registerFactory('signal:notifications', createSignalNotifications);
  registry.registerFactory('compute:pricing', createComputePricing);
  registry.registerFactory('compute:dailyScan', createComputeDailyScan);
  registry.registerFactory('compute:reports', createComputeReports);
  registry.registerFactory('workflow:orderLifecycle', createWorkflowOrderLifecycle);
  registry.registerFactory('workflow:notifications', createWorkflowNotifications);
  registry.registerFactory('presentation:dashboard', createPresentationDashboard);

  // The handle — this is all server.js can see (FBD-2)
  return {
    routing:  routing,
    registry: registry,
    ledger:   ledger,
    buses:    buses,

    /**
     * Instantiate all registered loops and begin operation.
     */
    start() {
      registry.instantiateAll(buses, caps);
    },

    /**
     * Packet factory — convenience for server-level packet creation
     * (e.g., Clock triggers, HTTP intake).
     */
    createPacket: createPacket
  };
}


// FBD-2: Single export. Internals are not accessible.
module.exports = { init };
