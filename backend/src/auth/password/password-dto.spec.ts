import { plainToInstance } from 'class-transformer';
import { validate, ValidatorOptions } from 'class-validator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PASSWORD_MESSAGES as M } from './password-policy';

// Misma configuración que el ValidationPipe global (app.setup.ts)
const options: ValidatorOptions = { whitelist: true, forbidNonWhitelisted: true };

// Devuelve { campo: [mensajes] } para comprobar el texto exacto que verá el usuario
async function messagesFor<T extends object>(dto: new () => T, body: object) {
  const errors = await validate(plainToInstance(dto, body), options);
  return Object.fromEntries(
    errors.map((error) => [error.property, Object.values(error.constraints ?? {})]),
  );
}

describe('ChangePasswordDto (PA-1015.04)', () => {
  const valid = {
    current_password: 'Clave1234',
    new_password: 'NuevaClave123',
    confirm_password: 'NuevaClave123',
  };

  it('acepta un cambio válido', async () => {
    expect(await messagesFor(ChangePasswordDto, valid)).toEqual({});
  });

  it('nueva contraseña vacía: solo "Este campo es obligatorio"', async () => {
    expect(
      await messagesFor(ChangePasswordDto, { ...valid, new_password: '', confirm_password: '' }),
    ).toEqual({ new_password: [M.required], confirm_password: [M.required] });
  });

  it('campos ausentes: "Este campo es obligatorio" en cada uno', async () => {
    expect(await messagesFor(ChangePasswordDto, {})).toEqual({
      current_password: [M.required],
      new_password: [M.required],
      confirm_password: [M.required],
    });
  });

  it('un campo que no es texto se trata como vacío', async () => {
    expect(
      await messagesFor(ChangePasswordDto, { ...valid, current_password: 12345678 }),
    ).toEqual({ current_password: [M.required] });
  });

  it.each(['abc12', 'abcdefgh', '12345678'])(
    'política incumplida con %p',
    async (password) => {
      expect(
        await messagesFor(ChangePasswordDto, {
          ...valid,
          new_password: password,
          confirm_password: password,
        }),
      ).toEqual({ new_password: [M.policy] });
    },
  );

  it('acepta letras con tilde o ñ como letra', async () => {
    expect(
      await messagesFor(ChangePasswordDto, {
        ...valid,
        new_password: 'ñandú2024',
        confirm_password: 'ñandú2024',
      }),
    ).toEqual({});
  });

  it('confirmación distinta: "Las contraseñas nuevas no coinciden"', async () => {
    expect(
      await messagesFor(ChangePasswordDto, { ...valid, confirm_password: 'NuevaClave124' }),
    ).toEqual({ confirm_password: [M.mismatch] });
  });

  it('nueva igual a la actual: "La nueva contraseña debe ser distinta de la actual"', async () => {
    expect(
      await messagesFor(ChangePasswordDto, {
        ...valid,
        new_password: 'Clave1234',
        confirm_password: 'Clave1234',
      }),
    ).toEqual({ new_password: [M.sameAsCurrent] });
  });

  it('rechaza más de 72 bytes aunque sean menos de 72 caracteres', async () => {
    // 40 eñes = 40 caracteres pero 80 bytes en UTF-8
    const long = `${'ñ'.repeat(40)}1`;
    expect(
      await messagesFor(ChangePasswordDto, { ...valid, new_password: long, confirm_password: long }),
    ).toEqual({ new_password: [M.tooLong] });
  });

  it('acepta exactamente 72 bytes', async () => {
    const limit = `${'a'.repeat(71)}1`;
    expect(
      await messagesFor(ChangePasswordDto, { ...valid, new_password: limit, confirm_password: limit }),
    ).toEqual({});
  });

  it('rechaza campos de más, como un user_id para cambiar la contraseña de otro', async () => {
    const result = await messagesFor(ChangePasswordDto, {
      ...valid,
      user_id: '22222222-2222-2222-2222-222222222222',
    });
    expect(Object.keys(result)).toEqual(['user_id']);
  });
});

describe('ForgotPasswordDto', () => {
  it('normaliza el email', async () => {
    const dto = plainToInstance(ForgotPasswordDto, { email: '  Ana@Ejemplo.COM ' });
    expect(await validate(dto, options)).toEqual([]);
    expect(dto.email).toBe('ana@ejemplo.com');
  });

  it.each(['', 'no-es-un-email', undefined])('rechaza el email %p', async (email) => {
    expect(await messagesFor(ForgotPasswordDto, { email })).toEqual({
      email: expect.arrayContaining([M.invalidEmail]),
    });
  });
});

describe('ResetPasswordDto', () => {
  const valid = {
    email: 'ana@ejemplo.com',
    code: '123456',
    new_password: 'NuevaClave123',
    confirm_password: 'NuevaClave123',
  };

  it('acepta un restablecimiento válido', async () => {
    expect(await messagesFor(ResetPasswordDto, valid)).toEqual({});
  });

  it.each(['12345', '1234567', 'abcdef', '12 456'])('rechaza el código %p', async (code) => {
    expect(await messagesFor(ResetPasswordDto, { ...valid, code })).toEqual({
      code: [M.invalidCode],
    });
  });

  it('código vacío: solo "Este campo es obligatorio"', async () => {
    expect(await messagesFor(ResetPasswordDto, { ...valid, code: '' })).toEqual({
      code: [M.required],
    });
  });

  it('aplica la misma política y confirmación que el cambio de contraseña', async () => {
    expect(
      await messagesFor(ResetPasswordDto, {
        ...valid,
        new_password: 'abcdefgh',
        confirm_password: 'abcdefgx',
      }),
    ).toEqual({ new_password: [M.policy], confirm_password: [M.mismatch] });
  });
});
