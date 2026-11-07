import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Dónde se guarda el token de sesión (PA-1015.05):
// - Móvil: SecureStore (Keychain en iOS, Keystore en Android). Nunca AsyncStorage, que es texto plano.
//   WHEN_UNLOCKED_THIS_DEVICE_ONLY: solo con el móvil desbloqueado y no viaja en las copias a otro móvil.
// - Web: SecureStore no existe en el navegador, así que se usa localStorage.
const TOKEN_KEY = 'room8_auth_token';
const isWeb = Platform.OS === 'web';
const nativeOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function webStorage() {
  return isWeb && typeof window !== 'undefined' ? window.localStorage : null;
}

// En la web se puede leer al arrancar, sin esperar
export function readStoredTokenSync() {
  try {
    return webStorage()?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export async function loadStoredToken() {
  try {
    if (isWeb) return readStoredTokenSync();
    return await SecureStore.getItemAsync(TOKEN_KEY, nativeOptions);
  } catch {
    // Si el almacén no se puede leer, se empieza sin sesión
    return null;
  }
}

export async function saveStoredToken(token: string) {
  try {
    if (isWeb) webStorage()?.setItem(TOKEN_KEY, token);
    else await SecureStore.setItemAsync(TOKEN_KEY, token, nativeOptions);
  } catch {
    // Sin poder guardarlo la sesión dura hasta cerrar la app, pero sigue funcionando
  }
}

export async function clearStoredToken() {
  try {
    if (isWeb) webStorage()?.removeItem(TOKEN_KEY);
    else await SecureStore.deleteItemAsync(TOKEN_KEY, nativeOptions);
  } catch {
    // Nada que hacer: el token en memoria ya está borrado
  }
}
