import { Logger } from '@nestjs/common';

// Modelos gratuitos de OpenRouter con entrada de imagen, en el orden en que se prueban.
// La lista de modelos gratis cambia a menudo: se puede sobrescribir con OPENROUTER_MODELS.
export const MODELOS_OPENROUTER_POR_DEFECTO = [
  'nvidia/nemotron-3.5-super-vl:free',
  'google/gemma-4-31b-it:free',
];

// Cada modelo gratuito tiene este tiempo como máximo, y entre todos el presupuesto de abajo:
// así un modelo lento no deja al usuario esperando minutos mientras se prueban los demás
export const TIMEOUT_POR_MODELO_MS = 25_000;
export const TIMEOUT_TOTAL_OPENROUTER_MS = 30_000;
// Si queda menos que esto, otro modelo no llegaría a responder: no se intenta
const TIEMPO_MINIMO_POR_INTENTO_MS = 8_000;

const URL_OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';

// Los modelos gratis no siempre admiten esquemas JSON estrictos, así que el formato
// se pide en el texto y se comprueba al recibirlo
const FORMATO_RESPUESTA = `
Responde SOLO con un objeto JSON, sin texto extra ni bloques de código, con esta forma:
{"comercio": string | null, "items": [{"name": string, "quantity": number, "unit_price": string | null, "category": "utilities" | "maintenance" | "supplies" | "other"}]}`;

export interface OpcionesOpenRouter {
  clave: string;
  modelos: string[];
  prompt: string;
  mimetype: string;
  imagen: Buffer;
  timeoutPorModeloMs?: number;
  timeoutTotalMs?: number;
}

const logger = new Logger('OpenRouter');

// Devuelve el JSON del ticket como texto (el mismo contrato que la respuesta de Gemini).
// Prueba los modelos en orden: pasa al siguiente si uno falla, no responde o devuelve algo
// que no es el JSON esperado. Si todos fallan, lanza el último error.
export async function leerTicketConOpenRouter(opciones: OpcionesOpenRouter): Promise<string> {
  const dataUrl = `data:${opciones.mimetype};base64,${opciones.imagen.toString('base64')}`;
  let ultimoError = new Error('No OpenRouter model configured');
  const limite = Date.now() + (opciones.timeoutTotalMs ?? TIMEOUT_TOTAL_OPENROUTER_MS);

  for (const [indice, modelo] of opciones.modelos.entries()) {
    const restante = limite - Date.now();
    // El primer modelo siempre se intenta; los siguientes, solo si queda tiempo para responder
    if (indice > 0 && restante < TIEMPO_MINIMO_POR_INTENTO_MS) {
      logger.warn(`Time budget used up, skipping ${opciones.modelos.slice(indice).join(', ')}`);
      break;
    }
    const inicio = Date.now();
    try {
      const respuesta = await fetch(URL_OPENROUTER, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opciones.clave}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelo,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: opciones.prompt + FORMATO_RESPUESTA },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(
          Math.min(opciones.timeoutPorModeloMs ?? TIMEOUT_POR_MODELO_MS, Math.max(restante, 1)),
        ),
      });

      if (!respuesta.ok) {
        // 401/402: la clave no vale o no hay saldo; otro modelo tampoco va a funcionar
        const detalle = (await respuesta.text()).slice(0, 300);
        const error = new Error(`OpenRouter ${modelo} answered ${respuesta.status}: ${detalle}`);
        if (respuesta.status === 401 || respuesta.status === 402) throw new ErrorFatal(error);
        throw error;
      }

      const cuerpo = (await respuesta.json()) as {
        choices?: { message?: { content?: unknown } }[];
      };
      const json = extraerJsonDelTicket(cuerpo.choices?.[0]?.message?.content);
      if (!json) throw new Error(`OpenRouter ${modelo} returned no valid ticket JSON`);

      logger.log(`${modelo} answered in ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
      return json;
    } catch (error) {
      if (error instanceof ErrorFatal) throw error.causa;
      ultimoError = error instanceof Error ? error : new Error(String(error));
      logger.warn(`${modelo} failed after ${((Date.now() - inicio) / 1000).toFixed(1)} s: ${ultimoError.message}`);
    }
  }
  throw ultimoError;
}

class ErrorFatal extends Error {
  constructor(readonly causa: Error) {
    super(causa.message);
  }
}

// Algunos modelos envuelven el JSON en ```json ... ``` o añaden una frase delante;
// content puede venir como texto o como lista de partes
export function extraerJsonDelTicket(contenido: unknown): string | null {
  const texto = Array.isArray(contenido)
    ? contenido.map((parte) => (typeof parte?.text === 'string' ? parte.text : '')).join('')
    : typeof contenido === 'string'
      ? contenido
      : '';
  const inicio = texto.indexOf('{');
  const fin = texto.lastIndexOf('}');
  if (inicio === -1 || fin <= inicio) return null;

  const candidato = texto.slice(inicio, fin + 1);
  try {
    const datos = JSON.parse(candidato) as { items?: unknown };
    return Array.isArray(datos.items) ? candidato : null;
  } catch {
    return null;
  }
}
