import { Platform } from 'react-native';

// There is no login yet, so the screens that need "who am I" and "which apartment" use these
// fixed ids (the same ones as the seed data). Replace them when authentication exists.
const DEFAULT_APARTMENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DEFAULT_USER_ID = '22222222-2222-2222-2222-222222222222';
const APARTMENT_KEY = 'room8_apartment_id';
const USER_KEY = 'room8_user_id';

// En el móvil `window` existe pero `localStorage` no: solo se usa en la web
function storage() {
  return Platform.OS === 'web' && typeof window !== 'undefined' ? window.localStorage : null;
}

const storedApartmentId = storage()?.getItem(APARTMENT_KEY) ?? null;
const storedUserId = storage()?.getItem(USER_KEY) ?? null;

export let APARTMENT_ID = storedApartmentId ?? DEFAULT_APARTMENT_ID;
export let USER_ID = storedUserId ?? DEFAULT_USER_ID;

export function setCurrentSessionIds(userId: string, apartmentId?: string) {
  USER_ID = userId;
  if (apartmentId) APARTMENT_ID = apartmentId;
  storage()?.setItem(USER_KEY, userId);
  if (apartmentId) storage()?.setItem(APARTMENT_KEY, apartmentId);
}

// Al cerrar sesión o caducar: que el siguiente usuario no herede los ids del anterior
export function clearCurrentSessionIds() {
  USER_ID = DEFAULT_USER_ID;
  APARTMENT_ID = DEFAULT_APARTMENT_ID;
  try {
    storage()?.removeItem(USER_KEY);
    storage()?.removeItem(APARTMENT_KEY);
  } catch {
    // Almacenamiento bloqueado: los valores en memoria ya están limpios
  }
}
