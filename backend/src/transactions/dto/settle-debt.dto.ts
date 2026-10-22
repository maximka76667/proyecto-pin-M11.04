import { IsNotEmpty, IsNumberString, IsString } from 'class-validator';

export class SettleDebtDto {
  // Quien llama es el deudor, así que se indica a quién le ha pagado.
  // Sin @IsUUID: los ids de prueba (22222222-...) no son UUID RFC válidos; el servicio
  // solo acepta un acreedor con el que exista una deuda pendiente.
  @IsString()
  @IsNotEmpty()
  acreedor_id: string;

  // Importe que vio el deudor; si ya no coincide con la deuda actual se rechaza
  @IsNumberString()
  amount: string;
}
