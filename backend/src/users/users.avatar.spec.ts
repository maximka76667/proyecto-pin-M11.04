import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { ApartmentsController } from '../apartments/apartments.controller';
import { ApartmentsService } from '../apartments/apartments.service';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const AVATARS = join(__dirname, '../../test/avatars');
const PNG = readFileSync(join(AVATARS, 'avatar.png'));
const NO_ES_IMAGEN = readFileSync(join(AVATARS, 'no-es-imagen.png'));

const MB = 1024 * 1024;
const MUY_GRANDE = 'La imagen no puede superar los 5 MB';

// El usuario que devuelve @CurrentUser() en los tests (NODE_ENV=test)
const ALEX = '22222222-2222-2222-2222-222222222222';
const BEA = '3f0c9a4e-8b1d-4c2a-9e7f-5a6b7c8d9e0f';
const PISO = '6c5d4e3f-2a19-4876-9b0c-1d2e3f4a5b6c';

// Dónde tiene que apuntar el enlace guardado: la API de Supabase Storage de un bucket público.
// La app lee la dirección de SUPABASE_URL; aquí se fija una de mentira y fetch se sustituye
// para que ninguna prueba salga a internet
const SUPABASE_URL = 'https://proyecto-de-prueba.supabase.co';
const ENLACE_DE_STORAGE = `${SUPABASE_URL}/storage/v1/object/public/`;
const FOTO_ANTERIOR = `${ENLACE_DE_STORAGE}avatars/alex-anterior.png`;

type Usuario = { id: string; full_name: string; avatar_url: string | null };

// Una imagen de n bytes que empieza como una PNG de verdad (lo que mira un validador por
// contenido) y se rellena hasta el tamaño pedido
function pngDeBytes(bytes: number) {
  return Buffer.concat([PNG, Buffer.alloc(Math.max(0, bytes - PNG.length))]);
}

// PA-1016.05 y PA-1016.06: foto de perfil.
// Igual que users.nombre.spec.ts, el prisma guarda a los usuarios en memoria y respeta el
// select: un campo que la consulta no pide no llega a la respuesta, como en la base real
describe('PA-1016.05 y PA-1016.06 · foto de perfil (POST /users/me/avatar)', () => {
  let app: INestApplication<App>;
  let usuarios: Usuario[];
  let fetchStorage: jest.SpiedFunction<typeof fetch>;
  const entorno = { ...process.env };

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

  const subir = (contenido: Buffer, filename = 'foto.png', contentType = 'image/png') =>
    request(app.getHttpServer())
      .post('/users/me/avatar')
      .attach('image', contenido, { filename, contentType });

  const avatarDe = (id: string) => usuarios.find((u) => u.id === id)?.avatar_url;

  beforeAll(async () => {
    process.env.SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-prueba';

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
    process.env = entorno;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    fetchStorage = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ Key: 'avatars/foto.png' }), { status: 200 }),
        ),
      );

    // Alex ya tiene una foto; Bea no
    usuarios = [
      { id: ALEX, full_name: 'Alex Morgan', avatar_url: FOTO_ANTERIOR },
      { id: BEA, full_name: 'Bea Ruiz', avatar_url: null },
    ];

    prisma.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const usuario = usuarios.find((u) => u.id === where.id);
      return Promise.resolve(
        usuario && {
          ...usuario,
          email: 'alex@ejemplo.com',
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
    prisma.user.findMany.mockImplementation(
      ({ select }: { select: Record<string, boolean> }) =>
        Promise.resolve(
          usuarios.map((usuario) =>
            Object.fromEntries(
              Object.entries(usuario).filter(([campo]) => select[campo]),
            ),
          ),
        ),
    );
    prisma.apartment.findUnique.mockResolvedValue({ id: PISO });
  });

  afterEach(() => {
    fetchStorage.mockRestore();
  });

  describe('PA-1016.05 · modificación exitosa de la foto', () => {
    it('acepta una imagen válida y devuelve el perfil', async () => {
      const response = await subir(PNG).expect(201);

      expect(response.body.full_name).toBe('Alex Morgan');
      expect(response.body.avatar_url).toEqual(expect.any(String));
    });

    it('la imagen se sube a Supabase Storage', async () => {
      await subir(PNG).expect(201);

      const urls = fetchStorage.mock.calls.map(([url]) =>
        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
      );
      expect(urls.some((url) => url.startsWith(`${SUPABASE_URL}/storage/v1/object/`))).toBe(true);
    });

    it('el perfil guarda el enlace a la foto en Storage, no la imagen', async () => {
      const response = await subir(PNG).expect(201);

      expect(response.body.avatar_url).toMatch(`${ENLACE_DE_STORAGE}`);
      expect(avatarDe(ALEX)).toMatch(`${ENLACE_DE_STORAGE}`);
    });

    it('no guarda la imagen entera dentro de la base de datos (data URI en base64)', async () => {
      await subir(pngDeBytes(1 * MB)).expect(201);

      const guardado = avatarDe(ALEX) ?? '';
      expect(guardado.startsWith('data:')).toBe(false);
      expect(guardado.length).toBeLessThan(500);
    });

    it('la foto nueva sustituye a la anterior', async () => {
      await subir(PNG).expect(201);

      expect(avatarDe(ALEX)).not.toBe(FOTO_ANTERIOR);
    });

    it('guarda la foto del usuario de la sesión y no toca a los demás', async () => {
      await subir(PNG).expect(201);

      expect(prisma.user.update.mock.calls[0][0].where).toEqual({ id: ALEX });
      expect(avatarDe(BEA)).toBeNull();
    });

    it('acepta una imagen de exactamente 5 MB', async () => {
      await subir(pngDeBytes(5 * MB)).expect(201);
    });

    it('los compañeros ven la foto junto a su nombre: la lista de miembros devuelve avatar_url', async () => {
      await subir(PNG).expect(201);

      const response = await request(app.getHttpServer())
        .get(`/apartments/${PISO}/members`)
        .expect(200);

      const alex = response.body.find((m: Usuario) => m.id === ALEX);
      expect(alex).toEqual(expect.objectContaining({ full_name: 'Alex Morgan' }));
      expect(alex.avatar_url).toBe(avatarDe(ALEX));
    });

    it('quitar la foto deja avatar_url a null y vuelve la inicial', async () => {
      const response = await request(app.getHttpServer())
        .delete('/users/me/avatar')
        .expect(200);

      expect(response.body.avatar_url).toBeNull();
      expect(avatarDe(ALEX)).toBeNull();
    });

    it('sin archivo responde 400', async () => {
      await request(app.getHttpServer()).post('/users/me/avatar').expect(400);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    // Fuera de las PA, pero toca la PA-1016.05: el perfil tiene que guardar el enlace que
    // genera el backend al subir. Si PATCH /users/me deja escribir avatar_url, cualquiera
    // puede poner en su foto (y en la de los compañeros que la ven) la dirección que quiera
    it('PATCH /users/me no deja fijar avatar_url a mano', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .send({ avatar_url: 'https://sitio-ajeno.example/tracking.png' })
        .expect(400);

      expect(avatarDe(ALEX)).toBe(FOTO_ANTERIOR);
    });
  });

  describe('PA-1016.06 · imagen no válida', () => {
    it(`una imagen de más de 5 MB da 400 con «${MUY_GRANDE}»`, async () => {
      const response = await subir(pngDeBytes(5 * MB + 1)).expect(400);

      expect(mensajes(response.body)).toEqual([MUY_GRANDE]);
    });

    it('una imagen de más de 5 MB no se sube a Storage ni se guarda', async () => {
      await subir(pngDeBytes(5 * MB + 1)).expect(400);

      expect(fetchStorage).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('con la imagen demasiado grande se mantiene la foto anterior', async () => {
      await subir(pngDeBytes(6 * MB)).expect(400);

      const response = await request(app.getHttpServer()).get('/users/me').expect(200);
      expect(response.body.avatar_url).toBe(FOTO_ANTERIOR);
    });

    it.each([
      ['un archivo de texto (text/plain)', NO_ES_IMAGEN, 'nota.txt', 'text/plain'],
      ['un PDF (application/pdf)', Buffer.from('%PDF-1.4 falso'), 'cv.pdf', 'application/pdf'],
      [
        'un ejecutable (application/octet-stream)',
        Buffer.from('MZ-no-soy-una-foto'),
        'virus.exe',
        'application/octet-stream',
      ],
    ])('rechaza %s con 400 y mantiene la foto anterior', async (_, contenido, nombre, tipo) => {
      await subir(contenido, nombre, tipo).expect(400);

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(fetchStorage).not.toHaveBeenCalled();
      expect(avatarDe(ALEX)).toBe(FOTO_ANTERIOR);
    });

    // El tipo de archivo se valida también en el backend (PA-1016.06). Hoy solo se mira el
    // mimetype que declara el cliente, que cualquiera puede escribir como «image/png»
    it('rechaza un texto que se hace pasar por image/png: el tipo se comprueba por el contenido', async () => {
      await subir(NO_ES_IMAGEN, 'no-es-imagen.png', 'image/png').expect(400);

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(avatarDe(ALEX)).toBe(FOTO_ANTERIOR);
    });

    it('rechaza un ejecutable que se hace pasar por image/jpeg', async () => {
      await subir(Buffer.from('MZ-no-soy-una-foto'), 'foto.jpg', 'image/jpeg').expect(400);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    // Fuera de la PA: un SVG empieza por «image/», pero puede llevar scripts y se serviría
    // desde un enlace público de Storage
    it('rechaza un SVG (image/svg+xml): puede llevar scripts', async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

      await subir(svg, 'foto.svg', 'image/svg+xml').expect(400);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
