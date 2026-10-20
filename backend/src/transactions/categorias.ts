import { TransactionCategory } from '@prisma/client';

// Solo las crea y las cambia el flujo de saldar deudas, que es el que exige que el
// acreedor confirme. Si las rutas genéricas las aceptaran, la confirmación se podría saltar.
export const CATEGORIAS_DE_LIQUIDACION: TransactionCategory[] = [
  TransactionCategory.payment,
  TransactionCategory.pending,
];

export const CATEGORIAS_DE_GASTO: TransactionCategory[] = Object.values(
  TransactionCategory,
).filter((categoria) => !CATEGORIAS_DE_LIQUIDACION.includes(categoria));
