import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

const NUEVO_USUARIO = '33333333-3333-3333-3333-333333333333';
const ESTUDIANTE_EXISTENTE = '44444444-4444-4444-4444-444444444444';

type Usuario = {
  id: string;
  email: string;
  full_name: string;
  is_landlord: boolean;
  password_hash: string | null;
};

// Base de datos en memoria: solo la tabla de usuarios y la de sesiones
let usuarios: Usuario[] = [];

const prisma = {
  user: {
    findUnique: jest.fn(({ where }: { where: { id?: string; email?: string } }) =>
      Promise.resolve(
        usuarios.find((u) => u.id === where.id || u.email === where.email) ?? null,
      ),
    ),
    create: jest.fn(({ data }: { data: Omit<Usuario, 'id'> }) => {
      const usuario = { id: NUEVO_USUARIO, ...data };
      usuarios.push(usuario);
      return Promise.resolve({ id: usuario.id, email: usuario.email, full_name: usuario.full_name });
    }),
  },
  authSession: { create: jest.fn((args: { data: object }) => Promise.resolve(args.data)) },
};

const config = {
  getOrThrow: jest.fn(() => 'clave-jwt-de-pruebas'),
  get: jest.fn(),
};

// La PA-1014.06 pide mandar un correo al registrarse; aquí solo se comprueba que no se rompe
const mail = { sendEmailVerification: jest.fn(() => Promise.resolve(true)) };

describe('UT1014 · Registro (POST /auth/register)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: MailService, useValue: mail },
      ],
    }).compile();

    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    usuarios = [
      {
        id: ESTUDIANTE_EXISTENTE,
        email: 'estudiante@upv.es',
        full_name: 'Estudiante Existente',
        is_landlord: false,
        password_hash: await bcrypt.hash('Clave1234', 4),
      },
    ];
  });

  const registrar = (body: object) => request(app.getHttpServer()).post('/auth/register').send(body);

  // PA-1014.01: Registro de un nuevo usuario exitoso
  describe('PA-1014.01 · registro de un usuario nuevo', () => {
    const nuevo = { full_name: 'Alex Morgan', email: 'alex@ejemplo.com', password: 'Clave1234' };

    it('responde 201 (Created) y guarda el usuario en la base de datos', async () => {
      await registrar(nuevo).expect(201);

      expect(usuarios.find((u) => u.email === 'alex@ejemplo.com')).toEqual(
        expect.objectContaining({ id: NUEVO_USUARIO, full_name: 'Alex Morgan' }),
      );
    });

    it('guarda la contraseña como hash bcrypt y nunca en texto plano', async () => {
      await registrar(nuevo).expect(201);

      const guardado = usuarios.find((u) => u.email === 'alex@ejemplo.com')!;
      expect(guardado.password_hash).not.toBe('Clave1234');
      expect(guardado.password_hash).toMatch(/^\$2[aby]\$/);
      expect(await bcrypt.compare('Clave1234', guardado.password_hash!)).toBe(true);
    });

    it('guarda el email en minúsculas, el nombre recortado y sin rol de casero', async () => {
      await registrar({ ...nuevo, email: 'Alex@Ejemplo.COM', full_name: '  Alex Morgan  ' }).expect(201);

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'alex@ejemplo.com', full_name: 'Alex Morgan', is_landlord: false }),
        }),
      );
    });

    // Manda la PA-1014.06: la cuenta se crea sin verificar y no se entra en la app hasta
    // confirmar el email, así que el registro no puede devolver ya una sesión válida
    it('no devuelve token ni abre sesión hasta que se confirme el email (PA-1014.06)', async () => {
      const response = await registrar(nuevo).expect(201);

      expect(response.body.token).toBeUndefined();
      expect(prisma.authSession.create).not.toHaveBeenCalled();
    });
  });

  // PA-1014.02: Intento de registro con un email ya existente
  describe('PA-1014.02 · registro con un email que ya existe', () => {
    const duplicado = { full_name: 'Otra Persona', email: 'estudiante@upv.es', password: 'OtraClave99' };

    it('rechaza la petición y no crea ningún usuario nuevo', async () => {
      const response = await registrar(duplicado);

      expect(response.status).toBe(409);
      expect(response.body.token).toBeUndefined();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(usuarios).toHaveLength(1);
    });

    it('detecta el duplicado aunque el email llegue con mayúsculas', async () => {
      await registrar({ ...duplicado, email: 'Estudiante@UPV.es' }).expect(409);

      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('responde con el mensaje «Este correo electrónico ya está en uso»', async () => {
      const response = await registrar(duplicado).expect(409);

      expect(response.body.message).toBe('Este correo electrónico ya está en uso');
    });

    // Dos registros a la vez con el mismo email pasan los dos la comprobación previa, y es
    // la restricción @unique de la base de datos la que para al segundo (error P2002)
    it('si Prisma detecta la colisión al guardar, responde 409 con el mismo mensaje y no 500', async () => {
      prisma.user.create.mockImplementationOnce(() =>
        Promise.reject(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`email`)', {
            code: 'P2002',
            clientVersion: '5.22.0',
            meta: { target: ['email'] },
          }),
        ),
      );

      const response = await registrar({ ...duplicado, email: 'carrera@upv.es' });

      expect(response.status).toBe(409);
      expect(response.body.message).toBe('Este correo electrónico ya está en uso');
    });

    it('el esquema de Prisma marca el email del usuario como @unique', () => {
      const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
      const modeloUser = schema.match(/model User \{[\s\S]*?\n\}/)?.[0] ?? '';

      expect(modeloUser).toMatch(/^\s*email\s+String\??\s+.*@unique/m);
    });
  });
});
