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
import { ApiError, GenerateContentResponse, GoogleGenAI, Type } from '@google/genai';
import { CATEGORIAS_DE_GASTO } from '../transactions/categorias';
import {
  MAX_CANTIDAD,
  MAX_PRECIO_UNIDAD,
  MAX_PRODUCTOS,
} from '../transactions/dto/create-receipt-transaction.dto';

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

// name, quantity y unit_price se llaman como en ReceiptItemDto para pasarlos tal cual.
// unit_price viene a null si no se ha podido leer: el usuario lo completa al revisar.
export interface ProductoEscaneado {
  name: string;
  quantity: number;
  unit_price: string | null;
  category: TransactionCategory;
}

// Lo que se devuelve a la app para rellenar la pantalla de revisión. No se guarda nada:
// el usuario elige qué productos comparte y corrige los datos antes de crear el gasto.
export interface TicketEscaneado {
  comercio: string | null;
  items: ProductoEscaneado[];
}

const PROMPT = `Eres un lector de tickets de compra de un piso compartido.
Extrae de la imagen:
- comercio: nombre del comercio o empresa (null si no se lee).
- items: una entrada por cada línea de producto del ticket, con:
  - name: nombre del producto tal y como aparece, sin abreviaturas raras si se entienden.
  - quantity: número entero de unidades. Si el producto va al peso (kg, g), usa 1.
  - unit_price: precio de UNA unidad, con punto decimal y 2 decimales, p. ej. "1.25".
    Si va al peso, el importe total de esa línea. Si hay un descuento aplicado a ese
    producto, réstalo del precio. null si no se lee con seguridad.
  - category: utilities (luz, agua, gas, internet), maintenance (reparaciones, herramientas,
    bombillas, piezas), supplies (comida, bebida, limpieza, higiene, cosas de casa) u other.
No incluyas como productos el total, subtotales, impuestos, cambio ni formas de pago.
No inventes productos. Si la imagen no es un ticket, devuelve items vacío.`;

const ESQUEMA_RESPUESTA = {
  type: Type.OBJECT,
  properties: {
    comercio: { type: Type.STRING, nullable: true },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          quantity: { type: Type.INTEGER },
          unit_price: { type: Type.STRING, nullable: true },
          category: { type: Type.STRING, enum: CATEGORIAS_DE_GASTO },
        },
        required: ['name', 'quantity', 'unit_price', 'category'],
      },
    },
  },
  required: ['comercio', 'items'],
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

    const inicio = Date.now();
    const segundos = () => ((Date.now() - inicio) / 1000).toFixed(1);
    this.logger.log(
      `Scanning ${imagen.mimetype} of ${(imagen.buffer.length / 1024).toFixed(0)} KB with ${this.modelo}`,
    );
    // Con fotos difíciles Gemini puede tardar mucho: así el log muestra que sigue esperando
    const aviso = setInterval(
      () => this.logger.log(`Still waiting for Gemini... ${segundos()} s`),
      10_000,
    );

    let respuesta: GenerateContentResponse;
    try {
      respuesta = await this.gemini.models.generateContent({
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
    } catch (error) {
      // Al cliente solo le llega un mensaje genérico; el error real queda en el log
      this.logger.error(`Gemini error after ${segundos()} s: ${String(error)}`);

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
    } finally {
      clearInterval(aviso);
    }

    // thinking = tokens que Gemini gasta "pensando" antes de responder; suele ser lo que más tarda
    const uso = respuesta.usageMetadata;
    this.logger.log(
      `Gemini answered in ${segundos()} s ` +
        `(finish: ${respuesta.candidates?.[0]?.finishReason ?? 'unknown'}, ` +
        `tokens: prompt ${uso?.promptTokenCount ?? '?'}, ` +
        `thinking ${uso?.thoughtsTokenCount ?? 0}, output ${uso?.candidatesTokenCount ?? '?'})`,
    );
    this.logger.debug(`Gemini raw response: ${(respuesta.text ?? '').slice(0, 2000)}`);

    const { ticket, lineasLeidas } = normalizarRespuesta(respuesta.text);
    const sinPrecio = ticket.items.filter((producto) => producto.unit_price === null).length;
    this.logger.log(
      `Ticket read: ${ticket.items.length} products ` +
        `(${sinPrecio} without price, ${lineasLeidas - ticket.items.length} lines discarded)`,
    );
    return ticket;
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
// lo que no tenga el formato que exige ReceiptItemDto se corrige o se deja a null
// lineasLeidas = cuántas líneas devolvió Gemini antes de descartar las que no sirven (para el log)
function normalizarRespuesta(texto: string | undefined): {
  ticket: TicketEscaneado;
  lineasLeidas: number;
} {
  let datos: Record<string, unknown>;
  try {
    datos = JSON.parse(texto ?? '') as Record<string, unknown>;
  } catch {
    throw new BadGatewayException('Ticket scanner returned an invalid response');
  }

  const productos = Array.isArray(datos.items) ? datos.items : [];
  return {
    ticket: {
      comercio: normalizarTexto(datos.comercio),
      items: productos
        .filter((producto): producto is Record<string, unknown> =>
          typeof producto === 'object' && producto !== null,
        )
        .map(normalizarProducto)
        // Una línea sin nombre ni precio no aporta nada al usuario
        .filter((producto): producto is ProductoEscaneado => producto !== null)
        // Los mismos límites que acepta POST /transactions/from-receipt
        .slice(0, MAX_PRODUCTOS),
    },
    lineasLeidas: productos.length,
  };
}

function normalizarProducto(
  producto: Record<string, unknown>,
  indice: number,
): ProductoEscaneado | null {
  const nombre = normalizarTexto(producto.name);
  const precio = normalizarImporte(producto.unit_price);
  if (!nombre && !precio) return null;

  const cantidad = producto.quantity;
  const categoria = producto.category as TransactionCategory;
  return {
    name: nombre ?? `Producto ${indice + 1}`,
    quantity:
      Number.isInteger(cantidad) && (cantidad as number) >= 1 && (cantidad as number) <= MAX_CANTIDAD
        ? (cantidad as number)
        : 1,
    unit_price: precio,
    category: CATEGORIAS_DE_GASTO.includes(categoria) ? categoria : TransactionCategory.other,
  };
}

function normalizarTexto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  return limpio ? limpio.slice(0, 100) : null;
}

// Acepta "12.5", "12,50" o 12.5 y devuelve "12.50"; null si no es un importe válido
// o supera MAX_PRECIO_UNIDAD (el usuario lo corrige al revisar)
function normalizarImporte(valor: unknown): string | null {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  const numero = Number(String(valor).replace(',', '.').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(numero) || numero <= 0) return null;
  // Se compara ya redondeado: 99999.999 sería "100000.00"
  const importe = numero.toFixed(2);
  return Number(importe) > Number(MAX_PRECIO_UNIDAD) ? null : importe;
}
