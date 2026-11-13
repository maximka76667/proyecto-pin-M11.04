// Política de contraseñas de la UT1015. La app (frontend/src/lib/password-policy.ts) valida
// con las mismas reglas y los mismos textos; esto es la red de seguridad por si alguien
// llama a la API saltándose la app.

// bcrypt solo usa los primeros 72 bytes: más allá, dos contraseñas distintas darían el mismo hash
export const PASSWORD_MAX_BYTES = 72;

// Tope para la contraseña actual: no hace falta más y evita procesar cuerpos enormes
export const CURRENT_PASSWORD_MAX_BYTES = 256;

// Al menos 8 caracteres, una letra (cualquier alfabeto, incluidas ñ y tildes) y un número
export const PASSWORD_PATTERN = /^(?=.*\p{L})(?=.*\d).{8,}$/u;

// 8 dígitos = 100 millones de combinaciones. Con 6 eran un millón, y forzando códigos
// nuevos se llegaba a ~7.200 pruebas al día; con 8 esa misma presión es 100 veces menor
export const RESET_CODE_DIGITS = 8;
export const RESET_CODE_PATTERN = /^\d{8}$/;

export const PASSWORD_MESSAGES = {
  required: 'Este campo es obligatorio',
  policy: 'La contraseña debe tener al menos 8 caracteres, una letra y un número',
  tooLong: 'La contraseña es demasiado larga',
  mismatch: 'Las contraseñas nuevas no coinciden',
  sameAsCurrent: 'La nueva contraseña debe ser distinta de la actual',
  invalidEmail: 'Introduce un email válido',
  invalidCode: 'El código debe tener 8 dígitos',
  // Respuestas del servicio (fase 2). La app usa estos textos para saber bajo qué campo
  // mostrar cada error, así que si se cambian hay que cambiarlos también allí
  currentIncorrect: 'La contraseña actual es incorrecta',
  invalidOrExpiredCode: 'El código no es válido o ha caducado',
  googleAccount: 'Tu cuenta inicia sesión con Google y no tiene contraseña',
} as const;

export const PASSWORD_UPDATED = 'Contraseña actualizada correctamente';
export const RESET_REQUESTED = 'Si el email está registrado, te hemos enviado un código';
export const RESET_DONE = 'Contraseña restablecida. Ya puedes iniciar sesión';
export const TOO_MANY_ATTEMPTS = 'Demasiados intentos. Inténtalo más tarde.';

export const RESET_CODE_TTL_MINUTES = 15;
export const RESET_CODE_MAX_ATTEMPTS = 5;
// Entre dos códigos para el mismo email, para que nadie pueda llenarle la bandeja
export const RESET_CODE_COOLDOWN_SECONDS = 60;
