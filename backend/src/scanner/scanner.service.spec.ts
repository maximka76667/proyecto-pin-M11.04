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
    // El servicio registra cada escaneo y los errores de Gemini; en los tests solo ensuciaría la salida
    for (const nivel of ['log', 'debug', 'error'] as const) {
      jest.spyOn(Logger.prototype, nivel).mockImplementation(() => undefined);
    }
  });

  it('devuelve los productos del ticket leídos por Gemini', async () => {
    const productos = [
      { name: 'Leche entera', quantity: 2, unit_price: '0.95', category: 'supplies' },
      { name: 'Bombilla LED', quantity: 1, unit_price: '3.50', category: 'maintenance' },
    ];
    respuestaDeGemini({ comercio: 'Mercadona', items: productos });

    const resultado = await crearServicio().escanearTicket(crearImagen());

    expect(resultado).toEqual({ comercio: 'Mercadona', items: productos });
    const peticion = generateContent.mock.calls[0][0];
    expect(peticion.contents[0].parts[0].inlineData).toEqual({
      mimeType: 'image/jpeg',
      data: Buffer.from('foto').toString('base64'),
    });
  });

  it('corrige precios, cantidades y categorías que no tienen el formato esperado', async () => {
    respuestaDeGemini({
      comercio: '  ',
      items: [
        { name: ' Pan ', quantity: 0, unit_price: '1,5 €', category: 'payment' },
        { name: '', quantity: 1.5, unit_price: '2.00', category: 'supplies' },
        { name: 'Ilegible', quantity: 1, unit_price: '0', category: 'supplies' },
      ],
    });

    const resultado = await crearServicio().escanearTicket(crearImagen());

    expect(resultado).toEqual({
      comercio: null,
      items: [
        { name: 'Pan', quantity: 1, unit_price: '1.50', category: 'other' },
        { name: 'Producto 2', quantity: 1, unit_price: '2.00', category: 'supplies' },
        // El precio a null se deja para que el usuario lo complete al revisar
        { name: 'Ilegible', quantity: 1, unit_price: null, category: 'supplies' },
      ],
    });
  });

  it('descarta líneas sin nombre ni precio y respuestas sin lista de productos', async () => {
    respuestaDeGemini({
      comercio: 'Bar',
      items: [{ name: ' ', quantity: 1, unit_price: null, category: 'other' }, 'basura'],
    });
    expect((await crearServicio().escanearTicket(crearImagen())).items).toEqual([]);

    respuestaDeGemini({ comercio: 'Bar' });
    expect((await crearServicio().escanearTicket(crearImagen())).items).toEqual([]);
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
