import { createHash } from 'node:crypto';
import {
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthController } from './auth.controller';
import { AuthMiddleware } from './auth.middleware';
import { AuthService } from './auth.service';

// Distinto del USER_ID de desarrollo: si /auth/me devuelve a esta persona, es por el token
const ESTUDIANTE = '55555555-5555-5555-5555-555555555555';
const USUARIO_GOOGLE = '66666666-6666-6666-6666-666666666666';
const JWT_SECRET = 'clave-jwt-de-pruebas';

type Usuario = {
  id: string;
  email: string;
  full_name: string;
  is_landlord: boolean;
  password_hash: string | null;
  google_subject: string | null;
  // Cuenta ya confirmada (PA-1014.06), para que el login no la frene por eso
  email_verified_at: Date | null;
};
type Sesion = { id: string; token_hash: string; user_id: string; expires_at: Date };

let usuarios: Usuario[] = [];
let sesiones: Sesion[] = [];

const prisma = {
  user: {
    findUnique: jest.fn(({ where }: { where: { id?: string; email?: string } }) => {
      const usuario = usuarios.find((u) => u.id === where.id || u.email === where.email);
      return Promise.resolve(usuario ? { ...usuario, user_apartments: [] } : null);
    }),
  },
  authSession: {
    create: jest.fn(({ data }: { data: Sesion }) => {
      sesiones.push(data);
      return Promise.resolve(data);
    }),
    findUnique: jest.fn(({ where }: { where: { token_hash: string } }) =>
      Promise.resolve(sesiones.find((s) => s.token_hash === where.token_hash) ?? null),
    ),
  },
};

const config = {
  getOrThrow: jest.fn(() => JWT_SECRET),
  get: jest.fn(),
};

// El mismo middleware que usa AppModule, para probar que las peticiones siguientes
// se autentican con el JWT en la cabecera Authorization
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthMiddleware,
    { provide: PrismaService, useValue: prisma },
    { provide: ConfigService, useValue: config },
    { provide: MailService, useValue: {} },
  ],
})
class ModuloDePrueba implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}

describe('UT1014 · Inicio de sesión (POST /auth/login)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [ModuloDePrueba] }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    sesiones = [];
    usuarios = [
      {
        id: ESTUDIANTE,
        email: 'estudiante@upv.es',
        full_name: 'Estudiante Registrado',
        is_landlord: false,
        password_hash: await bcrypt.hash('Clave1234', 4),
        google_subject: null,
        email_verified_at: new Date('2026-09-01T10:00:00.000Z'),
      },
      {
        id: USUARIO_GOOGLE,
        email: 'google@gmail.com',
        full_name: 'Cuenta de Google',
        is_landlord: false,
        password_hash: null,
        google_subject: 'google-123',
        email_verified_at: null,
      },
    ];
  });

  const login = (body: object) => request(app.getHttpServer()).post('/auth/login').send(body);

  // PA-1014.03: Inicio de sesión exitoso y gestión del Token JWT
  describe('PA-1014.03 · inicio de sesión correcto', () => {
    it('devuelve un token de acceso y los datos del usuario', async () => {
      const response = await login({ email: 'estudiante@upv.es', password: 'Clave1234' });

      expect(response.status).toBeLessThan(300);
      expect(response.body.token).toEqual(expect.any(String));
      expect(response.body.user).toEqual({
        id: ESTUDIANTE,
        email: 'estudiante@upv.es',
        full_name: 'Estudiante Registrado',
      });
      expect(response.body.user.password_hash).toBeUndefined();
    });

    it('busca al usuario por email sin distinguir mayúsculas', async () => {
      const response = await login({ email: 'Estudiante@UPV.es', password: 'Clave1234' });

      expect(response.body.token).toEqual(expect.any(String));
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'estudiante@upv.es' } });
    });

    it('firma el token como JWT HS256 con el id del usuario', async () => {
      const { body } = await login({ email: 'estudiante@upv.es', password: 'Clave1234' });

      const payload = jwt.verify(body.token, JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      expect(payload.sub).toBe(ESTUDIANTE);
      expect(payload.exp).toEqual(expect.any(Number));
    });

    it('registra la sesión guardando solo el hash del token, no el token', async () => {
      const { body } = await login({ email: 'estudiante@upv.es', password: 'Clave1234' });

      expect(sesiones).toHaveLength(1);
      expect(sesiones[0].user_id).toBe(ESTUDIANTE);
      expect(sesiones[0].token_hash).toBe(createHash('sha256').update(body.token).digest('hex'));
      expect(JSON.stringify(sesiones)).not.toContain(body.token);
    });

    it('las peticiones siguientes se autentican con «Authorization: Bearer <token>»', async () => {
      const { body } = await login({ email: 'estudiante@upv.es', password: 'Clave1234' });

      const me = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${body.token}`)
        .expect(200);

      expect(me.body).toEqual(expect.objectContaining({ id: ESTUDIANTE, email: 'estudiante@upv.es' }));
    });

    it('un token que no ha emitido el servidor no da acceso', async () => {
      const falso = jwt.sign({ sub: ESTUDIANTE }, 'otra-clave', { algorithm: 'HS256' });

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${falso}`)
        .expect(401);
    });
  });

  // PA-1014.04: Intento de inicio de sesión con credenciales inválidas
  describe('PA-1014.04 · credenciales inválidas', () => {
    const casos: [string, object][] = [
      ['contraseña incorrecta', { email: 'estudiante@upv.es', password: 'Clave9999' }],
      ['email que no existe', { email: 'nadie@upv.es', password: 'Clave1234' }],
      ['cuenta de Google sin contraseña', { email: 'google@gmail.com', password: 'Clave1234' }],
    ];

    it.each(casos)('%s: responde 401 sin token y sin abrir sesión', async (_caso, body) => {
      const response = await login(body);

      expect(response.status).toBe(401);
      expect(response.body.token).toBeUndefined();
      expect(prisma.authSession.create).not.toHaveBeenCalled();
      expect(sesiones).toHaveLength(0);
    });

    it('la respuesta es idéntica falle el email o la contraseña (sin enumeración de usuarios)', async () => {
      const respuestas = await Promise.all(casos.map(([, body]) => login(body)));
      const cuerpos = respuestas.map((r) => JSON.stringify({ status: r.status, body: r.body }));

      expect(new Set(cuerpos).size).toBe(1);
    });

    it.each(casos)('%s: muestra el mensaje genérico «Correo o contraseña incorrectos»', async (_caso, body) => {
      const response = await login(body);

      expect(response.body.message).toBe('Correo o contraseña incorrectos');
    });
  });
});
