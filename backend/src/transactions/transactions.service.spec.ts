import { Test, TestingModule } from '@nestjs/testing';
import { TransactionCategory } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TransactionsService } from './transactions.service';

const PISO = 'piso-pin-01';
const ANA = 'user-ana';
const BRUNO = 'user-bruno';
const CARLA = 'user-carla';

const NOMBRES: Record<string, string> = {
  [ANA]: 'Ana',
  [BRUNO]: 'Bruno',
  [CARLA]: 'Carla',
};

type TransaccionFalsa = {
  apartment_id: string;
  from_user_id: string;
  to_user_id: string;
  amount: number;
  category: TransactionCategory;
};

type FiltroFalso = {
  apartment_id: string;
  from_user_id?: string;
  to_user_id?: string;
};

// `pagador` adelanta `importe` por `deudor`. Cada fila es ya la parte que le toca a una sola
// persona, porque el reparto del gasto entre convivientes se hace al registrarlo.
function gasto(pagador: string, deudor: string, importe: number): TransaccionFalsa {
  return {
    apartment_id: PISO,
    from_user_id: pagador,
    to_user_id: deudor,
    amount: importe,
    category: TransactionCategory.supplies,
  };
}

// Una deuda ya marcada como pagada: el deudor devuelve el dinero al acreedor.
function pago(deudor: string, acreedor: string, importe: number): TransaccionFalsa {
  return {
    apartment_id: PISO,
    from_user_id: deudor,
    to_user_id: acreedor,
    amount: importe,
    category: TransactionCategory.payment,
  };
}

// Postgres guarda los importes como Decimal(12,2), así que este doble suma en céntimos enteros:
// de otro modo aparecerían decimales de coma flotante que la base de datos real nunca devuelve.
function crearPrismaFalso(transacciones: TransaccionFalsa[]) {
  const filtrar = (where: FiltroFalso) =>
    transacciones.filter(
      (transaccion) =>
        transaccion.apartment_id === where.apartment_id &&
        (where.from_user_id === undefined ||
          transaccion.from_user_id === where.from_user_id) &&
        (where.to_user_id === undefined || transaccion.to_user_id === where.to_user_id),
    );

  return {
    transaction: {
      findMany: ({
        where,
        distinct,
      }: {
        where: FiltroFalso;
        distinct: ('from_user_id' | 'to_user_id')[];
      }) => {
        const campo = distinct[0];
        const valores = new Set(filtrar(where).map((transaccion) => transaccion[campo]));

        return Promise.resolve([...valores].map((valor) => ({ [campo]: valor })));
      },

      aggregate: ({ where }: { where: FiltroFalso }) => {
        const filas = filtrar(where);
        // Prisma devuelve null, no 0, cuando no hay ninguna fila que sumar
        const amount =
          filas.length === 0
            ? null
            : filas.reduce((centimos, fila) => centimos + Math.round(fila.amount * 100), 0) /
              100;

        return Promise.resolve({ _sum: { amount } });
      },
    },
  };
}

async function crearServicio(transacciones: TransaccionFalsa[]) {
  const usersService = {
    getUserNames: (ids: string[]) =>
      Promise.resolve(
        Object.fromEntries(ids.filter((id) => NOMBRES[id]).map((id) => [id, NOMBRES[id]])),
      ),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TransactionsService,
      { provide: PrismaService, useValue: crearPrismaFalso(transacciones) },
      { provide: UsersService, useValue: usersService },
    ],
  }).compile();

  return module.get<TransactionsService>(TransactionsService);
}

describe('TransactionsService: cálculo de balances del hogar (UT1002)', () => {
  describe('PA-1002.01: cálculo y optimización exitosa de balances', () => {
    // Ana adelanta una compra de 90€ repartida entre los tres (30€ cada uno) y Bruno paga
    // internet, 60€ entre los tres (20€ cada uno).
    // Balances netos: Ana +40, Bruno +10, Carla -50.
    const GASTOS_DEL_PISO = [
      gasto(ANA, BRUNO, 30),
      gasto(ANA, CARLA, 30),
      gasto(BRUNO, ANA, 20),
      gasto(BRUNO, CARLA, 20),
    ];

    it('calcula los pagos mínimos exactos entre los convivientes', async () => {
      const service = await crearServicio([...GASTOS_DEL_PISO]);

      await expect(service.getPagoMinimo(PISO)).resolves.toEqual([
        { deudorId: CARLA, acreedorId: ANA, monto: 40 },
        { deudorId: CARLA, acreedorId: BRUNO, monto: 10 },
      ]);
    });

    it('cuadra al céntimo: los pagos cancelan el balance de cada conviviente', async () => {
      const service = await crearServicio([...GASTOS_DEL_PISO]);

      const pagos = await service.getPagoMinimo(PISO);
      const balanceEsperado: Record<string, number> = { [ANA]: 40, [BRUNO]: 10, [CARLA]: -50 };

      for (const [usuario, balance] of Object.entries(balanceEsperado)) {
        const cobra = pagos
          .filter((p) => p.acreedorId === usuario)
          .reduce((total, p) => total + p.monto, 0);
        const paga = pagos
          .filter((p) => p.deudorId === usuario)
          .reduce((total, p) => total + p.monto, 0);

        expect(cobra - paga).toBeCloseTo(balance, 2);
      }

      // lo que sale de los deudores es exactamente lo que entra a los acreedores
      expect(pagos.reduce((total, p) => total + p.monto, 0)).toBeCloseTo(50, 2);
    });

    it('aplicar los pagos propuestos deja las cuentas del hogar a cero', async () => {
      const transacciones = [...GASTOS_DEL_PISO];
      const service = await crearServicio(transacciones);

      for (const p of await service.getPagoMinimo(PISO)) {
        transacciones.push(pago(p.deudorId, p.acreedorId, p.monto));
      }

      await expect(service.getPagoMinimo(PISO)).resolves.toEqual([]);
    });

    it('minimiza las transacciones cruzadas: una cadena de deudas se salda con un solo pago', async () => {
      // Ana paga 30€ por Bruno y Bruno paga 30€ por Carla: Bruno queda a cero y desaparece
      const service = await crearServicio([gasto(ANA, BRUNO, 30), gasto(BRUNO, CARLA, 30)]);

      await expect(service.getPagoMinimo(PISO)).resolves.toEqual([
        { deudorId: CARLA, acreedorId: ANA, monto: 30 },
      ]);
    });

    it('anula un ciclo cerrado de deudas sin generar ningún pago', async () => {
      const service = await crearServicio([
        gasto(ANA, BRUNO, 30),
        gasto(BRUNO, CARLA, 30),
        gasto(CARLA, ANA, 30),
      ]);

      await expect(service.getPagoMinimo(PISO)).resolves.toEqual([]);
    });

    it('cuadra al céntimo un gasto que no se puede dividir de forma exacta', async () => {
      // 100€ entre tres: 33,33 para Ana, 33,33 para Bruno y 33,34 para Carla
      const service = await crearServicio([gasto(ANA, BRUNO, 33.33), gasto(ANA, CARLA, 33.34)]);

      const pagos = await service.getPagoMinimo(PISO);

      expect(pagos).toEqual([
        { deudorId: CARLA, acreedorId: ANA, monto: 33.34 },
        { deudorId: BRUNO, acreedorId: ANA, monto: 33.33 },
      ]);
      expect(pagos.reduce((total, p) => total + p.monto, 0)).toBeCloseTo(66.67, 2);
    });

    it('muestra el saldo neto del usuario que debe dinero', async () => {
      const service = await crearServicio([...GASTOS_DEL_PISO]);

      const resumen = await service.getPersonalSummary(PISO, CARLA);

      expect(resumen.miResumen).toEqual({
        esDeudor: true,
        monto: 50,
        conceptos: ['Debes 40€ a Ana', 'Debes 10€ a Bruno'],
      });
      expect(resumen.mensaje).toBe('En total, debes 50.00€ para saldar cuentas.');
    });

    it('muestra el saldo neto del usuario al que le deben dinero', async () => {
      const service = await crearServicio([...GASTOS_DEL_PISO]);

      const resumen = await service.getPersonalSummary(PISO, ANA);

      expect(resumen.miResumen).toEqual({
        esDeudor: false,
        monto: 40,
        conceptos: ['Carla te debe 40€'],
      });
      expect(resumen.mensaje).toBe('En total, tienes 40.00€ pendientes de cobro.');
    });

    it('despliega la lista optimizada de pagos con los nombres de los convivientes', async () => {
      const service = await crearServicio([...GASTOS_DEL_PISO]);

      const resumen = await service.getPersonalSummary(PISO, CARLA);

      expect(resumen.globalPayments).toEqual([
        { deudor: 'Carla', acreedor: 'Ana', monto: 40 },
        { deudor: 'Carla', acreedor: 'Bruno', monto: 10 },
      ]);
    });
  });

  describe('PA-1002.02: cálculo con historial vacío o cuentas saldadas', () => {
    it('un piso recién creado, sin ningún gasto, no devuelve pagos pendientes', async () => {
      const service = await crearServicio([]);

      await expect(service.getPagoMinimo(PISO)).resolves.toEqual([]);
    });

    it('no produce NaN ni Infinity cuando el total de gastos activos es 0€', async () => {
      const service = await crearServicio([]);

      const resumen = await service.getPersonalSummary(PISO, ANA);

      expect(resumen.miResumen.monto).toBe(0);
      expect(Number.isNaN(resumen.miResumen.monto)).toBe(false);
      expect(Number.isFinite(resumen.miResumen.monto)).toBe(true);
    });

    it('muestra el estado vacío y ninguna transacción pendiente', async () => {
      const service = await crearServicio([]);

      const resumen = await service.getPersonalSummary(PISO, ANA);

      expect(resumen.mensaje).toBe('Estás al día en tus pagos.');
      expect(resumen.miResumen.esDeudor).toBe(false);
      expect(resumen.miResumen.conceptos).toEqual([]);
      expect(resumen.globalPayments).toEqual([]);
    });

    it('con todos los gastos anteriores ya pagados, las cuentas quedan a cero', async () => {
      const service = await crearServicio([
        gasto(ANA, BRUNO, 30),
        gasto(ANA, CARLA, 20),
        pago(BRUNO, ANA, 30),
        pago(CARLA, ANA, 20),
      ]);

      await expect(service.getPagoMinimo(PISO)).resolves.toEqual([]);

      const resumen = await service.getPersonalSummary(PISO, ANA);
      expect(resumen.mensaje).toBe('Estás al día en tus pagos.');
      expect(resumen.miResumen.monto).toBe(0);
    });

    it('no genera pagos de 0€ cuando dos convivientes se compensan exactamente', async () => {
      const service = await crearServicio([gasto(ANA, BRUNO, 50), gasto(BRUNO, ANA, 50)]);

      await expect(service.getPagoMinimo(PISO)).resolves.toEqual([]);
    });
  });
});
