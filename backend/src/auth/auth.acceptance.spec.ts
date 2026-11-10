import { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcrypt';
import { configureApp } from '../app.setup';
import { PasswordService } from './password/password.service';
import { PasswordController } from './password/password.controller';
import { PasswordThrottlerGuard } from './password/password-throttler.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { ChangePasswordDto } from './password/dto/change-password.dto';

describe('Pruebas de aceptación de autenticación y contraseñas', () => {
  const usuarioId = '22222222-2222-2222-2222-222222222222';
  const usuario = {
    id: usuarioId,
    email: 'alex@ejemplo.com',
    full_name: 'Alex Morgan',
    password_hash: '',
  };
  const sesiones = new Map<string, { user_id: string; expires_at: Date }>();

  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    authSession: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
    },
    passwordResetCode: {
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const config = {
    getOrThrow: jest.fn(() => 'clave-jwt-de-pruebas'),
    get: jest.fn(),
  };
  const mail = { sendPasswordChangedNotice: jest.fn() };

  let auth: AuthService;
  let passwords: PasswordService;
  let app: INestApplication;

  beforeAll(async () => {
    usuario.password_hash = await bcrypt.hash('Clave1234', 4);
    prisma.user.findUnique.mockImplementation(
      ({ where }: { where: { id?: string; email?: string } }) =>
        where.id === usuarioId || where.email === usuario.email ? { ...usuario } : null,
    );
    prisma.user.update.mockImplementation(({ data }: { data: { password_hash: string } }) => {
      usuario.password_hash = data.password_hash;
      return { ...usuario };
    });
    prisma.authSession.create.mockImplementation(
      ({ data }: { data: { token_hash: string; user_id: string; expires_at: Date } }) => {
        sesiones.set(data.token_hash, { user_id: data.user_id, expires_at: data.expires_at });
        return data;
      },
    );
    prisma.authSession.findUnique.mockImplementation(
      ({ where }: { where: { token_hash: string } }) => sesiones.get(where.token_hash) ?? null,
    );
    prisma.authSession.deleteMany.mockImplementation(
      ({ where }: { where: { user_id?: string; token_hash?: string } }) => {
        for (const [hash, session] of sesiones) {
          if (
            (where.user_id && session.user_id === where.user_id) ||
            (where.token_hash && hash === where.token_hash)
          ) {
            sesiones.delete(hash);
          }
        }
        return { count: 1 };
      },
    );
    prisma.$transaction.mockImplementation((operations: Promise<unknown>[]) => Promise.all(operations));

    const module = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'account', ttl: 900000, limit: 100 }],
        }),
      ],
      controllers: [AuthController, PasswordController],
      providers: [
        AuthService,
        PasswordService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: MailService, useValue: mail },
        PasswordThrottlerGuard,
      ],
    }).compile();

    auth = module.get(AuthService);
    passwords = module.get(PasswordService);
    const nestApp = module.createNestApplication();
    configureApp(nestApp);
    await nestApp.init();
    app = nestApp;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('PA-1015.01 cambia la contraseña, conserva la sesión y guarda únicamente un hash bcrypt', async () => {
    const response = await passwords.changePassword(usuarioId, {
      current_password: 'Clave1234',
      new_password: 'NuevaClave123',
      confirm_password: 'NuevaClave123',
    });

    expect(response.message).toBe('Contraseña actualizada correctamente');
    expect(response.token).toEqual(expect.any(String));
    expect(await bcrypt.compare('NuevaClave123', usuario.password_hash)).toBe(true);
    expect(usuario.password_hash).not.toBe('NuevaClave123');
    expect(await auth.userIdForToken(response.token)).toBe(usuarioId);
    await expect(auth.login({ email: usuario.email, password: 'Clave1234' })).rejects.toThrow();
    await expect(auth.login({ email: usuario.email, password: 'NuevaClave123' })).resolves.toEqual(
      expect.objectContaining({ token: expect.any(String) }),
    );
  });

  it('PA-1015.02 invalida las sesiones del otro dispositivo y entrega un token nuevo al dispositivo actual', async () => {
    const tokenDispositivoB = (await auth.withToken(usuario)).token;
    const response = await passwords.changePassword(usuarioId, {
      current_password: 'NuevaClave123',
      new_password: 'Clave1234',
      confirm_password: 'Clave1234',
    });

    expect(await auth.userIdForToken(tokenDispositivoB)).toBeNull();
    expect(await auth.userIdForToken(response.token)).toBe(usuarioId);
    expect(response.token).not.toBe(tokenDispositivoB);
  });

  it('PA-1015.03 responde 400 con contraseña actual incorrecta y no modifica la sesión ni la contraseña', async () => {
    const passwordAntes = usuario.password_hash;
    await expect(
      passwords.changePassword(usuarioId, {
        current_password: 'Clave9999',
        new_password: 'NuevaClave123',
        confirm_password: 'NuevaClave123',
      }),
    ).rejects.toMatchObject({
      response: { statusCode: 400, message: 'La contraseña actual es incorrecta' },
    });

    expect(usuario.password_hash).toBe(passwordAntes);
  });

  it.each([
    ['', '', '', 'Este campo es obligatorio'],
    ['abc12', 'abc12', 'abc12', 'La contraseña debe tener al menos 8 caracteres, una letra y un número'],
    ['abcdefgh', 'abcdefgh', 'abcdefgh', 'La contraseña debe tener al menos 8 caracteres, una letra y un número'],
    ['12345678', '12345678', '12345678', 'La contraseña debe tener al menos 8 caracteres, una letra y un número'],
    ['NuevaClave123', 'NuevaClave123', 'NuevaClave124', 'Las contraseñas nuevas no coinciden'],
    ['Clave1234', 'Clave1234', 'Clave1234', 'La nueva contraseña debe ser distinta de la actual'],
  ])(
    'PA-1015.04 rechaza nueva contraseña inválida (%s, %s, %s) con 400 y sin cambiarla',
    async (current, next, confirm, mensaje) => {
      const passwordAntes = usuario.password_hash;
      const validationPipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      });
      await expect(
        validationPipe.transform(
          {
            current_password: current || 'Clave1234',
            new_password: next,
            confirm_password: confirm,
          },
          { type: 'body', metatype: ChangePasswordDto, data: '' },
        ),
      ).rejects.toMatchObject({
        response: { statusCode: 400, message: expect.arrayContaining([mensaje]) },
      });
      expect(usuario.password_hash).toBe(passwordAntes);
    },
  );

  it('PA-1015.05 revoca el token al cerrar sesión y no permite reutilizarlo', async () => {
    const token = (await auth.withToken(usuario)).token;

    await auth.logout(token);

    expect(await auth.userIdForToken(token)).toBeNull();
    expect(prisma.authSession.deleteMany).toHaveBeenCalled();
  });

  it('PA-1015.06 permite cerrar sesión aunque el token ya haya caducado', async () => {
    await expect(auth.logout('token-caducado-o-no-disponible')).resolves.toEqual({ success: true });
    expect(prisma.authSession.deleteMany).toHaveBeenCalled();
  });
});
