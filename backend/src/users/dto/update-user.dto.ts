import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IsRequiredText } from '../../common/validators/required-text.validator';

export const NOMBRE_VACIO = 'El nombre no puede estar vacío';
export const NOMBRE_LARGO = 'El nombre no puede superar los 50 caracteres';

// Se valida el nombre ya recortado (PA-1016.02 y .03): los espacios de los extremos no
// cuentan para los 50 caracteres, un nombre de solo espacios cuenta como vacío y null
// también (sin esto, null llegaba al servicio y daba 500)
const recortarNombre = ({ value }: { value: unknown }) => {
  if (typeof value === 'string') return value.trim();
  if (value === null) return '';
  return value;
};

export class UpdateUserDto {
  @IsOptional()
  @Transform(recortarNombre)
  @IsRequiredText({ message: NOMBRE_VACIO })
  @MaxLength(50, { message: NOMBRE_LARGO })
  full_name?: string;
}
