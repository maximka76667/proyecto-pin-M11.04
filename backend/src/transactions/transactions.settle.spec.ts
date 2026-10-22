import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, TransactionCategory } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TransactionsService } from './transactions.service';

const PISO = 'piso-1';
const VICENTE = 'user-vicente';
const JOAN = 'user-joan';
const MIEMBROS: Miembro[] = [
  { user_id: VICENTE, apartment_id: PISO },
  { user_id: JOAN, apartment_id: PISO },
];

const YA_AVISADO = 'Ya has avisado de este pago; falta que lo confirme';
const YA_NO_PENDIENTE = 'Este pago ya no está pendiente de confirmar';

type Fila = {
  [campo: string]: unknown;
  id: string;
  apartment_id: string;
  from_user_id: string;
  to_user_id: string;
  amount: string;
  category: TransactionCategory;
};

type Miembro = { user_id: string; apartment_id: string };
type Where = Record<string, unknown>;
type Select = Record<string, boolean>;

// Joan adelanta 42,95 € por Vicente, así que Vicente le debe 42,95 €
function gastoDeJoan(): Fila {
  return {
    id: 'gasto-1',
    apartment_id: PISO,
    from_user_id: JOAN,
    to_user_id: VICENTE,
    amount: '42.95',
    category: TransactionCategory.supplies,
  };
}

// Vicente ya ha avisado de que le ha pagado esa deuda a Joan
function avisoDeVicente(): Fila {
  return {
    id: 'aviso-previo',
    apartment_id: PISO,
    from_user_id: VICENTE,
    to_user_id: JOAN,
    amount: '42.95',
    category: TransactionCategory.pending,
  };
}

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError(`Error simulado ${code}`, {
    code,
    clientVersion: Prisma.prismaVersion.client,
  });
}

// Igualdad y { not: valor }, que es lo que usa el balance para excluir los avisos pendientes
function cumple(fila: Fila, where: Where = {}) {
  return Object.entries(where).every(([campo, condicion]) => {
    if (condicion === undefined) return true;
    if (typeof condicion === 'object' && condicion !== null && 'not' in condicion) {
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

// Base de datos falsa con filas de verdad. Cada operación aplica su efecto en el momento
// en que se llama, así que el orden en que se intercalan dos peticiones simultáneas es
// determinista. update y delete exigen que la fila cumpla todo el where y, si no, lanzan
// P2025 como Prisma: es lo que delata una escritura que no lleva sus condiciones.
function crearBaseFalsa(filas: Fila[], miembros: Miembro[]) {
  const registro: string[] = [];
  const opcionesTransacciones: unknown[] = [];
  let abortarSiguiente = false;
  let siguienteId = 0;

  const indiceQueCumple = (where: Where) => {
    const indice = filas.findIndex((fila) => cumple(fila, where));
    if (indice === -1) throw prismaError('P2025');
    return indice;
  };

  const operaciones = (prefijo: string) => ({
    findMany: ({ where, select, distinct }: { where?: Where; select?: Select; distinct?: string[] }) => {
      registro.push(`${prefijo}findMany`);
      let resultado = filas.filter((fila) => cumple(fila, where));
      if (distinct) {
        const [campo] = distinct;
        const vistos = new Set<unknown>();
        resultado = resultado.filter((fila) => !vistos.has(fila[campo]) && vistos.add(fila[campo]));
      }
      return Promise.resolve(resultado.map((fila) => elegir(fila, select)));
    },
    aggregate: ({ where }: { where?: Where }) => {
      registro.push(`${prefijo}aggregate`);
      const coinciden = filas.filter((fila) => cumple(fila, where));
      // Prisma devuelve null, no 0, cuando no hay filas que sumar
      const amount = coinciden.length
        ? coinciden.reduce((centimos, fila) => centimos + Math.round(Number(fila.amount) * 100), 0) / 100
        : null;
      return Promise.resolve({ _sum: { amount } });
    },
    findFirst: ({ where, select }: { where?: Where; select?: Select }) => {
      registro.push(`${prefijo}findFirst`);
      const fila = filas.find((candidata) => cumple(candidata, where));
      return Promise.resolve(fila ? elegir(fila, select) : null);
    },
    findUnique: ({ where, select }: { where: Where; select?: Select }) => {
      registro.push(`${prefijo}findUnique`);
      const fila = filas.find((candidata) => cumple(candidata, where));
      return Promise.resolve(fila ? elegir(fila, select) : null);
    },
    create: ({ data }: { data: Omit<Fila, 'id'> }) => {
      registro.push(`${prefijo}create`);
      const fila = { id: `aviso-${++siguienteId}`, ...data } as Fila;
      filas.push(fila);
      return Promise.resolve({ ...fila });
    },
    update: ({ where, data }: { where: Where; data: Partial<Fila> }) => {
      registro.push(`${prefijo}update`);
      try {
        const fila = filas[indiceQueCumple(where)];
        Object.assign(fila, data);
        return Promise.resolve({ ...fila });
      } catch (error) {
        return Promise.reject(error as Error);
      }
    },
    delete: ({ where }: { where: Where }) => {
      registro.push(`${prefijo}delete`);
      try {
        const [fila] = filas.splice(indiceQueCumple(where), 1);
        return Promise.resolve({ ...fila });
      } catch (error) {
        return Promise.reject(error as Error);
      }
    },
  });

  const tx = { transaction: operaciones('tx.') };

  const cliente = {
    transaction: operaciones(''),
    userApartment: {
      findUnique: ({ where }: { where: { user_id_apartment_id: Miembro } }) => {
        const { user_id, apartment_id } = where.user_id_apartment_id;
        const miembro = miembros.find(
          (m) => m.user_id === user_id && m.apartment_id === apartment_id,
        );
        return Promise.resolve(miembro ? { user_id } : null);
      },
    },
    $transaction: (fn: (cliente: typeof tx) => Promise<unknown>, opciones?: unknown) => {
      opcionesTransacciones.push(opciones);
      if (abortarSiguiente) {
        abortarSiguiente = false;
        // Así responde Prisma cuando Postgres aborta una transacción Serializable
        // porque otra que corría a la vez leyó y escribió lo mismo
        return Promise.reject(prismaError('P2034'));
      }
      return fn(tx);
    },
  };

  return {
    cliente,
    filas,
    registro,
    opcionesTransacciones,
    abortarSiguienteTransaccion: () => {
      abortarSiguiente = true;
    },
    avisosPendientes: () =>
      filas.filter((fila) => fila.category === TransactionCategory.pending),
  };
}

async function preparar(filasIniciales: Fila[]) {
  const base = crearBaseFalsa(filasIniciales, MIEMBROS);
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TransactionsService,
      { provide: PrismaService, useValue: base.cliente },
      { provide: UsersService, useValue: { getUserNames: jest.fn().mockResolvedValue({}) } },
    ],
  }).compile();

  return { service: module.get<TransactionsService>(TransactionsService), base };
}

function esConflicto(resultado: PromiseSettledResult<unknown>, mensaje: string) {
  expect(resultado.status).toBe('rejected');
  const motivo: unknown = (resultado as PromiseRejectedResult).reason;
  expect(motivo).toBeInstanceOf(ConflictException);
  expect((motivo as ConflictException).message).toBe(mensaje);
}

describe('Saldar deudas con peticiones simultáneas', () => {
  const pagoAJoan = { acreedor_id: JOAN, amount: '42.95' };

  describe('avisos de pago duplicados (markAsPaid)', () => {
    it('crea un único aviso pendiente con el importe que calcula el servidor', async () => {
      const { service, base } = await preparar([gastoDeJoan()]);

      await service.markAsPaid(PISO, VICENTE, pagoAJoan);

      expect(base.avisosPendientes()).toEqual([
        expect.objectContaining({
          apartment_id: PISO,
          from_user_id: VICENTE,
          to_user_id: JOAN,
          amount: '42.95',
        }),
      ]);
    });

    it('comprueba y crea el aviso dentro de una transacción Serializable', async () => {
      const { service, base } = await preparar([gastoDeJoan()]);

      await service.markAsPaid(PISO, VICENTE, pagoAJoan);

      expect(base.opcionesTransacciones).toEqual([
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ]);
      // Si la comprobación o la creación se hicieran fuera de la transacción,
      // Postgres no podría detectar la otra petición simultánea
      expect(base.registro).toEqual(expect.arrayContaining(['tx.findFirst', 'tx.create']));
      expect(base.registro).not.toContain('findFirst');
      expect(base.registro).not.toContain('create');
    });

    it('si Postgres aborta la transacción por otra petición simultánea (P2034), responde 409 y no crea el aviso', async () => {
      const { service, base } = await preparar([gastoDeJoan()]);
      base.abortarSiguienteTransaccion();

      const [resultado] = await Promise.allSettled([
        service.markAsPaid(PISO, VICENTE, pagoAJoan),
      ]);

      esConflicto(resultado, YA_AVISADO);
      expect(base.avisosPendientes()).toEqual([]);
    });

    it('un segundo aviso para la misma deuda da 409 y sigue habiendo uno solo', async () => {
      const { service, base } = await preparar([gastoDeJoan()]);
      await service.markAsPaid(PISO, VICENTE, pagoAJoan);

      const [segundo] = await Promise.allSettled([
        service.markAsPaid(PISO, VICENTE, pagoAJoan),
      ]);

      esConflicto(segundo, YA_AVISADO);
      expect(base.avisosPendientes()).toHaveLength(1);
    });
  });

  describe('confirmar y rechazar el mismo aviso a la vez', () => {
    // Las dos peticiones comprueban el aviso antes de que ninguna escriba: eso es la carrera.
    // Si el test dejara de intercalarlas, fallaría aquí en vez de pasar sin probar nada
    const lasDosComprobaronAntesDeEscribir = (registro: string[]) =>
      expect(registro.slice(0, 2)).toEqual(['findUnique', 'findUnique']);

    it('si confirmar escribe primero, rechazar da 409 y el pago confirmado no se borra', async () => {
      const { service, base } = await preparar([gastoDeJoan(), avisoDeVicente()]);

      const [confirmar, rechazar] = await Promise.allSettled([
        service.confirmPayment('aviso-previo', JOAN),
        service.rejectPayment('aviso-previo', JOAN),
      ]);

      lasDosComprobaronAntesDeEscribir(base.registro);
      expect(confirmar.status).toBe('fulfilled');
      esConflicto(rechazar, YA_NO_PENDIENTE);
      expect(base.filas.find((fila) => fila.id === 'aviso-previo')?.category).toBe(
        TransactionCategory.payment,
      );
    });

    it('si rechazar escribe primero, confirmar da 409 y el aviso queda borrado', async () => {
      const { service, base } = await preparar([gastoDeJoan(), avisoDeVicente()]);

      const [rechazar, confirmar] = await Promise.allSettled([
        service.rejectPayment('aviso-previo', JOAN),
        service.confirmPayment('aviso-previo', JOAN),
      ]);

      lasDosComprobaronAntesDeEscribir(base.registro);
      expect(rechazar.status).toBe('fulfilled');
      esConflicto(confirmar, YA_NO_PENDIENTE);
      expect(base.filas.find((fila) => fila.id === 'aviso-previo')).toBeUndefined();
      expect(
        base.filas.some((fila) => fila.category === TransactionCategory.payment),
      ).toBe(false);
    });
  });
});
