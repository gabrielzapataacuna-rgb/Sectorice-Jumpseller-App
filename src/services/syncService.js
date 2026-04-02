import crypto from 'crypto';
import {
  createSyncRun,
  finishSyncRun,
  getState,
  getTrackedOrder,
  listRecentOrders,
  listRecentRuns,
  markOrderError,
  markOrderImported,
  markOrderSkipped,
  setState,
  upsertTrackedOrder,
} from '../db/database.js';
import { fetchAllJumpsellerOrders } from './jumpsellerClient.js';
import {
  getJumpsellerCompleteness,
  getJumpsellerStatusSnapshot,
  mapJumpsellerOrderToSectoriceImportItem,
  unwrapJumpsellerOrder,
} from './jumpsellerMapper.js';
import { importOrdersToSectorice } from './sectoriceClient.js';

function normalizeStatusToken(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return normalized || null;
}

function buildPayloadHash(rawPayload) {
  return crypto.createHash('sha256').update(rawPayload).digest('hex');
}

function resolveAllowedStatuses(rawAllowedStatuses) {
  return String(rawAllowedStatuses || '')
    .split(',')
    .map((item) => normalizeStatusToken(item))
    .filter(Boolean);
}

function evaluateOrderEligibility(order, allowedStatuses) {
  const statusSnapshot = getJumpsellerStatusSnapshot(order);
  const tokens = [
    statusSnapshot.externalStatus,
    statusSnapshot.paymentStatus,
    statusSnapshot.fulfillmentStatus,
  ]
    .map((value) => normalizeStatusToken(value))
    .filter(Boolean);

  if (tokens.some((value) => value.includes('cancel') || value.includes('void'))) {
    return {
      allowed: false,
      importStatus: 'skipped_cancelled',
      reason: 'Pedido cancelado o anulado en Jumpseller.',
    };
  }

  if (allowedStatuses.length === 0) {
    return { allowed: true };
  }

  if (tokens.some((value) => allowedStatuses.some((allowed) => value === allowed || value.includes(allowed)))) {
    return { allowed: true };
  }

  return {
    allowed: false,
    importStatus: 'skipped_filtered_status',
    reason: `Pedido omitido por estado no permitido (${tokens.join(', ') || 'sin estado visible'}).`,
  };
}

function createTrackedOrderRecord(rawOrder, sourceMode) {
  const order = unwrapJumpsellerOrder(rawOrder);
  const statusSnapshot = getJumpsellerStatusSnapshot(order);
  const rawPayload = JSON.stringify(order);
  const now = new Date().toISOString();

  return {
    orderId: String(order.id),
    orderNumber: order.number != null ? String(order.number) : (order.order_number != null ? String(order.order_number) : null),
    externalStatus: statusSnapshot.externalStatus,
    paymentStatus: statusSnapshot.paymentStatus,
    fulfillmentStatus: statusSnapshot.fulfillmentStatus,
    payloadHash: buildPayloadHash(rawPayload),
    rawPayload,
    customerName: order?.customer?.full_name || order?.customer?.fullname || null,
    shippingAddress: order?.shipping_address?.address || order?.shipping_address?.street || null,
    shippingCity: order?.shipping_address?.city || order?.shipping_address?.municipality || null,
    sourceMode,
    importStatus: 'seen',
    firstSeenAt: now,
    lastSeenAt: now,
  };
}

function createUploadName(order) {
  const normalizedOrder = unwrapJumpsellerOrder(order);
  return `Jumpseller order ${normalizedOrder.number || normalizedOrder.order_number || normalizedOrder.id}`;
}

export function createJumpsellerSyncService({ appConfig }) {
  let lastSummary = null;
  let currentRun = null;
  let pollingTimer = null;

  async function syncNow({ sourceMode = 'polling', force = false } = {}) {
    if (currentRun) {
      return {
        success: false,
        locked: true,
        message: 'Ya hay una sincronizacion Jumpseller en curso.',
        currentRun,
      };
    }

    const run = createSyncRun(sourceMode);
    currentRun = {
      runId: run.runId,
      startedAt: run.startedAt,
      sourceMode,
    };

    const summary = {
      status: 'success',
      seenCount: 0,
      importedCount: 0,
      skippedCount: 0,
      unchangedCount: 0,
      errorCount: 0,
      lastError: null,
    };

    try {
      const { orders, pageErrors } = await fetchAllJumpsellerOrders({
        login: appConfig.jumpsellerLogin,
        authToken: appConfig.jumpsellerAuthToken,
        pageSize: appConfig.pageSize,
        maxPages: appConfig.maxPages,
      });

      summary.seenCount = orders.length;
      if (pageErrors.length > 0) {
        summary.errorCount += pageErrors.length;
        summary.status = 'partial_success';
        summary.lastError = pageErrors
          .map((item) => `page ${item.page}: ${item.message}`)
          .join(' | ');
      }
      const allowedStatuses = resolveAllowedStatuses(appConfig.allowedStatuses);

      for (const rawOrder of orders) {
        const tracked = createTrackedOrderRecord(rawOrder, sourceMode);
        const existing = getTrackedOrder(tracked.orderId);

        upsertTrackedOrder(tracked);

        if (!force && existing && existing.payload_hash === tracked.payloadHash) {
          if (existing.import_status === 'imported' || String(existing.import_status || '').startsWith('skipped_')) {
            summary.unchangedCount += 1;
            continue;
          }
        }

        const eligibility = evaluateOrderEligibility(rawOrder, allowedStatuses);
        if (!eligibility.allowed) {
          markOrderSkipped(tracked.orderId, eligibility.importStatus, eligibility.reason);
          summary.skippedCount += 1;
          continue;
        }

        try {
          const completeness = getJumpsellerCompleteness(rawOrder);
          if (!completeness.complete) {
            markOrderSkipped(
              tracked.orderId,
              'pending_barcode_only_candidate',
              `Candidato a JUMPSELLER_BARCODE_ONLY. Faltan: ${completeness.missing.join(', ')}`
            );
            summary.skippedCount += 1;
            continue;
          }

          const mappedOrder = mapJumpsellerOrderToSectoriceImportItem(rawOrder);
          const sectoriceResponse = await importOrdersToSectorice({
            sectoriceApiUrl: appConfig.sectoriceApiUrl,
            apiKey: appConfig.sectoriceApiKey,
            payload: {
              uploadName: createUploadName(rawOrder),
              confirmOperational: true,
              orders: [mappedOrder],
            },
          });

          markOrderImported(tracked.orderId, sectoriceResponse);
          summary.importedCount += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Error desconocido';
          if (message.includes('recipientName') || message.includes('address') || message.includes('comuna')) {
            markOrderSkipped(tracked.orderId, 'skipped_missing_required_fields', message);
            summary.skippedCount += 1;
            continue;
          }

          markOrderError(tracked.orderId, message);
          summary.errorCount += 1;
          if (summary.status !== 'partial_success') {
            summary.status = 'error';
          }
          summary.lastError = summary.lastError ? `${summary.lastError} | ${message}` : message;
        }
      }

      setState('last_successful_sync_at', new Date().toISOString());
      return {
        success: summary.status === 'success',
        locked: false,
        summary,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido al sincronizar con Jumpseller';
      summary.status = 'error';
      summary.errorCount += 1;
      summary.lastError = message;
      return {
        success: false,
        locked: false,
        summary,
      };
    } finally {
      finishSyncRun(run.runId, summary);
      lastSummary = {
        runId: run.runId,
        sourceMode,
        startedAt: run.startedAt,
        ...summary,
      };
      currentRun = null;
    }
  }

  function startPolling() {
    if (!appConfig.syncEnabled) {
      console.log('[sectorice-jumpseller-app] Polling deshabilitado por configuracion.');
      return;
    }

    if (appConfig.syncOnStartup) {
      void syncNow({ sourceMode: 'startup' });
    }

    pollingTimer = setInterval(() => {
      void syncNow({ sourceMode: 'polling' });
    }, appConfig.pollIntervalMs);
  }

  function stopPolling() {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  }

  function getHealth() {
    return {
      service: 'sectorice-jumpseller-app',
      status: 'ok',
      syncEnabled: appConfig.syncEnabled,
      currentRun,
      lastSummary,
      lastSuccessfulSyncAt: getState('last_successful_sync_at'),
    };
  }

  return {
    syncNow,
    startPolling,
    stopPolling,
    getHealth,
    listRecentOrders,
    listRecentRuns,
  };
}
