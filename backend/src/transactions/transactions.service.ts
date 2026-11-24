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
import { ExpenseType, Prisma, Transaction, TransactionCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  GASTO_CREADO,
  GastoCreado,
  PAGO_CONFIRMADO,
  PAGO_MARCADO,
  PAGO_RECHAZADO,
  PagoConfirmado,
  PagoMarcado,
  PagoRechazado,
  TICKET_CREADO,
  TicketCreado,
  type MoneyNotice,
} from './expense.events';
import { buildExpenseRows, MAX_RECEIPT_TOTAL_CENTS } from './expense-rows';
import { centsToAmount } from './expense-split';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { SettleDebtDto } from './dto/settle-debt.dto';
import {
  CreateReceiptTransactionDto,
  ReceiptItemDto,
} from './dto/create-receipt-transaction.dto';

import {
  BalanceUsuario,
  calcularMinimosPagos,
  Pago,
} from './balance-calculator';

// Un aviso de pago no cuenta en el balance hasta que el acreedor lo confirma
const SOLO_CONFIRMADAS = { not: TransactionCategory.pending };

interface AvisoPago {
  id: string;
  from_user_id: string;
  to_user_id: string;
  amount: Prisma.Decimal;
}

interface FilaDeuda {
  deudorId: string;
  acreedorId: string;
  monto: number;
  pagoPendienteId: string | null;
}

export interface RespuestaMiBalancePersonal {
  miResumen: {
    esDeudor: boolean;
    monto: number;
    conceptos: string[];
  };
  mensaje: string;
}

export type RolEnDeuda = 'deudor' | 'acreedor' | 'ajeno';
export type AccionSettleUp =
  'marcar_pagado' | 'confirmar_pago' | 'rechazar_pago';

export interface DeudaSettleUp {
  deudorId: string;
  deudor: string;
  acreedorId: string;
  acreedor: string;
  // si hay un aviso de pago pendiente, es el importe de ese aviso
  monto: number;
  estado: 'por_pagar' | 'pendiente_confirmacion';
  pagoPendienteId: string | null;
  rol: RolEnDeuda;
  acciones: AccionSettleUp[];
}

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    // Opcional: sin él (p. ej. en los tests que no lo dan) no se emiten eventos ni hay avisos
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  // `currentUserId` es quien crea el gasto: no recibe aviso de su propio gasto aunque sea deudor
  async create(createTransactionDto: CreateTransactionDto, currentUserId: string) {
    const hasMultipleDebtors = Boolean(
      createTransactionDto.to_user_ids?.length,
    );
    const debtorIds = hasMultipleDebtors
      ? Array.from(new Set(createTransactionDto.to_user_ids))
      : createTransactionDto.to_user_id
        ? [createTransactionDto.to_user_id]
        : [];

    // RNF-01: antes de nada, quien llama tiene que vivir en el piso. Va primero para que a
    // alguien de fuera no le cambie la respuesta según lo que mande (ni siquiera un 400)
    await this.asegurarMiembro(createTransactionDto.apartment_id, currentUserId);

    if (debtorIds.length === 0) {
      throw new BadRequestException('At least one debtor must be specified');
    }

    const payerId = createTransactionDto.from_user_id;
    // El pagador lo elige quien llama (puede registrar que pagó un compañero), pero tanto él
    // como los deudores tienen que ser del mismo piso
    await this.asegurarParticipantes(createTransactionDto.apartment_id, [
      payerId,
      ...debtorIds,
    ]);
    if (debtorIds.every((id) => id === payerId)) {
      return [];
    }

    // Un gasto manual es un Expense sin ticket (receipt_id vacío) con una deuda por persona.
    // Si el que paga está entre los elegidos, también reparte el gasto pero no se debe a sí mismo
    const { expense, transactions } = buildExpenseRows({
      apartmentId: createTransactionDto.apartment_id,
      payerId,
      totalCents: Math.round(Number(createTransactionDto.amount) * 100),
      concept: createTransactionDto.concept,
      category: createTransactionDto.category,
      date: createTransactionDto.date
        ? new Date(createTransactionDto.date)
        : undefined,
      participantIds: debtorIds,
    });

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.expense.create({ data: expense });
        await tx.transaction.createMany({ data: transactions });
      });
    } catch (error) {
      this.handlePrismaError(error);
    }

    // Evento de dominio: NotificationsListener manda el «Aviso de cobro» a cada deudor (UT1018)
    await this.events?.emitAsync(
      GASTO_CREADO,
      new GastoCreado(transactions, currentUserId),
    );
    return hasMultipleDebtors ? transactions : transactions[0];
  }

  async createFromReceipt(dto: CreateReceiptTransactionDto, payerId: string) {
    const legacyIds = [...new Set(dto.participant_ids ?? [])];
    const receiptId = randomUUID();
    const date = dto.date ? new Date(dto.date) : undefined;

    // Cada producto es un gasto (Expense) con su propio reparto entre las personas que lo
    // comparten (assigned_to). Sin personas, el producto queda a cuenta del que paga: suma en
    // el total del ticket pero no genera deuda
    let totalCents = 0;
    let unassignedCents = 0;
    const lines = dto.items.map((item) => {
      const cents = this.itemCents(item) * item.quantity;
      totalCents += cents;

      const ids = item.assigned_to
        ? [...new Set(item.assigned_to)]
        : legacyIds.length > 0
          ? [...new Set([payerId, ...legacyIds])]
          : [];
      if (ids.length === 0) {
        unassignedCents += cents;
      }
      return {
        ids,
        rows: buildExpenseRows({
          apartmentId: dto.apartment_id,
          payerId,
          receiptId,
          totalCents: cents,
          concept: item.name,
          category: dto.category,
          date,
          participantIds: ids,
        }),
      };
    });

    if (totalCents <= 0) {
      throw new BadRequestException('Receipt total must be positive');
    }
    if (totalCents > MAX_RECEIPT_TOTAL_CENTS) {
      throw new BadRequestException('Receipt total must not exceed 10000.00');
    }

    const apartment = await this.prisma.apartment.findUnique({
      where: { id: dto.apartment_id },
      select: {
        user_apartments: { select: { user_id: true } },
      },
    });
    // RNF-01: un piso que no existe y un piso ajeno dan la misma respuesta (403), como en
    // asegurarMiembro: así quien no es del piso no puede saber si existe
    const memberIds = new Set(
      (apartment?.user_apartments ?? []).map(({ user_id }) => user_id),
    );
    if (!apartment || !memberIds.has(payerId)) {
      throw new ForbiddenException('No perteneces a este piso');
    }
    const assignedIds = lines.flatMap(({ ids }) => ids);
    if (assignedIds.some((id) => !memberIds.has(id))) {
      throw new BadRequestException(
        'All participants must belong to the apartment',
      );
    }

    const expenses = lines.map(({ rows }) => rows.expense);
    const transactions = lines.flatMap(({ rows }) => rows.transactions);
    const debtorIds = new Set(
      transactions.map((transaction) => transaction.to_user_id),
    );
    if (debtorIds.size === 0) {
      throw new BadRequestException(
        'Select at least one person to share the receipt with',
      );
    }

    // El ticket, sus productos y las deudas se guardan juntos o no se guarda nada
    await this.prisma.$transaction(async (tx) => {
      await tx.receipt.create({
        data: {
          id: receiptId,
          apartment_id: dto.apartment_id,
          payer_id: payerId,
          total_amount: centsToAmount(totalCents),
          date,
        },
      });
      await tx.expense.createMany({ data: expenses });
      await tx.transaction.createMany({ data: transactions });
    });

    // Evento de dominio: NotificationsListener manda un «Aviso de cobro» por persona con su
    // parte de todo el ticket, no uno por producto (UT1018)
    await this.events?.emitAsync(
      TICKET_CREADO,
      new TicketCreado(
        {
          id: receiptId,
          apartment_id: dto.apartment_id,
          payer_id: payerId,
          category: dto.category,
        },
        transactions,
        payerId,
      ),
    );

    return {
      receipt_id: receiptId,
      // Total completo del ticket, también lo que queda a cuenta del que paga
      total: centsToAmount(totalCents),
      unassigned_total: centsToAmount(unassignedCents),
      participant_count: debtorIds.size + 1,
      transactions,
    };
  }

  private itemCents(item: ReceiptItemDto): number {
    const [whole, decimals = ''] = item.unit_price.split('.');
    return Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
  }

  async findUsersTransactions(apartmentId: string | undefined, userId: string) {
    const transactions = await this.prisma.transaction.findMany({
      where: this.userTransactionsFilter(apartmentId, userId),
      include: {
        apartment: true,
        fromUser: true,
        toUser: true,
      },
      // lo más reciente primero; created_at desempata dos gastos del mismo día
      orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
    });

    return transactions.map((transaction) => ({
      ...transaction,
      paidByCurrentUser: transaction.from_user_id === userId,
    }));
  }

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        throw new NotFoundException('Transaction not found');
      }
      if (error.code === 'P2003') {
        throw new BadRequestException('Apartment or user not found');
      }
    }
    throw error;
  }

  async getPagoMinimo(apartmentId: string): Promise<Pago[]> {
    const balances = await this.calcularAllBalances(apartmentId);
    return calcularMinimosPagos(balances);
  }

  async getPersonalSummary(
    apartmentId: string,
    userId: string,
  ): Promise<RespuestaMiBalancePersonal> {
    // RNF-01: solo los miembros del piso piden su resumen, como en getSettleUp
    await this.asegurarMiembro(apartmentId, userId);

    const payments = await this.getPagoMinimo(apartmentId);
    const userNames = await this.getPaymentUserNames(payments);
    return this.buildPersonalSummary(payments, userId, userNames);
  }

  async getPublicApartmentBalance(inviteCode: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        inviteCode,
      )
    ) {
      throw new NotFoundException(
        'El código introducido no es válido o ha caducado',
      );
    }

    const apartment = await this.prisma.apartment.findUnique({
      where: { invite_code: inviteCode },
      select: { id: true, name: true },
    });

    if (!apartment) {
      throw new NotFoundException(
        'El código introducido no es válido o ha caducado',
      );
    }

    const payments = await this.getPagoMinimo(apartment.id);
    const userNames = await this.getPaymentUserNames(payments);

    return {
      apartment: { name: apartment.name },
      globalPayments: payments.map((payment) => ({
        deudor: userNames[payment.deudorId] ?? payment.deudorId,
        acreedor: userNames[payment.acreedorId] ?? payment.acreedorId,
        monto: payment.monto,
      })),
    };
  }

  async getSettleUp(
    apartmentId: string,
    userId: string,
  ): Promise<DeudaSettleUp[]> {
    await this.asegurarMiembro(apartmentId, userId);

    const [deudas, avisos] = await Promise.all([
      this.getPagoMinimo(apartmentId),
      this.getPendingPaymentNotices(apartmentId),
    ]);

    const filas = this.combinarDeudasConAvisos(deudas, avisos);
    const userNames = await this.getPaymentUserNames(filas);
    return filas.map((fila) => this.toDeudaSettleUp(fila, userId, userNames));
  }

  private userTransactionsFilter(
    apartmentId: string | undefined,
    userId: string,
  ): Prisma.TransactionWhereInput {
    return {
      ...(apartmentId ? { apartment_id: apartmentId } : {}),
      category: SOLO_CONFIRMADAS,
      OR: [{ from_user_id: userId }, { to_user_id: userId }],
    };
  }

  private async getPaymentUserNames(
    payments: Array<Pick<Pago, 'deudorId' | 'acreedorId'>>,
  ): Promise<Record<string, string>> {
    return this.usersService.getUserNames(
      payments.flatMap((payment) => [payment.deudorId, payment.acreedorId]),
    );
  }

  private async getPendingPaymentNotices(
    apartmentId: string,
  ): Promise<AvisoPago[]> {
    return this.prisma.transaction.findMany({
      where: {
        apartment_id: apartmentId,
        category: TransactionCategory.pending,
      },
      select: {
        id: true,
        from_user_id: true,
        to_user_id: true,
        amount: true,
      },
    });
  }

  private buildPersonalSummary(
    payments: Pago[],
    userId: string,
    userNames: Record<string, string>,
  ): RespuestaMiBalancePersonal {
    const debtsAsDebtor = payments.filter(
      (payment) => payment.deudorId === userId,
    );
    const debtsAsCreditor = payments.filter(
      (payment) => payment.acreedorId === userId,
    );

    if (debtsAsDebtor.length > 0) {
      const monto = this.totalPayments(debtsAsDebtor);
      return {
        miResumen: {
          esDeudor: true,
          monto,
          conceptos: debtsAsDebtor.map(
            (payment) =>
              `Debes ${payment.monto}€ a ${userNames[payment.acreedorId] ?? payment.acreedorId
              }`,
          ),
        },
        mensaje: `En total, debes ${monto.toFixed(2)}€ para saldar cuentas.`,
      };
    }

    if (debtsAsCreditor.length > 0) {
      const monto = this.totalPayments(debtsAsCreditor);
      return {
        miResumen: {
          esDeudor: false,
          monto,
          conceptos: debtsAsCreditor.map(
            (payment) =>
              `${userNames[payment.deudorId] ?? payment.deudorId} te debe ${payment.monto
              }€`,
          ),
        },
        mensaje: `En total, tienes ${monto.toFixed(2)}€ pendientes de cobro.`,
      };
    }

    return {
      miResumen: { esDeudor: false, monto: 0, conceptos: [] },
      mensaje: 'Estás al día en tus pagos.',
    };
  }

  private totalPayments(payments: Pago[]): number {
    const total = payments.reduce((sum, payment) => sum + payment.monto, 0);
    return parseFloat(total.toFixed(2));
  }

  private combinarDeudasConAvisos(
    deudas: Pago[],
    avisos: AvisoPago[],
  ): FilaDeuda[] {
    const avisosSinAsignar = [...avisos];
    const filas = deudas.map((deuda) => {
      const indice = avisosSinAsignar.findIndex(
        (aviso) =>
          aviso.from_user_id === deuda.deudorId &&
          aviso.to_user_id === deuda.acreedorId,
      );
      const aviso =
        indice >= 0 ? avisosSinAsignar.splice(indice, 1)[0] : undefined;

      return {
        deudorId: deuda.deudorId,
        acreedorId: deuda.acreedorId,
        monto: aviso ? Number(aviso.amount) : deuda.monto,
        pagoPendienteId: aviso?.id ?? null,
      };
    });

    return filas.concat(
      avisosSinAsignar.map((aviso) => ({
        deudorId: aviso.from_user_id,
        acreedorId: aviso.to_user_id,
        monto: Number(aviso.amount),
        pagoPendienteId: aviso.id,
      })),
    );
  }

  private toDeudaSettleUp(
    fila: FilaDeuda,
    userId: string,
    userNames: Record<string, string>,
  ): DeudaSettleUp {
    const rol: RolEnDeuda =
      fila.deudorId === userId
        ? 'deudor'
        : fila.acreedorId === userId
          ? 'acreedor'
          : 'ajeno';
    const pendiente = fila.pagoPendienteId !== null;

    return {
      ...fila,
      deudor: userNames[fila.deudorId] ?? fila.deudorId,
      acreedor: userNames[fila.acreedorId] ?? fila.acreedorId,
      estado: pendiente ? 'pendiente_confirmacion' : 'por_pagar',
      rol,
      acciones: this.accionesDisponibles(rol, pendiente),
    };
  }

  // El deudor avisa de que ha pagado: queda pendiente hasta que el acreedor lo confirme
  async markAsPaid(
    apartmentId: string,
    deudorId: string,
    settleDebtDto: SettleDebtDto,
  ) {
    await this.asegurarMiembro(apartmentId, deudorId);

    const deudas = await this.getPagoMinimo(apartmentId);
    const deuda = deudas.find(
      (pago) =>
        pago.deudorId === deudorId &&
        pago.acreedorId === settleDebtDto.acreedor_id,
    );

    if (!deuda) {
      throw new NotFoundException(
        'No tienes ninguna deuda pendiente con este usuario',
      );
    }

    if (Math.abs(deuda.monto - Number(settleDebtDto.amount)) > 0.01) {
      throw new ConflictException(
        'El balance ha cambiado, recarga la pantalla',
      );
    }

    // Comprobar que no hay aviso y crearlo van en una transacción Serializable: si llegan
    // dos peticiones a la vez, Postgres aborta una (P2034) en lugar de crear dos avisos
    let pago: MoneyNotice;
    try {
      pago = await this.prisma.$transaction(
        async (tx) => {
          const avisoPrevio = await tx.transaction.findFirst({
            where: {
              apartment_id: apartmentId,
              from_user_id: deudorId,
              to_user_id: deuda.acreedorId,
              category: TransactionCategory.pending,
            },
            select: { id: true },
          });

          if (avisoPrevio) {
            throw new ConflictException(
              'Ya has avisado de este pago; falta que lo confirme',
            );
          }

          // La liquidación es un gasto (SETTLEMENT) que paga el deudor y debe entero el acreedor:
          // así entra en el balance como cualquier otro gasto y sale en la lista de gastos
          const { expense, transactions } = buildExpenseRows({
            apartmentId,
            payerId: deudorId,
            type: ExpenseType.SETTLEMENT,
            totalCents: Math.round(deuda.monto * 100),
            category: TransactionCategory.pending,
            participantIds: [deuda.acreedorId],
          });
          await tx.expense.create({ data: expense });
          await tx.transaction.createMany({ data: transactions });
          return transactions[0];
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(
          'Ya has avisado de este pago; falta que lo confirme',
        );
      }
      throw error;
    }

    // Evento de dominio, fuera de la transacción Serializable para no alargarla: aviso al
    // acreedor (UT1018)
    await this.events?.emitAsync(PAGO_MARCADO, new PagoMarcado(pago));
    return pago;
  }

  // El acreedor confirma que le ha llegado el dinero: el aviso pasa a ser un pago
  async confirmPayment(transactionId: string, userId: string) {
    await this.asegurarAvisoDelAcreedor(transactionId, userId);

    let confirmado: Transaction;
    try {
      confirmado = await this.prisma.$transaction(async (tx) => {
        const fila = await tx.transaction.update({
          // Las condiciones van también en la escritura para que sea atómica: si otra petición
          // lo ha confirmado o rechazado entretanto, Prisma no encuentra la fila (P2025) y no se
          // toca nada más. Esta escritura va siempre la primera
          where: {
            id: transactionId,
            category: TransactionCategory.pending,
            to_user_id: userId,
          },
          data: { category: TransactionCategory.payment },
        });
        // La liquidación (Expense) cambia a la vez que su deuda
        await tx.expense.update({
          where: { id: fila.expense_id },
          data: { category: TransactionCategory.payment },
        });
        return fila;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new ConflictException(
          'Este pago ya no está pendiente de confirmar',
        );
      }
      this.handlePrismaError(error);
    }

    // Evento de dominio: aviso al deudor de que su pago ha llegado (UT1018)
    await this.events?.emitAsync(PAGO_CONFIRMADO, new PagoConfirmado(confirmado));
    return confirmado;
  }

  // El acreedor dice que no le ha llegado: se descarta el aviso y la deuda sigue en pie
  async rejectPayment(transactionId: string, userId: string) {
    await this.asegurarAvisoDelAcreedor(transactionId, userId);

    let rechazado: Transaction;
    try {
      rechazado = await this.prisma.$transaction(async (tx) => {
        const descartado = await tx.transaction.delete({
          // Igual que al confirmar: nunca se borra una fila que ya no sea un aviso pendiente, y
          // esta escritura va la primera. Solo si se ha borrado el aviso se borra su liquidación
          where: {
            id: transactionId,
            category: TransactionCategory.pending,
            to_user_id: userId,
          },
        });
        await tx.expense.delete({ where: { id: descartado.expense_id } });
        return descartado;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new ConflictException(
          'Este pago ya no está pendiente de confirmar',
        );
      }
      this.handlePrismaError(error);
    }

    // Evento de dominio: aviso al deudor de que su pago no ha llegado (UT1018)
    await this.events?.emitAsync(PAGO_RECHAZADO, new PagoRechazado(rechazado));
    return rechazado;
  }

  private accionesDisponibles(
    rol: RolEnDeuda,
    pendiente: boolean,
  ): AccionSettleUp[] {
    if (rol === 'deudor' && !pendiente) return ['marcar_pagado'];
    if (rol === 'acreedor' && pendiente) {
      return ['confirmar_pago', 'rechazar_pago'];
    }
    return [];
  }

  private async asegurarMiembro(apartmentId: string, userId: string) {
    const miembro = await this.prisma.userApartment.findUnique({
      where: {
        user_id_apartment_id: { user_id: userId, apartment_id: apartmentId },
      },
      select: { user_id: true },
    });

    if (!miembro) {
      throw new ForbiddenException('No perteneces a este piso');
    }
  }

  // Todos los ids tienen que ser miembros del piso, si no es un 400 (como en createFromReceipt)
  private async asegurarParticipantes(apartmentId: string, userIds: string[]) {
    const esperados = new Set(userIds);
    const miembros = await this.prisma.userApartment.findMany({
      where: { apartment_id: apartmentId, user_id: { in: [...esperados] } },
      select: { user_id: true },
    });

    if (miembros.length !== esperados.size) {
      throw new BadRequestException(
        'All participants must belong to the apartment',
      );
    }
  }

  private async asegurarAvisoDelAcreedor(
    transactionId: string,
    userId: string,
  ) {
    const aviso = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { category: true, to_user_id: true },
    });

    if (!aviso) {
      throw new NotFoundException('Transaction not found');
    }
    if (aviso.category !== TransactionCategory.pending) {
      throw new ConflictException(
        'Este pago ya no está pendiente de confirmar',
      );
    }
    if (aviso.to_user_id !== userId) {
      throw new ForbiddenException(
        'Solo quien recibe el dinero puede confirmar el pago',
      );
    }
  }

  private async calcularAllBalances(
    apartmentId: string,
  ): Promise<BalanceUsuario[]> {
    const pagadores = await this.prisma.transaction.findMany({
      where: { apartment_id: apartmentId, category: SOLO_CONFIRMADAS },
      select: { from_user_id: true },
      distinct: ['from_user_id'],
    });

    const deudores = await this.prisma.transaction.findMany({
      where: { apartment_id: apartmentId, category: SOLO_CONFIRMADAS },
      select: { to_user_id: true },
      distinct: ['to_user_id'],
    });

    const userIdsSet = new Set<string>();
    pagadores.forEach((t) => userIdsSet.add(t.from_user_id));
    deudores.forEach((t) => userIdsSet.add(t.to_user_id));
    const userIds = Array.from(userIdsSet);

    const balancePromises = userIds.map(async (userId) => {
      const ingresoAgg = await this.prisma.transaction.aggregate({
        _sum: { amount: true },
        where: {
          apartment_id: apartmentId,
          from_user_id: userId,
          category: SOLO_CONFIRMADAS,
        },
      });

      const gastoAgg = await this.prisma.transaction.aggregate({
        _sum: { amount: true },
        where: {
          apartment_id: apartmentId,
          to_user_id: userId,
          category: SOLO_CONFIRMADAS,
        },
      });

      const totalPagado = Number(ingresoAgg._sum.amount ?? 0);
      const totalDebido = Number(gastoAgg._sum.amount ?? 0);

      return {
        userId,
        balanceNeto: totalPagado - totalDebido,
      };
    });

    return Promise.all(balancePromises);
  }
}
