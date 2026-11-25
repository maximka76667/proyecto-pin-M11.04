import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiError } from '@google/genai';
import { extraerJsonDelTicket } from './openrouter';
import { ScannerService } from './scanner.service';

// Gemini y OpenRouter se simulan: los tests no llaman a ninguna API real
const generateContent = jest.fn();
jest.mock('@google/genai', () => ({
  ...jest.requireActual('@google/genai'),
  GoogleGenAI: jest.fn(() => ({ models: { generateContent } })),
}));
const fetchSimulado = jest.fn();

const LECHE = { name: 'Leche entera', quantity: 2, unit_price: '0.95', category: 'supplies' };
const TICKET_JSON = JSON.stringify({ comercio: 'Consum', items: [LECHE] });

// null = sin esa clave (con undefined se usarían los valores por defecto)
function crearServicio(opciones: {
  gemini?: string | null;
  openRouter?: string | null;
  modelos?: string;
} = {}) {
  const { gemini = 'clave-gemini', openRouter = 'clave-openrouter', modelos } = opciones;
  const valores: Record<string, string | undefined> = {
    GEMINI_API_KEY: gemini ?? undefined,
    OPENROUTER_API_KEY: openRouter ?? undefined,
    OPENROUTER_MODELS: modelos,
  };
  const config = { get: (nombre: string) => valores[nombre] };
  return new ScannerService(config as unknown as ConfigService);
}

function crearImagen() {
  return { mimetype: 'image/jpeg', buffer: Buffer.from('foto') } as Express.Multer.File;
}

function respuestaDeOpenRouter(contenido: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ choices: [{ message: { content: contenido } }] }),
    text: async () => JSON.stringify({ error: { message: 'error simulado' } }),
  };
}

describe('ScannerService con el respaldo de OpenRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchSimulado as unknown as typeof fetch;
    for (const nivel of ['log', 'debug', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, nivel).mockImplementation(() => undefined);
    }
    jest.spyOn(Logger, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
  });

  it('si Gemini falla, lee el ticket con OpenRouter y manda la imagen y la clave', async () => {
    generateContent.mockRejectedValue(new ApiError({ message: 'quota', status: 429 }));
    fetchSimulado.mockResolvedValue(respuestaDeOpenRouter(TICKET_JSON));

    const resultado = await crearServicio().escanearTicket(crearImagen());

    expect(resultado).toEqual({ comercio: 'Consum', items: [LECHE], provider: 'openrouter' });
    const [url, peticion] = fetchSimulado.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(peticion.headers.Authorization).toBe('Bearer clave-openrouter');
    const cuerpo = JSON.parse(peticion.body);
    expect(cuerpo.model).toBe('nvidia/nemotron-3.5-super-vl:free');
    expect(cuerpo.messages[0].content[1].image_url.url).toBe(
      `data:image/jpeg;base64,${Buffer.from('foto').toString('base64')}`,
    );
  });

  it('si Gemini responde bien, no se llama a OpenRouter', async () => {
    generateContent.mockResolvedValue({ text: TICKET_JSON });

    await crearServicio().escanearTicket(crearImagen());

    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('sin clave de OpenRouter, un fallo de Gemini sigue dando 502 como antes', async () => {
    generateContent.mockRejectedValue(new Error('network'));

    await expect(crearServicio({ openRouter: null }).escanearTicket(crearImagen())).rejects.toThrow(
      BadGatewayException,
    );
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('si fallan Gemini y OpenRouter, el cliente recibe el error de Gemini (429)', async () => {
    generateContent.mockRejectedValue(new ApiError({ message: 'quota', status: 429 }));
    fetchSimulado.mockResolvedValue(respuestaDeOpenRouter('', 500));

    const error = await crearServicio().escanearTicket(crearImagen()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
  });

  it('si Gemini no está configurado, se usa OpenRouter directamente', async () => {
    fetchSimulado.mockResolvedValue(respuestaDeOpenRouter(TICKET_JSON));

    const resultado = await crearServicio({ gemini: null }).escanearTicket(crearImagen());

    expect(resultado.items).toEqual([LECHE]);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('si solo hay OpenRouter y falla, responde 502', async () => {
    fetchSimulado.mockResolvedValue(respuestaDeOpenRouter('', 500));

    await expect(crearServicio({ gemini: null }).escanearTicket(crearImagen())).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('sin ninguna de las dos claves responde 503', async () => {
    await expect(
      crearServicio({ gemini: null, openRouter: null }).escanearTicket(crearImagen()),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('prueba el siguiente modelo si el primero devuelve algo que no es un ticket', async () => {
    generateContent.mockRejectedValue(new Error('network'));
    fetchSimulado
      .mockResolvedValueOnce(respuestaDeOpenRouter('Lo siento, no puedo leer esta imagen'))
      .mockResolvedValueOnce(respuestaDeOpenRouter(TICKET_JSON));

    const resultado = await crearServicio({ modelos: 'modelo/a:free, modelo/b:free' }).escanearTicket(
      crearImagen(),
    );

    expect(resultado.items).toEqual([LECHE]);
    const modelos = fetchSimulado.mock.calls.map(([, peticion]) => JSON.parse(peticion.body).model);
    expect(modelos).toEqual(['modelo/a:free', 'modelo/b:free']);
  });

  it('con una clave rechazada (401) no prueba más modelos', async () => {
    generateContent.mockRejectedValue(new Error('network'));
    fetchSimulado.mockResolvedValue(respuestaDeOpenRouter('', 401));

    await expect(
      crearServicio({ modelos: 'modelo/a:free,modelo/b:free' }).escanearTicket(crearImagen()),
    ).rejects.toThrow(BadGatewayException);
    expect(fetchSimulado).toHaveBeenCalledTimes(1);
  });

  it('un ticket ilegible leído por OpenRouter no se vuelve a intentar con otro proveedor', async () => {
    generateContent.mockRejectedValue(new Error('network'));
    fetchSimulado.mockResolvedValue(respuestaDeOpenRouter('{"comercio": null, "items": []}'));

    await expect(crearServicio().escanearTicket(crearImagen())).rejects.toThrow(
      'Ticket no legible',
    );
    expect(fetchSimulado).toHaveBeenCalledTimes(1);
  });
});

describe('ScannerService con ?provider (un solo lector, sin respaldo automático)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchSimulado as unknown as typeof fetch;
    for (const nivel of ['log', 'debug', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, nivel).mockImplementation(() => undefined);
    }
  });

  it('provider=gemini usa solo Gemini y lo indica en la respuesta', async () => {
    generateContent.mockResolvedValue({ text: TICKET_JSON });

    const resultado = await crearServicio().escanearTicket(crearImagen(), 'gemini');

    expect(resultado.provider).toBe('gemini');
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('provider=gemini no recurre a OpenRouter cuando Gemini falla: la app decide qué hacer', async () => {
    generateContent.mockRejectedValue(new ApiError({ message: 'quota', status: 429 }));

    const error = await crearServicio()
      .escanearTicket(crearImagen(), 'gemini')
      .catch((e: unknown) => e);

    expect((error as HttpException).getStatus()).toBe(429);
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('provider=openrouter usa solo OpenRouter y lo indica en la respuesta', async () => {
    fetchSimulado.mockResolvedValue(respuestaDeOpenRouter(TICKET_JSON));

    const resultado = await crearServicio().escanearTicket(crearImagen(), 'openrouter');

    expect(resultado.provider).toBe('openrouter');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('provider=openrouter sin clave de OpenRouter responde 503', async () => {
    await expect(
      crearServicio({ openRouter: null }).escanearTicket(crearImagen(), 'openrouter'),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('provider=gemini sin clave de Gemini responde 503 aunque haya clave de OpenRouter', async () => {
    await expect(
      crearServicio({ gemini: null }).escanearTicket(crearImagen(), 'gemini'),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('provider=openrouter responde 502 si OpenRouter falla', async () => {
    fetchSimulado.mockResolvedValue(respuestaDeOpenRouter('', 500));

    await expect(
      crearServicio().escanearTicket(crearImagen(), 'openrouter'),
    ).rejects.toThrow(BadGatewayException);
  });

  it('un provider desconocido responde 400 y no llama a ningún lector', async () => {
    await expect(crearServicio().escanearTicket(crearImagen(), 'chatgpt')).rejects.toThrow(
      BadRequestException,
    );
    expect(generateContent).not.toHaveBeenCalled();
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('sin provider se indica qué lector respondió: Gemini si funciona, OpenRouter si ha sido el respaldo', async () => {
    generateContent.mockResolvedValueOnce({ text: TICKET_JSON });
    expect((await crearServicio().escanearTicket(crearImagen())).provider).toBe('gemini');

    generateContent.mockRejectedValueOnce(new Error('network'));
    fetchSimulado.mockResolvedValue(respuestaDeOpenRouter(TICKET_JSON));
    expect((await crearServicio().escanearTicket(crearImagen())).provider).toBe('openrouter');
  });
});

describe('extraerJsonDelTicket', () => {
  it('quita el bloque de código que algunos modelos añaden', () => {
    expect(extraerJsonDelTicket(`\`\`\`json\n${TICKET_JSON}\n\`\`\``)).toBe(TICKET_JSON);
  });

  it('ignora texto antes y después del JSON', () => {
    expect(extraerJsonDelTicket(`Aquí tienes: ${TICKET_JSON} Espero que sirva.`)).toBe(TICKET_JSON);
  });

  it('acepta el contenido como lista de partes', () => {
    expect(extraerJsonDelTicket([{ text: TICKET_JSON.slice(0, 10) }, { text: TICKET_JSON.slice(10) }])).toBe(
      TICKET_JSON,
    );
  });

  it.each([
    ['texto sin JSON', 'no hay nada que leer'],
    ['JSON roto', '{"items": ['],
    ['JSON sin items', '{"comercio": "Consum"}'],
    ['items que no es una lista', '{"items": "nada"}'],
    ['contenido vacío', ''],
    ['contenido que no es texto', null],
  ])('devuelve null con %s', (_caso, contenido) => {
    expect(extraerJsonDelTicket(contenido)).toBeNull();
  });
});
