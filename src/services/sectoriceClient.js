import axios from 'axios';

function createSectoriceHttpClient({ sectoriceApiUrl, apiKey }) {
  return axios.create({
    baseURL: sectoriceApiUrl.replace(/\/$/, ''),
    timeout: 20000,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
  });
}

function createSectoriceInternalHttpClient({ sectoriceApiUrl, adapterToken }) {
  return axios.create({
    baseURL: sectoriceApiUrl.replace(/\/$/, ''),
    timeout: 20000,
    headers: {
      Accept: 'application/json',
      'X-Adapter-Token': adapterToken,
    },
  });
}

export async function importOrdersToSectorice({ sectoriceApiUrl, apiKey, payload }) {
  const client = createSectoriceHttpClient({ sectoriceApiUrl, apiKey });
  const response = await client.post('/v1/ecommerce/orders/import', payload);
  return response.data;
}

export async function listJumpsellerRuntimeIntegrations({ sectoriceApiUrl, adapterToken }) {
  const client = createSectoriceInternalHttpClient({ sectoriceApiUrl, adapterToken });
  const response = await client.get('/v1/internal/jumpseller/integrations/runtime');
  return Array.isArray(response.data) ? response.data : [];
}
