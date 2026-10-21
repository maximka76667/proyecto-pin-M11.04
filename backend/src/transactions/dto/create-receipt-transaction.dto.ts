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

export class ReceiptItemDto {
  @Matches(/^(?!0+(\.0{1,2})?$)\d{1,10}(\.\d{1,2})?$/)
  unit_price: string;

  @IsInt()
  @Min(1)
  @Max(100000)
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
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemDto)
  items: ReceiptItemDto[];

  @IsIn(CATEGORIAS_DE_GASTO)
  category: TransactionCategory;

  @IsOptional()
  @IsDateString()
  date?: string;
}
