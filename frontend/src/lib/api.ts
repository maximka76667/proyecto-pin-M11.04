export const API_URL = 'http://localhost:3000';

export type Apartment = {
  id: string;
  name: string;
  address: string;
  landlord_id: string | null;
};

// Sends the request and throws an Error with the backend message if it fails
export async function api(method: string, path: string, body?: object) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    const message = Array.isArray(data.message) ? data.message.join('\n') : data.message;
    throw new Error(`${response.status}: ${message}`);
  }
  return data;
}

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : 'Error al conectar';
}
