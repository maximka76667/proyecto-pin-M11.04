import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransactionCategory } from '@prisma/client';
import { ApiError, GoogleGenAI, Type } from '@google/genai';
import { CATEGORIAS_DE_GASTO } from '../transactions/categorias';

// Formatos de imagen que acepta Gemini
export const TIPOS_DE_IMAGEN = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

export const PESO_MAXIMO_IMAGEN = 8 * 1024 * 1024; // 8 MB

const MODELO_POR_DEFECTO = 'gemini-3-flash-preview';

// Lo que se devuelve a la app para rellenar el formulario. No se guarda nada:
// el usuario revisa y corrige los datos antes de crear la transacción.
// amount, date y category se llaman como en CreateTransactionDto para pasarlos tal cual.
// Los campos que no se han podido leer del ticket vienen a null.
export interface TicketEscaneado {
  comercio: string | null;
  amount: string | null;
  date: string | null;
  category: TransactionCategory;
}

const PROMPT = `Eres un lector de tickets y facturas de gastos de un piso compartido.
Extrae de la imagen:
- comercio: nombre del comercio o empresa.
- amount: importe TOTAL final pagado (con impuestos), con punto decimal y 2 decimales, p. ej. "12.50".
- date: fecha del ticket en formato YYYY-MM-DD.
- category: utilities (luz, agua, gas, internet), maintenance (reparaciones, fontanero...),
  supplies (supermercado, limpieza, productos para la casa) u other.
Si un dato no se puede leer con seguridad, devuelve null en ese campo. No inventes datos.
Si la imagen no es un ticket, devuelve todos los campos a null y category "other".`;

const ESQUEMA_RESPUESTA = {
  type: Type.OBJECT,
  properties: {
    comercio: { type: Type.STRING, nullable: true },
    amount: { type: Type.STRING, nullable: true },
    date: { type: Type.STRING, nullable: true },
    category: { type: Type.STRING, enum: CATEGORIAS_DE_GASTO },
  },
  required: ['comercio', 'amount', 'date', 'category'],
};

@Injectable()
export class ScannerService {
  private readonly logger = new Logger(ScannerService.name);
  private readonly gemini: GoogleGenAI | null;
  private readonly modelo: string;

  constructor(config: ConfigService) {
    // Sin clave la app arranca igual; solo falla el escaneo
    const clave = config.get<string>('GEMINI_API_KEY');
    this.gemini = clave ? new GoogleGenAI({ apiKey: clave }) : null;
    this.modelo = config.get<string>('GEMINI_MODEL') ?? MODELO_POR_DEFECTO;
  }

  async escanearTicket(
    imagen: Express.Multer.File | undefined,
  ): Promise<TicketEscaneado> {
    if (!imagen) {
      throw new BadRequestException('image file is required');
    }
    if (!TIPOS_DE_IMAGEN.includes(imagen.mimetype)) {
      throw new BadRequestException(
        `image must be one of: ${TIPOS_DE_IMAGEN.join(', ')}`,
      );
    }
    if (!this.gemini) {
      throw new ServiceUnavailableException(
        'Ticket scanner is not configured (missing GEMINI_API_KEY)',
      );
    }

    let texto: string | undefined;
    try {
      const respuesta = await this.gemini.models.generateContent({
        model: this.modelo,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: imagen.mimetype,
                  data: imagen.buffer.toString('base64'),
                },
              },
              { text: PROMPT },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: ESQUEMA_RESPUESTA,
        },
      });
      texto = respuesta.text;
    } catch (error) {
      // Al cliente solo le llega un mensaje genérico; el error real queda en el log
      this.logger.error(`Gemini error: ${String(error)}`);

      if (esClaveInvalida(error)) {
        throw new ServiceUnavailableException(
          'Ticket scanner is not configured (invalid GEMINI_API_KEY)',
        );
      }
      // 429 = se ha agotado el límite gratuito de Gemini
      if (error instanceof ApiError && error.status === 429) {
        throw new HttpException(
          'Ticket scanner limit reached, try again later',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new BadGatewayException('Ticket scanner is not available');
    }

    return normalizarRespuesta(texto);
  }
}

// Una clave mal copiada llega como 400 "API key not valid" (API_KEY_INVALID);
// una clave bloqueada o restringida, como 401/403
function esClaveInvalida(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 401 || error.status === 403) return true;
  return error.status === 400 && /API_KEY_INVALID|API key not valid/i.test(error.message);
}

// Gemini respeta el esquema casi siempre, pero no se confía en ello:
// lo que no tenga el formato que exige CreateTransactionDto se descarta
function normalizarRespuesta(texto: string | undefined): TicketEscaneado {
  let datos: Record<string, unknown>;
  try {
    datos = JSON.parse(texto ?? '') as Record<string, unknown>;
  } catch {
    throw new BadGatewayException('Ticket scanner returned an invalid response');
  }

  const categoria = datos.category as TransactionCategory;
  return {
    comercio: normalizarTexto(datos.comercio),
    amount: normalizarImporte(datos.amount),
    date: normalizarFecha(datos.date),
    category: CATEGORIAS_DE_GASTO.includes(categoria)
      ? categoria
      : TransactionCategory.other,
  };
}

function normalizarTexto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  return limpio ? limpio.slice(0, 100) : null;
}

// Acepta "12.5", "12,50" o 12.5 y devuelve "12.50"; null si no es un importe válido
function normalizarImporte(valor: unknown): string | null {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  const numero = Number(String(valor).replace(',', '.').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(numero) || numero <= 0 || numero >= 1e10) return null;
  return numero.toFixed(2);
}

// Solo fechas reales en formato YYYY-MM-DD (descarta, p. ej., 2026-02-30)
function normalizarFecha(valor: unknown): string | null {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  const fecha = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(valor)
    ? valor
    : null;
}
