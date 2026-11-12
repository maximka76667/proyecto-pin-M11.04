import { randomUUID } from 'node:crypto';
import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

// Se sustituye el SMTP de Gmail para comprobar el correo sin mandarlo
const sendMail = jest.fn(async () => ({ messageId: 'id-de-prueba' }));
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail, verify: jest.fn(async () => true) })),
}));

// PA-1014.06: Verificación del email al crear una cuenta.
//
// La funcionalidad todavía no existe, así que estas pruebas no dan por hecho cómo se va a
// guardar: ni el nombre de la tabla del token ni el de la columna de «verificado». Por eso
// la base de datos es un Prisma falso genérico (cualquier modelo, filas en memoria) y el
// correo es un MailService falso que acepta cualquier método. Las pruebas solo miran lo que
// ve el usuario: el enlace que llega en el correo, la página que abre y si puede entrar.
//
// Únicos supuestos: el enlace va dentro de los argumentos del método del MailService que lo
// envíe (por ejemplo sendEmailVerification(email, enlace)) y apunta al backend, que responde
// con una página HTML.

type Fila = Record<string, unknown>;
const tablas = new Map<string, Fila[]>();

const OPERADORES = ['gt', 'gte', 'lt', 'lte', 'not', 'equals', 'in'];

function mismoValor(a: unknown, b: unknown) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function cumple(valor: unknown, condicion: unknown): boolean {
  const esFiltro =
    condicion !== null &&
    typeof condicion === 'object' &&
    !(condicion instanceof Date) &&
    Object.keys(condicion).every((k) => OPERADORES.includes(k));
  if (!esFiltro) return mismoValor(valor, condicion);

  return Object.entries(condicion as Record<string, unknown>).every(([op, esperado]) => {
    const n = (x: unknown) => (x instanceof Date ? x.getTime() : (x as number));
    switch (op) {
      case 'gt': return valor != null && n(valor) > n(esperado);
      case 'gte': return valor != null && n(valor) >= n(esperado);
      case 'lt': return valor != null && n(valor) < n(esperado);
      case 'lte': return valor != null && n(valor) <= n(esperado);
      case 'not': return !cumple(valor, esperado);
      case 'in': return (esperado as unknown[]).some((e) => mismoValor(valor, e));
      default: return mismoValor(valor, esperado);
    }
  });
}

function coincide(fila: Fila, where: Fila = {}): boolean {
  return Object.entries(where).every(([campo, condicion]) => {
    if (campo === 'AND') return (condicion as Fila[]).every((w) => coincide(fila, w));
    if (campo === 'OR') return (condicion as Fila[]).some((w) => coincide(fila, w));
    if (campo === 'NOT') return !coincide(fila, condicion as Fila);
    return cumple(fila[campo], condicion);
  });
}

// Aplica un data de Prisma, incluidos { increment } y { set }
function aplicar(fila: Fila, data: Fila) {
  for (const [campo, valor] of Object.entries(data)) {
    if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
      const op = valor as { increment?: number; decrement?: number; set?: unknown };
      if (op.increment !== undefined) fila[campo] = ((fila[campo] as number) ?? 0) + op.increment;
      else if (op.decrement !== undefined) fila[campo] = ((fila[campo] as number) ?? 0) - op.decrement;
      else if ('set' in op) fila[campo] = op.set;
      else fila[campo] = valor;
    } else {
      fila[campo] = valor;
    }
  }
  return fila;
}

function errorDePrisma(codigo: string) {
  return Object.assign(new Error(`Prisma ${codigo}`), { code: codigo });
}

function crearModelo(nombre: string) {
  const filas = () => {
    if (!tablas.has(nombre)) tablas.set(nombre, []);
    return tablas.get(nombre)!;
  };
  // Las relaciones que pida un select (p. ej. user_apartments) se devuelven vacías
  const conRelaciones = (fila: Fila, args?: { select?: Fila; include?: Fila }) => {
    const copia: Fila = { ...fila };
    for (const campo of Object.keys({ ...args?.select, ...args?.include })) {
      if (!(campo in copia)) copia[campo] = [];
    }
    return copia;
  };
  const crear = (data: Fila) => {
    const fila: Fila = { id: randomUUID(), created_at: new Date(), ...data };
    if (nombre === 'user' && filas().some((f) => f.email && f.email === fila.email)) {
      throw errorDePrisma('P2002');
    }
    filas().push(fila);
    return fila;
  };

  return {
    findUnique: jest.fn(async (args: { where: Fila; select?: Fila }) => {
      const fila = filas().find((f) => coincide(f, args.where));
      return fila ? conRelaciones(fila, args) : null;
    }),
    findFirst: jest.fn(async (args: { where?: Fila; select?: Fila } = {}) => {
      const fila = filas().find((f) => coincide(f, args.where));
      return fila ? conRelaciones(fila, args) : null;
    }),
    findMany: jest.fn(async (args: { where?: Fila } = {}) =>
      filas().filter((f) => coincide(f, args.where)).map((f) => ({ ...f })),
    ),
    count: jest.fn(async (args: { where?: Fila } = {}) => filas().filter((f) => coincide(f, args.where)).length),
    create: jest.fn(async (args: { data: Fila; select?: Fila }) => conRelaciones(crear(args.data), args)),
    update: jest.fn(async (args: { where: Fila; data: Fila; select?: Fila }) => {
      const fila = filas().find((f) => coincide(f, args.where));
      if (!fila) throw errorDePrisma('P2025');
      return conRelaciones(aplicar(fila, args.data), args);
    }),
    updateMany: jest.fn(async (args: { where?: Fila; data: Fila }) => {
      const afectadas = filas().filter((f) => coincide(f, args.where));
      afectadas.forEach((f) => aplicar(f, args.data));
      return { count: afectadas.length };
    }),
    upsert: jest.fn(async (args: { where: Fila; create: Fila; update: Fila; select?: Fila }) => {
      const fila = filas().find((f) => coincide(f, args.where));
      return conRelaciones(fila ? aplicar(fila, args.update) : crear(args.create), args);
    }),
    delete: jest.fn(async (args: { where: Fila }) => {
      const i = filas().findIndex((f) => coincide(f, args.where));
      if (i < 0) throw errorDePrisma('P2025');
      return filas().splice(i, 1)[0];
    }),
    deleteMany: jest.fn(async (args: { where?: Fila } = {}) => {
      const quedan = filas().filter((f) => !coincide(f, args.where));
      const count = filas().length - quedan.length;
      tablas.set(nombre, quedan);
      return { count };
    }),
  };
}

// Propiedades que Nest o Jest consultan en cualquier objeto y que no son modelos
const NO_SON_MODELOS = new Set([
  'then', 'constructor', 'toJSON', 'asymmetricMatch', 'nodeType', 'tagName',
  'onModuleInit', 'onModuleDestroy', 'onApplicationBootstrap',
  'beforeApplicationShutdown', 'onApplicationShutdown',
]);
const modelos = new Map<string, ReturnType<typeof crearModelo>>();

const prisma: Record<string, unknown> = new Proxy(
  {},
  {
    get(_objetivo, propiedad) {
      if (typeof propiedad !== 'string' || NO_SON_MODELOS.has(propiedad)) return undefined;
      if (propiedad === '$transaction') {
        return async (operaciones: unknown) =>
          typeof operaciones === 'function' ? operaciones(prisma) : Promise.all(operaciones as Promise<unknown>[]);
      }
      if (propiedad.startsWith('$')) return jest.fn();
      if (!modelos.has(propiedad)) modelos.set(propiedad, crearModelo(propiedad));
      return modelos.get(propiedad);
    },
  },
);

// MailService falso: cualquier método existe y queda registrado con sus argumentos
const correos: { metodo: string; args: unknown[] }[] = [];
const mail: Record<string, unknown> = new Proxy(
  {},
  {
    get(_objetivo, propiedad) {
      if (typeof propiedad !== 'string' || NO_SON_MODELOS.has(propiedad)) return undefined;
      return jest.fn(async (...args: unknown[]) => {
        correos.push({ metodo: propiedad, args });
        return true;
      });
    },
  },
);

const CONFIG: Record<string, string> = {
  JWT_SECRET: 'clave-jwt-de-pruebas',
  GOOGLE_CLIENT_ID: 'cliente-google',
  GOOGLE_CLIENT_SECRET: 'secreto-google',
  GOOGLE_AUTH_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
  FRONTEND_URL: 'http://localhost:8081',
};
const config = {
  get: jest.fn((clave: string) => CONFIG[clave]),
  getOrThrow: jest.fn((clave: string) => {
    if (!(clave in CONFIG)) throw new Error(`Falta ${clave}`);
    return CONFIG[clave];
  }),
};

// Solo se falsea Date; los temporizadores de supertest siguen reales (como en availability.spec.ts)
const SOLO_DATE = {
  doNotFake: [
    'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame',
    'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate',
    'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
  ],
} as const;

const NUEVA = { full_name: 'Alex Morgan', email: 'alex@ejemplo.com', password: 'Clave1234' };

describe('PA-1014.06 · verificación del email al crear una cuenta', () => {
  let app: INestApplication<App>;
  let auth: AuthService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: MailService, useValue: mail },
      ],
    }).compile();

    auth = module.get(AuthService);
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    tablas.clear();
    correos.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const servidor = () => request(app.getHttpServer());
  const registrar = (body: object = NUEVA) => servidor().post('/auth/register').send(body);
  const entrar = (email = NUEVA.email, password = NUEVA.password) =>
    servidor().post('/auth/login').send({ email, password });

  // El enlace que ha recibido ese email en el último correo
  function enlaceRecibido(email = NUEVA.email): URL {
    for (const correo of [...correos].reverse()) {
      if (!correo.args.includes(email)) continue;
      for (const arg of correo.args) {
        const url = typeof arg === 'string' ? arg.match(/https?:\/\/\S+/)?.[0] : undefined;
        if (url) return new URL(url);
      }
    }
    throw new Error(`No se ha enviado ningún correo con un enlace a ${email}`);
  }

  // El token es el valor más largo del enlace: un parámetro de la URL o el último tramo
  function tokenDelEnlace(enlace: URL) {
    const candidatos = [...enlace.searchParams.values(), enlace.pathname.split('/').pop() ?? ''];
    return candidatos.sort((a, b) => b.length - a.length)[0];
  }

  const abrir = (enlace: URL) => servidor().get(`${enlace.pathname}${enlace.search}`);

  describe('paso 2: pulsar «Crear cuenta»', () => {
    it('crea la cuenta y responde 201, pero sin token ni sesión abierta', async () => {
      const response = await registrar();

      expect(response.status).toBe(201);
      expect(response.body.token).toBeUndefined();
      expect(tablas.get('user')).toEqual([expect.objectContaining({ email: NUEVA.email })]);
      expect(tablas.get('authSession') ?? []).toHaveLength(0);
    });

    it('manda un correo con el enlace de confirmación a ese email', async () => {
      await registrar().expect(201);

      expect(() => enlaceRecibido()).not.toThrow();
    });
  });

  describe('paso 3: intentar entrar antes de abrir el correo', () => {
    it('no entra y responde «Tienes que confirmar tu email antes de entrar»', async () => {
      await registrar().expect(201);

      const response = await entrar();

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.token).toBeUndefined();
      expect(response.body.message).toBe('Tienes que confirmar tu email antes de entrar');
    });

    it('con la contraseña mal no revela que la cuenta existe y está sin confirmar', async () => {
      await registrar().expect(201);

      const response = await entrar(NUEVA.email, 'Equivocada1');

      expect(response.status).toBe(401);
      expect(JSON.stringify(response.body)).not.toMatch(/confirm/i);
    });
  });

  describe('el enlace', () => {
    it('lleva un token aleatorio: ni el id del usuario ni el email', async () => {
      await registrar().expect(201);
      await registrar({ ...NUEVA, email: 'otra@ejemplo.com' }).expect(201);

      const enlace = enlaceRecibido().toString();
      const usuario = tablas.get('user')!.find((u) => u.email === NUEVA.email)!;
      expect(enlace).not.toContain(String(usuario.id));
      expect(decodeURIComponent(enlace)).not.toContain(NUEVA.email);
      expect(tokenDelEnlace(enlaceRecibido())).not.toBe(tokenDelEnlace(enlaceRecibido('otra@ejemplo.com')));
      expect(tokenDelEnlace(enlaceRecibido()).length).toBeGreaterThanOrEqual(32);
    });

    it('el servidor guarda el token cifrado, nunca en claro', async () => {
      await registrar().expect(201);

      const token = tokenDelEnlace(enlaceRecibido());
      const todo = JSON.stringify([...tablas.entries()]);
      expect(todo).not.toContain(token);
    });

    it('un enlace con el token cambiado no confirma nada', async () => {
      await registrar().expect(201);
      const enlace = enlaceRecibido();
      const token = tokenDelEnlace(enlace);
      const falso = new URL(enlace.toString().replace(token, 'a'.repeat(token.length)));

      const pagina = await abrir(falso);

      expect(pagina.text).not.toContain('Email confirmado');
      expect((await entrar()).body.token).toBeUndefined();
    });
  });

  describe('paso 5: pulsar «Confirmar mi email»', () => {
    it('abre una página «Email confirmado. Ya puedes volver a Room8»', async () => {
      await registrar().expect(201);

      const pagina = await abrir(enlaceRecibido());

      expect(pagina.status).toBe(200);
      expect(pagina.headers['content-type']).toMatch(/text\/html/);
      expect(pagina.text).toContain('Email confirmado. Ya puedes volver a Room8');
    });
  });

  describe('paso 6: volver a la app y entrar', () => {
    it('entra con la sesión iniciada, y puede cerrar sesión y volver a entrar sin confirmar nada', async () => {
      await registrar().expect(201);
      await abrir(enlaceRecibido()).expect(200);

      const primera = await entrar();
      expect(primera.body.token).toEqual(expect.any(String));

      await servidor().post('/auth/logout').set('Authorization', `Bearer ${primera.body.token}`).expect(201);

      const segunda = await entrar();
      expect(segunda.body.token).toEqual(expect.any(String));
      expect(segunda.body.token).not.toBe(primera.body.token);
    });
  });

  describe('paso 7: volver a pulsar el mismo enlace', () => {
    it('la página dice «Este enlace ya se ha usado» y la cuenta sigue verificada', async () => {
      await registrar().expect(201);
      const enlace = enlaceRecibido();
      await abrir(enlace).expect(200);
      const usuarioAntes = { ...tablas.get('user')![0] };

      const segunda = await abrir(enlace);

      expect(segunda.text).toContain('Este enlace ya se ha usado');
      expect(segunda.text).not.toContain('Email confirmado');
      expect(tablas.get('user')![0]).toEqual(usuarioAntes);
      expect((await entrar()).body.token).toEqual(expect.any(String));
    });
  });

  describe('caducidad', () => {
    it('el enlace caduca a las 24 horas: después ya no confirma y sigue sin poder entrar', async () => {
      jest.useFakeTimers({ doNotFake: [...SOLO_DATE.doNotFake], now: new Date('2026-11-10T09:00:00.000Z') });
      await registrar().expect(201);
      const enlace = enlaceRecibido();

      jest.setSystemTime(new Date('2026-11-11T09:01:00.000Z'));
      const pagina = await abrir(enlace);

      expect(pagina.text).not.toContain('Email confirmado');
      const response = await entrar();
      expect(response.body.token).toBeUndefined();
    });

    it('antes de las 24 horas el enlace sigue valiendo', async () => {
      jest.useFakeTimers({ doNotFake: [...SOLO_DATE.doNotFake], now: new Date('2026-11-10T09:00:00.000Z') });
      await registrar().expect(201);
      const enlace = enlaceRecibido();

      jest.setSystemTime(new Date('2026-11-11T08:59:00.000Z'));
      const pagina = await abrir(enlace);

      expect(pagina.text).toContain('Email confirmado. Ya puedes volver a Room8');
    });
  });

  describe('cuentas de Google', () => {
    const fetchOriginal = global.fetch;

    afterEach(() => {
      global.fetch = fetchOriginal;
    });

    it('no pasan por la verificación: entran directamente y no se manda ningún enlace', async () => {
      // AuthService llama a fetch con la URL como texto
      global.fetch = jest.fn(async (url: string) =>
        url.includes('oauth2.googleapis.com/token')
          ? new Response(JSON.stringify({ access_token: 'acceso-google' }), { status: 200 })
          : new Response(JSON.stringify({ sub: 'google-sub-1', email: 'alumno@gmail.com', name: 'Alumno' }), { status: 200 }),
      ) as typeof fetch;
      const { url } = auth.googleAuthorizationUrl('http://localhost:8081/auth');
      const state = new URL(url).searchParams.get('state')!;

      const result = await auth.googleCallback('codigo-de-google', state);

      expect(result.token).toEqual(expect.any(String));
      expect(await auth.userIdForToken(result.token)).toEqual(expect.any(String));
      expect(correos.filter((c) => c.args.some((a) => typeof a === 'string' && /https?:\/\//.test(a)))).toHaveLength(0);
    });
  });
});

// Paso 4 y observaciones: el contenido del correo, con el MailService real
describe('PA-1014.06 · correo «Confirma tu email en Room8»', () => {
  const ENLACE = 'http://localhost:3000/auth/verify-email?token=0123456789abcdef0123456789abcdef';
  type ConEnvio = { sendEmailVerification?: (to: string, link: string) => Promise<boolean> };

  // Se pide el método con un tipo opcional para que este archivo compile aunque aún no exista
  const enviarCon = (servicio: MailService) => (servicio as unknown as ConEnvio).sendEmailVerification;

  const crearServicio = (gmail: boolean) =>
    new MailService({
      get: (clave: string) =>
        gmail ? { GMAIL_USER: 'room8.app@gmail.com', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop' }[clave] : undefined,
    } as unknown as ConfigService);

  // Todo lo que el servidor escribe en la consola mientras dura la prueba: la salida estándar
  // y los métodos del Logger de Nest (que dentro de Jest no siempre llega a stdout)
  async function salidaDeConsola(accion: () => Promise<unknown>, LoggerUsado: typeof Logger = Logger) {
    let salida = '';
    const capturar = (...trozos: unknown[]) => {
      salida += `${trozos.map(String).join(' ')}\n`;
      return true;
    };
    const espias = [
      jest.spyOn(process.stdout, 'write').mockImplementation(capturar),
      jest.spyOn(process.stderr, 'write').mockImplementation(capturar),
      ...(['log', 'warn', 'error', 'debug', 'info'] as const).map((m) =>
        jest.spyOn(console, m).mockImplementation(capturar),
      ),
      ...(['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const).map((m) =>
        jest.spyOn(LoggerUsado.prototype, m).mockImplementation(capturar),
      ),
    ];
    try {
      await accion();
    } finally {
      espias.forEach((espia) => espia.mockRestore());
    }
    return salida;
  }

  beforeEach(() => {
    sendMail.mockClear();
  });

  it('existe un envío del correo de verificación en el MailService', () => {
    expect(typeof enviarCon(crearServicio(true))).toBe('function');
  });

  it('asunto «Confirma tu email en Room8», botón «Confirmar mi email» con el enlace, caducidad de 24 horas y aviso', async () => {
    const servicio = crearServicio(true);
    const enviar = enviarCon(servicio);
    expect(enviar).toBeDefined();

    await enviar!.call(servicio, 'alex@ejemplo.com', ENLACE);

    expect(sendMail).toHaveBeenCalledTimes(1);
    const correo = (sendMail.mock.calls[0] as unknown[])[0] as {
      to: string; subject: string; html: string; text: string;
    };
    expect(correo.to).toBe('alex@ejemplo.com');
    expect(correo.subject).toBe('Confirma tu email en Room8');
    // El botón es un enlace al backend con el texto «Confirmar mi email»
    const boton = correo.html.indexOf(`href="${ENLACE}"`);
    expect(boton).toBeGreaterThan(-1);
    expect(correo.html.indexOf('Confirmar mi email', boton)).toBeGreaterThan(boton);
    for (const cuerpo of [correo.html, correo.text]) {
      expect(cuerpo).toContain('24 horas');
      expect(cuerpo).toContain('Si no has creado una cuenta en Room8, ignora este email');
    }
    expect(correo.text).toContain(ENLACE);
  });

  it('en desarrollo sin Gmail configurado, el enlace sale en la consola del backend', async () => {
    const servicio = crearServicio(false);
    const enviar = enviarCon(servicio);
    expect(enviar).toBeDefined();

    const salida = await salidaDeConsola(() => enviar!.call(servicio, 'alex@ejemplo.com', ENLACE));

    expect(sendMail).not.toHaveBeenCalled();
    expect(salida).toContain(ENLACE);
  });

  it('en producción sin Gmail, el enlace nunca sale en la consola', async () => {
    // MailService decide al cargarse si es entorno de desarrollo, así que se carga de nuevo
    const nodeEnv = process.env.NODE_ENV;
    let MailServiceProduccion!: typeof MailService;
    let LoggerProduccion!: typeof Logger;
    try {
      process.env.NODE_ENV = 'production';
      jest.isolateModules(() => {
        MailServiceProduccion = (jest.requireActual('../mail/mail.service') as typeof import('../mail/mail.service')).MailService;
        // El Logger de esa misma carga, que es el que usa ese MailService
        LoggerProduccion = (jest.requireActual('@nestjs/common') as typeof import('@nestjs/common')).Logger;
      });
    } finally {
      process.env.NODE_ENV = nodeEnv;
    }
    const servicio = new MailServiceProduccion({ get: () => undefined } as unknown as ConfigService);
    const enviar = enviarCon(servicio);
    expect(enviar).toBeDefined();

    const salida = await salidaDeConsola(
      () => enviar!.call(servicio, 'alex@ejemplo.com', ENLACE),
      LoggerProduccion,
    );

    expect(salida).not.toContain('token=');
    expect(salida).not.toContain(ENLACE);
  });
});
