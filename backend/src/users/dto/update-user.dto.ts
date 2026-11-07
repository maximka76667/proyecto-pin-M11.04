import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString({ message: 'El nombre debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El nombre no puede estar vacío' })
  @MaxLength(50, { message: 'El nombre no puede superar los 50 caracteres' })
  full_name?: string;

  @IsOptional()
  @IsString({ message: 'El enlace del avatar debe ser una cadena de texto' })
  avatar_url?: string;
}


