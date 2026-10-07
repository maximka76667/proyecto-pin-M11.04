import { IsEnum, IsNumberString, IsUUID } from 'class-validator';
import { TransactionCategory } from '@prisma/client';

export class CreateTransactionDto {
  @IsUUID()
  apartment_id: string;

  @IsUUID()
  from_user_id: string;

  @IsUUID()
  to_user_id: string;

  @IsNumberString()
  amount: string;

  @IsEnum(TransactionCategory)
  category: TransactionCategory;
}