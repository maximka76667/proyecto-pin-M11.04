import {
  PASSWORD_MESSAGES,
  hasErrors,
  validateEmail,
  validateNewPassword,
  validatePasswordChange,
  validatePasswordReset,
} from './password-policy';

describe('validateNewPassword', () => {
  it('exige el campo', () => {
    expect(validateNewPassword('')).toBe(PASSWORD_MESSAGES.required);
  });

  it('exige 8 caracteres, una letra y un número', () => {
    expect(validateNewPassword('abc1')).toBe(PASSWORD_MESSAGES.policy);
    expect(validateNewPassword('abcdefgh')).toBe(PASSWORD_MESSAGES.policy);
    expect(validateNewPassword('12345678')).toBe(PASSWORD_MESSAGES.policy);
    expect(validateNewPassword('abcdefg1')).toBeUndefined();
  });

  it('rechaza más de 72 bytes', () => {
    expect(validateNewPassword(`a1${'a'.repeat(71)}`)).toBe(PASSWORD_MESSAGES.tooLong);
  });
});

describe('validatePasswordChange', () => {
  it('no da errores con datos correctos', () => {
    const errors = validatePasswordChange({
      current: 'vieja123',
      next: 'nueva1234',
      confirm: 'nueva1234',
    });
    expect(hasErrors(errors)).toBe(false);
  });

  it('rechaza una contraseña nueva igual a la actual', () => {
    const errors = validatePasswordChange({
      current: 'misma1234',
      next: 'misma1234',
      confirm: 'misma1234',
    });
    expect(errors.next).toBe(PASSWORD_MESSAGES.sameAsCurrent);
  });

  it('rechaza una confirmación distinta', () => {
    const errors = validatePasswordChange({
      current: 'vieja123',
      next: 'nueva1234',
      confirm: 'otra1234',
    });
    expect(errors.confirm).toBe(PASSWORD_MESSAGES.mismatch);
  });
});

describe('validatePasswordReset', () => {
  it('exige un código de 8 dígitos', () => {
    const errors = validatePasswordReset({ code: '123', next: 'nueva1234', confirm: 'nueva1234' });
    expect(errors.code).toBe(PASSWORD_MESSAGES.invalidCode);
  });

  it('acepta un código de 8 dígitos', () => {
    const errors = validatePasswordReset({
      code: '12345678',
      next: 'nueva1234',
      confirm: 'nueva1234',
    });
    expect(hasErrors(errors)).toBe(false);
  });
});

describe('validateEmail', () => {
  it('valida el formato', () => {
    expect(validateEmail('')).toBe(PASSWORD_MESSAGES.required);
    expect(validateEmail('sin-arroba')).toBe(PASSWORD_MESSAGES.invalidEmail);
    expect(validateEmail(' a@b.com ')).toBeUndefined();
  });
});
