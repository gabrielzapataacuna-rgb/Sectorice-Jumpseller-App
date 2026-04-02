import express from 'express';

function verifySyncAdminToken(req, appConfig) {
  if (!appConfig.syncAdminToken) {
    return true;
  }
  return req.get('X-Sync-Admin-Token') === appConfig.syncAdminToken;
}

export function createSyncRouter({ syncService, appConfig }) {
  const router = express.Router();

  router.get('/status', (_req, res) => {
    res.json({
      success: true,
      ...syncService.getHealth(),
    });
  });

  router.get('/orders/recent', (req, res) => {
    const limit = Number(req.query.limit || 20);
    res.json({
      success: true,
      content: syncService.listRecentOrders(Math.max(1, Math.min(limit, 100))),
    });
  });

  router.get('/runs/recent', (req, res) => {
    const limit = Number(req.query.limit || 10);
    res.json({
      success: true,
      content: syncService.listRecentRuns(Math.max(1, Math.min(limit, 100))),
    });
  });

  router.post('/run', async (req, res, next) => {
    try {
      if (!verifySyncAdminToken(req, appConfig)) {
        return res.status(401).json({
          success: false,
          message: 'Invalid sync admin token',
        });
      }

      const result = await syncService.syncNow({
        sourceMode: 'manual',
        force: Boolean(req.body?.force),
      });

      return res.status(result.success ? 200 : (result.locked ? 409 : 500)).json(result);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
