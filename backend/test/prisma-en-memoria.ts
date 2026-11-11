import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

// Prisma en memoria para los tests. Lee prisma/schema.prisma para saber las relaciones, las
// restricciones únicas, los valores por defecto y qué pasa al borrar (onDelete). Así un test
// sigue valiendo si se añade una columna o una tabla, sin tener que tocar este archivo.
//
// Las consultas son perezosas, como las de Prisma: no se ejecutan hasta que alguien las espera
// (await). $transaction([...]) las ejecuta en orden sobre una copia y, si una falla, lo deshace
// todo. Con un jest.fn() normal una transacción no se puede probar, porque cada consulta ya se
// ha aplicado antes de llegar a $transaction.
//
// Uso:
//   const db = crearPrismaEnMemoria();
//   providers: [{ provide: PrismaService, useValue: db.prisma }]
//   db.cargar({ User: [...], Task: [...] });  // filas por modelo, con el nombre de schema.prisma
//   db.filasDe('TaskSwapRequest');             // lo que hay guardado
//   db.alTocar((modelo, fila) => { ... });     // al leer una fila suelta o justo antes de cambiarla

export type Fila = Record<string, unknown>;
type Args = {
  where?: Fila;
  data?: Fila;
  select?: Fila;
  include?: Fila;
  orderBy?: unknown;
  take?: number;
  skip?: number;
  create?: Fila;
  update?: Fila;
};
type Campo = { tipo: string; lista: boolean; opcional: boolean; atributos: string };
type Modelo = {
  campos: Map<string, Campo>;
  unicas: string[][];
  porDefecto: Map<string, () => unknown>;
};
type Relacion =
  | { modelo: string; tipo: 'uno'; clave: string }
  | { modelo: string; tipo: 'unoInverso' | 'muchos'; campo: string };

// ─── Lo que se lee de schema.prisma ───────────────────────────────────────────────────────

const ESQUEMA = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8');
const MODELOS = new Map<string, Modelo>();

function valorPorDefecto(expresion: string): (() => unknown) | undefined {
  if (/^(uuid|cuid)\(\)$/.test(expresion) || expresion.startsWith('dbgenerated')) {
    return () => randomUUID();
  }
  if (expresion === 'now()') return () => new Date();
  if (/^".*"$/.test(expresion)) return () => expresion.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(expresion)) return () => Number(expresion);
  if (expresion === 'true' || expresion === 'false') return () => expresion === 'true';
  if (/^\w+$/.test(expresion)) return () => expresion; // valor de un enum
  return undefined;
}

for (const [, nombre, cuerpo] of ESQUEMA.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
  const modelo: Modelo = { campos: new Map(), unicas: [], porDefecto: new Map() };
  for (const lineaOriginal of cuerpo.split('\n')) {
    const linea = lineaOriginal.replace(/\/\/.*$/, '').trim();
    const compuesta = linea.match(/^@@(?:id|unique)\(\[([^\]]+)\]/);
    if (compuesta) modelo.unicas.push(compuesta[1].split(',').map((c) => c.trim()));
    const partes = linea.match(/^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/);
    if (!partes) continue;
    const [, campo, tipo, lista, opcional, atributos] = partes;
    modelo.campos.set(campo, {
      tipo,
      lista: Boolean(lista),
      opcional: Boolean(opcional),
      atributos,
    });
    if (/@(id|unique)\b/.test(atributos)) modelo.unicas.push([campo]);
    const porDefecto = atributos.match(/@default\(((?:[^()]|\([^()]*\))*)\)/)?.[1];
    const generar = porDefecto === undefined ? undefined : valorPorDefecto(porDefecto);
    if (generar) modelo.porDefecto.set(campo, generar);
  }
  MODELOS.set(nombre, modelo);
}

const nombreDeRelacion = (atributos: string) =>
  atributos.match(/@relation\(\s*(?:name:\s*)?"([^"]+)"/)?.[1];
const clavesForaneas = (atributos: string) =>
  atributos
    .match(/fields:\s*\[([^\]]+)\]/)?.[1]
    .split(',')
    .map((c) => c.trim());

function relacion(modelo: string, campo: string): Relacion | undefined {
  const definicion = MODELOS.get(modelo)?.campos.get(campo);
  const destino = definicion && MODELOS.get(definicion.tipo);
  if (!definicion || !destino) return undefined;
  const claves = clavesForaneas(definicion.atributos);
  if (claves) return { modelo: definicion.tipo, tipo: 'uno', clave: claves[0] };
  const nombre = nombreDeRelacion(definicion.atributos);
  const inversa = [...destino.campos.values()].find(
    (otro) =>
      otro.tipo === modelo &&
      clavesForaneas(otro.atributos) !== undefined &&
      nombreDeRelacion(otro.atributos) === nombre,
  );
  const claveInversa = inversa && clavesForaneas(inversa.atributos)?.[0];
  if (!claveInversa) return undefined;
  return {
    modelo: definicion.tipo,
    tipo: definicion.lista ? 'muchos' : 'unoInverso',
    campo: claveInversa,
  };
}

// ─── Comparar, ordenar y escribir valores ─────────────────────────────────────────────────

const esObjeto = (valor: unknown): valor is Fila =>
  valor !== null && typeof valor === 'object' && !(valor instanceof Date) && !Array.isArray(valor);

function mismoValor(a: unknown, b: unknown) {
  if (a == null || b == null) return a == null && b == null;
  if (a instanceof Date || b instanceof Date) {
    return new Date(a as string).getTime() === new Date(b as string).getTime();
  }
  return a === b;
}

const OPERADORES = new Set([
  'equals', 'in', 'notIn', 'not', 'lt', 'lte', 'gt', 'gte', 'contains', 'startsWith', 'endsWith', 'mode',
]);

function cumple(valor: unknown, condicion: unknown): boolean {
  if (!esObjeto(condicion) || !Object.keys(condicion).every((k) => OPERADORES.has(k))) {
    return mismoValor(valor, condicion);
  }
  const numero = (x: unknown) => (x instanceof Date ? x.getTime() : (x as number));
  return Object.entries(condicion).every(([operador, esperado]) => {
    switch (operador) {
      case 'equals': return mismoValor(valor, esperado);
      case 'in': return (esperado as unknown[]).some((e) => mismoValor(valor, e));
      case 'notIn': return !(esperado as unknown[]).some((e) => mismoValor(valor, e));
      case 'not': return !cumple(valor, esperado);
      case 'lt': return valor != null && numero(valor) < numero(esperado);
      case 'lte': return valor != null && numero(valor) <= numero(esperado);
      case 'gt': return valor != null && numero(valor) > numero(esperado);
      case 'gte': return valor != null && numero(valor) >= numero(esperado);
      case 'contains': return typeof valor === 'string' && valor.includes(esperado as string);
      case 'startsWith': return typeof valor === 'string' && valor.startsWith(esperado as string);
      case 'endsWith': return typeof valor === 'string' && valor.endsWith(esperado as string);
      default: return true;
    }
  });
}

function ordenar(filas: Fila[], orderBy: unknown): Fila[] {
  const criterios = ([] as Fila[]).concat((orderBy as Fila | Fila[] | undefined) ?? []);
  return [...filas].sort((a, b) => {
    for (const criterio of criterios) {
      for (const [campo, sentido] of Object.entries(criterio)) {
        const [x, y] = [a[campo], b[campo]];
        if (mismoValor(x, y)) continue;
        if (x == null) return 1;
        if (y == null) return -1;
        const valor = (v: unknown) => (v instanceof Date ? v.getTime() : (v as number));
        return (valor(x) < valor(y) ? -1 : 1) * (sentido === 'desc' ? -1 : 1);
      }
    }
    return 0;
  });
}

const copia = (valor: unknown) => (valor instanceof Date ? new Date(valor) : valor);

function errorDePrisma(code: string, mensaje: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(mensaje, { code, clientVersion: '5.22.0', meta });
}

function aplicarDatos(modelo: string, fila: Fila, data: Fila = {}) {
  for (const [campo, valor] of Object.entries(data)) {
    if (valor === undefined) continue;
    const rel = relacion(modelo, campo);
    if (rel) {
      const conectar = esObjeto(valor) && esObjeto(valor.connect) ? valor.connect.id : undefined;
      if (rel.tipo === 'uno' && conectar !== undefined) fila[rel.clave] = conectar;
      continue;
    }
    if (esObjeto(valor) && 'set' in valor) fila[campo] = valor.set;
    else if (esObjeto(valor) && typeof valor.increment === 'number') {
      fila[campo] = Number(fila[campo] ?? 0) + valor.increment;
    } else if (esObjeto(valor) && typeof valor.decrement === 'number') {
      fila[campo] = Number(fila[campo] ?? 0) - valor.decrement;
    } else fila[campo] = valor;
  }
  return fila;
}

const EJECUTAR = Symbol('ejecutar');

function perezosa<T>(accion: () => T) {
  let promesa: Promise<T> | undefined;
  const ejecutar = () => (promesa ??= new Promise<T>((resolve) => resolve(accion())));
  return {
    [EJECUTAR]: ejecutar,
    // Es justo lo que hace PrismaPromise: un objeto con then que solo se ejecuta al esperarlo
    // oxlint-disable-next-line unicorn/no-thenable
    then<A = T, B = never>(
      alCumplir?: ((valor: T) => A | PromiseLike<A>) | null,
      alFallar?: ((motivo: unknown) => B | PromiseLike<B>) | null,
    ) {
      return ejecutar().then(alCumplir, alFallar);
    },
    catch<B = never>(alFallar?: ((motivo: unknown) => B | PromiseLike<B>) | null) {
      return ejecutar().catch(alFallar);
    },
    finally(alTerminar?: (() => void) | null) {
      return ejecutar().finally(alTerminar);
    },
  };
}

// ─── La base de datos ─────────────────────────────────────────────────────────────────────

export function crearPrismaEnMemoria() {
  let tablas: Record<string, Fila[]> = {};
  let alTocarFila: ((modelo: string, fila: Fila) => void) | undefined;
  const filasDe = (modelo: string) => (tablas[modelo] ??= []);

  function relacionadas(fila: Fila, rel: Relacion): Fila[] {
    if (rel.tipo === 'uno') {
      return fila[rel.clave] == null
        ? []
        : filasDe(rel.modelo).filter((otra) => mismoValor(otra.id, fila[rel.clave]));
    }
    return filasDe(rel.modelo).filter((otra) => mismoValor(otra[rel.campo], fila.id));
  }

  function coincideRelacion(fila: Fila, rel: Relacion, condicion: unknown): boolean {
    const otras = relacionadas(fila, rel);
    if (rel.tipo === 'muchos') {
      const { some, none, every } = condicion as { some?: Fila; none?: Fila; every?: Fila };
      if (some) return otras.some((otra) => coincide(rel.modelo, otra, some));
      if (none) return !otras.some((otra) => coincide(rel.modelo, otra, none));
      if (every) return otras.every((otra) => coincide(rel.modelo, otra, every));
      return true;
    }
    if (condicion === null) return otras.length === 0;
    const filtro = condicion as Fila;
    if ('is' in filtro) {
      return filtro.is === null
        ? otras.length === 0
        : otras.length > 0 && coincide(rel.modelo, otras[0], filtro.is as Fila);
    }
    if ('isNot' in filtro) {
      return filtro.isNot === null
        ? otras.length > 0
        : !(otras.length > 0 && coincide(rel.modelo, otras[0], filtro.isNot as Fila));
    }
    return otras.length > 0 && coincide(rel.modelo, otras[0], filtro);
  }

  function coincide(modelo: string, fila: Fila, where?: Fila): boolean {
    if (!where) return true;
    return Object.entries(where).every(([campo, condicion]) => {
      if (condicion === undefined) return true;
      if (campo === 'AND') {
        return ([] as Fila[]).concat(condicion as Fila).every((w) => coincide(modelo, fila, w));
      }
      if (campo === 'OR') return (condicion as Fila[]).some((w) => coincide(modelo, fila, w));
      if (campo === 'NOT') {
        return !([] as Fila[]).concat(condicion as Fila).some((w) => coincide(modelo, fila, w));
      }
      const rel = relacion(modelo, campo);
      if (rel) return coincideRelacion(fila, rel, condicion);
      // Clave compuesta, p. ej. user_id_apartment_id: { user_id, apartment_id }
      if (!MODELOS.get(modelo)?.campos.has(campo) && esObjeto(condicion)) {
        return coincide(modelo, fila, condicion);
      }
      return cumple(fila[campo], condicion);
    });
  }

  function resolver(fila: Fila, rel: Relacion, args: Args) {
    const otras = relacionadas(fila, rel);
    if (rel.tipo !== 'muchos') return otras[0] ? proyectar(rel.modelo, otras[0], args) : null;
    let lista = ordenar(otras.filter((otra) => coincide(rel.modelo, otra, args.where)), args.orderBy);
    if (args.skip) lista = lista.slice(args.skip);
    if (args.take !== undefined) lista = lista.slice(0, args.take);
    return lista.map((otra) => proyectar(rel.modelo, otra, args));
  }

  function proyectar(modelo: string, fila: Fila, args: Args = {}): Fila {
    const salida: Fila = {};
    if (args.select) {
      for (const [campo, valor] of Object.entries(args.select)) {
        if (!valor) continue;
        const rel = relacion(modelo, campo);
        salida[campo] = rel
          ? resolver(fila, rel, valor === true ? {} : (valor as Args))
          : copia(fila[campo]);
      }
      return salida;
    }
    for (const [campo, valor] of Object.entries(fila)) salida[campo] = copia(valor);
    for (const [campo, valor] of Object.entries(args.include ?? {})) {
      const rel = valor ? relacion(modelo, campo) : undefined;
      if (rel) salida[campo] = resolver(fila, rel, valor === true ? {} : (valor as Args));
    }
    return salida;
  }

  // NULL nunca choca con nada, como en PostgreSQL
  function comprobarUnicas(modelo: string, fila: Fila, ignorar?: Fila) {
    for (const campos of MODELOS.get(modelo)?.unicas ?? []) {
      if (campos.some((c) => fila[c] == null)) continue;
      const choca = filasDe(modelo).some(
        (otra) => otra !== ignorar && campos.every((c) => mismoValor(otra[c], fila[c])),
      );
      if (choca) {
        throw errorDePrisma('P2002', `Unique constraint failed on the fields: (${campos.join(',')})`, {
          target: campos,
        });
      }
    }
  }

  function insertar(modelo: string, data: Fila = {}) {
    const definicion = MODELOS.get(modelo);
    const fila: Fila = {};
    for (const [campo, generar] of definicion?.porDefecto ?? []) fila[campo] = generar();
    aplicarDatos(modelo, fila, data);
    for (const [campo, { tipo }] of definicion?.campos ?? []) {
      if (!MODELOS.has(tipo) && fila[campo] === undefined) fila[campo] = null;
    }
    comprobarUnicas(modelo, fila);
    filasDe(modelo).push(fila);
    return fila;
  }

  // onDelete de cada relación: Cascade borra, SetNull vacía la clave y el resto (Restrict) falla
  function borrar(modelo: string, fila: Fila) {
    const efectos: Array<() => void> = [];
    for (const [otroModelo, definicion] of MODELOS) {
      for (const campo of definicion.campos.values()) {
        const clave = clavesForaneas(campo.atributos)?.[0];
        if (campo.tipo !== modelo || !clave) continue;
        const afectadas = filasDe(otroModelo).filter((otra) => mismoValor(otra[clave], fila.id));
        if (afectadas.length === 0) continue;
        const alBorrar =
          campo.atributos.match(/onDelete:\s*(\w+)/)?.[1] ?? (campo.opcional ? 'SetNull' : 'Restrict');
        if (alBorrar === 'Cascade') {
          efectos.push(() => afectadas.forEach((otra) => borrar(otroModelo, otra)));
        } else if (alBorrar === 'SetNull') {
          efectos.push(() => afectadas.forEach((otra) => (otra[clave] = null)));
        } else {
          throw errorDePrisma('P2003', `Foreign key constraint failed on the field: ${clave}`, {
            field_name: clave,
          });
        }
      }
    }
    efectos.forEach((efecto) => efecto());
    const filas = filasDe(modelo);
    const posicion = filas.indexOf(fila);
    if (posicion >= 0) filas.splice(posicion, 1);
  }

  function crearModelo(modelo: string) {
    const buscar = (where?: Fila) => filasDe(modelo).filter((fila) => coincide(modelo, fila, where));
    const leer = (fila: Fila | undefined, args: Args) => {
      if (!fila) return null;
      const resultado = proyectar(modelo, fila, args);
      alTocarFila?.(modelo, fila);
      return resultado;
    };
    // Antes de cambiar o borrar: así un test puede simular que otra persona se adelanta,
    // tanto si el código lee la fila antes como si la cambia directamente
    const tocar = (where?: Fila) => buscar(where).forEach((fila) => alTocarFila?.(modelo, fila));
    const obligatoria = (fila: Fila | undefined) => {
      if (!fila) throw errorDePrisma('P2025', 'No record was found for a query.');
      return fila;
    };

    return {
      findUnique: jest.fn((args: Args) => perezosa(() => leer(buscar(args.where)[0], args))),
      findUniqueOrThrow: jest.fn((args: Args) =>
        perezosa(() => leer(obligatoria(buscar(args.where)[0]), args)),
      ),
      findFirst: jest.fn((args: Args = {}) =>
        perezosa(() => leer(ordenar(buscar(args.where), args.orderBy)[0], args)),
      ),
      findFirstOrThrow: jest.fn((args: Args = {}) =>
        perezosa(() => leer(obligatoria(ordenar(buscar(args.where), args.orderBy)[0]), args)),
      ),
      findMany: jest.fn((args: Args = {}) =>
        perezosa(() => {
          let filas = ordenar(buscar(args.where), args.orderBy);
          if (args.skip) filas = filas.slice(args.skip);
          if (args.take !== undefined) filas = filas.slice(0, args.take);
          return filas.map((fila) => proyectar(modelo, fila, args));
        }),
      ),
      count: jest.fn((args: Args = {}) => perezosa(() => buscar(args.where).length)),
      create: jest.fn((args: Args) => perezosa(() => proyectar(modelo, insertar(modelo, args.data), args))),
      createMany: jest.fn((args: { data: Fila | Fila[]; skipDuplicates?: boolean }) =>
        perezosa(() => {
          let count = 0;
          for (const data of ([] as Fila[]).concat(args.data)) {
            try {
              insertar(modelo, data);
              count += 1;
            } catch (error) {
              const repetida = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
              if (!(args.skipDuplicates && repetida)) throw error;
            }
          }
          return { count };
        }),
      ),
      upsert: jest.fn((args: Args) =>
        perezosa(() => {
          tocar(args.where);
          const fila = buscar(args.where)[0];
          if (!fila) return proyectar(modelo, insertar(modelo, args.create), args);
          const nueva = aplicarDatos(modelo, { ...fila }, args.update);
          comprobarUnicas(modelo, nueva, fila);
          Object.assign(fila, nueva);
          return proyectar(modelo, fila, args);
        }),
      ),
      update: jest.fn((args: Args) =>
        perezosa(() => {
          tocar(args.where);
          const fila = buscar(args.where)[0];
          if (!fila) throw errorDePrisma('P2025', 'Record to update not found.');
          const nueva = aplicarDatos(modelo, { ...fila }, args.data);
          comprobarUnicas(modelo, nueva, fila);
          Object.assign(fila, nueva);
          return proyectar(modelo, fila, args);
        }),
      ),
      updateMany: jest.fn((args: Args) =>
        perezosa(() => {
          tocar(args.where);
          const filas = buscar(args.where);
          for (const fila of filas) {
            const nueva = aplicarDatos(modelo, { ...fila }, args.data);
            comprobarUnicas(modelo, nueva, fila);
            Object.assign(fila, nueva);
          }
          return { count: filas.length };
        }),
      ),
      delete: jest.fn((args: Args) =>
        perezosa(() => {
          tocar(args.where);
          const fila = buscar(args.where)[0];
          if (!fila) throw errorDePrisma('P2025', 'Record to delete does not exist.');
          const resultado = proyectar(modelo, fila, args);
          borrar(modelo, fila);
          return resultado;
        }),
      ),
      deleteMany: jest.fn((args: Args = {}) =>
        perezosa(() => {
          tocar(args.where);
          const filas = buscar(args.where);
          filas.forEach((fila) => borrar(modelo, fila));
          return { count: filas.length };
        }),
      ),
    };
  }

  const prisma: Record<string, any> = Object.fromEntries(
    [...MODELOS.keys()].map((modelo) => [modelo[0].toLowerCase() + modelo.slice(1), crearModelo(modelo)]),
  );

  // Lista de operaciones (en orden) o función interactiva; si algo falla no queda nada a medias
  prisma.$transaction = jest.fn(async (operaciones: unknown) => {
    const copiaDeSeguridad = structuredClone(tablas);
    try {
      if (typeof operaciones === 'function') {
        return (await (operaciones as (tx: unknown) => Promise<unknown>)(prisma)) as unknown;
      }
      const resultados: unknown[] = [];
      for (const operacion of operaciones as Array<PromiseLike<unknown> & { [EJECUTAR]?: () => Promise<unknown> }>) {
        resultados.push(await (operacion[EJECUTAR]?.() ?? operacion));
      }
      return resultados;
    } catch (error) {
      tablas = copiaDeSeguridad;
      throw error;
    }
  });

  return {
    prisma,
    filasDe,
    // Sustituye todas las tablas; las claves son los nombres de modelo de schema.prisma
    cargar(datos: Record<string, Fila[]>) {
      tablas = datos;
    },
    // Se llama después de leer una fila suelta (findUnique / findFirst) y antes de cambiarla o
    // borrarla (update, updateMany, upsert, delete, deleteMany)
    alTocar(funcion?: (modelo: string, fila: Fila) => void) {
      alTocarFila = funcion;
    },
  };
}
