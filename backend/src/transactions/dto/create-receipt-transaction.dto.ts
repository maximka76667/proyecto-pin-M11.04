import {
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsIn,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TransactionCategory } from '@prisma/client';
import { CATEGORIAS_DE_GASTO } from '../categorias';
import { IsNotFutureDate } from './not-future-date.validator';

// Límites elegidos para que ninguna combinación pueda desbordar: el peor total posible es
// 99.999,99 € x 999 x 100 productos = 9.989.999.001 €, que cabe en la columna
// Decimal(12, 2) (máx. 9.999.999.999,99) y en céntimos sigue siendo un entero seguro de JS.
// Así basta con el ValidationPipe y no hace falta ninguna consulta a Prisma para rechazarlo.
export const MAX_PRECIO_UNIDAD = '99999.99';
export const MAX_CANTIDAD = 999;
export const MAX_PRODUCTOS = 100;

export class ReceiptItemDto {
  // Positivo, hasta 2 decimales y como mucho 5 cifras enteras (MAX_PRECIO_UNIDAD).
  // El lookahead rechaza el cero ("0", "0.0", "00.00")
  @Matches(/^(?!0+(\.0{1,2})?$)\d{1,5}(\.\d{1,2})?$/, {
    message: `unit_price must be a positive number with up to 2 decimals and at most ${MAX_PRECIO_UNIDAD}`,
  })
  unit_price: string;

  @IsInt()
  @Min(1)
  @Max(MAX_CANTIDAD)
  quantity: number;

  @Matches(/.*\S.*/)
  name: string;
}

export class CreateReceiptTransactionDto {
  @Matches(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    { message: 'apartment_id must be a UUID-like identifier' },
  )
  apartment_id: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @Matches(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    { each: true, message: 'each value in participant_ids must be a UUID-like identifier' },
  )
  participant_ids: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PRODUCTOS)
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemDto)
  items: ReceiptItemDto[];

  @IsIn(CATEGORIAS_DE_GASTO)
  category: TransactionCategory;

  @IsOptional()
  @IsDateString()
  @IsNotFutureDate()
  date?: string;
}
