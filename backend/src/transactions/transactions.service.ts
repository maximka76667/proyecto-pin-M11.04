import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TransactionCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CATEGORIAS_DE_LIQUIDACION } from './categorias';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { SettleDebtDto } from './dto/settle-debt.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
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
export type AccionSettleUp = 'marcar_pagado' | 'confirmar_pago' | 'rechazar_pago';

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
  ) {}


  async create(createTransactionDto: CreateTransactionDto) {
    const debtorIds = createTransactionDto.to_user_ids?.length
      ? Array.from(new Set(createTransactionDto.to_user_ids))
      : createTransactionDto.to_user_id
        ? [createTransactionDto.to_user_id]
        : [];

    if (debtorIds.length === 0) {
      throw new BadRequestException('At least one debtor must be specified');
    }

    if (debtorIds.includes(createTransactionDto.from_user_id)) {
      throw new BadRequestException('The payer and the debtor must be different');
    }

    try {
      if (debtorIds.length === 1) {
        return await this.prisma.transaction.create({
          data: {
            apartment_id: createTransactionDto.apartment_id,
            from_user_id: createTransactionDto.from_user_id,
            to_user_id: debtorIds[0],
            amount: createTransactionDto.amount,
            concept: createTransactionDto.concept,
            category: createTransactionDto.category,
          },
        });
      }

      // Split total amount among debtors equally (using cents to handle exact rounding)
      const totalAmount = Number(createTransactionDto.amount);
      const totalCents = Math.round(totalAmount * 100);
      const baseCents = Math.floor(totalCents / debtorIds.length);
      const remainder = totalCents % debtorIds.length;

      const creates = debtorIds.map((debtorId, index) => {
        const shareCents = baseCents + (index < remainder ? 1 : 0);
        const shareAmount = (shareCents / 100).toFixed(2);

        return this.prisma.transaction.create({
          data: {
            apartment_id: createTransactionDto.apartment_id,
            from_user_id: createTransactionDto.from_user_id,
            to_user_id: debtorId,
            amount: shareAmount,
            concept: createTransactionDto.concept,
            category: createTransactionDto.category,
          },
        });
      });

      if (typeof (this.prisma as unknown as { $transaction?: unknown }).$transaction === 'function') {
        return await this.prisma.$transaction(creates);
      }
      return await Promise.all(creates);
    } catch (error) {
      this.handlePrismaError(error);
    }
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

  async findOne(id: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: {
        apartment: true,
        fromUser: true,
        toUser: true,
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return transaction;
  }

  async update(id: string, updateTransactionDto: UpdateTransactionDto) {
    await this.asegurarEditable(id);

    try {
      const { date, ...rest } = updateTransactionDto;

      return await this.prisma.transaction.update({
        where: { id },
        data: date ? { ...rest, date: new Date(date) } : rest,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async remove(id: string) {
    await this.asegurarEditable(id);

    try {
      return await this.prisma.transaction.delete({
        where: { id },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
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
    const payments = await this.getPagoMinimo(apartmentId);
    const userNames = await this.getPaymentUserNames(payments);
    return this.buildPersonalSummary(payments, userId, userNames);
  }

  /*async getSettleUp(apartmentId: string): Promise<DeudaSettleUp[]> {
    const allPayments = await this.getPagoMinimo(apartmentId);
    const userNames = await this.usersService.getUserNames(
      allPayments.flatMap((payment) => [payment.deudorId, payment.acreedorId]),
    );

    return allPayments.map((payment) => ({
      deudorId: payment.deudorId,
      deudor: userNames[payment.deudorId] ?? payment.deudorId,
      acreedorId: payment.acreedorId,
      acreedor: userNames[payment.acreedorId] ?? payment.acreedorId,
      monto: payment.monto,
    }));
  }

  // Solo el acreedor puede marcar como pagada una deuda que tiene a su favor
  async settleDebt(apartmentId: string, acreedorId: string, settleDebtDto: SettleDebtDto) {
    const allPayments = await this.getPagoMinimo(apartmentId);
    const pago = allPayments.find(
      (payment) =>
        payment.deudorId === settleDebtDto.deudor_id && payment.acreedorId === acreedorId,
    );

    if (!pago) {
      throw new NotFoundException('No hay ninguna deuda pendiente de este usuario contigo');
    }

    if (Math.abs(pago.monto - Number(settleDebtDto.amount)) > 0.01) {
      throw new ConflictException('El balance ha cambiado, recarga la pantalla');
    }

    return this.prisma.transaction.create({
      data: {
        apartment_id: apartmentId,
        from_user_id: pago.deudorId,
        to_user_id: pago.acreedorId,
        amount: pago.monto.toFixed(2),
        category: TransactionCategory.payment,
      },
    });
  }*/

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
              `Debes ${payment.monto}€ a ${
                userNames[payment.acreedorId] ?? payment.acreedorId
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
              `${userNames[payment.deudorId] ?? payment.deudorId} te debe ${
                payment.monto
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
    try {
      return await this.prisma.$transaction(
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

          return tx.transaction.create({
            data: {
              apartment_id: apartmentId,
              from_user_id: deudorId,
              to_user_id: deuda.acreedorId,
              amount: deuda.monto.toFixed(2),
              category: TransactionCategory.pending,
            },
          });
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
  }

  // El acreedor confirma que le ha llegado el dinero: el aviso pasa a ser un pago
  async confirmPayment(transactionId: string, userId: string) {
    await this.asegurarAvisoDelAcreedor(transactionId, userId);

    try {
      return await this.prisma.transaction.update({
        // Las condiciones van también en la escritura para que sea atómica: si otra petición
        // lo ha confirmado o rechazado entretanto, Prisma no encuentra la fila (P2025)
        where: {
          id: transactionId,
          category: TransactionCategory.pending,
          to_user_id: userId,
        },
        data: { category: TransactionCategory.payment },
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
  }

  // El acreedor dice que no le ha llegado: se descarta el aviso y la deuda sigue en pie
  async rejectPayment(transactionId: string, userId: string) {
    await this.asegurarAvisoDelAcreedor(transactionId, userId);

    try {
      return await this.prisma.transaction.delete({
        // Igual que al confirmar: nunca se borra una fila que ya no sea un aviso pendiente
        where: {
          id: transactionId,
          category: TransactionCategory.pending,
          to_user_id: userId,
        },
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

  private async asegurarAvisoDelAcreedor(transactionId: string, userId: string) {
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

  // Los pagos y los avisos solo se gestionan desde el flujo de saldar deudas:
  // editar o borrar un pago confirmado resucitaría la deuda.
  private async asegurarEditable(id: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      select: { category: true },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }
    if (CATEGORIAS_DE_LIQUIDACION.includes(transaction.category)) {
      throw new ConflictException(
        'Los pagos de deudas no se pueden editar ni borrar desde aquí',
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
