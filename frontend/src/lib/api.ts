import { Platform } from 'react-native';
import { File as ExpoFile } from 'expo-file-system';

//export const API_URL = 'http://localhost:3000';
export const API_URL = 'http://192.168.1.48:3000';

export type Apartment = {
  id: string;
  name: string;
  address: string;
  landlord_id: string | null;
  invite_code: string;
};

export type TransactionCategory =
  | 'utilities'
  | 'maintenance'
  | 'supplies'
  | 'entertainment'
  | 'payment'
  | 'other'
  | 'pending';

export type Transaction = {
  id: string;
  apartment_id: string;
  from_user_id: string;
  to_user_id: string;
  amount: string;
  concept: string | null;
  category: TransactionCategory;
};

// What POST /scanner/ticket returns. unit_price is null when the price could not be read
export type ScannedItem = {
  name: string;
  quantity: number;
  unit_price: string | null;
  category: TransactionCategory;
};

export type ScannedTicket = {
  comercio: string | null;
  items: ScannedItem[];
};

// file is only set on web (the picker gives a real File); on native React Native uploads { uri, name, type }
export type UploadFile = { uri: string; name: string; type: string; file?: Blob };

export type Member = {
  id: string;
  full_name: string;
  isCurrentUser?: boolean;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Sends the request and throws an Error with the backend message if it fails
export async function api(method: string, path: string, body?: object) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return readResponse(response);
}

// Uploads a file as multipart/form-data in the given field.
// No Content-Type header: fetch sets it with the multipart boundary
export async function apiUpload(path: string, field: string, upload: UploadFile) {
  const form = new FormData();
  const part = await getUploadBlob(upload);
  form.append(field, part, upload.name);
  const response = await fetch(`${API_URL}${path}`, { method: 'POST', body: form });
  return readResponse(response);
}

async function getUploadBlob(upload: UploadFile): Promise<Blob> {
  if (Platform.OS === 'web' && upload.file) {
    return upload.file;
  }

  // On native, image-picker returns a local file:// URI. Expo's File is a
  // native Blob implementation and can be passed directly to FormData.
  return new ExpoFile(upload.uri);
}

async function readResponse(response: Response) {
  const data = await response.json();
  if (!response.ok) {
    const message = Array.isArray(data.message) ? data.message.join('\n') : data.message;
    throw new ApiError(message, response.status);
  }
  return data;
}

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : 'Error al conectar';
}
