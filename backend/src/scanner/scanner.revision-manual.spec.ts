import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { APARTMENT_ID, USER_ID } from '../common/dev-session';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsController } from '../transactions/transactions.controller';
import {
  RespuestaMiBalancePersonal,
  TransactionsService,
} from '../transactions/transactions.service';
import { UsersService } from '../users/users.service';
import { ScannerController } from './scanner.controller';
import { ProductoEscaneado, ScannerService } from './scanner.service';

// UT1004: en la pantalla de confirmación el usuario revisa lo que ha leído el escáner,
// elige qué productos comparte, añade o corrige productos a mano y guarda el gasto.
// Peticiones HTTP reales con la misma validación que la app, Gemini simulado y una base
// de datos falsa con filas de verdad, para ver qué se guarda y cómo queda el balance.

// Se sustituye el cliente de Gemini para que los tests no llamen a la API real
const generateContent = jest.fn();
jest.mock('@google/genai', () => ({
  ...jest.requireActual('@google/genai'),
  GoogleGenAI: jest.fn(() => ({ models: { generateContent } })),
}));

const TICKET = join(__dirname, '../../test/tickets/consum-1.jpg');

// Quien paga el ticket es el usuario de la sesión (USER_ID); estos son sus compañeros de piso
const ANA = '3f0c9a4e-8b1d-4c2a-9e7f-5a6b7c8d9e0f';
const BRUNO = '8b7c6d5e-4f3a-4210-9b8c-7d6e5f4a3210';
const CARLA = '9c6c7f97-5938-4d4f-8920-9921a9f873fc';
const MIEMBROS = [USER_ID, ANA, BRUNO, CARLA];
const NOMBRES = { [ANA]: 'Ana', [BRUNO]: 'Bruno', [CARLA]: 'Carla' };

const AL_DIA = 'Estás al día en tus pagos.';

// Lo que lee el escáner del ticket, con los fallos de lectura que el usuario corrige al revisar
const LEIDO_POR_EL_ESCANER: ProductoEscaneado[] = [
  {
    name: 'Leche entera',
    quantity: 2,
    unit_price: '0.95',
    category: 'supplies',
  },
  // Es "Pan de molde" a 1,95 €
  { name: 'PAN MOLD3', quantity: 1, unit_price: '19.50', category: 'supplies' },
  // Eran 4 yogures
  {
    name: 'Yogur natural',
    quantity: 1,
    unit_price: '0.50',
    category: 'supplies',
  },
  { name: 'Champú', quantity: 1, unit_price: '4.50', category: 'supplies' },
  // Precio ilegible: el escáner lo deja a null para que lo complete el usuario
  { name: 'Huevos', quantity: 1, unit_price: null, category: 'supplies' },
];

// Un producto de la pantalla de confirmación; compartido = su checkbox
type ProductoRevisado = Pick<
  ProductoEscaneado,
  'name' | 'quantity' | 'unit_price'
> & { compartido: boolean };

// Lo que hace el usuario en la pantalla de confirmación con lo que ha leído el escáner
function revisar([
  leche,
  pan,
  yogur,
  champu,
  huevos,
]: ProductoEscaneado[]): ProductoRevisado[] {
  return [
    // Bien leído: 2 x 0,95 = 1,90
    { ...leche, compartido: true },
    // Corrige el nombre y el precio: 1,95
    { ...pan, name: 'Pan de molde', unit_price: '1.95', compartido: true },
    // Corrige la cantidad: 4 x 0,50 = 2,00
    { ...yogur, quantity: 4, compartido: true },
    // Es solo suyo: lo desmarca y no se reparte
    { ...champu, compartido: false },
    // Completa el precio que no se pudo leer: 2,15
    { ...huevos, unit_price: '2.15', compartido: true },
    // Añade a mano un producto que el escáner no vio: 7,00
    { name: 'Detergente', quantity: 1, unit_price: '7.00', compartido: true },
  ];
}
// Total a compartir: 1,90 + 1,95 + 2,00 + 2,15 + 7,00 = 15,00 €, a 5,00 € por persona entre 3.
// Con lo que leyó el escáner serían 1,90 + 19,50 + 0,50 + 4,50 = 26,40 € y los huevos sin precio.

// Igual que receiptRequestItems en la app: solo los productos marcados y solo los campos del DTO
function productosQueEnviaLaApp(revisados: ProductoRevisado[]) {
  return revisados
    .filter((producto) => producto.compartido)
    .map(({ name, quantity, unit_price }) => ({ name, quantity, unit_price }));
}

// El cuerpo de POST /transactions/from-receipt que manda ReceiptSplit al confirmar
function gastoCompartido(items: object[], participant_ids = [ANA, BRUNO]) {
  return {
    apartment_id: APARTMENT_ID,
    participant_ids,
    items,
    category: 'supplies',
  };
}

type Fila = {
  [campo: string]: unknown;
  id: string;
  from_user_id: string;
  to_user_id: string;
  amount: string;
};
type Where = Record<string, unknown>;
type Select = Record<string, boolean>;

// Igualdad y { not: valor }, que es como el balance excluye los avisos de pago pendientes
function cumple(fila: Fila, where: Where = {}) {
  return Object.entries(where).every(([campo, condicion]) => {
    if (
      typeof condicion === 'object' &&
      condicion !== null &&
      'not' in condicion
    ) {
      return fila[campo] !== condicion.not;
    }
    return fila[campo] === condicion;
  });
}

function elegir(fila: Fila, select?: Select) {
  if (!select) return { ...fila };
  return Object.fromEntries(
    Object.keys(select)
      .filter((campo) => select[campo])
      .map((campo) => [campo, fila[campo]]),
  );
}

// Base de datos falsa con filas de verdad: guarda las deudas que crea el gasto y responde a
// las consultas del balance. registro = cada operación que ha llegado a la base de datos
function crearBaseFalsa() {
  const filas: Fila[] = [];
  const registro: string[] = [];
  let siguienteId = 0;

  const prisma = {
    apartment: {
      findUnique: ({ where }: { where: { id: string } }) => {
        registro.push('apartment.findUnique');
        return Promise.resolve(
          where.id === APARTMENT_ID
            ? { user_apartments: MIEMBROS.map((user_id) => ({ user_id })) }
            : null,
        );
      },
    },
    transaction: {
      create: ({ data }: { data: Omit<Fila, 'id'> }) => {
        registro.push('transaction.create');
        const fila = { id: `deuda-${++siguienteId}`, ...data } as Fila;
        filas.push(fila);
        return Promise.resolve({ ...fila });
      },
      findMany: ({
        where,
        select,
        distinct,
      }: {
        where?: Where;
        select?: Select;
        distinct?: string[];
      }) => {
        registro.push('transaction.findMany');
        let resultado = filas.filter((fila) => cumple(fila, where));
        if (distinct) {
          const [campo] = distinct;
          const vistos = new Set<unknown>();
          resultado = resultado.filter(
            (fila) => !vistos.has(fila[campo]) && vistos.add(fila[campo]),
          );
        }
        return Promise.resolve(resultado.map((fila) => elegir(fila, select)));
      },
      aggregate: ({ where }: { where?: Where }) => {
        registro.push('transaction.aggregate');
        const coinciden = filas.filter((fila) => cumple(fila, where));
        // Prisma devuelve null, no 0, cuando no hay filas que sumar
        const amount = coinciden.length
          ? coinciden.reduce(
              (centimos, fila) =>
                centimos + Math.round(Number(fila.amount) * 100),
              0,
            ) / 100
          : null;
        return Promise.resolve({ _sum: { amount } });
      },
    },
    $transaction: (operaciones: Promise<unknown>[]) => {
      registro.push('$transaction');
      return Promise.all(operaciones);
    },
  };

  return { prisma, filas, registro };
}

let app: INestApplication<App>;
let base: ReturnType<typeof crearBaseFalsa>;
// El método que guarda el gasto: si no se llama, el ValidationPipe ha parado la petición
let crearGasto: jest.SpyInstance;

beforeEach(async () => {
  // El escáner registra cada lectura; en los tests solo ensuciaría la salida
  for (const nivel of ['log', 'debug'] as const) {
    jest.spyOn(Logger.prototype, nivel).mockImplementation(() => undefined);
  }
  generateContent.mockResolvedValue({
    text: JSON.stringify({ comercio: 'Consum', items: LEIDO_POR_EL_ESCANER }),
  });
  base = crearBaseFalsa();

  const module = await Test.createTestingModule({
    controllers: [ScannerController, TransactionsController],
    providers: [
      ScannerService,
      TransactionsService,
      {
        provide: ConfigService,
        useValue: {
          get: (nombre: string) =>
            nombre === 'GEMINI_API_KEY' ? 'clave-de-prueba' : undefined,
        },
      },
      { provide: PrismaService, useValue: base.prisma },
      {
        provide: UsersService,
        useValue: { getUserNames: () => Promise.resolve(NOMBRES) },
      },
    ],
  }).compile();

  app = module.createNestApplication();
  configureApp(app);
  await app.init();
  crearGasto = jest.spyOn(app.get(TransactionsService), 'createFromReceipt');
});

afterEach(async () => {
  await app.close();
});

// "Hacer foto": la app sube la imagen del ticket al escáner
function escanear() {
  return request(app.getHttpServer())
    .post('/scanner/ticket')
    .attach('image', TICKET);
}

// "Confirmar y guardar el gasto"
function confirmar(gasto: object) {
  return request(app.getHttpServer())
    .post('/transactions/from-receipt')
    .send(gasto);
}

// El balance que recarga la pantalla de Dinero al volver de guardar el gasto
async function miBalance() {
  const response = await request(app.getHttpServer())
    .get(`/transactions/${APARTMENT_ID}/my-summary`)
    .expect(200);
  return response.body as RespuestaMiBalancePersonal;
}

// El flujo completo: escanea, revisa como en revisar() y confirma con Ana y Bruno.
// Carla es del piso pero no comparte este ticket
async function escanearRevisarYConfirmar() {
  const { body: ticket } = await escanear().expect(201);
  return confirmar(
    gastoCompartido(productosQueEnviaLaApp(revisar(ticket.items))),
  ).expect(201);
}

describe('PA-1004.01: revisión manual y guardado de datos del escáner (UT1004)', () => {
  it('escanear solo rellena la pantalla de confirmación: no guarda nada ni cambia el balance', async () => {
    const response = await escanear().expect(201);

    expect(response.body).toEqual({
      comercio: 'Consum',
      items: LEIDO_POR_EL_ESCANER,
    });
    expect(base.registro).toEqual([]);
    // Hasta que el usuario confirma, el gasto no afecta al resto del piso
    expect((await miBalance()).mensaje).toBe(AL_DIA);
    expect(base.filas).toEqual([]);
  });

  it('valida los datos finales tras la edición: solo los productos marcados, con lo corregido', async () => {
    const response = await escanearRevisarYConfirmar();

    // Sin el champú desmarcado ni el precio mal leído del pan
    expect(response.body).toMatchObject({
      total: '15.00',
      participant_count: 3,
    });
    // Lo que llega al servicio después de pasar el ValidationPipe
    expect(crearGasto).toHaveBeenCalledTimes(1);
    expect(crearGasto).toHaveBeenCalledWith(
      expect.objectContaining({
        participant_ids: [ANA, BRUNO],
        items: [
          { name: 'Leche entera', quantity: 2, unit_price: '0.95' },
          { name: 'Pan de molde', quantity: 1, unit_price: '1.95' },
          { name: 'Yogur natural', quantity: 4, unit_price: '0.50' },
          { name: 'Huevos', quantity: 1, unit_price: '2.15' },
          { name: 'Detergente', quantity: 1, unit_price: '7.00' },
        ],
      }),
      USER_ID,
    );
  });

  it('guarda el gasto en la base de datos y lo vincula a los compañeros elegidos', async () => {
    const response = await escanearRevisarYConfirmar();

    // Una deuda por compañero elegido, de quien paga hacia él, con su parte de los 15,00 €.
    // Ninguna para Carla, que no comparte el ticket, ni de quien paga consigo mismo
    const deuda = (companero: string) =>
      expect.objectContaining({
        apartment_id: APARTMENT_ID,
        from_user_id: USER_ID,
        to_user_id: companero,
        amount: '5.00',
        category: 'supplies',
      });
    expect(base.filas).toEqual([deuda(ANA), deuda(BRUNO)]);
    // La app recibe las deudas que se han guardado
    expect(response.body.transactions).toEqual(base.filas);
  });

  it('actualiza el balance general: cada compañero elegido pasa a deber su parte', async () => {
    expect((await miBalance()).mensaje).toBe(AL_DIA);

    await escanearRevisarYConfirmar();

    const balance = await miBalance();
    expect(balance.mensaje).toBe(
      'En total, tienes 10.00€ pendientes de cobro.',
    );
    expect(balance.miResumen.esDeudor).toBe(false);
    expect(balance.miResumen.monto).toBe(10);
    expect([...balance.miResumen.conceptos].sort()).toEqual([
      'Ana te debe 5€',
      'Bruno te debe 5€',
    ]);

    // También cambia el balance de los compañeros, pero solo el de los que comparten el ticket
    const transacciones = app.get(TransactionsService);
    const deAna = await transacciones.getPersonalSummary(APARTMENT_ID, ANA);
    const deCarla = await transacciones.getPersonalSummary(APARTMENT_ID, CARLA);
    expect(deAna.mensaje).toBe('En total, debes 5.00€ para saldar cuentas.');
    expect(deCarla.mensaje).toBe(AL_DIA);
  });
});

describe('PA-1004.02: bloqueo de creación por datos inválidos (UT1004)', () => {
  // Un producto válido; cada caso estropea un campo
  const producto = (cambios: object = {}) => ({
    name: 'Leche entera',
    quantity: 2,
    unit_price: '0.95',
    ...cambios,
  });

  const CASOS: [caso: string, gasto: object, campo: string][] = [
    [
      'un producto cuesta 0 €',
      gastoCompartido([producto({ unit_price: '0' })]),
      'items.0.unit_price',
    ],
    [
      'un producto cuesta 0.00 €',
      gastoCompartido([producto({ unit_price: '0.00' })]),
      'items.0.unit_price',
    ],
    [
      'el precio está en blanco',
      gastoCompartido([producto({ unit_price: '' })]),
      'items.0.unit_price',
    ],
    // El escáner deja el precio a null cuando no lo puede leer
    [
      'se queda sin rellenar un precio que el escáner no pudo leer',
      gastoCompartido([producto({ unit_price: null })]),
      'items.0.unit_price',
    ],
    // En un ticket el concepto de cada línea es el nombre del producto
    [
      'el concepto (nombre del producto) está vacío',
      gastoCompartido([producto({ name: '' })]),
      'items.0.name',
    ],
    [
      'el concepto solo tiene espacios',
      gastoCompartido([producto({ name: '   ' })]),
      'items.0.name',
    ],
    [
      'falta el concepto',
      gastoCompartido([producto({ name: undefined })]),
      'items.0.name',
    ],
    ['no queda ningún producto marcado', gastoCompartido([]), 'items'],
    [
      'no se elige a ningún compañero',
      gastoCompartido([producto()], []),
      'participant_ids',
    ],
  ];

  it.each(CASOS)(
    'responde 400 si %s, sin llegar a tocar la base de datos',
    async (_, gasto, campo) => {
      const response = await confirmar(gasto).expect(400);

      // El mensaje que enseña la app dice qué campo está mal
      expect(response.body.message.join(' ')).toContain(campo);
      // El ValidationPipe rechaza el DTO antes de llegar al servicio
      expect(crearGasto).not.toHaveBeenCalled();
      expect(base.registro).toEqual([]);
    },
  );

  it('un solo producto inválido bloquea el ticket entero: no se guarda nada y el balance no cambia', async () => {
    const response = await confirmar(
      gastoCompartido([
        producto(),
        producto({ name: 'Pan de molde', quantity: 1, unit_price: '1.95' }),
        producto({ name: 'Huevos', quantity: 1, unit_price: '0' }),
      ]),
    ).expect(400);

    expect(response.body.message.join(' ')).toContain('items.2.unit_price');
    expect(base.filas).toEqual([]);
    expect((await miBalance()).mensaje).toBe(AL_DIA);
  });
});
