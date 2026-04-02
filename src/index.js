import express from 'express';
import dotenv from 'dotenv';
import { createSyncRouter } from './routes/sync.js';
import { createJumpsellerSyncService } from './services/syncService.js';

dotenv.config();

const requiredEnv = [
  'JUMPSELLER_LOGIN',
  'JUMPSELLER_AUTH_TOKEN',
  'SECTORICE_API_URL',
  'SECTORICE_API_KEY',
];

const missingEnv = requiredEnv.filter((key) => !process.env[key] || !process.env[key].trim());
if (missingEnv.length > 0) {
  console.warn(`[sectorice-jumpseller-app] Faltan variables: ${missingEnv.join(', ')}`);
}

const appConfig = {
  jumpsellerStoreUrl: (process.env.JUMPSELLER_STORE_URL || 'https://sectorice.jumpseller.com').replace(/\/$/, ''),
  jumpsellerLogin: process.env.JUMPSELLER_LOGIN || '',
  jumpsellerAuthToken: process.env.JUMPSELLER_AUTH_TOKEN || '',
  allowedStatuses: process.env.JUMPSELLER_ALLOWED_STATUSES || 'paid,pending',
  pageSize: Math.max(Number(process.env.JUMPSELLER_PAGE_SIZE || 50), 1),
  maxPages: Math.max(Number(process.env.JUMPSELLER_MAX_PAGES || 10), 1),
  syncEnabled: String(process.env.JUMPSELLER_SYNC_ENABLED || 'true').toLowerCase() === 'true',
  syncOnStartup: String(process.env.JUMPSELLER_SYNC_ON_STARTUP || 'true').toLowerCase() === 'true',
  pollIntervalMs: Math.max(Number(process.env.JUMPSELLER_POLL_INTERVAL_MS || 60000), 5000),
  sectoriceApiUrl: (process.env.SECTORICE_API_URL || 'https://sectorice.cl').replace(/\/$/, ''),
  sectoriceApiKey: process.env.SECTORICE_API_KEY || '',
  syncAdminToken: process.env.SYNC_ADMIN_TOKEN || '',
  port: Number(process.env.PORT || 3002),
};

const app = express();
const syncService = createJumpsellerSyncService({ appConfig });

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    success: true,
    ...syncService.getHealth(),
  });
});

app.use('/sync', createSyncRouter({ syncService, appConfig }));

app.use((error, _req, res, _next) => {
  console.error('[sectorice-jumpseller-app] Unhandled error', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
});

const server = app.listen(appConfig.port, () => {
  console.log(`[sectorice-jumpseller-app] Listening on port ${appConfig.port}`);
  console.log(`[sectorice-jumpseller-app] Store ${appConfig.jumpsellerStoreUrl}`);
  syncService.startPolling();
});

process.on('SIGTERM', () => {
  syncService.stopPolling();
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  syncService.stopPolling();
  server.close(() => process.exit(0));
});
