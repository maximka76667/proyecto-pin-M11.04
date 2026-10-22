import { IsNotEmpty, IsNumberString, IsString } from 'class-validator';

export class SettleDebtDto {
  // Sin @IsUUID: los ids de prueba (11111111-...) no son UUID RFC válidos; settleDebt solo acepta deudores con deuda pendiente
  @IsString()
  @IsNotEmpty()
  deudor_id: string;

  // Importe que vio el acreedor; si ya no coincide con la deuda actual se rechaza
  @IsNumberString()
  amount: string;
}
