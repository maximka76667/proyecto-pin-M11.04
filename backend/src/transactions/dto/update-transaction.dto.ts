import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateTransactionDto } from './create-transaction.dto';

export class UpdateTransactionDto extends PartialType(
  OmitType(CreateTransactionDto, ['to_user_ids'] as const),
) {}