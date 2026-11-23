import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentsStorageService } from './documents-storage.service';

const PNG = readFileSync(join(__dirname, '../../test/avatars/avatar.png'));
const MB = 1024 * 1024;

// El usuario que devuelve @CurrentUser() en los tests (NODE_ENV=test)
const ALEX = '22222222-2222-2222-2222-222222222222';
const BEA = '3f0c9a4e-8b1d-4c2a-9e7f-5a6b7c8d9e0f';
const PISO = '6c5d4e3f-2a19-4876-9b0c-1d2e3f4a5b6c';
const OTRO_PISO = '7d6e5f4a-3b2a-4987-8c1d-2e3f4a5b6c7d';
const DOC = '9a8b7c6d-5e4f-4321-8abc-0123456789ab';
const GOOGLE = 'https://docs.google.com/document/d/abc123/edit';

// Un PDF mínimo que empieza como uno de verdad; el contenido se rellena hasta el tamaño pedido
const pdf = (bytes = 200) =>
  Buffer.concat([Buffer.from('%PDF-1.4\n%fake\n'), Buffer.alloc(Math.max(0, bytes - 15), 32)]);
// Un «vídeo» (cabecera mp4) que se hace pasar por PDF con nombre y mimetype
const VIDEO = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from('ftypmp42'),
  Buffer.alloc(200),
]);

type Fila = Record<string, any>;

describe('UT1023 · documentos de la casa', () => {
  let app: INestApplication<App>;
  let filas: Fila[];
  let miembros: Set<string>;

  const prisma = {
    userApartment: { findUnique: jest.fn() },
    apartmentDocument: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const storage = {
    upload: jest.fn(),
    remove: jest.fn(),
    signedUrl: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    filas = [];
    miembros = new Set([`${ALEX}:${PISO}`]);

    prisma.userApartment.findUnique.mockImplementation(({ where }) => {
      const k = where.user_id_apartment_id;
      return Promise.resolve(
        miembros.has(`${k.user_id}:${k.apartment_id}`) ? { user_id: k.user_id } : null,
      );
    });
    prisma.apartmentDocument.count.mockImplementation(() => Promise.resolve(filas.length));
    prisma.apartmentDocument.findMany.mockImplementation(({ where }) =>
      Promise.resolve(
        filas.filter(
          (fila) =>
            fila.apartment_id === where.apartment_id &&
            (where.category === undefined || fila.category === where.category),
        ),
      ),
    );
    // Una copia, como la base de datos real: si devolviera la propia fila, el update
    // posterior cambiaría también lo que el servicio leyó antes
    prisma.apartmentDocument.findUnique.mockImplementation(({ where }) => {
      const fila = filas.find((f) => f.id === where.id);
      return Promise.resolve(fila ? { ...fila } : null);
    });
    prisma.apartmentDocument.create.mockImplementation(({ data }) => {
      const fila = { id: DOC, created_at: new Date(), updated_at: new Date(), ...data };
      delete fila.created_by;
      delete fila.updated_by;
      filas.push({ ...fila, storage_path: data.storage_path });
      // Lo que devuelve es lo que pide el select: nunca storage_path
      const { storage_path: _omitido, ...visible } = fila;
      return Promise.resolve(visible);
    });
    prisma.apartmentDocument.update.mockImplementation(({ where, data }) => {
      const fila = filas.find((f) => f.id === where.id)!;
      Object.assign(fila, data);
      const { storage_path: _omitido, ...visible } = fila;
      return Promise.resolve(visible);
    });
    prisma.apartmentDocument.delete.mockImplementation(({ where }) => {
      filas = filas.filter((f) => f.id !== where.id);
      return Promise.resolve({});
    });
    storage.upload.mockResolvedValue(undefined);
    storage.remove.mockResolvedValue(undefined);
    storage.signedUrl.mockResolvedValue('https://storage.test/firmado?token=abc');

    const moduleRef = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [
        DocumentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: DocumentsStorageService, useValue: storage },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(() => app.close());

  const mensajes = (body: { message: string | string[] }) =>
    Array.isArray(body.message) ? body.message : [body.message];

  const subir = (campos: Record<string, string>, archivo?: { b: Buffer; name: string; type: string }) => {
    const req = request(app.getHttpServer()).post('/documents');
    for (const [k, v] of Object.entries(campos)) req.field(k, v);
    if (archivo) req.attach('file', archivo.b, { filename: archivo.name, contentType: archivo.type });
    return req;
  };

  const base = { apartment_id: PISO, name: 'Contrato' };
  const archivoPdf = (b = pdf()) => ({ b, name: 'contrato.pdf', type: 'application/pdf' });

  const sembrar = (extra: Fila = {}) => {
    filas.push({
      id: DOC,
      apartment_id: PISO,
      name: 'Antiguo',
      kind: 'file',
      storage_path: `${PISO}/viejo.pdf`,
      mime_type: 'application/pdf',
      size_bytes: 100,
      url: null,
      ...extra,
    });
  };

  describe('subir', () => {
    it('PA-01 · sube un PDF de 2 MB y guarda casa y usuario uploader en los metadatos', async () => {
      const res = await subir(base, archivoPdf(pdf(2 * MB))).expect(201);

      expect(storage.upload).toHaveBeenCalledTimes(1);
      expect(storage.upload.mock.calls[0][1]).toHaveLength(2 * MB);
      expect(prisma.apartmentDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ apartment_id: PISO, created_by: ALEX, updated_by: ALEX }),
        }),
      );
      expect(res.body.name).toBe('Contrato');
    });

    it('acepta un PDF, lo guarda con ruta generada y no devuelve storage_path', async () => {
      const res = await subir(base, archivoPdf()).expect(201);

      expect(storage.upload).toHaveBeenCalledTimes(1);
      const [path, content, mime] = storage.upload.mock.calls[0];
      expect(path).toMatch(new RegExp(`^${PISO}/[0-9a-f-]{36}\\.pdf$`));
      expect(path).not.toContain('contrato');
      expect(content.length).toBe(200);
      expect(mime).toBe('application/pdf');
      expect(res.body).toMatchObject({ name: 'Contrato', kind: 'file', mime_type: 'application/pdf' });
      expect(res.body).not.toHaveProperty('storage_path');
    });

    it('acepta una imagen PNG', async () => {
      await subir(base, { b: PNG, name: 'foto.png', type: 'image/png' }).expect(201);
      expect(storage.upload.mock.calls[0][0]).toMatch(/\.png$/);
    });

    it('PA-02 · rechaza un ejecutable o formato no admitido sin guardar archivo ni registro', async () => {
      const res = await subir(base, {
        b: Buffer.from('MZ\x90\x00instalador'),
        name: 'instalador.exe',
        type: 'application/x-msdownload',
      }).expect(400);
      expect(mensajes(res.body)).toContain('El archivo debe ser un PDF, JPG, PNG o WebP');
      expect(storage.upload).not.toHaveBeenCalled();
      expect(prisma.apartmentDocument.create).not.toHaveBeenCalled();
    });

    it('PA-04 · rechaza un ejecutable renombrado como PDF al comprobar su firma real', async () => {
      const res = await subir(base, { b: VIDEO, name: 'peli.pdf', type: 'application/pdf' }).expect(400);
      expect(mensajes(res.body)).toContain('El archivo debe ser un PDF, JPG, PNG o WebP');
      expect(storage.upload).not.toHaveBeenCalled();
      expect(prisma.apartmentDocument.create).not.toHaveBeenCalled();
    });

    it('PA-03 · rechaza un archivo mayor de 10 MB antes de guardarlo', async () => {
      const res = await subir(base, archivoPdf(pdf(10 * MB + 1024))).expect(400);
      expect(mensajes(res.body)).toContain('El archivo no puede superar los 10 MB');
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('acepta un enlace de Google sin tocar Storage', async () => {
      const res = await subir({ ...base, url: GOOGLE }).expect(201);
      expect(res.body).toMatchObject({ kind: 'link', url: GOOGLE });
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it.each([
      'https://evil.com/document/d/abc',
      'http://docs.google.com/document/d/abc',
      'javascript:alert(1)',
    ])('rechaza el enlace %s', async (url) => {
      const res = await subir({ ...base, url }).expect(400);
      expect(mensajes(res.body).join(' ')).toMatch(/Google/);
      expect(prisma.apartmentDocument.create).not.toHaveBeenCalled();
    });

    it('rechaza archivo y enlace a la vez', async () => {
      await subir({ ...base, url: GOOGLE }, archivoPdf()).expect(400);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('rechaza no enviar ni archivo ni enlace', async () => {
      await subir(base).expect(400);
    });

    it('PA-05 · exige el título del documento y valida su longitud', async () => {
      await subir({ apartment_id: PISO, name: '   ', url: GOOGLE }).expect(400);
      await subir({ apartment_id: PISO, url: GOOGLE }).expect(400);
      await subir({ apartment_id: PISO, name: 'a'.repeat(81), url: GOOGLE }).expect(400);
    });

    it('prohíbe subir a quien no es del piso', async () => {
      await subir({ ...base, apartment_id: OTRO_PISO, url: GOOGLE }).expect(403);
      expect(prisma.apartmentDocument.create).not.toHaveBeenCalled();
    });

    it('no pasa del máximo de documentos por piso', async () => {
      prisma.apartmentDocument.count.mockResolvedValue(50);
      await subir({ ...base, url: GOOGLE }).expect(409);
    });

    it('si falla la base de datos, borra el archivo recién subido', async () => {
      prisma.apartmentDocument.create.mockRejectedValue(new Error('db caída'));
      await subir(base, archivoPdf()).expect(500);
      const [path] = storage.upload.mock.calls[0];
      expect(storage.remove).toHaveBeenCalledWith(path);
    });
  });

  describe('listar', () => {
    it('PA-06 · filtra por categoría y limita el resultado a la casa del miembro', async () => {
      sembrar({ name: 'Factura luz', category: 'Facturas' });
      filas.push({
        id: '11111111-1111-4111-8111-111111111111',
        apartment_id: PISO,
        name: 'Contrato',
        category: 'Contratos',
        kind: 'file',
      });
      filas.push({
        id: '22222222-2222-4222-8222-222222222222',
        apartment_id: OTRO_PISO,
        name: 'Factura ajena',
        category: 'Facturas',
        kind: 'file',
      });
      const res = await request(app.getHttpServer())
        .get(`/documents?apartment_id=${PISO}&category=Facturas`)
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ name: 'Factura luz', category: 'Facturas' });
      expect(prisma.apartmentDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { apartment_id: PISO, category: 'Facturas' } }),
      );
    });

    it('prohíbe listar un piso ajeno y valida el id', async () => {
      await request(app.getHttpServer()).get(`/documents?apartment_id=${OTRO_PISO}`).expect(403);
      await request(app.getHttpServer()).get('/documents?apartment_id=nope').expect(400);
    });
  });

  describe('editar', () => {
    it('cambia el nombre sin tocar el archivo', async () => {
      sembrar();
      const res = await request(app.getHttpServer()).patch(`/documents/${DOC}`).field('name', 'Nuevo').expect(200);
      expect(res.body.name).toBe('Nuevo');
      expect(storage.upload).not.toHaveBeenCalled();
      expect(storage.remove).not.toHaveBeenCalled();
    });

    it('al cambiar el archivo sube el nuevo, actualiza la fila y solo después borra el viejo', async () => {
      sembrar();
      await request(app.getHttpServer())
        .patch(`/documents/${DOC}`)
        .attach('file', pdf(300), { filename: 'v2.pdf', contentType: 'application/pdf' })
        .expect(200);

      const orden = [
        storage.upload.mock.invocationCallOrder[0],
        prisma.apartmentDocument.update.mock.invocationCallOrder[0],
        storage.remove.mock.invocationCallOrder[0],
      ];
      expect([...orden].sort((a, b) => a - b)).toEqual(orden);
      expect(storage.remove).toHaveBeenCalledWith(`${PISO}/viejo.pdf`);
      expect(storage.upload.mock.calls[0][0]).not.toBe(`${PISO}/viejo.pdf`);
    });

    it('permite cambiar un archivo por un enlace y borra el archivo', async () => {
      sembrar();
      const res = await request(app.getHttpServer())
        .patch(`/documents/${DOC}`)
        .field('url', GOOGLE)
        .expect(200);
      expect(res.body).toMatchObject({ kind: 'link', url: GOOGLE });
      expect(storage.remove).toHaveBeenCalledWith(`${PISO}/viejo.pdf`);
    });

    it('rechaza un archivo que no es PDF/imagen y deja el documento como estaba', async () => {
      sembrar();
      await request(app.getHttpServer())
        .patch(`/documents/${DOC}`)
        .attach('file', VIDEO, { filename: 'x.pdf', contentType: 'application/pdf' })
        .expect(400);
      expect(prisma.apartmentDocument.update).not.toHaveBeenCalled();
      expect(storage.remove).not.toHaveBeenCalled();
    });

    it('sin nada que cambiar da 400', async () => {
      sembrar();
      await request(app.getHttpServer()).patch(`/documents/${DOC}`).expect(400);
    });

    it('cualquier miembro puede editar aunque no lo subiera, un ajeno no', async () => {
      sembrar({ created_by: BEA });
      await request(app.getHttpServer()).patch(`/documents/${DOC}`).field('name', 'Mío').expect(200);

      miembros.clear();
      await request(app.getHttpServer()).patch(`/documents/${DOC}`).field('name', 'X').expect(403);
    });

    it('404 si el documento no existe', async () => {
      await request(app.getHttpServer()).patch(`/documents/${DOC}`).field('name', 'X').expect(404);
    });
  });

  describe('borrar', () => {
    it('borra la fila y el archivo', async () => {
      sembrar();
      await request(app.getHttpServer()).delete(`/documents/${DOC}`).expect(200);
      expect(filas).toHaveLength(0);
      expect(storage.remove).toHaveBeenCalledWith(`${PISO}/viejo.pdf`);
    });

    it('un fallo al borrar de Storage no rompe el borrado', async () => {
      sembrar();
      storage.remove.mockRejectedValue(new Error('storage caído'));
      await request(app.getHttpServer()).delete(`/documents/${DOC}`).expect(200);
    });

    it('un ajeno no puede borrar', async () => {
      sembrar();
      miembros.clear();
      await request(app.getHttpServer()).delete(`/documents/${DOC}`).expect(403);
      expect(filas).toHaveLength(1);
    });
  });

  describe('abrir', () => {
    it('PA-07 · permite consultar el documento de otro miembro y genera una URL firmada temporal', async () => {
      miembros.add(`${BEA}:${PISO}`);
      sembrar({ created_by: BEA, name: 'Contrato de alquiler' });
      const detalle = await request(app.getHttpServer()).get(`/documents/${DOC}/access`).expect(200);
      expect(detalle.body).toMatchObject({ name: 'Contrato de alquiler' });
      expect(storage.signedUrl).toHaveBeenCalledWith(`${PISO}/viejo.pdf`, 300);
    });

    it('un archivo se abre con un enlace firmado de 5 minutos', async () => {
      sembrar();
      const res = await request(app.getHttpServer()).get(`/documents/${DOC}/access`).expect(200);
      expect(storage.signedUrl).toHaveBeenCalledWith(`${PISO}/viejo.pdf`, 300);
      expect(res.body).toMatchObject({ kind: 'file', url: 'https://storage.test/firmado?token=abc' });
    });

    it('un enlace de Google se devuelve tal cual', async () => {
      sembrar({ kind: 'link', url: GOOGLE, storage_path: null });
      const res = await request(app.getHttpServer()).get(`/documents/${DOC}/access`).expect(200);
      expect(res.body).toMatchObject({ kind: 'link', url: GOOGLE });
      expect(storage.signedUrl).not.toHaveBeenCalled();
    });

    it('PA-08 · deniega el detalle y la descarga de un documento de otra casa', async () => {
      sembrar();
      miembros.clear();
      await request(app.getHttpServer()).get(`/documents/${DOC}/access`).expect(403);
      expect(storage.signedUrl).not.toHaveBeenCalled();
    });
  });

  it('PA-09 · devuelve 401 sin sesión autenticada', async () => {
    const entornoAnterior = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await request(app.getHttpServer()).get(`/documents?apartment_id=${PISO}`).expect(401);
      await request(app.getHttpServer()).get(`/documents/${DOC}/access`).expect(401);
    } finally {
      if (entornoAnterior === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = entornoAnterior;
    }
  });
});
