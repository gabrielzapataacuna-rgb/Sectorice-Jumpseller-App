import axios from 'axios';

function createJumpsellerHttpClient() {
  return axios.create({
    baseURL: 'https://api.jumpseller.com/v1',
    timeout: 20000,
  });
}

export async function listJumpsellerOrders({ login, authToken, page = 1, limit = 50 }) {
  const client = createJumpsellerHttpClient();
  const response = await client.get('/orders.json', {
    params: {
      login,
      authtoken: authToken,
      page,
      limit,
    },
  });

  return Array.isArray(response.data) ? response.data : [];
}

export async function fetchAllJumpsellerOrders({ login, authToken, pageSize, maxPages }) {
  const allOrders = [];
  const pageErrors = [];

  for (let page = 1; page <= maxPages; page += 1) {
    let pageOrders = [];
    try {
      pageOrders = await listJumpsellerOrders({
        login,
        authToken,
        page,
        limit: pageSize,
      });
    } catch (error) {
      pageErrors.push({
        page,
        message: error instanceof Error ? error.message : 'Error desconocido al consultar Jumpseller',
      });
      console.error(`[jumpseller-sync] Error al obtener pagina ${page}:`, error instanceof Error ? error.message : error);
      continue;
    }
    allOrders.push(...pageOrders);

    if (pageOrders.length < pageSize) {
      break;
    }
  }

  return { orders: allOrders, pageErrors };
}
