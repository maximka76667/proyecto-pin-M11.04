import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { ApartmentsController } from '../apartments/apartments.controller';
import { ApartmentsService } from '../apartments/apartments.service';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const VACIO = 'El nombre no puede estar vacío';
const LARGO = 'El nombre no puede superar los 50 caracteres';

// El usuario que devuelve @CurrentUser() en los tests (NODE_ENV=test)
const ALEX = '22222222-2222-2222-2222-222222222222';
const BEA = '3f0c9a4e-8b1d-4c2a-9e7f-5a6b7c8d9e0f';
const PISO = '6c5d4e3f-2a19-4876-9b0c-1d2e3f4a5b6c';

type Usuario = { id: string; full_name: string };

// PA-1016.02 y PA-1016.03: cambiar el nombre y validarlo.
// El prisma de este archivo guarda a los usuarios en memoria: lo que escribe update lo lee
// después el listado de miembros de la casa, igual que la base de datos real
describe('PA-1016.02 y PA-1016.03 · PATCH /users/me (nombre)', () => {
  let app: INestApplication<App>;
  let usuarios: Usuario[];

  const prisma = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    apartment: { findUnique: jest.fn() },
  };

  const mensajes = (body: { message: string | string[] }) =>
    Array.isArray(body.message) ? body.message : [body.message];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UsersController, ApartmentsController],
      providers: [
        UsersService,
        ApartmentsService,
        { provide: PrismaService, useValue: prisma },
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
    usuarios = [
      { id: ALEX, full_name: 'Alex Morgan' },
      { id: BEA, full_name: 'Bea Ruiz' },
    ];

    prisma.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const usuario = usuarios.find((u) => u.id === where.id);
      return Promise.resolve(
        usuario && {
          ...usuario,
          email: 'alex@ejemplo.com',
          avatar_url: null,
          password_hash: '$2b$12$hash',
          user_apartments: [
            {
              apartment: {
                id: PISO,
                name: 'Maple House',
                invite_code: 'codigo',
                _count: { user_apartments: usuarios.length },
              },
            },
          ],
        },
      );
    });
    prisma.user.update.mockImplementation(
      ({ where, data }: { where: { id: string }; data: Partial<Usuario> }) => {
        const usuario = usuarios.find((u) => u.id === where.id);
        if (usuario) Object.assign(usuario, data);
        return Promise.resolve(usuario);
      },
    );
    prisma.user.findMany.mockImplementation(() =>
      Promise.resolve(
        [...usuarios]
          .sort((a, b) => a.full_name.localeCompare(b.full_name))
          .map(({ id, full_name }) => ({ id, full_name })),
      ),
    );
    prisma.apartment.findUnique.mockResolvedValue({ id: PISO });
  });

  describe('PA-1016.02 · modificación exitosa del nombre', () => {
    it('guarda «Sara Morgan» para el usuario de la sesión y devuelve el perfil con el nombre nuevo', async () => {
      const response = await request(app.getHttpServer())
        .patch('/users/me')
        .send({ full_name: 'Sara Morgan' })
        .expect(200);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: ALEX },
        data: { full_name: 'Sara Morgan' },
      });
      expect(response.body.full_name).toBe('Sara Morgan');
    });

    it('elimina los espacios del principio y del final antes de guardar', async () => {
      const response = await request(app.getHttpServer())
        .patch('/users/me')
        .send({ full_name: '   Sara Morgan  ' })
        .expect(200);

      expect(prisma.user.update.mock.calls[0][0].data.full_name).toBe('Sara Morgan');
      expect(response.body.full_name).toBe('Sara Morgan');
    });

    it('conserva los espacios de dentro del nombre', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .send({ full_name: ' Sara  Morgan ' })
        .expect(200);

      expect(prisma.user.update.mock.calls[0][0].data.full_name).toBe('Sara  Morgan');
    });

    it('al volver a pedir el perfil sigue saliendo «Sara Morgan»', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .send({ full_name: 'Sara Morgan' })
        .expect(200);

      const response = await request(app.getHttpServer()).get('/users/me').expect(200);

      expect(response.body.full_name).toBe('Sara Morgan');
    });

    it('los compañeros ven «Sara Morgan» en la lista de miembros de la casa', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .send({ full_name: 'Sara Morgan' })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get(`/apartments/${PISO}/members`)
        .expect(200);

      const nombres = response.body.map((m: Usuario) => m.full_name);
      expect(nombres).toContain('Sara Morgan');
      expect(nombres).not.toContain('Alex Morgan');
    });

    it('solo cambia a quien tiene la sesión: los demás compañeros siguen igual', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .send({ full_name: 'Sara Morgan' })
        .expect(200);

      expect(usuarios.find((u) => u.id === BEA)?.full_name).toBe('Bea Ruiz');
    });

    it('no deja cambiar a otro usuario con un id en el cuerpo', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .send({ id: BEA, full_name: 'Sara Morgan' })
        .expect(400);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('no deja cambiar el email ni la contraseña por esta ruta', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .send({ full_name: 'Sara Morgan', email: 'otro@ejemplo.com', password_hash: 'x' })
        .expect(400);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('PA-1016.03 · nombre inválido', () => {
    it.each([
      ['vacío', '', VACIO],
      ['solo espacios', '   ', VACIO],
      ['solo tabuladores y saltos de línea', '\t \n ', VACIO],
      ['de 51 caracteres', 'a'.repeat(51), LARGO],
    ])('rechaza un nombre %s con 400 y un solo mensaje', async (_, nombre, mensaje) => {
      const response = await request(app.getHttpServer())
        .patch('/users/me')
        .send({ full_name: nombre })
        .expect(400);

      expect(mensajes(response.body)).toEqual([mensaje]);
    });

    it.each([
      ['vacío', ''],
      ['solo espacios', '   '],
      ['de 51 caracteres', 'a'.repeat(51)],
    ])('con un nombre %s no se escribe nada y el nombre sigue siendo «Alex Morgan»', async (_, nombre) => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .send({ full_name: nombre })
        .expect(400);

      expect(prisma.user.update).not.toHaveBeenCalled();

      const response = await request(app.getHttpServer()).get('/users/me').expect(200);
      expect(response.body.full_name).toBe('Alex Morgan');
    });

    it('un nombre que no es texto da 400', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .send({ full_name: 12345 })
        .expect(400);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('un nombre nulo da 400 en vez de borrar el nombre', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .send({ full_name: null })
        .expect(400);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('un nombre de exactamente 50 caracteres es válido', async () => {
      const nombre = 'a'.repeat(50);

      await request(app.getHttpServer())
        .patch('/users/me')
        .send({ full_name: nombre })
        .expect(200);

      expect(prisma.user.update.mock.calls[0][0].data.full_name).toBe(nombre);
    });

    // La PA dice que los espacios de los extremos se eliminan antes de guardar, así que la
    // longitud que cuenta es la del nombre ya recortado. Hoy @MaxLength de la DTO mide el
    // texto sin recortar y rechaza este nombre, que tiene 50 caracteres de verdad
    it('un nombre de 50 caracteres con espacios alrededor es válido: cuenta ya recortado', async () => {
      const nombre = 'a'.repeat(50);

      await request(app.getHttpServer())
        .patch('/users/me')
        .send({ full_name: `  ${nombre}  ` })
        .expect(200);

      expect(prisma.user.update.mock.calls[0][0].data.full_name).toBe(nombre);
    });

    it('un nombre de 51 caracteres con espacios alrededor sigue siendo demasiado largo', async () => {
      const response = await request(app.getHttpServer())
        .patch('/users/me')
        .send({ full_name: ` ${'a'.repeat(51)} ` })
        .expect(400);

      expect(mensajes(response.body)).toEqual([LARGO]);
    });
  });
});
