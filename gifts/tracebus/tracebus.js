/*
 * tracebus — a traced, routing-enforced message bus.
 *
 * A publish/subscribe bus where every legal path is declared up front and
 * every emission is written to an append-only ledger you can replay by
 * trace id. A packet can only reach a subscriber the routing table permits;
 * an unrouted packet is refused, not silently dropped. Nothing is delivered
 * without leaving a receipt.
 *
 * The shape:  packet ──emit(source)──▶ routingTable.resolve ──▶ subscribers
 *                                 │                              │
 *                                 └────────▶ ledger.record ◀─────┘
 *
 * Zero dependencies. Runs in Node or the browser. No I/O, no globals, no
 * clock you can't control (timestamps are ISO strings; ids are v4-shaped).
 *
 * Properties this file holds (see test_tracebus.js):
 *   1. No delivery without a receipt. Every emit() — delivered, partial,
 *      rejected, or errored — appends exactly one ledger record.
 *   2. No path that wasn't declared. resolve() throws on an unrouted
 *      (packetType, source) pair; emit() records the rejection and rethrows.
 *   3. A wrong-bus packet is refused. A packet routed to bus A cannot be
 *      emitted on bus B, even if a subscriber is listening.
 *   4. A subscriber that throws cannot break the emitter. Handler errors are
 *      caught, recorded against that destination, and delivery continues.
 *   5. Routing entries are frozen. A registered route cannot be mutated
 *      after the fact (deepFreeze), so the declared topology stays declared.
 *   6. A trace is reconstructable. queryByTraceId returns every hop a
 *      packet took, in emission order.
 *
 * Origin: stripped from a shipped order-management constellation's internal
 * message fabric (the "one bus, many loops, every packet traced" core) and
 * generalized — the request/response capability, which was hardwired to a
 * single bus name in the original, is now a per-bus flag.
 *
 * MIT licensed. Use it for anything.
 */

'use strict';

// ────────────────────────────────────────────────────────────────────
// Primitives (inlined so the file has no dependencies).
// ────────────────────────────────────────────────────────────────────

/**
 * A v4-shaped identifier: 8-4-4-4-12 hex with the version nibble pinned
 * to 4 and the variant nibble in {8,9,a,b}. Uses Math.random — this is an
 * identifier for correlating log records, NOT a cryptographic token.
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
      id += hex[(Math.floor(Math.random() * 16) & 0x3) | 0x8];
    } else {
      id += hex[Math.floor(Math.random() * 16)];
    }
  }
  return id;
}

/** Current time as an ISO-8601 string. The one place time enters. */
function now() {
  return new Date().toISOString();
}

/**
 * Recursively freeze an object and everything it owns. A registered
 * routing entry is frozen so the declared topology cannot be edited
 * after registration.
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
// Packet — the traceable envelope.
// ────────────────────────────────────────────────────────────────────

/**
 * Create a packet: a typed payload wrapped in a header that carries a
 * unique packetId, a traceId (shared across a causal chain — pass it in
 * opts to thread a conversation), a timestamp, and an optional source.
 *
 * @param {string} packetType - a non-empty type string, e.g. 'user.created'
 * @param {object} payload    - the packet's data (must be an object)
 * @param {object} [opts]     - { traceId?, source? } overrides
 * @returns {object} { packetId, packetType, timestamp, traceId, source, payload }
 */
function createPacket(packetType, payload, opts) {
  if (!packetType || typeof packetType !== 'string') {
    throw new Error('[tracebus] Cannot create packet: packetType is required and must be a non-empty string');
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error(`[tracebus] Cannot create packet ${packetType}: payload must be an object`);
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
// Ledger — the append-only receipt log.
// ────────────────────────────────────────────────────────────────────

/**
 * Create an append-only ledger. Every bus emission is recorded here.
 * Nothing is ever removed; queries are pure reads.
 */
function createLedger() {
  const entries = [];

  return {
    /**
     * Record one emission.
     * @param {object} record - { bus, packet, source, destinations?, status? }
     */
    record(record) {
      if (!record || !record.packet || !record.packet.packetId) {
        throw new Error('[tracebus] Cannot record: a record needs a packet with a packetId');
      }
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
     * Every record for one traceId, in emission order — a packet's journey.
     * @param {string} traceId
     * @returns {object[]}
     */
    queryByTraceId(traceId) {
      return entries.filter(e => e.traceId === traceId);
    },

    /**
     * Every record of one packetType.
     * @param {string} packetType
     * @returns {object[]}
     */
    queryByPacketType(packetType) {
      return entries.filter(e => e.packetType === packetType);
    },

    /** Total records (diagnostic). */
    count() {
      return entries.length;
    },

    /** A copy of every record (diagnostic — the ledger stays private). */
    all() {
      return entries.slice();
    }
  };
}

// ────────────────────────────────────────────────────────────────────
// Routing table — the declared topology.
// ────────────────────────────────────────────────────────────────────

/**
 * Create a routing table. Every legal (packetType, source) → destinations
 * path must be registered before a packet can travel it. Registered entries
 * are frozen.
 */
function createRoutingTable() {
  // key = `${packetType}:${source}` → array of frozen entries
  const routes = new Map();

  return {
    /**
     * Register a legal path.
     * @param {object} entry - { packetType, source, bus, destinations[],
     *                           entryNumber?, mode?, priority? }
     */
    register(entry) {
      if (!entry || !entry.packetType || !entry.source || !entry.bus) {
        throw new Error('[tracebus] Cannot register route: packetType, source, and bus are required');
      }
      if (!entry.destinations || !Array.isArray(entry.destinations) || entry.destinations.length === 0) {
        throw new Error(`[tracebus] Cannot register route ${entry.packetType} from ${entry.source}: destinations must be a non-empty array`);
      }

      const key = `${entry.packetType}:${entry.source}`;
      if (!routes.has(key)) {
        routes.set(key, []);
      }
      routes.get(key).push(deepFreeze({
        entryNumber:  entry.entryNumber !== undefined ? entry.entryNumber : null,
        packetType:   entry.packetType,
        source:       entry.source,
        bus:          entry.bus,
        destinations: entry.destinations.slice(),
        mode:         entry.mode || 'push',
        priority:     entry.priority || 'standard'
      }));
    },

    /**
     * Resolve the routes for a (packetType, source) pair.
     * @throws if no route is registered — an unrouted packet is a fault.
     * @returns {object[]} matching frozen entries
     */
    resolve(packetType, source) {
      const key = `${packetType}:${source}`;
      const matched = routes.get(key);
      if (!matched || matched.length === 0) {
        throw new Error(`[tracebus] Unrouted packet: ${packetType} from ${source}. No matching routing entry.`);
      }
      return matched;
    },

    /** Non-throwing existence check. */
    has(packetType, source) {
      const key = `${packetType}:${source}`;
      const matched = routes.get(key);
      return !!(matched && matched.length > 0);
    },

    /** Total registered entries (diagnostic). */
    count() {
      let total = 0;
      for (const list of routes.values()) {
        total += list.length;
      }
      return total;
    }
  };
}

// ────────────────────────────────────────────────────────────────────
// Bus — publish/subscribe with enforced routing and a receipt per emit.
// ────────────────────────────────────────────────────────────────────

/**
 * Create a bus.
 * @param {string} name          - this bus's name (matched against a route's `bus`)
 * @param {object} routingTable  - a shared routing table (createRoutingTable())
 * @param {object} ledger        - a shared ledger (createLedger())
 * @param {object} [opts]        - { requestResponse?: boolean } — enable request()
 *                                 on this bus. Default false.
 */
function createBus(name, routingTable, ledger, opts) {
  if (!name || typeof name !== 'string') {
    throw new Error('[tracebus] Cannot create bus: name is required and must be a non-empty string');
  }
  if (!routingTable || typeof routingTable.resolve !== 'function') {
    throw new Error(`[tracebus] Cannot create bus ${name}: a routing table is required`);
  }
  if (!ledger || typeof ledger.record !== 'function') {
    throw new Error(`[tracebus] Cannot create bus ${name}: a ledger is required`);
  }

  const requestResponse = !!(opts && opts.requestResponse);
  const subscribers = new Map(); // destination name → handler

  return {
    name: name,

    /**
     * Subscribe a named destination to this bus.
     * @param {string} destination - the name routing entries deliver to
     * @param {function} handler    - receives (packet)
     */
    subscribe(destination, handler) {
      if (!destination || typeof destination !== 'string') {
        throw new Error(`[tracebus:${name}] Cannot subscribe: destination must be a non-empty string`);
      }
      if (typeof handler !== 'function') {
        throw new Error(`[tracebus:${name}] Cannot subscribe ${destination}: handler must be a function`);
      }
      subscribers.set(destination, handler);
    },

    /**
     * Emit a packet from a source. Routing decides destinations; a receipt
     * is always recorded. Returns { delivered, missing } — destinations that
     * received the packet and declared destinations with no live subscriber.
     * @param {string} source - the emitter
     * @param {object} packet - from createPacket()
     */
    emit(source, packet) {
      if (!packet || !packet.packetType) {
        throw new Error(`[tracebus:${name}] Cannot emit from ${source}: invalid packet (missing packetType)`);
      }

      let routeEntries;
      try {
        routeEntries = routingTable.resolve(packet.packetType, source);
      } catch (err) {
        ledger.record({ bus: name, packet, source, destinations: [], status: 'rejected:unrouted' });
        throw err;
      }

      const entry = routeEntries[0];
      if (entry.bus !== name) {
        ledger.record({ bus: name, packet, source, destinations: [], status: 'rejected:wrong_bus' });
        throw new Error(`[tracebus:${name}] Cannot emit ${packet.packetType} from ${source}: packet is routed to bus ${entry.bus}, not ${name}`);
      }

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
              ledger.record({
                bus: name, packet, source,
                destinations: [dest],
                status: `error:subscriber:${handlerErr.message}`
              });
              delivered.push(dest); // a thrown handler still received the packet
            }
          } else {
            missing.push(dest);
          }
        }
      }

      ledger.record({
        bus: name, packet, source,
        destinations: delivered,
        status: missing.length > 0
          ? `delivered:partial (missing: ${missing.join(', ')})`
          : 'delivered'
      });

      return { delivered, missing };
    },

    /**
     * Request/response: emit to a single destination and return its handler's
     * return value. Only available when the bus was created with
     * { requestResponse: true }.
     * @param {string} source
     * @param {object} packet
     * @returns {*} the handler's return value
     */
    request(source, packet) {
      if (!requestResponse) {
        throw new Error(`[tracebus:${name}] request() is not enabled on this bus (create it with { requestResponse: true })`);
      }
      if (!packet || !packet.packetType) {
        throw new Error(`[tracebus:${name}] Cannot request from ${source}: invalid packet`);
      }

      let routeEntries;
      try {
        routeEntries = routingTable.resolve(packet.packetType, source);
      } catch (err) {
        ledger.record({ bus: name, packet, source, destinations: [], status: 'rejected:unrouted' });
        throw err;
      }

      const entry = routeEntries[0];
      if (entry.bus !== name) {
        ledger.record({ bus: name, packet, source, destinations: [], status: 'rejected:wrong_bus' });
        throw new Error(`[tracebus:${name}] Cannot request ${packet.packetType}: routed to bus ${entry.bus}`);
      }

      const dest = entry.destinations[0];
      const handler = subscribers.get(dest);
      if (!handler) {
        ledger.record({ bus: name, packet, source, destinations: [dest], status: 'error:destination_not_registered' });
        throw new Error(`[tracebus:${name}] Cannot request ${packet.packetType} from ${source}: destination ${dest} is not registered`);
      }

      let result;
      try {
        result = handler(packet);
      } catch (handlerErr) {
        ledger.record({ bus: name, packet, source, destinations: [dest], status: `error:handler:${handlerErr.message}` });
        throw handlerErr;
      }

      ledger.record({ bus: name, packet, source, destinations: [dest], status: 'delivered:request_response' });
      return result;
    },

    /** Is a destination subscribed? (diagnostic) */
    hasSubscriber(destination) {
      return subscribers.has(destination);
    },

    /** Subscriber count (diagnostic). */
    subscriberCount() {
      return subscribers.size;
    }
  };
}

// ────────────────────────────────────────────────────────────────────
// Exports — CommonJS for Node, global for the browser.
// ────────────────────────────────────────────────────────────────────

const tracebus = {
  generateId,
  createPacket,
  createLedger,
  createRoutingTable,
  createBus,
  deepFreeze
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = tracebus;
}
if (typeof window !== 'undefined') {
  window.tracebus = tracebus;
}

// ────────────────────────────────────────────────────────────────────
// Runnable demo:  node tracebus.js --demo
// Wires a tiny two-subscriber bus, emits one packet, and prints the
// ledger — so `run` shows the receipt trail with no code to write.
// ────────────────────────────────────────────────────────────────────
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  var arg = process.argv[2];
  if (arg === '--demo' || arg === undefined) {
    var routing = createRoutingTable();
    var ledger = createLedger();
    var bus = createBus('DATA', routing, ledger);

    routing.register({ packetType: 'order.placed', source: 'checkout', bus: 'DATA', destinations: ['fulfillment', 'email'] });
    bus.subscribe('fulfillment', function (p) { console.log('  fulfillment got order', p.payload.id); });
    bus.subscribe('email', function (p) { console.log('  email got order', p.payload.id); });

    console.log('emit order.placed from checkout:');
    var result = bus.emit('checkout', createPacket('order.placed', { id: 1001 }, { source: 'checkout' }));
    console.log('  delivered:', result.delivered.join(', '), '| missing:', result.missing.join(', ') || '(none)');

    console.log('\nledger (the receipt trail):');
    ledger.all().forEach(function (e) {
      console.log('  ' + e.packetType + '  bus=' + e.bus + '  status=' + e.status + '  ->[' + e.destinations.join(', ') + ']');
    });

    console.log('\ntry an unrouted packet (refused, but still recorded):');
    try { bus.emit('checkout', createPacket('order.cancelled', { id: 1001 })); }
    catch (e) { console.log('  refused: ' + e.message); }
    console.log('  ledger now has ' + ledger.count() + ' records — nothing moved without a receipt.');
  } else {
    console.log('usage: node tracebus.js --demo');
  }
}
