export function limitTransactionAmountInput(value: string): string {
  const sanitized = value.replace(/[^\d.,]/g, '');
  const separatorIndex = sanitized.search(/[.,]/);

  if (separatorIndex === -1) {
    return sanitized.slice(0, 6);
  }

  const integerPart = sanitized
    .slice(0, separatorIndex)
    .replace(/[.,]/g, '')
    .slice(0, 6);
  const decimalPart = sanitized
    .slice(separatorIndex + 1)
    .replace(/[.,]/g, '')
    .slice(0, 2);

  return `${integerPart}${sanitized[separatorIndex]}${decimalPart}`;
}
