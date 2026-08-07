// ╔══════════════════════════════════════════════════════════════════════╗
// ║  BUTCHER CONSTELLATION — server.js                                 ║
// ║  Infrastructure: HTTP, SSE, Dependency Gates, Clock,               ║
// ║  secret management. Owns all secrets. Injects capabilities         ║
// ║  into the constellation via init().                                ║
// ║  FBD-1: Secrets live here, never in constellation.js.              ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { init } = require('./constellation.js');

const PORT = process.env.PORT || 3000;
const DASHBOARD_SOURCE = 'presentation:dashboard';

// ────────────────────────────────────────────────────────────────────
// SECRETS (loaded from environment — never hardcoded)
// ────────────────────────────────────────────────────────────────────
// const STRIPE_SECRET_KEY     = process.env.STRIPE_SECRET_KEY;
// const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
// const SUPABASE_URL          = process.env.SUPABASE_URL;
// const SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
// const TWILIO_ACCOUNT_SID    = process.env.TWILIO_ACCOUNT_SID;
// const TWILIO_AUTH_TOKEN     = process.env.TWILIO_AUTH_TOKEN;

// ────────────────────────────────────────────────────────────────────
// DEPENDENCY GATES (stub implementations for Tier 0)
// Each gate wraps an external API. The constellation receives the
// gate interface, never the credentials.
// ────────────────────────────────────────────────────────────────────

// Stub: Supabase persistence adapters (one per vault)
function createDbAdapter(tableName) {
  // Tier 0 stub: in-memory storage
  const records = new Map();
  return {
    read(id)        { return records.get(id) || null; },
    write(id, data) { records.set(id, data); return data; },
    query(filter)   { return Array.from(records.values()); },
    delete(id)      { return records.delete(id); }
  };
}

// Stub: Stripe Dependency Gate (outbound — for signal:payments, Tier 3)
// function createStripeGate(secretKey) {
//   return {
//     charge(params) { /* calls Stripe API */ },
//   };
// }

// Stub: Twilio/Email Dependency Gate (outbound — for signal:notifications, Tier 3)
// function createNotificationGate(twilioSid, twilioToken) {
//   return {
//     send(params) { /* calls Twilio/email API */ },
//   };
// }

// ────────────────────────────────────────────────────────────────────
// GATEWAY ADAPTERS (inbound — one per working loop, FBD-5)
// Each gateway wraps external verification tools in a closure.
// The constellation receives the interface, never the credentials.
// ────────────────────────────────────────────────────────────────────

// Gateway: working:orderIntake — schema validation for form submissions
function createIntakeGateway() {
  return {
    validateSubmission(body) {
      const errors = [];
      if (body.hangingWeightLbs !== undefined && body.hangingWeightLbs > 2000) {
        errors.push('hangingWeightLbs exceeds maximum (2000 lbs)');
      }
      if (body.customerName && body.customerName.length > 200) {
        errors.push('customerName exceeds 200 character limit');
      }
      return { valid: errors.length === 0, errors: errors };
    }
  };
}

// Development stub (no Stripe SDK yet):
function createStripeGateway() {
  return {
    verifySignature(body, signatureHeader) {
      return { valid: true };
    }
  };
}

// ────────────────────────────────────────────────────────────────────
// CONSTELLATION INITIALIZATION
// FBD-2: init() is the only interface. Internals are not accessible.
// ────────────────────────────────────────────────────────────────────

const constellation = init({
  db: {
    'vault:orders':    createDbAdapter('orders'),
    'vault:customers': createDbAdapter('customers'),
    'vault:config':    createDbAdapter('config'),
    'vault:snapshots': createDbAdapter('snapshots')
  },
  gateway: {
    'working:orderIntake':     createIntakeGateway(),
    'working:paymentWebhook':  createStripeGateway()
  }
});

// ────────────────────────────────────────────────────────────────────
// SSE CLIENT REGISTRY
// Connected browser clients. Each gets a push when the dashboard
// loop receives a packet.
// ────────────────────────────────────────────────────────────────────

const sseClients = new Set();

function broadcastSSE(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch (e) {
      sseClients.delete(res);
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// START CONSTELLATION + SSE BRIDGE
// After start(), re-subscribe presentation:dashboard on both DATA
// and VAULT buses with a wrapper that broadcasts to SSE clients.
// The original onPacket is a Phase 1 no-op — we call it for forward
// compatibility so Phase 2 logic won't be skipped.
// ────────────────────────────────────────────────────────────────────

constellation.start();

// ────────────────────────────────────────────────────────────────────
// SEED DEFAULT CONFIG (Deer Hill Butchers)
// Config vault starts empty. Pricing, daily scan, and reports all
// depend on config existing. Seed once at startup; Rick can update
// via the Settings view.
// ────────────────────────────────────────────────────────────────────
const configVault = constellation.registry.get('vault:config');
configVault.seed({
  pricing: {
    baseRate: 350,            // flat processing fee ($350)
    weightThresholdLbs: 160,  // overage kicks in above this
    overagePerLb: 1.00,       // $1/lb over threshold
    deposit: 75,              // $75 deposit at intake
    animalTypeOverrides: {}   // no per-type overrides yet
  },
  services: {
    porkFatPerLb: 0,          // pork fat — no extra charge
    sausagePerLb: 3.75,       // $3.75/lb bulk sausage
    sausageMinimumLbs: 5,     // 5 lb minimum per flavor
    antlers: 0,               // included
    skullCapMount: 0,         // included
    cape: 0,                  // included
    rushProcessing: 35        // $35 rush fee
  },
  storage: {
    feePerWeek: 15,           // $15/week storage after grace
    gracePeriodDays: 7,       // 7 days free after ready_for_pickup
    noShowDeadlineDays: 30    // 30 days until abandonment
  },
  notifications: {
    'ready-for-pickup': 'Hi {{customerName}}, your order is ready for pickup at Deer Hill Butchers. Please pick up within {{graceDays}} days to avoid storage fees.',
    'thank-you': 'Thank you for choosing Deer Hill Butchers, {{customerName}}! We appreciate your business.'
  }
});
console.log('[server] Default config seeded');

const dashboardHandle = constellation.registry.get('presentation:dashboard');
const originalOnPacket = dashboardHandle.onPacket;

function wrappedOnPacket(packet) {
  // Call original handler (no-op in Phase 1, real logic in Phase 2)
  originalOnPacket(packet);

  // Broadcast to all connected browsers
  broadcastSSE(packet.packetType, {
    packetId:   packet.packetId,
    packetType: packet.packetType,
    traceId:    packet.traceId,
    timestamp:  packet.timestamp,
    payload:    packet.payload
  });
}

// Re-subscribe on both buses the dashboard listens to
constellation.buses.DATA.subscribe('presentation:dashboard', wrappedOnPacket);
constellation.buses.VAULT.subscribe('presentation:dashboard', wrappedOnPacket);

console.log('[server] Butcher Constellation initialized');
console.log(`[server] Routing entries: ${constellation.routing.count()}`);
console.log(`[server] Loop instances: ${constellation.registry.instanceCount()}`);

// ────────────────────────────────────────────────────────────────────
// HTTP UTILITIES
// ────────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString();
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type':  'application/json',
    'Cache-Control': 'no-cache'
  });
  res.end(JSON.stringify(data));
}

function notFound(res) {
  json(res, 404, { error: 'Not found' });
}

function serverError(res, err) {
  console.error('[server] Error:', err.message || err);
  json(res, 500, { error: err.message || 'Internal server error' });
}

// Extract path parameter: /api/orders/:id/action → id
function extractParam(url, prefix, suffix) {
  // url: /api/orders/ORD-123/advance
  // prefix: /api/orders/   suffix: /advance
  const after = url.slice(prefix.length);
  if (suffix) {
    const idx = after.indexOf(suffix);
    return idx > 0 ? after.slice(0, idx) : null;
  }
  return after || null;
}

// ────────────────────────────────────────────────────────────────────
// API ROUTE HANDLERS
// ────────────────────────────────────────────────────────────────────

// GET /api/orders — FETCH_ORDERS via VAULT bus pull
function handleFetchOrders(req, res) {
  try {
    const packet = constellation.createPacket('FETCH_ORDERS', {}, { source: DASHBOARD_SOURCE });
    const result = constellation.buses.VAULT.request(DASHBOARD_SOURCE, packet);
    json(res, 200, result);
  } catch (err) {
    serverError(res, err);
  }
}

// GET /api/customers — FETCH_CUSTOMERS via VAULT bus pull
function handleFetchCustomers(req, res) {
  try {
    const packet = constellation.createPacket('FETCH_CUSTOMERS', {}, { source: DASHBOARD_SOURCE });
    const result = constellation.buses.VAULT.request(DASHBOARD_SOURCE, packet);
    json(res, 200, result);
  } catch (err) {
    serverError(res, err);
  }
}

// GET /api/config — FETCH_CONFIG via VAULT bus pull
function handleFetchConfig(req, res) {
  try {
    const packet = constellation.createPacket('FETCH_CONFIG', {}, { source: DASHBOARD_SOURCE });
    const result = constellation.buses.VAULT.request(DASHBOARD_SOURCE, packet);
    json(res, 200, result);
  } catch (err) {
    serverError(res, err);
  }
}

// GET /api/snapshots — FETCH_SNAPSHOTS via VAULT bus pull
function handleFetchSnapshots(req, res) {
  try {
    const packet = constellation.createPacket('FETCH_SNAPSHOTS', {}, { source: DASHBOARD_SOURCE });
    const result = constellation.buses.VAULT.request(DASHBOARD_SOURCE, packet);
    json(res, 200, result);
  } catch (err) {
    serverError(res, err);
  }
}

// POST /api/orders — intake via working:orderIntake.handleSubmission()
async function handleSubmitOrder(req, res) {
  try {
    const body = await readBody(req);
    const intake = constellation.registry.get('working:orderIntake');
    const result = intake.handleSubmission(body);
    json(res, result.status, result);
  } catch (err) {
    if (err.message === 'Invalid JSON') {
      json(res, 400, { error: 'Invalid JSON body' });
    } else {
      serverError(res, err);
    }
  }
}

// POST /api/orders/:id/advance — STAGE_ADVANCE_COMMAND via DATA bus
async function handleAdvanceStage(req, res, orderId) {
  try {
    const body = await readBody(req);
    const packet = constellation.createPacket('STAGE_ADVANCE_COMMAND', {
      orderId:    orderId,
      operatorId: body.operatorId || 'rick'
    }, { source: DASHBOARD_SOURCE });
    constellation.buses.DATA.emit(DASHBOARD_SOURCE, packet);
    json(res, 202, { ok: true, packetType: 'STAGE_ADVANCE_COMMAND', traceId: packet.traceId });
  } catch (err) {
    serverError(res, err);
  }
}

// POST /api/orders/:id/weight — WEIGHT_RECORDED via DATA bus
async function handleRecordWeight(req, res, orderId) {
  try {
    const body = await readBody(req);
    if (body.hangingWeightLbs === undefined || typeof body.hangingWeightLbs !== 'number') {
      json(res, 400, { error: 'hangingWeightLbs is required and must be a number' });
      return;
    }
    const packet = constellation.createPacket('WEIGHT_RECORDED', {
      orderId:          orderId,
      hangingWeightLbs: body.hangingWeightLbs,
      operatorId:       body.operatorId || 'rick'
    }, { source: DASHBOARD_SOURCE });
    constellation.buses.DATA.emit(DASHBOARD_SOURCE, packet);
    json(res, 202, { ok: true, packetType: 'WEIGHT_RECORDED', traceId: packet.traceId });
  } catch (err) {
    serverError(res, err);
  }
}

// POST /api/orders/:id/cancel — CANCEL_ORDER via DATA bus
async function handleCancelOrder(req, res, orderId) {
  try {
    const body = await readBody(req);
    const packet = constellation.createPacket('CANCEL_ORDER', {
      orderId:    orderId,
      reason:     body.reason || 'Operator cancelled',
      operatorId: body.operatorId || 'rick'
    }, { source: DASHBOARD_SOURCE });
    constellation.buses.DATA.emit(DASHBOARD_SOURCE, packet);
    json(res, 202, { ok: true, packetType: 'CANCEL_ORDER', traceId: packet.traceId });
  } catch (err) {
    serverError(res, err);
  }
}

// POST /api/intake-direct — INTAKE_DIRECT via DATA bus
// Dashboard bypass: skips filter:orderValidation, goes straight to
// workflow:orderLifecycle. Used when the operator enters an order
// directly in the dashboard (trusted input).
async function handleIntakeDirect(req, res) {
  try {
    const body = await readBody(req);
    const packet = constellation.createPacket('INTAKE_DIRECT', body, { source: DASHBOARD_SOURCE });
    constellation.buses.DATA.emit(DASHBOARD_SOURCE, packet);
    json(res, 202, { ok: true, packetType: 'INTAKE_DIRECT', traceId: packet.traceId });
  } catch (err) {
    if (err.message === 'Invalid JSON') {
      json(res, 400, { error: 'Invalid JSON body' });
    } else {
      serverError(res, err);
    }
  }
}

// POST /api/messages — SEND_MANUAL_MESSAGE via DATA bus
async function handleSendMessage(req, res) {
  try {
    const body = await readBody(req);
    const packet = constellation.createPacket('SEND_MANUAL_MESSAGE', {
      customerId:  body.customerId,
      channel:     body.channel || 'sms',
      message:     body.message,
      operatorId:  body.operatorId || 'rick'
    }, { source: DASHBOARD_SOURCE });
    constellation.buses.DATA.emit(DASHBOARD_SOURCE, packet);
    json(res, 202, { ok: true, packetType: 'SEND_MANUAL_MESSAGE', traceId: packet.traceId });
  } catch (err) {
    serverError(res, err);
  }
}

// POST /api/reports — REPORT_REQUESTED via DATA bus
async function handleReportRequest(req, res) {
  try {
    const body = await readBody(req);
    const packet = constellation.createPacket('REPORT_REQUESTED', {
      reportType: body.reportType || 'daily',
      dateRange:  body.dateRange || {},
      operatorId: body.operatorId || 'rick'
    }, { source: DASHBOARD_SOURCE });
    constellation.buses.DATA.emit(DASHBOARD_SOURCE, packet);
    json(res, 202, { ok: true, packetType: 'REPORT_REQUESTED', traceId: packet.traceId });
  } catch (err) {
    serverError(res, err);
  }
}

// PUT /api/customers/:id — CUSTOMER_UPDATE_COMMAND via DATA bus
async function handleUpdateCustomer(req, res, customerId) {
  try {
    const body = await readBody(req);
    if (!body.updates || typeof body.updates !== 'object') {
      json(res, 400, { error: 'updates object is required' });
      return;
    }
    const packet = constellation.createPacket('CUSTOMER_UPDATE_COMMAND', {
      customerId: customerId,
      updates:    body.updates,
      operatorId: body.operatorId || 'rick'
    }, { source: DASHBOARD_SOURCE });
    constellation.buses.DATA.emit(DASHBOARD_SOURCE, packet);
    json(res, 202, { ok: true, packetType: 'CUSTOMER_UPDATE_COMMAND', traceId: packet.traceId });
  } catch (err) {
    if (err.message === 'Invalid JSON') {
      json(res, 400, { error: 'Invalid JSON body' });
    } else {
      serverError(res, err);
    }
  }
}

// PUT /api/config/:key — CONFIG_CHANGE_COMMAND via DATA bus
async function handleUpdateConfig(req, res, configKey) {
  try {
    const body = await readBody(req);
    if (!body.changes || typeof body.changes !== 'object') {
      json(res, 400, { error: 'changes object is required' });
      return;
    }
    const packet = constellation.createPacket('CONFIG_CHANGE_COMMAND', {
      configKey:  configKey,
      changes:    body.changes,
      operatorId: body.operatorId || 'rick'
    }, { source: DASHBOARD_SOURCE });
    constellation.buses.DATA.emit(DASHBOARD_SOURCE, packet);
    json(res, 202, { ok: true, packetType: 'CONFIG_CHANGE_COMMAND', traceId: packet.traceId });
  } catch (err) {
    if (err.message === 'Invalid JSON') {
      json(res, 400, { error: 'Invalid JSON body' });
    } else {
      serverError(res, err);
    }
  }
}

// GET /api/events — SSE endpoint for real-time push
function handleSSE(req, res) {
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  // Send initial heartbeat
  res.write('event: connected\ndata: {"status":"ok"}\n\n');

  sseClients.add(res);
  console.log(`[server] SSE client connected (${sseClients.size} total)`);

  req.on('close', () => {
    sseClients.delete(res);
    console.log(`[server] SSE client disconnected (${sseClients.size} total)`);
  });
}

// GET /api/ledger/:traceId — trace a packet's journey (diagnostic)
function handleLedgerTrace(req, res, traceId) {
  try {
    const entries = constellation.ledger.queryByTraceId(traceId);
    json(res, 200, { traceId: traceId, entries: entries });
  } catch (err) {
    serverError(res, err);
  }
}

// ────────────────────────────────────────────────────────────────────
// STATIC FILE SERVING
// Serves dashboard.html from the same directory as server.js.
// ────────────────────────────────────────────────────────────────────

function serveStatic(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      notFound(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// ────────────────────────────────────────────────────────────────────
// REQUEST ROUTER
// ────────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url    = req.url.split('?')[0];  // strip query string
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // ── API Routes ──

  // SSE
  if (method === 'GET' && url === '/api/events') {
    handleSSE(req, res);
    return;
  }

  // VAULT pulls (read)
  if (method === 'GET' && url === '/api/orders') {
    handleFetchOrders(req, res);
    return;
  }
  if (method === 'GET' && url === '/api/customers') {
    handleFetchCustomers(req, res);
    return;
  }
  if (method === 'GET' && url === '/api/config') {
    handleFetchConfig(req, res);
    return;
  }
  if (method === 'GET' && url === '/api/snapshots') {
    handleFetchSnapshots(req, res);
    return;
  }

  // Ledger trace (diagnostic)
  if (method === 'GET' && url.startsWith('/api/ledger/')) {
    const traceId = url.slice('/api/ledger/'.length);
    handleLedgerTrace(req, res, traceId);
    return;
  }

  // Order intake (two paths: external via working loop, direct via DATA bus)
  if (method === 'POST' && url === '/api/orders') {
    handleSubmitOrder(req, res);
    return;
  }
  if (method === 'POST' && url === '/api/intake-direct') {
    handleIntakeDirect(req, res);
    return;
  }

  // Order commands
  if (method === 'POST' && url.endsWith('/advance') && url.startsWith('/api/orders/')) {
    const orderId = extractParam(url, '/api/orders/', '/advance');
    if (orderId) { handleAdvanceStage(req, res, orderId); return; }
  }
  if (method === 'POST' && url.endsWith('/weight') && url.startsWith('/api/orders/')) {
    const orderId = extractParam(url, '/api/orders/', '/weight');
    if (orderId) { handleRecordWeight(req, res, orderId); return; }
  }
  if (method === 'POST' && url.endsWith('/cancel') && url.startsWith('/api/orders/')) {
    const orderId = extractParam(url, '/api/orders/', '/cancel');
    if (orderId) { handleCancelOrder(req, res, orderId); return; }
  }

  // Messages
  if (method === 'POST' && url === '/api/messages') {
    handleSendMessage(req, res);
    return;
  }

  // Customer update
  if (method === 'PUT' && url.startsWith('/api/customers/')) {
    const customerId = url.slice('/api/customers/'.length);
    if (customerId) { handleUpdateCustomer(req, res, customerId); return; }
  }

  // Config change
  if (method === 'PUT' && url.startsWith('/api/config/')) {
    const configKey = url.slice('/api/config/'.length);
    if (configKey) { handleUpdateConfig(req, res, configKey); return; }
  }

  // Reports
  if (method === 'POST' && url === '/api/reports') {
    handleReportRequest(req, res);
    return;
  }

  // Stripe webhook (inbound, uses working:paymentWebhook)
  if (method === 'POST' && url === '/webhook/stripe') {
    readBody(req).then(body => {
      const sig = req.headers['stripe-signature'] || '';
      const webhook = constellation.registry.get('working:paymentWebhook');
      const result = webhook.handleWebhook(body, sig);
      json(res, result.status, result);
    }).catch(err => serverError(res, err));
    return;
  }

  // ── Static files ──

  if (method === 'GET' && (url === '/' || url === '/dashboard' || url === '/dashboard.html')) {
    serveStatic(res, path.join(__dirname, 'dashboard.html'), 'text/html');
    return;
  }

  notFound(res);
});

// ────────────────────────────────────────────────────────────────────
// SSE KEEPALIVE
// Sends a comment line every 30s to prevent proxy/browser timeouts.
// ────────────────────────────────────────────────────────────────────

setInterval(() => {
  for (const res of sseClients) {
    try {
      res.write(':keepalive\n\n');
    } catch (e) {
      sseClients.delete(res);
    }
  }
}, 30000);

// ────────────────────────────────────────────────────────────────────
// START
// ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
  console.log(`[server] Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`[server] SSE endpoint: http://localhost:${PORT}/api/events`);
});
