# Sectorice Jumpseller App

Adaptador Jumpseller separado del core de Sectorice y separado del adaptador Shopify.

Esta app:

- consulta pedidos de Jumpseller por API
- deduplica y persiste estado local en SQLite
- transforma el payload Jumpseller al formato ecommerce de Sectorice
- envia pedidos a la API existente de Sectorice usando `X-API-Key`
- deja pedidos incompletos en estado local si no cumplen campos minimos

## Stack

- Node.js
- Express
- `axios`
- `better-sqlite3`
- `dotenv`

## Variables de entorno

```env
JUMPSELLER_STORE_URL=https://sectorice.jumpseller.com
JUMPSELLER_LOGIN=
JUMPSELLER_AUTH_TOKEN=
JUMPSELLER_ALLOWED_STATUSES=paid,pending
JUMPSELLER_PAGE_SIZE=50
JUMPSELLER_MAX_PAGES=10
JUMPSELLER_SYNC_ENABLED=true
JUMPSELLER_SYNC_ON_STARTUP=true
JUMPSELLER_POLL_INTERVAL_MS=60000
SECTORICE_API_URL=https://sectorice.cl
SECTORICE_API_KEY=
SYNC_ADMIN_TOKEN=
PORT=3002
```

## Rutas

- `GET /health`
- `GET /sync/status`
- `GET /sync/orders/recent`
- `GET /sync/runs/recent`
- `POST /sync/run`

Si defines `SYNC_ADMIN_TOKEN`, el endpoint `POST /sync/run` exige el header `X-Sync-Admin-Token`.

## Flujo

1. La app consulta `GET /v1/orders.json` de Jumpseller.
2. Guarda cada pedido y su hash en SQLite.
3. Si el pedido ya fue importado y no cambio, lo omite.
4. Si el pedido no tiene datos minimos para Sectorice, lo deja marcado como `skipped_missing_required_fields`.
5. Si el pedido cumple, lo envia a `POST /v1/ecommerce/orders/import`.
6. Sectorice resuelve la integracion y lo ingresa al pipeline operativo.

## Notas importantes

- Este adaptador no comparte mapper ni reglas con Shopify.
- Cada ecommerce mantiene su propia app y su propia normalizacion.
- El tipo de servicio y los datos de origen los define la integracion ecommerce configurada en Sectorice.
