import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { ExpenseType, Prisma, TransactionCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  deudasDe,
  GASTO_BORRADO,
  GASTO_EDITADO,
  GastoBorrado,
  GastoEditado,
  TICKET_BORRADO,
  TicketBorrado,
} from './expense.events';
import { MAX_RECEIPT_TOTAL_CENTS } from './expense-rows';
import { centsToAmount, splitExpense } from './expense-split';
import { UpdateExpenseDto } from './dto/update-expense.dto';

const CAMBIADO =
  'Este gasto ha sido modificado por otra persona. Recarga la pantalla e inténtalo de nuevo';

interface Persona {
  id: string;
  full_name: string;
}

// Lo que debe una persona de un gasto (una Transaction)
export interface ParteDeGasto {
  transaction_id: string;
  user: Persona;
  amount: Prisma.Decimal;
}

// Un gasto: manual, liquidación o un producto de un ticket
export interface GastoItem {
  id: string;
  version: number;
  type: ExpenseType;
  concept: string | null;
  category: TransactionCategory;
  total_amount: Prisma.Decimal;
  date: Date;
  payer_participates: boolean;
  payer: Persona;
  paidByCurrentUser: boolean;
  canEdit: boolean;
  shares: ParteDeGasto[];
}

export type GastoDeLista = GastoItem & { kind: 'expense' };

// Un ticket escaneado con sus productos. total_amount es la suma de todos sus productos aunque
// quien lo mira solo vea los suyos
export interface TicketDeLista {
  kind: 'receipt';
  id: string;
  version: number;
  total_amount: Prisma.Decimal;
  date: Date;
  payer: Persona;
  paidByCurrentUser: boolean;
  canEdit: boolean;
  items: GastoItem[];
}

// Editar y borrar gastos y tickets. Toda escritura comprueba `version` en el propio where, así
// que si dos personas editan a la vez una de las dos recibe 409 en lugar de pisar a la otra.
// Los balances salen solo de las deudas (Transaction): aquí se reescriben en el sitio, sin
// borrar y volver a crear, para que sus ids no cambien.
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    // Opcional: sin él (p. ej. en los tests que no lo dan) no se emiten eventos ni hay avisos
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  // Los gastos que ve una persona: los que pagó y aquellos de los que debe algo. Los avisos de
  // pago pendientes no cuentan hasta que el acreedor los confirma. Los productos de un mismo
  // ticket se agrupan bajo el ticket; el que paga ve todos y cada deudor solo los suyos
  async list(
    apartmentId: string | undefined,
    userId: string,
  ): Promise<(GastoDeLista | TicketDeLista)[]> {
    const persona = { select: { id: true, full_name: true } };
    const gastos = await this.prisma.expense.findMany({
      where: {
        ...(apartmentId ? { apartment_id: apartmentId } : {}),
        category: { not: TransactionCategory.pending },
        OR: [
          { payer_id: userId },
          { transactions: { some: { to_user_id: userId } } },
        ],
      },
      select: {
        id: true,
        version: true,
        type: true,
        concept: true,
        category: true,
        total_amount: true,
        date: true,
        payer_participates: true,
        payer_id: true,
        payer: persona,
        receipt: {
          select: { id: true, version: true, total_amount: true, date: true },
        },
        transactions: {
          select: { id: true, amount: true, toUser: persona },
          orderBy: { created_at: 'asc' },
        },
      },
      orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
    });

    const lista: (GastoDeLista | TicketDeLista)[] = [];
    const tickets = new Map<string, TicketDeLista>();
    for (const gasto of gastos) {
      const paidByCurrentUser = gasto.payer_id === userId;
      const item: GastoItem = {
        id: gasto.id,
        version: gasto.version,
        type: gasto.type,
        concept: gasto.concept,
        category: gasto.category,
        total_amount: gasto.total_amount,
        date: gasto.date,
        payer_participates: gasto.payer_participates,
        payer: gasto.payer,
        paidByCurrentUser,
        // Las liquidaciones solo se gestionan desde el flujo de saldar deudas
        canEdit: paidByCurrentUser && gasto.type !== ExpenseType.SETTLEMENT,
        shares: gasto.transactions.map((deuda) => ({
          transaction_id: deuda.id,
          user: deuda.toUser,
          amount: deuda.amount,
        })),
      };

      if (!gasto.receipt) {
        lista.push({ ...item, kind: 'expense' });
        continue;
      }
      const existente = tickets.get(gasto.receipt.id);
      if (existente) {
        existente.items.push(item);
        continue;
      }
      const ticket: TicketDeLista = {
        kind: 'receipt',
        id: gasto.receipt.id,
        version: gasto.receipt.version,
        total_amount: gasto.receipt.total_amount,
        date: gasto.receipt.date,
        payer: gasto.payer,
        paidByCurrentUser,
        canEdit: paidByCurrentUser,
        items: [item],
      };
      tickets.set(gasto.receipt.id, ticket);
      lista.push(ticket);
    }
    return lista;
  }

  async update(id: string, dto: UpdateExpenseDto, userId: string) {
    const expense = await this.cargarEditable(id, userId);
    if (expense.version !== dto.version) {
      throw new ConflictException(CAMBIADO);
    }

    const totalCents =
      dto.amount !== undefined
        ? Math.round(Number(dto.amount) * 100)
        : Math.round(Number(expense.total_amount) * 100);
    const actuales = expense.transactions;
    // Sin lista nueva se mantienen las personas de ahora: los deudores y, si repartía, el pagador
    const participantIds =
      dto.participant_ids ??
      [
        ...actuales.map((deuda) => deuda.to_user_id),
        ...(expense.payer_participates ? [expense.payer_id] : []),
      ];
    const split = splitExpense(totalCents, expense.payer_id, participantIds);

    // Un gasto manual sin ningún deudor no tiene sentido; en un ticket un producto puede
    // quedarse a cuenta del que paga
    if (!expense.receipt_id && split.debts.size === 0) {
      throw new BadRequestException(
        'Select at least one person other than the payer to share the expense',
      );
    }
    if (dto.participant_ids) {
      await this.asegurarMiembros(expense.apartment_id, [...split.debts.keys()]);
    }

    const date = dto.date ? new Date(dto.date) : undefined;

    const actualizado = await this.prisma.$transaction(async (tx) => {
      // Esta escritura va la primera: si la versión ya no coincide no se toca nada más
      const { count } = await tx.expense.updateMany({
        where: { id, version: dto.version },
        data: {
          total_amount: centsToAmount(totalCents),
          concept: dto.concept,
          category: dto.category,
          date,
          payer_participates: split.payerParticipates,
          version: { increment: 1 },
        },
      });
      if (count === 0) {
        throw new ConflictException(CAMBIADO);
      }

      const porDeudor = new Map(
        actuales.map((deuda) => [deuda.to_user_id, deuda.id]),
      );
      const nuevas: Prisma.TransactionCreateManyInput[] = [];
      for (const [debtorId, cents] of split.debts) {
        const filaId = porDeudor.get(debtorId);
        if (filaId) {
          await tx.transaction.update({
            where: { id: filaId },
            data: {
              amount: centsToAmount(cents),
              concept: dto.concept,
              category: dto.category,
              date,
            },
          });
        } else {
          nuevas.push({
            id: randomUUID(),
            expense_id: id,
            apartment_id: expense.apartment_id,
            from_user_id: expense.payer_id,
            to_user_id: debtorId,
            amount: centsToAmount(cents),
            concept: dto.concept ?? expense.concept,
            category: dto.category ?? expense.category,
            date: date ?? expense.date,
          });
        }
      }

      const sobrantes = actuales
        .filter((deuda) => !split.debts.has(deuda.to_user_id))
        .map((deuda) => deuda.id);
      if (sobrantes.length > 0) {
        await tx.transaction.deleteMany({ where: { id: { in: sobrantes } } });
      }
      if (nuevas.length > 0) {
        await tx.transaction.createMany({ data: nuevas });
      }

      if (expense.receipt_id) {
        await this.recalcularTicket(tx, expense.receipt_id);
      }

      return tx.expense.findUnique({
        where: { id },
        include: { transactions: true },
      });
    });

    // Evento de dominio, ya con la edición guardada: las deudas de antes y las de después.
    // NotificationsListener decide a quién avisar y de qué (UT1018)
    if (actualizado) {
      await this.events?.emitAsync(
        GASTO_EDITADO,
        new GastoEditado(deudasDe(expense), actualizado.transactions, userId),
      );
    }
    return actualizado;
  }

  async remove(id: string, version: number, userId: string) {
    const expense = await this.cargarEditable(id, userId);
    if (expense.version !== version) {
      throw new ConflictException(CAMBIADO);
    }

    await this.prisma.$transaction(async (tx) => {
      // Las deudas se borran en cascada con el gasto
      const { count } = await tx.expense.deleteMany({ where: { id, version } });
      if (count === 0) {
        throw new ConflictException(CAMBIADO);
      }

      if (expense.receipt_id) {
        const quedan = await tx.expense.count({
          where: { receipt_id: expense.receipt_id },
        });
        if (quedan === 0) {
          // Era el último producto: un ticket sin productos no se queda
          await tx.receipt.deleteMany({ where: { id: expense.receipt_id } });
        } else {
          await this.recalcularTicket(tx, expense.receipt_id);
        }
      }
    });

    // Evento de dominio: las deudas que tenía (cada persona tiene una sola en un gasto o en un
    // producto). NotificationsListener manda un «Gasto eliminado» a cada deudor (UT1018)
    await this.events?.emitAsync(GASTO_BORRADO, new GastoBorrado(deudasDe(expense)));
    return { id };
  }

  // Borra el ticket entero: sus productos y las deudas de cada producto
  async removeReceipt(id: string, version: number, userId: string) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { id },
      select: {
        apartment_id: true,
        payer_id: true,
        version: true,
        // Para el aviso: cuánto debía cada persona de todo el ticket
        expenses: {
          select: {
            category: true,
            transactions: {
              select: {
                id: true,
                to_user_id: true,
                amount: true,
                concept: true,
                category: true,
              },
            },
          },
        },
      },
    });
    if (!receipt) {
      throw new NotFoundException('Receipt not found');
    }
    if (receipt.payer_id !== userId) {
      throw new ForbiddenException(
        'Solo quien creó el gasto puede editarlo o eliminarlo',
      );
    }
    if (receipt.version !== version) {
      throw new ConflictException(CAMBIADO);
    }

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.receipt.deleteMany({ where: { id, version } });
      if (count === 0) {
        throw new ConflictException(CAMBIADO);
      }
    });

    // Evento de dominio con las deudas de todos los productos: NotificationsListener manda un
    // solo «Gasto eliminado» por persona con lo que debía de todo el ticket (UT1018). Sin emisor
    // (p. ej. en los tests que no lo dan) ni se preparan
    if (this.events) {
      const deudas = receipt.expenses.flatMap((producto) =>
        deudasDe({
          apartment_id: receipt.apartment_id,
          payer_id: receipt.payer_id,
          transactions: producto.transactions,
        }),
      );
      await this.events.emitAsync(
        TICKET_BORRADO,
        new TicketBorrado(
          {
            id,
            apartment_id: receipt.apartment_id,
            payer_id: receipt.payer_id,
            category: receipt.expenses[0]?.category ?? TransactionCategory.supplies,
          },
          deudas,
        ),
      );
    }
    return { id };
  }

  // El total del ticket es la suma de sus productos. Primero se escribe en la fila del ticket
  // (eso la bloquea hasta que termine la transacción) y después se suma: dos ediciones a la vez
  // de productos del mismo ticket se turnan y la segunda ve ya la primera
  private async recalcularTicket(
    tx: Prisma.TransactionClient,
    receiptId: string,
  ) {
    await tx.receipt.update({
      where: { id: receiptId },
      data: { version: { increment: 1 } },
    });
    const { _sum } = await tx.expense.aggregate({
      _sum: { total_amount: true },
      where: { receipt_id: receiptId },
    });
    const totalCents = Math.round(Number(_sum.total_amount ?? 0) * 100);
    if (totalCents > MAX_RECEIPT_TOTAL_CENTS) {
      throw new BadRequestException('Receipt total must not exceed 10000.00');
    }
    await tx.receipt.update({
      where: { id: receiptId },
      data: { total_amount: centsToAmount(totalCents) },
    });
  }

  private async cargarEditable(id: string, userId: string) {
    const expense = await this.prisma.expense.findUnique({
      where: { id },
      select: {
        id: true,
        apartment_id: true,
        payer_id: true,
        receipt_id: true,
        type: true,
        version: true,
        total_amount: true,
        concept: true,
        category: true,
        date: true,
        payer_participates: true,
        // Importe, concepto y categoría: con ellos se redactan los avisos de editar y borrar
        transactions: {
          select: {
            id: true,
            to_user_id: true,
            amount: true,
            concept: true,
            category: true,
          },
        },
      },
    });

    if (!expense) {
      throw new NotFoundException('Expense not found');
    }
    if (expense.type === ExpenseType.SETTLEMENT) {
      throw new ConflictException(
        'Los pagos de deudas no se pueden editar ni borrar desde aquí',
      );
    }
    if (expense.payer_id !== userId) {
      throw new ForbiddenException(
        'Solo quien creó el gasto puede editarlo o eliminarlo',
      );
    }
    return expense;
  }

  private async asegurarMiembros(apartmentId: string, userIds: string[]) {
    if (userIds.length === 0) return;
    const miembros = await this.prisma.userApartment.findMany({
      where: { apartment_id: apartmentId, user_id: { in: userIds } },
      select: { user_id: true },
    });
    if (miembros.length !== new Set(userIds).size) {
      throw new BadRequestException(
        'All participants must belong to the apartment',
      );
    }
  }
}
