import { limitTransactionAmountInput } from './transaction-amount';

describe('limitTransactionAmountInput', () => {
  it('deja pasar un importe válido', () => {
    expect(limitTransactionAmountInput('12.50')).toBe('12.50');
    expect(limitTransactionAmountInput('12,5')).toBe('12,5');
  });

  it('elimina letras y símbolos', () => {
    expect(limitTransactionAmountInput('1a2€')).toBe('12');
  });

  it('limita la parte entera a 6 cifras', () => {
    expect(limitTransactionAmountInput('1234567')).toBe('123456');
    expect(limitTransactionAmountInput('1234567.5')).toBe('123456.5');
  });

  it('limita los decimales a 2 y conserva solo el primer separador', () => {
    expect(limitTransactionAmountInput('1.234')).toBe('1.23');
    expect(limitTransactionAmountInput('1.2.3')).toBe('1.23');
  });
});
