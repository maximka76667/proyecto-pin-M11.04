import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateTransactionDto } from './create-transaction.dto';

export class UpdateTransactionDto extends PartialType(
  OmitType(CreateTransactionDto, [
    'apartment_id',
    'from_user_id',
    'to_user_id',
    'to_user_ids',
  ] as const),
) {}