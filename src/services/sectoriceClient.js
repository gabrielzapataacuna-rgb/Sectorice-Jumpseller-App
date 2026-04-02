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

export async function importOrdersToSectorice({ sectoriceApiUrl, apiKey, payload }) {
  const client = createSectoriceHttpClient({ sectoriceApiUrl, apiKey });
  const response = await client.post('/v1/ecommerce/orders/import', payload);
  return response.data;
}
