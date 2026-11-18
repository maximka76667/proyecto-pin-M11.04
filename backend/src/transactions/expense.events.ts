import { Prisma, TransactionCategory } from '@prisma/client';

// Eventos de dominio de los gastos y los pagos (patrón Observer). TransactionsService y
// ExpensesService son los sujetos: cuando pasa algo lo anuncian con
// EventEmitter2.emitAsync(NOMBRE, new Evento(...)) y no saben quién escucha. Hoy el único
// observador es NotificationsListener, que crea los avisos de UT1018.

// Movimiento de dinero (una deuda). En un gasto, `from_user_id` es quien pagó y `to_user_id`
// quien le debe su parte; en un aviso de pago (`pending`), al revés: `from_user_id` es el deudor
// que dice haber pagado y `to_user_id` el acreedor
export type MoneyNotice = {
  id: string;
  apartment_id: string;
  from_user_id: string;
  to_user_id: string;
  // Una fila guardada trae Decimal; las que construye buildExpenseRows, un texto ("15.00")
  amount: Prisma.Decimal | Prisma.DecimalJsLike | string | number;
  concept?: string | null;
  category: TransactionCategory;
};

// Ticket escaneado: sus avisos van una vez por persona con lo que le toca de todo el ticket
export type ReceiptNotice = {
  id: string;
  apartment_id: string;
  payer_id: string;
  category: TransactionCategory;
};

// Las deudas de un gasto tal y como las carga ExpensesService (sin el pagador ni el piso en
// cada fila), en el formato de los eventos
export const deudasDe = (gasto: {
  apartment_id: string;
  payer_id: string;
  transactions: {
    id: string;
    to_user_id: string;
    amount: Prisma.Decimal;
    concept: string | null;
    category: TransactionCategory;
  }[];
}): MoneyNotice[] =>
  gasto.transactions.map((deuda) => ({
    id: deuda.id,
    apartment_id: gasto.apartment_id,
    from_user_id: gasto.payer_id,
    to_user_id: deuda.to_user_id,
    amount: deuda.amount,
    concept: deuda.concept,
    category: deuda.category,
  }));

// Gasto nuevo desde el formulario: una deuda por deudor. `actorId` es quien lo crea
export const GASTO_CREADO = 'gasto.creado';
export class GastoCreado {
  constructor(
    readonly deudas: MoneyNotice[],
    readonly actorId: string,
  ) {}
}

// Ticket escaneado nuevo: una deuda por producto y deudor
export const TICKET_CREADO = 'ticket.creado';
export class TicketCreado {
  constructor(
    readonly ticket: ReceiptNotice,
    readonly deudas: MoneyNotice[],
    readonly actorId: string,
  ) {}
}

// Se edita un gasto o un producto de un ticket: las deudas de antes y las de después
export const GASTO_EDITADO = 'gasto.editado';
export class GastoEditado {
  constructor(
    readonly antes: MoneyNotice[],
    readonly despues: MoneyNotice[],
    readonly actorId: string,
  ) {}
}

// Se borra un gasto o un producto de un ticket: las deudas que tenía
export const GASTO_BORRADO = 'gasto.borrado';
export class GastoBorrado {
  constructor(readonly deudas: MoneyNotice[]) {}
}

// Se borra un ticket entero: las deudas de todos sus productos
export const TICKET_BORRADO = 'ticket.borrado';
export class TicketBorrado {
  constructor(
    readonly ticket: ReceiptNotice,
    readonly deudas: MoneyNotice[],
  ) {}
}

// El deudor dice que ha pagado; el acreedor lo confirma o lo rechaza
export const PAGO_MARCADO = 'pago.marcado';
export const PAGO_CONFIRMADO = 'pago.confirmado';
export const PAGO_RECHAZADO = 'pago.rechazado';
export class PagoMarcado {
  constructor(readonly pago: MoneyNotice) {}
}
export class PagoConfirmado {
  constructor(readonly pago: MoneyNotice) {}
}
export class PagoRechazado {
  constructor(readonly pago: MoneyNotice) {}
}
