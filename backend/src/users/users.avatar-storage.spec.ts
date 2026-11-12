import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const PNG = readFileSync(join(__dirname, '../../test/avatars/avatar.png'));
// Otra imagen distinta: empieza como una PNG de verdad y lleva más bytes detrás
const OTRA_PNG = Buffer.concat([PNG, Buffer.from('otra foto distinta')]);

// El usuario que devuelve @CurrentUser() en los tests (NODE_ENV=test)
const ALEX = '22222222-2222-2222-2222-222222222222';
const PISO = '6c5d4e3f-2a19-4876-9b0c-1d2e3f4a5b6c';

// Un proyecto de Supabase de mentira; fetch se sustituye y ninguna prueba sale a internet
const SUPABASE_URL = 'https://proyecto-de-prueba.supabase.co';
const FOTO_ANTERIOR = `${SUPABASE_URL}/storage/v1/object/public/avatars/alex-anterior.png`;

const VARIABLES = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_KEY'] as const;

type Usuario = { id: string; full_name: string; avatar_url: string | null };

const prisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
};

async function crearApp(): Promise<INestApplication<App>> {
  const module = await Test.createTestingModule({
    controllers: [UsersController],
    providers: [UsersService, { provide: PrismaService, useValue: prisma }],
  }).compile();

  const app: INestApplication<App> = module.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

const subirA = (app: INestApplication<App>, contenido: Buffer = PNG) =>
  request(app.getHttpServer())
    .post('/users/me/avatar')
    .attach('image', contenido, { filename: 'foto.png', contentType: 'image/png' });

// PA-1016.05, más allá de su letra: lo que puede ir mal entre el backend y Supabase Storage.
// Igual que users.avatar.spec.ts, el prisma guarda a los usuarios en memoria
describe('PA-1016.05 · la foto en Supabase Storage: fallos de la subida y enlace', () => {
  let usuarios: Usuario[];
  let fetchStorage: jest.SpiedFunction<typeof fetch>;
  const entorno = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]));

  const avatarDe = (id: string) => usuarios.find((u) => u.id === id)?.avatar_url;

  const storageResponde = (status: number, cuerpo: object) =>
    fetchStorage.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(cuerpo), { status })),
    );

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-prueba';
    delete process.env.SUPABASE_KEY;

    // El servicio escribe en la consola cuando Storage falla; aquí no hace falta verlo
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchStorage = jest.spyOn(globalThis, 'fetch');
    storageResponde(200, { Key: 'avatars/foto.png' });

    usuarios = [{ id: ALEX, full_name: 'Alex Morgan', avatar_url: FOTO_ANTERIOR }];

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
                _count: { user_apartments: 1 },
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    for (const variable of VARIABLES) {
      const valor = entorno[variable];
      if (valor === undefined) delete process.env[variable];
      else process.env[variable] = valor;
    }
  });

  // Hoy el servicio apunta el error en la consola y sigue: guarda el enlace y responde 201,
  // así que el perfil (y la lista de compañeros) enseña una foto que no existe
  describe('si la subida a Storage falla, la foto no se da por guardada', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      process.env.SUPABASE_URL = SUPABASE_URL;
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-prueba';
      app = await crearApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('con Storage funcionando responde 201 y guarda el enlace (control)', async () => {
      const response = await subirA(app).expect(201);

      expect(response.body.avatar_url).toMatch(`${SUPABASE_URL}/storage/v1/object/public/`);
      expect(avatarDe(ALEX)).toBe(response.body.avatar_url);
    });

    it.each([
      ['el bucket no existe (400)', 400, { statusCode: '404', error: 'Bucket not found' }],
      ['la clave no vale (403)', 403, { statusCode: '403', error: 'Unauthorized' }],
      ['Storage está caído (500)', 500, { statusCode: '500', error: 'Internal' }],
    ])('si %s responde con error y mantiene la foto anterior', async (_, status, cuerpo) => {
      storageResponde(status, cuerpo);

      const response = await subirA(app);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(avatarDe(ALEX)).toBe(FOTO_ANTERIOR);
    });

    it('si no se puede conectar con Storage responde con error y mantiene la foto anterior', async () => {
      fetchStorage.mockImplementation(() => Promise.reject(new TypeError('fetch failed')));

      const response = await subirA(app);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(avatarDe(ALEX)).toBe(FOTO_ANTERIOR);
    });
  });

  describe('si falta la configuración de Storage', () => {
    // Cada prueba arranca su propia app con el entorno que le toca. Si la app ni siquiera
    // arranca sin esa configuración también vale: es otra forma de no guardar un enlace roto
    const subirConEsteEntorno = async () => {
      let app: INestApplication<App>;
      try {
        app = await crearApp();
      } catch {
        return undefined;
      }
      try {
        return await subirA(app);
      } finally {
        await app.close();
      }
    };

    // Hoy, sin clave, no se sube nada pero se guarda igualmente el enlace
    it('sin la clave de Storage no guarda un enlace a una foto que no se ha subido', async () => {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.SUPABASE_KEY;

      const response = await subirConEsteEntorno();

      expect(response?.status).not.toBe(201);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(avatarDe(ALEX)).toBe(FOTO_ANTERIOR);
    });

    // Hoy, sin SUPABASE_URL, el servicio usa la dirección de un proyecto escrita en el código:
    // un despliegue sin configurar subiría las fotos a ese proyecto sin avisar
    it('sin SUPABASE_URL no sube la foto a un proyecto escrito en el código', async () => {
      delete process.env.SUPABASE_URL;

      const response = await subirConEsteEntorno();

      expect(response?.status).not.toBe(201);
      expect(fetchStorage).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(avatarDe(ALEX)).toBe(FOTO_ANTERIOR);
    });
  });

  // Hoy el archivo es siempre <id del usuario>/avatar.<extensión>: al cambiar una foto por
  // otra del mismo tipo el enlace es idéntico, y la app y el CDN siguen sirviendo la de antes
  describe('al cambiar de foto cambia el enlace', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      process.env.SUPABASE_URL = SUPABASE_URL;
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-prueba';
      app = await crearApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('dos fotos PNG distintas subidas una detrás de otra dan dos enlaces distintos', async () => {
      const primera = await subirA(app, PNG).expect(201);
      // Por si el enlace nuevo se distingue con la hora
      await new Promise((resolve) => setTimeout(resolve, 5));
      const segunda = await subirA(app, OTRA_PNG).expect(201);

      expect(segunda.body.avatar_url).toMatch(`${SUPABASE_URL}/storage/v1/object/public/`);
      expect(segunda.body.avatar_url).not.toBe(primera.body.avatar_url);
      expect(avatarDe(ALEX)).toBe(segunda.body.avatar_url);
    });
  });
});
