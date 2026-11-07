import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// GET /users/me: datos de la pantalla "Mi cuenta" (UT1015)
describe('GET /users/me', () => {
  let app: INestApplication<App>;

  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  // El usuario que devuelve @CurrentUser() en los tests (NODE_ENV=test)
  const usuarioActual = '22222222-2222-2222-2222-222222222222';
  const piso = '6c5d4e3f-2a19-4876-9b0c-1d2e3f4a5b6c';

  const usuario = (overrides: object = {}) => ({
    id: usuarioActual,
    email: 'alex@ejemplo.com',
    full_name: 'Alex Morgan',
    password_hash: '$2b$12$hashquenuncadebesalir',
    user_apartments: [
      { apartment: { id: piso, name: 'MapleHouse', _count: { user_apartments: 4 } } },
    ],
    ...overrides,
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
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

  it('devuelve el perfil con el hogar y el número de convivientes', async () => {
    prisma.user.findUnique.mockResolvedValue(usuario());

    const response = await request(app.getHttpServer()).get('/users/me').expect(200);

    expect(response.body).toEqual({
      id: usuarioActual,
      email: 'alex@ejemplo.com',
      full_name: 'Alex Morgan',
      has_password: true,
      apartments: [{ id: piso, name: 'MapleHouse', invite_code: undefined, members_count: 4 }],
    });
  });

  it('nunca devuelve el hash de la contraseña', async () => {
    prisma.user.findUnique.mockResolvedValue(usuario());

    const response = await request(app.getHttpServer()).get('/users/me').expect(200);

    expect(JSON.stringify(response.body)).not.toContain('hash');
  });

  it('busca al usuario de la sesión, no a uno que venga en la petición', async () => {
    prisma.user.findUnique.mockResolvedValue(usuario());

    await request(app.getHttpServer()).get('/users/me').expect(200);

    expect(prisma.user.findUnique.mock.calls[0][0].where).toEqual({ id: usuarioActual });
  });

  it('una cuenta de Google (sin contraseña) tiene has_password a false', async () => {
    prisma.user.findUnique.mockResolvedValue(usuario({ password_hash: null }));

    const response = await request(app.getHttpServer()).get('/users/me').expect(200);

    expect(response.body.has_password).toBe(false);
  });

  it('sin hogar devuelve la lista vacía', async () => {
    prisma.user.findUnique.mockResolvedValue(usuario({ user_apartments: [] }));

    const response = await request(app.getHttpServer()).get('/users/me').expect(200);

    expect(response.body.apartments).toEqual([]);
  });

  it('devuelve 401 si el usuario de la sesión ya no existe', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await request(app.getHttpServer()).get('/users/me').expect(401);
  });

  describe('PATCH /users/me (UT1016)', () => {
    it('actualiza el nombre del usuario y devuelve el perfil actualizado', async () => {
      prisma.user.update.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(
        usuario({ full_name: 'Alex Morgan Updated' }),
      );

      const response = await request(app.getHttpServer())
        .patch('/users/me')
        .send({ full_name: '  Alex Morgan Updated  ' })
        .expect(200);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: usuarioActual },
          data: { full_name: 'Alex Morgan Updated' },
        }),
      );
      expect(response.body.full_name).toBe('Alex Morgan Updated');
    });

    it('rechaza un nombre vacío con 400', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .send({ full_name: '   ' })
        .expect(400);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
