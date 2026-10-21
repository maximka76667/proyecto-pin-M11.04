import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiError } from '@google/genai';
import { ScannerService } from './scanner.service';

// Se sustituye el cliente de Gemini para que los tests no llamen a la API real
const generateContent = jest.fn();
jest.mock('@google/genai', () => ({
  ...jest.requireActual('@google/genai'),
  GoogleGenAI: jest.fn(() => ({ models: { generateContent } })),
}));

// null = sin clave configurada (con undefined se usaría el valor por defecto)
function crearServicio(clave: string | null = 'clave-de-prueba') {
  const config = {
    get: (nombre: string) => (nombre === 'GEMINI_API_KEY' ? (clave ?? undefined) : undefined),
  };
  return new ScannerService(config as unknown as ConfigService);
}

function crearImagen(mimetype = 'image/jpeg') {
  return { mimetype, buffer: Buffer.from('foto') } as Express.Multer.File;
}

function respuestaDeGemini(datos: unknown) {
  generateContent.mockResolvedValue({ text: JSON.stringify(datos) });
}

describe('ScannerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // El servicio registra los errores de Gemini; en los tests solo ensuciaría la salida
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('devuelve los datos del ticket leídos por Gemini', async () => {
    respuestaDeGemini({
      comercio: 'Mercadona',
      amount: '23.45',
      date: '2026-10-20',
      category: 'supplies',
    });

    const resultado = await crearServicio().escanearTicket(crearImagen());

    expect(resultado).toEqual({
      comercio: 'Mercadona',
      amount: '23.45',
      date: '2026-10-20',
      category: 'supplies',
    });
    const peticion = generateContent.mock.calls[0][0];
    expect(peticion.contents[0].parts[0].inlineData).toEqual({
      mimeType: 'image/jpeg',
      data: Buffer.from('foto').toString('base64'),
    });
  });

  it('normaliza el importe y descarta fechas y categorías no válidas', async () => {
    respuestaDeGemini({
      comercio: '  ',
      amount: '12,5 €',
      date: '2026-02-30',
      category: 'payment',
    });

    const resultado = await crearServicio().escanearTicket(crearImagen());

    expect(resultado).toEqual({
      comercio: null,
      amount: '12.50',
      date: null,
      category: 'other',
    });
  });

  it('deja a null un importe ilegible o a cero', async () => {
    respuestaDeGemini({ comercio: null, amount: '0', date: null, category: 'other' });

    const resultado = await crearServicio().escanearTicket(crearImagen());

    expect(resultado.amount).toBeNull();
  });

  it('rechaza la petición si no hay imagen o no es un formato admitido', async () => {
    const servicio = crearServicio();

    await expect(servicio.escanearTicket(undefined)).rejects.toThrow(BadRequestException);
    await expect(servicio.escanearTicket(crearImagen('application/pdf'))).rejects.toThrow(
      BadRequestException,
    );
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('avisa de que el escáner no está configurado si falta GEMINI_API_KEY', async () => {
    await expect(crearServicio(null).escanearTicket(crearImagen())).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('devuelve 503 si Gemini rechaza la clave por no ser válida', async () => {
    generateContent.mockRejectedValue(
      new ApiError({ message: 'API key not valid. Please pass a valid API key.', status: 400 }),
    );

    await expect(crearServicio('tu_clave').escanearTicket(crearImagen())).rejects.toMatchObject({
      status: 503,
      message: 'Ticket scanner is not configured (invalid GEMINI_API_KEY)',
    });
  });

  it('devuelve 503 si la clave está bloqueada o sin permisos (401/403)', async () => {
    generateContent.mockRejectedValue(new ApiError({ message: 'permission denied', status: 403 }));

    await expect(crearServicio().escanearTicket(crearImagen())).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('un 400 que no es de la clave sigue siendo 502', async () => {
    generateContent.mockRejectedValue(new ApiError({ message: 'Invalid image', status: 400 }));

    await expect(crearServicio().escanearTicket(crearImagen())).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('devuelve 429 cuando se agota el límite gratuito de Gemini', async () => {
    generateContent.mockRejectedValue(new ApiError({ message: 'quota', status: 429 }));

    await expect(crearServicio().escanearTicket(crearImagen())).rejects.toMatchObject({
      status: 429,
    });
    await expect(crearServicio().escanearTicket(crearImagen())).rejects.toThrow(HttpException);
  });

  it('devuelve 502 si Gemini falla o responde algo que no es JSON', async () => {
    generateContent.mockRejectedValueOnce(new Error('network'));
    await expect(crearServicio().escanearTicket(crearImagen())).rejects.toThrow(
      BadGatewayException,
    );

    generateContent.mockResolvedValueOnce({ text: 'no soy json' });
    await expect(crearServicio().escanearTicket(crearImagen())).rejects.toThrow(
      BadGatewayException,
    );
  });
});
