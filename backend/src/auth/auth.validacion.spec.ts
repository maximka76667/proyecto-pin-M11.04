import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

// Si la validación funciona, ninguna de estas peticiones llega a la base de datos
const prisma = {
  user: { findUnique: jest.fn(), create: jest.fn() },
  authSession: { create: jest.fn() },
};

const config = {
  getOrThrow: jest.fn(() => 'clave-jwt-de-pruebas'),
  get: jest.fn(),
};

// PA-1014.05: Validación de campos obligatorios y formato. La app debe frenarlo antes,
// pero si alguien llama a la API saltándose la app, NestJS tiene que responder 400
describe('PA-1014.05 · validación de campos en el backend', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: MailService, useValue: {} },
      ],
    }).compile();

    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const enviar = (ruta: string, body: object) => request(app.getHttpServer()).post(ruta).send(body);

  const esperarRechazo = async (ruta: string, body: object) => {
    const response = await enviar(ruta, body);

    expect(response.status).toBe(400);
    expect(response.body.token).toBeUndefined();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.authSession.create).not.toHaveBeenCalled();
  };

  const registroValido = { full_name: 'Alex Morgan', email: 'alex@ejemplo.com', password: 'Clave1234' };
  const loginValido = { email: 'alex@ejemplo.com', password: 'Clave1234' };

  describe('registro', () => {
    it.each<[string, object]>([
      ['contraseña vacía', { ...registroValido, password: '' }],
      ['sin contraseña', { full_name: 'Alex Morgan', email: 'alex@ejemplo.com' }],
      ['email vacío', { ...registroValido, email: '' }],
      ['sin email', { full_name: 'Alex Morgan', password: 'Clave1234' }],
      ['email sin «@»', { ...registroValido, email: 'estudiante.upv.es' }],
      ['email «estudiante@.com»', { ...registroValido, email: 'estudiante@.com' }],
      ['email sin dominio', { ...registroValido, email: 'estudiante@' }],
      ['nombre vacío', { ...registroValido, full_name: '' }],
      ['sin nombre', { email: 'alex@ejemplo.com', password: 'Clave1234' }],
      ['contraseña de menos de 8 caracteres', { ...registroValido, password: 'Clav123' }],
    ])('%s → 400 sin tocar la base de datos', async (_caso, body) => {
      await esperarRechazo('/auth/register', body);
    });

    // La PA-1014.06 fija la regla de la contraseña al registrarse: 8 caracteres o más,
    // con una letra y un número (la misma que el cambio de contraseña de la UT1015)
    it.each<[string, object]>([
      ['contraseña sin número', { ...registroValido, password: 'abcdefgh' }],
      ['contraseña sin letra', { ...registroValido, password: '12345678' }],
    ])('%s → 400 sin tocar la base de datos (regla de la PA-1014.06)', async (_caso, body) => {
      await esperarRechazo('/auth/register', body);
    });
  });

  describe('inicio de sesión', () => {
    it.each<[string, object]>([
      ['contraseña vacía', { ...loginValido, password: '' }],
      ['sin contraseña', { email: 'alex@ejemplo.com' }],
      ['email vacío', { ...loginValido, email: '' }],
      ['sin email', { password: 'Clave1234' }],
      ['email sin «@»', { ...loginValido, email: 'estudiante.upv.es' }],
      ['email «estudiante@.com»', { ...loginValido, email: 'estudiante@.com' }],
    ])('%s → 400 sin tocar la base de datos', async (_caso, body) => {
      await esperarRechazo('/auth/login', body);
    });
  });
});
