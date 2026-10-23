
import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  IsUUID,
  IsIn,
  IsDateString,
  MaxLength,

} from 'class-validator';

import { TransactionCategory } from '@prisma/client';
import { CATEGORIAS_DE_GASTO } from '../categorias';

// Accepts RFC 4122 UUIDs and general PostgreSQL 32-hex UUIDs (e.g. seed data)
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CreateTransactionDto {
  @Matches(UUID_REGEX, {
    message: '$property must be a UUID',
  })
  apartment_id: string;

  @Matches(UUID_REGEX, {
    message: '$property must be a UUID',
  })
  from_user_id: string;

  // Single debtor (backward compatibility)
  @IsOptional()
  @Matches(UUID_REGEX, {
    message: '$property must be a UUID',
  })
  to_user_id?: string;

  // Multiple debtors (the expense will be split equally among them)
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @Matches(UUID_REGEX, {
    each: true,
    message: 'to_user_ids must contain valid UUIDs',
  })
  to_user_ids?: string[];

  // Positive, up to 2 decimals and capped at six integer digits.
  // The lookahead rejects zero ("0", "0.0", "00.00")
  @Matches(/^(?!0+(\.0{1,2})?$)\d{1,6}(\.\d{1,2})?$/, {
    message:
      'amount must be a positive number with up to 6 integer digits and 2 decimals (e.g. "12.50")',
  })
  amount: string;
  // What the expense was for (e.g. "Compra del súper"). Optional in the API so older
  // clients keep working, but the "new expense" form always sends it.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  concept?: string;

  @IsEnum(TransactionCategory)
  // payment y pending quedan fuera: solo los gestiona el flujo de saldar deudas
  @IsIn(CATEGORIAS_DE_GASTO)
  category: TransactionCategory;

  // Día en que ocurrió el gasto (YYYY-MM-DD). Si no se envía, la base de datos pone hoy.
  @IsOptional()
  @IsDateString()
  date?: string;
}
