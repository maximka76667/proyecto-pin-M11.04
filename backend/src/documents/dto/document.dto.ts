import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

// Permisiva: los ids de seed no son UUID estrictos
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
// Un campo de formulario vacío cuenta como «no enviado»
const vacioANada = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

// Los campos llegan en un formulario multipart (junto al archivo), por eso todo son textos
export class CreateDocumentDto {
  @Matches(UUID_PATTERN, { message: 'apartment_id must be a UUID-like identifier' })
  apartment_id: string;

  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre no puede estar vacío' })
  @MaxLength(80, { message: 'El nombre no puede superar los 80 caracteres' })
  name: string;

  @IsOptional()
  @Transform(vacioANada)
  @IsString()
  @MaxLength(2048)
  url?: string;
}

export class UpdateDocumentDto {
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre no puede estar vacío' })
  @MaxLength(80, { message: 'El nombre no puede superar los 80 caracteres' })
  name?: string;

  @IsOptional()
  @Transform(vacioANada)
  @IsString()
  @MaxLength(2048)
  url?: string;
}
