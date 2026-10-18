import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';

export class CreateApartmentDto {
  @IsString()
  @IsNotEmpty({ message: 'Nombre obligatorio' })
  @Length(3, 50, {
    message:
      'El nombre debe tener entre 3 y 50 caracteres y solo contener letras y números',
  })
  @Matches(/^[A-Za-z0-9]+$/, {
    message:
      'El nombre debe tener entre 3 y 50 caracteres y solo contener letras y números',
  })
  name: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsOptional()
  @IsUUID()
  landlord_id?: string | null;
}
