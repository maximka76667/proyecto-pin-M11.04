import { IsDateString, IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { TransactionCategory } from '@prisma/client';
import { CATEGORIAS_DE_GASTO } from '../categorias';

export class CreateTransactionDto {
  @IsUUID()
  apartment_id: string;

  @IsUUID()
  from_user_id: string;

  @IsUUID()
  to_user_id: string;

  // Positive, up to 2 decimals and fits the Decimal(12, 2) column (max 10 integer digits).
  // The lookahead rejects zero ("0", "0.0", "00.00")
  @Matches(/^(?!0+(\.0{1,2})?$)\d{1,10}(\.\d{1,2})?$/, {
    message: 'amount must be a positive number with up to 2 decimals (e.g. "12.50")',
  })
  amount: string;

  // payment y pending quedan fuera: solo los gestiona el flujo de saldar deudas
  @IsIn(CATEGORIAS_DE_GASTO)
  category: TransactionCategory;

  // Día en que ocurrió el gasto (YYYY-MM-DD). Si no se envía, la base de datos pone hoy.
  @IsOptional()
  @IsDateString()
  date?: string;
}
