import {
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { AuthMiddleware } from '../auth/auth.middleware';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const ALEX = '22222222-2222-2222-2222-222222222222';
const OTRO_USUARIO = '99999999-9999-9999-9999-999999999999';
const PISO = '6c5d4e3f-2a19-4876-9b0c-1d2e3f4a5b6c';
const TOKEN_DE_ALEX = 'token-de-alex';

const prisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
};

// Solo reconoce el token de Alex; cualquier otro es un token no válido, como pasa con uno
// caducado, manipulado o revocado
const auth = {
  userIdForToken: jest.fn((token: string) =>
    Promise.resolve(token === TOKEN_DE_ALEX ? ALEX : null),
  ),
};

// El mismo middleware que usa AppModule: así se prueba el token de verdad y no el
// usuario de desarrollo que CurrentUser usa cuando no llega ninguno
@Module({
  controllers: [UsersController],
  providers: [
    UsersService,
    AuthMiddleware,
    { provide: PrismaService, useValue: prisma },
    { provide: AuthService, useValue: auth },
  ],
})
class ModuloDePrueba implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}

// PA-1016.01: Visualización del perfil de usuario
describe('PA-1016.01 · GET /users/me con sesión (JWT)', () => {
  let app: INestApplication<App>;

  const alex = (overrides: object = {}) => ({
    id: ALEX,
    email: 'alex@ejemplo.com',
    full_name: 'Alex Morgan',
    avatar_url: null,
    password_hash: '$2b$12$hashquenuncadebesalir',
    google_subject: 'google-123',
    user_apartments: [
      {
        // Alex entró en septiembre de 2025
        joined_at: new Date('2025-09-15T10:00:00.000Z'),
        apartment: {
          id: PISO,
          name: 'Maple House',
          invite_code: '7a1b2c3d-0000-4000-8000-000000000001',
          _count: { user_apartments: 4 },
        },
      },
    ],
    ...overrides,
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [ModuloDePrueba] }).compile();

    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue(alex());
  });

  const conSesion = () => request(app.getHttpServer());

  it('devuelve el nombre, el hogar y cuántos compañeros tiene', async () => {
    const response = await conSesion()
      .get('/users/me')
      .set('Authorization', `Bearer ${TOKEN_DE_ALEX}`)
      .expect(200);

    expect(response.body.full_name).toBe('Alex Morgan');
    expect(response.body.apartments).toEqual([
      expect.objectContaining({ id: PISO, name: 'Maple House', members_count: 4 }),
    ]);
  });

  it('busca al usuario del token, no a uno que venga en la petición', async () => {
    await conSesion()
      .get('/users/me')
      .query({ id: OTRO_USUARIO, userId: OTRO_USUARIO })
      .set('Authorization', `Bearer ${TOKEN_DE_ALEX}`)
      .expect(200);

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.user.findUnique.mock.calls[0][0].where).toEqual({ id: ALEX });
  });

  it('con un token no válido responde 401 y no consulta la base de datos', async () => {
    await conSesion()
      .get('/users/me')
      .set('Authorization', 'Bearer un-token-falso')
      .expect(401);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('un token no válido da 401 aunque la petición traiga el id de otro usuario', async () => {
    await conSesion()
      .get('/users/me')
      .query({ id: ALEX })
      .set('Authorization', 'Bearer un-token-falso')
      .expect(401);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('no devuelve datos sensibles: ni el hash de la contraseña ni el id de Google', async () => {
    const response = await conSesion()
      .get('/users/me')
      .set('Authorization', `Bearer ${TOKEN_DE_ALEX}`)
      .expect(200);

    const texto = JSON.stringify(response.body);
    expect(texto).not.toContain('password_hash');
    expect(texto).not.toContain('hashquenuncadebesalir');
    expect(texto).not.toContain('google_subject');
    expect(texto).not.toContain('google-123');
    expect(response.body.has_password).toBe(true);
  });

  it('members_count sale del recuento de la base de datos, no de un número fijo', async () => {
    prisma.user.findUnique.mockResolvedValue(
      alex({
        user_apartments: [
          {
            joined_at: new Date('2025-09-15T10:00:00.000Z'),
            apartment: { id: PISO, name: 'Maple House', _count: { user_apartments: 1 } },
          },
        ],
      }),
    );

    const response = await conSesion()
      .get('/users/me')
      .set('Authorization', `Bearer ${TOKEN_DE_ALEX}`)
      .expect(200);

    expect(response.body.apartments[0].members_count).toBe(1);
  });

  // La pantalla escribe «desde sep 2025» a mano (profile.tsx). Para que salga de los datos,
  // el backend tiene que guardar y devolver cuándo entró el usuario en la casa
  describe('«desde sep 2025» sale de los datos (columna joined_at en UserApartment)', () => {
    it('pide joined_at de la pertenencia a la casa', async () => {
      await conSesion()
        .get('/users/me')
        .set('Authorization', `Bearer ${TOKEN_DE_ALEX}`)
        .expect(200);

      const { select } = prisma.user.findUnique.mock.calls[0][0];
      expect(select.user_apartments.select.joined_at).toBe(true);
    });

    it('devuelve la fecha de alta de la casa de Alex: septiembre de 2025', async () => {
      const response = await conSesion()
        .get('/users/me')
        .set('Authorization', `Bearer ${TOKEN_DE_ALEX}`)
        .expect(200);

      const [casa] = response.body.apartments;
      expect(casa).toHaveProperty('joined_at');
      expect(new Date(casa.joined_at).toISOString()).toBe('2025-09-15T10:00:00.000Z');
    });

    it('cada usuario recibe su propia fecha, no una fija', async () => {
      prisma.user.findUnique.mockResolvedValue(
        alex({
          user_apartments: [
            {
              joined_at: new Date('2026-03-02T09:00:00.000Z'),
              apartment: { id: PISO, name: 'Maple House', _count: { user_apartments: 4 } },
            },
          ],
        }),
      );

      const response = await conSesion()
        .get('/users/me')
        .set('Authorization', `Bearer ${TOKEN_DE_ALEX}`)
        .expect(200);

      const [casa] = response.body.apartments;
      expect(casa).toHaveProperty('joined_at');
      expect(new Date(casa.joined_at).toISOString()).toBe('2026-03-02T09:00:00.000Z');
    });
  });
});
