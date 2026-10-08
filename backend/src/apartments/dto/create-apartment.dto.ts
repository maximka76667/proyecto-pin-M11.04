import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateApartmentDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsOptional()
  @IsUUID()
  landlord_id?: string | null;
}
