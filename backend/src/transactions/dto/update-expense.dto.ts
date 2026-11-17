import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { TransactionCategory } from '@prisma/client';
import { CATEGORIAS_DE_GASTO } from '../categorias';
import { IsNotFutureDate } from './not-future-date.validator';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cambios de un gasto. Todo es opcional salvo `version`: la que el cliente cargó. Si otra
// persona ha editado el gasto entretanto, la versión ya no coincide y la petición da 409
export class UpdateExpenseDto {
  @IsInt()
  @Min(1)
  version: number;

  // Positivo, hasta 2 decimales y como mucho 10.000,00. El lookahead rechaza el cero
  @IsOptional()
  @Matches(/^(?!0+(\.0{1,2})?$)(?:(?:\d{1,4}(\.\d{1,2})?)|10000(\.0{1,2})?)$/, {
    message:
      'amount must be a positive number no greater than 10000.00 with up to 2 decimals (e.g. "12.50")',
  })
  amount?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  concept?: string;

  @IsOptional()
  @IsEnum(TransactionCategory)
  // payment y pending quedan fuera: solo los gestiona el flujo de saldar deudas
  @IsIn(CATEGORIAS_DE_GASTO)
  category?: TransactionCategory;

  @IsOptional()
  @IsDateString()
  @IsNotFutureDate()
  date?: string;

  // Quién comparte ahora el gasto (puede incluir al que paga). Si no se envía, se mantienen
  // las personas actuales y solo se recalcula el reparto
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @Matches(UUID_REGEX, {
    each: true,
    message: 'participant_ids must contain valid UUIDs',
  })
  participant_ids?: string[];
}
