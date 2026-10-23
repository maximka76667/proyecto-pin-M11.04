import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  Prisma,
  TaskCategory,
  TaskFrequency,
  TaskPriority,
  TaskStatus,
} from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

// El mismo hogar que usa el formulario de la app
const HOGAR = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTRO_HOGAR = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const YA_EXISTE = 'Ya existe una tarea con este nombre en tu hogar';

type Tarea = {
  [campo: string]: unknown;
  id: string;
  apartment_id: string;
  title: string;
  status: TaskStatus;
  category: TaskCategory;
  priority: TaskPriority;
  frequency: TaskFrequency;
};

type Where = Record<string, unknown>;
type Include = { assignments?: unknown };

// Columnas de la tabla Task sin valor por defecto: Prisma no deja crear una fila sin ellas
const COLUMNAS_OBLIGATORIAS = [
  'apartment_id',
  'title',
  'status',
  'category',
  'priority',
  'frequency',
];

function tarea(id: string, apartmentId: string, title: string): Tarea {
  return {
    id,
    apartment_id: apartmentId,
    title,
    status: TaskStatus.pending,
    category: TaskCategory.cleaning,
    priority: TaskPriority.medium,
    frequency: TaskFrequency.weekly,
  };
}

// "Fregar los platos" en el hogar y "Sacar la basura" en otro hogar
function semilla() {
  return [
    tarea('fregar-hogar', HOGAR, 'Fregar los platos'),
    tarea('basura-otro-hogar', OTRO_HOGAR, 'Sacar la basura'),
  ];
}

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('Prisma error', {
    code,
    clientVersion: Prisma.prismaVersion.client,
  });
}

// Prisma no aplica un filtro cuyo valor es undefined
function cumple(fila: Tarea, where: Where = {}) {
  return Object.entries(where).every(
    ([campo, valor]) => valor === undefined || fila[campo] === valor,
  );
}

function elegir(fila: Tarea, select?: Record<string, boolean>) {
  if (!select) return { ...fila };
  return Object.fromEntries(
    Object.keys(select)
      .filter((campo) => select[campo])
      .map((campo) => [campo, fila[campo]]),
  );
}

// Las tareas de estos tests todavía no tienen a nadie asignado
function conInclude(fila: Tarea, include?: Include) {
  return include?.assignments ? { ...fila, assignments: [] } : { ...fila };
}

// Base de datos falsa con filas de verdad: aplica los where y el índice único
// @@unique([apartment_id, title]) de la tabla Task, igual que Postgres
function crearBaseFalsa(filas: Tarea[]) {
  const registro: string[] = [];
  // Filas que otra petición ha insertado y aún no ha confirmado: las consultas
  // todavía no las ven, pero el índice único sí
  const sinConfirmar = new Set<Tarea>();
  let siguienteId = 0;

  const visibles = () => filas.filter((fila) => !sinConfirmar.has(fila));

  const task = {
    findFirst: ({
      where,
      select,
    }: {
      where?: Where;
      select?: Record<string, boolean>;
    }) => {
      registro.push('findFirst');
      const fila = visibles().find((candidata) => cumple(candidata, where));
      return Promise.resolve(fila ? elegir(fila, select) : null);
    },
    findMany: ({
      where,
      include,
      orderBy,
    }: {
      where?: Where;
      include?: Include;
      orderBy?: { title?: 'asc' | 'desc' };
    }) => {
      registro.push('findMany');
      const resultado = visibles().filter((fila) => cumple(fila, where));
      if (orderBy?.title) {
        const sentido = orderBy.title === 'asc' ? 1 : -1;
        resultado.sort((a, b) => a.title.localeCompare(b.title) * sentido);
      }
      return Promise.resolve(
        resultado.map((fila) => conInclude(fila, include)),
      );
    },
    create: ({
      data,
      include,
    }: {
      data: Record<string, unknown>;
      include?: Include;
    }) => {
      registro.push('create');
      const falta = COLUMNAS_OBLIGATORIAS.find((campo) => data[campo] == null);
      if (falta) {
        return Promise.reject(
          new Prisma.PrismaClientValidationError(
            `Argument \`${falta}\` is missing.`,
            { clientVersion: Prisma.prismaVersion.client },
          ),
        );
      }
      const repetida = filas.some(
        (fila) =>
          fila.apartment_id === data.apartment_id && fila.title === data.title,
      );
      if (repetida) return Promise.reject(prismaError('P2002'));

      const fila = { id: `tarea-nueva-${++siguienteId}`, ...data } as Tarea;
      filas.push(fila);
      return Promise.resolve(conInclude(fila, include));
    },
  };

  return {
    prisma: { task },
    filas,
    registro,
    insertarSinConfirmar(fila: Tarea) {
      filas.push(fila);
      sinConfirmar.add(fila);
    },
  };
}

// El bloque `model Task` del esquema de Prisma, que es el que define la tabla real
function modeloTask() {
  const esquema = readFileSync(
    join(__dirname, '../../prisma/schema.prisma'),
    'utf8',
  );
  return esquema.match(/^model Task \{[^}]*\}/m)?.[0] ?? '';
}

describe('POST /tasks: crear tareas (UT1005)', () => {
  let app: INestApplication<App>;
  let base: ReturnType<typeof crearBaseFalsa>;

  beforeEach(async () => {
    base = crearBaseFalsa(semilla());

    const module = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        TasksService,
        { provide: PrismaService, useValue: base.prisma },
      ],
    }).compile();

    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // Lo mismo que envía el formulario de crear tarea, que siempre manda el hogar
  const crearTarea = (campos: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/tasks')
      .send({ apartment_id: HOGAR, ...campos });

  const filaGuardada = (id: unknown) =>
    base.filas.find((fila) => fila.id === id);

  describe('PA-1005.01: creación exitosa de tarea', () => {
    it('guarda la tarea en el hogar con solo el nombre y la frecuencia, y responde 201', async () => {
      const response = await crearTarea({
        title: 'Regar las plantas',
        frequency: 'weekly',
      }).expect(201);

      const esperada = {
        apartment_id: HOGAR,
        title: 'Regar las plantas',
        frequency: 'weekly',
        status: 'pending',
        category: 'other',
        priority: 'medium',
      };
      expect(response.body).toMatchObject({
        id: expect.any(String),
        ...esperada,
      });
      expect(filaGuardada(response.body.id)).toMatchObject(esperada);
      expect(base.filas).toHaveLength(3);
    });

    it('guarda lo que envía el formulario: frecuencia "Once" y la categoría elegida', async () => {
      // el formulario manda "Once" como 'none'
      const response = await crearTarea({
        title: 'Comprar detergente',
        frequency: 'none',
        category: 'shopping',
      }).expect(201);

      expect(filaGuardada(response.body.id)).toMatchObject({
        apartment_id: HOGAR,
        title: 'Comprar detergente',
        frequency: 'none',
        category: 'shopping',
      });
    });

    it('la lista de tareas del hogar ya incluye la tarea nueva', async () => {
      await crearTarea({
        title: 'Regar las plantas',
        frequency: 'weekly',
      }).expect(201);

      const response = await request(app.getHttpServer())
        .get('/tasks')
        .query({ apartment_id: HOGAR })
        .expect(200);

      // sin la tarea de OTRO_HOGAR
      expect(response.body.map((t: Tarea) => t.title)).toEqual([
        'Fregar los platos',
        'Regar las plantas',
      ]);
    });

    // La descripción aún no existe (ni columna, ni DTO, ni campo en el formulario):
    // este test falla hasta que se implemente
    it('acepta una descripción opcional y la guarda con la tarea', async () => {
      const descripcion = 'Bajar el cubo marrón antes de las 22:00';

      const response = await crearTarea({
        title: 'Sacar el orgánico',
        frequency: 'weekly',
        description: descripcion,
      }).expect(201);

      expect(response.body.description).toBe(descripcion);
      expect(filaGuardada(response.body.id)?.description).toBe(descripcion);
      // sin la columna en la tabla Task, la base de datos real no podría guardarla
      expect(modeloTask()).toMatch(/^\s*description\s+String\?/m);
    });
  });

  describe('PA-1005.02: bloqueo de creación por campos obligatorios vacíos', () => {
    type Campo = 'title' | 'frequency';

    // Cómo se reconoce cada campo en el mensaje, venga en inglés (class-validator) o en español
    const NOMBRE_DEL_CAMPO: Record<Campo, RegExp> = {
      title: /title|nombre/i,
      frequency: /frequency|frecuencia/i,
    };

    const CASOS: [
      caso: string,
      campos: Record<string, string>,
      faltan: Campo[],
    ][] = [
      ['sin nombre', { frequency: 'weekly' }, ['title']],
      ['con el nombre vacío', { title: '', frequency: 'weekly' }, ['title']],
      ['sin frecuencia', { title: 'Regar las plantas' }, ['frequency']],
      // es lo que llega si no se elige ninguna opción de frecuencia
      [
        'con la frecuencia vacía',
        { title: 'Regar las plantas', frequency: '' },
        ['frequency'],
      ],
      ['sin nombre ni frecuencia', {}, ['title', 'frequency']],
    ];

    it.each(CASOS)(
      'responde 400 %s, nombrando solo los campos que faltan, sin tocar la base de datos',
      async (_, campos, faltan) => {
        const response = await crearTarea(campos).expect(400);

        const mensaje = [response.body.message].flat().join(' ');
        for (const campo of Object.keys(NOMBRE_DEL_CAMPO) as Campo[]) {
          if (faltan.includes(campo)) {
            expect(mensaje).toMatch(NOMBRE_DEL_CAMPO[campo]);
          } else {
            expect(mensaje).not.toMatch(NOMBRE_DEL_CAMPO[campo]);
          }
        }
        expect(base.registro).toEqual([]);
        expect(base.filas).toEqual(semilla());
      },
    );

    it('responde 400 si el nombre solo tiene espacios, sin tocar la base de datos', async () => {
      const response = await crearTarea({
        title: '   ',
        frequency: 'weekly',
      }).expect(400);

      expect(response.body.message).toBe(
        'El nombre de la tarea es obligatorio',
      );
      expect(base.registro).toEqual([]);
      expect(base.filas).toEqual(semilla());
    });
  });

  describe('PA-1005.03: bloqueo de creación de tarea por nombre duplicado', () => {
    const basuraDelHogar = () =>
      tarea('basura-hogar', HOGAR, 'Sacar la basura');
    const basurasDelHogar = () =>
      base.filas.filter(
        (fila) =>
          fila.apartment_id === HOGAR && fila.title === 'Sacar la basura',
      );

    it('responde 409 con el aviso "Ya existe una tarea con este nombre en tu hogar" y no guarda la repetida', async () => {
      base.filas.push(basuraDelHogar());

      const response = await crearTarea({
        title: 'Sacar la basura',
        frequency: 'daily',
      }).expect(409);

      expect(response.body.message).toBe(YA_EXISTE);
      expect(basurasDelHogar()).toEqual([basuraDelHogar()]);
      expect(base.filas).toHaveLength(3);
    });

    it('también la bloquea si el nombre llega con espacios alrededor', async () => {
      base.filas.push(basuraDelHogar());

      const response = await crearTarea({
        title: '  Sacar la basura  ',
        frequency: 'daily',
      }).expect(409);

      expect(response.body.message).toBe(YA_EXISTE);
      expect(base.filas).toHaveLength(3);
    });

    it('si la base de datos rechaza la inserción por unicidad (P2002), responde 409 con el mismo aviso', async () => {
      // Otra persona acaba de crear la misma tarea y su inserción aún no está confirmada:
      // la comprobación previa no la ve, pero el índice único de la base de datos sí
      const deOtraPeticion = tarea('otra-peticion', HOGAR, 'Sacar la basura');
      base.insertarSinConfirmar(deOtraPeticion);

      const response = await crearTarea({
        title: 'Sacar la basura',
        frequency: 'daily',
      }).expect(409);

      expect(response.body.message).toBe(YA_EXISTE);
      // la inserción llegó a la base de datos y fue ella la que la rechazó
      expect(base.registro).toContain('create');
      expect(basurasDelHogar()).toEqual([deOtraPeticion]);
    });

    it('permite el mismo nombre en otro hogar', async () => {
      // "Sacar la basura" ya existe, pero en OTRO_HOGAR
      await crearTarea({ title: 'Sacar la basura', frequency: 'daily' }).expect(
        201,
      );

      const hogares = base.filas
        .filter((fila) => fila.title === 'Sacar la basura')
        .map((fila) => fila.apartment_id);
      expect(hogares).toEqual([OTRO_HOGAR, HOGAR]);
    });

    it('la base de datos tiene el nombre de la tarea único por hogar', () => {
      expect(modeloTask()).toMatch(/@@unique\(\[apartment_id, title\]\)/);
    });
  });
});
