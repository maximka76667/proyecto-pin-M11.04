import { Platform } from 'react-native';
import { File as ExpoFile } from 'expo-file-system';
import { router, type Href } from 'expo-router';
import { clearCurrentSessionIds, setCurrentSessionIds } from '@/constants/dev-session';
import {
  clearStoredToken,
  loadStoredToken,
  readStoredTokenSync,
  saveStoredToken,
} from '@/lib/auth-storage';

const configuredApiUrl = process.env.EXPO_PUBLIC_BACKEND_URL?.trim();
export const API_URL = (configuredApiUrl || 'http://localhost:3000').replace(/\/+$/, '');

export type Apartment = {
  id: string;
  name: string;
  address: string;
  landlord_id: string | null;
  invite_code: string;
};

export type TransactionCategory =
  'utilities' | 'maintenance' | 'supplies' | 'entertainment' | 'payment' | 'other' | 'pending';

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
export type UploadFile = {
  uri: string;
  name: string;
  type: string;
  file?: Blob;
};

export type Member = {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  isCurrentUser?: boolean;
};

export type CurrentUser = {
  id: string;
  email: string | null;
  full_name: string;
  avatar_url?: string | null;
  is_landlord: boolean;
  user_apartments: { apartment_id: string }[];
};

// En la web el token se lee al arrancar; en el móvil llega de SecureStore con loadAuthToken()
let authToken: string | null = readStoredTokenSync();
let tokenLoad: Promise<void> | null = null;
let sessionExpiring = false;

// El layout espera a esto antes de decidir si hay sesión
export function loadAuthToken() {
  tokenLoad ??= loadStoredToken().then((stored) => {
    if (authToken === null) authToken = stored;
  });
  return tokenLoad;
}

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) sessionExpiring = false;
  void (token ? saveStoredToken(token) : clearStoredToken());
}

export function hasAuthToken() {
  return Boolean(authToken);
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const user = (await api('GET', '/auth/me')) as CurrentUser;
  setCurrentSessionIds(user.id, user.user_apartments[0]?.apartment_id);
  return user;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// No hubo respuesta: sin conexión, servidor caído o tiempo de espera agotado (PA-1016.04)
export const CONNECTION_ERROR = 'No se ha podido conectar. Inténtalo de nuevo';

export class ConnectionError extends Error {
  constructor() {
    super(CONNECTION_ERROR);
    this.name = 'ConnectionError';
  }
}

// Tiempo máximo de cada petición: pasado ese tiempo se corta y se muestra el error en vez de
// dejar la pantalla cargando para siempre. Las subidas tienen más margen: llevan una imagen
// y el escáner de tickets espera además a que Gemini la lea
const REQUEST_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 60_000;

// Envía la petición y lee la respuesta con un único límite de tiempo, que cubre también el
// cuerpo: un servidor que contesta las cabeceras y se queda callado tampoco cuelga la app.
// onResponse se llama en cuanto llega la respuesta, antes de leer el cuerpo
async function sendWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  onResponse?: (response: Response) => void,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    onResponse?.(response);
    return await readResponse(response);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // fetch falla con TypeError cuando no hay red; con el tiempo agotado, con un abort
    if (controller.signal.aborted || e instanceof TypeError) throw new ConnectionError();
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// En estas rutas un 401 significa "credenciales incorrectas", no "sesión caducada"
const CREDENTIAL_PATHS = ['/auth/login', '/auth/register'];

// Sesión caducada o revocada (p. ej. se cambió la contraseña en otro dispositivo, PA-1015.02):
// se borra la sesión local y se vuelve al login con el aviso. Solo una vez aunque fallen
// varias peticiones a la vez
function handleSessionExpired() {
  if (sessionExpiring) return;
  sessionExpiring = true;
  setAuthToken(null);
  clearCurrentSessionIds();
  if (router.canDismiss()) router.dismissAll();
  router.replace({ pathname: '/auth', params: { expired: '1' } } as Href);
}

// Sends the request and throws an Error with the backend message if it fails
export async function api(method: string, path: string, body?: object) {
  const sentToken = authToken;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sentToken) headers.Authorization = `Bearer ${sentToken}`;
  return sendWithTimeout(
    `${API_URL}${path}`,
    { method, headers, body: body ? JSON.stringify(body) : undefined },
    REQUEST_TIMEOUT_MS,
    (response) => {
      // Solo si el token rechazado sigue siendo el actual: tras cambiar la contraseña llega
      // uno nuevo, y una petición antigua que vuelva con 401 no debe cerrar la sesión buena
      if (
        response.status === 401 &&
        sentToken &&
        sentToken === authToken &&
        !CREDENTIAL_PATHS.includes(path)
      ) {
        handleSessionExpired();
      }
    },
  );
}

// Uploads a file as multipart/form-data in the given field.
// No Content-Type header: fetch sets it with the multipart boundary
export async function apiUpload(
  path: string,
  field: string,
  upload: UploadFile,
  timeoutMs = UPLOAD_TIMEOUT_MS,
) {
  const form = new FormData();
  const part = await getUploadBlob(upload);
  form.append(field, part, upload.name);
  const headers: Record<string, string> = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return sendWithTimeout(`${API_URL}${path}`, { method: 'POST', headers, body: form }, timeoutMs);
}

async function getUploadBlob(upload: UploadFile): Promise<Blob> {
  if (Platform.OS === 'web' && upload.file) {
    return upload.file;
  }
  if (Platform.OS === 'web' || upload.uri.startsWith('blob:') || upload.uri.startsWith('data:')) {
    const res = await fetch(upload.uri);
    return await res.blob();
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
