import { plainToInstance } from 'class-transformer';
import { validate, ValidatorOptions } from 'class-validator';
import { UpdateTransactionDto } from './update-transaction.dto';

// Misma validación que ejecuta el ValidationPipe global en PATCH /transactions/:id.
async function errorsFor(body: object) {
  const options: ValidatorOptions = {
    whitelist: true,
    forbidNonWhitelisted: true,
  };
  const errors = await validate(
    plainToInstance(UpdateTransactionDto, body),
    options,
  );
  return errors.map((error) => error.property);
}

describe('DTO de actualización de transacciones', () => {
  it('acepta un importe y una categoría válidos', async () => {
    expect(await errorsFor({ amount: '12.50', category: 'utilities' })).toEqual([]);
  });

  it('acepta un cuerpo vacío porque todos los campos son opcionales', async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  it.each(['12', '12.5', '12.50', '0.01', '999999.99'])(
    'acepta el importe %p',
    async (amount) => {
      expect(await errorsFor({ amount })).toEqual([]);
    },
  );

  it.each([
    ['no numérico', 'abc'],
    ['vacío', ''],
    ['negativo', '-5'],
    ['cero', '0'],
    ['cero con decimales', '0.00'],
    ['más de 2 decimales', '12.999'],
    ['coma como separador decimal', '12,50'],
    ['más de 6 dígitos enteros', '1000000'],
    ['demasiado grande para la base de datos', '12345678901'],
    ['notación científica', '1e3'],
    ['rodeado de espacios', ' 12 '],
  ])('rechaza un importe %s (%p)', async (_, amount) => {
    expect(await errorsFor({ amount })).toEqual(['amount']);
  });

  it('rechaza un importe enviado como número en lugar de texto', async () => {
    expect(await errorsFor({ amount: 12.5 })).toEqual(['amount']);
  });

  it('rechaza una categoría desconocida', async () => {
    expect(await errorsFor({ category: 'food' })).toEqual(['category']);
  });

  it.each(['apartment_id', 'from_user_id', 'to_user_id', 'to_user_ids'])(
    'rechaza el campo %s porque la persona no se puede cambiar al editar',
    async (field) => {
      expect(await errorsFor({ [field]: 'not-a-uuid' })).toEqual([field]);
    },
  );
});
