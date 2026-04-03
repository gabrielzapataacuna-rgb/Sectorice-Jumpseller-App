import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'jumpseller.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sync_runs (
    run_id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_mode TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    seen_count INTEGER NOT NULL DEFAULT 0,
    imported_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    unchanged_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );

  CREATE TABLE IF NOT EXISTS tracked_orders (
    order_id TEXT PRIMARY KEY,
    order_number TEXT,
    external_status TEXT,
    payment_status TEXT,
    fulfillment_status TEXT,
    payload_hash TEXT NOT NULL,
    raw_payload TEXT NOT NULL,
    customer_name TEXT,
    shipping_address TEXT,
    shipping_city TEXT,
    source_mode TEXT NOT NULL,
    import_status TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    imported_at TEXT,
    skipped_at TEXT,
    last_error TEXT,
    sectorice_response TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tracked_orders_import_status
    ON tracked_orders(import_status, last_seen_at DESC);

  CREATE TABLE IF NOT EXISTS app_state (
    state_key TEXT PRIMARY KEY,
    state_value TEXT,
    updated_at TEXT NOT NULL
  );
`);

function hasTrackedOrdersColumn(columnName) {
  return db.prepare(`PRAGMA table_info(tracked_orders)`).all()
    .some((column) => column.name === columnName);
}

function ensureTrackedOrdersColumn(columnName, columnDefinition) {
  if (!hasTrackedOrdersColumn(columnName)) {
    db.exec(`ALTER TABLE tracked_orders ADD COLUMN ${columnName} ${columnDefinition}`);
  }
}

ensureTrackedOrdersColumn('http_status', 'INTEGER');
ensureTrackedOrdersColumn('response_body', 'TEXT');
ensureTrackedOrdersColumn('response_headers', 'TEXT');
ensureTrackedOrdersColumn('request_url', 'TEXT');
ensureTrackedOrdersColumn('integration_identifier', 'TEXT');
ensureTrackedOrdersColumn('api_key_prefix', 'TEXT');

function nowIso() {
  return new Date().toISOString();
}

export function createSyncRun(sourceMode) {
  const startedAt = nowIso();
  const result = db.prepare(`
    INSERT INTO sync_runs (source_mode, status, started_at)
    VALUES (?, 'running', ?)
  `).run(sourceMode, startedAt);

  return {
    runId: Number(result.lastInsertRowid),
    startedAt,
  };
}

export function finishSyncRun(runId, summary) {
  db.prepare(`
    UPDATE sync_runs
    SET status = ?,
        finished_at = ?,
        seen_count = ?,
        imported_count = ?,
        skipped_count = ?,
        unchanged_count = ?,
        error_count = ?,
        last_error = ?
    WHERE run_id = ?
  `).run(
    summary.status,
    nowIso(),
    summary.seenCount || 0,
    summary.importedCount || 0,
    summary.skippedCount || 0,
    summary.unchangedCount || 0,
    summary.errorCount || 0,
    summary.lastError || null,
    runId
  );
}

export function getTrackedOrder(orderId) {
  return db.prepare(`
    SELECT *
    FROM tracked_orders
    WHERE order_id = ?
  `).get(orderId);
}

export function upsertTrackedOrder(record) {
  db.prepare(`
    INSERT INTO tracked_orders (
      order_id,
      order_number,
      external_status,
      payment_status,
      fulfillment_status,
      payload_hash,
      raw_payload,
      customer_name,
      shipping_address,
      shipping_city,
      source_mode,
      import_status,
      first_seen_at,
      last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_id) DO UPDATE SET
      order_number = excluded.order_number,
      external_status = excluded.external_status,
      payment_status = excluded.payment_status,
      fulfillment_status = excluded.fulfillment_status,
      payload_hash = excluded.payload_hash,
      raw_payload = excluded.raw_payload,
      customer_name = excluded.customer_name,
      shipping_address = excluded.shipping_address,
      shipping_city = excluded.shipping_city,
      source_mode = excluded.source_mode,
      last_seen_at = excluded.last_seen_at
  `).run(
    record.orderId,
    record.orderNumber,
    record.externalStatus,
    record.paymentStatus,
    record.fulfillmentStatus,
    record.payloadHash,
    record.rawPayload,
    record.customerName,
    record.shippingAddress,
    record.shippingCity,
    record.sourceMode,
    record.importStatus,
    record.firstSeenAt,
    record.lastSeenAt
  );
}

export function markOrderImported(orderId, sectoriceResponse) {
  db.prepare(`
    UPDATE tracked_orders
    SET import_status = 'imported',
        imported_at = ?,
        skipped_at = NULL,
        last_error = NULL,
        http_status = NULL,
        response_body = NULL,
        response_headers = NULL,
        request_url = NULL,
        integration_identifier = NULL,
        api_key_prefix = NULL,
        sectorice_response = ?
    WHERE order_id = ?
  `).run(nowIso(), JSON.stringify(sectoriceResponse || {}), orderId);
}

export function markOrderSkipped(orderId, importStatus, reason) {
  db.prepare(`
    UPDATE tracked_orders
    SET import_status = ?,
        skipped_at = ?,
        last_error = ?,
        http_status = NULL,
        response_body = NULL,
        response_headers = NULL,
        request_url = NULL,
        integration_identifier = NULL,
        api_key_prefix = NULL,
        sectorice_response = NULL
    WHERE order_id = ?
  `).run(importStatus, nowIso(), reason || null, orderId);
}

export function markOrderError(orderId, errorContext = {}) {
  const reason = typeof errorContext === 'string' ? errorContext : errorContext.reason;
  const httpStatus = typeof errorContext === 'object' ? (errorContext.httpStatus ?? null) : null;
  const responseBody = typeof errorContext === 'object' && errorContext.responseBody !== undefined
    ? JSON.stringify(errorContext.responseBody)
    : null;
  const responseHeaders = typeof errorContext === 'object' && errorContext.responseHeaders !== undefined
    ? JSON.stringify(errorContext.responseHeaders)
    : null;
  const requestUrl = typeof errorContext === 'object' ? (errorContext.requestUrl ?? null) : null;
  const integrationIdentifier = typeof errorContext === 'object'
    ? (errorContext.integrationIdentifier ?? null)
    : null;
  const apiKeyPrefix = typeof errorContext === 'object' ? (errorContext.apiKeyPrefix ?? null) : null;

  db.prepare(`
    UPDATE tracked_orders
    SET import_status = 'error_forward',
        last_error = ?,
        http_status = ?,
        response_body = ?,
        response_headers = ?,
        request_url = ?,
        integration_identifier = ?,
        api_key_prefix = ?,
        sectorice_response = NULL
    WHERE order_id = ?
  `).run(
    reason || null,
    httpStatus,
    responseBody,
    responseHeaders,
    requestUrl,
    integrationIdentifier,
    apiKeyPrefix,
    orderId
  );
}

export function listRecentOrders(limit = 20) {
  return db.prepare(`
    SELECT
      order_id,
      order_number,
      external_status,
      payment_status,
      fulfillment_status,
      import_status,
      customer_name,
      shipping_address,
      shipping_city,
      first_seen_at,
      last_seen_at,
      imported_at,
      skipped_at,
      last_error,
      http_status,
      response_body,
      response_headers,
      request_url,
      integration_identifier,
      api_key_prefix
    FROM tracked_orders
    ORDER BY last_seen_at DESC
    LIMIT ?
  `).all(limit);
}

export function listRecentRuns(limit = 10) {
  return db.prepare(`
    SELECT *
    FROM sync_runs
    ORDER BY run_id DESC
    LIMIT ?
  `).all(limit);
}

export function getState(key) {
  const row = db.prepare(`
    SELECT state_value
    FROM app_state
    WHERE state_key = ?
  `).get(key);
  return row?.state_value ?? null;
}

export function setState(key, value) {
  db.prepare(`
    INSERT INTO app_state (state_key, state_value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(state_key) DO UPDATE SET
      state_value = excluded.state_value,
      updated_at = excluded.updated_at
  `).run(key, value, nowIso());
}
