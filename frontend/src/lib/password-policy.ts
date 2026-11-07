import { ApiError } from '@/lib/api';

// Mismas reglas y textos que backend/src/auth/password/password-policy.ts.
// La app valida antes de enviar para no hacer peticiones que la API va a rechazar;
// el backend vuelve a validar por si alguien llama a la API saltándose la app.
export const PASSWORD_MESSAGES = {
  required: 'Este campo es obligatorio',
  policy: 'La contraseña debe tener al menos 8 caracteres, una letra y un número',
  tooLong: 'La contraseña es demasiado larga',
  mismatch: 'Las contraseñas nuevas no coinciden',
  sameAsCurrent: 'La nueva contraseña debe ser distinta de la actual',
  invalidEmail: 'Introduce un email válido',
  invalidCode: 'El código debe tener 6 dígitos',
  currentIncorrect: 'La contraseña actual es incorrecta',
  invalidOrExpiredCode: 'El código no es válido o ha caducado',
  googleAccount: 'Tu cuenta inicia sesión con Google y no tiene contraseña',
} as const;

export const PASSWORD_UPDATED = 'Contraseña actualizada correctamente';
export const PASSWORD_HINT = 'Usa al menos 8 caracteres, una letra y un número.';

// bcrypt solo usa los primeros 72 bytes de la contraseña
const PASSWORD_MAX_BYTES = 72;
const CURRENT_PASSWORD_MAX_BYTES = 256;
const PASSWORD_PATTERN = /^(?=.*\p{L})(?=.*\d).{8,}$/u;
const RESET_CODE_PATTERN = /^\d{6}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type PasswordField = 'current' | 'code' | 'next' | 'confirm';
export type FieldErrors = Partial<Record<PasswordField, string>>;

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).length;
}

function validateNewPassword(next: string) {
  if (!next) return PASSWORD_MESSAGES.required;
  if (!PASSWORD_PATTERN.test(next)) return PASSWORD_MESSAGES.policy;
  if (utf8Bytes(next) > PASSWORD_MAX_BYTES) return PASSWORD_MESSAGES.tooLong;
  return undefined;
}

function validateConfirmation(next: string, confirm: string) {
  if (!confirm) return PASSWORD_MESSAGES.required;
  if (confirm !== next) return PASSWORD_MESSAGES.mismatch;
  return undefined;
}

// Cambio desde "Mi cuenta" (PA-1015.04)
export function validatePasswordChange(values: { current: string; next: string; confirm: string }) {
  const errors: FieldErrors = {};

  if (!values.current) errors.current = PASSWORD_MESSAGES.required;
  else if (utf8Bytes(values.current) > CURRENT_PASSWORD_MAX_BYTES) errors.current = PASSWORD_MESSAGES.tooLong;

  const nextError = validateNewPassword(values.next);
  if (nextError) errors.next = nextError;
  else if (values.next === values.current) errors.next = PASSWORD_MESSAGES.sameAsCurrent;

  const confirmError = validateConfirmation(values.next, values.confirm);
  if (confirmError) errors.confirm = confirmError;

  return errors;
}

// Recuperación con el código del email: el código ocupa el lugar de la contraseña actual
export function validatePasswordReset(values: { code: string; next: string; confirm: string }) {
  const errors: FieldErrors = {};

  if (!values.code) errors.code = PASSWORD_MESSAGES.required;
  else if (!RESET_CODE_PATTERN.test(values.code)) errors.code = PASSWORD_MESSAGES.invalidCode;

  const nextError = validateNewPassword(values.next);
  if (nextError) errors.next = nextError;

  const confirmError = validateConfirmation(values.next, values.confirm);
  if (confirmError) errors.confirm = confirmError;

  return errors;
}

export function validateEmail(email: string) {
  const value = email.trim();
  if (!value) return PASSWORD_MESSAGES.required;
  if (value.length > 254 || !EMAIL_PATTERN.test(value)) return PASSWORD_MESSAGES.invalidEmail;
  return undefined;
}

export function hasErrors(errors: FieldErrors) {
  return Object.values(errors).some(Boolean);
}

// Bajo qué campo va cada mensaje que puede devolver la API
const FIELD_BY_MESSAGE: Record<string, PasswordField> = {
  [PASSWORD_MESSAGES.currentIncorrect]: 'current',
  [PASSWORD_MESSAGES.invalidOrExpiredCode]: 'code',
  [PASSWORD_MESSAGES.invalidCode]: 'code',
  [PASSWORD_MESSAGES.policy]: 'next',
  [PASSWORD_MESSAGES.tooLong]: 'next',
  [PASSWORD_MESSAGES.sameAsCurrent]: 'next',
  [PASSWORD_MESSAGES.mismatch]: 'confirm',
};

// Convierte un error de la API en errores por campo más un mensaje general.
// Los detalles internos (404, 500, "Cannot POST…") no se enseñan al usuario
export function describeApiError(error: unknown, fallback: string) {
  if (!(error instanceof ApiError)) {
    return { fields: {} as FieldErrors, general: 'No se ha podido conectar. Revisa tu conexión e inténtalo de nuevo.' };
  }
  if (error.status === 429) {
    return { fields: {} as FieldErrors, general: error.message || 'Demasiados intentos. Inténtalo más tarde.' };
  }
  if (error.status === 401) {
    return { fields: {} as FieldErrors, general: 'Tu sesión ha caducado. Vuelve a iniciar sesión' };
  }
  if (error.status !== 400) {
    return { fields: {} as FieldErrors, general: fallback };
  }

  const fields: FieldErrors = {};
  const general: string[] = [];
  for (const line of (error.message ?? '').split('\n').filter(Boolean)) {
    const field = FIELD_BY_MESSAGE[line];
    if (field && !fields[field]) fields[field] = line;
    else if (!field) general.push(line);
  }
  return { fields, general: general.join('\n') || undefined };
}
